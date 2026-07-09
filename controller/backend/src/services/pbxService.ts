// src/services/pbxService.ts
// Orchestrates intercom sessions. In Phase 1 the controller drives each
// endpoint's own container-sip-endpoint REST API to place/answer/mute; the
// pbx-core (drachtio) then handles auto-answer + rtpengine media anchoring
// when the initiator dials the target's AOR.
//
// Direct   → initiator POST /api/call { target: <callee dial string> }
// End      → initiator POST /api/hangup
// PTT mute → endpoint  POST /api/hold  (a=sendonly, stops transmitting)
// PTT talk → endpoint  POST /api/resume
// Group    → Phase 2 (server-side mixer). Stubbed here.
import { query, queryOne } from '../db/pool';
import { createError } from '../middleware/errorHandler';
import { audit } from './auditService';
import { listMembers, getGroup, getGroupByDialCode } from './groupService';
import { TurretSessionUser } from '../middleware/turretSession';

// Must match pbx-core's config.groupPrefix (src/config.ts, GROUP_PREFIX env).
// Kept as a constant here rather than shared code since pbx-core and the
// controller are separate deployables; if you change one, change both.
const GROUP_PREFIX = process.env.GROUP_PREFIX || '*8';

interface EndpointRow { id: string; name: string; aor: string; rest_url: string | null; }

async function getEndpoint(id: string): Promise<EndpointRow> {
  const ep = await queryOne<EndpointRow>(
    `SELECT id, name, aor, rest_url FROM intercom_endpoints WHERE id = $1 AND enabled = TRUE`, [id]);
  if (!ep) throw createError('Endpoint not found or disabled', 404);
  return ep;
}

function dialString(aor: string): string {
  // sip:1002@intercom.lab -> 1002 (container-sip-endpoint /api/call takes a target)
  return aor.replace(/^sips?:/, '').split('@')[0];
}

async function post(restUrl: string, path: string, body?: unknown): Promise<Response> {
  const resp = await fetch(`${restUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw createError(`Endpoint ${path} failed: HTTP ${resp.status}`, 502);
  return resp;
}

/** Start a direct intercom call from one endpoint to another. */
export async function startDirect(actor: string, initiatorId: string, targetId: string): Promise<{ sessionId: string }> {
  const initiator = await getEndpoint(initiatorId);
  const target = await getEndpoint(targetId);
  if (!initiator.rest_url) throw createError('Initiator has no REST url to drive', 400);

  const session = await queryOne<{ id: string }>(
    `INSERT INTO intercom_sessions (kind, initiator_endpoint_id, target_endpoint_id, state)
     VALUES ('direct', $1, $2, 'active') RETURNING id`, [initiator.id, target.id]);
  const sessionId = session!.id;

  await query(
    `INSERT INTO intercom_session_participants (session_id, endpoint_id) VALUES ($1,$2),($1,$3)`,
    [sessionId, initiator.id, target.id]);

  try {
    // pbx-core injects the auto-answer header + anchors media when this dials.
    await post(initiator.rest_url, '/api/call', { target: dialString(target.aor) });
  } catch (err) {
    await query(`UPDATE intercom_sessions SET state='failed', ended_at=now(), end_reason=$2 WHERE id=$1`,
      [sessionId, (err as Error).message]);
    throw err;
  }
  await audit(actor, 'session', sessionId, 'call_start',
    { kind: 'direct', from: initiator.name, to: target.name });
  return { sessionId };
}

/** End a session and hang up its endpoints. */
export async function endSession(actor: string, sessionId: string, reason = 'operator'): Promise<void> {
  const parts = await query<{ endpoint_id: string; rest_url: string | null }>(
    `SELECT p.endpoint_id, e.rest_url
     FROM intercom_session_participants p
     JOIN intercom_endpoints e ON e.id = p.endpoint_id
     WHERE p.session_id = $1 AND p.left_at IS NULL`, [sessionId]);
  await Promise.allSettled(parts.rows.map(p => p.rest_url ? post(p.rest_url, '/api/hangup') : Promise.resolve()));
  await query(`UPDATE intercom_session_participants SET left_at=now() WHERE session_id=$1 AND left_at IS NULL`, [sessionId]);
  await query(`UPDATE intercom_sessions SET state='ended', ended_at=now(), end_reason=$2 WHERE id=$1 AND state='active'`,
    [sessionId, reason]);
  await audit(actor, 'session', sessionId, 'call_end', { reason });
}

/** PTT floor: mute (hold/sendonly) or unmute (resume) one participant. */
export async function setPtt(actor: string, sessionId: string, endpointId: string, muted: boolean): Promise<void> {
  const ep = await getEndpoint(endpointId);
  if (ep.rest_url) await post(ep.rest_url, muted ? '/api/hold' : '/api/resume');
  await query(`UPDATE intercom_session_participants SET muted=$3 WHERE session_id=$1 AND endpoint_id=$2`,
    [sessionId, endpointId, muted]);
  await audit(actor, 'session', sessionId, muted ? 'ptt_release' : 'ptt_grant', { endpoint: ep.name });
}

/**
 * Start a group open-mic session. Each member with can_talk=true has their
 * own endpoint dial the group's conference extension (GROUP_PREFIX + dial_code)
 * — pbx-core routes that to FreeSWITCH's mod_conference (see pbx-core/src/groups.ts).
 * Listen-only members (can_talk=false, e.g. announce-zone receivers) are not
 * dialled out from here; add them as a future enhancement if a receiving
 * endpoint needs to join without transmitting (container-sip-endpoint has no
 * live mic anyway, so it's a safe no-op for that endpoint kind today).
 * PTT floor control (setPtt) reuses the same per-endpoint hold/resume as
 * direct calls — the mixer needs no server-side mute logic.
 */
export async function startGroup(actor: string, groupId: string): Promise<{ sessionId: string }> {
  const group = await getGroup(groupId);
  const members = await listMembers(groupId);
  const talkers = members.filter(m => m.can_talk && m.rest_url);
  if (talkers.length === 0) throw createError('Group has no talking members with a REST url', 400);

  const session = await queryOne<{ id: string }>(
    `INSERT INTO intercom_sessions (kind, group_id, state, bridge_ref)
     VALUES ('group', $1, 'active', $2) RETURNING id`,
    [group.id, `${GROUP_PREFIX}${group.dial_code}`]
  );
  const sessionId = session!.id;

  await Promise.all(members.map(m =>
    query(`INSERT INTO intercom_session_participants (session_id, endpoint_id, muted) VALUES ($1,$2,$3)`,
      [sessionId, m.endpoint_id, !m.can_talk])
  ));

  const dialString = `${GROUP_PREFIX}${group.dial_code}`;
  const results = await Promise.allSettled(
    talkers.map(m => post(m.rest_url!, '/api/call', { target: dialString }))
  );
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length === results.length) {
    await query(`UPDATE intercom_sessions SET state='failed', ended_at=now(), end_reason='all members failed to join' WHERE id=$1`, [sessionId]);
    throw createError('No member could join the conference', 502);
  }

  await audit(actor, 'session', sessionId, 'call_start', {
    kind: 'group', group: group.name, dialString, joined: results.length - failed.length, failed: failed.length,
  });
  return { sessionId };
}

// ── Turret call tracking ─────────────────────────────────────────────────
// Turrets dial directly over SIP through pbx-core — none of the above
// endpoint-driven orchestration is involved — so these are pinged
// separately by the turret itself (routes/turret.ts's /call-events) rather
// than being the thing that places the call. Best-effort: a reporting
// failure here must never be allowed to affect an actual call, so callers
// treat these as fire-and-forget.

async function getDirectoryUserIdByExtension(extension: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM intercom_directory_users WHERE LOWER(extension) = LOWER($1)`, [extension]);
  return row?.id ?? null;
}

export async function recordTurretCallStart(
  turretUser: TurretSessionUser,
  clientCallId: string,
  kind: 'direct' | 'group',
  direction: 'outgoing' | 'incoming',
  counterpartExtension: string,
): Promise<{ sessionId: string } | null> {
  const groupId = kind === 'group' ? (await getGroupByDialCode(counterpartExtension))?.id ?? null : null;
  const counterpartDirectoryUserId = kind === 'direct' ? await getDirectoryUserIdByExtension(counterpartExtension) : null;

  const initiatorId = direction === 'outgoing' ? turretUser.id : counterpartDirectoryUserId;
  const targetId    = direction === 'outgoing' ? counterpartDirectoryUserId : turretUser.id;

  const session = await queryOne<{ id: string }>(
    `INSERT INTO intercom_sessions
       (kind, initiator_directory_user_id, target_directory_user_id, group_id, state, client_call_id)
     VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
    [kind, initiatorId, targetId, groupId, clientCallId]);
  if (!session) return null;

  await audit(turretUser.extension, 'session', session.id, 'call_start', {
    kind, direction, from: turretUser.extension, counterpart: counterpartExtension,
  });
  return { sessionId: session.id };
}

export async function recordTurretCallEnd(
  turretUser: TurretSessionUser,
  clientCallId: string,
  reason?: string,
): Promise<void> {
  const result = await queryOne<{ id: string }>(
    `UPDATE intercom_sessions SET state='ended', ended_at=now(), end_reason=$2
     WHERE client_call_id = $1 AND state = 'active' RETURNING id`,
    [clientCallId, reason ?? null]);
  if (!result) return; // no matching active session — nothing to end, nothing to audit
  await audit(turretUser.extension, 'session', result.id, 'call_end', { reason });
}

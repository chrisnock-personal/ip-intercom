// src/services/pbxCoreService.ts
// Polls pbx-core's read-only admin HTTP endpoint (pbx-core/src/admin.ts)
// for the console's "Live" view — who's registered right now, what calls
// are in progress right now. Nothing here is persisted; pbx-core is the
// only source of truth for this, and it's purely in-memory by design (see
// CLAUDE.md). This service only enriches pbx-core's bare extensions/dial
// codes with friendly names from data controller-backend already has.
import config from '../config';
import { listDirectoryUsers } from './directoryUserService';
import { listGroups } from './groupService';

interface RawBinding {
  aor: string;
  contact: string;
  source: string;
  transport: string;
  mediaMode: 'plain' | 'webrtc';
  expiresAt: number;
}

interface RawCallInfo {
  callId: string;
  kind: 'direct' | 'group';
  from: string;
  to: string;
  startedAt: number;
}

export interface LiveRegistration {
  extension: string;
  name: string | null;
  transport: string;
  mediaMode: 'plain' | 'webrtc';
  expiresAt: string;
}

export interface LiveCall {
  callId: string;
  kind: 'direct' | 'group';
  from: string;       // caller extension
  fromName: string;
  to: string;          // callee extension, or group dial code
  toName: string;
  startedAt: string;
}

function extOf(aor: string): string {
  const m = aor.match(/sips?:([^@;>]+)@/i);
  return m ? m[1] : aor;
}

export async function getLiveStatus(): Promise<{ registrations: LiveRegistration[]; calls: LiveCall[] }> {
  const resp = await fetch(`${config.pbxBaseUrl}/status`, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`pbx-core status HTTP ${resp.status}`);
  const raw = await resp.json() as { registrations: RawBinding[]; calls: RawCallInfo[] };

  const [users, groups] = await Promise.all([listDirectoryUsers(), listGroups()]);
  const nameByExt = new Map(users.map(u => [u.extension, u.name]));
  const nameByDialCode = new Map(groups.map(g => [g.dial_code, g.name]));

  const registrations: LiveRegistration[] = raw.registrations.map((b) => {
    const extension = extOf(b.aor);
    return {
      extension,
      name: nameByExt.get(extension) ?? null,
      transport: b.transport,
      mediaMode: b.mediaMode,
      expiresAt: new Date(b.expiresAt).toISOString(),
    };
  });

  const calls: LiveCall[] = raw.calls.map((c) => ({
    callId: c.callId,
    kind: c.kind,
    from: c.from,
    fromName: nameByExt.get(c.from) ?? c.from,
    to: c.to,
    toName: c.kind === 'group' ? (nameByDialCode.get(c.to) ?? c.to) : (nameByExt.get(c.to) ?? c.to),
    startedAt: new Date(c.startedAt).toISOString(),
  }));

  return { registrations, calls };
}

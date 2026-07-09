import { useState, useEffect, useCallback, useRef } from 'react';
import { api, Button, TurretSession } from './api';
import { createTurretUa, targetUri } from './sipUa';
import { ChannelManager, ChannelId, ChannelState, CHANNEL_IDS, DIALABLE_CHANNEL_IDS, CallEventPayload } from './channels';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Matches pbx-core's config.groupPrefix (GROUP_PREFIX env) — separate
// deployables, no shared code between them. If you change one, change both
// (same convention already used in controller-backend's pbxService.ts).
const GROUP_PREFIX = '*8';

// Extracts just the extension from a SIP URI like "sip:1002@host" -> "1002"
// — same shape as pbx-core's own registrar.ts extOf() helper, duplicated
// here since turret and pbx-core are separate deployables.
function extOf(uri: string): string {
  const m = uri.match(/sips?:([^@;>]+)@/i);
  return m ? m[1] : uri;
}

const CHANNEL_LABELS: Record<ChannelId, string> = {
  handset_a: 'Handset A',
  handset_b: 'Handset B',
  speaker: 'Speaker',
  intercom: 'Intercom',
};

const IDLE_STATES: Record<ChannelId, ChannelState> = {
  handset_a: { status: 'idle', label: null, muted: false, onHold: false },
  handset_b: { status: 'idle', label: null, muted: false, onHold: false },
  speaker: { status: 'idle', label: null, muted: false, onHold: false },
  intercom: { status: 'idle', label: null, muted: false, onHold: false },
};

function LoginScreen({ onLogin, onSubmitGesture }: {
  onLogin: (s: TurretSession) => void; onSubmitGesture: () => void;
}) {
  const [extension, setExtension] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Must run BEFORE the `await` below — anything after that is no longer
    // considered part of this click/submit's user gesture by the browser's
    // autoplay policy, and the audio-unlock trick needs a real gesture.
    onSubmitGesture();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(extension, password);
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form onSubmit={submit} className="login-form">
        <h1>Turret Login</h1>
        <label>
          Extension
          <input value={extension} onChange={(e) => setExtension(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  );
}

function ChannelStrip({ id, state, onHangup, onToggleMute, onToggleHold, onMoveTo, autoAnswer, onToggleAutoAnswer, armed, onArm }: {
  id: ChannelId; state: ChannelState; onHangup: () => void; onToggleMute: () => void;
  onToggleHold: () => void; onMoveTo: (to: ChannelId) => void;
  autoAnswer?: boolean; onToggleAutoAnswer?: () => void;
  armed: boolean; onArm: () => void;
}) {
  const live = state.status === 'connected';
  // Click-to-arm: only idle, dialable channels can be picked as the group-
  // dial target (intercom is never dialable — direct buttons always target
  // it regardless). Safe to add unconditionally: the Mute/Hold/Hang-up/Move
  // buttons below only render when state.status !== 'idle', i.e. exactly
  // when arming is disabled, so there's never a click-target conflict.
  const dialable = DIALABLE_CHANNEL_IDS.includes(id);
  const armable = dialable && state.status === 'idle';
  return (
    <div
      className={`channel channel-${state.status}${state.muted ? ' channel-muted' : ''}${state.onHold ? ' channel-onhold' : ''}${armable && armed ? ' channel-armed' : ''}${armable ? ' channel-armable' : ''}`}
      onClick={armable ? onArm : undefined}
    >
      <div className="channel-name">
        {CHANNEL_LABELS[id]}
        {armable && armed && <span className="armed-badge">● armed</span>}
      </div>
      <div className="channel-status">{state.status === 'idle' ? 'idle' : `${state.status} — ${state.label}${state.onHold ? ' (on hold)' : ''}`}</div>
      {id === 'intercom' && onToggleAutoAnswer && (
        <label className="autoanswer-toggle">
          <input type="checkbox" checked={!!autoAnswer} onChange={onToggleAutoAnswer} /> Auto-answer
        </label>
      )}
      {state.status !== 'idle' && (
        <div className="channel-controls">
          {/* Only meaningful once media is actually flowing — muting/holding
              during 'calling'/'ringing' has no confirmed dialog to act on yet. */}
          {live && (
            <button className={state.muted ? 'mute-btn muted' : 'mute-btn talking'} onClick={onToggleMute}>
              {state.muted ? '🔇 Muted' : '🎙️ Talking'}
            </button>
          )}
          {live && (
            <button className={state.onHold ? 'hold-btn on-hold' : 'hold-btn'} onClick={onToggleHold}>
              {state.onHold ? '▶ Resume' : '⏸ Hold'}
            </button>
          )}
          <button onClick={onHangup}>Hang up</button>
        </div>
      )}
      {state.status !== 'idle' && (
        <div className="move-controls">
          {CHANNEL_IDS.filter((c) => c !== id).map((c) => (
            <button key={c} className="move-btn" onClick={() => onMoveTo(c)}>→ {CHANNEL_LABELS[c]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ButtonGrid({ buttons, states, onPress }: {
  buttons: Button[]; states: Record<ChannelId, ChannelState>; onPress: (b: Button) => void;
}) {
  const buttonLabel = (b: Button) => b.label || (b.button_type === 'direct' ? b.target_extension! : b.target_group_name!);
  // Channel is no longer fixed per button — a button is "active" if its
  // target is live on ANY channel right now, found by scanning all three.
  const activeChannelFor = (label: string): ChannelId | null =>
    CHANNEL_IDS.find((c) => states[c].status !== 'idle' && states[c].label === label) ?? null;
  return (
    <div className="button-grid">
      {buttons.map((b) => {
        const label = buttonLabel(b);
        const activeCh = activeChannelFor(label);
        return (
          <button
            key={b.id}
            className={`turret-btn turret-btn-${b.button_type}${activeCh ? ' turret-btn-active' : ''}`}
            onClick={() => onPress(b)}
          >
            <div className="btn-type">{b.button_type === 'direct' ? 'ICM' : 'GRP-ICM'}</div>
            <div className="btn-label">{label}</div>
            {activeCh && <div className="btn-channel">{CHANNEL_LABELS[activeCh]}</div>}
          </button>
        );
      })}
      {buttons.length === 0 && <div className="button-grid-empty">No buttons assigned yet.</div>}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<TurretSession | null>(null);
  const [channelStates, setChannelStates] = useState<Record<ChannelId, ChannelState>>(IDLE_STATES);
  const [incoming, setIncoming] = useState<{ session: any; from: string } | null>(null);
  const [dialChannel, setDialChannel] = useState<ChannelId>('handset_a');
  // Not persisted — resets to true (today's behavior) on reload/re-login.
  // See CLAUDE.md's Turret backlog: a stepping stone toward a real
  // per-user/per-installation setting once Handset A/B become external lines.
  const [intercomAutoAnswer, setIntercomAutoAnswer] = useState(true);
  const uaRef = useRef<any>(null);
  const managerRef = useRef<ChannelManager>(new ChannelManager((evt: CallEventPayload) => {
    // Fire-and-forget by design — a reporting failure must never affect an
    // actual call. See channels.ts's header comment on CallEventPayload.
    api.reportCallEvent(evt).catch((err) => console.warn(`[call-events] report failed: ${(err as Error).message}`));
  }));
  const sessionRef = useRef<TurretSession | null>(null);
  // newRTCSession below is registered once per login (effect keyed on
  // [session]), so it needs a ref rather than the state value directly to
  // avoid seeing a stale toggle after the operator flips it.
  const intercomAutoAnswerRef = useRef(true);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    intercomAutoAnswerRef.current = intercomAutoAnswer;
  }, [intercomAutoAnswer]);

  useEffect(() => managerRef.current.onChange(setChannelStates), []);

  // Reattach an existing turret session on a same-tab reload.
  useEffect(() => {
    if (!api.isLoggedIn()) return;
    api.me().then(setSession).catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    const ua = createTurretUa(session.extension);
    uaRef.current = ua;

    ua.on('newRTCSession', (data: any) => {
      const rtcSession = data.session;
      if (rtcSession.direction !== 'incoming') return;

      // pbx-core unconditionally injects these on a direct call between
      // intercom-family endpoints (see pbx-core/src/config.ts's
      // autoAnswerHeaders) — honour it exactly like intercom-endpoint does,
      // matching real ring-down turret behaviour: instant pickup, no manual
      // step. Only show the manual banner for the rare inbound call without
      // these headers.
      const inviteRequest = rtcSession._request;
      const callInfo = inviteRequest?.getHeader ? inviteRequest.getHeader('Call-Info') : null;
      const alertInfo = inviteRequest?.getHeader ? inviteRequest.getHeader('Alert-Info') : null;
      const autoAnswer = /answer-after\s*=\s*0/i.test(callInfo || '') || /auto-?answer/i.test(alertInfo || '');
      const from = rtcSession.remote_identity?.uri?.toString() || 'unknown';

      // Direct-intercom calls always land on the dedicated 'intercom'
      // channel (not freeHandset()) — see channels.ts's header comment on
      // why 'intercom' exists separately from Handset A/B. Busy (already
      // occupied) rejects with 486, same precedent as today's
      // both-handsets-busy case used to have.
      if (autoAnswer && intercomAutoAnswerRef.current) {
        if (managerRef.current.getState('intercom').status !== 'idle') {
          try { rtcSession.terminate({ status_code: 486 }); } catch { /* ignore */ }
          return;
        }
        managerRef.current.answer('intercom', rtcSession, from, {
          kind: 'direct', direction: 'incoming', counterpartExtension: extOf(from),
        });
        return;
      }

      setIncoming({ session: rtcSession, from });
      rtcSession.on('ended', () => setIncoming(null));
      rtcSession.on('failed', () => setIncoming(null));
    });

    ua.start();
    return () => {
      ua.stop();
      uaRef.current = null;
    };
  }, [session]);

  const handleLogin = useCallback((s: TurretSession) => setSession(s), []);

  const handleLogout = useCallback(() => {
    for (const ch of CHANNEL_IDS) managerRef.current.hangup(ch);
    uaRef.current?.stop();
    api.logout();
    setSession(null);
  }, []);

  const handleButtonPress = useCallback((b: Button) => {
    const ua = uaRef.current;
    const s = sessionRef.current;
    if (!ua || !s) return;

    const label = b.label || (b.button_type === 'direct' ? b.target_extension! : b.target_group_name!);

    // If this target is already live on ANY channel, hang it up (toggle)
    // instead of redialing — channel is no longer fixed per button, so this
    // has to scan rather than check one known slot.
    const existingChannel = CHANNEL_IDS.find((ch) => {
      const st = managerRef.current.getState(ch);
      return st.status !== 'idle' && st.label === label;
    });
    if (existingChannel) {
      managerRef.current.hangup(existingChannel);
      return;
    }

    const dialTarget = b.button_type === 'direct'
      ? targetUri(b.target_extension!)
      : targetUri(`${GROUP_PREFIX}${b.target_group_dial_code}`);

    // Direct calls never start muted — PTT is a group/hoot concept, not a
    // private 2-party line. A group's PTT default seeds the initial state.
    const initialMuted = b.button_type === 'group' && !!b.target_group_ptt_default;

    // Direct buttons always dial via the dedicated 'intercom' channel,
    // ignoring the Dial-on selector — only group buttons respect it.
    const channel: ChannelId = b.button_type === 'direct' ? 'intercom' : dialChannel;
    const callMeta = b.button_type === 'direct'
      ? { kind: 'direct' as const, direction: 'outgoing' as const, counterpartExtension: b.target_extension! }
      : { kind: 'group' as const, direction: 'outgoing' as const, counterpartExtension: b.target_group_dial_code! };
    managerRef.current.dial(ua, channel, dialTarget, label, callMeta, initialMuted);
  }, [dialChannel]);

  const answerIncoming = useCallback((channel: ChannelId) => {
    if (!incoming) return;
    managerRef.current.answer(channel, incoming.session, incoming.from, {
      kind: 'direct', direction: 'incoming', counterpartExtension: extOf(incoming.from),
    });
    setIncoming(null);
  }, [incoming]);

  const rejectIncoming = useCallback(() => {
    if (!incoming) return;
    try { incoming.session.terminate({ status_code: 486 }); } catch { /* ignore */ }
    setIncoming(null);
  }, [incoming]);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} onSubmitGesture={() => managerRef.current.primeAudio()} />;
  }

  return (
    <div className="turret-shell">
      <div className="turret-topbar">
        <div>
          <span className="turret-name">{session.name}</span>
          <span className="turret-ext">ext {session.extension}</span>
        </div>
        <button onClick={handleLogout}>Log out</button>
      </div>

      {incoming && (
        <div className="incoming-banner">
          <span>Incoming call from {incoming.from}</span>
          {/* Reachable only via a genuine direct-intercom call with
              auto-answer toggled off (pbx-core injects the auto-answer
              header unconditionally today, so nothing else currently
              produces a header-less inbound INVITE) — Intercom is the only
              sensible answer target. */}
          <button onClick={() => answerIncoming('intercom')} disabled={channelStates.intercom.status !== 'idle'}>
            Answer on Intercom
          </button>
          <button onClick={rejectIncoming}>Reject</button>
        </div>
      )}

      <div className="channel-strip">
        {CHANNEL_IDS.map((id) => (
          <ChannelStrip
            key={id}
            id={id}
            state={channelStates[id]}
            onHangup={() => managerRef.current.hangup(id)}
            onToggleMute={() => managerRef.current.setMuted(id, !channelStates[id].muted)}
            onToggleHold={() => managerRef.current.setHold(id, !channelStates[id].onHold)}
            onMoveTo={(to) => managerRef.current.moveCall(id, to)}
            autoAnswer={id === 'intercom' ? intercomAutoAnswer : undefined}
            onToggleAutoAnswer={id === 'intercom' ? () => setIntercomAutoAnswer((v) => !v) : undefined}
            armed={id === dialChannel}
            onArm={() => setDialChannel(id)}
          />
        ))}
      </div>

      <ButtonGrid buttons={session.buttons} states={channelStates} onPress={handleButtonPress} />
    </div>
  );
}

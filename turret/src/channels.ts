// src/channels.ts — turret audio-channel state machine.
//
// A real trading turret has one physical audio path per Handset and one for
// the Speaker; pressing a button on an occupied channel replaces whatever
// was there. This is a stated v1 policy, not a technical ceiling — no Web
// Audio mixing needed since multiple <audio> elements just play
// simultaneously through the OS mixer on their own.
//
// A call's channel is NOT fixed at dial time — moveCall() can reassign a
// live session to a different channel (e.g. Handset A -> Speaker) without
// touching the underlying SIP dialog at all, purely by moving which local
// <audio> element renders its remote stream. Because of this, event handlers
// below can't close over a fixed `ch` the way a simpler design would — they
// look up the session's CURRENT channel via `sessionChannel` on every fire,
// so they keep working correctly after a move.
/* eslint-disable @typescript-eslint/no-explicit-any */

// 'intercom' is a dedicated channel for direct-intercom calls only (both
// directions) — see App.tsx's handleButtonPress/newRTCSession handler. It's
// deliberately excluded from DIALABLE_CHANNEL_IDS since an operator never
// manually picks it to dial FROM; direct buttons always target it, group
// buttons still use whichever of DIALABLE_CHANNEL_IDS is selected.
export type ChannelId = 'handset_a' | 'handset_b' | 'speaker' | 'intercom';
export const CHANNEL_IDS: ChannelId[] = ['handset_a', 'handset_b', 'speaker', 'intercom'];
export const DIALABLE_CHANNEL_IDS: ChannelId[] = ['handset_a', 'handset_b', 'speaker'];

export type ChannelStatus = 'idle' | 'calling' | 'ringing' | 'connected';

// Fire-and-forget call-lifecycle pings for the console's audit/session
// history — turrets dial directly through pbx-core, so nothing else in the
// backend ever sees these calls happen otherwise. Never call-critical: a
// reporting failure must not affect the actual call (see App.tsx's wiring).
export interface CallMeta {
  kind: 'direct' | 'group';
  direction: 'outgoing' | 'incoming';
  counterpartExtension: string;
}
export interface CallEventPayload extends Partial<CallMeta> {
  type: 'start' | 'end';
  clientCallId: string;
  reason?: string;
}

export interface ChannelState {
  status: ChannelStatus;
  label: string | null; // who/what this channel is currently talking to
  muted: boolean; // local mic gated for this channel's call (mute + PTT share one toggle — see App.tsx)
  onHold: boolean; // true if either side has this channel's call on hold (SIP-level, not local mute)
}

type Listener = (states: Record<ChannelId, ChannelState>) => void;

const IDLE: ChannelState = { status: 'idle', label: null, muted: false, onHold: false };

export class ChannelManager {
  private sessions: Partial<Record<ChannelId, any>> = {};
  // Reverse lookup so a session's event handlers always know where it
  // CURRENTLY lives, even after moveCall() relocates it.
  private sessionChannel = new Map<any, ChannelId>();
  // Keyed by session object (not channel) so it naturally follows a call
  // across moveCall() without any extra bookkeeping there.
  private sessionCallId = new Map<any, string>();
  private audioEls: Record<ChannelId, HTMLAudioElement>;
  private states: Record<ChannelId, ChannelState> = {
    handset_a: { ...IDLE },
    handset_b: { ...IDLE },
    speaker: { ...IDLE },
    intercom: { ...IDLE },
  };
  private listeners = new Set<Listener>();

  constructor(private onCallEvent?: (evt: CallEventPayload) => void) {
    this.audioEls = {
      handset_a: new Audio(),
      handset_b: new Audio(),
      speaker: new Audio(),
      intercom: new Audio(),
    };
    for (const el of Object.values(this.audioEls)) el.autoplay = true;
  }

  // Browsers generally block .play() calls that aren't triggered by (or
  // don't fall within) a genuine user gesture — and the call that actually
  // needs to play, in wireSession's 'track' handler below, fires from an
  // ASYNC WebRTC event that has no direct connection to the click that
  // started the call. The fix: call .play() on all three elements once,
  // synchronously, from an ACTUAL user gesture (the login form submit) —
  // most browsers treat that as "unlocking" the element for future
  // programmatic play() calls on the same element, even async ones, for the
  // rest of the page's lifetime. Call this from App.tsx's login handler.
  primeAudio(): void {
    for (const [ch, el] of Object.entries(this.audioEls) as [ChannelId, HTMLAudioElement][]) {
      el.play().catch((err) => {
        console.warn(`[audio] priming ${ch} failed (expected if not yet interacted with the page): ${err.message}`);
      });
    }
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn({ ...this.states });
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn({ ...this.states });
  }

  getState(ch: ChannelId): ChannelState {
    return this.states[ch];
  }

  /** First idle handset, preferring A — null if both are occupied. */
  freeHandset(): ChannelId | null {
    if (this.states.handset_a.status === 'idle') return 'handset_a';
    if (this.states.handset_b.status === 'idle') return 'handset_b';
    return null;
  }

  private wireSession(ch: ChannelId, session: any, label: string, callMeta: CallMeta, initialMuted = false) {
    this.sessions[ch] = session;
    this.sessionChannel.set(session, ch);
    const clientCallId = crypto.randomUUID();
    this.sessionCallId.set(session, clientCallId);
    this.states[ch] = { status: 'calling', label, muted: initialMuted, onHold: false };
    this.emit();
    this.onCallEvent?.({ type: 'start', clientCallId, ...callMeta });

    // Every handler below re-looks-up the session's current channel and
    // verifies it's still the live occupant there — a session that's been
    // moved (moveCall) or replaced (dial/answer called again before this
    // one's async events settle) must not clobber the wrong channel's state.
    const liveChannel = (): ChannelId | null => {
      const c = this.sessionChannel.get(session);
      return c && this.sessions[c] === session ? c : null;
    };

    session.on('progress', () => {
      const c = liveChannel();
      if (!c) return;
      this.states[c] = { ...this.states[c], status: 'ringing' };
      this.emit();
    });
    session.on('confirmed', () => {
      const c = liveChannel();
      if (!c) return;
      // Applied here (not at dial/answer time) because the local mic track
      // isn't guaranteed to exist on the peer connection until negotiation
      // has actually completed — getUserMedia is async.
      if (initialMuted) this.applyMuteToSession(session, true);
      this.states[c] = { ...this.states[c], status: 'connected' };
      this.emit();
    });
    // jssip creates the RTCPeerConnection and emits 'peerconnection'
    // SYNCHRONOUSLY inside ua.call()/session.answer(), before either call
    // returns to us — by the time this function runs, that event has
    // already fired and been missed, every time, on both dial() and
    // answer(). RTCSession does expose the already-created pc via a plain
    // getter, though, and 'track' itself can't have fired yet (it needs a
    // full SDP round trip) — so grab it directly instead of racing the event.
    const pc: RTCPeerConnection | undefined = session.connection;
    const wireTrackListener = (peerconnection: RTCPeerConnection) => {
      peerconnection.addEventListener('track', (event: RTCTrackEvent) => {
        const c = liveChannel();
        if (!c) return;
        this.audioEls[c].srcObject = event.streams[0];
        this.audioEls[c].play().catch((err) => {
          console.error(`[audio] playback blocked on ${c}: ${err.message} — click anywhere on the page and try again`);
        });
      });
    };
    if (pc) {
      wireTrackListener(pc);
    } else {
      // Defensive fallback only — shouldn't happen given jssip's own
      // connect()/answer() always create the pc before returning.
      session.on('peerconnection', ({ peerconnection }: { peerconnection: RTCPeerConnection }) => {
        wireTrackListener(peerconnection);
      });
    }
    // jssip fires 'hold'/'unhold' synchronously and optimistically from
    // within hold()/unhold() itself, before the underlying re-INVITE/UPDATE
    // completes — same "update local state immediately" pattern as mute.
    // isOnHold() reports {local, remote} independently, so this reflects
    // either side holding, not just a locally-initiated hold.
    const updateHoldState = () => {
      const c = liveChannel();
      if (!c) return;
      const { local, remote } = session.isOnHold();
      this.states[c] = { ...this.states[c], onHold: local || remote };
      this.emit();
    };
    session.on('hold', updateHoldState);
    session.on('unhold', updateHoldState);
    session.on('ended', () => {
      const c = liveChannel();
      this.sessionChannel.delete(session);
      if (c) this.clear(c, 'ended');
    });
    session.on('failed', () => {
      const c = liveChannel();
      this.sessionChannel.delete(session);
      if (c) this.clear(c, 'failed');
    });
  }

  private clear(ch: ChannelId, reason = 'hangup') {
    const session = this.sessions[ch];
    if (session) {
      const clientCallId = this.sessionCallId.get(session);
      if (clientCallId) {
        this.onCallEvent?.({ type: 'end', clientCallId, reason });
        this.sessionCallId.delete(session);
      }
    }
    delete this.sessions[ch];
    this.audioEls[ch].srcObject = null;
    this.states[ch] = { ...IDLE };
    this.emit();
  }

  // Gates the local mic by disabling (not removing) the outgoing audio
  // track — the far end keeps receiving silence rather than the RTP stream
  // dropping, and it's instant to re-enable (no renegotiation needed).
  private applyMuteToSession(session: any, muted: boolean): void {
    const pc: RTCPeerConnection | undefined = session.connection;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (sender.track && sender.track.kind === 'audio') sender.track.enabled = !muted;
    }
  }

  /** One toggle serves both "mute" and "PTT" — see App.tsx's channel strip. */
  setMuted(ch: ChannelId, muted: boolean): void {
    const session = this.sessions[ch];
    if (!session) return;
    this.applyMuteToSession(session, muted);
    this.states[ch] = { ...this.states[ch], muted };
    this.emit();
  }

  /** Real SIP hold via re-INVITE, not just local mic gating — see channels.ts
   * header comment. Only valid once a session is CONFIRMED; jssip's hold()/
   * unhold() harmlessly no-op (return false) otherwise, so this is safe to
   * call from a UI gated on the same `live` check the Mute button already uses.
   * Resulting state is applied via the 'hold'/'unhold' listeners in wireSession. */
  setHold(ch: ChannelId, hold: boolean): void {
    const session = this.sessions[ch];
    if (!session) return;
    if (hold) session.hold();
    else session.unhold();
  }

  /** Dial out on a channel. Tears down whatever's already there first.
   * `initialMuted` seeds a group's PTT default (see App.tsx) — direct calls
   * never pass this, always starting talking. */
  dial(ua: any, ch: ChannelId, target: string, label: string, callMeta: CallMeta, initialMuted = false): void {
    this.hangup(ch);
    const session = ua.call(target, { mediaConstraints: { audio: true, video: false } });
    this.wireSession(ch, session, label, callMeta, initialMuted);
  }

  /** Answer an incoming session on a channel. Tears down whatever's there first. */
  answer(ch: ChannelId, session: any, label: string, callMeta: CallMeta): void {
    this.hangup(ch);
    session.answer({ mediaConstraints: { audio: true, video: false } });
    this.wireSession(ch, session, label, callMeta);
  }

  /** Move a live call to a different channel — pure local reassignment, the
   * SIP dialog/RTCPeerConnection is completely untouched. If the destination
   * is occupied, whatever's there is hung up first. */
  moveCall(from: ChannelId, to: ChannelId): void {
    if (from === to) return;
    const session = this.sessions[from];
    if (!session) return;
    if (this.sessions[to]) this.hangup(to);

    // Reattach the SAME MediaStream to the destination <audio> element —
    // nothing about the underlying call changes, just which local speaker
    // output renders it.
    this.audioEls[to].srcObject = this.audioEls[from].srcObject;
    this.audioEls[to].play().catch(() => {});
    this.audioEls[from].srcObject = null;

    const movedState = this.states[from];
    delete this.sessions[from];
    this.sessions[to] = session;
    this.sessionChannel.set(session, to);

    this.states[to] = movedState;
    this.states[from] = { ...IDLE };
    this.emit();
  }

  hangup(ch: ChannelId): void {
    const s = this.sessions[ch];
    if (s) {
      this.sessionChannel.delete(s);
      try {
        s.terminate();
      } catch {
        /* already terminating */
      }
    }
    this.clear(ch);
  }
}

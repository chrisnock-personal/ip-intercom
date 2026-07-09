// Thin wrapper over the rtpengine ng control protocol.
//
// Stations (container-sip-endpoint, intercom-endpoint) signal over WebSocket
// (JsSIP) but their MEDIA is PLAIN RTP/AVP over raw dgram sockets — no
// ICE/DTLS. The turret (a real browser) is the one WebRTC leg in this
// system: real getUserMedia + RTCPeerConnection, DTLS-SRTP mandatory. Each
// call's two legs can be a mix of either, so every rtpengine offer/answer
// call must be told which shape to produce for THAT hop — see Leg['mode'].
// rtpengine bridges DTLS-SRTP <-> plain RTP automatically; that part needs
// no special handling here beyond picking the right flags per leg.

import Client from 'rtpengine-client';
import { config } from './config';
import { MediaMode } from './sdpInspect';

const client = new (Client as any).Client();

type Dir = 'offer' | 'answer';

interface Leg {
  callId: string;
  fromTag: string;
  toTag?: string;
  sdp: string;
  mode?: MediaMode; // transport of the OUTGOING SDP for this hop; defaults to 'plain'
  // Force 'ICE-lite' onto this offer even though THIS leg's own mode is
  // 'plain' — needed when the OTHER leg of the call is webrtc but is only
  // ever shaped via a later answer() call, never its own offer() (e.g.
  // groups.ts: the one offer() call is always plain, for FreeSWITCH, but a
  // turret caller's leg — shaped later via answer() — still needs ICE-lite,
  // and 'ICE-lite' is only a valid ng key on 'offer' commands, so it has to
  // ride along on whichever offer() call exists for the whole session).
  // 'ICE-lite':'both' applies to both peers of the call regardless of which
  // leg's own SDP shape this particular offer() command is generating.
  iceLite?: boolean;
}

function baseOpts(leg: Leg) {
  return {
    'call-id': leg.callId,
    'from-tag': leg.fromTag,
    ...(leg.toTag ? { 'to-tag': leg.toTag } : {}),
    sdp: leg.sdp,
  };
}

// Anchor + relay plain RTP/AVP. `replace` makes rtpengine substitute its own
// media IP/port into the SDP so both endpoints stream to rtpengine.
const PLAIN_RTP = {
  ICE: 'remove',
  'transport-protocol': 'RTP/AVP',
  replace: ['origin', 'session-connection'],
  'rtcp-mux': ['demux'],
};

// The turret's leg: real WebRTC. Boot-tested against the running rtpengine
// (ng offer with these flags) — it correctly returns a full DTLS-SRTP SDP
// (a=fingerprint/a=setup/ICE ufrag+pwd+candidates) with no extra image config.
//
// ICE stays 'force' (that flag only controls candidate stripping/insertion —
// 'lite' is NOT a valid value for it; rtpengine logs "Unknown 'ICE' flag
// encountered: 'lite'" and silently ignores it, confirmed against this
// deployment's 10.5.3.5 daemon). "ICE lite" mode is a SEPARATE dictionary
// key, 'ICE-lite', valid only on 'offer' commands (see WEBRTC_ICE_LITE below).
//
// Needed because turret<->turret calls (two simultaneous real WebRTC/DTLS
// legs bridged through rtpengine) reproducibly broke without it: acting as a
// full ICE agent, rtpengine ran its own connectivity checks and re-picked a
// candidate pair on one leg mid-call (its own logs: "ICE negotiated: new peer
// for component 1 is ...", happening AFTER that leg's DTLS-SRTP had already
// completed) — the already-negotiated crypto context for that leg got
// orphaned, so rtpengine could still receive media on it but never again
// encrypt/send outward on it ("SRTP output wanted, but no crypto suite was
// negotiated", forever; confirmed via tcpdump: real RTP flowing in on one
// leg, never forwarded to the other). rtpengine only ever has one address of
// its own, so ICE-lite (no connectivity checks or pair re-nomination on
// rtpengine's side, candidate selection left entirely to the browser) is the
// architecturally correct mode, not a workaround.
const WEBRTC = {
  ICE: 'force',
  'transport-protocol': 'UDP/TLS/RTP/SAVPF',
  'rtcp-mux': ['offer'],
  DTLS: 'passive',
  replace: ['origin', 'session-connection'],
};

// Only valid on 'offer' — enables ICE-lite towards both the peer this offer
// goes to and the peer that sent it, covering both legs from one call.
const WEBRTC_ICE_LITE_OFFER_ONLY = { 'ICE-lite': 'both' };

function flagsFor(leg: Leg, cmd: Dir) {
  const base = leg.mode === 'webrtc' ? WEBRTC : PLAIN_RTP;
  const wantsIceLite = cmd === 'offer' && (leg.mode === 'webrtc' || leg.iceLite);
  return wantsIceLite ? { ...base, ...WEBRTC_ICE_LITE_OFFER_ONLY } : base;
}

async function ng(cmd: Dir, leg: Leg) {
  const opts = { ...baseOpts(leg), ...flagsFor(leg, cmd) };
  const res = await client[cmd](config.rtpengine.port, config.rtpengine.host, opts);
  if (res.result !== 'ok') {
    throw new Error(`rtpengine ${cmd} failed: ${JSON.stringify(res)}`);
  }
  return res.sdp as string;
}

/** Anchor the caller's SDP; returns the SDP to offer onward to the callee. */
export function offer(leg: Leg) {
  return ng('offer', leg);
}

/** Anchor the callee's answer; returns the SDP to return to the caller. */
export function answer(leg: Leg) {
  return ng('answer', leg);
}

/** Tear the media session down. */
export async function del(callId: string, fromTag: string) {
  try {
    await client.delete(config.rtpengine.port, config.rtpengine.host, {
      'call-id': callId,
      'from-tag': fromTag,
    });
  } catch {
    /* best-effort teardown */
  }
}

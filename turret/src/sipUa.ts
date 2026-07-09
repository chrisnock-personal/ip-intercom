// src/sipUa.ts — one real browser JsSIP.UA for the whole turret session.
//
// Unlike intercom-endpoint (headless Node, fakes RTCPeerConnection), this
// runs in an actual browser: real getUserMedia + RTCPeerConnection, real
// DTLS-SRTP negotiated by the browser itself. No shims, no hand-rolled RTP,
// no raw re-INVITEs for hold — JsSIP's normal session methods work natively.
import JsSIP from 'jssip';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createTurretUa(extension: string): any {
  // Same origin the page itself loaded from — nginx proxies /ws through to
  // pbx-core's plain ws://:8088 listener (see nginx.conf), so this is
  // always correct regardless of host/scheme, no server-handed config
  // needed. wss:// automatically when the page itself is HTTPS.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUri = `${proto}://${window.location.host}/ws`;
  const socket = new JsSIP.WebSocketInterface(wsUri);
  const ua = new JsSIP.UA({
    sockets: [socket],
    uri: `sip:${extension}@${window.location.hostname}`,
    // pbx-core has no SIP digest auth at all today (accepts any REGISTER
    // unconditionally) — this is a throwaway value, not a real credential.
    // The turret-login password (checked server-side, see api.ts) is a
    // separate, unrelated credential.
    password: 'turret',
    display_name: extension,
    register: true,
    register_expires: 300,
    user_agent: 'IntercomTurret/1.0',
    // Tells pbx-core's registrar this AOR's media is WebRTC (DTLS-SRTP/ICE),
    // so rtpengine bridges legs to/from this UA correctly — see
    // pbx-core/src/registrar.ts's Binding.mediaMode. NB: the correct JsSIP
    // config key is `extra_headers` (global, added to every request) — there
    // is no `register_extra_headers` key at all; using that silently did
    // nothing (JsSIP ignores unrecognized config keys), which is why this
    // header was never actually sent and every registration defaulted to
    // 'plain' — root cause of the WebRTC leg getting offered a plain-RTP SDP
    // with no DTLS, which a real browser correctly rejects with 488.
    extra_headers: ['X-Media-Mode: webrtc'],
  });
  return ua;
}

export function targetUri(extension: string): string {
  return `sip:${extension}@${window.location.hostname}`;
}

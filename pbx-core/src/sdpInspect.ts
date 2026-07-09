// Cheap SDP inspection to tell a real WebRTC leg (browser turret) apart from
// a plain-RTP leg (container-sip-endpoint / intercom-endpoint stations),
// without pbx-core needing any database access to look up an endpoint's kind.
//
// Only useful for a leg whose SDP already exists (i.e. the caller's INVITE
// body) — it CANNOT tell you the mode to use for an SDP you're about to
// generate for a callee who hasn't answered yet. For that direction, the
// mode has to be known in advance — see registrar.ts's Binding.mediaMode,
// captured from a REGISTER-time hint.
export type MediaMode = 'plain' | 'webrtc';

export function sdpMode(sdp: string | null | undefined): MediaMode {
  if (!sdp) return 'plain';
  return sdp.includes('a=ice-ufrag') || sdp.includes('a=fingerprint') ? 'webrtc' : 'plain';
}

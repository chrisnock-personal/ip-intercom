export const config = {
  drachtio: {
    host: process.env.DRACHTIO_HOST || '127.0.0.1',
    port: parseInt(process.env.DRACHTIO_PORT || '9022', 10),
    secret: process.env.DRACHTIO_SECRET || 'cymru',
  },
  rtpengine: {
    host: process.env.RTPENGINE_HOST || '127.0.0.1',
    port: parseInt(process.env.RTPENGINE_PORT || '22222', 10),
  },
  // How we tell an endpoint to pick up instantly. container-sip-endpoint should
  // watch for either of these on an inbound INVITE and auto-accept.
  //
  // Call-Info's ABNF requires a <uri> before any ;params (RFC 3261 §20.9) —
  // a bare ';answer-after=0' is malformed. drachtio-server's SIP stack
  // silently drops a malformed well-known header when building the B2BUA'd
  // INVITE, and empirically took Alert-Info down with it too (boot-tested:
  // fixing just this one line was enough to make auto-answer work at all).
  autoAnswerHeaders: {
    'Call-Info': '<sip:pbx-core@ip-intercom.local>;answer-after=0', // Polycom/Cisco-style
    'Alert-Info': '<urn:alert:service:auto-answer>',
  },

  // createB2BUA doesn't synthesize a Contact header for the leg it originates
  // — RFC 3261 requires every INVITE to carry one, and JsSIP-based endpoints
  // (container-sip-endpoint / intercom-endpoint) reject a Contact-less INVITE
  // outright with 500 "unable to create a Dialog without Contact header
  // field". The literal host here doesn't need to be reachable: drachtio owns
  // the actual socket-level routing for dialogs it originates, same as how
  // JsSIP's own bogus `*.invalid` WS contact hosts work on the other side.
  ownContact: '<sip:pbx-core@ip-intercom.local>',
  // Dial-plan conventions for the prototype.
  //   direct intercom : dial a registered AOR/extension directly
  //   group intercom  : dial an id in the GROUP_PREFIX namespace (Phase 2)
  groupPrefix: process.env.GROUP_PREFIX || '*8',

  // FreeSWITCH — pure media resource for group open-mic (mod_conference).
  // pbx-core B2BUAs a group INVITE here; FreeSWITCH's own dialplan answers
  // and joins the destination_number into a conference room of the same name.
  // No ESL/floor-control wiring needed: PTT mute is done at the SIP endpoint
  // (sendonly RTP via /api/hold), so the mixer just mixes whatever it receives.
  freeswitch: {
    host: process.env.FREESWITCH_HOST || '127.0.0.1',
    port: parseInt(process.env.FREESWITCH_PORT || '5080', 10),
  },

  // Read-only HTTP introspection (registrations + in-progress calls) for
  // controller-backend's "Live" view to poll. See admin.ts.
  admin: {
    port: parseInt(process.env.PBX_ADMIN_PORT || '9080', 10),
  },
};

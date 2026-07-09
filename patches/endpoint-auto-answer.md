Header-driven auto-answer for container-sip-endpoint
====================================================

Why
---
sipManager.js already has auto-answer, but it's a global toggle
(`this.autoAnswer.enabled`) that answers *every* inbound call. For an intercom
you want the PBX to decide per-call, so a normal call still rings while an
intercom call is picked up instantly. The pbx-core injects one of:

    Call-Info: <sip:...>;answer-after=0
    Alert-Info: <urn:alert:service:auto-answer>

This patch makes the endpoint auto-answer when it sees either marker, in
addition to the existing global toggle.

Where
-----
backend/sipManager.js, inside `_handleNewSession()`, the incoming branch.
Find this existing block:

    // Auto-answer if enabled
    if (this.autoAnswer.enabled) {
      const delay = this.autoAnswer.delayMs || 0;
      this._log('info', `Auto-answer in ${delay}ms`);
      setTimeout(() => {
        if (this.incomingCall) {
          const callId = require('uuid').v4();
          this.answerCall(callId).catch(err => this._log('error', `Auto-answer failed: ${err.message}`));
        }
      }, delay);
    }

Replace it with:

    // Auto-answer: global toggle OR a per-call intercom header from the PBX.
    const intercomHdr =
      (inviteRequest?.getHeader && (
        /answer-after\s*=\s*0/i.test(inviteRequest.getHeader('Call-Info') || '') ||
        /auto-?answer/i.test(inviteRequest.getHeader('Alert-Info') || '')
      ));
    if (this.autoAnswer.enabled || intercomHdr) {
      const delay = intercomHdr ? 0 : (this.autoAnswer.delayMs || 0);
      this._log('info', `Auto-answer (${intercomHdr ? 'intercom header' : 'global'}) in ${delay}ms`);
      setTimeout(() => {
        if (this.incomingCall) {
          const callId = require('uuid').v4();
          this.answerCall(callId).catch(err => this._log('error', `Auto-answer failed: ${err.message}`));
        }
      }, delay);
    }

Notes
-----
- `inviteRequest` is already in scope in that branch (`session._request`).
- JsSIP's `getHeader()` returns the raw header value or undefined — the guards
  above handle both.
- No REST or build changes needed; rebuild the endpoint image as usual.
- To point the endpoint at pbx-core instead of Asterisk, just change the
  registration target — POST /api/register with:
      { "server": "<pbx-core-host>", "username": "1001", "password": "...",
        "transport": "WS", "wsPort": 8088, "wsPath": "/ws" }
  (Align wsPath with what drachtio's WS transport serves; default SofiaSIP
   path is "/". If registration doesn't complete, try wsPath "/".)

PTT (later)
-----------
For direct intercom, PTT-mute can reuse the endpoint's existing hold path
(`/api/hold` sends a=sendonly) as a stop-transmitting toggle. For group
open-mic, prefer server-side mute in the mixer (Phase 2) for clean floor
control rather than per-endpoint hold.

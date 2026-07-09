// Handles in-dialog re-INVITEs (hold/resume, or any other mid-call SDP
// change) on an already-established B2BUA'd call — direct or group.
//
// drachtio-srf's built-in 'hold'/'unhold' events are unusable for this: they
// only fire if explicitly listened for, and even then drachtio-srf sends the
// 200 OK itself using its own stale cached SDP before we'd get a chance to
// re-anchor through rtpengine or forward anything to the other leg. Only
// 'modify' hands us the raw req/res and lets us control the actual response
// — and per drachtio-srf's Dialog#handle(), 'modify' is exactly what fires
// for ANY re-INVITE as long as 'hold'/'unhold'/'refresh' have zero listeners
// (each of those is only classified as such when a listener exists for it).
// So: listen for 'modify' only, on both B2BUA legs, and treat every re-INVITE
// uniformly — there's no need to special-case hold vs. unhold vs. anything
// else once you're doing a real reoffer/forward/reanswer cycle regardless.
import * as rtp from './rtpengine';
import { config } from './config';
import { MediaMode } from './sdpInspect';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ReinviteParams {
  callId: string;
  callerTag: string; // the real SIP fromTag (caller/uas side)
  calleeTag: string;  // the synthetic toTag ('callee' or 'fs') used since initial setup
  callerMode: MediaMode;
  calleeMode: MediaMode;
}

/** Wire 'modify' handling on both B2BUA legs so a re-INVITE from EITHER
 * party (caller or callee/FreeSWITCH) gets genuinely re-anchored through
 * rtpengine and forwarded to the other leg, instead of drachtio-srf silently
 * auto-answering with stale SDP. */
export function wireReinviteHandling(uas: any, uac: any, p: ReinviteParams): void {
  uas.on('modify', (req: any, res: any) =>
    handleModify(uac, p.callId, p.callerTag, p.calleeTag, p.calleeMode, p.callerMode, req, res));
  uac.on('modify', (req: any, res: any) =>
    handleModify(uas, p.callId, p.calleeTag, p.callerTag, p.callerMode, p.calleeMode, req, res));
}

/** `other` is whichever leg did NOT receive the re-INVITE. `incomingTag`/
 * `otherMode` describe the party that DID (their new SDP, and the shape
 * `other` needs to see); `otherTag`/`incomingMode` describe `other` itself
 * and the shape to hand back to whoever re-INVITEd — same offer/answer
 * roles the original call setup uses, just symmetric so either leg can be
 * "incoming" here, not only the caller. */
async function handleModify(
  other: any,
  callId: string, incomingTag: string, otherTag: string,
  otherMode: MediaMode, incomingMode: MediaMode,
  req: any, res: any,
): Promise<void> {
  try {
    // 1. Anchor the new SDP under the re-INVITEing party's tag, shaped for
    //    what the OTHER party needs to see.
    const sdpForOther = await rtp.offer({ callId, fromTag: incomingTag, sdp: req.body, mode: otherMode });
    // 2. Forward it as a real re-INVITE to the other leg, get their answer.
    const otherAnswerSdp: string = await other.modify(sdpForOther, {});
    // 3. Anchor that answer, shaped for the re-INVITEing party, and reply.
    const sdpForIncoming = await rtp.answer({ callId, fromTag: incomingTag, toTag: otherTag, sdp: otherAnswerSdp, mode: incomingMode });
    res.send(200, { body: sdpForIncoming, headers: { Contact: config.ownContact, 'Content-Type': 'application/sdp' } });
  } catch (err: any) {
    // Per JsSIP's own hold()/unhold() semantics, a non-2xx reply here makes
    // the ORIGINATING side auto-terminate the whole call, not just fail the
    // hold — that's existing client behavior, not something to work around.
    console.error(`modify (hold/resume) failed for call ${callId}:`, err?.message || err);
    res.send(488);
  }
}

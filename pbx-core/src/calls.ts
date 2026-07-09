// Minimal in-memory registry of calls currently in progress. Same style as
// registrar.ts: no persistence, wiped for free on process restart (unlike
// FreeSWITCH's own conference-member state, this Map *is* pbx-core's state,
// so there's no stale-entry risk if pbx-core itself crashes/restarts).
// Populated purely for the console's "Live" view — nothing here feeds SIP
// routing decisions.

export interface CallInfo {
  callId: string;
  kind: 'direct' | 'group';
  from: string;       // caller extension
  to: string;         // callee extension, or group dial code
  startedAt: number;  // epoch ms
}

const calls = new Map<string, CallInfo>();

export function start(info: CallInfo): void {
  calls.set(info.callId, info);
}

export function end(callId: string): void {
  calls.delete(callId);
}

export function all(): CallInfo[] {
  return [...calls.values()];
}

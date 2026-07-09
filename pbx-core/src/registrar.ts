// Minimal in-memory location service. Good enough to prototype; swap for a
// Redis/Postgres-backed store when you want persistence + multi-instance.

export interface Binding {
  aor: string;          // e.g. sip:1001@intercom.lab
  contact: string;      // the endpoint's contact URI
  source: string;       // protocol/ip:port drachtio saw the REGISTER from
  transport: string;    // 'ws' | 'wss' | 'udp' | 'tcp' — signalling only.
  // Media transport hint, captured from the REGISTER's X-Media-Mode header
  // (defaults to 'plain'). Needed because rtpengine.ts's offer() has to know
  // the CALLEE's media mode before the callee has sent any SDP back — a
  // caller's mode can be sniffed from their INVITE body (see sdpInspect.ts),
  // but there's no SDP to sniff for the leg you're about to generate.
  mediaMode: 'plain' | 'webrtc';
  expiresAt: number;    // epoch ms
}

const bindings = new Map<string, Binding>();

export function upsert(b: Omit<Binding, 'expiresAt'>, expiresSecs: number): void {
  if (expiresSecs <= 0) {
    bindings.delete(b.aor);
    return;
  }
  bindings.set(b.aor, { ...b, expiresAt: Date.now() + expiresSecs * 1000 });
}

export function lookup(aor: string): Binding | undefined {
  const b = bindings.get(aor);
  if (!b) return undefined;
  if (b.expiresAt < Date.now()) {
    bindings.delete(aor);
    return undefined;
  }
  return b;
}

export function all(): Binding[] {
  const now = Date.now();
  return [...bindings.values()].filter((b) => b.expiresAt >= now);
}

/** Normalise a request URI down to a bare AOR key (user@host, no params). */
export function aorKey(uri: string): string {
  const m = uri.match(/sips?:([^@;>]+@[^;>]+)/i);
  return m ? `sip:${m[1]}` : uri;
}

/** Extract just the user part (extension) from a SIP URI/AOR, e.g.
 * "sip:2001@intercom.lab" -> "2001". Falls back to the input unchanged if
 * it doesn't look like a SIP URI (e.g. it's already a bare extension). */
export function extOf(uri: string): string {
  const m = uri.match(/sips?:([^@;>]+)@/i);
  return m ? m[1] : uri;
}

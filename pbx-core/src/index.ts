import Srf from 'drachtio-srf';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import registrationParser = require('drachtio-mw-registration-parser');
import { config } from './config';
import { upsert, all, aorKey } from './registrar';
import { registerGroupIntercom } from './groups';
import { registerDirectIntercom } from './intercom';
import { startAdminServer } from './admin';

const srf = new Srf();

srf.connect(config.drachtio);
startAdminServer(config.admin.port);

// Populates req.registration on REGISTER requests — drachtio-srf's own type
// definitions declare that shape (SrfRequest.registration) but drachtio-srf
// itself never populates it; that's this separate middleware's job. Without
// it, req.registration is always undefined and the handler below throws.
srf.use(registrationParser);

srf.on('connect', (err: Error | null, hostport: string) => {
  if (err) return console.error('drachtio connect error:', err);
  console.log(`pbx-core connected to drachtio at ${hostport}`);
});
srf.on('error', (err: Error) => console.error('srf error:', err));

// ---- Registrar -----------------------------------------------------------
// drachtio parses REGISTER into req.registration for us.
// NB: must be the `.register()` verb-shorthand, not `srf.on('register', ...)`.
// drachtio-srf only calls its internal client.route('register') — which is
// what tells drachtio's C++ core to actually forward REGISTER requests to
// this app instead of auto-responding 503 itself — when a verb is registered
// via `.use()`/the verb-shorthand methods. `.on()` is a plain EventEmitter
// listener that never touches routing, so it silently never fires. The
// `Srf` type definitions don't declare `.register()` (only `.invite()` is
// typed), even though it exists at runtime same as every other SIP verb
// (see drachtio-srf/lib/connect.js's dynamic method generation) — cast to
// `any` here rather than switching back to the broken `.on()` form.
(srf as any).register((req: any, res: any) => {
  const reg = req.registration; // { type, expires, contact: [{uri,...}], aor }
  const aor = aorKey(reg.aor);
  const transport = req.protocol; // 'ws' | 'wss' | 'udp' | 'tcp'
  const source = `${req.protocol}/${req.source_address}:${req.source_port}`;
  // Real browser turrets send this to flag a WebRTC (DTLS-SRTP/ICE) leg —
  // see registrar.ts's Binding.mediaMode for why this can't just be sniffed
  // from SDP at call time. Anything that doesn't send it (every existing
  // station) defaults to 'plain', fully backward-compatible.
  const mediaMode = req.get('X-Media-Mode') === 'webrtc' ? 'webrtc' : 'plain';

  upsert(
    { aor, contact: reg.contact[0].uri, source, transport, mediaMode },
    reg.type === 'unregister' ? 0 : reg.expires,
  );

  console.log(`REGISTER ${reg.type} ${aor} (${transport}) exp=${reg.expires}`);
  res.send(200, {
    headers: {
      Contact: req.get('Contact'),
      Expires: reg.expires,
    },
  });
});

// ---- Routing -------------------------------------------------------------
// Order matters: group handler returns early for non-group URIs, direct
// handler returns early for group URIs. Register groups first.
registerGroupIntercom(srf);   // Phase 2 stub — answers *8… ids
registerDirectIntercom(srf);  // Phase 1 — direct AOR-to-AOR intercom

// ---- Ops -----------------------------------------------------------------
setInterval(() => {
  const n = all().length;
  if (n) console.log(`registered endpoints: ${n}`);
}, 30_000);

process.on('SIGTERM', () => { srf.disconnect(); process.exit(0); });

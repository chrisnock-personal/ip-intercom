// Minimal read-only HTTP introspection server — no framework dependency,
// just Node's built-in http, for the one thing the console's "Live" view
// needs: what's registered right now, and what calls are in progress right
// now. Deliberately does not touch SIP routing or persist anything; pbx-core
// stays database-free exactly as before.

import { createServer } from 'http';
import * as registrar from './registrar';
import * as calls from './calls';

export function startAdminServer(port: number): void {
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ registrations: registrar.all(), calls: calls.all() }));
      return;
    }
    res.writeHead(404);
    res.end();
  }).listen(port, () => console.log(`admin HTTP listening on :${port}`));
}

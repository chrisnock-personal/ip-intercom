# Container IP Intercom

A container-based IP intercom with **direct** (point-to-point) and **group**
(open-mic + PTT) calling, a **custom TypeScript PBX core** (drachtio +
rtpengine), a real-browser **WebRTC softphone** ("turret", modeled on a
trading-desk turret), and an admin **controller console** for directory
users, groups, live status, health, audit, and database backup. Built for a
**routed / multi-subnet** deployment.

```
turret (browser: getUserMedia/RTCPeerConnection, wss:// or ws:// via nginx)
      │ SIP/WS (WebRTC media, DTLS-SRTP)
      ▼
   pbx-core (drachtio + TS)  ◀─ ng ─▶  rtpengine (media anchor; bridges DTLS-SRTP ↔ plain RTP)
      │ group calls (*8<code>) B2BUA'd to ▼
   freeswitch (mod_conference open-mic mixer)

controller-frontend (nginx: console + /turret/ + /ws proxy, HTTP+HTTPS)
                                                  ──/api/v1──▶ controller-backend
                                                                (Express+TS, Postgres)
```

Six compose services: `postgres`, `controller-backend`, `controller-frontend`
(also serves the turret at `/turret/`), `pbx-core`, `rtpengine`, `freeswitch`.

## Screenshots
<img width="806" height="709" alt="Image" src="https://github.com/user-attachments/assets/8303f000-b91e-44af-9d4f-048e5aab5b8f" />
<br>
<img width="1169" height="959" alt="Image" src="https://github.com/user-attachments/assets/5ff5b03c-87df-4565-b258-da077731dd2f" /><br>
<img width="1169" height="959" alt="Image" src="https://github.com/user-attachments/assets/1380e9f6-4454-46c2-8348-d31b81dd0813" /><br>
<img width="1169" height="959" alt="Image" src="https://github.com/user-attachments/assets/78be5a90-a6b2-4580-9e5a-92e42d4a4555"/><br>
<img width="1174" height="896" alt="Image" src="https://github.com/user-attachments/assets/08cc2e70-3216-43cd-baeb-8fe4c050febc" /><br>

``

## What's implemented

### Calling
- **Direct intercom** — dial a registered extension; pbx-core injects an
  auto-answer header (`Call-Info`/`Alert-Info`) and anchors media through
  rtpengine. Real SIP **hold/resume** (a genuine re-INVITE, not just local
  mute) works both directions of a call.
- **Group open-mic** — pbx-core B2BUAs a group call (`*8<dial_code>`)
  straight to FreeSWITCH, which joins it into a `mod_conference` room of the
  same name. Every unmuted member hears every other one — no custom mixing
  logic. PTT floor control is done client-side (gating the local mic track),
  not at the mixer.
- **turret/** — the only endpoint type in this system: a real-browser
  softphone (genuine `getUserMedia`/`RTCPeerConnection`, no headless shims)
  modeled on a trading voice turret. Three independent audio channels
  (Handset A, Handset B, Speaker) plus a dedicated Intercom channel with a
  configurable auto-answer toggle, driven by a **directory user** login
  (extension + password, a hot-desk model — not tied to one physical
  device). Click-to-arm channel selection for group calls, move a live call
  between channels mid-call, per-channel hold/resume and mute/PTT.
- rtpengine bridges a genuine WebRTC leg (the turret) to plain RTP
  (FreeSWITCH) automatically — including the trickier case of **two**
  simultaneous WebRTC legs (turret↔turret), which needed its own
  `ICE-lite` handling distinct from the single-WebRTC-leg case.

### Controller console
- **Live** — real registered turrets and in-progress calls, polled
  straight from pbx-core's own in-memory state (pbx-core has no database
  by design; a small admin HTTP endpoint on pbx-core exposes this, enriched
  with friendly names by the controller). Call-type badges (ICM/GRP-ICM)
  and per-type metrics.
- **Groups** / **Directory Users** — full CRUD (create/edit/delete), button
  assignments (direct or group targets) per directory user.
- **Health** (admin only) — host CPU/mem/disk, DB size/stats, endpoint
  statuses, pbx-core reachability, and a live container-log viewer (reads
  other containers' logs over the podman API socket).
- **Audit** (admin only) — searchable history of `audit_log` (who did what,
  when — logins, CRUD, call start/end, PTT grants, including turret-placed
  calls).
- **Database** (admin only) — `pg_dump` backup download, restore from an
  uploaded dump, `VACUUM ANALYZE`, table size/bloat stats, retention/purge
  for `audit_log`/`intercom_sessions`, and gzip archive + optional SCP
  transfer.
- Users / JWT / RBAC (viewer/editor/admin), append-only audit log,
  background endpoint health polling — conventions deliberately mirror
  Chris's Walk the Nxt Floor project (`pg` pool, numbered migrations, JWT
  roles, `audit_log` shape).

### Media images are built locally, not pulled
Both media components are built from Dockerfiles under `images/` rather
than pulled as pre-built images, because the obvious public images don't
work: SignalWire's FreeSWITCH image is behind an auth-gated registry, and
the only `:latest` rtpengine on Docker Hub is ~5 years old.

- **`images/rtpengine`** installs `rtpengine-daemon` from the Debian
  bookworm package and runs it **userspace-only** (`--table=-1`) so it
  needs no kernel module in the container.
- **`images/freeswitch`** builds `FROM drachtio/drachtio-freeswitch-base`,
  overlaying a minimal `modules.conf`, a `sofia.conf` including our SIP
  profile, the intercom SIP profile + dialplan, and an open-mic conference
  profile. The profile's bind IP is set explicitly via `FREESWITCH_BIND_IP`
  (see `entrypoint.sh`) rather than FreeSWITCH's own `$${local_ip_v4}`
  auto-detection — on a multi-homed host, that auto-detection can pick a
  different interface than the one pbx-core is configured to dial, which
  silently breaks every group call.

## Run it (podman-compose)
```bash
cp .env.example .env
# edit .env: set RTPENGINE_PUBLIC_IP to this host's routed/LAN IP,
# and change JWT_SECRET / ADMIN_PASSWORD / DRACHTIO_SECRET

podman-compose up -d --build
```
- Controller UI: `http://<host>:8080` or `https://<host>:8443` — sign in
  with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.
- Turret: `http://<host>:8080/turret/` (localhost only — `getUserMedia`
  needs a secure context, and `localhost` is browser-exempted) or
  `https://<host>:8443/turret/` (works from a genuinely separate machine
  too, once you click through the self-signed cert warning once per
  browser — see "TLS" below).
- Controller API: `http://<host>:3100/api/v1/...`
- pbx-core SIP/WS: `<host>:8088`, SIP UDP/TCP on `:5060`.
- Postgres: exposed on host `5433` for direct inspection if needed.

`pbx-core`, `rtpengine`, and `freeswitch` run with `network_mode: host` —
required so rtpengine can anchor media reachably for endpoints on other
subnets in a routed deployment.

### Optional: the Health page's log viewer
The console's Health page can show live logs from every container over the
podman API socket. This needs one host-level prerequisite (rootless
podman):
```bash
systemctl --user enable --now podman.socket
```
On SELinux-enforcing hosts (Fedora/RHEL), `controller-backend` also runs
with `security_opt: label:disable` in `docker-compose.yml` — SELinux
denies a confined container from connecting to the podman socket even with
the file permissions otherwise correct, and no stock boolean covers that
specific case. This widens that one container's blast radius (full
control-plane visibility into every container on the host, not just this
project's 6) — accepted deliberately for this lab; skip the log viewer
entirely if you'd rather not take that tradeoff.

### TLS
`controller-frontend` generates a self-signed cert on first start
(persisted in a volume, so it survives redeploys — no new warning every
time) and serves both plain HTTP (`:8080`) and HTTPS (`:8443`) side by
side; nothing extra to configure beyond `RTPENGINE_PUBLIC_IP` already
being set in `.env` (reused as the cert's SAN entry). The turret's SIP/WS
signaling is proxied through the same nginx at `/ws`, so it always
connects back to whichever origin the page itself loaded from — no
separate host/port to hand it. First visit over HTTPS: click through the
browser's self-signed-certificate warning once (per browser/device).

### Setting up a turret
1. Console → **Directory Users** panel → create a person (name, extension,
   turret-login password), then add them a direct button (target
   extension) and/or a group button.
2. Open `http://localhost:8080/turret/`, log in with the extension +
   turret password.
3. Press a button — direct buttons auto-connect instantly (pbx-core's
   auto-answer headers); group buttons join that group's FreeSWITCH
   conference on whichever channel is currently armed (click an idle
   Handset/Speaker strip to arm it before pressing a group button). Press
   the same button again to hang up.
4. Testing two turrets on **one machine**: use genuinely separate browser
   contexts (an Incognito window, or a different browser) — duplicated
   tabs share `sessionStorage` and will fight over the same login.

### Testing a group (open-mic)
1. Console → **Groups** panel → create a group (mode *Talkback* for
   open-mic, *Announce* for one-way paging). Dial code defaults to a slug
   of the name.
2. Tick which endpoints/directory users are members via their button
   assignments, or add a group button to a directory user directly.
3. Have a turret press the group button — pbx-core routes `*8<dial_code>`
   to FreeSWITCH, which joins every talking member into the same
   conference. Everyone unmuted hears everyone else.

## Repo layout
```
docker-compose.yml          — full stack (this is what you run)
.env.example                — copy to .env and fill in
pod.yaml                    — alternative: podman play kube (pbx-core+rtpengine only)
migrations/                 — controller's numbered SQL migrations
controller/
  backend/                  — Express API: auth, endpoints, groups, intercom,
                               directory users, turret login, system health/
                               audit/logs, admin db backup/restore
  frontend/                 — console (Vite/React, built + served by nginx) —
                               its Containerfile also builds turret/ as a
                               second stage, served at /turret/;
                               entrypoint.sh generates a self-signed TLS
                               cert on first start
turret/                     — real-browser trading-turret softphone (Vite/
                               React/TS): genuine getUserMedia/
                               RTCPeerConnection, 2 Handsets + 1 Speaker +
                               Intercom channel, directory-user login
pbx-core/                   — drachtio SIP core: registrar, direct/group
                               routing, rtpengine wrapper, admin status API
images/
  rtpengine/                — rtpengine media relay image (Debian package, userspace mode)
  freeswitch/                — group open-mic mixer image (FROM drachtio FS base + conf overlay)
patches/
  endpoint-auto-answer.md   — reference notes for the separate, unrelated
                               container-sip-endpoint sibling project
```

## Notes / knobs
- SIP registration is authless and the controller's endpoint REST calls are
  unauthenticated by default (lab prototype) — add SIP digest auth and
  endpoint-side API tokens before this leaves the lab.
- TLS is self-signed (see "TLS" above) — fine for a private LAN lab, but
  every browser/device needs its own one-time trust exception. Swap in a
  real cert by mounting it over `/etc/nginx/tls/{cert,key}.pem` if you
  ever have one (e.g. an internal CA).
- `HEALTH_INTERVAL_MS` / retention are env-configurable on
  `controller-backend`, same pattern as Walk the Nxt Floor's
  `sipHealthService`.
- Local dev without containers: `cd controller/backend && npm install &&
  npm run dev` needs `PGHOST`/`PGPORT` etc pointed at a reachable Postgres;
  note `migrate.ts`'s `MIGRATIONS_DIR` assumes the container layout —
  adjust the relative path if running straight from `src/`.

## Roadmap
- **Handset A/B repurposed for real SIP extensions on an external PBX** —
  a shared-line-appearance pattern (global `lines`, many-to-many
  assignment to directory users, "capture" pickup from the turret UI).
  Large future scope, detailed design notes in `CLAUDE.md`, not yet
  designed in full.
- **Announce-zone listen-only members** aren't dialled out yet (only
  talkers are).
- **API keys, WebSocket live session streaming, SIP digest auth** — none
  built yet.
- A turret joining a group call via its Speaker channel specifically
  (each half — turret↔turret and turret-in-group — verified
  independently, not yet together), and 3 simultaneous channels active at
  once on one turret, haven't been explicitly exercised.

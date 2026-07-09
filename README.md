# Container IP Intercom

A container-based IP intercom: **custom TypeScript PBX core** (drachtio +
rtpengine), a **controller** (backend + patch-bay frontend) for users, audit,
endpoint health, and session orchestration, and integration notes for your
existing **container-sip-endpoint**. Open-mic by default with a PTT option,
built for a **routed / multi-subnet** deployment.

```
┌──────────────────────────┐        ┌──────────────────┐
│  controller-frontend      │  API   │ controller-backend│
│  patch-bay UI (nginx)     │◄──────►│ users, audit,     │
└──────────────────────────┘        │ endpoint registry, │
                                     │ health poll,       │
                                     │ session orchestration
                                     └─────────┬──────────┘
                                               │ drives each endpoint's
                                               │ own REST API (/api/call, …)
                                               ▼
  container-sip-endpoint × N   (JsSIP: SIP-over-WS signalling + PLAIN RTP media)
        │ SIP/WS :8088                     │ RTP/AVP (dgram)
        ▼                                  ▼
   ┌──────────────────────────┐      ┌──────────────────┐
   │  pbx-core (drachtio)     │◄────►│    rtpengine     │
   │  registrar, B2BUA,       │  ng  │  anchor / relay  │
   │  intercom routing        │      │  plain RTP       │
   └──────────────────────────┘      └──────────────────┘
```

## What's implemented

### Phase 1 — direct intercom
- **pbx-core** — drachtio SIP registrar + B2BUA. Dial a registered AOR → callee
  gets an auto-answer header (`Call-Info`/`Alert-Info`), media anchored via
  rtpengine as **plain RTP/AVP** (container-sip-endpoint rejects ICE/DTLS, so no
  WebRTC bridging is used).

### Phase 2 — group open-mic + PTT floor
- **freeswitch** — a pure media resource. pbx-core B2BUAs a group call
  (`*8<dial_code>`) straight to FreeSWITCH; FreeSWITCH's own dialplan answers
  and joins the destination number into a `mod_conference` room of the same
  name (`freeswitch/dialplan/intercom.xml`, `freeswitch/autoload_configs/conference.conf.xml`).
  mod_conference's default behaviour already **is** open-mic — every unmuted
  participant hears every other one — so there's no custom mixing logic.
- **PTT floor control has no server-side mute.** Muting a participant reuses
  the same mechanism as direct-call hold: a re-INVITE to `a=sendonly` on that
  endpoint's own leg (`/api/hold` / `/api/resume`). A muted leg simply stops
  sending RTP, so the mixer naturally excludes it. This was a deliberate
  simplification over ESL/drachtio-fsmrf floor control — much less to build
  and test, at the cost of mute being endpoint-driven rather than
  controller-driven-at-the-mixer. If you later need a moderator who can force-
  mute someone else's mic irrespective of that endpoint's cooperation, that's
  the point where ESL control becomes worth the added complexity.
- **controller-backend** — group CRUD (`routes/groups.ts`, `services/groupService.ts`):
  create a group, add/remove members, flag members `can_talk: false` for
  listen-only (announce zones). `pbxService.startGroup()` dials every talking
  member's own endpoint into the group's conference extension.
- **controller-frontend** — a Groups panel: create a group, tick which
  endpoints are members, **Start** dials every talking member in. Active
  sessions (direct or group) expand to show participants, each with a
  **Talk/Mute** button that drives the PTT floor.

### Common (both phases)
- **controller-backend** — Express + PostgreSQL, styled after your Walk the
  Nxt Floor conventions: `pg` pool with `query`/`queryOne`/`withTransaction`,
  numbered SQL migrations tracked in `schema_migrations`, JWT auth with
  viewer/editor/admin roles, an append-only `audit_log`, and a background
  health poller (`intercom_endpoint_health_log`, pruned on a retention window)
  that hits each endpoint's `/api/status`.
- **controller-frontend** — a patch-bay console: click a jack to set the
  caller, shift-click to set the callee, start/end sessions, see live
  online/offline status and latency per endpoint.

### Media images are built locally, not pulled
Both media components are built from Dockerfiles under `images/` rather than
pulled as pre-built images, because the obvious public images don't work:
SignalWire's FreeSWITCH image is behind an auth-gated registry, and the only
`:latest` rtpengine on Docker Hub is ~5 years old. So:

- **`images/rtpengine`** installs `rtpengine-daemon` from the Debian bookworm
  package (no source build, no gated repo) and runs it **userspace-only**
  (`--table=-1`) so it needs no kernel module in the container.
- **`images/freeswitch`** builds `FROM drachtio/drachtio-freeswitch-base`
  (which compiles FreeSWITCH 1.10.x from source with `mod_conference` +
  `mod_sofia`), then overlays a minimal `modules.conf`, a `sofia.conf` that
  includes our SIP profile, the intercom SIP profile + dialplan, and an
  open-mic conference profile. Default vanilla profiles (`internal`/`external`)
  are removed so nothing else claims port 5080.

I could not boot-test either image here (no container runtime / network in the
build environment). They're written against confirmed package names and the
documented drachtio base layout, but the honest first-boot checks are:
```bash
podman logs intercom-rtpengine        # should show it binding the ng port
podman logs intercom-freeswitch
podman exec -ti intercom-freeswitch /usr/local/freeswitch/bin/fs_cli -x "sofia status"
podman exec -ti intercom-freeswitch /usr/local/freeswitch/bin/fs_cli -x "conference list"
```
If FreeSWITCH's base tag has shifted its config layout, the fix is almost
always a path nudge in `images/freeswitch/Containerfile` — the overlay files
themselves are standard FreeSWITCH XML.

## Run it (podman-compose)
```bash
cp .env.example .env
# edit .env: set RTPENGINE_PUBLIC_IP to this host's routed/LAN IP,
# and change JWT_SECRET / ADMIN_PASSWORD / DRACHTIO_SECRET

podman-compose up -d --build
```
- Controller UI: `http://<host>:8080` — sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.
- Controller API: `http://<host>:3100/api/v1/...`
- pbx-core SIP/WS: `<host>:8088` (matches container-sip-endpoint's default `register()` target), SIP UDP/TCP on `:5060`.
- Postgres: exposed on host `5433` for direct inspection if needed.

`pbx-core` and `rtpengine` run with `network_mode: host` — this is required so
rtpengine can anchor media reachably for endpoints on other subnets; it's not
optional for the routed deployment you asked for.

### Registering endpoints
1. In the UI (or via `POST /api/v1/endpoints`), add each container-sip-endpoint
   station: `name`, `aor` (e.g. `sip:1001@intercom.lab`), `rest_url` (e.g.
   `http://192.168.1.20:3000`), `kind: station`.
2. Point each container-sip-endpoint at pbx-core instead of Asterisk:
   ```bash
   curl -X POST http://<endpoint-host>:3000/api/register -H 'Content-Type: application/json' \
     -d '{"server":"<pbx-core-host>","username":"1001","password":"x","transport":"WS","wsPort":8088,"wsPath":"/ws"}'
   ```
3. Apply `patches/endpoint-auto-answer.md` to `sipManager.js` and rebuild that
   image so the callee auto-answers on the PBX's intercom header.
4. In the console, click one jack (caller), shift-click another (callee),
   **Start intercom call**.

### Testing a group (open-mic)
1. In the console's **Groups** panel, create a group (e.g. "Floor A", mode
   *Talkback*). Its dial code defaults to a slug of the name (`floor-a`).
2. Tick which endpoints are members. All are talking members by default.
3. Click **Start "Floor A"** — the controller tells each talking member's own
   endpoint to dial `*8floor-a`; pbx-core routes that to FreeSWITCH, which
   joins them into the same conference room. Every unmuted member hears every
   other one.
4. To end it, find the session in the **Sessions** list and click **End**.

### Using PTT (push-to-talk floor)
Any active session (direct or group) expands in the **Sessions** list to show
its participants. Each has a **Mute**/**Talk** toggle: **Mute** re-INVITEs that
station's leg to `sendonly` (via its `/api/hold`) so it stops transmitting into
the mix; **Talk** resumes it. Open-mic is simply the state where everyone is on
**Talk**.

## Repo layout
```
docker-compose.yml          — full stack (this is what you run)
.env.example                — copy to .env and fill in
pod.yaml                    — alternative: podman play kube (pbx-core+rtpengine only)
migrations/                 — controller's numbered SQL migrations
controller/
  backend/                  — Express API (users, audit, endpoints, groups, health, sessions)
  frontend/                 — patch-bay console (Vite/React, built + served by nginx)
pbx-core/                   — drachtio SIP core + rtpengine wrapper + FreeSWITCH group routing
images/
  rtpengine/                — rtpengine media relay image (Debian package, userspace mode)
  freeswitch/               — group open-mic mixer image (FROM drachtio FS base + conf overlay)
patches/
  endpoint-auto-answer.md   — header-driven auto-answer patch for container-sip-endpoint
```

## Notes / knobs
- Registration and the controller's endpoint REST calls are unauthenticated
  by default (lab prototype) — add SIP digest auth and endpoint-side API
  tokens before this leaves the lab.
- `HEALTH_INTERVAL_MS` / retention are env-configurable on controller-backend,
  same pattern as Walk the Nxt Floor's `sipHealthService`.
- Local dev without containers: `cd controller/backend && npm install && npm run dev`
  needs `PGHOST`/`PGPORT` etc pointed at a reachable Postgres, and note
  `migrate.ts`'s `MIGRATIONS_DIR` assumes the container layout (dist/ and
  migrations/ both directly under the app root) — adjust the relative path if
  running straight from `src/` in dev.

## Roadmap
- **First-boot verification** of the two locally-built media images — see the
  "Media images are built locally" checks above.
- **Announce-zone listen-only members** — `can_talk: false` members aren't
  dialled out yet (only talkers are); wire that in once you have a live-mic
  handset that actually needs to *receive* group audio without transmitting.
- **API keys for machine clients** (mirroring Walk the Nxt Floor's
  `apiKeyService`), **WebSocket live session/log streaming** in the console,
  **SIP digest auth** on pbx-core and the FreeSWITCH profile before this
  leaves the lab.
- **Moderator-forced mute** — if you need to mute a participant regardless of
  that endpoint's cooperation, that's when ESL/drachtio-fsmrf floor control
  becomes worth adding (see the PTT note above).

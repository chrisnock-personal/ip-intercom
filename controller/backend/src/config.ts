// src/config.ts — intercom controller config (mirrors Walk the Nxt Floor style)
const config = {
  port:       parseInt(process.env.PORT || '3100', 10),
  nodeEnv:    process.env.NODE_ENV || 'development',
  jwtSecret:  process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtTtl:     process.env.JWT_TTL || '8h',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@intercom.local',
  adminPass:  process.env.ADMIN_PASSWORD || 'admin123',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // PostgreSQL
  pgHost:     process.env.PGHOST || '127.0.0.1',
  pgPort:     parseInt(process.env.PGPORT || '5432', 10),
  pgDatabase: process.env.PGDATABASE || 'intercom',
  pgUser:     process.env.PGUSER || 'intercom_user',
  pgPassword: process.env.PGPASSWORD || 'intercom_pass',
  pgPoolMax:  parseInt(process.env.PG_POOL_MAX || '10', 10),
  pgSsl:      process.env.PGSSL === 'true',

  // pbx-core's read-only admin/status HTTP server (registrations + live
  // calls) — see services/pbxCoreService.ts. Docker-compose overrides this
  // to host.containers.internal since pbx-core runs network_mode: host.
  pbxBaseUrl: process.env.PBX_BASE_URL || 'http://127.0.0.1:9080',

  // Where the turret's browser JsSIP UA registers (SIP-over-WS). Returned to
  // the turret page by /api/v1/turret/login and /me rather than the page
  // guessing its own host — pbx-core may live on a different host in a real
  // routed/multi-subnet deployment.
  pbxWsHost: process.env.PBX_WS_HOST || '127.0.0.1',
  pbxWsPort: parseInt(process.env.PBX_WS_PORT || '8088', 10),

  // Endpoint health polling (hits each endpoint's container-sip-endpoint /api/status)
  healthInterval:      parseInt(process.env.HEALTH_INTERVAL_MS || '30000', 10),
  healthLogRetentionDays: parseInt(process.env.HEALTH_LOG_RETENTION_DAYS || '90', 10),

  // Graceful shutdown drain
  shutdownDrainMs: parseInt(process.env.SHUTDOWN_DRAIN_MS || '15000', 10),

  // Podman API socket, mounted read-write into this container — used by the
  // System Health page's log viewer (routes/system.ts) to fetch other
  // containers' logs via the libpod HTTP API over a unix socket. Widens this
  // container's blast radius to every container on the host, not just this
  // project's — see CLAUDE.md.
  podmanSocketPath: process.env.PODMAN_SOCKET_PATH || '/run/podman/podman.sock',
};

export default config;

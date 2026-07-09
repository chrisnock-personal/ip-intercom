-- ── Migration 003: Intercom endpoints ───────────────────────────────────────
-- An endpoint is a registered station. `rest_url` is its container-sip-endpoint
-- REST base (health polling + orchestration hit /api/status, /api/call, etc.).
-- `aor` is its SIP address as it registers to pbx-core.

CREATE TABLE intercom_endpoints (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    aor             TEXT        NOT NULL,               -- e.g. sip:1001@intercom.lab
    rest_url        TEXT,                               -- e.g. http://192.168.1.20:3000
    kind            TEXT        NOT NULL DEFAULT 'station',
    -- station   → container-sip-endpoint automation/capture station
    -- announcer → WAV-playback source for one-way paging
    -- tap       → recording/transcription-only participant
    -- handset   → live-mic human endpoint (browser/hardware)
    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,

    -- current-value health snapshot (time-series lives in 006 health log)
    status          TEXT        NOT NULL DEFAULT 'unknown',  -- online | offline | unknown
    last_seen_at    TIMESTAMPTZ,
    last_error      TEXT,
    last_latency_ms INT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      TEXT,
    updated_by      TEXT,

    CONSTRAINT chk_endpoint_kind CHECK (kind IN ('station','announcer','tap','handset'))
);

CREATE UNIQUE INDEX idx_intercom_endpoints_name ON intercom_endpoints (name);
CREATE UNIQUE INDEX idx_intercom_endpoints_aor  ON intercom_endpoints (LOWER(aor));
CREATE INDEX idx_intercom_endpoints_status      ON intercom_endpoints (status);

CREATE TRIGGER trg_intercom_endpoints_updated_at
    BEFORE UPDATE ON intercom_endpoints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

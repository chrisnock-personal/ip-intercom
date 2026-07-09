-- ── Migration 006: Endpoint health log (time-series) ────────────────────────
-- Append every poll here; intercom_endpoints holds only the current snapshot.
-- Pruned by endpointHealthService per HEALTH_LOG_RETENTION_DAYS.

CREATE TABLE intercom_endpoint_health_log (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpoint_id   UUID        NOT NULL REFERENCES intercom_endpoints (id) ON DELETE CASCADE,
    status        TEXT        NOT NULL,   -- online | offline
    latency_ms    INT,
    error_message TEXT,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_iehl_endpoint_time ON intercom_endpoint_health_log (endpoint_id, checked_at DESC);

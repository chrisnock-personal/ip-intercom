-- ── Migration 010: turret call history ──────────────────────────────────────
-- Turret-placed calls bypass the console's own orchestration entirely (they
-- dial directly over SIP through pbx-core), so intercom_sessions never saw
-- them — its initiator/target columns FK to intercom_endpoints, and turrets
-- deliberately have no paired endpoint row (hot-desk model, no persistent
-- device identity). These columns are parallel to the endpoint ones, not a
-- replacement: an endpoint-sourced row still uses *_endpoint_id, a
-- turret-sourced row uses these instead.

ALTER TABLE intercom_sessions
    ADD COLUMN initiator_directory_user_id UUID REFERENCES intercom_directory_users (id) ON DELETE SET NULL,
    ADD COLUMN target_directory_user_id    UUID REFERENCES intercom_directory_users (id) ON DELETE SET NULL,
    -- Turret-generated opaque token (crypto.randomUUID()) correlating a
    -- call's start/end pings — distinct from bridge_ref, which is the
    -- rtpengine call-id / mixer conference id, a different concern.
    ADD COLUMN client_call_id              TEXT;

CREATE INDEX idx_sessions_client_call_id ON intercom_sessions (client_call_id) WHERE client_call_id IS NOT NULL;

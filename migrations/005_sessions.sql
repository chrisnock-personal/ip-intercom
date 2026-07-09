-- ── Migration 005: Intercom sessions (history) ──────────────────────────────
-- One row per direct or group intercom session, plus per-participant rows for
-- PTT floor state and join/leave history. Feeds audit + a future call-history UI.

CREATE TABLE intercom_sessions (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                  TEXT        NOT NULL,   -- direct | group
    group_id              UUID        REFERENCES intercom_groups (id) ON DELETE SET NULL,
    initiator_endpoint_id UUID        REFERENCES intercom_endpoints (id) ON DELETE SET NULL,
    target_endpoint_id    UUID        REFERENCES intercom_endpoints (id) ON DELETE SET NULL, -- direct only
    state                 TEXT        NOT NULL DEFAULT 'active',  -- active | ended | failed
    bridge_ref            TEXT,       -- rtpengine call-id / mixer conference id
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at              TIMESTAMPTZ,
    end_reason            TEXT,

    CONSTRAINT chk_session_kind  CHECK (kind  IN ('direct','group')),
    CONSTRAINT chk_session_state CHECK (state IN ('active','ended','failed'))
);

CREATE INDEX idx_sessions_state   ON intercom_sessions (state);
CREATE INDEX idx_sessions_started ON intercom_sessions (started_at DESC);

CREATE TABLE intercom_session_participants (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID    NOT NULL REFERENCES intercom_sessions (id)  ON DELETE CASCADE,
    endpoint_id UUID    NOT NULL REFERENCES intercom_endpoints (id) ON DELETE CASCADE,
    muted       BOOLEAN NOT NULL DEFAULT FALSE,  -- PTT floor: TRUE = not transmitting
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at     TIMESTAMPTZ,

    CONSTRAINT uq_session_participant UNIQUE (session_id, endpoint_id)
);

CREATE INDEX idx_isp_session ON intercom_session_participants (session_id);

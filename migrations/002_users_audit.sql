-- ── Migration 002: Users + Audit ────────────────────────────────────────────
-- Same shape as Walk the Nxt Floor so operators/roles are consistent across
-- both platforms.

CREATE TABLE users (
    id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    email            TEXT    NOT NULL,
    password_hash    TEXT    NOT NULL,
    role             TEXT    NOT NULL DEFAULT 'viewer',
    -- viewer → read-only (endpoints, sessions, history)
    -- editor → initiate/end intercom sessions, manage groups
    -- admin  → full access incl. users, endpoints, system config
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    password_changed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at    TIMESTAMPTZ,

    CONSTRAINT chk_user_role CHECK (role IN ('viewer','editor','admin'))
);

CREATE UNIQUE INDEX idx_users_email ON users (LOWER(email)) WHERE is_active = TRUE;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only audit log. Grant the app role INSERT/SELECT only (no UPDATE/DELETE)
-- in production so history can't be rewritten.
CREATE TABLE audit_log (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor        TEXT,                    -- user email or 'system'
    actor_id     UUID,
    entity_type  TEXT        NOT NULL,    -- 'endpoint' | 'group' | 'session' | 'user' | ...
    entity_id    UUID        NOT NULL,
    action       TEXT        NOT NULL,    -- 'create' | 'update' | 'delete' | 'call_start' | ...
    before_state JSONB,
    after_state  JSONB,
    metadata     JSONB,
    source_ip    INET
);

CREATE INDEX idx_audit_entity     ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_actor      ON audit_log (actor_id);
CREATE INDEX idx_audit_event_time ON audit_log (event_time DESC);
CREATE INDEX idx_audit_action     ON audit_log (action);

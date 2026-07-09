-- ── Migration 004: Intercom groups ──────────────────────────────────────────
-- A group is a paging/talkback zone. `mode` picks the media behaviour;
-- `ptt_default` seeds whether members start muted (push-to-talk) or open-mic.

CREATE TABLE intercom_groups (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT    NOT NULL,
    description TEXT,
    mode        TEXT    NOT NULL DEFAULT 'talkback',   -- talkback | announce
    ptt_default BOOLEAN NOT NULL DEFAULT FALSE,         -- FALSE = open mic
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  TEXT,
    updated_by  TEXT,

    CONSTRAINT chk_group_mode CHECK (mode IN ('talkback','announce'))
);

CREATE UNIQUE INDEX idx_intercom_groups_name ON intercom_groups (name);

CREATE TABLE intercom_group_members (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID    NOT NULL REFERENCES intercom_groups (id)    ON DELETE CASCADE,
    endpoint_id UUID    NOT NULL REFERENCES intercom_endpoints (id) ON DELETE CASCADE,
    role        TEXT    NOT NULL DEFAULT 'member',   -- member | announcer
    can_talk    BOOLEAN NOT NULL DEFAULT TRUE,        -- announce zones set FALSE for listeners
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_group_member UNIQUE (group_id, endpoint_id),
    CONSTRAINT chk_member_role CHECK (role IN ('member','announcer'))
);

CREATE INDEX idx_igm_group    ON intercom_group_members (group_id);
CREATE INDEX idx_igm_endpoint ON intercom_group_members (endpoint_id);

CREATE TRIGGER trg_intercom_groups_updated_at
    BEFORE UPDATE ON intercom_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

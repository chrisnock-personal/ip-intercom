-- ── Migration 008: Directory users (turret login + button assignments) ─────
-- A directory user is a PERSON who logs into a browser turret page — distinct
-- from `users` (console operator login, migration 002). The extension IS the
-- login identifier (no separate username) and is also the bare SIP extension
-- the turret's one JsSIP UA registers as for the session (hot-desk: no
-- persistent device-identity row — see pbx-core/src/registrar.ts).
--
-- NB: extension uniqueness is only enforced within this table. pbx-core's
-- registrar (in-memory, no DB) is a single flat AOR namespace shared with
-- intercom_endpoints.aor — the controller must reject a directory-user
-- extension that collides with an existing endpoint's AOR at creation time
-- (application-level check in directoryUserService, not a DB constraint).

CREATE TABLE intercom_directory_users (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT    NOT NULL,
    extension     TEXT    NOT NULL,          -- bare extension, e.g. "2001"; also the login identifier
    password_hash TEXT    NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    TEXT,
    updated_by    TEXT
);

CREATE UNIQUE INDEX idx_intercom_directory_users_extension
    ON intercom_directory_users (LOWER(extension));

CREATE TRIGGER trg_intercom_directory_users_updated_at
    BEFORE UPDATE ON intercom_directory_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A button is either a direct-intercom line (target_extension, a bare dial
-- string like everywhere else in this system — see pbxService.dialString())
-- or a group line (target_group_id). `channel` is the turret slot it rings
-- on by default: handset_a | handset_b | speaker — a direct line can be
-- speaker-assigned (announcement-style) just as a group can be handset-
-- assigned (semi-private), so this is per-button, not a fixed rule.
CREATE TABLE intercom_directory_user_buttons (
    id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    directory_user_id UUID    NOT NULL REFERENCES intercom_directory_users (id) ON DELETE CASCADE,
    button_type       TEXT    NOT NULL,       -- direct | group
    target_extension  TEXT,                   -- direct only — bare extension, NOT a FK
                                               -- (may target any AOR: a directory user,
                                               -- a station, or an announcer)
    target_group_id   UUID    REFERENCES intercom_groups (id) ON DELETE CASCADE,
    channel           TEXT    NOT NULL,        -- handset_a | handset_b | speaker
    label             TEXT,                    -- optional display override
    sort_order        INT     NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_button_type    CHECK (button_type IN ('direct','group')),
    CONSTRAINT chk_button_channel CHECK (channel IN ('handset_a','handset_b','speaker')),
    CONSTRAINT chk_button_target  CHECK (
        (button_type = 'direct' AND target_extension IS NOT NULL AND target_group_id IS NULL)
        OR
        (button_type = 'group'  AND target_group_id  IS NOT NULL AND target_extension IS NULL)
    )
);

CREATE INDEX idx_idub_user  ON intercom_directory_user_buttons (directory_user_id);
CREATE INDEX idx_idub_group ON intercom_directory_user_buttons (target_group_id);

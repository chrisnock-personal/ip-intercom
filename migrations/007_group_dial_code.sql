-- ── Migration 007: Group dial codes ─────────────────────────────────────────
-- Groups are dialled as GROUP_PREFIX + dial_code (e.g. "*8floor-a") so
-- pbx-core can route a group INVITE without needing DB access. Backfill
-- existing rows from a slugified name, then require it going forward.

ALTER TABLE intercom_groups ADD COLUMN dial_code TEXT;

UPDATE intercom_groups
SET dial_code = substr(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 1, 20)
WHERE dial_code IS NULL;

ALTER TABLE intercom_groups ALTER COLUMN dial_code SET NOT NULL;

CREATE UNIQUE INDEX idx_intercom_groups_dial_code ON intercom_groups (dial_code);

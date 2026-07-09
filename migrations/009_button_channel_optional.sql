-- ── Migration 009: buttons no longer bind a fixed channel ──────────────────
-- The turret operator now picks Handset A/B/Speaker at call time (see
-- turret/src/App.tsx's channel selector) rather than the channel being fixed
-- per-button by the admin. This also enables moving an active call between
-- channels mid-call without redialing (channels.ts's moveCall).
ALTER TABLE intercom_directory_user_buttons DROP CONSTRAINT IF EXISTS chk_button_channel;
ALTER TABLE intercom_directory_user_buttons DROP COLUMN IF EXISTS channel;

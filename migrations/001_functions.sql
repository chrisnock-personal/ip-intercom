-- ── Migration 001: Shared functions ─────────────────────────────────────────
-- Single definition of the updated_at trigger fn, reused by every table below.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

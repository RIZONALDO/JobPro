-- Mural da equipe: recado fixado e reconhecimento (kudos) para uma pessoa. Idempotente.
ALTER TABLE te_feed_items ADD COLUMN IF NOT EXISTS pinned_at      timestamptz;
ALTER TABLE te_feed_items ADD COLUMN IF NOT EXISTS pinned_by_id   integer REFERENCES te_users(id) ON DELETE SET NULL;
ALTER TABLE te_feed_items ADD COLUMN IF NOT EXISTS target_user_id integer REFERENCES te_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS te_feed_items_created_idx ON te_feed_items(created_at DESC);

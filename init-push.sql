-- Migração: Web Push Subscriptions
-- Executar na VPS: psql $DATABASE_URL -f init-push.sql

CREATE TABLE IF NOT EXISTS te_push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES te_users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON te_push_subscriptions(user_id);

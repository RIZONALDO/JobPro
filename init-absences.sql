-- Migração: ausências temporárias de usuários (férias, afastamento, licença, folga)
-- Executar na VPS:
--   psql 'postgresql://jobpro:jobpro2024@localhost:5432/jobpro' -f /var/www/jobpro/init-absences.sql
-- Idempotente: pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS te_user_absences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES te_users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'vacation',
  notes TEXT,
  created_by_id INTEGER REFERENCES te_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT te_user_absences_range_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_user_absences_user  ON te_user_absences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_absences_range ON te_user_absences(start_date, end_date);

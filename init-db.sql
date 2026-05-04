-- TeamEdit database initialization
-- Run once: psql $DATABASE_URL -f init-db.sql

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS te_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS te_projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  color TEXT NOT NULL DEFAULT '#6366f1',
  due_date DATE,
  created_by_id INTEGER REFERENCES te_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS te_jobs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES te_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'aberto',
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_by_id INTEGER REFERENCES te_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS te_tasks (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES te_jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  complexity TEXT NOT NULL DEFAULT 'medium',
  assigned_to_id INTEGER REFERENCES te_users(id),
  revision_count INTEGER NOT NULL DEFAULT 0,
  folder_url TEXT,
  notes TEXT,
  created_by_id INTEGER REFERENCES te_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS te_task_revisions (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES te_tasks(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_by_id INTEGER REFERENCES te_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS te_app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Acompanhantes do job (gestores que seguem o job sem ser o dono). Idempotente.
CREATE TABLE IF NOT EXISTS te_task_followers (
  id          serial PRIMARY KEY,
  task_id     integer NOT NULL REFERENCES te_tasks(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES te_users(id) ON DELETE CASCADE,
  added_by_id integer REFERENCES te_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT te_task_followers_unique UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS te_task_followers_user_idx ON te_task_followers(user_id);

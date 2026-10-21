-- Fila em horas (substitui o sistema de carga por complexidade).
-- Idempotente: pode rodar mais de uma vez.
BEGIN;

ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS lock_reason text;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS due_date_original timestamptz;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS worked_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS playing_since timestamptz;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS queue_order double precision NOT NULL DEFAULT 0;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS queue_hold boolean NOT NULL DEFAULT false;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_confirmed boolean NOT NULL DEFAULT true;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_coord_minutes integer;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_editor_minutes integer;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_dispute_open boolean NOT NULL DEFAULT false;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_owner_id integer;
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS est_expired_at timestamptz;

ALTER TABLE te_users ADD COLUMN IF NOT EXISTS idle_since timestamptz;
ALTER TABLE te_users ADD COLUMN IF NOT EXISTS idle_alerted_at timestamptz;

-- Converte a complexidade antiga em horas (baixa 3h, média 6h, alta 12h) e monta a fila pela ordem de prazo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'te_tasks' AND column_name = 'complexity') THEN
    UPDATE te_tasks SET est_minutes = CASE complexity WHEN 'low' THEN 180 WHEN 'high' THEN 720 ELSE 360 END
     WHERE est_minutes = 0;
    UPDATE te_tasks t SET queue_order = s.rn
      FROM (SELECT id, row_number() OVER (PARTITION BY assigned_to_id ORDER BY (status = 'in_progress') DESC, due_date NULLS LAST, id) AS rn
              FROM te_tasks WHERE status IN ('pending','in_progress','in_revision','reopened')) s
     WHERE t.id = s.id;
    -- Tarefa já iniciada: o relógio continua rodando desde que o editor tocou em "iniciar" (só uma por editor).
    UPDATE te_tasks t SET playing_since = s.started
      FROM (SELECT DISTINCT ON (t2.assigned_to_id) t2.id, e.created_at AS started
              FROM te_tasks t2
              JOIN LATERAL (SELECT created_at FROM te_task_events WHERE task_id = t2.id AND to_status = 'in_progress'
                             ORDER BY created_at DESC LIMIT 1) e ON true
             WHERE t2.status = 'in_progress' AND t2.assigned_to_id IS NOT NULL
             ORDER BY t2.assigned_to_id, e.created_at DESC) s
     WHERE t.id = s.id AND t.playing_since IS NULL;
    -- Outras iniciadas do mesmo editor (o sistema antigo deixava várias): metade das horas como feitas.
    UPDATE te_tasks SET worked_minutes = est_minutes / 2 WHERE status = 'in_progress' AND playing_since IS NULL AND worked_minutes = 0;
    ALTER TABLE te_tasks DROP COLUMN complexity;
    -- a API, ao subir, encaixa essas horas no prazo combinado e pede ao editor para confirmar (queue-cron.ts)
    INSERT INTO te_app_settings (key, value) VALUES ('legacy_est_fit', 'pending')
      ON CONFLICT (key) DO UPDATE SET value = 'pending';
  END IF;
END $$;
ALTER TABLE te_tasks DROP COLUMN IF EXISTS editor_complexity_set;
-- startDate passa a significar "não começar antes de": só faz sentido se for futuro.
UPDATE te_tasks SET start_date = NULL
 WHERE status IN ('pending','in_progress','in_revision','reopened','paused','review') AND start_date <= now();

CREATE TABLE IF NOT EXISTS te_queue_requests (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  task_id integer NOT NULL REFERENCES te_tasks(id) ON DELETE CASCADE,
  swap_with_id integer REFERENCES te_tasks(id) ON DELETE CASCADE,
  target_order integer,
  new_order text,
  editor_id integer NOT NULL REFERENCES te_users(id) ON DELETE CASCADE,
  requested_by_id integer NOT NULL REFERENCES te_users(id) ON DELETE CASCADE,
  approver_id integer REFERENCES te_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pendente',
  impacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed integer NOT NULL DEFAULT 0,
  escalated boolean NOT NULL DEFAULT false,
  decided_by_id integer REFERENCES te_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_requests_status ON te_queue_requests(status);

CREATE TABLE IF NOT EXISTS te_queue_events (
  id serial PRIMARY KEY,
  task_id integer REFERENCES te_tasks(id) ON DELETE CASCADE,
  actor_id integer REFERENCES te_users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  text text,
  coord_id integer,
  editor_id integer,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_events_task ON te_queue_events(task_id);
CREATE INDEX IF NOT EXISTS idx_queue_events_kind ON te_queue_events(kind, created_at);

CREATE TABLE IF NOT EXISTS te_holidays (
  day date PRIMARY KEY,
  name text NOT NULL
);
-- Feriados nacionais 2026–2027
INSERT INTO te_holidays (day, name) VALUES
  ('2026-01-01','Confraternização Universal'),('2026-02-16','Carnaval'),('2026-02-17','Carnaval'),('2026-04-03','Sexta-feira Santa'),
  ('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),('2026-06-04','Corpus Christi'),('2026-09-07','Independência'),
  ('2026-10-12','Nossa Senhora Aparecida'),('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Consciência Negra'),
  ('2026-12-25','Natal'),
  ('2027-01-01','Confraternização Universal'),('2027-02-08','Carnaval'),('2027-02-09','Carnaval'),('2027-03-26','Sexta-feira Santa'),
  ('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),('2027-05-27','Corpus Christi'),('2027-09-07','Independência'),
  ('2027-10-12','Nossa Senhora Aparecida'),('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Consciência Negra'),
  ('2027-12-25','Natal')
ON CONFLICT (day) DO NOTHING;

-- sem hora extra: a empresa não paga e isso é combinado com o RH, fora do sistema
DROP TABLE IF EXISTS te_overtime;

INSERT INTO te_app_settings (key, value) VALUES ('queue_limit_minutes', '2400') ON CONFLICT (key) DO NOTHING;

COMMIT;

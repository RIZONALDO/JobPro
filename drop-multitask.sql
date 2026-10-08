-- Migração: remove o conceito de multi-tarefa / subtarefa.
-- Rodar SÓ DEPOIS do deploy do código novo (que não usa mais essas colunas):
--   psql 'postgresql://jobpro:jobpro2024@localhost:5432/jobpro' -f /var/www/jobpro/drop-multitask.sql
-- Aborta sem alterar nada se ainda existir alguma multi-tarefa ou subtarefa.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'te_tasks' AND column_name = 'task_type') THEN
    EXECUTE 'SELECT count(*) FROM te_tasks WHERE task_type <> ''task'' OR parent_task_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Existem % multi-tarefa(s)/subtarefa(s) — converta-as antes de remover as colunas', n;
    END IF;
  END IF;
END $$;

ALTER TABLE te_tasks DROP CONSTRAINT IF EXISTS te_tasks_task_type_check;
ALTER TABLE te_tasks DROP CONSTRAINT IF EXISTS te_tasks_parent_task_id_fkey;
DROP INDEX IF EXISTS idx_te_tasks_parent_task_id;
ALTER TABLE te_tasks DROP COLUMN IF EXISTS parent_task_id;
ALTER TABLE te_tasks DROP COLUMN IF EXISTS subtask_order;
ALTER TABLE te_tasks DROP COLUMN IF EXISTS task_type;

COMMIT;

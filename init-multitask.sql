-- Migration: Multi-Task feature
-- Run this on the VPS after git pull: psql $DATABASE_URL -f init-multitask.sql

BEGIN;

-- Add new columns to te_tasks
ALTER TABLE te_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES te_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS subtask_order INTEGER NOT NULL DEFAULT 0;

-- Index for fast subtask lookup
CREATE INDEX IF NOT EXISTS idx_te_tasks_parent_task_id ON te_tasks(parent_task_id);

-- Constraint: task_type must be one of the valid values
ALTER TABLE te_tasks
  DROP CONSTRAINT IF EXISTS te_tasks_task_type_check;
ALTER TABLE te_tasks
  ADD CONSTRAINT te_tasks_task_type_check
  CHECK (task_type IN ('task', 'multi_task', 'subtask'));

-- Constraint: subtask cannot be a parent (no deep nesting)
-- Enforced at app level too, but belt-and-suspenders
-- (PostgreSQL CHECK can't use subqueries, so we rely on app-level for this)

COMMIT;

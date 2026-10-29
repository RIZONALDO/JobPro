-- Fila: quando cada job virou o 1º da fila do editor. A previsão do 1º conta daí (tocar em "Começar" só acompanha).
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS head_since timestamptz;

-- Preenche o 1º de cada fila de hoje: o mais tarde entre a entrada do job na fila desse editor
-- (criado, atribuído, movido, destravado, alteração do cliente) e a saída do job anterior (enviado, travado, encerrado).
WITH fila AS (
  SELECT t.id, t.assigned_to_id AS ed, t.playing_since, t.created_at,
         row_number() OVER (PARTITION BY t.assigned_to_id ORDER BY (t.playing_since IS NULL), t.queue_order, t.id) AS k
  FROM te_tasks t
  WHERE t.assigned_to_id IS NOT NULL AND NOT t.queue_hold AND t.status IN ('pending','in_progress','in_revision','reopened')
), head AS (
  SELECT f.id, f.playing_since,
    GREATEST(
      COALESCE((SELECT max(e.created_at) FROM te_queue_events e WHERE e.task_id = f.id AND e.editor_id = f.ed
                AND e.kind IN ('created','assign','reassign','moved','unblocked','client_change')), f.created_at),
      COALESCE((SELECT max(e.created_at) FROM te_queue_events e WHERE e.editor_id = f.ed AND e.task_id <> f.id
                AND e.kind IN ('sent','blocked','archived')), f.created_at)
    ) AS desde
  FROM fila f WHERE f.k = 1
)
UPDATE te_tasks t SET head_since = h.desde FROM head h WHERE t.id = h.id AND t.head_since IS NULL;

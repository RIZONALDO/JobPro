# Deploy — Feature Multi-Tarefa

## 1. Commit local

```bash
cd ~/JobPro-git

git add \
  init-multitask.sql \
  lib/db/src/schema/tasks.ts \
  artifacts/api-server/src/routes/tasks.ts \
  artifacts/api-server/src/lib/broadcast.ts \
  artifacts/team-edit/src/hooks/use-realtime.ts \
  artifacts/team-edit/src/components/task-form-modal.tsx \
  artifacts/team-edit/src/components/TaskModal.tsx \
  artifacts/team-edit/src/components/ui/subtask-progress-bar.tsx \
  artifacts/team-edit/src/components/ui/multi-task-badge.tsx \
  artifacts/team-edit/src/components/ui/parent-task-breadcrumb.tsx \
  artifacts/team-edit/src/components/ui/subtask-form-row.tsx \
  artifacts/team-edit/src/pages/tasks-overview.tsx \
  artifacts/team-edit/src/pages/editor-task-list.tsx \
  artifacts/team-edit/src/pages/pipeline.tsx \
  artifacts/team-edit/src/pages/my-tasks.tsx

git commit -m "feat: multi-tarefa — parent/subtask hierarchy, progress tracking, realtime"
git push origin main
```

## 2. SSH na VPS — migração do banco

```bash
ssh seu-usuario@seu-vps

# Rode a migração UMA vez
psql $DATABASE_URL -f ~/JobPro-git/init-multitask.sql
```

Saída esperada:
```
BEGIN
ALTER TABLE
ALTER TABLE
CREATE INDEX
ALTER TABLE
ALTER TABLE
COMMIT
```

## 3. Deploy da aplicação

```bash
cd ~/JobPro-git
bash deploy.sh
```

O script faz: `git pull → pnpm build → rsync → pm2 restart`

## 4. Verificar no ar

```bash
pm2 logs api-server --lines 30
```

Confirmar que sobe sem `Error` e que aparece a linha de startup normal.

---

## O que foi implementado

### Backend (`artifacts/api-server/src/routes/tasks.ts`)
- `recalculateParentStatus()` — recalcula status do pai baseado nas subtarefas
- `POST /tasks` — aceita `taskType: "multi_task"` + array `subtasks[]`
- `GET /tasks/:id` — retorna `subtasks`, `subtaskProgress`, `parentTask`
- `GET /tasks/:id/subtasks` — lista subtarefas de uma multi-tarefa
- `POST /tasks/:id/subtasks` — cria subtarefa avulsa dentro de multi-tarefa
- `GET /tasks/:id/progress` — retorna `{ total, completed, percentage, ... }`
- `PUT /tasks/:id` — propaga cancel/pause para subtarefas; bloqueia `completed` manual em multi-tarefa
- Todos os endpoints de listagem filtram `parentTaskId IS NULL` para não exibir subtarefas em duplicidade

### Backend (`artifacts/api-server/src/lib/broadcast.ts`)
- `broadcastSubtaskProgress(parentTaskId, progress)` — emite `multitask:progress`
- `broadcastSubtaskChanged(subtaskId, parentTaskId)` — emite `subtask:changed`

### Frontend — novos componentes
- `SubtaskProgressBar` — barra de progresso com % de conclusão
- `MultiTaskBadge` — badge "Multi-tarefa" / "Subtarefa"
- `ParentTaskBreadcrumb` — breadcrumb navegável para tarefa pai
- `SubtaskFormRow` — linha do formulário de criação de subtarefa (título + editor + prazo)

### Frontend — adaptações
- `task-form-modal.tsx` — toggle Simples / Multi-tarefa; formulário de subtarefas com linhas adicionáveis
- `TaskModal.tsx` — progress bar, lista de subtarefas clicáveis, breadcrumb para subtarefas
- `tasks-overview.tsx`, `editor-task-list.tsx`, `pipeline.tsx`, `my-tasks.tsx` — badges e barra de progresso nas listagens
- `use-realtime.ts` — escuta `subtask:changed` e `multitask:progress`

### Banco de dados (`init-multitask.sql`)
```sql
ALTER TABLE te_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES te_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS subtask_order INTEGER NOT NULL DEFAULT 0;
```

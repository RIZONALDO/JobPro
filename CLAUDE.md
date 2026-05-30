# JobPro — Contexto para Claude

Este arquivo documenta o projeto para que qualquer sessão nova do Claude comece com contexto completo, sem precisar reler o código do zero.

---

## O que é o JobPro

Sistema de gestão de tarefas para agências de vídeo/edição. Coordenadores criam e atribuem tarefas; editores executam. Há chat interno, feed de atividades, calendário, pipeline kanban e relatórios.

**URL em produção:** VPS em `108.174.144.208` (HTTPS via Nginx reverso)

---

## Estrutura do Monorepo

```
JobPro-git/
├── artifacts/
│   ├── api-server/        # Backend Node.js + Express
│   │   └── src/
│   │       ├── app.ts
│   │       ├── routes/    # tasks.ts, users.ts, auth.ts, dm.ts, feed.ts...
│   │       └── lib/       # auth.ts, broadcast.ts, notify.ts, session.ts
│   └── team-edit/         # Frontend React + Vite
│       └── src/
│           ├── pages/     # dashboard, tasks-overview, my-tasks, pipeline, calendar...
│           ├── components/ # task-form-modal, TaskModal, reassign-editor-modal, editor-availability-modal...
│           ├── components/ui/  # shadcn/ui + componentes próprios
│           ├── contexts/  # AuthContext, TaskModalContext, ChatContext...
│           └── hooks/     # use-realtime.ts, use-size.ts...
└── lib/
    └── db/                # Drizzle ORM — schema e cliente PostgreSQL
        └── src/schema/    # tasks.ts, users.ts, jobs.ts, projects.ts...
```

**Gerenciador de pacotes:** `pnpm` com workspaces. NUNCA usar npm ou yarn.

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js, Express, TypeScript |
| ORM | Drizzle ORM |
| Banco | PostgreSQL (tabelas prefixadas `te_`) |
| Frontend | React 19, Vite, TypeScript |
| UI | Tailwind CSS + shadcn/ui (Radix) |
| Realtime | SSE (Server-Sent Events) via `/api/sse` |
| Sessão | express-session + connect-pg-simple |
| Autenticação | Sessão com cookie, bcryptjs para hash de senha |
| Deploy | Nginx reverso + processo Node direto na VPS |

---

## Banco de Dados — Tabelas Principais

Todas as tabelas têm prefixo `te_`:

- **`te_tasks`** — tarefas, multi-tarefas e subtarefas
- **`te_users`** — usuários (roles: `admin` | `coordinator` | `editor`)
- **`te_task_editors`** — relação N:N tarefa ↔ editores adicionais
- **`te_task_revisions`** — histórico de pedidos de alteração
- **`te_task_events`** — log de mudanças de status
- **`te_chat_messages`** e **`te_direct_messages`** — chat
- **`te_jobs`**, **`te_projects`**, **`te_clients`** — entidades relacionadas
- **`te_notifications`**, **`te_push_subscriptions`** — notificações
- **`te_feed_items`**, **`te_feed_comments`**, **`te_feed_reactions`** — feed
- **`te_duty_schedules`** — escalas de plantão

### Schema de tarefas (`te_tasks`) — campos importantes

```ts
id, taskNumber, taskYear          // código: "001.25"
title, description, client, color, notes
startDate                         // QUANDO o editor começa (pode ser futuro)
dueDate                           // prazo de entrega
status                            // ver ciclo abaixo
priority                          // 'low' | 'medium' | 'high'
complexity                        // 'low' | 'medium' | 'high'
assignedToId                      // editor principal (FK te_users)
createdById                       // coordenador (FK te_users)
revisionCount                     // quantas alterações foram solicitadas
folderUrl                         // link para pasta de arquivos
taskType                          // 'task' | 'multi_task' | 'subtask'
parentTaskId                      // FK para si mesmo (subtarefas)
subtaskOrder                      // ordem dentro da multi-tarefa
```

---

## Regras de Negócio Críticas

### Papéis
- **`admin`** — vê tudo, gerencia usuários
- **`coordinator`** — cria tarefas, atribui editores, aprova/rejeita
- **`editor`** — executa tarefas atribuídas a ele

### Ciclo de vida de uma tarefa
```
rascunho → pending → in_progress → review → completed
                              ↑         ↓
                         in_revision ←─┘  (loop de alteração)
+ paused / cancelled (terminais laterais)
```

### Sistema de carga dos editores (Workload)
Cada tarefa tem um **peso por complexidade**:
- `low` = 3 pts
- `medium` = 6 pts
- `high` = 12 pts (= capacidade total)

**Cores e rótulos:**
| Score | Cor | Rótulo |
|-------|-----|--------|
| 0 | cinza `#94a3b8` | Disponível |
| 1–6 | verde `#22c55e` | Ocupado |
| 7–11 | laranja `#f97316` | Muito ocupado |
| ≥12 | vermelho `#ef4444` | No limite |

**Regra:** score ≥ 12 exibe aviso visual (cor vermelha) mas **não bloqueia** a atribuição — coordenador tem controle total. O sistema apenas informa.

### startDate — Agendamento futuro
Tarefas podem ter `startDate` no futuro. Isso significa que o editor vai começar depois.

- **Carga atual** = tarefas sem `startDate` OU `startDate` ≤ hoje
- **Carga agendada** = tarefas com `startDate` > hoje
- **Carga projetada** = atual + agendada até uma data alvo
- O endpoint `/api/workload?date=YYYY-MM-DD` retorna a carga projetada para aquela data
- No modal de criação, se `startDate` é futuro, a carga exibida é a projetada (não a atual)
- **Buffer de 5 dias:** ao projetar para data futura, tarefas com `dueDate` que termina ≥ 5 dias antes da data alvo são excluídas do score (assumidas entregues)

### Multi-tarefas
- `taskType = 'multi_task'` é o pai
- `taskType = 'subtask'` são os filhos (cada um tem seu editor e prazo)
- O status do pai é recalculado automaticamente com base nos filhos
- Subtarefas aparecem expansíveis na listagem do coordenador

---

## Rotas da API

Todas sob `/api/`. Arquivo principal: `artifacts/api-server/src/routes/tasks.ts`

Endpoints mais importantes:
```
GET  /api/tasks/overview    — lista de tarefas do coordenador
GET  /api/my-tasks          — tarefas do usuário logado
GET  /api/pipeline          — dados para o kanban
GET  /api/calendar          — tarefas por período (suporta startDate → dueDate)
GET  /api/workload          — carga dos editores (?date=YYYY-MM-DD para projeção)
GET  /api/workload/calendar — disponibilidade diária de um editor (?editorId=X&month=YYYY-MM)
GET  /api/dashboard-extras  — dados extras do dashboard
POST /api/tasks             — criar tarefa (simples ou multi_task)
PUT  /api/tasks/:id         — editar tarefa (inclui mudança de status)
DELETE /api/tasks/:id       — excluir
POST /api/tasks/:id/subtasks — criar subtarefa
POST /api/tasks/:id/return  — editor devolve tarefa ao coordenador
GET  /api/sse               — Server-Sent Events para realtime
```

---

## Páginas do Frontend

| Arquivo | Rota | Quem vê |
|---------|------|---------|
| `dashboard.tsx` | `/` | todos |
| `tasks-overview.tsx` | `/tasks` | coordinator/admin |
| `tasks-rascunho.tsx` | `/tasks/rascunhos` | coordinator/admin |
| `my-tasks.tsx` | `/my-tasks` | editor (kanban com coluna "Agendadas") |
| `editor-task-list.tsx` | `/fila` | editor (lista) |
| `pipeline.tsx` | `/pipeline` | todos |
| `calendar.tsx` | `/calendar` | todos |
| `timeline.tsx` | `/timeline` | todos |
| `team.tsx` | `/team` | coordinator/admin |
| `reports.tsx` | `/reports` | coordinator/admin |
| `feed.tsx` | `/feed` | todos |
| `duty.tsx` | `/duty` | todos |

---

## Fluxo de Desenvolvimento

### 1. Editar arquivos

O Cowork tem acesso direto à pasta `~/JobPro-git`. Editar os arquivos diretamente lá.

Arquivos de schema ficam em `lib/db/src/schema/`. Quando adicionar coluna nova ao schema TypeScript, **também rodar a migração SQL na VPS** (Drizzle não migra automaticamente em produção):

```sql
ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS nome_coluna TIPO;
```

### 2. Commit

```bash
cd ~/JobPro-git
git add <arquivos>
git commit -m "feat: descrição curta"
```

**Atenção ao zsh:** arquivos com `[id]` no nome precisam de aspas:
```bash
git add "artifacts/team-edit/src/pages/jobs/[id].tsx"
```

Se aparecer erro `fatal: Unable to create '.git/index.lock'`:
```bash
rm ~/JobPro-git/.git/index.lock
```

### 3. Push para GitHub

```bash
cd ~/JobPro-git
git push
```

Repositório: `https://github.com/RIZONALDO/JobPro.git`

### 4. Deploy na VPS

**Acesso:** `ssh -p 22022 root@108.174.144.208`

```bash
ssh -p 22022 root@108.174.144.208 "bash /var/www/jobpro/deploy.sh"
```

O script de deploy faz: `git pull` + `pnpm install` + build + restart do processo Node (PM2, app name: `jobpro-api`, porta 3001).

**Migração de banco** (quando há coluna nova no schema):

> ⚠️ `$DATABASE_URL` **não está no ambiente do root** na VPS — usar sempre a string completa abaixo.

```bash
ssh -p 22022 root@108.174.144.208 "
  psql 'postgresql://jobpro:jobpro2024@localhost:5432/jobpro' \
    -c 'ALTER TABLE te_tasks ADD COLUMN IF NOT EXISTS nova_coluna TIPO;' && \
  bash /var/www/jobpro/deploy.sh
"
```

**Arquivos importantes na VPS:**
- `/var/www/jobpro/artifacts/api-server/.env` — VAPID, UPLOADS_DIR
- `/var/www/jobpro/artifacts/api-server/ecosystem.config.cjs` — DATABASE_URL, SESSION_SECRET, PORT
- `/var/www/jobpro/deploy.sh` — script de deploy
- `/var/www/jobpro/uploads` — avatares e uploads (persistem entre deploys)

### Resumo do fluxo completo

```
Editar no Cowork → git add + commit → git push → ssh deploy na VPS
```

---

## Realtime (SSE)

- `artifacts/api-server/src/lib/broadcast.ts` — funções `broadcastTaskChange()`, `broadcastSubtaskProgress()`, `broadcastSubtaskChanged()`
- `artifacts/team-edit/src/hooks/use-realtime.ts` — hook no frontend que escuta o SSE e chama callbacks (`onTasksChanged`, `onSubtaskChanged`, etc.)
- Toda mutação de tarefa deve chamar `broadcastTaskChange()` para atualizar todos os clientes conectados

---

## Convenções de Código

### Backend
- TypeScript strict, ESM modules (`.js` nos imports mesmo sendo `.ts`)
- Drizzle ORM para todas as queries — nunca SQL raw exceto em casos específicos com `sql\`...\``
- Middleware de auth: `requireAuth` (qualquer role) e `requireCoordinator` (bloqueia editores)
- Sessão: `req.session.userId` e `req.session.userRole`
- Erros retornam `res.status(4xx).json({ error: "mensagem" })`

### Frontend
- Tailwind CSS com variáveis CSS customizadas: `hsl(var(--primary))`, `hsl(var(--card))`, etc.
- Componentes shadcn/ui em `src/components/ui/`
- `apiFetch`, `apiPost`, `apiPut`, `apiDelete` de `@/lib/api` — nunca fetch direto
- Toast com `sonner`: `toast.success()` / `toast.error()`
- Sem `localStorage` — estado em React state ou contexto

### Estilo visual
- Badge de revisões: chip âmbar pequeno — `bg-amber-50 border-amber-200 text-amber-600`
- Borda colorida no avatar do editor reflete score de carga
- `scoreColor(score)` e `scoreLabel(score)` são funções definidas em cada arquivo que precisa
- **Nunca mostrar valores numéricos de pts na UI** — usar apenas os rótulos (Disponível, Ocupado, Muito ocupado, No limite)
- **Sem bloqueio por carga** — sistema exibe cores/alertas mas coordenador sempre pode atribuir

### DateRangePicker (`components/ui/date-range-picker.tsx`)
- Clique em **uma data** define `startDate` E `dueDate` para o mesmo dia (sinaliza job nesse dia específico)
- Clique em **duas datas** define intervalo `startDate → dueDate`
- Display omite a seta quando início = prazo (mesmo dia)

---

## Tarefas Pendentes (backlog)

- **#37** — Push API + Service Worker (notificações nativas do OS)
- Qualquer nova feature: sempre conferir se precisa de migração SQL na VPS

---

## Funcionalidades Implementadas (referência rápida)

| Feature | Arquivo(s) |
|---------|-----------|
| Modal calendário de disponibilidade do editor | `editor-availability-modal.tsx` + `GET /api/workload/calendar` |
| DateRangePicker (início → prazo, clique único = mesmo dia) | `components/ui/date-range-picker.tsx` |
| Tabs "Pauta do dia / Agendadas" no kanban do editor | `my-tasks.tsx` |
| Tabs "Todas / Tarefas do dia / Agendadas" na lista do coordenador | `tasks-overview.tsx` |
| Coluna "Início" visível apenas na tab Agendadas | `tasks-overview.tsx`, `editor-task-list.tsx` |
| Projeção de carga por `startDate` + buffer 5 dias | `GET /api/workload?date=` |
| Multi-tarefa com subtarefas expansíveis | `task-form-modal.tsx`, `tasks-overview.tsx`, backend `tasks.ts` |
| Chat DM com paginação e scroll inteligente | `ChatWidget`, `dm.ts` |
| Sistema de rascunhos de tarefa | `tasks-rascunho.tsx`, lógica de status `rascunho` |

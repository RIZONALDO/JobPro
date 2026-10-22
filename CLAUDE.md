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
│           ├── pages/     # dashboard, jobs, fila/*, calendar...
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

- **`te_tasks`** — tarefas (não há multi-tarefa/subtarefa: o conceito foi removido — migração `drop-multitask.sql`)
- **`te_users`** — usuários (roles: `admin` | `coordinator` | `editor`)
- **`te_task_editors`** — relação N:N tarefa ↔ editores adicionais
- **`te_task_revisions`** — histórico de pedidos de alteração
- **`te_task_events`** — log de mudanças de status
- **`te_chat_messages`** e **`te_direct_messages`** — chat
- **`te_jobs`**, **`te_projects`**, **`te_clients`** — entidades relacionadas
- **`te_notifications`**, **`te_push_subscriptions`** — notificações
- **`te_feed_items`**, **`te_feed_comments`**, **`te_feed_reactions`** — feed
- **`te_duty_schedules`** — escalas de plantão
- **`te_user_absences`** — ausências temporárias (férias, afastamento, licença, folga) — migração `init-absences.sql`

### Schema de tarefas (`te_tasks`) — campos importantes

```ts
id, taskNumber, taskYear          // código: "001.25"
title, description, client, color, notes
startDate                         // "não começar antes de" (opcional)
dueDate                           // prazo prometido ao cliente
status                            // ver ciclo abaixo
priority                          // 'low' | 'medium' | 'high'
estMinutes, workedMinutes        // fila em horas
queueOrder, playingSince, queueHold, lockReason, dueDateOriginal, estConfirmed, estDisputeOpen...
assignedToId                      // editor principal (FK te_users)
createdById                       // coordenador (FK te_users)
revisionCount                     // quantas alterações foram solicitadas
folderUrl                         // link para pasta de arquivos
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

### Fila em horas (substituiu o sistema de carga por complexidade)
Motor em `api-server/src/lib/queue.ts` + calendário `lib/workcal.ts`; rotas em `routes/queue.ts`; relógio em `lib/queue-cron.ts`.
Migração: `init-fila.sql` (idempotente; converte complexidade antiga em horas: baixa 3h, média 6h, alta 12h, e apaga a coluna `complexity`).

- **Cada editor tem uma fila.** Um job por vez, sem sobreposição e sem paralelo. Status na fila: `pending`, `in_progress`, `in_revision`, `reopened` (com `assigned_to_id` e `queue_hold = false`).
- **Horas, não pontos.** `est_minutes` (estimativa) e `worked_minutes` (trabalhado). ▶ (`playing_since`) conta só o expediente.
- **Datas são calculadas.** Início e fim previstos saem da fila a partir de agora, só no expediente CLT: seg–sex 08:30–12:00 e 14:00–18:30, sábado 08:30–13:00. Sem domingo, feriado (`te_holidays`) ou ausência do editor. **Sem hora extra no sistema**: a empresa não paga e isso é com o RH; a fila conta só o expediente.
- **`due_date` = prazo prometido ao cliente.** Fica separado da previsão. Atraso = previsão > prazo. Prazo empurrado guarda o original em `due_date_original`.
- **`start_date` = "não começar antes de"** (+ `lock_reason`). Se sobra buraco antes, o motor encaixa o próximo job que caiba.
- **Ordem** (`queue_order`) é da coordenação. O editor só dá ▶ no 1º e pode pedir troca. Se ninguém atrasa, a troca é automática; se atrasa job de outro coordenador, vira pedido (`te_queue_requests`) para ele. Sem resposta em 30 min de expediente, vai para a supervisão (admin/supervisor).
- **Job em execução nunca é derrubado.** "Travado" (status `paused`) é a única ação unilateral do editor. O editor não devolve nem recusa job.
- **Travado = prazo correndo.** `unblockForecast` (lib/queue.ts) calcula a entrega se destravar agora (volta depois do job atual) e `blockRisk` diz se é crítico (prazo vencido, já atrasa, ou folga < 4h de expediente). Ao travar: aviso ao dono e acompanhantes com o prazo e a folga; se crítico, também à supervisão. Relógio (`queue-cron.ts`, item 4): lembra o dono a cada 2h de expediente parado e avisa a supervisão uma vez quando fica crítico (evento `blocked_alert`, `data.sups`). No quadro, `task.blocked` = `{ since, stopped, ifNow, critical }`; em Filas os travados aparecem em "Precisa de você" (supervisão vê os de todos, críticos primeiro) e embaixo da fila de cada editor.
- **Mais tempo × prazo** são coisas separadas: o editor diz quanto falta ("Preciso de mais tempo" no cartão Agora, `POST /queue/tasks/:id/inform`) e entra na hora (sem aprovação: é o trabalho real), só a previsão muda; o dono do job é avisado e, se passar do prazo, decide. Gestores de jobs seguintes do mesmo editor que passam a atrasar por causa disso também são avisados ("Seu job vai atrasar"). O prazo do cliente só o gestor muda ("Combinar novo prazo com o cliente", evento `reneg`).
- **Prazo do cliente**: só dentro do expediente (seg–sex 08:30–12:00 e 14:00–18:30, sáb 08:30–13:00; fim do turno vale; almoço, noite, domingo e feriado não). `POST/PUT /tasks` recusam fora disso (`DUE_OFF_SHIFT`, `inShift` em workcal.ts). Um job só "cabe" num editor se fica pronto com `FOLGA` (1h de expediente) antes do prazo; senão o formulário não deixa colocar com esse prazo e sugere: diminuir as horas (`maxEst`), mudar o prazo (pronto + 1h, `newDue`) ou pedir prioridade.
- **Prazo do cliente só muda com assinatura** (`safeDue`/`signDue` em lib/queue.ts): toda mudança de prazo grava `due_signed` com quem assinou ("assume combinar o novo prazo com o cliente"), prazo antigo → novo, e avisa editor e quem acompanha. `PUT /tasks/:id` exige `dueSigned`; mexer em horas, prazo ou trava de job na fila confere a agenda: o prazo nunca fica antes de pronto + `FOLGA` (`due_too_early`); jobs do próprio gestor que passam a atrasar (ou atrasam mais) entram na assinatura (`sign_others` → `signOthers`); job de outro gestor não pode (`hurts_other`), só a supervisão assinando. "Colocar no fim com prazo empurrado" exige `signed` (`placeTask`). Job que vai atrasar por qualquer motivo (fila andou, editor não começou, Fazer antes, mais tempo) ganha `proposedDue` no quadro, o dono recebe "Assine o novo prazo" (cron, `due_sign_needed`) e assina em `POST /queue/tasks/:id/sign-due` (Filas, Dashboard, detalhe do job).
- **Fim do expediente** (não há hora extra): o relógio da fila (`queue-cron.ts`) pausa sozinho todo ▶ ligado fora da janela do dia (`inDayWindow`: do 1º turno ao fim do último; almoço fica dentro). `POST /queue/tasks/:id/play` recusa fora dela. O quadro manda `shift` por editor; o card do editor avisa 15 min antes e a agenda mostra "encerrado".
- **Fazer antes** (editor, `POST /queue/tasks/:id/request-first`): troca na hora, sem pedir permissão. Os gestores cujos jobs mudam de previsão são avisados; quem passa a ter job atrasado recebe "Seu job vai atrasar" e decide (outro editor ou novo prazo). Fica no histórico como `furou` (se atrasa alguém) ou `reorder`.
- **Encerrar travado que ficou para trás** (`POST /api/queue/tasks/:id/archive`, dono do job ou supervisão, só `paused`): "Já foi entregue" → `completed`; "Não vai mais ser feito" (motivo obrigatório) → `cancelled`. Evento `archived`; `routes/reports.ts` ignora esses jobs (não contam como entrega nem atraso). Botão "Encerrar…" no travado em "Precisa de você", no menu "…" do job e na lista de Jobs.
- **Migração do sistema antigo** (`init-fila.sql`): job em andamento ganha o relógio ligado desde o último "iniciar" (um por editor); marca `legacy_est_fit = pending` e a API, ao subir (`fitLegacyEstimates` em `queue-cron.ts`), encolhe as horas vindas da complexidade até caberem no prazo e deixa a estimativa "a confirmar" pelo editor. Editor inativo só aparece nas filas se tiver job na fila ou em edição.
- **Job novo** (`POST /api/tasks` com `placement`): `end` (fim da fila; se não cabe, o prazo passa para a data calculada), `prio` (posição mais para trás que cabe no prazo; pode virar pedido) ou `gestor` (sem editor → supervisão). A prévia é `POST /api/queue/plan`. Fila acima do limite (`te_app_settings.queue_limit_minutes`, padrão 40h) não recebe job, salvo supervisão.
- **Estimativa:** o editor confirma ou contesta (a fila usa a dele na hora). O coordenador aceita ou mantém a sua, e o estouro fica na conta de quem estimou (`est_owner_id`). Horas acabaram → reserva de 1h + aviso.
- **Alteração do cliente / reabertura** = nova rodada com horas próprias, logo depois do job atual do editor.
- **Acompanhantes** (`te_task_followers`, migração `init-followers.sql`): gestores que seguem o job sem ser o dono. Recebem os avisos importantes (pronto para o cliente, travado, aprovado, alteração, prazo mudou/empurrado, troca de editor, cancelado, horas estouradas) e veem o job em "Meus jobs"/"Só os meus". Só o dono do job inclui/tira acompanhantes (nos próprios jobs); ninguém se inclui em job alheio; o acompanhante pode sair. Ações do job continuam com o dono e a supervisão.
- **Passar para outro editor** = `POST /api/queue/tasks/:id/place` (e `/api/tasks/:id/reassign`, mesma regra; gestor só nos próprios jobs). Job começado soma 1h de troca de mãos.
  - **Gestor trocando o editor de um job que já tinha editor:** se a troca **mexe em prazo** (o prazo do próprio job seria empurrado, ou "na frente" atrasaria algum job), vira pedido `kind = 'reassign'` para a **supervisão** (`approver_id` nulo, `escalated = true`, `new_order` guarda o modo `end`/`prio`, `impacts[0]` = "Motivo: …"). Motivo obrigatório (400 `needsReason`). O job fica onde está até a resposta; ao aprovar, `placeTask(..., { approved: true })` aplica. Sem mexer em prazo, a troca é na hora. Supervisão/admin trocam direto. Evita o pula-pula entre filas.
- **Tudo é registrado** em `te_queue_events` (quem fez, por quê). Daí saem os contadores da supervisão (furou a fila, estimativa contestada, prazo empurrado, alterações).
- Tempo na API = "minutos locais" (minutos desde 1970 no horário de Brasília); o front formata com `lib/fila.ts`.

### Usuários inativos × ausências
Lógica central em `api-server/src/lib/availability.ts` (espelho no front: `team-edit/src/lib/availability.ts`).
- **Inativo** (`te_users.status = 'inactive'`) = saiu da equipe. Fica fora das filas, seletores, menções, notificações e plantões novos; a API recusa (400) atribuir tarefa/plantão a inativo. Histórico continua mostrando o nome. Ao inativar: sessões são encerradas, ausências futuras removidas e, opcionalmente, plantões futuros (`removeFutureDuties`). `GET /api/users/:id/pending` lista o que ficou em aberto.
- **Nunca excluir** quem tem histórico — `DELETE /api/users/:id` responde 409 (plantões têm `ON DELETE CASCADE`).
- `GET /api/users` devolve todos (inclusive inativos, para histórico); use `?active=1` em seletores/menções. Cada usuário vem com `absence` (ausência de hoje).
- **Ausência** (`/api/absences`) = pessoa continua ativa; a fila pula os dias de ausência; plantões só sinalizam e o sistema **avisa sem bloquear** (`period-check.absenceMessage`, `warning` no `POST /api/duty`).
- Na agenda, inativos só aparecem se ainda tiverem tarefa aberta (para serem reatribuídas).
- **Redistribuir jobs** (`routes/queue.ts`, seção REDISTRIBUIR; tela `components/fila/HandoffDialog.tsx`, aberta com `openHandoff()`, host no Shell, só supervisão/admin):
  - `POST /api/queue/handoff/:userId/preview` simula tudo junto, em ordem de prazo, e sugere o destino de cada job: no prazo > na frente sem atrasar ninguém > o mais cedo (prazo empurrado) > supervisão decide. Em ausência, sugere "fica com a pessoa" quando ainda entrega no prazo depois da volta. `choices` fixa o que o supervisor escolheu; o resto se reajusta.
  - `POST /api/queue/handoff/:userId` aplica: primeiro troca o responsável (`createdById`, com evento `owner`, pedidos pendentes e aviso ao novo gestor), depois passa os jobs da fila por `placeTask` (mesmas regras: +1h de troca de mãos, prazo empurrado, pedido de prioridade). Job com o cliente, travado ou rascunho só troca o editor.
  - `PUT /api/users/:id` com `status: inactive` responde **409 `open_tasks`** se ainda houver job aberto no nome da pessoa (como editor ou responsável). A redistribuição inativa no fim com `force: true`.
  - Entradas: Inativar membro (vira "Continuar: redistribuir"), Equipe → "Redistribuir jobs…", salvar ausência com jobs no período, e o aviso na coluna do editor inativo/ausente em Filas.

---

## Rotas da API

Todas sob `/api/`. Arquivo principal: `artifacts/api-server/src/routes/tasks.ts`

Endpoints mais importantes:
```
GET  /api/tasks/overview    — todos os jobs (?status=all) com reviewedAt (1ª ida ao cliente) e closedAt; base da página Jobs
GET  /api/my-tasks          — tarefas do usuário logado
GET  /api/pipeline          — dados para o kanban
GET  /api/calendar          — tarefas por período (suporta startDate → dueDate)
GET  /api/queue/board       — fila de todos (editor: só a dele) com previsão, pedidos, calendário, contadores
POST /api/queue/plan        — prévia de onde um job cabe (não grava)
POST /api/queue/tasks/:id/{play,pause,send,block,inform,estimate,request-first,move,unblock,client-ok,client-change,place,estimate-resolve}
POST /api/queue/requests/:id/{decide,cancel} · /api/queue/holidays · PUT /api/queue/settings
PUT  /api/tasks/:id/followers — só o dono do job (gestor/supervisor que criou) define quem acompanha ({userIds})
DELETE /api/tasks/:id/follow — acompanhante sai por conta própria (não existe "seguir" job dos outros)
GET  /api/feed?kind=all|post|kudos|delivery&before=ID — { pinned, items, hasMore } (migração `init-feed.sql`: pinned_at, pinned_by_id, target_user_id)
GET  /api/feed/summary      — entregas da semana, % no prazo, por dia (sem ranking de pessoas)
POST /api/feed/:id/pin      — fixa/desafixa recado (gestão)
GET  /api/queue/activity    — atividade recente da equipe (eventos da fila com job e autor), base do dashboard
GET  /api/dashboard-extras  — (legado, sem uso no dashboard novo)
POST /api/tasks             — criar tarefa
PUT  /api/tasks/:id         — editar tarefa (inclui mudança de status)
DELETE /api/tasks/:id       — excluir
POST /api/tasks/:id/return  — coordenação tira o job da fila (editor não devolve: usa "Travado")
GET  /api/sse               — Server-Sent Events para realtime
```

---

## Páginas do Frontend

| Arquivo | Rota | Quem vê |
|---------|------|---------|
| `fila/minha-fila.tsx` | `/fila` | editor (só os jobs dele; "/" redireciona) |
| `fila/filas.tsx` | `/fila` | coordinator/supervisor (filas de todos, "Precisa de você", régua) |
| `fila/supervisao.tsx` | `/fila/supervisao` | admin/supervisor (ocupação, sem editor, contadores, limite, feriados) |
| `components/fila/JobForm.tsx` | — | formulário de job (novo, editar, rascunho, passar para outro) |
| `dashboard.tsx` | `/` | gestor/supervisão (editor vai para `/fila`). Estilo Jira/Asana: saudação + resumo, indicadores com tendência, "Para você" (precisa de você / próximas entregas / prazo vencido), agenda da semana, criados × entregues (8 semanas), jobs por fase, carga da equipe, atividade recente (`GET /api/queue/activity`), clientes. Recorte "Meus jobs / Equipe toda" e blocos visíveis ficam no localStorage |
| `pages/job.tsx` + `components/JobDetail.tsx` | `/jobs/:id` (abre com `useTaskModal().openTask(id, {ids,label})`) | página do job: barra com ← voltar à origem (filtros e rolagem preservados), anterior/próximo da lista de origem (J/K, ← →), Esc volta, copiar link. Conteúdo: fase (stepper), situação em uma frase, ações da fase, briefing/pasta, rodadas, histórico (eventos da fila + mudanças de fase), prazo, horas e pessoas |
| `jobs.tsx` | `/tasks` ("Jobs") | gestor/supervisão — registro de todos os jobs numa lista só. Escopo em abas (Em aberto, Rascunhos, Entregues, Cancelados); resumo do pipeline (barra por fase, clica para filtrar) e "Precisa de atenção" (vão atrasar, vencem hoje, sem editor, cliente sem resposta); busca (`/`), filtros multi-escolha de Cliente/Editor/Gestor e "Só os meus"; "Agrupar por" Prazo (com régua dos próximos 14 dias), Fase, Cliente, Editor ou Mês (fechados). Linha vira cartão no celular. `N` abre Novo job. `/tasks?group=prazo` abre agrupado por prazo. Ordem e horário ficam em `/fila` |
| `tasks-rascunho.tsx` | `/tasks/rascunhos` | coordinator/admin |
| `team.tsx` | `/team` | coordinator/admin |
| `team-absences.tsx` | `/team/ausencias` | coordinator/admin |
| `reports.tsx` | `/reports` | coordinator/supervisor/admin. Dados de `GET /api/reports/analytics` (`routes/reports.ts`: um registro por job com tempo em cada fase, até a 1ª versão, no prazo pelo prazo original, eventos de risco; gestor vê só os dele). Catálogo de relatórios à esquerda (Resumo do período · Entregas e prazos · Tempo de ciclo · Onde o tempo vai · Estimado × realizado · Riscos e retrabalho · Equipe: Equipe toda, Editores, Gestores, Supervisão · Clientes). Equipe mede também quem decide: `team` na resposta traz travados, estimativas contestadas, jobs sem editor e pedidos com o tempo de espera em expediente até alguém resolver; gestor vê só "Meu desempenho", Equipe toda e Supervisão são só da supervisão; cada um abre como documento: pergunta que responde, texto de leitura gerado dos números, gráfico, tabela e os jobs do recorte. Período com atalhos e comparação com o anterior; clicar em barra/linha/ponto de atenção filtra a tabela de jobs (drill-down); visões salvas no navegador; CSV e documento para imprimir. De propósito sem cara de dashboard (sem grade de cards) |
| `feed.tsx` | `/feed` ("Mural") | rede social da equipe em cartões (tipo + tempo → autor → texto → anexo → ações; fonte Inter leve): recados (fixáveis pela gestão), reconhecimentos (kudos para uma pessoa) e entregas aprovadas pelo cliente; curtir, responder, compartilhar; lateral com busca, "Esta semana" e "Fora hoje". Eventos negativos (pausa, cancelamento, devolução) não viram post |
| `duty.tsx` | `/duty` | todos. Todos veem "Próximos" (este fim de semana em destaque, próximo, anterior, dias especiais). Supervisão/admin também: "Escala" (calendário do mês + coluna "Pede atenção" com fins de semana sem plantonista e plantonista inativo/ausente, plantões por editor no mês, faturamento por semana), "Sorteio e feriados" e "E-mail" (envio do faturamento, automático, destinatários, SMTP, histórico) |

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
- Ocupação do editor = horas na fila (ex.: "18h na fila", "livre a partir de qui 15/10 16:30"). Não existe mais pontuação.
- **Sempre modo escuro.** Não há opção Claro/Escuro (`ThemeContext` fixa `dark`, `index.html` aplica antes de carregar, `.dark` tem `color-scheme: dark`). Só o tamanho do texto é ajustável (por navegador).
- **Shell** (`components/layout/Shell.tsx`): topo do menu lateral com o botão hamburger (abre/recolhe; sem logo), menu lateral com seções (Trabalho, Gestão, Sistema), indicador do item ativo, pessoa logada no rodapé do menu (abre Meu perfil e Sair; é o único lugar do perfil; estado aberto/recolhido em `localStorage` `sidebar:collapsed`); barra superior (60px, controles de 36px) em três zonas: à esquerda ícone e nome da página atual, no centro a busca com ⌘K, à direita chip "agora" (`components/layout/TopBar.tsx` `NowChip`: editor vê o job em edição ou o próximo; gestor/supervisão veem quantos pedidos, travados, contestações e jobs sem editor esperam por eles; leva à Fila), botão discreto "Criar" (`QuickCreate`: novo job, recado no mural, ausência, conforme o perfil), notificações e tamanho do texto; rodapé com empresa, status do tempo real (socket) e hora de Brasília.

### DateRangePicker (`components/ui/date-range-picker.tsx`)
- Clique em **uma data** define `startDate` E `dueDate` para o mesmo dia (sinaliza job nesse dia específico)
- Clique em **duas datas** define intervalo `startDate → dueDate`
- Display omite a seta quando início = prazo (mesmo dia)

---

### Nome funcional das pessoas
- Filtrar sempre pelo perfil (`role`: admin, supervisor, coordinator, editor), mas exibir o **Cargo / função** do cadastro (`jobTitle`: Atendimento, Editor, Supervisor…) com `roleName(u)` de `@/lib/roles` (sem cargo, cai no nome do perfil). A API devolve `role` e `jobTitle` nas pessoas do job, acompanhantes e mural (`actorTitle`).

### Ícones
- Biblioteca única: **Phosphor Icons** (`@phosphor-icons/react`, MIT). Lucide foi removido.
- Importar sempre de `@/lib/icons` (nunca direto do pacote): lá fica a escolha de cada desenho, com nomes estáveis.
- Espessura padrão `light` via `IconContext` em `App.tsx`; item ativo do menu usa `weight="fill"`.
- Não desenhar SVG próprio nem usar emoji/símbolo de texto como ícone (●, ▶, 🔒…): usar o ícone da biblioteca (`LiveDot` em `components/fila/ui.tsx` para "ao vivo").

## Tarefas Pendentes (backlog)

- **#37** — Push API + Service Worker (notificações nativas do OS)
- Qualquer nova feature: sempre conferir se precisa de migração SQL na VPS

---

## Funcionalidades Implementadas (referência rápida)

| Feature | Arquivo(s) |
|---------|-----------|
| Fila em horas (editor, coordenação, supervisão, feriados) | `lib/queue.ts`, `routes/queue.ts`, `pages/fila/*`, `components/fila/*` |
| DateRangePicker (início → prazo, clique único = mesmo dia) | `components/ui/date-range-picker.tsx` |
| Jobs: escopos, pipeline, atenção, filtros e agrupamentos (prazo, fase, cliente, editor, mês) | `jobs.tsx` |
| Chat DM com paginação e scroll inteligente | `ChatWidget`, `dm.ts` |
| Sistema de rascunhos de tarefa | `tasks-rascunho.tsx`, lógica de status `rascunho` |
| Usuários inativos + ausências (férias/afastamento) | `lib/availability.ts`, `routes/absences.ts`, `components/ui/absence-badge.tsx` |
| Página Membros (só gestão de pessoas: cadastro, perfil de acesso, situação, ausências — sem dados de tarefas) | `pages/team.tsx`, `pages/team-absences.tsx` (`/team/ausencias`), `components/team/*` |

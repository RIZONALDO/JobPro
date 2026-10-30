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
dueDate                           // prazo de entrega: nasce da previsão da fila (+1h) e só muda por ação de gestor
estMinutes                        // horas de trabalho (minutos); obrigatório para entrar na fila
status                            // ver ciclo abaixo
priority                          // 'low' | 'medium' | 'high'
queueOrder, playingSince, queueHold // fila (playingSince = em edição agora; só acompanhamento)
headSince                         // quando virou o 1º da fila do editor (`stampHeads`); a previsão do 1º conta daí
// worked_minutes, start_date, lock_reason, due_date_original e os outros est_*: legado, sem uso
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

### Fila por horas de trabalho (prazo calculado, mover é livre)
Regras em `api-server/src/lib/queue.ts`; rotas em `routes/queue.ts`; avisos em `lib/queue-cron.ts`. `lib/workcal.ts`: datas em "minutos locais", expediente (seg–sex 08:30–12:00 e 14:00–18:30, sáb 08:30–13:00; domingo, feriado e ausência do editor sem expediente) e `consume` (soma minutos de trabalho só dentro do expediente).

- **Cada job tem horas de trabalho** (`est_minutes`, obrigatório no formulário). **O prazo de entrega (`due_date`) é calculado, não se digita** (`schedule` em lib/queue.ts): na ordem da fila do editor, cada job começa quando o anterior termina (o 1º, de quando virou o 1º da fila: `head_since`, tocando ou não em "Começar"; se passou das horas e não saiu, o fim vai até agora), consome as horas no expediente do editor, e o prazo = fim + **1h de expediente** (`BUFFER`). Para mudar o prazo: ajustar as horas ou mudar o lugar na fila. `PUT /tasks/:id` com `dueDate` diferente responde 400.
- **Mudança numa fila recalcula os prazos só dessa fila** (`recalcDues(actor, {editors})`): `watchHeads` compara a fila de cada editor antes e depois da ação (`changedQueues`: ordem, job em edição e horas) e recalcula só as que mudaram; o `PUT /tasks/:id` (horas/status) recalcula a fila do editor do job (e a do anterior, se trocou). Feriados e a migração recalculam todas. O que acontece na fila de um editor nunca mexe nos prazos de outro. Grava só o que mudou, registra `due_auto` no histórico do job e manda **um aviso por gestor** (só mudanças ≥ 15 min feitas por outra pessoa). Não há recálculo contínuo pelo relógio.
- **Mover é livre** (`POST /queue/tasks/:id/move` `{editorId?, index}`): qualquer gestor move qualquer job, na mesma fila ou para outro editor, **sem pedido de aprovação** (os pedidos `te_queue_requests` saíram; a tabela fica sem uso). O job em edição não sai da frente e ninguém entra antes dele. Evento `moved`; o gestor dono é avisado. Front: arrastar na visão Colunas (HTML5 drag-and-drop nativo, com marcador de onde cai) e "Subir/Descer na fila" no menu do job.
- **O prazo é do gestor; ação de editor nunca mexe em prazo.** `recalcDues` sai sem gravar nada quando quem age é editor (Começar, Enviar para aprovação, Travar, `PUT` dele): o prazo não anda. **"Começar" é só acompanhamento** (lembrete e avisos): a previsão do 1º conta de quando ele virou o 1º (`head_since`, carimbado por `stampHeads` em `watchHeads` e a cada minuto no cron, migração `init-head-since.sql`), então não clicar não empurra nada; só passar das horas empurra. Ação de gestor recalcula com o retrato de antes (`before`, e `calBefore` nos feriados): cada job já com prazo anda só o quanto a ação mudou a previsão, em horas de expediente (`workDelta`/`shiftWork` em workcal), então o atraso do editor não é absorvido; job que entra numa fila (novo, trocou de editor) ganha a previsão como prazo. A prévia ao arrastar (`planMove`) faz a mesma conta. A conta está em `newDues`: com o mesmo 1º antes e depois, compara só as horas (`schedule(..., live=false)`, sem o "vai até agora"), senão mudar as horas de um 1º já estourado quase não andaria o prazo (16h → 24h moveu 22 min em vez de 8h, job 404). O formulário de edição mostra o prazo novo antes de salvar (`POST /queue/tasks/:id/due-preview`, mesma conta).
- **Histórico da fila** (`GET /queue/editors/:id/history?days=7|14|30`; editor só o dele): eventos da fila do editor agrupados por ação (mesma pessoa, < 5 s), cada um com a causa (`moved`, `reassign`, `est_changed`, `client_change`, `sent`…) e os prazos recalculados (`due_auto` com `data {from,to}`; registros antigos sem `data` têm o texto lido). Front: botão de relógio no topo do cartão de cada editor (Agenda e Colunas) → modal `components/fila/QueueHistory.tsx` com resumo (mudanças, prazos adiados/adiantados), por dia, "antes → depois" e a diferença (+1d 3h / −5h).
- **Colocar na fila** (`placeTask`; job novo, rascunho, reativar, passar para outro editor): no **fim da fila** (`at: "end"`); destravar e alteração do cliente/reabertura entram **logo depois do job em edição** (`at: "front"`). `mode: "gestor"` = sem editor → supervisão (prazo nulo até ter editor). Prévia: `POST /queue/plan` com `estMinutes` → por editor: posição (fim), quando começa e a entrega prevista (o formulário destaca quem entrega mais cedo).
- **Alteração do cliente / reabertura** pedem as **horas de trabalho da rodada** (`estMinutes`), não um prazo.
- **O editor não mexe na ordem.** Só toca em "Começar" no 1º job, envia para aprovação ou marca "Travado". Atrasado = o prazo passou e o job não foi entregue (`isLate`).
- Status na fila: `pending`, `in_progress`, `in_revision`, `reopened` (com `assigned_to_id` e `queue_hold = false`).
- Ao subir esta versão, `queueByHours` (queue-cron, uma vez, flag `queue_by_hours` em `te_app_settings`) cancela os pedidos pendentes e recalcula todos os prazos pelas horas, na ordem atual, sem mandar avisos. Jobs com `est_minutes = 0` ficam com prazo = começo + 1h e aparecem como "sem horas".
- **Fila de cada editor** (o editor pega o próximo quando entrega o atual; a fila é magnética, sem vão entre jobs). `queueLine(board, editorId)` em `lib/fila.ts` dá, na ordem: atrasado, em risco (job atrasado na frente e prazo em < 24h), folga desde o prazo anterior (com domingo/feriado no meio, de `board.holidays`) e `freeFrom` (último prazo = "livre a partir de"). Em `pages/fila/filas.tsx`, em cima a **Agenda dos editores** (`components/fila/QueueTrack.tsx`, mesmo visual da agenda antiga: um editor por linha, cada dia uma coluna do tamanho do expediente, domingo/feriado estreitos e listrados, sábado à tarde listrado, linha vermelha do agora, visões Dia/Semana/2 semanas com setas pelos 14 dias do board; seus jobs em roxo, os dos outros num tom da cor do gestor com o nome dele (cores em `coordColor`, lib/fila.ts: paleta análoga e fria, do azul ao lima; gestoras ativas ganham as primeiras cores, que variam de matiz e claridade); também na Supervisão) e embaixo as **Colunas** (`EditorQueues`). Os blocos vêm de `editors[].track` (início/fim de cada job pela conta ao vivo, `schedule`), colados um no outro; `axis` dá os dias e `track.offDays` as ausências do editor (listradas). Arrastar um job nas Colunas destaca o mesmo job na Agenda com a etiqueta "arrastando" (os outros apagam); só passar o mouse não destaca. **Prévia ao arrastar:** a cada lugar sob o mouse, `planMove` (lib/fila.ts: `simulateQueue`/`consumeWork`, mesma conta da API, mesmo resultado) simula as filas no navegador; a Agenda redesenha, contorna em âmbar/verde os jobs cujo prazo muda e o rodapé lista "Se soltar aqui: job → novo prazo (+/−)". Nada é gravado até soltar. Os blocos da Agenda também se arrastam (prop `onMove`, mesmo `POST /queue/tasks/:id/move`; menos o job em edição): soltar na linha de um editor põe o job na posição sob o mouse, calculada pelos blocos de antes do arrasto, com a mesma prévia. **Card até o prazo:** cada card vai normal até o prazo gravado (na prévia, o novo); o trabalho que passa do prazo continua no mesmo card, preenchido em âmbar, com "+X além do prazo" (borda tracejada = passou das horas e ainda não saiu, cresce até sair). Contorno vermelho = atrasado. Sem linha de prazo.
- **Travado**: sai da fila; o prazo continua correndo. Crítico = prazo vencido ou vence em menos de 24h (`blockRisk`) → supervisão avisada. Cron lembra o dono a cada 2h.
- **Prazo vencido**: cron avisa dono, editor e acompanhantes uma vez por prazo (`due_passed`).
- **Job em risco** (`due_risk`, antes de vencer): a cada minuto no expediente, se pela conta de agora (`schedule`) a previsão passa 15 min ou mais do prazo (o âmbar da Agenda), avisa o gestor dono uma vez por prazo, com o motivo (o 1º passou das horas / pegou este job depois do previsto / fila na frente não cabe). Não tocar em Começar não é motivo. Um aviso por gestor e editor; evento `due_risk` com `data {due, forecast}`.
- **Lembrete de começar** (`queue_idle`): editor ativo, no expediente, com fila e sem job em edição há 30 min de expediente (desde a última mexida na fila dele, ignorando os eventos do relógio, ou desde o início do expediente) recebe "Você ainda não começou" com o próximo job. Uma vez por job por dia (evento `idle_nudge` com `data {day}`).
- **Encerrar travado que ficou para trás** (`POST /api/queue/tasks/:id/archive`): "Já foi entregue" → `completed`; "Não vai mais ser feito" → `cancelled`. Evento `archived`; relatórios ignoram.
- **Relatórios** (`routes/reports.ts`): só entregas, prazo de entrega (1ª versão até o prazo) e retrabalho (alterações, prazo mudado, travamentos, troca de editor), por período e por cliente.
- **Acompanhantes** (`te_task_followers`, migração `init-followers.sql`): gestores que seguem o job sem ser o dono. Recebem os avisos importantes (pronto para o cliente, travado, aprovado, alteração, prazo mudou/empurrado, troca de editor, cancelado, horas estouradas) e veem o job em "Meus jobs"/"Só os meus". Só o dono do job inclui/tira acompanhantes (nos próprios jobs); ninguém se inclui em job alheio; o acompanhante pode sair. Ações do job continuam com o dono e a supervisão.
- **Passar para outro editor** = `POST /api/queue/tasks/:id/place` (e `/api/tasks/:id/reassign`): qualquer gestor, entra no fim da fila do novo editor (arrastar usa `/move` com a posição).
- **Tudo é registrado** em `te_queue_events` (quem fez, por quê). Daí saem os contadores da supervisão (jobs movidos por quem moveu, alterações do cliente).
- Tempo na API = "minutos locais" (minutos desde 1970 no horário de Brasília); o front formata com `lib/fila.ts`.

### Ocupação do editor
`occupancy(board, editorId)` em `lib/fila.ts`: tamanho da fila em horas de trabalho (soma das horas de todos os jobs, o mesmo número de "na fila" da Agenda), dia = 8h. Fila maior = mais carregado. Cor por 3 faixas (`occColor`): leve até 2 dias (verde), cheia 2 a 4 (âmbar), alta mais de 4 (vermelho); cinza sem jobs. A barra enche em 5 dias (`OCC_FULL`). `components/fila/Occupancy.tsx`: `OccAvatar` (anel no avatar, cheio em 5 dias) e `OccMeter` (só a barrinha colorida; o detalhe fica no tooltip), no cabeçalho de cada fila. Na Agenda, cada linha mostra só avatar, nome e horas na fila (sem barra de ocupação). Sem textos nem legenda.

### Tour guiado
`components/tour/Tour.tsx`: escurece a tela, ilumina o elemento real do passo (`data-tour="…"`) e mostra um painel de controle fixo embaixo, no centro (não muda de lugar), com o texto do passo, mapa dos passos clicável e Voltar / Avançar / Pular (setas e Esc também); a página rola para o elemento ficar acima do painel. Abre sozinho na primeira visita (localStorage `tour.<id>.visto`) e pelo botão "?" do topo (`startTour()`, só gestão; fora da Fila, navega para `/fila` antes). O tour da gestão (`id="fila-gestor"`, passos em `TOUR` de `pages/fila/filas.tsx`) passa por Novo job, Precisa de você, Avisos, Agenda, arrastar bloco, histórico, Fila de cada editor, menu do job, sininho e o próprio "?". Elemento ausente → cartão no centro.

### Notificações: Avisos × sininho
Tudo fica em `te_notifications`; o front separa pelo `type` (`lib/notices.ts`, `IMPORTANT`), sem repetir:
- **Avisos** (`components/fila/Notices.tsx`, painel na Fila e em Minha fila): só o que pede atenção ou ação — `due_passed`, `queue_blocked`, `queue_escalated` (vermelho), `due_risk`, `queue_idle`, `task_review`, `task_revision`, `task_reopened`, `task_returned`, `task_paused`, `task_cancelled` (âmbar), `task_assigned` (azul). Não vistos primeiro, com ponto; clicar abre o job e marca como visto; "Marcar como vistos" só mexe nesses.
- **Sininho** (`Shell`): o resto, informativo do sistema (prazo recalculado, job movido, começou, aprovado, troca de editor, mural…). Contador, "marcar todas" e "limpar" só mexem nas do sininho. O som toca para todas.

### Usuários inativos × ausências
Lógica central em `api-server/src/lib/availability.ts` (espelho no front: `team-edit/src/lib/availability.ts`).
- **Inativo** (`te_users.status = 'inactive'`) = saiu da equipe. Fica fora das filas, seletores, menções, notificações e plantões novos; a API recusa (400) atribuir tarefa/plantão a inativo. Histórico continua mostrando o nome. Ao inativar: sessões são encerradas, ausências futuras removidas e, opcionalmente, plantões futuros (`removeFutureDuties`). `GET /api/users/:id/pending` lista o que ficou em aberto.
- **Nunca excluir** quem tem histórico — `DELETE /api/users/:id` responde 409 (plantões têm `ON DELETE CASCADE`).
- `GET /api/users` devolve todos (inclusive inativos, para histórico); use `?active=1` em seletores/menções. Cada usuário vem com `absence` (ausência de hoje).
- **Ausência** (`/api/absences`) = pessoa continua ativa; a fila pula os dias de ausência; plantões só sinalizam e o sistema **avisa sem bloquear** (`period-check.absenceMessage`, `warning` no `POST /api/duty`).
- Na agenda, inativos só aparecem se ainda tiverem tarefa aberta (para serem reatribuídas).
- **Redistribuir jobs** (`routes/queue.ts`, seção REDISTRIBUIR; tela `components/fila/HandoffDialog.tsx`, aberta com `openHandoff()`, host no Shell, só supervisão/admin):
  - `POST /api/queue/handoff/:userId/preview` sugere para cada job o editor com menos jobs na fila (contando os já redistribuídos), no fim da fila. Em ausência, sugere "fica com a pessoa" quando o prazo é depois da volta. `choices` fixa o que o supervisor escolheu; o resto se reajusta.
  - `POST /api/queue/handoff/:userId` aplica: primeiro troca o responsável (`createdById`, com evento `owner`, pedidos pendentes e aviso ao novo gestor), depois passa os jobs da fila por `placeTask` (pela supervisão, então direto). Job com o cliente, travado ou rascunho só troca o editor.
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
GET  /api/queue/board       — fila de todos (editor: só a dele): posição, horas, prazo calculado, atrasados, contadores, feriados
POST /api/queue/plan        — prévia: com as horas, a entrega prevista no fim da fila de cada editor (não grava)
POST /api/queue/tasks/:id/{play,send,block,unblock,archive,client-ok,client-change,place,move}
GET  /api/queue/editors/:id/history — histórico da fila do editor: mudanças e prazos antes → depois
/api/queue/holidays
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
| `fila/supervisao.tsx` | `/fila/supervisao` | admin/supervisor (jobs por editor, sem editor, contadores, feriados) |
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
- Toast com `sonner`: `toast.success()` / `toast.error()` (aceita `action: {label, onClick}`). Não há o Toaster do sonner: `components/layout/StatusLine.tsx` (montado no `Shell`) ouve os toasts (`useSonner`) e mostra cartões escuros e elevados no estilo das flags do Jira/toasts do Asana, no canto inferior direito acima do chat, até 3 empilhados (o mais novo embaixo). A 1ª frase vira o título em negrito e o resto o detalhe; ícone Phosphor colorido; ação em texto; some em 5 s (erro 8 s), mouse em cima pausa, X fecha
- Sem `localStorage` — estado em React state ou contexto

### Estilo visual
- Badge de revisões: chip âmbar pequeno — `bg-amber-50 border-amber-200 text-amber-600`
- Ocupação do editor = quantos jobs tem na fila (ex.: "4 jobs na fila · 1 atrasado"). Sem horas nem pontuação.
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
| Fila simples (editor, coordenação, supervisão, feriados) | `lib/queue.ts`, `routes/queue.ts`, `pages/fila/*`, `components/fila/*` |
| DateRangePicker (início → prazo, clique único = mesmo dia) | `components/ui/date-range-picker.tsx` |
| Jobs: escopos, pipeline, atenção, filtros e agrupamentos (prazo, fase, cliente, editor, mês) | `jobs.tsx` |
| Chat DM com paginação e scroll inteligente | `ChatWidget`, `dm.ts` |
| Sistema de rascunhos de tarefa | `tasks-rascunho.tsx`, lógica de status `rascunho` |
| Usuários inativos + ausências (férias/afastamento) | `lib/availability.ts`, `routes/absences.ts`, `components/ui/absence-badge.tsx` |
| Página Membros (só gestão de pessoas: cadastro, perfil de acesso, situação, ausências — sem dados de tarefas) | `pages/team.tsx`, `pages/team-absences.tsx` (`/team/ausencias`), `components/team/*` |

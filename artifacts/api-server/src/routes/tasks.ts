import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable, taskEditorsTable, taskFollowersTable } from "@workspace/db";
import { eq, ne, desc, asc, and, or, gte, lte, isNotNull, lt, inArray, notInArray, isNull, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify, notifyFollowers } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";
import { findInactive } from "../lib/availability.js";
import { placeTask, playTask, sendToApproval, stopTask, newRound, parseEst } from "./queue.js";
import { loadState, logEvent, recalcDues, QUEUE_STATUSES } from "../lib/queue.js";
import { fmtH } from "../lib/workcal.js";

/** Responde 400 se algum dos ids for de usuário inativo. Retorna true se bloqueou. */
async function rejectInactive(res: import("express").Response, ids: (number | null | undefined)[]): Promise<boolean> {
  const inactive = await findInactive(ids.filter((n): n is number => typeof n === "number"));
  if (inactive.length === 0) return false;
  const names = inactive.map(u => u.name).join(", ");
  res.status(400).json({ error: `${names} ${inactive.length > 1 ? "estão inativos" : "está inativo"} e não pode receber tarefas` });
  return true;
}

const router = Router();

function fmtCode(num: number, year: number): string {
  return `${String(num).padStart(3, "0")}.${String(year).padStart(2, "0")}`;
}

const dueDateKey = (d: Date | string | null | undefined): string => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
};

// ── Create task ──────────────────────────────────────────────────────────────
router.post("/tasks", requireCoordinator, async (req, res): Promise<void> => {
  // O job nasce sem lugar na fila e é colocado por placeTask (fim da fila, ou supervisão). O prazo sai das horas.
  const { title, description, estMinutes, priority, folderUrl, client, color, status, placement, assignedToId, followerIds } = req.body ?? {};

  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }
  const isDraft = status === "rascunho";
  if (!isDraft) {
    if (!parseEst(estMinutes)) { res.status(400).json({ error: "Informe as horas de trabalho" }); return; }
    if (!placement || (!placement.editorId && placement.mode !== "gestor")) { res.status(400).json({ error: "Escolha onde o job entra" }); return; }
    if (placement.editorId && await rejectInactive(res, [Number(placement.editorId)])) return;
  }

  const seqResult = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
  const taskNumber = Number((seqResult.rows ?? seqResult)[0].nextval);
  const taskYear = new Date().getFullYear() % 100;

  const [task] = await db.insert(tasksTable).values({
    taskNumber,
    taskYear,
    title: String(title),
    description: description ? String(description) : null,
    client: client ? String(client) : null,
    color: color ? String(color) : "#6366f1",
    estMinutes: parseEst(estMinutes) ?? 0,
    priority: priority ?? "medium",
    status: isDraft ? "rascunho" : "pending",
    // rascunho guarda o editor pretendido; job publicado só ganha editor ao entrar na fila
    assignedToId: isDraft && assignedToId ? Number(assignedToId) : null,
    queueHold: !isDraft,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
  }).returning();

  await logEvent({ kind: "created", taskId: task.id, actorId: req.session.userId, coordId: req.session.userId, text: isDraft ? "Rascunho criado" : "Job criado" });
  if (Array.isArray(followerIds) && followerIds.length) await setFollowers(task.id, followerIds, req.session.userId!);
  if (isDraft) { broadcastTaskChange(); res.status(201).json(task); return; }

  const out = await placeTask(task.id, placement.editorId ? Number(placement.editorId) : null, String(placement.mode ?? "fila"), req.session.userId!, req.session.userRole!);
  if (out.status !== 200) {
    // não entrou: volta a ser rascunho para não sumir
    await db.update(tasksTable).set({ status: "rascunho", queueHold: false }).where(eq(tasksTable.id, task.id));
    broadcastTaskChange();
    res.status(out.status).json({ ...out.body, draftId: task.id });
    return;
  }
  res.status(201).json({ ...task, ...out.body });
});

// ── Acompanhantes (gestores que seguem o job sem ser o dono) ─────────────────
const FOLLOWER_ROLES = ["coordinator", "supervisor", "admin"];

/** Troca a lista de acompanhantes (só o dono do job chama). Ignora o dono, inativos e quem não é gestor. Avisa só quem entrou agora. */
async function setFollowers(taskId: number, userIds: unknown[], actorId: number): Promise<number[]> {
  const [t] = await db.select({ createdById: tasksTable.createdById, title: tasksTable.title }).from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!t) return [];
  const want = [...new Set(userIds.map(Number).filter(n => Number.isInteger(n) && n !== t.createdById))];
  const ok = want.length ? await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(inArray(usersTable.id, want), inArray(usersTable.role, FOLLOWER_ROLES), eq(usersTable.status, "active"))) : [];
  const valid = ok.map(u => u.id);
  const rows = await db.select({ userId: taskFollowersTable.userId, addedById: taskFollowersTable.addedById }).from(taskFollowersTable).where(eq(taskFollowersTable.taskId, taskId));
  const before = rows.map(r => r.userId);
  const gone = before.filter(id => !valid.includes(id)), added = valid.filter(id => !before.includes(id));
  if (gone.length) await db.delete(taskFollowersTable).where(and(eq(taskFollowersTable.taskId, taskId), inArray(taskFollowersTable.userId, gone)));
  if (added.length) await db.insert(taskFollowersTable).values(added.map(userId => ({ taskId, userId, addedById: actorId }))).onConflictDoNothing();
  if (added.length) {
    const [actor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId));
    for (const uid of added) if (uid !== actorId) await notify(uid, "task_follow", "Você está acompanhando um job",
      `${actor?.name ?? "Alguém"} incluiu você para acompanhar "${t.title}". Você recebe os avisos importantes dele.`, { taskId });
    await logEvent({ kind: "follow", taskId, actorId, coordId: t.createdById, text: `Acompanhando: ${added.length} pessoa(s) incluída(s)` });
  }
  return valid;
}

// só o dono do job (gestor ou supervisor que criou) escolhe quem acompanha
router.put("/tasks/:id/followers", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [t] = await db.select({ createdById: tasksTable.createdById }).from(tasksTable).where(eq(tasksTable.id, id));
  if (!t) { res.status(404).json({ error: "Job não encontrado" }); return; }
  const me = req.session.userId!;
  if (t.createdById !== me) { res.status(403).json({ error: "Só o gestor dono do job escolhe quem acompanha" }); return; }
  const list = await setFollowers(id, Array.isArray(req.body?.userIds) ? req.body.userIds : [], me);
  broadcastTaskChange();
  res.json({ followerIds: list });
});

// quem foi incluído pode sair por conta própria (não existe "seguir" job dos outros)
router.delete("/tasks/:id/follow", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10), me = req.session.userId!;
  await db.delete(taskFollowersTable).where(and(eq(taskFollowersTable.taskId, id), eq(taskFollowersTable.userId, me)));
  broadcastTaskChange();
  res.json({ ok: true });
});

// ── Overview (coordinator: all tasks created by coordinators) ────────────────
router.get("/tasks/overview", requireCoordinator, async (req, res): Promise<void> => {
  const { status, assignedToId, createdById } = req.query;
  const userId = req.session.userId!;

  const coordUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, ["coordinator", "supervisor", "admin"]));
  const coordIds = coordUsers.map(u => u.id);
  if (coordIds.length === 0) { res.json([]); return; }
  const ownerCondition = inArray(tasksTable.createdById, coordIds);

  const conditions: any[] = [ownerCondition];

  if (status === "active") {
    conditions.push(ne(tasksTable.status, "completed"));
    conditions.push(ne(tasksTable.status, "cancelled"));
  } else if (status && status !== "all") {
    conditions.push(eq(tasksTable.status, String(status)));
  } else if (!status) {
    conditions.push(ne(tasksTable.status, "completed"));
    conditions.push(ne(tasksTable.status, "cancelled"));
  }
  if (assignedToId) conditions.push(eq(tasksTable.assignedToId, parseInt(String(assignedToId), 10)));
  if (createdById) conditions.push(eq(tasksTable.createdById, parseInt(String(createdById), 10)));

  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt));

  const taskIds = rows.map(r => r.id);

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter((id): id is number => id !== null))];

  const persons = personIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, personIds))
    : [];
  const personMap = new Map(persons.map(p => [p.id, p]));

  const editorRows = taskIds.length
    ? await db
        .select({
          taskId: taskEditorsTable.taskId,
          userId: usersTable.id,
          name: usersTable.name,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(taskEditorsTable)
        .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, taskIds))
    : [];

  const editorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of editorRows) {
    if (!editorsMap.has(e.taskId)) editorsMap.set(e.taskId, []);
    editorsMap.get(e.taskId)!.push({ id: e.userId, name: e.name, avatarUrl: e.avatarUrl });
  }

  // reviewedAt: quando a tarefa foi enviada para review pela PRIMEIRA vez
  const overviewReviewEvents = taskIds.length
    ? await db.select({ taskId: taskEventsTable.taskId, createdAt: taskEventsTable.createdAt })
        .from(taskEventsTable)
        .where(and(inArray(taskEventsTable.taskId, taskIds), eq(taskEventsTable.toStatus, "review")))
        .orderBy(asc(taskEventsTable.createdAt))
    : [];
  const overviewReviewedAtMap = new Map<number, Date>();
  for (const e of overviewReviewEvents) {
    if (!overviewReviewedAtMap.has(e.taskId)) overviewReviewedAtMap.set(e.taskId, e.createdAt);
  }
  // quando foi concluído/cancelado de fato (updatedAt muda com qualquer edição)
  const closeEvents = taskIds.length
    ? await db.select({ taskId: taskEventsTable.taskId, createdAt: taskEventsTable.createdAt })
        .from(taskEventsTable)
        .where(and(inArray(taskEventsTable.taskId, taskIds), inArray(taskEventsTable.toStatus, ["completed", "cancelled"])))
        .orderBy(asc(taskEventsTable.createdAt))
    : [];
  const followRows = taskIds.length
    ? await db.select({ taskId: taskFollowersTable.taskId, userId: taskFollowersTable.userId }).from(taskFollowersTable).where(inArray(taskFollowersTable.taskId, taskIds))
    : [];
  const closedAtMap = new Map<number, Date>();
  for (const e of closeEvents) closedAtMap.set(e.taskId, e.createdAt);

  res.json(rows.map(r => ({
    id: r.id,
    taskCode: fmtCode(r.taskNumber, r.taskYear),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    startDate: r.startDate,
    dueDate: r.dueDate,
    estMinutes: r.estMinutes,
    folderUrl: r.folderUrl,
    revisionCount: r.revisionCount ?? 0,
    client: r.client,
    assignee: r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
    editors: editorsMap.get(r.id) ?? [],
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    isOwn: r.createdById === userId,
    followerIds: followRows.filter(f => f.taskId === r.id).map(f => f.userId),
    isFollowing: followRows.some(f => f.taskId === r.id && f.userId === userId),
    updatedAt: r.updatedAt, createdAt: r.createdAt,
    reviewedAt: overviewReviewedAtMap.get(r.id)?.toISOString() ?? null,
    closedAt: closedAtMap.get(r.id)?.toISOString() ?? null,
  })));
});

// ── Status history (stacked line chart data) ──────────────────────────────────
router.get("/tasks/status-history", requireAuth, async (req, res): Promise<void> => {
  const DAYS = 14;
  const STATUS_KEYS = ["pending", "in_progress", "in_revision", "review", "completed", "paused", "cancelled"];

  const nowMs = Date.now();

  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 86_400_000);
    dates.push(d.toISOString().split("T")[0]);
  }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;

  const taskFilter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : (role === "coordinator" || role === "supervisor")
      ? eq(tasksTable.createdById, userId)
      : undefined;

  const allTasks = await db
    .select({ id: tasksTable.id, createdAt: tasksTable.createdAt })
    .from(tasksTable)
    .where(taskFilter);

  const allEvents = await db
    .select({ taskId: taskEventsTable.taskId, toStatus: taskEventsTable.toStatus, createdAt: taskEventsTable.createdAt })
    .from(taskEventsTable)
    .orderBy(asc(taskEventsTable.createdAt));

  const evtByTask = new Map<number, { toStatus: string; ts: number }[]>();
  for (const e of allEvents) {
    const ts = e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt).getTime();
    if (!evtByTask.has(e.taskId)) evtByTask.set(e.taskId, []);
    evtByTask.get(e.taskId)!.push({ toStatus: e.toStatus, ts });
  }

  const series: Record<string, number[]> = {};
  STATUS_KEYS.forEach(k => { series[k] = []; });

  for (const dateStr of dates) {
    const dayEndMs = new Date(dateStr + "T23:59:59.999Z").getTime();

    const counts: Record<string, number> = {};
    STATUS_KEYS.forEach(k => { counts[k] = 0; });

    for (const task of allTasks) {
      const createdMs = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
      if (createdMs > dayEndMs) continue;

      const evts = evtByTask.get(task.id) ?? [];
      let status = "pending";
      for (const e of evts) {
        if (e.ts <= dayEndMs) status = e.toStatus;
        else break;
      }
      if (counts[status] !== undefined) counts[status]++;
    }

    STATUS_KEYS.forEach(k => series[k].push(counts[k]));
  }

  res.json({ dates, series });
});

// ── Weekly Heatmap ────────────────────────────────────────────────────────────
router.get("/tasks/heatmap", requireCoordinator, async (_req, res): Promise<void> => {
  const tasks = await db
    .select({
      assignedToId: tasksTable.assignedToId,
      dueDate:      tasksTable.dueDate,
      status:       tasksTable.status,
      title:        tasksTable.title,
      client:       tasksTable.client,
    })
    .from(tasksTable)
    .where(
      and(
        ne(tasksTable.status, "completed"),
        ne(tasksTable.status, "cancelled"),
        ne(tasksTable.status, "rascunho"),
        isNotNull(tasksTable.dueDate),
        isNotNull(tasksTable.assignedToId),
      )
    );
  res.json(tasks);
});

// ── Get single task ──────────────────────────────────────────────────────────
router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const person = { id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, role: usersTable.role, jobTitle: usersTable.jobTitle };
  const [createdBy] = task.createdById
    ? await db.select(person).from(usersTable).where(eq(usersTable.id, task.createdById))
    : [null];
  const [assignedTo] = task.assignedToId
    ? await db.select(person).from(usersTable).where(eq(usersTable.id, task.assignedToId))
    : [null];
  const revisions = await db
    .select({ id: taskRevisionsTable.id, revisionNumber: taskRevisionsTable.revisionNumber, comment: taskRevisionsTable.comment, createdAt: taskRevisionsTable.createdAt })
    .from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, id)).orderBy(asc(taskRevisionsTable.revisionNumber));

  const editorRows = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(taskEditorsTable)
    .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
    .where(eq(taskEditorsTable.taskId, id));

  // mudanças de status (jobs antigos não têm eventos da fila; isto completa o histórico)
  const statusEvents = await db
    .select({ id: taskEventsTable.id, from: taskEventsTable.fromStatus, to: taskEventsTable.toStatus, by: usersTable.name, at: taskEventsTable.createdAt })
    .from(taskEventsTable).leftJoin(usersTable, eq(usersTable.id, taskEventsTable.changedById))
    .where(eq(taskEventsTable.taskId, id)).orderBy(asc(taskEventsTable.createdAt));

  const followers = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, role: usersTable.role, jobTitle: usersTable.jobTitle, addedById: taskFollowersTable.addedById })
    .from(taskFollowersTable).innerJoin(usersTable, eq(usersTable.id, taskFollowersTable.userId))
    .where(eq(taskFollowersTable.taskId, id)).orderBy(asc(taskFollowersTable.createdAt));

  res.json({
    ...task,
    statusEvents,
    followers,
    taskCode: fmtCode(task.taskNumber, task.taskYear),
    createdBy: createdBy ?? null,
    assignedTo: assignedTo ?? null,
    revisions,
    editors: editorRows,
  });
});

// ── Update task ──────────────────────────────────────────────────────────────
router.put("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  const { title, description, dueDate, estMinutes, priority, assignedToId, folderUrl, status, revisionComment, client, color, placement } = req.body ?? {};
  const update: Record<string, unknown> = {};
  let eventComment: string | undefined;

  if (role === "editor") {
    const [editorEntry] = await db.select({ taskId: taskEditorsTable.taskId })
      .from(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));
    const isAssigned = task.assignedToId === userId || !!editorEntry;
    if (!isAssigned) { res.status(403).json({ error: "Sem permissão" }); return; }
    if (status) {
      // Na fila o editor só começa e entrega; as regras ficam em routes/queue.ts.
      const s = String(status);
      const st = await loadState();
      if (s === "in_progress" && QUEUE_STATUSES.includes(task.status)) {
        await playTask(st, task, userId);
      } else if (s === "review" && QUEUE_STATUSES.includes(task.status)) {
        await sendToApproval(task, userId);
      } else { res.status(400).json({ error: "Transição de status não permitida" }); return; }
      broadcastTaskChange();
      const [fresh] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
      res.json(fresh); return;
    }
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
  } else {
    if (role === "coordinator" && task.createdById !== userId) {
      res.status(403).json({ error: "Sem permissão para editar esta tarefa. Apenas o criador ou um Supervisor pode fazer isso." }); return;
    }
    if (title) update.title = String(title);
    if (description !== undefined) update.description = description ? String(description) : null;
    if (client !== undefined) update.client = client ? String(client) : null;
    if (color) update.color = String(color);
    // o prazo de entrega é calculado (horas de trabalho + lugar na fila): não se digita
    if (dueDate !== undefined && dueDate !== null && dueDate !== "" && (!task.dueDate || +new Date(String(dueDate)) !== +task.dueDate)) {
      res.status(400).json({ error: "O prazo de entrega sai das horas de trabalho e do lugar na fila. Ajuste as horas ou mova o job." }); return;
    }
    if (estMinutes !== undefined) {
      const est = parseEst(estMinutes);
      if (!est) { res.status(400).json({ error: "Horas de trabalho inválidas" }); return; }
      update.estMinutes = est;
    }
    if (priority) update.priority = String(priority);
    // rascunho guarda o editor pretendido; nos demais, trocar de editor passa pela fila (placement)
    if (assignedToId !== undefined && task.status === "rascunho") {
      update.assignedToId = assignedToId ? parseInt(String(assignedToId), 10) : null;
    }
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
    if (status) {
      const s = String(status);
      const TERMINAL = ["completed", "cancelled"];

      if (s === "cancelled" || s === "paused") {
        if (TERMINAL.includes(task.status)) {
          res.status(400).json({ error: "Não é possível alterar uma tarefa já finalizada ou cancelada" }); return;
        }
        const actionComment = revisionComment ? String(revisionComment).trim() : "";
        if (!actionComment) {
          res.status(400).json({ error: s === "cancelled" ? "Informe o motivo do cancelamento" : "Informe o motivo da pausa" }); return;
        }
        eventComment = actionComment;
        update.status = s;
        await stopTask(task);
        await logEvent({ kind: s === "paused" ? "blocked" : "cancelled", taskId: id, actorId: userId, coordId: task.createdById, editorId: task.assignedToId, text: actionComment });
      } else if (s === "reopened") {
        if (task.status !== "completed") {
          res.status(400).json({ error: "Só é possível reabrir tarefas aprovadas" }); return;
        }
        const comment = revisionComment ? String(revisionComment).trim() : "";
        if (!comment) { res.status(400).json({ error: "Informe o motivo da reabertura" }); return; }
        const est = update.estMinutes as number | undefined; delete update.estMinutes;
        if (!est) { res.status(400).json({ error: "Informe as horas de trabalho da reabertura" }); return; }
        if (Object.keys(update).length) await db.update(tasksTable).set(update).where(eq(tasksTable.id, id));
        const out = await newRound(task, userId, role, comment, true, est);
        res.status(out.status).json(out.body); return;
      } else if (s === "pending" && task.status === "cancelled") {
        if (!((update.estMinutes as number | undefined) ?? task.estMinutes)) {
          res.status(400).json({ error: "Informe as horas de trabalho para reativar o job" }); return;
        }
        // reativado volta para o fim da fila do mesmo editor
        await db.update(tasksTable).set({ ...update, status: "pending", queueHold: false }).where(eq(tasksTable.id, id));
        await db.insert(taskEventsTable).values({ taskId: id, fromStatus: "cancelled", toStatus: "pending", changedById: userId });
        if (!task.assignedToId) { broadcastTaskChange(); res.json({ message: "Job reativado, sem editor" }); return; }
        const out = await placeTask(id, task.assignedToId, "fila", userId, role);
        if (out.status !== 200) {
          await db.update(tasksTable).set({ status: "cancelled" }).where(eq(tasksTable.id, id));
          broadcastTaskChange();
        }
        res.status(out.status).json(out.body); return;
      } else if (s === "pending" && task.status === "paused") {
        // destravar: volta para a fila do editor logo depois do job em edição
        if (Object.keys(update).length) await db.update(tasksTable).set(update).where(eq(tasksTable.id, id));
        if (!task.assignedToId) { res.status(400).json({ error: "O job está sem editor: escolha um em “Passar para outro editor”" }); return; }
        const out = await placeTask(id, task.assignedToId, "fila", userId, role, { at: "front" });
        res.status(out.status).json(out.body); return;
      } else if (s === "pending" && task.status === "rascunho") {
        // publicar rascunho = colocar na fila
        if (!((update.estMinutes as number | undefined) ?? task.estMinutes)) { res.status(400).json({ error: "Informe as horas de trabalho antes de publicar" }); return; }
        const pl = placement ?? (task.assignedToId ? { editorId: task.assignedToId, mode: "fila" } : null);
        if (!pl || (!pl.editorId && pl.mode !== "gestor")) { res.status(400).json({ error: "Escolha onde o job entra" }); return; }
        if (pl.editorId && await rejectInactive(res, [Number(pl.editorId)])) return;
        await db.update(tasksTable).set({ ...update, status: "pending", assignedToId: null, queueHold: true }).where(eq(tasksTable.id, id));
        await db.insert(taskEventsTable).values({ taskId: id, fromStatus: "rascunho", toStatus: "pending", changedById: userId });
        const out = await placeTask(id, pl.editorId ? Number(pl.editorId) : null, String(pl.mode ?? "fila"), userId, role);
        if (out.status !== 200) {
          await db.update(tasksTable).set({ status: "rascunho", queueHold: false }).where(eq(tasksTable.id, id));
          broadcastTaskChange();
          res.status(out.status).json(out.body); return;
        }
        const [fresh] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
        res.json({ ...fresh, ...out.body }); return;
      } else {
        // Avaliação do que foi entregue (task must be in "review")
        if (task.status !== "review") { res.status(400).json({ error: `Coordenador só pode avaliar tarefas em revisão (status atual: ${task.status})` }); return; }
        if (!["completed", "in_progress"].includes(s)) { res.status(400).json({ error: "Transição inválida" }); return; }
        if (s === "in_progress") {
          const comment = revisionComment ? String(revisionComment).trim() : "";
          if (!comment) { res.status(400).json({ error: "Informe o comentário da alteração" }); return; }
          const est = update.estMinutes as number | undefined; delete update.estMinutes;
          if (!est) { res.status(400).json({ error: "Informe as horas de trabalho da alteração" }); return; }
          if (Object.keys(update).length) await db.update(tasksTable).set(update).where(eq(tasksTable.id, id));
          const out = await newRound(task, userId, role, comment, false, est);
          res.status(out.status).json(out.body); return;
        }
        update.status = s;
        update.playingSince = null;
      }
    }
  }

  const [updated] = Object.keys(update).length
    ? await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning()
    : await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  // horas mudaram (ou o job saiu da fila): os prazos da fila são recalculados
  const estChanged = update.estMinutes !== undefined && update.estMinutes !== task.estMinutes;
  if (estChanged) await logEvent({ kind: "est_changed", taskId: id, actorId: userId, coordId: task.createdById, editorId: task.assignedToId, text: `Horas de trabalho: ${fmtH(task.estMinutes ?? 0)} → ${fmtH(update.estMinutes as number)}` });
  // só a fila do editor do job (e a do editor anterior, se trocou)
  if (estChanged || update.status) await recalcDues(userId, { editors: [task.assignedToId, updated?.assignedToId].filter((e): e is number => e != null) });

  if (update.status && update.status !== task.status) {
    const resolvedComment = eventComment
      || undefined;
    await db.insert(taskEventsTable).values({
      taskId: id,
      fromStatus: task.status,
      toStatus: String(update.status),
      changedById: userId,
      ...(resolvedComment ? { revisionComment: resolvedComment } : {}),
    });
  }

  const newStatus = update.status as string | undefined;
  if (newStatus && newStatus !== task.status) {
    if (newStatus === "review" && task.createdById) {
      const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      await notify(task.createdById, "task_review",
        "Tarefa enviada para aprovação",
        `${editor?.name ?? "Editor"} enviou "${task.title}" para aprovação`,
        { taskId: id }
      );
    }
    if (newStatus === "in_progress" && task.createdById && task.createdById !== userId) {
      const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      await notify(task.createdById, "task_started",
        "Tarefa em edição",
        `${editor?.name ?? "Editor"} iniciou a edição de "${task.title}"`,
        { taskId: id }
      );
    }
    if (newStatus === "in_revision") {
      // Notifica o responsável e os editores adicionais
      const comment = revisionComment ? String(revisionComment).trim() : "";
      const recipients = new Set<number>();
      if (task.assignedToId) recipients.add(task.assignedToId);
      const extraEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      extraEditors.forEach(e => recipients.add(e.userId));
      for (const rid of recipients) {
        await notify(rid, "task_revision",
          "Alteração solicitada",
          `Alteração solicitada em "${task.title}"${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "cancelled") {
      const comment = eventComment ?? "";
      const cancelledEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const cancelRecipients = new Set<number>(cancelledEditors.map(e => e.userId));
      if (task.assignedToId) cancelRecipients.add(task.assignedToId);
      for (const recipientId of cancelRecipients) {
        await notify(recipientId, "task_cancelled",
          "Tarefa cancelada",
          `A tarefa "${task.title}" foi cancelada${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
      await notifyFollowers(id, [userId, ...cancelRecipients], "task_cancelled", "Job cancelado", `"${task.title}" foi cancelado${comment ? `: ${comment}` : ""}.`);
    }
    if (newStatus === "paused") {
      const comment = eventComment ?? "";
      const pausedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const pauseRecipients = new Set<number>(pausedEditors.map(e => e.userId));
      if (task.assignedToId) pauseRecipients.add(task.assignedToId);
      for (const recipientId of pauseRecipients) {
        await notify(recipientId, "task_paused",
          "Tarefa pausada",
          `A tarefa "${task.title}" foi pausada${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
    }
    if ((newStatus === "pending" || newStatus === "in_progress") && task.status === "paused") {
      const resumedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const resumeRecipients = new Set<number>(resumedEditors.map(e => e.userId));
      if (task.assignedToId) resumeRecipients.add(task.assignedToId);
      for (const recipientId of resumeRecipients) {
        await notify(recipientId, "task_resumed",
          "Tarefa retomada",
          `A tarefa "${task.title}" foi retomada pelo coordenador`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "pending" && task.status === "cancelled") {
      const reactivatedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const reactivateRecipients = new Set<number>(reactivatedEditors.map(e => e.userId));
      if (task.assignedToId) reactivateRecipients.add(task.assignedToId);
      for (const recipientId of reactivateRecipients) {
        await notify(recipientId, "task_reactivated",
          "Tarefa reativada",
          `A tarefa "${task.title}" foi reativada pelo coordenador`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "pending" && task.status === "rascunho") {
      const editorRows = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      for (const { userId: editorId } of editorRows) {
        await notify(editorId, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi publicada e atribuída a você`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "completed" && task.assignedToId) {
      await notify(task.assignedToId, "task_approved",
        "Tarefa aprovada",
        `Sua tarefa "${task.title}" foi aprovada`,
        { taskId: id }
      );
      await createFeedItem({
        type: "task_completed",
        title: `Tarefa concluída: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
    }
    if (newStatus === "reopened") {
      const comment = revisionComment ? String(revisionComment).trim() : "";
      if (task.assignedToId) {
        await notify(task.assignedToId, "task_reopened",
          "Tarefa reaberta",
          `A tarefa "${task.title}" foi reaberta${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
      const editorRows = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      for (const { userId: editorId } of editorRows) {
        if (editorId !== task.assignedToId) {
          await notify(editorId, "task_reopened",
            "Tarefa reaberta",
            `A tarefa "${task.title}" foi reaberta${comment ? `: ${comment}` : ""}`,
            { taskId: id }
          );
        }
      }
    }

  }

  if (update.assignedToId !== undefined && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number | null;
    const oldEditor = task.assignedToId;

    if (task.status !== "rascunho") {
      if (oldEditor) {
        await notify(oldEditor, "task_reassigned",
          "Tarefa reatribuída",
          `A tarefa "${task.title}" foi reatribuída a outro editor`,
          { taskId: id }
        );
      }
      if (newEditor) {
        await notify(newEditor, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi atribuída a você`,
          { taskId: id }
        );
      }
    }
    if (newEditor) {
      await db.insert(taskEditorsTable).values({
        taskId: id, userId: newEditor, assignedById: req.session.userId,
      }).onConflictDoNothing();
    }
    if (oldEditor && oldEditor !== newEditor) {
      await db.delete(taskEditorsTable)
        .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, oldEditor)));
    }
  }

  if (update.dueDate !== undefined) {
    const oldDate = task.dueDate ? (task.dueDate as Date).toISOString().split("T")[0] : null;
    const newDate = update.dueDate ? (update.dueDate as Date).toISOString().split("T")[0] : null;
    if (oldDate !== newDate) {
      const fmtBR = (iso: string | null) => iso ? iso.split("-").reverse().join("/") : "—";
      const recipients = new Set<number>();
      if (task.assignedToId) recipients.add(task.assignedToId);
      const extraEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      extraEditors.forEach(e => recipients.add(e.userId));
      if (task.status !== "rascunho") {
        for (const recipientId of recipients) {
          await notify(recipientId, "due_date_changed",
            "Prazo alterado",
            `O prazo de "${task.title}" foi alterado para ${fmtBR(newDate)}`,
            { taskId: id }
          );
        }
        await notifyFollowers(id, [userId, ...recipients], "due_date_changed", "Prazo alterado", `O prazo de "${task.title}" foi alterado para ${fmtBR(newDate)}`);
      }
    }
  }

  broadcastTaskChange();
  res.json(updated);
});

// ── Return task (editor gives back) ─────────────────────────────────────────
router.post("/tasks/:id/return", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  // Na fila em horas o editor não recusa job: se não dá para seguir, ele marca "Travado".
  if (role === "editor") {
    res.status(403).json({ error: "Na fila o editor não devolve job. Se não dá para seguir, use “Travado” e diga o motivo." }); return;
  }
  if (!["pending", "in_progress", "in_revision", "reopened"].includes(task.status)) {
    res.status(400).json({ error: "Só é possível devolver uma tarefa pendente, em edição ou em revisão." }); return;
  }
  await stopTask(task);

  const returnComment = req.body?.returnComment ? String(req.body.returnComment).trim() : "";
  if (!returnComment) {
    res.status(400).json({ error: "Informe o motivo da devolução." }); return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasksTable)
    .set({ status: "pending", assignedToId: null, queueHold: false })
    .where(eq(tasksTable.id, id))
    .returning();

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));

  await db.insert(taskEventsTable).values({
    taskId: id, fromStatus: prevStatus, toStatus: "pending", changedById: userId,
  });

  const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const editorName = editor?.name ?? "Editor";

  // Avisa quem criou a tarefa
  const notifyOwnerId = task.createdById;
  if (notifyOwnerId) {
    await notify(notifyOwnerId, "task_returned",
      "Tarefa devolvida",
      `${editorName} devolveu "${task.title}": ${returnComment}`,
      { taskId: id },
    );
  }


  broadcastTaskChange();
  res.json(updated);
});

// ── Delete task ──────────────────────────────────────────────────────────────
router.delete("/tasks/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, status: tasksTable.status, assignedToId: tasksTable.assignedToId,
              createdById: tasksTable.createdById, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.id, id));

  if (!task) { res.sendStatus(204); return; }

  if (req.session.userRole === "coordinator" && task.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir esta tarefa." }); return;
  }

  // Bloqueia se estiver atribuída e em edição
  if (task.assignedToId !== null && (task.status === "in_progress" || task.status === "in_revision")) {
    res.status(409).json({ error: "Esta tarefa está atribuída e em edição. Remova a atribuição antes de excluir.", blocked: true });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  broadcastTaskChange();
  res.sendStatus(204);
});

// ── My tasks ─────────────────────────────────────────────────────────────────
router.get("/my-tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  let tasks: (typeof tasksTable.$inferSelect)[];
  if (role === "editor") {
    const [primary, secondary] = await Promise.all([
      db.select().from(tasksTable).where(and(eq(tasksTable.assignedToId, userId), ne(tasksTable.status, "rascunho"))),
      db.select({ taskId: taskEditorsTable.taskId }).from(taskEditorsTable)
        .where(eq(taskEditorsTable.userId, userId)),
    ]);
    const secondaryIds = secondary.map(r => r.taskId);
    const primaryIds = primary.map(t => t.id);
    const missingIds = secondaryIds.filter(id => !primaryIds.includes(id));
    const extra = missingIds.length > 0
      ? await db.select().from(tasksTable).where(and(inArray(tasksTable.id, missingIds), ne(tasksTable.status, "rascunho")))
      : [];
    tasks = [...primary, ...extra].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    tasks = await db.select().from(tasksTable)
      .where(and(
        eq(tasksTable.createdById, userId),
        ne(tasksTable.status, "rascunho"),
      ))
      .orderBy(desc(tasksTable.createdAt));
  }

  const taskNumMap = new Map<number, number>();
  [...tasks].sort((a, b) => a.id - b.id).forEach((t, i) => taskNumMap.set(t.id, i + 1));

  const taskIds = tasks.map(t => t.id);
  const editorRows = taskIds.length
    ? await db.select({ taskId: taskEditorsTable.taskId, userId: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(taskEditorsTable).innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, taskIds))
    : [];
  const editorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of editorRows) {
    if (!editorsMap.has(e.taskId)) editorsMap.set(e.taskId, []);
    editorsMap.get(e.taskId)!.push({ id: e.userId, name: e.name, avatarUrl: e.avatarUrl });
  }

  // reviewedAt: quando a tarefa foi enviada para review pela PRIMEIRA vez
  // (usado para determinar se o editor entregou no prazo originalmente)
  const reviewEvents = taskIds.length
    ? await db.select({ taskId: taskEventsTable.taskId, createdAt: taskEventsTable.createdAt })
        .from(taskEventsTable)
        .where(and(inArray(taskEventsTable.taskId, taskIds), eq(taskEventsTable.toStatus, "review")))
        .orderBy(asc(taskEventsTable.createdAt))
    : [];
  const reviewedAtMap = new Map<number, Date>();
  for (const e of reviewEvents) {
    if (!reviewedAtMap.has(e.taskId)) reviewedAtMap.set(e.taskId, e.createdAt);
  }

  const tasksWithDetails = await Promise.all(tasks.map(async (t) => {
    const [createdBy] = t.createdById
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, t.createdById))
      : [null];
    const [assignedTo] = t.assignedToId
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, t.assignedToId))
      : [null];
    const revisions = await db.select({
      id: taskRevisionsTable.id,
      revisionNumber: taskRevisionsTable.revisionNumber,
      comment: taskRevisionsTable.comment,
      createdAt: taskRevisionsTable.createdAt,
    }).from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, t.id)).orderBy(asc(taskRevisionsTable.revisionNumber));
    return {
      ...t,
      taskCode: fmtCode(t.taskNumber, t.taskYear),
      createdBy: createdBy ?? null,
      assignedTo: assignedTo ?? null,
      editors: editorsMap.get(t.id) ?? [],
      revisions,
      number: taskNumMap.get(t.id) ?? 0,
      reviewedAt: reviewedAtMap.get(t.id)?.toISOString() ?? null,
    };
  }));

  res.json(tasksWithDetails);
});

// ── Activity feed ─────────────────────────────────────────────────────────────
router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  const events = await db
    .select({
      id: taskEventsTable.id,
      taskId: taskEventsTable.taskId,
      fromStatus: taskEventsTable.fromStatus,
      toStatus: taskEventsTable.toStatus,
      changedById: taskEventsTable.changedById,
      createdAt: taskEventsTable.createdAt,
      taskTitle: tasksTable.title,
      taskClient: tasksTable.client,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
      taskStatus: tasksTable.status,
    })
    .from(taskEventsTable)
    .innerJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
    .where(role === "editor" ? eq(tasksTable.assignedToId, userId) : undefined)
    .orderBy(desc(taskEventsTable.createdAt))
    .limit(15);

  const changerIds = [...new Set(events.map(e => e.changedById).filter(Boolean))] as number[];
  const changers: Record<number, string> = {};
  await Promise.all(changerIds.map(async cid => {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, cid));
    if (u) changers[u.id] = u.name;
  }));

  res.json(events.map(e => ({
    ...e,
    taskCode: fmtCode(e.taskNumber, e.taskYear),
    changedByName: e.changedById ? changers[e.changedById] ?? null : null,
  })));
});

// ── Calendar ──────────────────────────────────────────────────────────────────
router.get("/calendar", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  const fromParam = String(req.query.from ?? "");
  const toParam   = String(req.query.to   ?? "");
  const weekParam = String(req.query.week ?? "");

  let startDate: Date;
  let endDate:   Date;

  if (fromParam && toParam) {
    startDate = new Date(fromParam + "T00:00:00Z");
    endDate   = new Date(toParam   + "T00:00:00Z");
  } else {
    let weekStart: Date;
    if (weekParam) {
      weekStart = new Date(weekParam + "T00:00:00Z");
    } else {
      weekStart = new Date();
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
      weekStart.setHours(0, 0, 0, 0);
    }
    startDate = weekStart;
    endDate   = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
  }

  const weekStartStr = startDate.toISOString().split("T")[0];
  const weekEndStr   = endDate.toISOString().split("T")[0];

  const editorJunctionSubq = db
    .select({ taskId: taskEditorsTable.taskId })
    .from(taskEditorsTable)
    .where(eq(taskEditorsTable.userId, userId));

  const roleFilter = role === "editor"
    ? or(eq(tasksTable.assignedToId, userId), inArray(tasksTable.id, editorJunctionSubq))
    : ne(tasksTable.status, "rascunho");

  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      startDate: tasksTable.startDate,
      dueDate: tasksTable.dueDate,
      color: tasksTable.color,
      client: tasksTable.client,
      assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById,
    })
    .from(tasksTable)
    .where(and(
      roleFilter,
      isNotNull(tasksTable.dueDate),
      // fetch tasks that overlap the window: dueDate >= windowStart AND (startDate <= windowEnd OR startDate is null)
      sql`${tasksTable.dueDate} >= ${weekStartStr}`,
      or(
        isNull(tasksTable.startDate),
        sql`${tasksTable.startDate} <= ${weekEndStr}`,
      ),
    ))
    .orderBy(asc(tasksTable.dueDate));

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter(Boolean))] as number[];

  const personMap: Record<number, string> = {};
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, personIds));
    persons.forEach(p => { personMap[p.id] = p.name; });
  }

  res.json(rows.map(r => ({
    ...r,
    assigneeName:    r.assignedToId ? personMap[r.assignedToId] ?? null : null,
    coordinatorId:   r.createdById ?? null,
    coordinatorName: r.createdById ? personMap[r.createdById] ?? null : null,
  })));
});

// ── Dashboard extras ──────────────────────────────────────────────────────────
router.get("/dashboard-extras", requireAuth, async (_req, res): Promise<void> => {
  const todayStr = new Date().toISOString().split("T")[0];

  const baseOverdue = and(
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    isNotNull(tasksTable.dueDate),
    sql`${tasksTable.dueDate} < ${todayStr}`,
  );

  const overdueRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
      client: tasksTable.client,
      color: tasksTable.color,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
    })
    .from(tasksTable)
    .where(baseOverdue);

  const assigneeIds = [...new Set(overdueRows.map(t => t.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  const atRisk = overdueRows.map(t => ({
    ...t,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    assignee: t.assignedToId ? (assigneeMap.get(t.assignedToId) ?? null) : null,
    assigneeName: t.assignedToId ? (assigneeMap.get(t.assignedToId)?.name ?? null) : null,
  }));

  res.json({ atRisk });
});

// ── Deadline overview ─────────────────────────────────────────────────────────
router.get("/deadline-overview", requireAuth, async (req, res): Promise<void> => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr    = today.toISOString().split("T")[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split("T")[0];
  const in3daysStr  = new Date(today.getTime() + 3 * 86400000).toISOString().split("T")[0];
  const in7daysStr  = new Date(today.getTime() + 7 * 86400000).toISOString().split("T")[0];

  const userId = req.session.userId!;
  const role   = req.session.userRole!;

  const BUCKETS = [
    { key: "overdue", label: "Atrasadas", color: "#ef4444" },
    { key: "today",   label: "Hoje",      color: "#f97316" },
    { key: "in3days", label: "Próx. 3d",  color: "#f59e0b" },
    { key: "week",    label: "Semana",    color: "#22c55e" },
    { key: "later",   label: "+7 dias",   color: "#94a3b8" },
  ];

  const baseWhere = and(
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    isNotNull(tasksTable.dueDate)
  );
  const taskWhere = role === "editor"
    ? and(baseWhere, eq(tasksTable.assignedToId, userId))
    : baseWhere;

  const rows = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId, client: tasksTable.client, color: tasksTable.color,
      taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear,
    })
    .from(tasksTable).where(taskWhere).orderBy(asc(tasksTable.dueDate));

  const getBucket = (d: string): string => {
    if (d < todayStr)    return "overdue";
    if (d < tomorrowStr) return "today";
    if (d < in3daysStr)  return "in3days";
    if (d < in7daysStr)  return "week";
    return "later";
  };

  const counts: Record<string, number> = { overdue: 0, today: 0, in3days: 0, week: 0, later: 0 };
  rows.forEach(t => { if (t.dueDate) counts[getBucket(dueDateKey(t.dueDate))]++; });

  const PRIORITY_W: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const urgentRows = rows
    .filter(t => t.dueDate && ["overdue", "today", "in3days"].includes(getBucket(dueDateKey(t.dueDate))))
    .sort((a, b) => {
      const bA = getBucket(dueDateKey(a.dueDate)), bB = getBucket(dueDateKey(b.dueDate));
      const ORDER = ["overdue", "today", "in3days"];
      if (bA !== bB) return ORDER.indexOf(bA) - ORDER.indexOf(bB);
      const pw = (PRIORITY_W[b.priority] ?? 1) - (PRIORITY_W[a.priority] ?? 1);
      return pw !== 0 ? pw : dueDateKey(a.dueDate).localeCompare(dueDateKey(b.dueDate));
    })
    .slice(0, 5);

  const assigneeIds = [...new Set(urgentRows.map(t => t.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, string>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a.name));
  }

  const urgent = urgentRows.map(t => ({
    id: t.id, taskCode: fmtCode(t.taskNumber, t.taskYear), title: t.title, status: t.status, priority: t.priority,
    dueDate: t.dueDate, client: t.client, color: t.color,
    assigneeName: t.assignedToId ? (assigneeMap.get(t.assignedToId) ?? null) : null,
    bucket: getBucket(dueDateKey(t.dueDate)),
  }));

  res.json({
    buckets: BUCKETS.map(b => ({ ...b, count: counts[b.key] ?? 0 })),
    urgent, total: rows.length,
    urgentCount: (counts.overdue ?? 0) + (counts.today ?? 0),
  });
});

// ── Pipeline (all active tasks kanban) ───────────────────────────────────────
router.get("/pipeline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;
  const isEditor = role === "editor";

  const baseWhere = ne(tasksTable.status, "rascunho");

  let taskIds: number[] | null = null;
  if (isEditor) {
    const [primary, secondary] = await Promise.all([
      db.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(eq(tasksTable.assignedToId, userId), ne(tasksTable.status, "rascunho"))),
      db.select({ taskId: taskEditorsTable.taskId }).from(taskEditorsTable)
        .where(eq(taskEditorsTable.userId, userId)),
    ]);
    taskIds = [...new Set([...primary.map(t => t.id), ...secondary.map(r => r.taskId)])];
  }

  const tasks = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, dueDate: tasksTable.dueDate, color: tasksTable.color, client: tasksTable.client,
      revisionCount: tasksTable.revisionCount, assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById, createdAt: tasksTable.createdAt,
      taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear,
    })
    .from(tasksTable)
    .where(isEditor && taskIds !== null && taskIds.length > 0
      ? and(baseWhere, inArray(tasksTable.id, taskIds))
      : isEditor
        ? and(baseWhere, eq(tasksTable.id, -1))
        : baseWhere
    )
    .orderBy(desc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...tasks.map(t => t.assignedToId), ...tasks.map(t => t.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  res.json(tasks.map(t => ({
    ...t,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
  })));
});

// ── Task lifecycle ────────────────────────────────────────────────────────────
router.get("/tasks/:id/lifecycle", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [events, revisions] = await Promise.all([
    db.select({
      id: taskEventsTable.id,
      fromStatus: taskEventsTable.fromStatus,
      toStatus: taskEventsTable.toStatus,
      changedById: taskEventsTable.changedById,
      createdAt: taskEventsTable.createdAt,
    }).from(taskEventsTable)
      .where(eq(taskEventsTable.taskId, id))
      .orderBy(asc(taskEventsTable.createdAt)),

    db.select({
      id: taskRevisionsTable.id,
      revisionNumber: taskRevisionsTable.revisionNumber,
      comment: taskRevisionsTable.comment,
      createdById: taskRevisionsTable.createdById,
      createdAt: taskRevisionsTable.createdAt,
    }).from(taskRevisionsTable)
      .where(eq(taskRevisionsTable.taskId, id))
      .orderBy(asc(taskRevisionsTable.createdAt)),
  ]);

  const personIds = [...new Set([
    task.createdById,
    task.assignedToId,
    ...events.map(e => e.changedById),
    ...revisions.map(r => r.createdById),
  ].filter((x): x is number => x !== null))];

  const personMap = new Map<number, { id: number; name: string; role: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  const revisionQueue = [...revisions];
  const steps: object[] = [];

  steps.push({
    type: "created",
    at: task.createdAt,
    by: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    meta: { title: task.title, client: task.client, priority: task.priority, color: task.color },
  });

  for (const e of events) {
    const step: Record<string, unknown> = {
      type: "status_change",
      at: e.createdAt,
      by: e.changedById ? (personMap.get(e.changedById) ?? null) : null,
      meta: { fromStatus: e.fromStatus, toStatus: e.toStatus },
    };
    if (e.toStatus === "in_revision" && revisionQueue.length > 0) {
      const rev = revisionQueue.shift()!;
      (step.meta as Record<string, unknown>).revisionComment = rev.comment;
      (step.meta as Record<string, unknown>).revisionNumber = rev.revisionNumber;
    }
    steps.push(step);
  }

  res.json({
    task: {
      id: task.id,
      taskCode: fmtCode(task.taskNumber, task.taskYear),
      title: task.title,
      status: task.status,
      priority: task.priority,
      client: task.client,
      color: task.color,
      dueDate: task.dueDate,
      estMinutes: task.estMinutes,
      revisionCount: task.revisionCount ?? 0,
      assignee: task.assignedToId ? (personMap.get(task.assignedToId) ?? null) : null,
      coordinator: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    },
    steps,
  });
});


router.get("/timeline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  const editorFilter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : undefined;

  const tasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      priority: tasksTable.priority,
      dueDate: tasksTable.dueDate,
      color: tasksTable.color,
      client: tasksTable.client,
      revisionCount: tasksTable.revisionCount,
      folderUrl: tasksTable.folderUrl,
      assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
    })
    .from(tasksTable)
    .where(editorFilter)
    .orderBy(asc(tasksTable.dueDate), asc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...tasks.map(t => t.assignedToId), ...tasks.map(t => t.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  res.json(tasks.map(t => ({
    id: t.id,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    color: t.color,
    client: t.client,
    revisionCount: t.revisionCount,
    folderUrl: t.folderUrl,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
  })));
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/reports", requireCoordinator, async (req, res): Promise<void> => {
  const { from, to, assignedToId: filterEditor, status: filterStatus, client: filterClient,
          priority: filterPriority, scope } = req.query as Record<string, string | undefined>;

  const userId = req.session.userId!;
  const userRole = req.session.userRole!;

  const conditions: any[] = [
    from ? gte(tasksTable.createdAt, new Date(from + "T00:00:00")) : undefined,
    to   ? lte(tasksTable.createdAt, new Date(to   + "T23:59:59")) : undefined,
    filterEditor ? eq(tasksTable.assignedToId, parseInt(filterEditor, 10)) : undefined,
    filterStatus ? eq(tasksTable.status, filterStatus) : undefined,
    filterClient ? eq(tasksTable.client, filterClient) : undefined,
    filterPriority ? eq(tasksTable.priority, filterPriority) : undefined,
  ].filter(Boolean);

  // "Minhas" scope: only tasks created by this coordinator
  if (scope === "own" || userRole === "coordinator") {
    conditions.push(eq(tasksTable.createdById, userId));
  }

  const rows = await db.select().from(tasksTable).where(and(...conditions)).orderBy(desc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db
      .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  res.json({
    tasks: rows.map(r => ({
      id: r.id,
      taskCode: fmtCode(r.taskNumber, r.taskYear),
      title: r.title,
      status: r.status,
      priority: r.priority,
      client: r.client,
      color: r.color,
      revisionCount: r.revisionCount,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      assignee:    r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
      coordinator: r.createdById  ? (personMap.get(r.createdById)  ?? null) : null,
    })),
  });
});


// ── Task editors: add / remove / reassign ────────────────────────────────────

router.get("/tasks/:id/editors", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, login: usersTable.login })
    .from(taskEditorsTable)
    .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
    .where(eq(taskEditorsTable.taskId, id));
  res.json(editors);
});

router.post("/tasks/:id/editors", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (await rejectInactive(res, [editorId])) return;

  await db.insert(taskEditorsTable).values({
    taskId: id, userId: editorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  if (task.status !== "rascunho") {
    await notify(editorId, "task_assigned",
      "Tarefa atribuída a você",
      `Você foi adicionado à tarefa "${task.title}"`,
      { taskId: id }
    );
  }

  broadcastTaskChange();
  res.json({ ok: true });
});

router.delete("/tasks/:id/editors/:editorId", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(req.params.editorId, 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, editorId)));

  if (task.status !== "rascunho") {
    await notify(editorId, "task_reassigned",
      "Removido de tarefa",
      `Você foi removido da tarefa "${task.title}"`,
      { taskId: id }
    );
  }

  broadcastTaskChange();
  res.json({ ok: true });
});

// Passar para outro editor: entra no fim da fila do novo editor (use /queue/tasks/:id/place para prioridade).
router.post("/tasks/:id/reassign", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const newEditorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(newEditorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }
  if (await rejectInactive(res, [newEditorId])) return;
  // mover é livre: qualquer gestor passa qualquer job (o prazo é recalculado pelas horas)
  const role = req.session.userRole!;
  const out = await placeTask(id, newEditorId, String(req.body?.mode ?? "fila"), req.session.userId!, role);
  res.status(out.status).json(out.body);
});

export default router;

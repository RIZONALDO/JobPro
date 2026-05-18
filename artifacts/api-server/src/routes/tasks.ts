import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable, taskEditorsTable } from "@workspace/db";
import { eq, ne, desc, asc, and, or, gte, lte, isNotNull, lt, inArray, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";

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
  const { title, description, dueDate, priority, complexity, assignedToId, editorIds, folderUrl, client, color, status } = req.body ?? {};
  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  if (dueDate) {
    const parsed = new Date(String(dueDate));
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    if (parsed < todayMidnight) {
      res.status(400).json({ error: "O prazo não pode ser uma data passada" }); return;
    }
  }

  const parsedAssignee = assignedToId ? parseInt(String(assignedToId), 10) : null;
  const initialStatus = status === "rascunho" ? "rascunho" : "pending";

  const allEditorIdsCheck = new Set<number>();
  if (parsedAssignee) allEditorIdsCheck.add(parsedAssignee);
  if (Array.isArray(editorIds)) editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIdsCheck.add(n));
  if (initialStatus === "pending" && allEditorIdsCheck.size === 0) {
    res.status(400).json({ error: "Atribua ao menos um editor para publicar a tarefa" }); return;
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
    dueDate: dueDate ? new Date(String(dueDate)) : null,
    priority: priority ?? "medium",
    complexity: complexity ?? "medium",
    status: initialStatus,
    assignedToId: parsedAssignee,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
  }).returning();

  // Collect all editor IDs (primary + additional), deduplicated
  const allEditorIds = new Set<number>();
  if (parsedAssignee) allEditorIds.add(parsedAssignee);
  if (Array.isArray(editorIds)) {
    editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIds.add(n));
  }

  // Insert into junction table — notify only if published
  for (const editorId of allEditorIds) {
    await db.insert(taskEditorsTable).values({
      taskId: task.id,
      userId: editorId,
      assignedById: req.session.userId,
    }).onConflictDoNothing();
    if (initialStatus !== "rascunho") {
      await notify(editorId, "task_assigned",
        "Nova tarefa atribuída",
        `A tarefa "${task.title}" foi atribuída a você`,
        { taskId: task.id }
      );
    }
  }

  broadcastTaskChange();
  res.status(201).json(task);
});

// ── Overview (coordinator: all tasks created by coordinators) ────────────────
router.get("/tasks/overview", requireCoordinator, async (req, res): Promise<void> => {
  const { status, assignedToId, createdById } = req.query;
  const userId = req.session.userId!;
  const role   = req.session.userRole!;

  // All coordinator/supervisor/admin roles see all coordinator tasks;
  // client-side filterCoord handles "Minhas" vs "Geral" per user preference.
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
    // default: active only
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

  // Fetch all editors for these tasks in one query
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

  res.json(rows.map(r => ({
    id: r.id,
    taskCode: fmtCode(r.taskNumber, r.taskYear),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    complexity: r.complexity,
    dueDate: r.dueDate,
    folderUrl: r.folderUrl,
    revisionCount: r.revisionCount ?? 0,
    client: r.client,
    color: r.color,
    assignee: r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
    editors: editorsMap.get(r.id) ?? [],
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    isOwn: r.createdById === userId,
    updatedAt: r.updatedAt,
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

  const [createdBy] = task.createdById
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, task.createdById))
    : [null];
  const [assignedTo] = task.assignedToId
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, task.assignedToId))
    : [null];
  const revisions = await db
    .select({ id: taskRevisionsTable.id, revisionNumber: taskRevisionsTable.revisionNumber, comment: taskRevisionsTable.comment, createdAt: taskRevisionsTable.createdAt })
    .from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, id)).orderBy(asc(taskRevisionsTable.revisionNumber));

  const editorRows = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(taskEditorsTable)
    .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
    .where(eq(taskEditorsTable.taskId, id));

  res.json({ ...task, taskCode: fmtCode(task.taskNumber, task.taskYear), createdBy: createdBy ?? null, assignedTo: assignedTo ?? null, revisions, editors: editorRows });
});

// ── Update task ──────────────────────────────────────────────────────────────
router.put("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  const { title, description, dueDate, priority, complexity, assignedToId, folderUrl, status, revisionComment, client, color } = req.body ?? {};
  const update: Record<string, unknown> = {};
  let eventComment: string | undefined;

  if (role === "editor") {
    const [editorEntry] = await db.select({ taskId: taskEditorsTable.taskId })
      .from(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));
    const isAssigned = task.assignedToId === userId || !!editorEntry;
    if (!isAssigned) { res.status(403).json({ error: "Sem permissão" }); return; }
    if (status) {
      const s = String(status);
      const editorTransitions: Record<string, string[]> = {
        pending:     ["in_progress"],
        in_progress: ["review"],
        in_revision: ["review"],
        reopened:    ["in_progress"],
      };
      const allowed = editorTransitions[task.status] ?? [];
      if (!allowed.includes(s)) { res.status(400).json({ error: "Transição de status não permitida" }); return; }
      update.status = s;
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
    if (dueDate !== undefined) {
      if (dueDate) {
        const parsed = new Date(String(dueDate));
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: "Data inválida" }); return;
        }
        update.dueDate = parsed;
      } else {
        update.dueDate = null;
      }
    }
    if (priority) update.priority = String(priority);
    if (complexity) update.complexity = String(complexity);
    if (assignedToId !== undefined) update.assignedToId = assignedToId ? parseInt(String(assignedToId), 10) : null;
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
    if (status) {
      const s = String(status);
      // Only truly closed states that cannot be acted upon further
      const TERMINAL = ["completed", "cancelled"];

      // Cancelar ou pausar: permitido de qualquer status ativo (não-terminal)
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
      } else if (s === "reopened") {
        // Reabrir tarefa aprovada: apenas coordinator/supervisor/admin, somente de "completed"
        if (task.status !== "completed") {
          res.status(400).json({ error: "Só é possível reabrir tarefas aprovadas" }); return;
        }
        const comment = revisionComment ? String(revisionComment).trim() : "";
        if (!comment) { res.status(400).json({ error: "Informe o motivo da reabertura" }); return; }
        const newRevision = (task.revisionCount ?? 0) + 1;
        update.revisionCount = newRevision;
        update.status = "reopened";
        await db.insert(taskRevisionsTable).values({
          taskId: id,
          revisionNumber: newRevision,
          comment,
          createdById: userId,
        });
      } else if (s === "pending" && task.status === "cancelled") {
        // Reativar tarefa cancelada
        update.status = "pending";
      } else if (s === "pending" && (task.status === "paused" || task.status === "rascunho")) {
        // Retomar pausada ou publicar rascunho
        if (task.status === "rascunho") {
          const existingEditors = await db.select({ id: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
          const { editorIds: newEditorIds } = req.body ?? {};
          const incomingEditorIds = Array.isArray(newEditorIds)
            ? (newEditorIds as unknown[]).map(Number).filter(n => !isNaN(n) && n > 0)
            : [];
          const hasEditors = existingEditors.length > 0 || task.assignedToId || update.assignedToId || incomingEditorIds.length > 0;
          if (!hasEditors) {
            res.status(400).json({ error: "Atribua ao menos um editor para publicar a tarefa" }); return;
          }
        }
        update.status = "pending";
      } else {
        // Fluxo normal de aprovação/revisão (task.status deve ser "review")
        if (task.status !== "review") { res.status(400).json({ error: `Coordenador só pode avaliar tarefas em revisão (status atual: ${task.status})` }); return; }
        if (!["completed", "in_progress"].includes(s)) { res.status(400).json({ error: "Transição inválida" }); return; }
        update.status = s === "in_progress" ? "in_revision" : s;
        if (s === "in_progress") {
          const newRevision = (task.revisionCount ?? 0) + 1;
          update.revisionCount = newRevision;
          const comment = revisionComment ? String(revisionComment).trim() : "";
          if (!comment) { res.status(400).json({ error: "Informe o comentário da alteração" }); return; }
          await db.insert(taskRevisionsTable).values({
            taskId: id,
            revisionNumber: newRevision,
            comment,
            createdById: userId,
          });
        }
      }
    }
  }

  const [updated] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning();

  if (update.status && update.status !== task.status) {
    await db.insert(taskEventsTable).values({
      taskId: id,
      fromStatus: task.status,
      toStatus: String(update.status),
      changedById: userId,
      ...(eventComment ? { revisionComment: eventComment } : {}),
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
    if (newStatus === "in_revision" && task.assignedToId) {
      const comment = revisionComment ? String(revisionComment).trim() : "";
      await notify(task.assignedToId, "task_revision",
        "Alteração solicitada",
        `Alteração solicitada em "${task.title}"${comment ? `: ${comment}` : ""}`,
        { taskId: id }
      );
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
      await createFeedItem({
        type: "task_cancelled",
        title: `Tarefa cancelada: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
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
      await createFeedItem({
        type: "task_paused",
        title: `Tarefa pausada: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
    }
    if (newStatus === "pending" && task.status === "paused") {
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
      await createFeedItem({
        type: "task_resumed",
        title: `Tarefa retomada: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
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
      await createFeedItem({
        type: "task_reactivated",
        title: `Tarefa reativada: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
    }
    if (newStatus === "pending" && task.status === "rascunho") {
      // Notify all assigned editors when draft is published
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
      // Notify the assigned editor
      if (task.assignedToId) {
        await notify(task.assignedToId, "task_reopened",
          "Tarefa reaberta",
          `A tarefa "${task.title}" foi reaberta${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
      // Also notify all additional editors in junction table
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
      await createFeedItem({
        type: "task_reopened",
        title: `Tarefa reaberta: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
    }
  }

  if (update.assignedToId !== undefined && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number | null;
    const oldEditor = task.assignedToId;

    // Notify old editor they were removed
    if (oldEditor) {
      await notify(oldEditor, "task_reassigned",
        "Tarefa reatribuída",
        `A tarefa "${task.title}" foi reatribuída a outro editor`,
        { taskId: id }
      );
    }

    // Notify new editor they received the task
    if (newEditor) {
      await notify(newEditor, "task_assigned",
        "Nova tarefa atribuída",
        `A tarefa "${task.title}" foi atribuída a você`,
        { taskId: id }
      );
      // Keep junction table in sync
      await db.insert(taskEditorsTable).values({
        taskId: id, userId: newEditor, assignedById: req.session.userId,
      }).onConflictDoNothing();
    }

    // Remove old editor from junction table if not reassigned
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
      for (const recipientId of recipients) {
        await notify(recipientId, "due_date_changed",
          "Prazo alterado",
          `O prazo de "${task.title}" foi alterado para ${fmtBR(newDate)}`,
          { taskId: id }
        );
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

  if (role === "editor" && task.assignedToId !== userId) {
    res.status(403).json({ error: "Você só pode devolver tarefas atribuídas a você." }); return;
  }
  if (!["pending", "in_progress", "in_revision"].includes(task.status)) {
    res.status(400).json({ error: "Só é possível devolver uma tarefa pendente, em edição ou em revisão." }); return;
  }

  const returnComment = req.body?.returnComment ? String(req.body.returnComment).trim() : "";
  if (!returnComment) {
    res.status(400).json({ error: "Informe o motivo da devolução." }); return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasksTable)
    .set({ status: "pending", assignedToId: null })
    .where(eq(tasksTable.id, id))
    .returning();

  // Remove the returning editor from the junction table so coordinator reassigns from scratch
  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));

  await db.insert(taskEventsTable).values({
    taskId: id, fromStatus: prevStatus, toStatus: "pending", changedById: userId,
    revisionComment: returnComment,
  });

  const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const editorName = editor?.name ?? "Editor";

  if (task.createdById) {
    await notify(task.createdById, "task_returned",
      "Tarefa devolvida",
      `${editorName} devolveu "${task.title}": ${returnComment}`,
      { taskId: id },
    );
  }

  await createFeedItem({
    type: "task_returned",
    title: `Tarefa devolvida: "${task.title}"`,
    actorId: userId,
    entityId: id,
    entityType: "task",
  }).catch(() => {});

  broadcastTaskChange();
  res.json(updated);
});

// ── Delete task ──────────────────────────────────────────────────────────────
router.delete("/tasks/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, status: tasksTable.status, assignedToId: tasksTable.assignedToId, createdById: tasksTable.createdById })
    .from(tasksTable).where(eq(tasksTable.id, id));

  if (!task) { res.sendStatus(204); return; }

  if (req.session.userRole === "coordinator" && task.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir esta tarefa." }); return;
  }
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
    // Include tasks where user is primary assignee OR in the editors junction table — exclude drafts
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
      .where(eq(tasksTable.createdById, userId)).orderBy(desc(tasksTable.createdAt));
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

  res.json(events.map(e => ({ ...e, taskCode: fmtCode(e.taskNumber, e.taskYear), changedByName: e.changedById ? changers[e.changedById] ?? null : null })));
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
    startDate = new Date(fromParam + "T00:00:00");
    endDate   = new Date(toParam   + "T00:00:00");
  } else {
    let weekStart: Date;
    if (weekParam) {
      weekStart = new Date(weekParam + "T00:00:00");
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
      sql`${tasksTable.dueDate} >= ${weekStartStr}`,
      sql`${tasksTable.dueDate} <= ${weekEndStr}`,
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

// ── Workload ──────────────────────────────────────────────────────────────────
const COMPLEXITY_WEIGHT: Record<string, number> = { low: 1, medium: 3, high: 6 };

router.get("/workload", requireCoordinator, async (_req, res): Promise<void> => {
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.role, "editor"));

  const open = await db
    .select({ id: tasksTable.id, status: tasksTable.status, complexity: tasksTable.complexity, assignedToId: tasksTable.assignedToId })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "paused"),
      ne(tasksTable.status, "rascunho"),
      isNotNull(tasksTable.assignedToId),
    ));

  const result = editors.map(editor => {
    const editorTasks = open.filter(t => t.assignedToId === editor.id);
    const score = editorTasks.reduce((sum, t) => sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 3), 0);
    return {
      id: editor.id, name: editor.name, login: editor.login, avatarUrl: editor.avatarUrl ?? null,
      taskCount: editorTasks.length, score,
      byComplexity: {
        low:    editorTasks.filter(t => t.complexity === "low").length,
        medium: editorTasks.filter(t => t.complexity === "medium").length,
        high:   editorTasks.filter(t => t.complexity === "high").length,
      },
      byStatus: {
        pending:     editorTasks.filter(t => t.status === "pending").length,
        in_progress: editorTasks.filter(t => t.status === "in_progress").length,
        in_revision: editorTasks.filter(t => t.status === "in_revision").length,
        review:      editorTasks.filter(t => t.status === "review").length,
      },
    };
  });
  result.sort((a, b) => b.score - a.score);
  res.json(result);
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
  const overdueWhere = baseOverdue;

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
    .where(overdueWhere);

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

  const baseWhere = and(ne(tasksTable.status, "completed"), ne(tasksTable.status, "cancelled"), ne(tasksTable.status, "paused"), isNotNull(tasksTable.dueDate));
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

  const baseWhere = and(ne(tasksTable.status, "rascunho"));

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
      priority: tasksTable.priority, complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate, color: tasksTable.color, client: tasksTable.client,
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

// ── Timeline (tasks with due dates) ──────────────────────────────────────────
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

  // Merge task_revisions into events that have toStatus = "in_revision"
  // by matching revision order to in_revision events
  const revisionQueue = [...revisions];

  const steps: object[] = [];

  // Step 0: creation
  steps.push({
    type: "created",
    at: task.createdAt,
    by: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    meta: { title: task.title, client: task.client, priority: task.priority, color: task.color },
  });

  // Subsequent events
  for (const e of events) {
    const step: Record<string, unknown> = {
      type: "status_change",
      at: e.createdAt,
      by: e.changedById ? (personMap.get(e.changedById) ?? null) : null,
      meta: { fromStatus: e.fromStatus, toStatus: e.toStatus },
    };
    // Attach revision comment if this is an in_revision transition
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
      complexity: task.complexity,
      client: task.client,
      color: task.color,
      dueDate: task.dueDate,
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
      complexity: tasksTable.complexity,
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
    complexity: t.complexity,
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
  const { from, to } = req.query as Record<string, string | undefined>;

  const whereClause = and(
    from ? gte(tasksTable.createdAt, new Date(from + "T00:00:00")) : undefined,
    to   ? lte(tasksTable.createdAt, new Date(to   + "T23:59:59")) : undefined,
  );

  const rows = await db.select().from(tasksTable).where(whereClause).orderBy(desc(tasksTable.createdAt));

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
      complexity: r.complexity,
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

// List editors for a task
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

// Add an editor to a task
router.post("/tasks/:id/editors", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.insert(taskEditorsTable).values({
    taskId: id, userId: editorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  await notify(editorId, "task_assigned",
    "Tarefa atribuída a você",
    `Você foi adicionado à tarefa "${task.title}"`,
    { taskId: id }
  );

  broadcastTaskChange();
  res.json({ ok: true });
});

// Remove an editor from a task
router.delete("/tasks/:id/editors/:editorId", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(req.params.editorId, 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, editorId)));

  await notify(editorId, "task_reassigned",
    "Removido de tarefa",
    `Você foi removido da tarefa "${task.title}"`,
    { taskId: id }
  );

  broadcastTaskChange();
  res.json({ ok: true });
});

// Reassign primary editor (replaces assignedToId + notifies both sides)
router.post("/tasks/:id/reassign", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const newEditorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(newEditorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [newEditorUser] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, newEditorId));
  if (!newEditorUser) { res.status(404).json({ error: "Editor não encontrado" }); return; }

  const oldEditorId = task.assignedToId;

  // Notify old editor (if different)
  if (oldEditorId && oldEditorId !== newEditorId) {
    await notify(oldEditorId, "task_reassigned",
      "Tarefa reatribuída",
      `A tarefa "${task.title}" foi reatribuída para ${newEditorUser.name}`,
      { taskId: id }
    );
    // Remove old editor from junction table
    await db.delete(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, oldEditorId)));
  }

  // Update primary assignee
  const [updated] = await db.update(tasksTable)
    .set({ assignedToId: newEditorId })
    .where(eq(tasksTable.id, id))
    .returning();

  // Add new editor to junction table
  await db.insert(taskEditorsTable).values({
    taskId: id, userId: newEditorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  // Notify new editor
  await notify(newEditorId, "task_assigned",
    "Tarefa atribuída a você",
    `A tarefa "${task.title}" foi atribuída a você`,
    { taskId: id }
  );

  broadcastTaskChange();
  res.json(updated);
});

export default router;

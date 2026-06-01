import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable, taskEditorsTable } from "@workspace/db";
import { eq, ne, desc, asc, and, or, gte, lte, isNotNull, lt, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { broadcastTaskChange, broadcastSubtaskProgress, broadcastSubtaskChanged } from "../lib/broadcast.js";
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

// ── Utility: recalculate parent multi_task status based on subtasks ──────────
async function recalculateParentStatus(parentId: number, changedById: number): Promise<void> {
  try {
    const subtasks = await db
      .select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, parentId));

    if (subtasks.length === 0) return;

    const [parent] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, parentId));
    if (!parent) return;

    const allCompleted   = subtasks.every(s => s.status === "completed");
    const allCancelled   = subtasks.every(s => s.status === "cancelled");
    const anyActive      = subtasks.some(s => ["in_progress", "review", "in_revision", "reopened"].includes(s.status));
    const anyPending     = subtasks.some(s => s.status === "pending");

    let newStatus: string | null = null;

    if (allCompleted && parent.status !== "completed") {
      newStatus = "completed";
    } else if (allCancelled && parent.status !== "cancelled") {
      newStatus = "cancelled";
    } else if (anyActive && parent.status === "pending") {
      newStatus = "in_progress";
    } else if (!anyActive && anyPending && parent.status === "in_progress") {
      newStatus = "pending";
    }

    if (!newStatus) return;

    await db
      .update(tasksTable)
      .set({ status: newStatus })
      .where(eq(tasksTable.id, parentId));

    await db.insert(taskEventsTable).values({
      taskId: parentId,
      fromStatus: parent.status,
      toStatus: newStatus,
      changedById,
    });

    // Notify coordinator when multi_task auto-completes
    if (newStatus === "completed" && parent.createdById) {
      await notify(
        parent.createdById,
        "task_approved",
        "Multi-tarefa concluída",
        `Todas as subtarefas de "${parent.title}" foram concluídas`,
        { taskId: parentId }
      );
      await createFeedItem({
        type: "task_completed",
        title: `Multi-tarefa concluída: "${parent.title}"`,
        actorId: changedById,
        entityId: parentId,
        entityType: "task",
      }).catch(() => {});
    }

    // Broadcast progress update
    const completed = subtasks.filter(s => s.status === "completed").length;
    broadcastSubtaskProgress(parentId, {
      total: subtasks.length,
      completed,
      percentage: Math.round((completed / subtasks.length) * 100),
    });

    broadcastTaskChange();
  } catch (err) {
    console.error("[recalculateParentStatus] error:", err);
  }
}

// ── Helper: get subtask progress for a list of parent task IDs ───────────────
async function getSubtaskProgressMap(parentIds: number[]): Promise<Map<number, { total: number; completed: number; inProgress: number; pending: number; percentage: number }>> {
  const map = new Map<number, { total: number; completed: number; inProgress: number; pending: number; percentage: number }>();
  if (parentIds.length === 0) return map;

  const rows = await db
    .select({ parentTaskId: tasksTable.parentTaskId, status: tasksTable.status })
    .from(tasksTable)
    .where(inArray(tasksTable.parentTaskId, parentIds));

  for (const row of rows) {
    const pid = row.parentTaskId!;
    if (!map.has(pid)) map.set(pid, { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 });
    const entry = map.get(pid)!;
    entry.total++;
    if (row.status === "completed") entry.completed++;
    else if (["in_progress", "review", "in_revision", "reopened"].includes(row.status)) entry.inProgress++;
    else if (row.status === "pending") entry.pending++;
  }

  // Compute percentage after all rows processed
  for (const [, entry] of map) {
    entry.percentage = entry.total > 0 ? Math.round((entry.completed / entry.total) * 100) : 0;
  }

  return map;
}

// ── Create task ──────────────────────────────────────────────────────────────
router.post("/tasks", requireCoordinator, async (req, res): Promise<void> => {
  const { title, description, startDate, dueDate, priority, complexity, assignedToId, editorIds,
          folderUrl, client, color, status, taskType, parentTaskId, subtasks } = req.body ?? {};

  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  const resolvedType: string = taskType === "multi_task" ? "multi_task" : "task";
  const parsedAssignee = assignedToId ? parseInt(String(assignedToId), 10) : null;
  const initialStatus = status === "rascunho" ? "rascunho" : "pending";

  // Multi-task doesn't require editor or dueDate at the parent level
  if (resolvedType !== "multi_task") {
    if (initialStatus === "pending" && !dueDate) {
      res.status(400).json({ error: "Informe o prazo antes de publicar a tarefa" }); return;
    }
    const allEditorIdsCheck = new Set<number>();
    if (parsedAssignee) allEditorIdsCheck.add(parsedAssignee);
    if (Array.isArray(editorIds)) editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIdsCheck.add(n));
    if (initialStatus === "pending" && allEditorIdsCheck.size === 0) {
      res.status(400).json({ error: "Atribua ao menos um editor para publicar a tarefa" }); return;
    }
  }

  // Multi-task must have at least one subtask to be published
  if (resolvedType === "multi_task" && initialStatus === "pending") {
    const incomingSubtasks = Array.isArray(subtasks) ? subtasks : [];
    if (incomingSubtasks.length === 0) {
      res.status(400).json({ error: "Adicione ao menos uma subtarefa antes de publicar a multi-tarefa" }); return;
    }
  }

  // ── Bloqueio server-side de capacidade (fecha race condition) ─────────────
  // Se a tarefa tem startDate futuro, tarefas do editor que encerram antes dessa data não contam
  if (resolvedType !== "multi_task" && parsedAssignee && initialStatus !== "rascunho") {
    const fromDate = startDate ? new Date(String(startDate)) : undefined;
    const score = await editorScore(parsedAssignee, undefined, fromDate);
    const newW   = COMPLEXITY_WEIGHT[String(complexity ?? "medium")] ?? 6;
    if (score + newW > 12) {
      const [ed] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, parsedAssignee));
      res.status(422).json({ error: `${ed?.name ?? "Editor"} está no limite de capacidade (${score} pts). Reduza a complexidade, escolha outro editor ou ajuste as datas.` });
      return;
    }
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
    startDate: startDate ? new Date(String(startDate)) : null,
    dueDate: dueDate ? new Date(String(dueDate)) : null,
    priority: priority ?? "medium",
    complexity: complexity ?? "medium",
    status: initialStatus,
    assignedToId: resolvedType === "multi_task" ? null : parsedAssignee,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
    taskType: resolvedType,
  }).returning();

  // For regular tasks: add editors to junction table
  if (resolvedType !== "multi_task") {
    const allEditorIds = new Set<number>();
    if (parsedAssignee) allEditorIds.add(parsedAssignee);
    if (Array.isArray(editorIds)) {
      editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIds.add(n));
    }
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
  }

  // For multi_task: create subtasks from the subtasks array
  if (resolvedType === "multi_task" && Array.isArray(subtasks)) {
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      if (!sub?.title) continue;

      const subAssigneeId = sub.editorId ? parseInt(String(sub.editorId), 10) : null;
      const subSeq = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
      const subNumber = Number((subSeq.rows ?? subSeq)[0].nextval);

      const [subtask] = await db.insert(tasksTable).values({
        taskNumber: subNumber,
        taskYear,
        title: String(sub.title),
        description: sub.description ? String(sub.description) : null,
        client: client ? String(client) : null,
        color: color ? String(color) : "#6366f1",
        dueDate: sub.dueDate ? new Date(String(sub.dueDate)) : (dueDate ? new Date(String(dueDate)) : null),
        priority: sub.priority ?? priority ?? "medium",
        complexity: sub.complexity ?? complexity ?? "medium",
        status: initialStatus === "rascunho" ? "rascunho" : "pending",
        assignedToId: subAssigneeId,
        folderUrl: null,
        createdById: req.session.userId,
        taskType: "subtask",
        parentTaskId: task.id,
        subtaskOrder: i,
      }).returning();

      if (subAssigneeId) {
        await db.insert(taskEditorsTable).values({
          taskId: subtask.id,
          userId: subAssigneeId,
          assignedById: req.session.userId,
        }).onConflictDoNothing();
        if (initialStatus !== "rascunho") {
          await notify(subAssigneeId, "task_assigned",
            "Nova subtarefa atribuída",
            `Você foi atribuído à subtarefa "${subtask.title}" da multi-tarefa "${task.title}"`,
            { taskId: subtask.id }
          );
        }
      }
    }
  }

  broadcastTaskChange();
  res.status(201).json(task);
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

  const conditions: any[] = [
    ownerCondition,
    // Only show root tasks (multi_tasks and regular tasks), not subtasks
    isNull(tasksTable.parentTaskId),
  ];

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
  const multiTaskIds = rows.filter(r => r.taskType === "multi_task").map(r => r.id);

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

  // Get subtask progress for multi_tasks
  const progressMap = await getSubtaskProgressMap(multiTaskIds);

  // Fetch editors from subtasks for multi_task parents (item 8)
  const subtaskEditorRows = multiTaskIds.length
    ? await db
        .select({
          parentTaskId: tasksTable.parentTaskId,
          assignedToId: tasksTable.assignedToId,
        })
        .from(tasksTable)
        .where(and(inArray(tasksTable.parentTaskId, multiTaskIds), isNotNull(tasksTable.assignedToId)))
    : [];

  const subtaskAssigneeIds = [...new Set(subtaskEditorRows.map(r => r.assignedToId).filter(Boolean))] as number[];
  const subtaskAssignees = subtaskAssigneeIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, subtaskAssigneeIds))
    : [];
  const subtaskAssigneeMap = new Map(subtaskAssignees.map(u => [u.id, u]));

  // Build map: parentTaskId -> unique editors from subtasks
  const subtaskEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const row of subtaskEditorRows) {
    const pid = row.parentTaskId!;
    const uid = row.assignedToId!;
    if (!subtaskEditorsMap.has(pid)) subtaskEditorsMap.set(pid, []);
    const person = subtaskAssigneeMap.get(uid);
    if (person && !subtaskEditorsMap.get(pid)!.some(e => e.id === uid)) {
      subtaskEditorsMap.get(pid)!.push({ id: person.id, name: person.name, avatarUrl: person.avatarUrl });
    }
  }

  res.json(rows.map(r => ({
    id: r.id,
    taskCode: fmtCode(r.taskNumber, r.taskYear),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    complexity: r.complexity,
    startDate: r.startDate,
    dueDate: r.dueDate,
    folderUrl: r.folderUrl,
    revisionCount: r.revisionCount ?? 0,
    client: r.client,
    taskType: r.taskType,
    parentTaskId: r.parentTaskId,
    assignee: r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
    editors: r.taskType === "multi_task"
      ? subtaskEditorsMap.get(r.id) ?? []
      : editorsMap.get(r.id) ?? [],
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    isOwn: r.createdById === userId,
    updatedAt: r.updatedAt,
    subtaskProgress: r.taskType === "multi_task" ? (progressMap.get(r.id) ?? { total: 0, completed: 0, inProgress: 0, pending: 0 }) : null,
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

  // Exclude subtasks from status history chart to avoid double-counting
  const baseFilter = isNull(tasksTable.parentTaskId);
  const taskFilter = role === "editor"
    ? and(baseFilter, eq(tasksTable.assignedToId, userId))
    : (role === "coordinator" || role === "supervisor")
      ? and(baseFilter, eq(tasksTable.createdById, userId))
      : baseFilter;

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
        ne(tasksTable.taskType, "multi_task"), // exclude parent multi_tasks (no direct assignee)
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

  // If multi_task: fetch subtasks with their editors
  let subtasks: object[] = [];
  let subtaskProgress: { total: number; completed: number; inProgress: number; pending: number } | null = null;

  if (task.taskType === "multi_task") {
    const subRows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, id))
      .orderBy(asc(tasksTable.subtaskOrder), asc(tasksTable.createdAt));

    const subIds = subRows.map(s => s.id);
    const subEditorRows = subIds.length
      ? await db
          .select({ taskId: taskEditorsTable.taskId, id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
          .from(taskEditorsTable)
          .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
          .where(inArray(taskEditorsTable.taskId, subIds))
      : [];

    const subEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
    for (const e of subEditorRows) {
      if (!subEditorsMap.has(e.taskId)) subEditorsMap.set(e.taskId, []);
      subEditorsMap.get(e.taskId)!.push({ id: e.id, name: e.name, avatarUrl: e.avatarUrl });
    }

    const assigneePersonIds = [...new Set(subRows.map(s => s.assignedToId).filter(Boolean))] as number[];
    const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
    if (assigneePersonIds.length > 0) {
      const assignees = await db
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, assigneePersonIds));
      assignees.forEach(a => assigneeMap.set(a.id, a));
    }

    subtasks = subRows.map(s => ({
      id: s.id,
      taskCode: fmtCode(s.taskNumber, s.taskYear),
      title: s.title,
      description: s.description,
      status: s.status,
      priority: s.priority,
      complexity: s.complexity,
      dueDate: s.dueDate,
      subtaskOrder: s.subtaskOrder,
      assignedToId: s.assignedToId,
      assignedTo: s.assignedToId ? (assigneeMap.get(s.assignedToId) ?? null) : null,
      editors: subEditorsMap.get(s.id) ?? [],
      revisionCount: s.revisionCount ?? 0,
    }));

    const totalSub = subRows.length;
    const completedSub = subRows.filter(s => s.status === "completed").length;
    const inProgressSub = subRows.filter(s => ["in_progress", "review", "in_revision", "reopened"].includes(s.status)).length;
    const pendingSub = subRows.filter(s => s.status === "pending").length;
    subtaskProgress = { total: totalSub, completed: completedSub, inProgress: inProgressSub, pending: pendingSub };
  }

  // If subtask: fetch parent info
  let parentTask: { id: number; taskCode: string; title: string; status: string } | null = null;
  if (task.taskType === "subtask" && task.parentTaskId) {
    const [parent] = await db
      .select({ id: tasksTable.id, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear, title: tasksTable.title, status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, task.parentTaskId));
    if (parent) {
      parentTask = { id: parent.id, taskCode: fmtCode(parent.taskNumber, parent.taskYear), title: parent.title, status: parent.status };
    }
  }

  res.json({
    ...task,
    taskCode: fmtCode(task.taskNumber, task.taskYear),
    createdBy: createdBy ?? null,
    assignedTo: assignedTo ?? null,
    revisions,
    editors: editorRows,
    subtasks,
    subtaskProgress,
    parentTask,
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

  const { title, description, startDate, dueDate, priority, complexity, assignedToId, folderUrl, status, revisionComment, startComment, client, color } = req.body ?? {};
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
      // Se o editor adiantou uma tarefa agendada, ancora o startDate em hoje
      if (s === "in_progress" && task.startDate) {
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        if (task.startDate > todayMidnight) update.startDate = todayMidnight;
      }

      // ── Reserva de slot: editor confirma/ajusta a complexidade ao iniciar ──
      if (s === "in_progress" && complexity && ["low","medium","high"].includes(String(complexity))) {
        const editorComplexity  = String(complexity);
        const coordComplexity   = task.complexity ?? "medium";
        update.complexity            = editorComplexity;
        update.editorComplexitySet   = true;

        if (editorComplexity !== coordComplexity && task.createdById) {
          const LABEL: Record<string,string> = { low: "Baixa", medium: "Média", high: "Alta" };
          const [editor]  = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
          const editorName = editor?.name ?? "Editor";
          const fromLbl    = LABEL[coordComplexity]   ?? coordComplexity;
          const toLbl      = LABEL[editorComplexity]  ?? editorComplexity;

          const fromDate     = task.startDate ?? undefined;
          const currentScore = await editorScore(userId, id, fromDate);
          const newWeight    = COMPLEXITY_WEIGHT[editorComplexity] ?? 6;
          const totalScore   = currentScore + newWeight;

          if (totalScore > 12) {
            await notify(
              task.createdById,
              "complexity_conflict",
              "Capacidade excedida",
              `${editorName} iniciou "${task.title}" como ${toLbl} (era ${fromLbl}). A carga do editor excede o limite recomendado — verifique a distribuição de tarefas.`,
              { taskId: id }
            );
          } else {
            await notify(
              task.createdById,
              "complexity_adjusted",
              "Complexidade definida",
              `${editorName} iniciou "${task.title}" como ${toLbl} (era ${fromLbl}).`,
              { taskId: id }
            );
          }
        }
      }
      // Se está iniciando sem complexity no body, marca como definido
      if (s === "in_progress") update.editorComplexitySet = true;
    }

    // ── Editor define complexidade sem iniciar (tarefa permanece pending) ──
    if (!status && complexity && ["low","medium","high"].includes(String(complexity))) {
      const editorComplexity = String(complexity);
      const coordComplexity  = task.complexity ?? "medium";
      update.complexity          = editorComplexity;
      update.editorComplexitySet = true;

      if (editorComplexity !== coordComplexity && task.createdById) {
        const LABEL: Record<string,string> = { low: "Baixa", medium: "Média", high: "Alta" };
        const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
        const editorName = editor?.name ?? "Editor";
        const fromLbl   = LABEL[coordComplexity]  ?? coordComplexity;
        const toLbl     = LABEL[editorComplexity] ?? editorComplexity;
        const fromDate     = task.startDate ?? undefined;
        const currentScore = await editorScore(userId, id, fromDate);
        const totalScore   = currentScore + (COMPLEXITY_WEIGHT[editorComplexity] ?? 6);
        await notify(
          task.createdById,
          totalScore > 12 ? "complexity_conflict" : "complexity_adjusted",
          totalScore > 12 ? "Capacidade excedida" : "Complexidade definida",
          totalScore > 12
            ? `${editorName} definiu "${task.title}" como ${toLbl} (era ${fromLbl}). A carga do editor excede o limite recomendado — verifique a distribuição de tarefas.`
            : `${editorName} definiu "${task.title}" como ${toLbl} (era ${fromLbl}).`,
          { taskId: id }
        );
      }
    }

    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
  } else {
    if (role === "coordinator" && task.createdById !== userId) {
      // For subtasks, check if coordinator owns the parent task
      if (task.taskType === "subtask" && task.parentTaskId) {
        const [parent] = await db.select({ createdById: tasksTable.createdById }).from(tasksTable).where(eq(tasksTable.id, task.parentTaskId));
        if (!parent || parent.createdById !== userId) {
          res.status(403).json({ error: "Sem permissão para editar esta subtarefa. Apenas o criador da multi-tarefa pode fazer isso." }); return;
        }
      } else {
        res.status(403).json({ error: "Sem permissão para editar esta tarefa. Apenas o criador ou um Supervisor pode fazer isso." }); return;
      }
    }
    if (title) update.title = String(title);
    if (description !== undefined) update.description = description ? String(description) : null;
    if (client !== undefined) update.client = client ? String(client) : null;
    if (color) update.color = String(color);
    if (startDate !== undefined) {
      update.startDate = startDate ? new Date(String(startDate)) : null;
    }
    if (dueDate !== undefined) {
      if (dueDate) {
        const parsed = new Date(String(dueDate));
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: "Data inválida" }); return;
        }
        update.dueDate = parsed;
      } else {
        if (task.status !== "rascunho") {
          res.status(400).json({ error: "Tarefas em andamento precisam ter um prazo definido" }); return;
        }
        update.dueDate = null;
      }
    }
    if (priority) update.priority = String(priority);
    if (complexity) update.complexity = String(complexity);
    if (assignedToId !== undefined && task.taskType !== "multi_task") {
      update.assignedToId = assignedToId ? parseInt(String(assignedToId), 10) : null;
    }
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
    if (status) {
      const s = String(status);
      const TERMINAL = ["completed", "cancelled"];

      // Multi_task cannot be manually set to completed — it's derived from subtasks
      if (task.taskType === "multi_task" && s === "completed") {
        res.status(400).json({ error: "Multi-tarefas são concluídas automaticamente quando todas as subtarefas são finalizadas" }); return;
      }

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

        // If cancelling/pausing a multi_task, propagate to active subtasks
        if (task.taskType === "multi_task") {
          const activeSubtasks = await db
            .select({ id: tasksTable.id, assignedToId: tasksTable.assignedToId })
            .from(tasksTable)
            .where(and(
              eq(tasksTable.parentTaskId, id),
              ne(tasksTable.status, "completed"),
              ne(tasksTable.status, "cancelled"),
            ));
          for (const sub of activeSubtasks) {
            await db.update(tasksTable).set({ status: s }).where(eq(tasksTable.id, sub.id));
            if (sub.assignedToId) {
              await notify(sub.assignedToId, s === "cancelled" ? "task_cancelled" : "task_paused",
                s === "cancelled" ? "Subtarefa cancelada" : "Subtarefa pausada",
                `A subtarefa foi ${s === "cancelled" ? "cancelada" : "pausada"} junto com a multi-tarefa "${task.title}"${actionComment ? `: ${actionComment}` : ""}`,
                { taskId: sub.id }
              );
            }
          }
        }
      } else if (s === "reopened") {
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
        const dueDateAfterUpdate = update.dueDate !== undefined ? update.dueDate : task.dueDate;
        if (!dueDateAfterUpdate && task.taskType !== "multi_task") {
          res.status(400).json({ error: "Informe um prazo para reativar a tarefa" }); return;
        }
        update.status = "pending";
      } else if (s === "pending" && (task.status === "paused" || task.status === "rascunho")) {
        if (task.status === "rascunho") {
          const dueDateAfterUpdate = update.dueDate !== undefined ? update.dueDate : task.dueDate;
          if (!dueDateAfterUpdate && task.taskType !== "multi_task") {
            res.status(400).json({ error: "Informe o prazo antes de publicar a tarefa" }); return;
          }
          if (task.taskType === "multi_task") {
            // Check at least one subtask exists
            const [subCount] = await db
              .select({ count: sql<number>`count(*)` })
              .from(tasksTable)
              .where(eq(tasksTable.parentTaskId, id));
            if (Number(subCount?.count ?? 0) === 0) {
              res.status(400).json({ error: "Adicione ao menos uma subtarefa antes de publicar a multi-tarefa" }); return;
            }
          } else {
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
        }
        update.status = "pending";
      } else {
        // Normal approval flow (task must be in "review")
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

  // ── Bloqueio server-side de capacidade em edições ─────────────────────────
  // Aplica quando muda editor OU complexidade, para tarefas reais (não rascunho, não multi_task)
  // Editores estão excluídos: ao iniciar uma tarefa eles declaram a própria carga — nunca são bloqueados aqui
  const changingAssignee   = update.assignedToId !== undefined && update.assignedToId !== task.assignedToId;
  const changingComplexity = update.complexity   !== undefined && update.complexity   !== task.complexity;
  const targetAssignee     = update.assignedToId !== undefined ? (update.assignedToId as number | null) : task.assignedToId;
  const targetComplexity   = update.complexity   !== undefined ? String(update.complexity) : (task.complexity ?? "medium");

  if (role !== "editor" && (changingAssignee || changingComplexity) && targetAssignee && task.status !== "rascunho" && task.taskType !== "multi_task") {
    const taskFromDate = task.startDate ?? undefined;
    const score = await editorScore(targetAssignee, id, taskFromDate); // exclui a própria tarefa; considera startDate
    const newW  = COMPLEXITY_WEIGHT[targetComplexity] ?? 6;
    if (score + newW > 12) {
      const [ed] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, targetAssignee));
      res.status(422).json({ error: `${ed?.name ?? "Editor"} está no limite de capacidade (${score} pts). Reduza a complexidade ou escolha outro editor.` });
      return;
    }
  }

  const [updated] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning();

  if (update.status && update.status !== task.status) {
    const resolvedComment = eventComment
      || (update.status === "in_progress" && startComment ? String(startComment).slice(0, 500) : undefined);
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
      const parentLabel = task.taskType === "subtask" ? "Subtarefa" : "Tarefa";
      await notify(task.createdById, "task_review",
        `${parentLabel} enviada para aprovação`,
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
      // Notify assignedToId or all editors of subtask
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
      const editorRows = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      for (const { userId: editorId } of editorRows) {
        await notify(editorId, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi publicada e atribuída a você`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "completed" && task.assignedToId && task.taskType !== "multi_task") {
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
      await createFeedItem({
        type: "task_reopened",
        title: `Tarefa reaberta: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
      }).catch(() => {});
    }

    // If this is a subtask and status changed, recalculate parent status
    if (task.taskType === "subtask" && task.parentTaskId) {
      await recalculateParentStatus(task.parentTaskId, userId);
      broadcastSubtaskChanged(id, task.parentTaskId);
    }
  }

  if (update.assignedToId !== undefined && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number | null;
    const oldEditor = task.assignedToId;

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

// ── Subtask routes ────────────────────────────────────────────────────────────

// Get subtasks of a multi_task
router.get("/tasks/:id/subtasks", requireAuth, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [parent] = await db.select({ id: tasksTable.id, taskType: tasksTable.taskType, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear }).from(tasksTable).where(eq(tasksTable.id, parentId));
  if (!parent) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  const parentCode = fmtCode(parent.taskNumber, parent.taskYear);

  const subRows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId))
    .orderBy(asc(tasksTable.subtaskOrder), asc(tasksTable.createdAt));

  const subIds = subRows.map(s => s.id);
  const subEditorRows = subIds.length
    ? await db
        .select({ taskId: taskEditorsTable.taskId, id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(taskEditorsTable)
        .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, subIds))
    : [];

  const subEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of subEditorRows) {
    if (!subEditorsMap.has(e.taskId)) subEditorsMap.set(e.taskId, []);
    subEditorsMap.get(e.taskId)!.push({ id: e.id, name: e.name, avatarUrl: e.avatarUrl });
  }

  const assigneeIds = [...new Set(subRows.map(s => s.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  res.json(subRows.map((s, i) => ({
    id: s.id,
    taskCode: `${parentCode}.${(s.subtaskOrder ?? i) + 1}`,
    title: s.title,
    description: s.description,
    status: s.status,
    priority: s.priority,
    complexity: s.complexity,
    dueDate: s.dueDate,
    subtaskOrder: s.subtaskOrder,
    assignedToId: s.assignedToId,
    assignedTo: s.assignedToId ? (assigneeMap.get(s.assignedToId) ?? null) : null,
    editors: subEditorsMap.get(s.id) ?? [],
    revisionCount: s.revisionCount ?? 0,
    folderUrl: s.folderUrl,
  })));
});

// Create a subtask inside a multi_task
router.post("/tasks/:id/subtasks", requireCoordinator, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [parent] = await db.select().from(tasksTable).where(eq(tasksTable.id, parentId));
  if (!parent) { res.status(404).json({ error: "Tarefa pai não encontrada" }); return; }
  if (parent.taskType !== "multi_task") {
    res.status(400).json({ error: "Só é possível criar subtarefas dentro de multi-tarefas" }); return;
  }

  if (req.session.userRole === "coordinator" && parent.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para adicionar subtarefas a esta multi-tarefa" }); return;
  }

  const { title, description, dueDate, priority, complexity, editorId } = req.body ?? {};
  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  const subAssigneeId = editorId ? parseInt(String(editorId), 10) : null;

  // Get current max subtask order
  const [maxOrder] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(subtask_order), -1)` })
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  const taskYear = new Date().getFullYear() % 100;
  const seqResult = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
  const taskNumber = Number((seqResult.rows ?? seqResult)[0].nextval);

  const [subtask] = await db.insert(tasksTable).values({
    taskNumber,
    taskYear,
    title: String(title),
    description: description ? String(description) : null,
    client: parent.client,
    color: parent.color,
    dueDate: dueDate ? new Date(String(dueDate)) : parent.dueDate,
    priority: priority ?? parent.priority ?? "medium",
    complexity: complexity ?? parent.complexity ?? "medium",
    status: parent.status === "rascunho" ? "rascunho" : "pending",
    assignedToId: subAssigneeId,
    createdById: req.session.userId,
    taskType: "subtask",
    parentTaskId: parentId,
    subtaskOrder: (Number(maxOrder?.maxOrder ?? -1)) + 1,
  }).returning();

  if (subAssigneeId) {
    await db.insert(taskEditorsTable).values({
      taskId: subtask.id,
      userId: subAssigneeId,
      assignedById: req.session.userId,
    }).onConflictDoNothing();

    if (parent.status !== "rascunho") {
      await notify(subAssigneeId, "task_assigned",
        "Nova subtarefa atribuída",
        `Você foi atribuído à subtarefa "${subtask.title}" da multi-tarefa "${parent.title}"`,
        { taskId: subtask.id }
      );
    }
  }

  // If multi_task was pending/in_progress, recalculate
  if (parent.status !== "rascunho") {
    await recalculateParentStatus(parentId, req.session.userId!);
  }

  broadcastTaskChange();
  res.status(201).json(subtask);
});

// Get progress of a multi_task
router.get("/tasks/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const subtasks = await db
    .select({ status: tasksTable.status })
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  const total = subtasks.length;
  const completed = subtasks.filter(s => s.status === "completed").length;
  const inProgress = subtasks.filter(s => ["in_progress", "review", "in_revision", "reopened"].includes(s.status)).length;
  const pending = subtasks.filter(s => s.status === "pending").length;
  const cancelled = subtasks.filter(s => s.status === "cancelled").length;

  res.json({
    total,
    completed,
    inProgress,
    pending,
    cancelled,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  });
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

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));

  await db.insert(taskEventsTable).values({
    taskId: id, fromStatus: prevStatus, toStatus: "pending", changedById: userId,
  });

  const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const editorName = editor?.name ?? "Editor";

  // Notify the task owner (for subtask, notify the parent's creator)
  const notifyOwnerId = task.createdById;
  if (notifyOwnerId) {
    const label = task.taskType === "subtask" ? "subtarefa" : "tarefa";
    await notify(notifyOwnerId, "task_returned",
      `${label.charAt(0).toUpperCase() + label.slice(1)} devolvida`,
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

  // If subtask: recalculate parent
  if (task.taskType === "subtask" && task.parentTaskId) {
    await recalculateParentStatus(task.parentTaskId, userId);
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
              createdById: tasksTable.createdById, title: tasksTable.title, taskType: tasksTable.taskType })
    .from(tasksTable).where(eq(tasksTable.id, id));

  if (!task) { res.sendStatus(204); return; }

  if (req.session.userRole === "coordinator" && task.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir esta tarefa." }); return;
  }

  // For regular tasks: block if in-progress
  if (task.taskType !== "multi_task" && task.assignedToId !== null && (task.status === "in_progress" || task.status === "in_revision")) {
    res.status(409).json({ error: "Esta tarefa está atribuída e em edição. Remova a atribuição antes de excluir.", blocked: true });
    return;
  }

  // For multi_task: notify editors of active subtasks before cascade delete
  if (task.taskType === "multi_task") {
    const activeSubtasks = await db
      .select({ id: tasksTable.id, assignedToId: tasksTable.assignedToId, title: tasksTable.title })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.parentTaskId, id),
        ne(tasksTable.status, "completed"),
        ne(tasksTable.status, "cancelled"),
        ne(tasksTable.status, "rascunho"),
      ));

    for (const sub of activeSubtasks) {
      const subEditors = await db
        .select({ userId: taskEditorsTable.userId })
        .from(taskEditorsTable)
        .where(eq(taskEditorsTable.taskId, sub.id));
      const recipients = new Set<number>(subEditors.map(e => e.userId));
      if (sub.assignedToId) recipients.add(sub.assignedToId);

      for (const recipientId of recipients) {
        await notify(recipientId, "task_cancelled",
          "Multi-tarefa excluída",
          `A multi-tarefa "${task.title}" e sua subtarefa "${sub.title}" foram excluídas`,
          { taskId: id }
        );
      }
    }
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id)); // CASCADE deletes subtasks
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
        isNull(tasksTable.parentTaskId),
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

  // Fetch parent task info for subtasks
  const subtaskTasks = tasks.filter(t => t.taskType === "subtask" && t.parentTaskId);
  const parentIds = [...new Set(subtaskTasks.map(t => t.parentTaskId!))];
  const parentMap = new Map<number, { id: number; taskCode: string; title: string }>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: tasksTable.id, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear, title: tasksTable.title })
      .from(tasksTable)
      .where(inArray(tasksTable.id, parentIds));
    parents.forEach(p => parentMap.set(p.id, { id: p.id, taskCode: fmtCode(p.taskNumber, p.taskYear), title: p.title }));
  }

  // Multi-task progress
  const multiTaskIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiTaskIds);

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
      parentTask: t.parentTaskId ? (parentMap.get(t.parentTaskId) ?? null) : null,
      subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
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
      taskType: tasksTable.taskType,
      parentTaskId: tasksTable.parentTaskId,
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
    : and(ne(tasksTable.status, "rascunho"), ne(tasksTable.taskType, "multi_task")); // coordinators: exclude multi_task parents (show subtasks instead)

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
      taskType: tasksTable.taskType,
      parentTaskId: tasksTable.parentTaskId,
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

// ── Workload ──────────────────────────────────────────────────────────────────
const COMPLEXITY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };

/** Score de um editor. Se fromDate fornecido, exclui tarefas cujo dueDate termina antes dessa data
 *  (usada para agendamento futuro: tarefa que encerra antes do início da nova não conta). */
async function editorScore(editorId: number, excludeTaskId?: number, fromDate?: Date): Promise<number> {
  const conds = [
    eq(tasksTable.assignedToId, editorId),
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    ne(tasksTable.status, "rascunho"),
    ne(tasksTable.taskType, "multi_task"),
  ];
  if (excludeTaskId) conds.push(ne(tasksTable.id, excludeTaskId));
  const rows = await db.select({ complexity: tasksTable.complexity, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(...conds));
  return rows
    .filter(r => !fromDate || !r.dueDate || r.dueDate >= fromDate)
    .reduce((s, r) => s + (COMPLEXITY_WEIGHT[r.complexity ?? "medium"] ?? 6), 0);
}

router.get("/workload", requireCoordinator, async (req, res): Promise<void> => {
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.role, "editor"));

  const todayStr = new Date().toISOString().split("T")[0];

  // projected date from query param (default = today)
  const projDateStr = typeof req.query.date === "string" ? req.query.date : todayStr;
  const projDate = new Date(projDateStr + "T23:59:59Z");
  const isProjFuture = projDateStr > todayStr;

  const open = await db
    .select({
      id: tasksTable.id,
      status: tasksTable.status,
      complexity: tasksTable.complexity,
      assignedToId: tasksTable.assignedToId,
      startDate: tasksTable.startDate,
      dueDate: tasksTable.dueDate,
    })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "paused"),
      ne(tasksTable.status, "rascunho"),
      ne(tasksTable.taskType, "multi_task"),
      isNotNull(tasksTable.assignedToId),
    ));

  const todayEnd = new Date(todayStr + "T23:59:59Z");

  const result = editors.map(editor => {
    const all = open.filter(t => t.assignedToId === editor.id);

    // Current score: tasks with no startDate OR startDate <= today.
    // When projecting: exclude tasks whose dueDate is strictly before the projection day
    // (they're expected to be delivered by then).
    const current = all.filter(t => {
      if (!(!t.startDate || t.startDate <= todayEnd)) return false;
      if (isProjFuture && t.dueDate) {
        const dueStr = t.dueDate.toISOString().slice(0, 10);
        if (dueStr < projDateStr) return false;
      }
      return true;
    });
    const score = current.reduce((sum, t) => sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6), 0);

    // Scheduled score: tasks starting after today up to projDate,
    // but only if they're still active on the projection day (dueDate >= projDate or no dueDate).
    const scheduled = all.filter(t => {
      if (!t.startDate || t.startDate <= todayEnd || t.startDate > projDate) return false;
      if (t.dueDate) {
        const dueStr = t.dueDate.toISOString().slice(0, 10);
        if (dueStr < projDateStr) return false;
      }
      return true;
    });
    const scheduledScore = scheduled.reduce((sum, t) => sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6), 0);

    // Projected = current + scheduled (all tasks up to projDate)
    const projectedScore = score + scheduledScore;

    return {
      id: editor.id, name: editor.name, login: editor.login, avatarUrl: editor.avatarUrl ?? null,
      taskCount: current.length,
      scheduledCount: scheduled.length,
      score,
      scheduledScore,
      projectedScore,
      byComplexity: {
        low:    current.filter(t => t.complexity === "low").length,
        medium: current.filter(t => t.complexity === "medium").length,
        high:   current.filter(t => t.complexity === "high").length,
      },
      byStatus: {
        pending:     current.filter(t => t.status === "pending").length,
        in_progress: current.filter(t => t.status === "in_progress").length,
        in_revision: current.filter(t => t.status === "in_revision").length,
        review:      current.filter(t => t.status === "review").length,
      },
    };
  });
  result.sort((a, b) => b.score - a.score);
  res.json(result);
});

// ── Workload calendar — per-day score for one editor ─────────────────────────
router.get("/workload/calendar", requireCoordinator, async (req, res): Promise<void> => {
  const editorId = parseInt(req.query.editorId as string, 10);
  const monthStr = typeof req.query.month === "string" ? req.query.month : ""; // "YYYY-MM"
  if (!editorId || !monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    res.status(400).json({ error: "editorId e month (YYYY-MM) são obrigatórios" });
    return;
  }

  // Fetch all non-terminal tasks for this editor
  const tasks = await db
    .select({
      id: tasksTable.id,
      complexity: tasksTable.complexity,
      startDate: tasksTable.startDate,
      dueDate: tasksTable.dueDate,
    })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.assignedToId, editorId),
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "paused"),
      ne(tasksTable.status, "rascunho"),
      ne(tasksTable.taskType, "multi_task"),
    ));

  // Generate per-day data for the month
  const [year, month] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: { date: string; score: number; count: number }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, "0")}`;
    const dayEnd   = new Date(dayStr + "T23:59:59Z"); // UTC explícito
    const dayStart = new Date(dayStr + "T00:00:00Z"); // UTC explícito

    const active = tasks.filter(t => {
      // Task is active on this day if:
      // startDate <= end-of-day (or null = already started)
      const started = !t.startDate || t.startDate <= dayEnd;
      // dueDate >= start-of-day (or null = no deadline = always counts)
      const notDone = !t.dueDate || t.dueDate >= dayStart;
      return started && notDone;
    });

    const score = active.reduce((sum, t) => sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6), 0);
    days.push({ date: dayStr, score, count: active.length });
  }

  res.json(days);
});

// ── Nível 3: verificação de período ───────────────────────────────────────────
// GET /api/workload/period-check?editorId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&complexity=low|medium|high&excludeTaskId=N
router.get("/workload/period-check", requireCoordinator, async (req, res): Promise<void> => {
  const editorId      = parseInt(req.query.editorId as string, 10);
  const startDate     = req.query.startDate as string;
  const endDate       = req.query.endDate   as string;
  const complexity    = (req.query.complexity as string) ?? "medium";
  const excludeTaskId = req.query.excludeTaskId ? parseInt(req.query.excludeTaskId as string, 10) : null;

  if (!editorId || !startDate || !endDate) {
    res.status(400).json({ error: "editorId, startDate e endDate são obrigatórios" }); return;
  }

  const newWeight = COMPLEXITY_WEIGHT[complexity] ?? 6;
  const startD    = new Date(startDate + "T00:00:00Z");
  const endD      = new Date(endDate   + "T23:59:59Z");

  const conds = [
    eq(tasksTable.assignedToId, editorId),
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    ne(tasksTable.status, "rascunho"),
    ne(tasksTable.taskType, "multi_task"),
  ];
  if (excludeTaskId) conds.push(ne(tasksTable.id, excludeTaskId));

  const tasks = await db
    .select({ id: tasksTable.id, complexity: tasksTable.complexity, startDate: tasksTable.startDate, dueDate: tasksTable.dueDate })
    .from(tasksTable).where(and(...conds));

  const conflictDays: string[] = [];
  let maxScore = 0;
  const DAY_MS = 86_400_000;

  for (let d = new Date(startD); d <= endD; d = new Date(d.getTime() + DAY_MS)) {
    const dayEnd = new Date(d.getTime() + DAY_MS - 1);
    const active = tasks.filter(t => {
      const started = !t.startDate || t.startDate <= dayEnd;
      const notDone = !t.dueDate   || t.dueDate   >= d;
      return started && notDone;
    });
    const dayScore = active.reduce((s, t) => s + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6), 0);
    const projected = dayScore + newWeight;
    if (projected > maxScore) maxScore = projected;
    if (projected > 12) conflictDays.push(d.toISOString().slice(0, 10));
  }

  res.json({ blocked: conflictDays.length > 0, conflictDays, maxScore });
});

// ── Nível 2: agenda geral de todos os editores ────────────────────────────────
// GET /api/agenda
router.get("/agenda", requireCoordinator, async (_req, res): Promise<void> => {
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.role, "editor"));

  const tasks = await db
    .select({
      id:           tasksTable.id,
      taskNumber:   tasksTable.taskNumber,
      taskYear:     tasksTable.taskYear,
      title:        tasksTable.title,
      status:       tasksTable.status,
      priority:     tasksTable.priority,
      complexity:   tasksTable.complexity,
      color:        tasksTable.color,
      client:       tasksTable.client,
      startDate:    tasksTable.startDate,
      dueDate:      tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
    })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "rascunho"),
      ne(tasksTable.taskType, "multi_task"),
      isNotNull(tasksTable.assignedToId),
    ));

  const result = editors.map(editor => ({
    editor,
    tasks: tasks
      .filter(t => t.assignedToId === editor.id)
      .map(t => ({
        id:        t.id,
        taskCode:  fmtCode(t.taskNumber ?? 0, t.taskYear ?? 0),
        title:     t.title,
        status:    t.status,
        priority:  t.priority,
        complexity: t.complexity,
        color:     t.color,
        client:    t.client,
        startDate: t.startDate ? t.startDate.toISOString() : null,
        dueDate:   t.dueDate   ? t.dueDate.toISOString()   : null,
      })),
  }));

  res.json(result);
});

// ── Dashboard extras ──────────────────────────────────────────────────────────
router.get("/dashboard-extras", requireAuth, async (_req, res): Promise<void> => {
  const todayStr = new Date().toISOString().split("T")[0];

  const baseOverdue = and(
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    ne(tasksTable.taskType, "multi_task"),
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
    ne(tasksTable.taskType, "multi_task"),
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

  // Exclude subtasks from pipeline root view (they show inside multi_task cards)
  const baseWhere = and(ne(tasksTable.status, "rascunho"), isNull(tasksTable.parentTaskId));

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
      taskType: tasksTable.taskType,
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

  // Fetch subtask progress for multi_tasks
  const multiIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

  res.json(tasks.map(t => ({
    ...t,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
    subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
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

  // For multi_task, attach subtask progress
  const subtaskProgress = task.taskType === "multi_task"
    ? ((await getSubtaskProgressMap([task.id])).get(task.id) ?? null)
    : null;

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
      taskType: task.taskType,
      parentTaskId: task.parentTaskId,
      subtaskProgress,
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
    : isNull(tasksTable.parentTaskId); // coordinators see root tasks only

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
      taskType: tasksTable.taskType,
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

  // Fetch subtasks for multi_tasks
  const multiIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

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
    taskType: t.taskType,
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
    subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
  })));
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/reports", requireCoordinator, async (req, res): Promise<void> => {
  const { from, to, assignedToId: filterEditor, status: filterStatus, client: filterClient,
          priority: filterPriority, complexity: filterComplexity, scope } = req.query as Record<string, string | undefined>;

  const userId = req.session.userId!;
  const userRole = req.session.userRole!;

  const conditions: any[] = [
    // Exclude subtasks from top-level reports (they inflate counts)
    isNull(tasksTable.parentTaskId),
    from ? gte(tasksTable.createdAt, new Date(from + "T00:00:00")) : undefined,
    to   ? lte(tasksTable.createdAt, new Date(to   + "T23:59:59")) : undefined,
    filterEditor ? eq(tasksTable.assignedToId, parseInt(filterEditor, 10)) : undefined,
    filterStatus ? eq(tasksTable.status, filterStatus) : undefined,
    filterClient ? eq(tasksTable.client, filterClient) : undefined,
    filterPriority ? eq(tasksTable.priority, filterPriority) : undefined,
    filterComplexity ? eq(tasksTable.complexity, filterComplexity) : undefined,
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

  // Fetch subtask progress for multi_tasks in report
  const multiIds = rows.filter(r => r.taskType === "multi_task").map(r => r.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

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
      taskType: r.taskType,
      assignee:    r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
      coordinator: r.createdById  ? (personMap.get(r.createdById)  ?? null) : null,
      subtaskProgress: r.taskType === "multi_task" ? (progressMap.get(r.id) ?? null) : null,
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

router.post("/tasks/:id/reassign", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const newEditorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(newEditorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [newEditorUser] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, newEditorId));
  if (!newEditorUser) { res.status(404).json({ error: "Editor não encontrado" }); return; }

  const oldEditorId = task.assignedToId;

  if (oldEditorId && oldEditorId !== newEditorId) {
    await notify(oldEditorId, "task_reassigned",
      "Tarefa reatribuída",
      `A tarefa "${task.title}" foi reatribuída para ${newEditorUser.name}`,
      { taskId: id }
    );
    await db.delete(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, oldEditorId)));
  }

  const [updated] = await db.update(tasksTable)
    .set({ assignedToId: newEditorId })
    .where(eq(tasksTable.id, id))
    .returning();

  await db.insert(taskEditorsTable).values({
    taskId: id, userId: newEditorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  await notify(newEditorId, "task_assigned",
    "Tarefa atribuída a você",
    `A tarefa "${task.title}" foi atribuída a você`,
    { taskId: id }
  );

  // If subtask reassignment, recalculate parent
  if (task.taskType === "subtask" && task.parentTaskId) {
    await recalculateParentStatus(task.parentTaskId, req.session.userId!);
  }

  broadcastTaskChange();
  res.json(updated);
});

export default router;

import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable } from "@workspace/db";
import { eq, ne, desc, asc, and, gte, lte, isNotNull, lt, inArray, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";

const router = Router();

// ── Create task ──────────────────────────────────────────────────────────────
router.post("/tasks", requireCoordinator, async (req, res): Promise<void> => {
  const { title, description, dueDate, priority, complexity, assignedToId, folderUrl, client, color } = req.body ?? {};
  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  const parsedAssignee = assignedToId ? parseInt(String(assignedToId), 10) : null;
  const [task] = await db.insert(tasksTable).values({
    title: String(title),
    description: description ? String(description) : null,
    client: client ? String(client) : null,
    color: color ? String(color) : "#6366f1",
    dueDate: dueDate ? String(dueDate) : null,
    priority: priority ?? "medium",
    complexity: complexity ?? "medium",
    assignedToId: parsedAssignee,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
  }).returning();

  if (parsedAssignee) {
    await notify(parsedAssignee, "task_assigned",
      "Nova tarefa atribuída",
      `A tarefa "${task.title}" foi atribuída a você`,
      { taskId: task.id }
    );
  }

  broadcastTaskChange();
  res.status(201).json(task);
});

// ── Overview (coordinator: all tasks created by coordinators) ────────────────
router.get("/tasks/overview", requireCoordinator, async (req, res): Promise<void> => {
  const { status, assignedToId, createdById } = req.query;

  const coordUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, ["coordinator", "supervisor", "admin"]));
  const coordIds = coordUsers.map(u => u.id);
  if (coordIds.length === 0) { res.json([]); return; }

  const conditions: any[] = [inArray(tasksTable.createdById, coordIds)];
  if (status && status !== "all") conditions.push(eq(tasksTable.status, String(status)));
  if (assignedToId) conditions.push(eq(tasksTable.assignedToId, parseInt(String(assignedToId), 10)));
  if (createdById) conditions.push(eq(tasksTable.createdById, parseInt(String(createdById), 10)));

  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt));

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

  const userId = req.session.userId!;
  res.json(rows.map(r => ({
    id: r.id,
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
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    isOwn: r.createdById === userId,
  })));
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

  res.json({ ...task, createdBy: createdBy ?? null, assignedTo: assignedTo ?? null, revisions });
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

  if (role === "editor") {
    if (task.assignedToId !== userId) { res.status(403).json({ error: "Sem permissão" }); return; }
    if (status) {
      const s = String(status);
      const editorTransitions: Record<string, string[]> = {
        pending:     ["in_progress"],
        in_progress: ["review"],
        in_revision: ["review"],
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
    if (dueDate !== undefined) update.dueDate = dueDate ? String(dueDate) : null;
    if (priority) update.priority = String(priority);
    if (complexity) update.complexity = String(complexity);
    if (assignedToId !== undefined) update.assignedToId = assignedToId ? parseInt(String(assignedToId), 10) : null;
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
    if (status) {
      const s = String(status);
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

  const [updated] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning();

  if (update.status && update.status !== task.status) {
    await db.insert(taskEventsTable).values({
      taskId: id,
      fromStatus: task.status,
      toStatus: String(update.status),
      changedById: userId,
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
    if (newStatus === "in_revision" && task.assignedToId) {
      const comment = revisionComment ? String(revisionComment).trim() : "";
      await notify(task.assignedToId, "task_revision",
        "Alteração solicitada",
        `Alteração solicitada em "${task.title}"${comment ? `: ${comment}` : ""}`,
        { taskId: id }
      );
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
  }

  if (update.assignedToId && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number;
    await notify(newEditor, "task_reassigned",
      "Tarefa atribuída a você",
      `A tarefa "${task.title}" foi atribuída a você`,
      { taskId: id }
    );
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
  if (task.status === "completed") {
    res.status(400).json({ error: "Não é possível devolver uma tarefa já concluída." }); return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasksTable)
    .set({ status: "pending", assignedToId: null })
    .where(eq(tasksTable.id, id))
    .returning();

  await db.insert(taskEventsTable).values({
    taskId: id, fromStatus: prevStatus, toStatus: "pending", changedById: userId,
  });

  if (task.createdById) {
    const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    await notify(task.createdById, "task_returned",
      "Tarefa devolvida",
      `${editor?.name ?? "Editor"} devolveu a tarefa "${task.title}".`,
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
  const filter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : eq(tasksTable.createdById, userId);

  const tasks = await db.select().from(tasksTable).where(filter).orderBy(desc(tasksTable.createdAt));

  const taskNumMap = new Map<number, number>();
  [...tasks].sort((a, b) => a.id - b.id).forEach((t, i) => taskNumMap.set(t.id, i + 1));

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
      createdBy: createdBy ?? null,
      assignedTo: assignedTo ?? null,
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
    })
    .from(taskEventsTable)
    .innerJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
    .where(role === "editor" ? eq(tasksTable.assignedToId, userId) : eq(tasksTable.createdById, userId))
    .orderBy(desc(taskEventsTable.createdAt))
    .limit(15);

  const changerIds = [...new Set(events.map(e => e.changedById).filter(Boolean))] as number[];
  const changers: Record<number, string> = {};
  await Promise.all(changerIds.map(async cid => {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, cid));
    if (u) changers[u.id] = u.name;
  }));

  res.json(events.map(e => ({ ...e, changedByName: e.changedById ? changers[e.changedById] ?? null : null })));
});

// ── Calendar ──────────────────────────────────────────────────────────────────
router.get("/calendar", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  const weekParam = String(req.query.week ?? "");
  let weekStart: Date;
  if (weekParam) {
    weekStart = new Date(weekParam + "T00:00:00");
  } else {
    weekStart = new Date();
    const day = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
    weekStart.setHours(0, 0, 0, 0);
  }
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekStartStr = weekStart.toISOString().split("T")[0];
  const weekEndStr   = weekEnd.toISOString().split("T")[0];

  const roleFilter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : eq(tasksTable.createdById, userId);

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
    })
    .from(tasksTable)
    .where(and(
      roleFilter,
      isNotNull(tasksTable.dueDate),
      sql`${tasksTable.dueDate} >= ${weekStartStr}`,
      sql`${tasksTable.dueDate} <= ${weekEndStr}`,
    ))
    .orderBy(asc(tasksTable.dueDate));

  const assigneeIds = [...new Set(rows.map(r => r.assignedToId).filter(Boolean))] as number[];
  const assigneeMap: Record<number, string> = {};
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => { assigneeMap[a.id] = a.name; });
  }

  res.json(rows.map(r => ({ ...r, assigneeName: r.assignedToId ? assigneeMap[r.assignedToId] ?? null : null })));
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
    .where(and(ne(tasksTable.status, "completed"), isNotNull(tasksTable.assignedToId)));

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

  const overdueRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
      client: tasksTable.client,
      color: tasksTable.color,
    })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "completed"),
      isNotNull(tasksTable.dueDate),
      sql`${tasksTable.dueDate} < ${todayStr}`,
    ));

  const assigneeIds = [...new Set(overdueRows.map(t => t.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  const atRisk = overdueRows.map(t => ({
    ...t,
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

  const baseWhere = and(ne(tasksTable.status, "completed"), isNotNull(tasksTable.dueDate));
  const taskWhere = role === "editor" ? and(baseWhere, eq(tasksTable.assignedToId, userId)) : baseWhere;

  const rows = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId, client: tasksTable.client, color: tasksTable.color,
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
  rows.forEach(t => { if (t.dueDate) counts[getBucket(String(t.dueDate))]++; });

  const PRIORITY_W: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const urgentRows = rows
    .filter(t => t.dueDate && ["overdue", "today", "in3days"].includes(getBucket(String(t.dueDate))))
    .sort((a, b) => {
      const bA = getBucket(String(a.dueDate)), bB = getBucket(String(b.dueDate));
      const ORDER = ["overdue", "today", "in3days"];
      if (bA !== bB) return ORDER.indexOf(bA) - ORDER.indexOf(bB);
      const pw = (PRIORITY_W[b.priority] ?? 1) - (PRIORITY_W[a.priority] ?? 1);
      return pw !== 0 ? pw : String(a.dueDate).localeCompare(String(b.dueDate));
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
    id: t.id, title: t.title, status: t.status, priority: t.priority,
    dueDate: t.dueDate, client: t.client, color: t.color,
    assigneeName: t.assignedToId ? (assigneeMap.get(t.assignedToId) ?? null) : null,
    bucket: getBucket(String(t.dueDate)),
  }));

  res.json({
    buckets: BUCKETS.map(b => ({ ...b, count: counts[b.key] ?? 0 })),
    urgent, total: rows.length,
    urgentCount: (counts.overdue ?? 0) + (counts.today ?? 0),
  });
});

// ── Pipeline (all active tasks kanban) ───────────────────────────────────────
router.get("/pipeline", requireAuth, async (_req, res): Promise<void> => {
  const tasks = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate, color: tasksTable.color, client: tasksTable.client,
      revisionCount: tasksTable.revisionCount, assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById, createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(ne(tasksTable.status, "completed"))
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
      title: task.title,
      status: task.status,
      priority: task.priority,
      complexity: task.complexity,
      client: task.client,
      color: task.color,
      dueDate: task.dueDate,
      assignee: task.assignedToId ? (personMap.get(task.assignedToId) ?? null) : null,
      coordinator: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    },
    steps,
  });
});


router.get("/timeline", requireCoordinator, async (_req, res): Promise<void> => {
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
    })
    .from(tasksTable)
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
  const { from, to, userId } = req.query as Record<string, string | undefined>;

  const whereClause = and(
    eq(tasksTable.status, "completed"),
    from ? gte(tasksTable.updatedAt, new Date(from + "T00:00:00")) : undefined,
    to   ? lte(tasksTable.updatedAt, new Date(to   + "T23:59:59")) : undefined,
    userId ? eq(tasksTable.assignedToId, parseInt(userId, 10)) : undefined,
  );

  const rows = await db.select().from(tasksTable).where(whereClause).orderBy(desc(tasksTable.updatedAt));

  const assigneeIds = [...new Set(rows.map(r => r.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  const enriched = rows.map(r => ({
    task: {
      id: r.id, title: r.title, status: r.status, priority: r.priority,
      complexity: r.complexity, updatedAt: r.updatedAt, revisionCount: r.revisionCount,
      client: r.client, color: r.color,
    },
    assignee: r.assignedToId ? (assigneeMap.get(r.assignedToId) ?? null) : null,
    revisionCount: r.revisionCount,
  }));

  const totalDelivered = enriched.length;

  const byClientMap = new Map<string, { client: string; count: number }>();
  for (const item of enriched) {
    const key = item.task.client ?? "Sem cliente";
    if (!byClientMap.has(key)) byClientMap.set(key, { client: key, count: 0 });
    byClientMap.get(key)!.count++;
  }

  const byEditorMap = new Map<number, { userId: number; name: string; count: number }>();
  for (const item of enriched) {
    if (!item.assignee) continue;
    const key = item.assignee.id;
    if (!byEditorMap.has(key)) byEditorMap.set(key, { userId: key, name: item.assignee.name, count: 0 });
    byEditorMap.get(key)!.count++;
  }

  res.json({
    data: enriched,
    summary: {
      totalDelivered,
      byClient: [...byClientMap.values()].sort((a, b) => b.count - a.count),
      byEditor: [...byEditorMap.values()],
    },
  });
});

export default router;

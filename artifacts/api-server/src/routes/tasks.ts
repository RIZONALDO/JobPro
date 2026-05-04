import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable, jobsTable, projectsTable } from "@workspace/db";
import { eq, ne, desc, asc, and, gte, lte, isNotNull, lt, notInArray, inArray } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify, notifyAdmins } from "../lib/notify.js";
import { broadcastTaskChange, broadcastJobChange, broadcastProjectChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";

const router = Router();

router.post("/jobs/:jobId/tasks", requireCoordinator, async (req, res): Promise<void> => {
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { title, description, dueDate, priority, complexity, assignedToId, folderUrl } = req.body ?? {};
  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  if (dueDate) {
    const [job] = await db.select({ dueDate: jobsTable.dueDate, createdAt: jobsTable.createdAt }).from(jobsTable).where(eq(jobsTable.id, jobId));
    const taskDate = new Date(String(dueDate));
    if (job?.createdAt && taskDate < job.createdAt) {
      const d = job.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      res.status(400).json({ error: `Data da tarefa é anterior ao início do job (${d})` }); return;
    }
    if (job?.dueDate && taskDate > job.dueDate) {
      const d = job.dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      res.status(400).json({ error: `Data da tarefa ultrapassa o prazo do job (${d})` }); return;
    }
  }

  const parsedAssignee = assignedToId ? parseInt(assignedToId, 10) : null;
  const [task] = await db.insert(tasksTable).values({
    jobId,
    title: String(title),
    description: description ? String(description) : null,
    dueDate: dueDate ? new Date(String(dueDate)) : null,
    priority: priority ?? "medium",
    complexity: complexity ?? "medium",
    assignedToId: parsedAssignee,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
  }).returning();

  // Notificar editor ao ser atribuído
  const [jobForNotif] = await db.select({ name: jobsTable.name, projectId: jobsTable.projectId }).from(jobsTable).where(eq(jobsTable.id, jobId));
  if (parsedAssignee && jobForNotif) {
    await notify(parsedAssignee, "task_assigned",
      "Nova tarefa atribuída",
      `A tarefa "${task.title}" no job "${jobForNotif.name}" foi atribuída a você`,
      { taskId: task.id, jobId }
    );
  }

  broadcastTaskChange(jobId, jobForNotif?.projectId ?? 0);
  res.status(201).json(task);
});

router.put("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  const { title, description, dueDate, priority, complexity, assignedToId, folderUrl, status, revisionComment } = req.body ?? {};
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
    if (dueDate !== undefined) {
      if (dueDate) {
        const [job] = await db.select({ dueDate: jobsTable.dueDate, createdAt: jobsTable.createdAt }).from(jobsTable).where(eq(jobsTable.id, task.jobId));
        const taskDate = new Date(String(dueDate));
        if (job?.createdAt && taskDate < job.createdAt) {
          const d = job.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          res.status(400).json({ error: `Data da tarefa é anterior ao início do job (${d})` }); return;
        }
        if (job?.dueDate && taskDate > job.dueDate) {
          const d = job.dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          res.status(400).json({ error: `Data da tarefa ultrapassa o prazo do job (${d})` }); return;
        }
      }
      update.dueDate = dueDate ? new Date(String(dueDate)) : null;
    }
    if (priority) update.priority = String(priority);
    if (complexity) update.complexity = String(complexity);
    if (assignedToId !== undefined) update.assignedToId = assignedToId ? parseInt(assignedToId, 10) : null;
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

  // ── Notificações por mudança de status ─────────────────────────
  const newStatus = update.status as string | undefined;
  if (newStatus && newStatus !== task.status) {
    const [job] = await db.select({ name: jobsTable.name, createdById: jobsTable.createdById })
      .from(jobsTable).where(eq(jobsTable.id, updated.jobId));

    if (newStatus === "review" && task.createdById) {
      // Editor enviou para aprovação → notifica coordenador criador
      const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      await notify(task.createdById, "task_review",
        "Tarefa enviada para aprovação",
        `${editor?.name ?? "Editor"} enviou "${task.title}" para aprovação`,
        { taskId: id, jobId: updated.jobId }
      );
    }

    if (newStatus === "in_revision" && task.assignedToId) {
      // Coordenador pediu alteração → notifica editor
      const comment = revisionComment ? String(revisionComment).trim() : "";
      await notify(task.assignedToId, "task_revision",
        "Alteração solicitada",
        `Alteração solicitada em "${task.title}"${comment ? `: ${comment}` : ""}`,
        { taskId: id, jobId: updated.jobId }
      );
    }

    if (newStatus === "completed" && task.assignedToId) {
      // Tarefa aprovada → notifica editor
      await notify(task.assignedToId, "task_approved",
        "Tarefa aprovada",
        `Sua tarefa "${task.title}" foi aprovada`,
        { taskId: id, jobId: updated.jobId }
      );
      await createFeedItem({
        type: "task_completed",
        title: `Tarefa concluída: "${task.title}"`,
        actorId: userId,
        entityId: id,
        entityType: "task",
        jobId: updated.jobId,
      }).catch(() => {});
    }
  }

  // Reatribuição → notifica novo editor
  if (update.assignedToId && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number;
    const [job] = await db.select({ name: jobsTable.name }).from(jobsTable).where(eq(jobsTable.id, updated.jobId));
    await notify(newEditor, "task_reassigned",
      "Tarefa atribuída a você",
      `A tarefa "${task.title}" no job "${job?.name ?? ""}" foi atribuída a você`,
      { taskId: id, jobId: updated.jobId }
    );
  }

  // ── Auto-close job e projeto ───────────────────────────────────
  if (update.status === "completed") {
    const jobId = updated.jobId;
    const allJobTasks = await db.select({ status: tasksTable.status }).from(tasksTable).where(eq(tasksTable.jobId, jobId));
    if (allJobTasks.length > 0 && allJobTasks.every(t => t.status === "completed")) {
      const [closedJob] = await db.update(jobsTable).set({ status: "entregue" })
        .where(eq(jobsTable.id, jobId))
        .returning({ projectId: jobsTable.projectId, name: jobsTable.name, createdById: jobsTable.createdById });

      if (closedJob) {
        // Notificar coordenador do job
        if (closedJob.createdById) {
          await notify(closedJob.createdById, "job_completed",
            "Job concluído",
            `O job "${closedJob.name}" foi concluído automaticamente`,
            { jobId }
          );
        }

        const projectId = closedJob.projectId;
        const allProjectJobs = await db.select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.projectId, projectId));
        if (allProjectJobs.length > 0 && allProjectJobs.every(j => ["entregue", "aprovado"].includes(j.status))) {
          const [closedProject] = await db.update(projectsTable).set({ status: "concluido" })
            .where(eq(projectsTable.id, projectId))
            .returning({ name: projectsTable.name, createdById: projectsTable.createdById });

          // Notificar coordenador + admins do projeto concluído
          if (closedProject?.createdById) {
            await notify(closedProject.createdById, "project_completed",
              "Projeto concluído",
              `O projeto "${closedProject.name}" foi concluído`
            );
          }
          await notifyAdmins("project_completed",
            "Projeto concluído",
            `O projeto "${closedProject?.name ?? ""}" foi concluído`
          );
          broadcastProjectChange();
        }
        broadcastJobChange(projectId);
      }
    }
  }

  const [jobCtx] = await db.select({ projectId: jobsTable.projectId }).from(jobsTable).where(eq(jobsTable.id, updated.jobId));
  broadcastTaskChange(updated.jobId, jobCtx?.projectId ?? 0);
  res.json(updated);
});

router.post("/tasks/:id/return", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  // Editor só pode devolver tarefa atribuída a si mesmo
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
    taskId: id,
    fromStatus: prevStatus,
    toStatus: "pending",
    changedById: userId,
  });

  const [job] = await db.select({ projectId: jobsTable.projectId }).from(jobsTable).where(eq(jobsTable.id, task.jobId));

  if (task.createdById) {
    const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    await notify(task.createdById, "task_returned",
      "Tarefa devolvida",
      `${editor?.name ?? "Editor"} devolveu a tarefa "${task.title}".`,
      { taskId: id, jobId: task.jobId },
    );
  }

  broadcastTaskChange(task.jobId, job?.projectId ?? 0);
  res.json(updated);
});

router.delete("/tasks/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ jobId: tasksTable.jobId, status: tasksTable.status, assignedToId: tasksTable.assignedToId, title: tasksTable.title, createdById: tasksTable.createdById })
    .from(tasksTable).where(eq(tasksTable.id, id));

  if (!task) { res.sendStatus(204); return; }

  if (req.session.userRole === "coordinator" && task.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir esta tarefa. Apenas o criador ou um Supervisor pode fazer isso." }); return;
  }

  // Hard block: assigned + actively being worked on
  if (task.assignedToId !== null && (task.status === "in_progress" || task.status === "in_revision")) {
    res.status(409).json({
      error: "Esta tarefa está atribuída e em edição. Remova a atribuição antes de excluir.",
      blocked: true,
    });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  const [job] = await db.select({ projectId: jobsTable.projectId }).from(jobsTable).where(eq(jobsTable.id, task.jobId));
  broadcastTaskChange(task.jobId, job?.projectId ?? 0);
  res.sendStatus(204);
});

router.get("/tasks/overview", requireCoordinator, async (req, res): Promise<void> => {
  const { status, assignedToId, createdById } = req.query;

  const coordUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, ["coordinator", "supervisor", "admin"]));
  const coordIds = coordUsers.map(u => u.id);
  if (coordIds.length === 0) { res.json([]); return; }

  const conditions: ReturnType<typeof eq>[] = [inArray(tasksTable.createdById, coordIds) as any];
  if (status && status !== "all") conditions.push(eq(tasksTable.status, String(status)) as any);
  if (assignedToId) conditions.push(eq(tasksTable.assignedToId, parseInt(String(assignedToId), 10)) as any);
  if (createdById) conditions.push(eq(tasksTable.createdById, parseInt(String(createdById), 10)) as any);

  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      priority: tasksTable.priority,
      complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate,
      folderUrl: tasksTable.folderUrl,
      revisionCount: tasksTable.revisionCount,
      createdById: tasksTable.createdById,
      assignedToId: tasksTable.assignedToId,
      jobId: tasksTable.jobId,
      jobName: jobsTable.name,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectColor: projectsTable.color,
    })
    .from(tasksTable)
    .leftJoin(jobsTable, eq(tasksTable.jobId, jobsTable.id))
    .leftJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
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
    jobId: r.jobId,
    jobName: r.jobName,
    projectId: r.projectId,
    projectName: r.projectName,
    projectColor: r.projectColor,
    assignee: r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    isOwn: r.createdById === userId,
  })));
});

router.get("/my-tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;
  const filter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : eq(tasksTable.createdById, userId);
  const tasks = await db.select().from(tasksTable)
    .where(filter)
    .orderBy(desc(tasksTable.createdAt));

  // Hierarchical numbering
  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumberMap = new Map(allProjectIds.map((p, i) => [p.id, i + 1]));
  const uniqueJobIds = [...new Set(tasks.map(t => t.jobId))];
  const jobNumberMap = new Map<number, number>();
  const jobProjectMap = new Map<number, number>();
  const taskNumMap = new Map<number, number>();
  const jobNameMap  = new Map<number, string>();
  const jobClientMap = new Map<number, string | null>();
  const jobProjectNameMap = new Map<number, string>();

  await Promise.all(uniqueJobIds.map(async (jobId) => {
    const [job] = await db.select({ projectId: jobsTable.projectId, name: jobsTable.name }).from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) return;
    jobProjectMap.set(jobId, job.projectId);
    jobNameMap.set(jobId, job.name);
    const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, job.projectId)).orderBy(asc(jobsTable.id));
    jobNumberMap.set(jobId, allJobIds.findIndex(j => j.id === jobId) + 1);
    const allTaskIds = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.jobId, jobId)).orderBy(asc(tasksTable.id));
    allTaskIds.forEach((t, i) => taskNumMap.set(t.id, i + 1));
    const [project] = await db.select({ name: projectsTable.name, client: projectsTable.client }).from(projectsTable).where(eq(projectsTable.id, job.projectId));
    if (project) {
      jobClientMap.set(jobId, project.client);
      jobProjectNameMap.set(jobId, project.name);
    }
  }));

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
    const projectId = jobProjectMap.get(t.jobId);
    return {
      ...t,
      createdBy: createdBy ?? null,
      assignedTo: assignedTo ?? null,
      revisions,
      number: taskNumMap.get(t.id) ?? 0,
      jobNumber: jobNumberMap.get(t.jobId) ?? 0,
      projectNumber: projectId ? (projectNumberMap.get(projectId) ?? 0) : 0,
      jobName: jobNameMap.get(t.jobId) ?? null,
      projectName: jobProjectNameMap.get(t.jobId) ?? null,
      projectClient: jobClientMap.get(t.jobId) ?? null,
    };
  }));

  res.json(tasksWithDetails);
});

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
      jobId: tasksTable.jobId,
      jobName: jobsTable.name,
    })
    .from(taskEventsTable)
    .innerJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
    .leftJoin(jobsTable, eq(tasksTable.jobId, jobsTable.id))
    .where(
      role === "editor"
        ? eq(tasksTable.assignedToId, userId)
        : eq(tasksTable.createdById, userId)
    )
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
    changedByName: e.changedById ? changers[e.changedById] ?? null : null,
  })));
});

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

  weekEnd.setHours(23, 59, 59, 999);

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
      jobId: tasksTable.jobId,
      jobName: jobsTable.name,
      assignedToId: tasksTable.assignedToId,
    })
    .from(tasksTable)
    .leftJoin(jobsTable, eq(tasksTable.jobId, jobsTable.id))
    .where(and(roleFilter, gte(tasksTable.dueDate, weekStart), lte(tasksTable.dueDate, weekEnd)))
    .orderBy(asc(tasksTable.dueDate));

  const assigneeIds = [...new Set(rows.map(r => r.assignedToId).filter(Boolean))] as number[];
  const assignees = assigneeIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(eq(usersTable.id, assigneeIds[0]))
    : [];
  const assigneeMap = Object.fromEntries(assignees.map(a => [a.id, a.name]));

  if (assigneeIds.length > 1) {
    const rest = await Promise.all(
      assigneeIds.slice(1).map(id =>
        db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id))
      )
    );
    rest.flat().forEach(a => { assigneeMap[a.id] = a.name; });
  }

  res.json(rows.map(r => ({
    ...r,
    assigneeName: r.assignedToId ? assigneeMap[r.assignedToId] ?? null : null,
  })));
});

const COMPLEXITY_WEIGHT: Record<string, number> = { low: 1, medium: 3, high: 6 };

router.get("/workload", requireCoordinator, async (_req, res): Promise<void> => {
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.role, "editor"));

  const open = await db
    .select({
      id: tasksTable.id,
      status: tasksTable.status,
      complexity: tasksTable.complexity,
      assignedToId: tasksTable.assignedToId,
    })
    .from(tasksTable)
    .where(and(ne(tasksTable.status, "completed"), isNotNull(tasksTable.assignedToId)));

  const result = editors.map(editor => {
    const editorTasks = open.filter(t => t.assignedToId === editor.id);

    const score = editorTasks.reduce((sum, t) =>
      sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 3), 0);

    const byComplexity = {
      low:    editorTasks.filter(t => t.complexity === "low").length,
      medium: editorTasks.filter(t => t.complexity === "medium").length,
      high:   editorTasks.filter(t => t.complexity === "high").length,
    };

    const byStatus = {
      pending:     editorTasks.filter(t => t.status === "pending").length,
      in_progress: editorTasks.filter(t => t.status === "in_progress").length,
      in_revision: editorTasks.filter(t => t.status === "in_revision").length,
      review:      editorTasks.filter(t => t.status === "review").length,
    };

    return {
      id: editor.id,
      name: editor.name,
      login: editor.login,
      avatarUrl: editor.avatarUrl ?? null,
      taskCount: editorTasks.length,
      score,
      byComplexity,
      byStatus,
    };
  });

  result.sort((a, b) => b.score - a.score);

  res.json(result);
});

router.get("/dashboard-extras", requireAuth, async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysLater = new Date(today);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  sevenDaysLater.setHours(23, 59, 59, 999);

  // Week deliveries: jobs with dueDate in the next 7 days and not completed
  const weekJobRows = await db
    .select({
      id: jobsTable.id,
      name: jobsTable.name,
      status: jobsTable.status,
      dueDate: jobsTable.dueDate,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectColor: projectsTable.color,
    })
    .from(jobsTable)
    .innerJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
    .where(
      and(
        notInArray(jobsTable.status, ["entregue", "aprovado"]),
        gte(jobsTable.dueDate, today),
        lte(jobsTable.dueDate, sevenDaysLater)
      )
    );

  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumberMap = new Map(allProjectIds.map((p, i) => [p.id, i + 1]));

  const weekDeliveries = await Promise.all(weekJobRows.map(async (j) => {
    const tasks = await db.select({ status: tasksTable.status }).from(tasksTable).where(eq(tasksTable.jobId, j.id));
    const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, j.projectId)).orderBy(asc(jobsTable.id));
    const jobNumber = allJobIds.findIndex(jj => jj.id === j.id) + 1;
    return {
      ...j,
      taskCount: tasks.length,
      completedCount: tasks.filter(t => t.status === "completed").length,
      projectNumber: projectNumberMap.get(j.projectId) ?? 0,
      jobNumber,
    };
  }));

  // At-risk: tasks NOT completed AND dueDate < today, grouped by job/project, with assignee
  const overdueRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
      jobId: jobsTable.id,
      jobName: jobsTable.name,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectColor: projectsTable.color,
    })
    .from(tasksTable)
    .innerJoin(jobsTable, eq(tasksTable.jobId, jobsTable.id))
    .innerJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
    .where(
      and(
        ne(tasksTable.status, "completed"),
        isNotNull(tasksTable.dueDate),
        lt(tasksTable.dueDate, today)
      )
    );

  const atRisk = await Promise.all(overdueRows.map(async (t) => {
    const [assignee] = t.assignedToId
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, t.assignedToId))
      : [null];
    const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, t.projectId)).orderBy(asc(jobsTable.id));
    const jobNumber = allJobIds.findIndex(j => j.id === t.jobId) + 1;
    const allTaskIds = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.jobId, t.jobId)).orderBy(asc(tasksTable.id));
    const taskNumber = allTaskIds.findIndex(tt => tt.id === t.id) + 1;
    return {
      ...t,
      assigneeName: assignee?.name ?? null,
      projectNumber: projectNumberMap.get(t.projectId) ?? 0,
      jobNumber,
      number: taskNumber,
    };
  }));

  res.json({ weekDeliveries, atRisk });
});

router.get("/reports", requireCoordinator, async (req, res): Promise<void> => {
  const { from, to, projectId, userId } = req.query as Record<string, string | undefined>;

  // Build where clause using sql`` fragments for optional filters
  const whereClause = and(
    eq(tasksTable.status, "completed"),
    from ? gte(tasksTable.updatedAt, new Date(from + "T00:00:00")) : undefined,
    to ? lte(tasksTable.updatedAt, new Date(to + "T23:59:59")) : undefined,
    projectId ? eq(projectsTable.id, parseInt(projectId, 10)) : undefined,
    userId ? eq(tasksTable.assignedToId, parseInt(userId, 10)) : undefined,
  );

  const rows = await db
    .select({
      taskId: tasksTable.id,
      taskTitle: tasksTable.title,
      taskStatus: tasksTable.status,
      taskPriority: tasksTable.priority,
      taskComplexity: tasksTable.complexity,
      taskUpdatedAt: tasksTable.updatedAt,
      taskRevisionCount: tasksTable.revisionCount,
      assignedToId: tasksTable.assignedToId,
      jobId: jobsTable.id,
      jobName: jobsTable.name,
      jobDueDate: jobsTable.dueDate,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectClient: projectsTable.client,
      projectColor: projectsTable.color,
    })
    .from(tasksTable)
    .innerJoin(jobsTable, eq(tasksTable.jobId, jobsTable.id))
    .innerJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
    .where(whereClause)
    .orderBy(desc(tasksTable.updatedAt));

  const enriched = await Promise.all(rows.map(async (r) => {
    const [assignee] = r.assignedToId
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, r.assignedToId))
      : [null];
    return {
      task: {
        id: r.taskId,
        title: r.taskTitle,
        status: r.taskStatus,
        priority: r.taskPriority,
        complexity: r.taskComplexity,
        updatedAt: r.taskUpdatedAt,
        revisionCount: r.taskRevisionCount,
      },
      job: { id: r.jobId, name: r.jobName, dueDate: r.jobDueDate },
      project: { id: r.projectId, name: r.projectName, client: r.projectClient, color: r.projectColor },
      assignee: assignee ?? null,
      revisionCount: r.taskRevisionCount,
    };
  }));

  // Build summary
  const totalDelivered = enriched.length;

  const byProjectMap = new Map<number, { projectId: number; projectName: string; count: number }>();
  for (const item of enriched) {
    const key = item.project.id;
    if (!byProjectMap.has(key)) byProjectMap.set(key, { projectId: key, projectName: item.project.name, count: 0 });
    byProjectMap.get(key)!.count++;
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
      byProject: [...byProjectMap.values()],
      byEditor: [...byEditorMap.values()],
    },
  });
});

export default router;

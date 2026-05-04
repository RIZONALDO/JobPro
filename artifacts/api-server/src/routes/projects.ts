import { Router } from "express";
import { db, projectsTable, jobsTable, tasksTable, usersTable } from "@workspace/db";
import { eq, desc, asc, and, or, inArray, ne } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { broadcastProjectChange, broadcastJobChange } from "../lib/broadcast.js";

const ACTIVE_TASK_STATUSES = ["in_progress", "review", "in_revision"] as const;

type CountMode = "all" | "active" | "incomplete";

async function countTasksForProject(projectId: number, mode: CountMode = "all"): Promise<number> {
  const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, projectId));
  if (jobs.length === 0) return 0;
  const jobIds = jobs.map(j => j.id);
  const where =
    mode === "active"     ? and(inArray(tasksTable.jobId, jobIds), inArray(tasksTable.status, [...ACTIVE_TASK_STATUSES])) :
    mode === "incomplete" ? and(inArray(tasksTable.jobId, jobIds), ne(tasksTable.status, "completed")) :
                            inArray(tasksTable.jobId, jobIds);
  const rows = await db.select({ id: tasksTable.id }).from(tasksTable).where(where);
  return rows.length;
}

const router = Router();

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));

  const allIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const numberMap = new Map(allIds.map((p, i) => [p.id, i + 1]));

  const withCounts = await Promise.all(projects.map(async (p) => {
    const jobs = await db.select().from(jobsTable).where(eq(jobsTable.projectId, p.id));
    const jobIds = jobs.map(j => j.id);
    let taskCount = 0;
    let completedCount = 0;
    const assigneeIds = new Set<number>();
    for (const jid of jobIds) {
      const tasks = await db.select().from(tasksTable).where(eq(tasksTable.jobId, jid));
      taskCount += tasks.length;
      completedCount += tasks.filter(t => t.status === "completed").length;
      tasks.forEach(t => { if (t.assignedToId) assigneeIds.add(t.assignedToId); });
    }
    const assignees = assigneeIds.size
      ? await Promise.all([...assigneeIds].map(id =>
          db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
            .from(usersTable).where(eq(usersTable.id, id)).then(r => r[0] ?? null)
        )).then(r => r.filter(Boolean))
      : [];
    const [coordinator] = p.createdById
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, p.createdById))
      : [null];
    return { ...p, number: numberMap.get(p.id) ?? 0, jobCount: jobs.length, taskCount, completedCount, assignees, coordinator: coordinator ?? null };
  }));

  res.json(withCounts);
});

router.post("/projects", requireCoordinator, async (req, res): Promise<void> => {
  const { name, client, description, color, dueDate } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "Nome obrigatório" }); return; }

  const [project] = await db.insert(projectsTable).values({
    name: String(name),
    client: client ? String(client) : null,
    description: description ? String(description) : null,
    color: color ? String(color) : "#6366f1",
    dueDate: dueDate ? new Date(String(dueDate)) : null,
    createdById: req.session.userId,
  }).returning();

  broadcastProjectChange();
  res.status(201).json(project);
});

router.get("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumber = allProjectIds.findIndex(p => p.id === id) + 1;

  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.projectId, id)).orderBy(desc(jobsTable.createdAt));

  const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, id)).orderBy(asc(jobsTable.id));
  const jobNumberMap = new Map(allJobIds.map((j, i) => [j.id, i + 1]));

  const [coordinator] = project.createdById
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, project.createdById))
    : [null];

  const jobsWithCounts = await Promise.all(jobs.map(async (j) => {
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.jobId, j.id));
    const completedCount = tasks.filter(t => t.status === "completed").length;
    const assigneeIds = [...new Set(tasks.map(t => t.assignedToId).filter(Boolean))] as number[];
    const assignees = await Promise.all(
      assigneeIds.map(id =>
        db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, id)).then(r => r[0] ?? null)
      )
    ).then(r => r.filter(Boolean));
    const [createdBy] = j.createdById
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, j.createdById))
      : [null];
    return { ...j, number: jobNumberMap.get(j.id) ?? 0, taskCount: tasks.length, completedCount, assignees, createdBy: createdBy ?? null };
  }));

  res.json({ ...project, number: projectNumber, coordinator: coordinator ?? null, jobs: jobsWithCounts });
});

router.put("/projects/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { name, client, description, status, color, dueDate } = req.body ?? {};
  const force = req.query.force === "true";

  // Guard: status transitions that affect editors
  if (status && !force) {
    const [current] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, id));
    if (current && status !== current.status) {
      const s = String(status);
      // pausar: só tarefas sendo editadas agora
      // concluir/arquivar: qualquer tarefa não concluída
      const mode: CountMode | null =
        s === "pausado"   ? "active" :
        s === "concluido" ? "incomplete" :
        s === "arquivado" ? "incomplete" :
        null;
      if (mode) {
        const count = await countTasksForProject(id, mode);
        if (count > 0) {
          const level = s === "arquivado" ? "critical" : "warning";
          res.status(409).json({ error: `Este projeto tem ${count} tarefa(s) não concluída(s).`, activeTasks: count, level, newStatus: s });
          return;
        }
      }
    }
  }

  const update: Record<string, unknown> = {};
  if (name) update.name = String(name);
  if (client !== undefined) update.client = client ? String(client) : null;
  if (description !== undefined) update.description = description ? String(description) : null;
  if (status) update.status = String(status);
  if (color) update.color = String(color);
  if (dueDate !== undefined) update.dueDate = dueDate ? new Date(String(dueDate)) : null;

  const [project] = await db.update(projectsTable).set(update).where(eq(projectsTable.id, id)).returning();
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  broadcastProjectChange({ projectId: id, newStatus: status ? String(status) : undefined });
  res.json(project);
});

router.delete("/projects/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const force = req.query.force === "true";
  if (!force) {
    const taskCount = await countTasksForProject(id, "all");
    if (taskCount > 0) {
      res.status(409).json({ error: `Este projeto tem ${taskCount} tarefa(s) que serão perdidas permanentemente.`, activeTasks: taskCount, level: "critical" });
      return;
    }
  }

  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  broadcastProjectChange({ projectId: id, deleted: true });
  res.sendStatus(204);
});

router.get("/pipeline", requireAuth, async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(or(eq(projectsTable.status, "ativo"), eq(projectsTable.status, "pausado"), eq(projectsTable.status, "concluido")))
    .orderBy(desc(projectsTable.createdAt));

  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumberMap = new Map(allProjectIds.map((p, i) => [p.id, i + 1]));

  const result = await Promise.all(projects.map(async (p) => {
    const jobs = await db.select().from(jobsTable).where(eq(jobsTable.projectId, p.id));
    const jobIds = jobs.map(j => j.id);
    const completedJobCount = jobs.filter(j => j.status === "entregue").length;

    let allTasks: { status: string; dueDate: string | null }[] = [];
    for (const jid of jobIds) {
      const tasks = await db.select({ status: tasksTable.status, dueDate: tasksTable.dueDate }).from(tasksTable).where(eq(tasksTable.jobId, jid));
      allTasks = allTasks.concat(tasks);
    }

    const taskCount = allTasks.length;
    const completedTaskCount = allTasks.filter(t => t.status === "completed").length;

    // Compute stage
    let stage: string;
    if (p.status === "concluido" || p.status === "arquivado") {
      stage = "entregue";
    } else if (allTasks.some(t => t.status === "in_progress")) {
      stage = "producao";
    } else if (allTasks.some(t => t.status === "review") && !allTasks.some(t => t.status === "in_progress")) {
      stage = "aprovacao";
    } else {
      // active AND (no tasks OR all pending)
      stage = "briefing";
    }

    // Earliest non-null job dueDate
    const jobDueDates = jobs.map(j => j.dueDate).filter((d): d is string => d !== null);
    const dueDate = jobDueDates.length > 0 ? jobDueDates.sort()[0] : null;

    const [coordinator] = p.createdById
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, p.createdById))
      : [null];

    return {
      id: p.id,
      name: p.name,
      client: p.client,
      color: p.color,
      status: p.status,
      stage,
      jobCount: jobs.length,
      completedJobCount,
      taskCount,
      completedTaskCount,
      dueDate,
      coordinator: coordinator ?? null,
      number: projectNumberMap.get(p.id) ?? 0,
    };
  }));

  res.json(result);
});

export default router;

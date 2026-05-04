import { Router } from "express";
import { db, jobsTable, projectsTable, tasksTable, usersTable, taskRevisionsTable } from "@workspace/db";
import { eq, desc, asc, ne, isNotNull, or, sql, and, inArray } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { broadcastJobChange, broadcastProjectChange } from "../lib/broadcast.js";

const ACTIVE_TASK_STATUSES = ["in_progress", "review", "in_revision"] as const;

type CountMode = "all" | "active" | "incomplete";

async function countTasksForJob(jobId: number, mode: CountMode = "all"): Promise<number> {
  const where =
    mode === "active"     ? and(eq(tasksTable.jobId, jobId), inArray(tasksTable.status, [...ACTIVE_TASK_STATUSES])) :
    mode === "incomplete" ? and(eq(tasksTable.jobId, jobId), ne(tasksTable.status, "completed")) :
                            eq(tasksTable.jobId, jobId);
  const rows = await db.select({ id: tasksTable.id }).from(tasksTable).where(where);
  return rows.length;
}

const router = Router();

router.post("/projects/:projectId/jobs", requireCoordinator, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { name, description, dueDate } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "Nome obrigatório" }); return; }

  if (dueDate) {
    const [project] = await db.select({ dueDate: projectsTable.dueDate, createdAt: projectsTable.createdAt }).from(projectsTable).where(eq(projectsTable.id, projectId));
    const jobDate = new Date(String(dueDate));
    if (project?.createdAt && jobDate < project.createdAt) {
      const d = project.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      res.status(400).json({ error: `Data do job é anterior ao início do projeto (${d})` }); return;
    }
    if (project?.dueDate && jobDate > project.dueDate) {
      const d = project.dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      res.status(400).json({ error: `Data do job ultrapassa o prazo do projeto (${d})` }); return;
    }
  }

  const [job] = await db.insert(jobsTable).values({
    projectId,
    name: String(name),
    description: description ? String(description) : null,
    dueDate: dueDate ? new Date(String(dueDate)) : null,
    createdById: req.session.userId,
  }).returning();

  broadcastJobChange(projectId);
  broadcastProjectChange();
  res.status(201).json(job);
});

router.get("/jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job não encontrado" }); return; }

  const [project] = await db.select({ id: projectsTable.id, name: projectsTable.name, color: projectsTable.color })
    .from(projectsTable).where(eq(projectsTable.id, job.projectId));

  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumber = allProjectIds.findIndex(p => p.id === job.projectId) + 1;

  const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, job.projectId)).orderBy(asc(jobsTable.id));
  const jobNumber = allJobIds.findIndex(j => j.id === id) + 1;

  const allTaskIds = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.jobId, id)).orderBy(asc(tasksTable.id));
  const taskNumberMap = new Map(allTaskIds.map((t, i) => [t.id, i + 1]));

  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.jobId, id)).orderBy(desc(tasksTable.createdAt));

  const tasksWithAssignee = await Promise.all(tasks.map(async (t) => {
    const [assignedTo] = t.assignedToId
      ? await db.select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, t.assignedToId))
      : [null];
    const [createdBy] = t.createdById
      ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, t.createdById))
      : [null];
    const revisions = await db.select({
      id: taskRevisionsTable.id,
      revisionNumber: taskRevisionsTable.revisionNumber,
      comment: taskRevisionsTable.comment,
      createdAt: taskRevisionsTable.createdAt,
    }).from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, t.id)).orderBy(asc(taskRevisionsTable.revisionNumber));
    return { ...t, number: taskNumberMap.get(t.id) ?? 0, assignedTo: assignedTo ?? null, createdBy: createdBy ?? null, revisions };
  }));

  const [createdBy] = job.createdById
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, job.createdById))
    : [null];

  res.json({ ...job, projectNumber, jobNumber, project: project ?? null, createdBy: createdBy ?? null, tasks: tasksWithAssignee });
});

router.put("/jobs/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [existingJob] = await db.select({ createdById: jobsTable.createdById, status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id));
  if (!existingJob) { res.status(404).json({ error: "Job não encontrado" }); return; }
  if (req.session.userRole === "coordinator" && existingJob.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para editar este job. Apenas o criador ou um Supervisor pode fazer isso." }); return;
  }

  const { name, description, dueDate, status } = req.body ?? {};
  const force = req.query.force === "true";

  // Guard: warn on terminal/blocking status transitions
  if (status && !force) {
    const current = existingJob;
    if (current && status !== current.status) {
      const s = String(status);
      // entregue: qualquer tarefa não concluída (job está sendo encerrado)
      // aprovado: tarefas ainda em edição ativa
      const mode: CountMode | null =
        s === "entregue" ? "incomplete" :
        s === "aprovado" ? "active" :
        null;
      if (mode) {
        const count = await countTasksForJob(id, mode);
        if (count > 0) {
          res.status(409).json({ error: `Este job tem ${count} tarefa(s) não concluída(s).`, activeTasks: count, level: "warning", newStatus: s });
          return;
        }
      }
    }
  }

  const update: Record<string, unknown> = {};
  if (name) update.name = String(name);
  if (description !== undefined) update.description = description ? String(description) : null;
  if (status) update.status = String(status);

  if (dueDate !== undefined) {
    if (dueDate) {
      const [currentJob] = await db.select({ projectId: jobsTable.projectId }).from(jobsTable).where(eq(jobsTable.id, id));
      if (currentJob) {
        const [project] = await db.select({ dueDate: projectsTable.dueDate, createdAt: projectsTable.createdAt }).from(projectsTable).where(eq(projectsTable.id, currentJob.projectId));
        const jobDate = new Date(String(dueDate));
        if (project?.createdAt && jobDate < project.createdAt) {
          const d = project.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          res.status(400).json({ error: `Data do job é anterior ao início do projeto (${d})` }); return;
        }
        if (project?.dueDate && jobDate > project.dueDate) {
          const d = project.dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          res.status(400).json({ error: `Data do job ultrapassa o prazo do projeto (${d})` }); return;
        }
      }
    }
    update.dueDate = dueDate ? new Date(String(dueDate)) : null;
  }

  const [job] = await db.update(jobsTable).set(update).where(eq(jobsTable.id, id)).returning();
  if (!job) { res.status(404).json({ error: "Job não encontrado" }); return; }
  broadcastJobChange(job.projectId, { jobId: id, newStatus: status ? String(status) : undefined });
  broadcastProjectChange({ projectId: job.projectId });
  res.json(job);
});

router.delete("/jobs/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [job] = await db.select({ projectId: jobsTable.projectId, createdById: jobsTable.createdById }).from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) { res.sendStatus(204); return; }
  if (req.session.userRole === "coordinator" && job.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir este job. Apenas o criador ou um Supervisor pode fazer isso." }); return;
  }

  const force = req.query.force === "true";
  if (!force) {
    const activeTasks = await countTasksForJob(id, "all");
    if (activeTasks > 0) {
      res.status(409).json({ error: `Este job tem ${activeTasks} tarefa(s) que serão perdidas permanentemente.`, activeTasks, level: "critical" });
      return;
    }
  }

  await db.delete(jobsTable).where(eq(jobsTable.id, id));
  if (job) {
    broadcastJobChange(job.projectId, { jobId: id, deleted: true });
    broadcastProjectChange({ projectId: job.projectId });
  }
  res.sendStatus(204);
});

router.get("/timeline", requireCoordinator, async (_req, res): Promise<void> => {
  // Jobs where dueDate is not null OR status != completed
  const jobRows = await db
    .select({
      id: jobsTable.id,
      name: jobsTable.name,
      status: jobsTable.status,
      dueDate: jobsTable.dueDate,
      createdAt: jobsTable.createdAt,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectColor: projectsTable.color,
    })
    .from(jobsTable)
    .innerJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
    .where(or(isNotNull(jobsTable.dueDate), ne(jobsTable.status, "entregue")))
    .orderBy(sql`${jobsTable.dueDate} ASC NULLS LAST`);

  const allProjectIds = await db.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id));
  const projectNumberMap = new Map(allProjectIds.map((p, i) => [p.id, i + 1]));

  const timeline = await Promise.all(jobRows.map(async (j) => {
    const tasks = await db
      .select({ status: tasksTable.status, assignedToId: tasksTable.assignedToId })
      .from(tasksTable)
      .where(eq(tasksTable.jobId, j.id));

    const taskCount = tasks.length;
    const completedCount = tasks.filter(t => t.status === "completed").length;

    const assigneeIds = [...new Set(tasks.map(t => t.assignedToId).filter((id): id is number => id !== null))];
    const assignees = await Promise.all(
      assigneeIds.map(id =>
        db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(eq(usersTable.id, id))
          .then(r => r[0] ?? null)
      )
    ).then(r => r.filter((a): a is NonNullable<typeof a> => a !== null));

    const allJobIds = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.projectId, j.projectId)).orderBy(asc(jobsTable.id));
    const jobNumber = allJobIds.findIndex(jj => jj.id === j.id) + 1;

    return {
      id: j.id,
      name: j.name,
      status: j.status,
      dueDate: j.dueDate,
      createdAt: j.createdAt,
      projectId: j.projectId,
      projectName: j.projectName,
      projectColor: j.projectColor,
      taskCount,
      completedCount,
      assignees,
      projectNumber: projectNumberMap.get(j.projectId) ?? 0,
      jobNumber,
    };
  }));

  res.json(timeline);
});

export default router;

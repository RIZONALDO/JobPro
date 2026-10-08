import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, tasksTable, taskRevisionsTable, taskEventsTable, taskEditorsTable, dutySchedulesTable, userAbsencesTable, userPresenceTable } from "@workspace/db";
import { eq, and, ne, desc, asc, gte, notInArray, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSupervisor, requireCoordinator } from "../lib/auth.js";
import { getAbsenceMapOn, todayStr } from "../lib/availability.js";

const SUPERVISOR_MANAGED_ROLES = ["coordinator", "editor"];
const COORD_ROLES = ["admin", "supervisor", "coordinator"];
const MAX_AVATAR_CHARS = 200_000;

const optText = (v: unknown) => (v ? String(v).trim() || null : null);

const router = Router();

// List users (coordinators can view editors; admin sees all)
// ?active=1 → só usuários ativos (use em seletores de atribuição, menções etc.)
// Sem o parâmetro devolve todos (inclusive inativos) — necessário para exibir histórico.
// Cada usuário vem com `absence`: a ausência (férias/afastamento) que cobre hoje, ou null.
router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const role = req.session.userRole!;
  const onlyActive = req.query.active === "1" || req.query.active === "true";
  const users = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    login: usersTable.login,
    role: usersTable.role,
    status: usersTable.status,
    avatarUrl: usersTable.avatarUrl,
    jobTitle: usersTable.jobTitle,
    createdAt: usersTable.createdAt,
    email: usersTable.email,
    phone: usersTable.phone,
    mustChangePassword: usersTable.mustChangePassword,
    lastSeenAt: userPresenceTable.lastSeenAt,
    isOnline: userPresenceTable.isOnline,
  }).from(usersTable)
    .leftJoin(userPresenceTable, eq(userPresenceTable.userId, usersTable.id))
    .where(onlyActive ? eq(usersTable.status, "active") : undefined)
    .orderBy(usersTable.name);

  const absenceMap = await getAbsenceMapOn(todayStr());
  // Contato e dados de acesso só para quem gerencia a equipe
  const canSeePrivate = COORD_ROLES.includes(role);
  const ONLINE_WINDOW_MS = 2 * 60 * 1000;
  const withAbsence = users.map(({ email, phone, mustChangePassword, lastSeenAt, isOnline, ...u }) => ({
    ...u,
    absence: absenceMap.get(u.id) ?? null,
    online: !!isOnline && !!lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    ...(canSeePrivate ? { email, phone, mustChangePassword, lastSeenAt } : {}),
  }));

  // Non-admin roles don't see admin users
  if (role !== "admin") {
    res.json(withAbsence.filter(u => u.role !== "admin"));
    return;
  }
  res.json(withAbsence);
});

const OPEN_TASK_STATUSES_EXCLUDED = ["completed", "cancelled", "rascunho"];

/** Pendências de um usuário — usado antes de inativar. */
async function pendingFor(id: number) {
  const today = todayStr();
  const openTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, dueDate: tasksTable.dueDate })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.assignedToId, id),
      notInArray(tasksTable.status, OPEN_TASK_STATUSES_EXCLUDED),
    ))
    .orderBy(asc(tasksTable.dueDate));
  const extraTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, dueDate: tasksTable.dueDate })
    .from(taskEditorsTable)
    .innerJoin(tasksTable, eq(taskEditorsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskEditorsTable.userId, id),
      notInArray(tasksTable.status, OPEN_TASK_STATUSES_EXCLUDED),
      sql`${tasksTable.assignedToId} IS DISTINCT FROM ${id}`,
    ));
  const futureDuties = await db
    .select({ id: dutySchedulesTable.id, date: dutySchedulesTable.weekendStart })
    .from(dutySchedulesTable)
    .where(and(eq(dutySchedulesTable.editorId, id), gte(dutySchedulesTable.weekendStart, today)))
    .orderBy(asc(dutySchedulesTable.weekendStart));
  return { openTasks, extraTasks, futureDuties };
}

// GET /api/users/:id/pending — tarefas abertas e plantões futuros (pré-checagem de inativação)
router.get("/users/:id/pending", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  res.json(await pendingFor(id));
});

router.get("/users/:id/tasks", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const tasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate,
      client: tasksTable.client,
      color: tasksTable.color,
    })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.assignedToId, id),
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "paused"),
      ne(tasksTable.status, "rascunho"),
    ))
    .orderBy(desc(tasksTable.createdAt));

  res.json(tasks);
});

router.post("/users", requireSupervisor, async (req, res): Promise<void> => {
  const callerRole = req.session.userRole!;
  const { name, login, password, role, jobTitle, email, phone, avatarUrl, mustChangePassword } = req.body ?? {};
  if (typeof avatarUrl === "string" && avatarUrl.length > MAX_AVATAR_CHARS) {
    res.status(400).json({ error: "Imagem muito grande" }); return;
  }
  if (!name || !login || !password || !role) {
    res.status(400).json({ error: "name, login, password e role são obrigatórios" }); return;
  }
  if (callerRole === "supervisor" && !SUPERVISOR_MANAGED_ROLES.includes(String(role))) {
    res.status(403).json({ error: "Supervisor só pode criar coordenadores ou editores" }); return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.login, String(login)));
  if (existing.length > 0) { res.status(409).json({ error: "Login já cadastrado" }); return; }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const [user] = await db.insert(usersTable).values({
    name: String(name), login: String(login), passwordHash,
    role: String(role), jobTitle: jobTitle ? String(jobTitle) : null,
    email: optText(email), phone: optText(phone), avatarUrl: avatarUrl || null,
    mustChangePassword: mustChangePassword === false ? false : true,
    theme: "dark",
  } as any).returning();

  res.status(201).json({ id: user.id, name: user.name, login: user.login, role: user.role, jobTitle: user.jobTitle, status: user.status });
});

router.put("/users/:id", requireSupervisor, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const callerRole = req.session.userRole!;
  if (callerRole === "supervisor") {
    const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
    if (!target || !SUPERVISOR_MANAGED_ROLES.includes(target.role)) {
      res.status(403).json({ error: "Supervisor só pode editar coordenadores ou editores" }); return;
    }
  }

  const { name, login, password, role, status, jobTitle, removeFutureDuties, email, phone, avatarUrl, mustChangePassword } = req.body ?? {};
  if (typeof avatarUrl === "string" && avatarUrl.length > MAX_AVATAR_CHARS) {
    res.status(400).json({ error: "Imagem muito grande" }); return;
  }
  if (status && !["active", "inactive"].includes(String(status))) {
    res.status(400).json({ error: "Status inválido" }); return;
  }
  if (status === "inactive" && id === req.session.userId) {
    res.status(400).json({ error: "Não é possível inativar a si mesmo" }); return;
  }
  const [before] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, id));
  if (callerRole === "supervisor" && role && !SUPERVISOR_MANAGED_ROLES.includes(String(role))) {
    res.status(403).json({ error: "Supervisor não pode atribuir este perfil" }); return;
  }

  const update: Record<string, unknown> = {};
  if (name) update.name = String(name);
  if (login) {
    const dup = await db.select().from(usersTable).where(eq(usersTable.login, String(login)));
    if (dup.length > 0 && dup[0]!.id !== id) { res.status(409).json({ error: "Login já cadastrado" }); return; }
    update.login = String(login);
  }
  if (password) update.passwordHash = await bcrypt.hash(String(password), 10);
  if (role) update.role = String(role);
  if (status) update.status = String(status);
  if (jobTitle !== undefined) update.jobTitle = jobTitle ? String(jobTitle) : null;
  if (email !== undefined) update.email = optText(email);
  if (phone !== undefined) update.phone = optText(phone);
  if (avatarUrl !== undefined) update.avatarUrl = avatarUrl || null;
  if (typeof mustChangePassword === "boolean") update.mustChangePassword = mustChangePassword;

  const [user] = await db.update(usersTable).set(update).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  let removedDuties = 0;
  if (before?.status === "active" && user.status === "inactive") {
    // Encerra sessões abertas: o login já é recusado para inativos, mas sessões antigas seguiam válidas.
    await db.execute(sql`DELETE FROM session WHERE (sess->>'userId')::int = ${id}`);
    // Ausências futuras deixam de fazer sentido para quem saiu da equipe.
    await db.delete(userAbsencesTable).where(and(eq(userAbsencesTable.userId, id), gte(userAbsencesTable.startDate, todayStr())));
    if (removeFutureDuties) {
      const removed = await db.delete(dutySchedulesTable)
        .where(and(eq(dutySchedulesTable.editorId, id), gte(dutySchedulesTable.weekendStart, todayStr())))
        .returning({ id: dutySchedulesTable.id });
      removedDuties = removed.length;
    }
  }

  res.json({ removedDuties, id: user.id, name: user.name, login: user.login, role: user.role, jobTitle: user.jobTitle, status: user.status });
});

router.delete("/users/:id", requireSupervisor, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  if (id === req.session.userId) { res.status(400).json({ error: "Não é possível remover a si mesmo" }); return; }

  const callerRole = req.session.userRole!;
  if (callerRole === "supervisor") {
    const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
    if (!target || !SUPERVISOR_MANAGED_ROLES.includes(target.role)) {
      res.status(403).json({ error: "Supervisor só pode remover coordenadores ou editores" }); return;
    }
  }

  // Quem já tem histórico (tarefas, plantões) deve ser inativado, não removido:
  // excluir apagaria em cascata os plantões e deixaria tarefas sem responsável.
  const [{ n: taskRefs }] = await db.select({ n: count() }).from(tasksTable)
    .where(sql`${tasksTable.assignedToId} = ${id} OR ${tasksTable.createdById} = ${id}`);
  const [{ n: extraRefs }] = await db.select({ n: count() }).from(taskEditorsTable).where(eq(taskEditorsTable.userId, id));
  const [{ n: dutyRefs }] = await db.select({ n: count() }).from(dutySchedulesTable).where(eq(dutySchedulesTable.editorId, id));
  if (Number(taskRefs) + Number(extraRefs) + Number(dutyRefs) > 0) {
    res.status(409).json({ error: "Este usuário tem histórico de tarefas ou plantões. Altere o status para Inativo em vez de remover." });
    return;
  }

  await db.update(tasksTable).set({ assignedToId: null }).where(eq(tasksTable.assignedToId, id));
  await db.update(tasksTable).set({ createdById: null }).where(eq(tasksTable.createdById, id));
  await db.update(taskRevisionsTable).set({ createdById: null }).where(eq(taskRevisionsTable.createdById, id));
  await db.update(taskEventsTable).set({ changedById: null }).where(eq(taskEventsTable.changedById, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

export default router;

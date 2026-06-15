import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, tasksTable, taskRevisionsTable, taskEventsTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSupervisor, requireCoordinator } from "../lib/auth.js";

const SUPERVISOR_MANAGED_ROLES = ["coordinator", "editor"];

const router = Router();

// List users (coordinators can view editors; admin sees all)
router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const role = req.session.userRole!;
  const users = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    login: usersTable.login,
    role: usersTable.role,
    status: usersTable.status,
    avatarUrl: usersTable.avatarUrl,
    jobTitle: usersTable.jobTitle,
    profileColor: usersTable.profileColor,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.name);

  // Non-admin roles don't see admin users
  if (role !== "admin") {
    res.json(users.filter(u => u.role !== "admin"));
    return;
  }
  res.json(users);
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
  const { name, login, password, role, jobTitle } = req.body ?? {};
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
    mustChangePassword: true,
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

  const { name, login, password, role, status, jobTitle } = req.body ?? {};
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

  const [user] = await db.update(usersTable).set(update).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json({ id: user.id, name: user.name, login: user.login, role: user.role, jobTitle: user.jobTitle, status: user.status });
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

  await db.update(tasksTable).set({ assignedToId: null }).where(eq(tasksTable.assignedToId, id));
  await db.update(tasksTable).set({ createdById: null }).where(eq(tasksTable.createdById, id));
  await db.update(taskRevisionsTable).set({ createdById: null }).where(eq(taskRevisionsTable.createdById, id));
  await db.update(taskEventsTable).set({ changedById: null }).where(eq(taskEventsTable.changedById, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

export default router;

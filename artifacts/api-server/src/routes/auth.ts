import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { login, password } = req.body ?? {};
  if (!login || !password) { res.status(400).json({ error: "Login e senha obrigatórios" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.login, String(login)));
  if (!user || user.status !== "active") { res.status(401).json({ error: "Credenciais inválidas" }); return; }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) { res.status(401).json({ error: "Credenciais inválidas" }); return; }

  req.session.userId = user.id;
  req.session.userRole = user.role;

  res.json({
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    jobTitle: user.jobTitle ?? null,
    mustChangePassword: user.mustChangePassword,
    email: user.email ?? null,
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json({
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    jobTitle: user.jobTitle ?? null,
    mustChangePassword: user.mustChangePassword,
    email: user.email ?? null,
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
    theme: (user as any).theme ?? "dark",
  });
});

router.put("/auth/theme", requireAuth, async (req, res): Promise<void> => {
  const { theme } = req.body ?? {};
  if (theme !== "light" && theme !== "dark") { res.status(400).json({ error: "Tema invalido" }); return; }
  await db.update(usersTable).set({ theme } as any).where(eq(usersTable.id, req.session.userId!));
  res.json({ ok: true });
});

router.put("/auth/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const { name, email, phone, avatarUrl, currentPassword, newPassword } = req.body ?? {};

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  const update: Record<string, unknown> = {};
  if (name?.trim())          update.name      = String(name).trim();
  if (email  !== undefined)  update.email     = email  ? String(email).trim()  : null;
  if (phone  !== undefined)  update.phone     = phone  ? String(phone).trim()  : null;
  if (avatarUrl !== undefined) {
    if (typeof avatarUrl === "string" && avatarUrl.length > 200_000) {
      res.status(400).json({ error: "Imagem muito grande — use o botão de câmera para comprimir" }); return;
    }
    update.avatarUrl = avatarUrl || null;
  }

  if (newPassword) {
    if (newPassword.length < 6) { res.status(400).json({ error: "Nova senha muito curta (mínimo 6 caracteres)" }); return; }
    if (!currentPassword) { res.status(400).json({ error: "Senha atual obrigatória" }); return; }
    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) { res.status(401).json({ error: "Senha atual incorreta" }); return; }
    update.passwordHash = await bcrypt.hash(String(newPassword), 10);
    update.mustChangePassword = false;
  }

  if (Object.keys(update).length === 0) { res.json({ ok: true }); return; }

  const [updated] = await db.update(usersTable).set(update).where(eq(usersTable.id, userId)).returning();
  res.json({
    id: updated.id,
    name: updated.name,
    login: updated.login,
    role: updated.role,
    jobTitle: updated.jobTitle ?? null,
    mustChangePassword: updated.mustChangePassword,
    email: updated.email ?? null,
    phone: updated.phone ?? null,
    avatarUrl: updated.avatarUrl ?? null,
  });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < 6) { res.status(400).json({ error: "Nova senha muito curta" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  if (!user.mustChangePassword) {
    if (!currentPassword) { res.status(400).json({ error: "Senha atual obrigatória" }); return; }
    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) { res.status(401).json({ error: "Senha atual incorreta" }); return; }
  }

  const hash = await bcrypt.hash(String(newPassword), 10);
  await db.update(usersTable).set({ passwordHash: hash, mustChangePassword: false }).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

export default router;

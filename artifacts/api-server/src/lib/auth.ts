import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
  }
}

async function hydrateRole(req: Request): Promise<void> {
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) req.session.userRole = user.role;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (!req.session.userRole) {
    hydrateRole(req).then(() => next()).catch(() => next());
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: "Não autenticado" }); return; }
  const check = () => {
    if (req.session.userRole !== "admin") { res.status(403).json({ error: "Acesso negado" }); return; }
    next();
  };
  if (!req.session.userRole) { hydrateRole(req).then(check).catch(() => res.status(500).json({ error: "Erro interno" })); return; }
  check();
}

export function requireSupervisor(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: "Não autenticado" }); return; }
  const check = () => {
    if (!["admin", "supervisor"].includes(req.session.userRole ?? "")) {
      res.status(403).json({ error: "Acesso negado" }); return;
    }
    next();
  };
  if (!req.session.userRole) { hydrateRole(req).then(check).catch(() => res.status(500).json({ error: "Erro interno" })); return; }
  check();
}

export function requireCoordinator(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: "Não autenticado" }); return; }
  const check = () => {
    if (!["admin", "supervisor", "coordinator"].includes(req.session.userRole ?? "")) {
      res.status(403).json({ error: "Acesso negado" }); return;
    }
    next();
  };
  if (!req.session.userRole) { hydrateRole(req).then(check).catch(() => res.status(500).json({ error: "Erro interno" })); return; }
  check();
}

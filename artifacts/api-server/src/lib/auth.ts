import type { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Acesso negado" }); return; }
  next();
}

export function requireCoordinator(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (!["admin", "supervisor", "coordinator"].includes(req.session.userRole ?? "")) {
    res.status(403).json({ error: "Acesso negado" }); return;
  }
  next();
}

import { Router } from "express";
import { requireSupervisor } from "../lib/auth.js";
import { getEmailConfig, saveEmailConfig, sendReport, buildReportHtml } from "../lib/email-report.js";
import { db, usersTable, emailLogsTable } from "@workspace/db";
import { eq, desc, and, count, sql } from "drizzle-orm";

const router = Router();

// GET /api/duty/email-config
router.get("/duty/email-config", requireSupervisor, async (_req, res): Promise<void> => {
  const cfg = await getEmailConfig();
  res.json({ ...cfg, smtpPass: cfg.smtpPass ? "••••••••" : "" });
});

// PUT /api/duty/email-config
router.put("/duty/email-config", requireSupervisor, async (req, res): Promise<void> => {
  const { enabled, recipients, smtpHost, smtpPort, smtpUser, smtpPass, cronDay, cronHour, cronMinute } = req.body as {
    enabled?: boolean; recipients?: string[]; smtpHost?: string; smtpPort?: number;
    smtpUser?: string; smtpPass?: string; cronDay?: number; cronHour?: number; cronMinute?: number;
  };
  const update: Parameters<typeof saveEmailConfig>[0] = {};
  if (enabled    !== undefined) update.enabled    = enabled;
  if (recipients !== undefined) update.recipients = recipients;
  if (smtpHost   !== undefined) update.smtpHost   = smtpHost;
  if (smtpPort   !== undefined) update.smtpPort   = smtpPort;
  if (smtpUser   !== undefined) update.smtpUser   = smtpUser;
  if (cronDay    !== undefined) update.cronDay    = cronDay;
  if (cronHour   !== undefined) update.cronHour   = cronHour;
  if (cronMinute !== undefined) update.cronMinute = cronMinute;
  if (smtpPass && smtpPass !== "••••••••") update.smtpPass = smtpPass;

  await saveEmailConfig(update);
  const cfg = await getEmailConfig();
  res.json({ ...cfg, smtpPass: cfg.smtpPass ? "••••••••" : "" });
});

// POST /api/duty/email-send — manual trigger, signed by the logged-in supervisor
router.post("/duty/email-send", requireSupervisor, async (req, res): Promise<void> => {
  const { weekStart, weekEnd } = req.body as { weekStart?: string; weekEnd?: string };
  if (!weekStart || !weekEnd) { res.status(400).json({ error: "weekStart e weekEnd obrigatórios" }); return; }

  const userId = (req as any).session?.userId as number | undefined;
  let senderName: string | undefined;
  let senderTitle: string | undefined;
  if (userId) {
    const [user] = await db.select({ name: usersTable.name, jobTitle: usersTable.jobTitle }).from(usersTable).where(eq(usersTable.id, userId));
    senderName  = user?.name;
    senderTitle = user?.jobTitle ?? undefined;
  }

  const cfg = await getEmailConfig();
  try {
    await sendReport(weekStart, weekEnd, cfg, senderName, senderTitle);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao enviar" });
  }
});

// POST /api/duty/email-preview — preview signed by the logged-in supervisor
router.post("/duty/email-preview", requireSupervisor, async (req, res): Promise<void> => {
  const { weekStart, weekEnd } = req.body as { weekStart?: string; weekEnd?: string };
  if (!weekStart || !weekEnd) { res.status(400).json({ error: "weekStart e weekEnd obrigatórios" }); return; }

  const userId = (req as any).session?.userId as number | undefined;
  let senderName: string | undefined;
  let senderTitle: string | undefined;
  if (userId) {
    const [user] = await db.select({ name: usersTable.name, jobTitle: usersTable.jobTitle }).from(usersTable).where(eq(usersTable.id, userId));
    senderName  = user?.name;
    senderTitle = user?.jobTitle ?? undefined;
  }

  const html = await buildReportHtml(weekStart, weekEnd, senderName, senderTitle);
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// GET /api/duty/email-logs?page=1&limit=20&status=&trigger=
router.get("/duty/email-logs", requireSupervisor, async (req, res): Promise<void> => {
  const page    = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit   = Math.min(100, parseInt(req.query.limit as string || "20", 10));
  const status  = req.query.status  as string | undefined;
  const trigger = req.query.trigger as string | undefined;

  const conditions = [
    ...(status  ? [eq(emailLogsTable.status,  status)]  : []),
    ...(trigger ? [eq(emailLogsTable.trigger, trigger)] : []),
  ];
  const where = conditions.length ? and(...conditions) : undefined;

  const [logs, [{ total }]] = await Promise.all([
    db.select().from(emailLogsTable)
      .where(where).orderBy(desc(emailLogsTable.sentAt))
      .limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(emailLogsTable).where(where),
  ]);

  res.json({ logs, total: Number(total), page, limit });
});

// DELETE /api/duty/email-logs — clear all logs
router.delete("/duty/email-logs", requireSupervisor, async (_req, res): Promise<void> => {
  try {
    await db.execute(sql`DELETE FROM te_email_logs`);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("[DELETE /duty/email-logs]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao limpar histórico" });
  }
});

export default router;

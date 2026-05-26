import { Router } from "express";
import { db, notificationsTable, tasksTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

function fmtCode(num: number, year: number): string {
  return `${String(num).padStart(3, "0")}.${String(year).padStart(2, "0")}`;
}

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const rows = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      type: notificationsTable.type,
      title: notificationsTable.title,
      message: notificationsTable.message,
      read: notificationsTable.read,
      taskId: notificationsTable.taskId,
      jobId: notificationsTable.jobId,
      createdAt: notificationsTable.createdAt,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
    })
    .from(notificationsTable)
    .leftJoin(tasksTable, eq(tasksTable.id, notificationsTable.taskId))
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(40);
  res.json(rows.map(r => ({
    ...r,
    taskCode: r.taskNumber && r.taskYear ? fmtCode(r.taskNumber, r.taskYear) : null,
    taskNumber: undefined,
    taskYear: undefined,
  })));
});

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
  res.json({ count: rows.length });
});

router.put("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const userId = req.session.userId!;
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db.update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.sendStatus(204);
});

router.put("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  await db.update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
  res.sendStatus(204);
});

router.delete("/notifications/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const userId = req.session.userId!;
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.sendStatus(204);
});

router.delete("/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  await db.delete(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  res.sendStatus(204);
});

export default router;

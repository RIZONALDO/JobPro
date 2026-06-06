import { Router } from "express";
import { db, tasksTable, usersTable, reviewCommentsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";

const router = Router();

// ── GET /api/tasks/:id/review-comments?fileId=X ───────────────────────────────
router.get("/tasks/:id/review-comments", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  const fileId  = req.query.fileId ? parseInt(req.query.fileId as string) : undefined;

  const rows = await db
    .select({
      id:             reviewCommentsTable.id,
      taskId:         reviewCommentsTable.taskId,
      taskFileId:     reviewCommentsTable.taskFileId,
      parentId:       reviewCommentsTable.parentId,
      userId:         reviewCommentsTable.userId,
      timestampSec:   reviewCommentsTable.timestampSec,
      frameThumbnail: reviewCommentsTable.frameThumbnail,
      body:           reviewCommentsTable.body,
      resolvedAt:     reviewCommentsTable.resolvedAt,
      resolvedById:   reviewCommentsTable.resolvedById,
      createdAt:      reviewCommentsTable.createdAt,
      userName:       usersTable.name,
      userAvatarUrl:  usersTable.avatarUrl,
      userRole:       usersTable.role,
    })
    .from(reviewCommentsTable)
    .leftJoin(usersTable, eq(reviewCommentsTable.userId, usersTable.id))
    .where(eq(reviewCommentsTable.taskId, taskId))
    .orderBy(asc(reviewCommentsTable.createdAt));

  const filtered = fileId
    ? rows.filter(r => r.taskFileId === fileId || r.taskFileId === null)
    : rows;

  // Nest replies under their parents
  const topLevel  = filtered.filter(r => !r.parentId);
  const withReplies = topLevel.map(c => ({
    ...c,
    replies: filtered.filter(r => r.parentId === c.id),
  }));

  res.json(withReplies);
});

// ── POST /api/tasks/:id/review-comments ───────────────────────────────────────
router.post("/tasks/:id/review-comments", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  const userId  = req.session.userId!;

  const { taskFileId, parentId, timestampSec, frameThumbnail, body } = req.body as {
    taskFileId?: number;
    parentId?: number;
    timestampSec?: number;
    frameThumbnail?: string;
    body: string;
  };

  if (!body?.trim()) {
    res.status(400).json({ error: "Comentário não pode ser vazio" }); return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [comment] = await db.insert(reviewCommentsTable).values({
    taskId,
    taskFileId: taskFileId ?? null,
    parentId: parentId ?? null,
    userId,
    timestampSec: timestampSec ?? null,
    frameThumbnail: frameThumbnail ?? null,
    body: body.trim(),
  }).returning();

  const [user] = await db.select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId));

  broadcastTaskChange();

  res.status(201).json({ ...comment, userName: user?.name, userAvatarUrl: user?.avatarUrl, userRole: user?.role, replies: [] });
});

// ── PATCH /api/tasks/:id/review-comments/:commentId/resolve ───────────────────
router.patch("/tasks/:id/review-comments/:commentId/resolve", requireAuth, async (req, res): Promise<void> => {
  const taskId    = parseInt(req.params.id as string);
  const commentId = parseInt(req.params.commentId as string);
  const userId    = req.session.userId!;

  const [existing] = await db.select().from(reviewCommentsTable)
    .where(eq(reviewCommentsTable.id, commentId));
  if (!existing || existing.taskId !== taskId) {
    res.status(404).json({ error: "Comentário não encontrado" }); return;
  }

  const nowResolved = !existing.resolvedAt;
  const [updated] = await db.update(reviewCommentsTable)
    .set({
      resolvedAt:   nowResolved ? new Date() : null,
      resolvedById: nowResolved ? userId : null,
    })
    .where(eq(reviewCommentsTable.id, commentId))
    .returning();

  broadcastTaskChange();
  res.json(updated);
});

export default router;

import { Router } from "express";
import {
  db, tasksTable, usersTable,
  taskRevisionsTable, taskEventsTable, taskEditorsTable,
  taskReviewBatchesTable, taskFrameCommentsTable,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";

const router = Router();

// ── POST /api/tasks/:id/review-batches ────────────────────────────────────────
// Coordinator submits a batch of frame comments → changes status to in_revision
router.post("/tasks/:id/review-batches", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id);
  const userId = req.session.userId!;

  const { taskFileId, comments } = req.body as {
    taskFileId?: number;
    comments: Array<{
      timestampSec: number;
      orderIndex: number;
      body: string;
      thumbnailDataUrl?: string;
    }>;
  };

  if (!comments || comments.length === 0) {
    res.status(400).json({ error: "Adicione pelo menos um comentário de frame" }); return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (task.status !== "review") {
    res.status(400).json({ error: "A tarefa precisa estar em revisão para enviar alterações" }); return;
  }

  const newRevisionNumber = (task.revisionCount ?? 0) + 1;

  // Create batch record
  const [batch] = await db.insert(taskReviewBatchesTable).values({
    taskId,
    taskFileId: taskFileId ?? null,
    revisionNumber: newRevisionNumber,
    submittedById: userId,
    commentCount: comments.length,
  }).returning();

  // Store thumbnails as data URLs directly in DB — works in all environments
  // (static file serving only works in production; dev Vite proxy only covers /api/*)
  const commentInserts = comments.map((c) => ({
    batchId:        batch.id,
    taskId,
    timestampSec:   c.timestampSec,
    orderIndex:     c.orderIndex,
    frameThumbnail: c.thumbnailDataUrl ?? null,
    body:           c.body,
  }));

  await db.insert(taskFrameCommentsTable).values(commentInserts);

  // Update task status + revisionCount
  await db.update(tasksTable).set({
    status: "in_revision",
    revisionCount: newRevisionNumber,
  }).where(eq(tasksTable.id, taskId));

  // Create te_task_revisions entry (integrates with existing timeline)
  const summary = `${comments.length} comentário${comments.length > 1 ? "s" : ""} de revisão por frame`;
  await db.insert(taskRevisionsTable).values({
    taskId,
    revisionNumber: newRevisionNumber,
    comment: summary,
    createdById: userId,
  });

  // Record event
  await db.insert(taskEventsTable).values({
    taskId,
    fromStatus: "review",
    toStatus: "in_revision",
    changedById: userId,
  });

  // Notify editor and extra editors
  const recipients = new Set<number>();
  if (task.assignedToId) recipients.add(task.assignedToId);
  const extraEditors = await db.select({ userId: taskEditorsTable.userId })
    .from(taskEditorsTable).where(eq(taskEditorsTable.taskId, taskId));
  extraEditors.forEach(e => recipients.add(e.userId));

  for (const rid of recipients) {
    await notify(
      rid,
      "task_revision",
      "Alteração solicitada",
      `${comments.length} alteração${comments.length > 1 ? "ões" : ""} por frame em "${task.title}"`,
      { taskId }
    );
  }

  broadcastTaskChange();

  res.json({ ok: true, batchId: batch.id, revisionNumber: newRevisionNumber });
});

// ── GET /api/tasks/:id/review-batches ─────────────────────────────────────────
// Returns all review batches (with frame comments) for a task
router.get("/tasks/:id/review-batches", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id);

  const submitterAlias = { name: usersTable.name };

  const batches = await db.select({
    id:             taskReviewBatchesTable.id,
    taskFileId:     taskReviewBatchesTable.taskFileId,
    revisionNumber: taskReviewBatchesTable.revisionNumber,
    commentCount:   taskReviewBatchesTable.commentCount,
    submittedAt:    taskReviewBatchesTable.submittedAt,
    submittedByName: usersTable.name,
  })
    .from(taskReviewBatchesTable)
    .leftJoin(usersTable, eq(taskReviewBatchesTable.submittedById, usersTable.id))
    .where(eq(taskReviewBatchesTable.taskId, taskId))
    .orderBy(asc(taskReviewBatchesTable.revisionNumber));

  const result = await Promise.all(batches.map(async b => {
    const comments = await db
      .select({
        id:             taskFrameCommentsTable.id,
        timestampSec:   taskFrameCommentsTable.timestampSec,
        orderIndex:     taskFrameCommentsTable.orderIndex,
        frameThumbnail: taskFrameCommentsTable.frameThumbnail,
        body:           taskFrameCommentsTable.body,
      })
      .from(taskFrameCommentsTable)
      .where(eq(taskFrameCommentsTable.batchId, b.id))
      .orderBy(asc(taskFrameCommentsTable.orderIndex));

    return { ...b, comments };
  }));

  res.json(result);
});

export default router;

import { Router } from "express";
import { db, tasksTable, usersTable, reviewCommentsTable, taskEditorsTable, taskEventsTable, reviewReadsTable } from "@workspace/db";
import { eq, asc, sql, and, ne, or, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { notify } from "../lib/notify.js";

const router = Router();

// ── GET /api/tasks/:id/review-comments/counts ────────────────────────────────
// Retorna { [fileId]: { total, unresolved, unread } } para todos os arquivos da tarefa
router.get("/tasks/:id/review-comments/counts", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const userId = req.session.userId!;

  const [totals, unreads] = await Promise.all([
    db.select({
      fileId:     reviewCommentsTable.taskFileId,
      total:      sql<number>`count(*)::int`,
      unresolved: sql<number>`count(*) filter (where ${reviewCommentsTable.resolvedAt} is null)::int`,
    })
    .from(reviewCommentsTable)
    .where(eq(reviewCommentsTable.taskId, taskId))
    .groupBy(reviewCommentsTable.taskFileId),

    db.select({
      fileId: reviewCommentsTable.taskFileId,
      unread: sql<number>`count(*)::int`,
    })
    .from(reviewCommentsTable)
    .leftJoin(
      reviewReadsTable,
      and(eq(reviewReadsTable.taskId, reviewCommentsTable.taskId), eq(reviewReadsTable.userId, userId))
    )
    .where(and(
      eq(reviewCommentsTable.taskId, taskId),
      ne(reviewCommentsTable.userId, userId),
      or(isNull(reviewReadsTable.lastReadAt), sql`${reviewCommentsTable.createdAt} > ${reviewReadsTable.lastReadAt}`)
    ))
    .groupBy(reviewCommentsTable.taskFileId),
  ]);

  const unreadMap: Record<number, number> = {};
  unreads.forEach(r => { if (r.fileId != null) unreadMap[r.fileId] = r.unread; });

  const result: Record<number, { total: number; unresolved: number; unread: number }> = {};
  totals.forEach(r => {
    if (r.fileId != null) result[r.fileId] = { total: r.total, unresolved: r.unresolved, unread: unreadMap[r.fileId] ?? 0 };
  });
  res.json(result);
});

// ── GET /api/tasks/:id/review/last-read ─────────────────────────────────────
router.get("/tasks/:id/review/last-read", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  const userId = req.session.userId!;
  const [row] = await db.select({ lastReadAt: reviewReadsTable.lastReadAt })
    .from(reviewReadsTable)
    .where(and(eq(reviewReadsTable.taskId, taskId), eq(reviewReadsTable.userId, userId)));
  res.json({ lastReadAt: row?.lastReadAt ?? null });
});

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
      annotations:    reviewCommentsTable.annotations,
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

  const { taskFileId, parentId, timestampSec, frameThumbnail, annotations, body } = req.body as {
    taskFileId?: number;
    parentId?: number;
    timestampSec?: number;
    frameThumbnail?: string;
    annotations?: string;
    body: string;
  };

  if (!body?.trim()) {
    res.status(400).json({ error: "Comentário não pode ser vazio" }); return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [comment] = await db.insert(reviewCommentsTable).values({
    taskId,
    taskFileId:     taskFileId ?? null,
    parentId:       parentId ?? null,
    userId,
    timestampSec:   timestampSec ?? null,
    frameThumbnail: frameThumbnail ?? null,
    annotations:    annotations ?? null,
    body:           body.trim(),
  }).returning();

  const [user] = await db.select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId));

  broadcastTaskChange();

  // Registra evento no lifecycle e notifica colaboradores
  if (task.status === "review") {
    const snippet = body.trim().slice(0, 80) + (body.trim().length > 80 ? "…" : "");
    await db.insert(taskEventsTable).values({
      taskId,
      fromStatus:  "review",
      toStatus:    "comment_added",
      changedById: userId,
      meta: JSON.stringify({
        body:         snippet,
        timestampSec: timestampSec ?? null,
        parentId:     parentId ?? null,
      }),
    });
  }

  if (task.status === "review") {
    const senderRole = user?.role ?? "";
    const recipients = new Set<number>();

    if (["coordinator", "admin", "supervisor"].includes(senderRole)) {
      // Coord. comentou → notifica editor(es)
      if (task.assignedToId) recipients.add(task.assignedToId);
      const extras = await db.select({ userId: taskEditorsTable.userId })
        .from(taskEditorsTable).where(eq(taskEditorsTable.taskId, taskId));
      extras.forEach(e => recipients.add(e.userId));
    } else {
      // Editor comentou → notifica coordenador
      if (task.createdById) recipients.add(task.createdById);
    }

    recipients.delete(userId); // não notifica quem criou o comentário
    const senderName = user?.name?.split(" ")[0] ?? "Alguém";
    for (const rid of recipients) {
      await notify(rid, "review_comment",
        "Novo comentário na revisão",
        `${senderName} comentou em "${task.title}"`,
        { taskId },
      );
    }
  }

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

// ── PATCH /api/tasks/:id/review-comments/:commentId (editar body) ─────────────
router.patch("/tasks/:id/review-comments/:commentId", requireAuth, async (req, res): Promise<void> => {
  const taskId    = parseInt(req.params.id as string);
  const commentId = parseInt(req.params.commentId as string);
  const userId    = req.session.userId!;
  const { body }  = req.body as { body?: string };

  if (!body?.trim()) { res.status(400).json({ error: "Comentário não pode ser vazio" }); return; }

  const [existing] = await db.select().from(reviewCommentsTable).where(eq(reviewCommentsTable.id, commentId));
  if (!existing || existing.taskId !== taskId) { res.status(404).json({ error: "Não encontrado" }); return; }
  if (existing.userId !== userId) { res.status(403).json({ error: "Sem permissão" }); return; }

  const [updated] = await db.update(reviewCommentsTable)
    .set({ body: body.trim() })
    .where(eq(reviewCommentsTable.id, commentId))
    .returning();

  broadcastTaskChange();
  res.json(updated);
});

// ── DELETE /api/tasks/:id/review-comments/:commentId ─────────────────────────
router.delete("/tasks/:id/review-comments/:commentId", requireAuth, async (req, res): Promise<void> => {
  const taskId    = parseInt(req.params.id as string);
  const commentId = parseInt(req.params.commentId as string);
  const userId    = req.session.userId!;
  const userRole  = req.session.userRole!;

  const [existing] = await db.select().from(reviewCommentsTable).where(eq(reviewCommentsTable.id, commentId));
  if (!existing || existing.taskId !== taskId) { res.status(404).json({ error: "Não encontrado" }); return; }

  const isOwner = existing.userId === userId;
  const isCoord = ["coordinator", "admin", "supervisor"].includes(userRole);
  if (!isOwner && !isCoord) { res.status(403).json({ error: "Sem permissão" }); return; }

  await db.delete(reviewCommentsTable).where(eq(reviewCommentsTable.id, commentId));
  broadcastTaskChange();
  res.json({ ok: true });
});

export default router;

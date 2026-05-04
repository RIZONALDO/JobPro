import { Router } from "express";
import {
  db,
  feedItemsTable, feedReactionsTable, feedCommentsTable,
  chatMessagesTable, userPresenceTable, usersTable,
} from "@workspace/db";
import { eq, desc, asc, and, gt, inArray } from "drizzle-orm"; // gt used in presence query
import { requireAuth } from "../lib/auth.js";
import {
  broadcastFeedReaction, broadcastFeedComment, broadcastFeedCommentDeleted,
  broadcastChatMessage, broadcastPresence,
} from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";
import { notify } from "../lib/notify.js";

async function notifyMentions(
  mentions: number[] | undefined,
  actorId: number,
  context: string,
  refs?: { jobId?: number },
) {
  if (!mentions?.length) return;
  const [actor] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  const name = actor?.name ?? "Alguém";
  await Promise.all(
    mentions
      .filter(uid => uid !== actorId)
      .map(uid =>
        notify(uid, "feed_mention", "Você foi mencionado", `${name} mencionou você ${context}`, refs)
      )
  );
}

const router = Router();

// ── Helpers ────────────────────────────────────────────────────

async function enrichFeedItems(items: typeof feedItemsTable.$inferSelect[], myUserId: number) {
  if (items.length === 0) return [];

  const ids = items.map(i => i.id);

  const reactions = await db
    .select({
      id: feedReactionsTable.id,
      feedItemId: feedReactionsTable.feedItemId,
      userId: feedReactionsTable.userId,
      emoji: feedReactionsTable.emoji,
      userName: usersTable.name,
    })
    .from(feedReactionsTable)
    .leftJoin(usersTable, eq(feedReactionsTable.userId, usersTable.id))
    .where(inArray(feedReactionsTable.feedItemId, ids));

  const comments = await db
    .select({ feedItemId: feedCommentsTable.feedItemId, count: feedCommentsTable.id })
    .from(feedCommentsTable)
    .where(inArray(feedCommentsTable.feedItemId, ids));

  const commentCountMap = new Map<number, number>();
  for (const c of comments) {
    commentCountMap.set(c.feedItemId, (commentCountMap.get(c.feedItemId) ?? 0) + 1);
  }

  const actorIds = [...new Set(items.map(i => i.actorId).filter((id): id is number => id !== null))];
  const actors = actorIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, actorIds))
    : [];
  const actorMap = new Map(actors.map(a => [a.id, a]));

  return items.map(item => ({
    ...item,
    actor: item.actorId ? (actorMap.get(item.actorId) ?? null) : null,
    reactions: reactions.filter(r => r.feedItemId === item.id),
    commentCount: commentCountMap.get(item.id) ?? 0,
    myReactions: reactions.filter(r => r.feedItemId === item.id && r.userId === myUserId).map(r => r.emoji),
  }));
}

// ── Feed routes ────────────────────────────────────────────────

router.get("/feed", requireAuth, async (req, res): Promise<void> => {
  const myUserId = req.session.userId!;
  const items = await db
    .select()
    .from(feedItemsTable)
    .orderBy(desc(feedItemsTable.createdAt))
    .limit(50);

  res.json(await enrichFeedItems(items, myUserId));
});

router.post("/feed", requireAuth, async (req, res): Promise<void> => {
  const { content, mentions } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Conteúdo obrigatório" }); return; }

  const userId = req.session.userId!;
  const [actor] = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  await createFeedItem({
    type: "manual_post",
    title: `${actor?.name ?? "Alguém"} publicou`,
    content: String(content).trim(),
    actorId: userId,
    entityType: undefined,
  });

  await notifyMentions(mentions, userId, "no feed");
  res.status(201).json({ ok: true });
});

router.put("/feed/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { content } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Conteúdo obrigatório" }); return; }

  const userId = req.session.userId!;
  const [item] = await db.select().from(feedItemsTable).where(eq(feedItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Post não encontrado" }); return; }
  if (item.actorId !== userId) { res.status(403).json({ error: "Sem permissão" }); return; }

  const [updated] = await db
    .update(feedItemsTable)
    .set({ content: String(content).trim() })
    .where(eq(feedItemsTable.id, id))
    .returning();

  res.json(updated);
});

router.delete("/feed/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = req.session.userId!;
  const role = req.session.userRole!;
  const [item] = await db.select().from(feedItemsTable).where(eq(feedItemsTable.id, id));
  if (!item) { res.sendStatus(204); return; }
  if (item.actorId !== userId && !["admin", "supervisor"].includes(role)) {
    res.status(403).json({ error: "Sem permissão" }); return;
  }

  await db.delete(feedItemsTable).where(eq(feedItemsTable.id, id));
  res.sendStatus(204);
});

// ── Reactions ──────────────────────────────────────────────────

router.post("/feed/:id/reactions", requireAuth, async (req, res): Promise<void> => {
  const feedItemId = parseInt(req.params.id, 10);
  if (isNaN(feedItemId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { emoji } = req.body ?? {};
  if (!emoji) { res.status(400).json({ error: "Emoji obrigatório" }); return; }

  const userId = req.session.userId!;

  // Toggle: remove if exists, add if not
  const [existing] = await db
    .select()
    .from(feedReactionsTable)
    .where(
      and(
        eq(feedReactionsTable.feedItemId, feedItemId),
        eq(feedReactionsTable.userId, userId),
        eq(feedReactionsTable.emoji, String(emoji)),
      )
    );

  if (existing) {
    await db.delete(feedReactionsTable).where(eq(feedReactionsTable.id, existing.id));
  } else {
    await db.insert(feedReactionsTable).values({ feedItemId, userId, emoji: String(emoji) });
  }

  // Re-fetch all reactions for this item to broadcast
  const reactions = await db
    .select({
      id: feedReactionsTable.id,
      feedItemId: feedReactionsTable.feedItemId,
      userId: feedReactionsTable.userId,
      emoji: feedReactionsTable.emoji,
      userName: usersTable.name,
    })
    .from(feedReactionsTable)
    .leftJoin(usersTable, eq(feedReactionsTable.userId, usersTable.id))
    .where(eq(feedReactionsTable.feedItemId, feedItemId));

  broadcastFeedReaction(feedItemId, reactions);
  res.json(reactions);
});

// ── Comments ───────────────────────────────────────────────────

router.get("/feed/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const feedItemId = parseInt(req.params.id, 10);
  if (isNaN(feedItemId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const comments = await db
    .select({
      id: feedCommentsTable.id,
      feedItemId: feedCommentsTable.feedItemId,
      userId: feedCommentsTable.userId,
      content: feedCommentsTable.content,
      createdAt: feedCommentsTable.createdAt,
      userName: usersTable.name,
      userAvatar: usersTable.avatarUrl,
    })
    .from(feedCommentsTable)
    .leftJoin(usersTable, eq(feedCommentsTable.userId, usersTable.id))
    .where(eq(feedCommentsTable.feedItemId, feedItemId))
    .orderBy(asc(feedCommentsTable.createdAt));

  res.json(comments);
});

router.post("/feed/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const feedItemId = parseInt(req.params.id, 10);
  if (isNaN(feedItemId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { content, mentions } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Conteúdo obrigatório" }); return; }

  const userId = req.session.userId!;
  const [comment] = await db
    .insert(feedCommentsTable)
    .values({ feedItemId, userId, content: String(content).trim() })
    .returning();

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const enriched = { ...comment, userName: user?.name ?? null, userAvatar: user?.avatarUrl ?? null };
  broadcastFeedComment(feedItemId, enriched);
  await notifyMentions(mentions, userId, "em um comentário");
  res.status(201).json(enriched);
});

router.delete("/feed/comments/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [comment] = await db.select().from(feedCommentsTable).where(eq(feedCommentsTable.id, id));
  if (!comment) { res.sendStatus(204); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;
  if (comment.userId !== userId && !["admin", "supervisor"].includes(role)) {
    res.status(403).json({ error: "Sem permissão" }); return;
  }

  await db.delete(feedCommentsTable).where(eq(feedCommentsTable.id, id));
  broadcastFeedCommentDeleted(comment.feedItemId, id);
  res.sendStatus(204);
});

// ── Chat ───────────────────────────────────────────────────────

router.get("/chat/messages", requireAuth, async (_req, res): Promise<void> => {
  const messages = await db
    .select({
      id: chatMessagesTable.id,
      userId: chatMessagesTable.userId,
      content: chatMessagesTable.content,
      createdAt: chatMessagesTable.createdAt,
      userName: usersTable.name,
      userAvatar: usersTable.avatarUrl,
    })
    .from(chatMessagesTable)
    .leftJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);

  res.json(messages.reverse());
});

router.post("/chat/messages", requireAuth, async (req, res): Promise<void> => {
  const { content, mentions } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Mensagem obrigatória" }); return; }

  const userId = req.session.userId!;
  const [msg] = await db
    .insert(chatMessagesTable)
    .values({ userId, content: String(content).trim() })
    .returning();

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const enriched = { ...msg, userName: user?.name ?? null, userAvatar: user?.avatarUrl ?? null };
  broadcastChatMessage(enriched);
  await notifyMentions(mentions, userId, "no chat");
  res.status(201).json(enriched);
});

// ── Presence ───────────────────────────────────────────────────

router.get("/presence", requireAuth, async (_req, res): Promise<void> => {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  const present = await db
    .select({
      userId: userPresenceTable.userId,
      lastSeenAt: userPresenceTable.lastSeenAt,
      isOnline: userPresenceTable.isOnline,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(userPresenceTable)
    .leftJoin(usersTable, eq(userPresenceTable.userId, usersTable.id))
    .where(and(
      eq(userPresenceTable.isOnline, true),
      gt(userPresenceTable.lastSeenAt, twoMinutesAgo),
    ));

  res.json(present);
});

router.post("/presence/ping", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  await db
    .insert(userPresenceTable)
    .values({ userId, lastSeenAt: new Date(), isOnline: true })
    .onConflictDoUpdate({
      target: userPresenceTable.userId,
      set: { lastSeenAt: new Date(), isOnline: true },
    });

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (user) broadcastPresence(userId, true, user);
  res.sendStatus(204);
});

export default router;

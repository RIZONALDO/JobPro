import { Router } from "express";
import {
  db,
  feedItemsTable, feedReactionsTable, feedCommentsTable,
  chatMessagesTable, chatReactionsTable, userPresenceTable, usersTable,
} from "@workspace/db";
import { eq, desc, asc, and, gt, lt, inArray, sql } from "drizzle-orm"; // gt used in presence query
import { requireAuth } from "../lib/auth.js";
import {
  broadcastFeedReaction, broadcastFeedComment, broadcastFeedCommentDeleted,
  broadcastChatMessage, broadcastChatDeleted, broadcastChatReaction, broadcastPresence,
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

async function enrichChatMessages(msgs: { id: number; userId: number; content: string; replyToId: number | null; createdAt: Date; userName: string | null; userAvatar: string | null }[], myId: number) {
  if (!msgs.length) return [];
  const ids = msgs.map(m => m.id);

  // Reactions
  const rawReactions = await db.select({
    messageId: chatReactionsTable.messageId,
    emoji: chatReactionsTable.emoji,
    userId: chatReactionsTable.userId,
    userName: usersTable.name,
  }).from(chatReactionsTable)
    .leftJoin(usersTable, eq(chatReactionsTable.userId, usersTable.id))
    .where(inArray(chatReactionsTable.messageId, ids));

  const reactMap = new Map<number, { emoji: string; count: number; mine: boolean; users: string[] }[]>();
  for (const r of rawReactions) {
    if (!reactMap.has(r.messageId)) reactMap.set(r.messageId, []);
    const group = reactMap.get(r.messageId)!.find(g => g.emoji === r.emoji);
    if (group) { group.count++; group.users.push(r.userName ?? "?"); if (r.userId === myId) group.mine = true; }
    else reactMap.get(r.messageId)!.push({ emoji: r.emoji, count: 1, mine: r.userId === myId, users: [r.userName ?? "?"] });
  }

  // Reply context
  const replyIds = msgs.map(m => m.replyToId).filter((id): id is number => id !== null);
  const replyMap = new Map<number, { id: number; content: string; userName: string | null; userId: number | null }>();
  if (replyIds.length) {
    const replies = await db.select({ id: chatMessagesTable.id, content: chatMessagesTable.content, userName: usersTable.name, userId: chatMessagesTable.userId })
      .from(chatMessagesTable).leftJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
      .where(inArray(chatMessagesTable.id, replyIds));
    for (const r of replies) replyMap.set(r.id, r);
  }

  return msgs.map(m => ({
    ...m,
    reactions: reactMap.get(m.id) ?? [],
    replyTo: m.replyToId ? (replyMap.get(m.replyToId) ?? null) : null,
  }));
}

router.get("/chat/messages", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const LIMIT = 10;
  const beforeRaw = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
  const beforeId = beforeRaw ? parseInt(String(beforeRaw), 10) : null;

  const rows = await db
    .select({
      id: chatMessagesTable.id,
      userId: chatMessagesTable.userId,
      content: chatMessagesTable.content,
      replyToId: chatMessagesTable.replyToId,
      createdAt: chatMessagesTable.createdAt,
      userName: usersTable.name,
      userAvatar: usersTable.avatarUrl,
    })
    .from(chatMessagesTable)
    .leftJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
    .where(beforeId ? lt(chatMessagesTable.id, beforeId) : undefined)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(LIMIT + 1);

  const hasMore = rows.length > LIMIT;
  const messages = rows.slice(0, LIMIT).reverse();

  res.json({ messages: await enrichChatMessages(messages, myId), hasMore });
});

router.post("/chat/messages", requireAuth, async (req, res): Promise<void> => {
  const { content, mentions, replyToId } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Mensagem obrigatória" }); return; }

  const userId = req.session.userId!;
  const contentTrimmed = String(content).trim();
  const parsedReplyTo = replyToId ? parseInt(String(replyToId), 10) : null;

  const result = await db.execute<{
    id: number; userId: number; content: string; replyToId: number | null; createdAt: Date;
    userName: string | null; userAvatar: string | null;
  }>(sql`
    WITH inserted AS (
      INSERT INTO te_chat_messages (user_id, content, reply_to_id)
      VALUES (${userId}, ${contentTrimmed}, ${parsedReplyTo})
      RETURNING id, user_id, content, reply_to_id, created_at
    )
    SELECT
      i.id::int,
      i.user_id::int        AS "userId",
      i.content,
      i.reply_to_id::int    AS "replyToId",
      i.created_at          AS "createdAt",
      u.name                AS "userName",
      u.avatar_url          AS "userAvatar"
    FROM inserted i
    JOIN te_users u ON u.id = i.user_id
  `);

  const [enriched] = await enrichChatMessages([result.rows[0]], userId);
  broadcastChatMessage(enriched);
  await notifyMentions(mentions, userId, "no chat");
  res.status(201).json(enriched);
});

router.delete("/chat/messages/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  const [msg] = await db.select({ userId: chatMessagesTable.userId }).from(chatMessagesTable).where(eq(chatMessagesTable.id, id));
  if (!msg) { res.status(404).json({ error: "Mensagem não encontrada" }); return; }
  if (msg.userId !== userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
  broadcastChatDeleted(id);
  res.sendStatus(204);
});

router.post("/chat/messages/:id/reactions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const messageId = parseInt(req.params.id, 10);
  const { emoji } = req.body ?? {};
  if (!emoji) { res.status(400).json({ error: "Emoji obrigatório" }); return; }

  const existing = await db.select({ id: chatReactionsTable.id })
    .from(chatReactionsTable)
    .where(and(eq(chatReactionsTable.messageId, messageId), eq(chatReactionsTable.userId, userId), eq(chatReactionsTable.emoji, String(emoji))));

  if (existing.length) {
    await db.delete(chatReactionsTable).where(eq(chatReactionsTable.id, existing[0].id));
  } else {
    await db.insert(chatReactionsTable).values({ messageId, userId, emoji: String(emoji) });
  }

  const reactions = await db.select({ emoji: chatReactionsTable.emoji, userId: chatReactionsTable.userId, userName: usersTable.name })
    .from(chatReactionsTable).leftJoin(usersTable, eq(chatReactionsTable.userId, usersTable.id))
    .where(eq(chatReactionsTable.messageId, messageId));

  const grouped = Object.values(reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { emoji: r.emoji, count: 0, mine: false, users: [] };
    acc[r.emoji].count++;
    acc[r.emoji].users.push(r.userName ?? "?");
    if (r.userId === userId) acc[r.emoji].mine = true;
    return acc;
  }, {} as Record<string, { emoji: string; count: number; mine: boolean; users: string[] }>));

  broadcastChatReaction(messageId, grouped);
  res.json(grouped);
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

import { Router } from "express";
import { db, directMessagesTable, dmReactionsTable, usersTable } from "@workspace/db";
import { eq, and, or, desc, lt, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastDm, broadcastDmRead, broadcastDmDeleted, broadcastDmReaction } from "../lib/broadcast.js";

const router = Router();

// List conversations: one entry per person I've talked to, with last message + unread count
router.get("/dm/conversations", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;

  const rows = await db.execute(sql`
    SELECT
      u.id        AS "userId",
      u.name      AS "userName",
      u.avatar_url AS "userAvatar",
      lm.content  AS "lastMessage",
      lm.created_at AS "lastAt",
      lm.from_user_id AS "lastFromId",
      (SELECT COUNT(*) FROM te_direct_messages
       WHERE to_user_id = ${myId} AND from_user_id = u.id AND read_at IS NULL
      )::int AS "unread"
    FROM te_users u
    JOIN LATERAL (
      SELECT content, created_at, from_user_id
      FROM te_direct_messages
      WHERE (from_user_id = ${myId} AND to_user_id = u.id)
         OR (from_user_id = u.id AND to_user_id = ${myId})
      ORDER BY created_at DESC
      LIMIT 1
    ) lm ON TRUE
    ORDER BY lm.created_at DESC
  `);

  res.json(rows.rows);
});

// Get messages between me and another user (cursor-based pagination)
router.get("/dm/:userId", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const otherId = parseInt(String(req.params.userId), 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const LIMIT = 10;
  const beforeRaw = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
  const beforeId = beforeRaw ? parseInt(String(beforeRaw), 10) : null;

  const baseWhere = or(
    and(eq(directMessagesTable.fromUserId, myId), eq(directMessagesTable.toUserId, otherId)),
    and(eq(directMessagesTable.fromUserId, otherId), eq(directMessagesTable.toUserId, myId)),
  )!;

  const rawRows = await db
    .select({
      id: directMessagesTable.id,
      fromUserId: directMessagesTable.fromUserId,
      toUserId: directMessagesTable.toUserId,
      content: directMessagesTable.content,
      replyToId: directMessagesTable.replyToId,
      createdAt: directMessagesTable.createdAt,
      readAt: directMessagesTable.readAt,
      fromName: usersTable.name,
      fromAvatar: usersTable.avatarUrl,
    })
    .from(directMessagesTable)
    .leftJoin(usersTable, eq(directMessagesTable.fromUserId, usersTable.id))
    .where(beforeId ? and(baseWhere, lt(directMessagesTable.id, beforeId)) : baseWhere)
    .orderBy(desc(directMessagesTable.createdAt))
    .limit(LIMIT + 1);

  const hasMore = rawRows.length > LIMIT;
  const msgs = rawRows.slice(0, LIMIT).reverse();

  // Enrich with reactions + replyTo
  const ids = msgs.map(m => m.id);
  const rawReactions = ids.length ? await db.select({
    messageId: dmReactionsTable.messageId, emoji: dmReactionsTable.emoji,
    userId: dmReactionsTable.userId, userName: usersTable.name,
  }).from(dmReactionsTable).leftJoin(usersTable, eq(dmReactionsTable.userId, usersTable.id))
    .where(inArray(dmReactionsTable.messageId, ids)) : [];

  const reactMap = new Map<number, { emoji: string; count: number; mine: boolean; users: string[] }[]>();
  for (const r of rawReactions) {
    if (!reactMap.has(r.messageId)) reactMap.set(r.messageId, []);
    const group = reactMap.get(r.messageId)!.find(g => g.emoji === r.emoji);
    if (group) { group.count++; group.users.push(r.userName ?? "?"); if (r.userId === myId) group.mine = true; }
    else reactMap.get(r.messageId)!.push({ emoji: r.emoji, count: 1, mine: r.userId === myId, users: [r.userName ?? "?"] });
  }

  const replyIds = msgs.map(m => m.replyToId).filter((id): id is number => id !== null);
  const replyMap = new Map<number, { id: number; content: string; fromName: string | null; fromUserId: number | null }>();
  if (replyIds.length) {
    const replies = await db.select({ id: directMessagesTable.id, content: directMessagesTable.content, fromName: usersTable.name, fromUserId: directMessagesTable.fromUserId })
      .from(directMessagesTable).leftJoin(usersTable, eq(directMessagesTable.fromUserId, usersTable.id))
      .where(inArray(directMessagesTable.id, replyIds));
    for (const r of replies) replyMap.set(r.id, r);
  }

  const messages = msgs.map(m => ({
    ...m,
    reactions: reactMap.get(m.id) ?? [],
    replyTo: m.replyToId ? (replyMap.get(m.replyToId) ?? null) : null,
  }));

  // Marcar como lido apenas na carga inicial (não no "carregar mais")
  if (!beforeId) {
    await db
      .update(directMessagesTable)
      .set({ readAt: new Date() })
      .where(
        and(eq(directMessagesTable.toUserId, myId), eq(directMessagesTable.fromUserId, otherId),
          sql`${directMessagesTable.readAt} IS NULL`)
      );
    broadcastDmRead(otherId, myId);
  }

  res.json({ messages, hasMore });
});

// Send DM
router.post("/dm/:userId", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const toId = parseInt(String(req.params.userId), 10);
  if (isNaN(toId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { content, replyToId } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Mensagem obrigatória" }); return; }
  const parsedReplyTo = replyToId ? parseInt(String(replyToId), 10) : null;

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ fromUserId: myId, toUserId: toId, content: String(content).trim(), replyToId: parsedReplyTo })
    .returning();

  const [from] = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.id, myId));

  let replyTo = null;
  if (parsedReplyTo) {
    const [r] = await db.select({ id: directMessagesTable.id, content: directMessagesTable.content, fromName: usersTable.name })
      .from(directMessagesTable).leftJoin(usersTable, eq(directMessagesTable.fromUserId, usersTable.id))
      .where(eq(directMessagesTable.id, parsedReplyTo));
    replyTo = r ?? null;
  }

  const enriched = { ...msg, fromName: from?.name ?? null, fromAvatar: from?.avatarUrl ?? null, reactions: [], replyTo };
  broadcastDm(toId, myId, enriched);
  res.status(201).json(enriched);
});

// Delete DM
router.delete("/dm/:id", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  const [msg] = await db.select({ fromUserId: directMessagesTable.fromUserId, toUserId: directMessagesTable.toUserId })
    .from(directMessagesTable).where(eq(directMessagesTable.id, id));
  if (!msg) { res.status(404).json({ error: "Mensagem não encontrada" }); return; }
  if (msg.fromUserId !== myId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(directMessagesTable).where(eq(directMessagesTable.id, id));
  broadcastDmDeleted(msg.toUserId, myId, id);
  res.sendStatus(204);
});

// Toggle DM reaction
router.post("/dm/:id/reactions", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const messageId = parseInt(req.params.id, 10);
  const { emoji } = req.body ?? {};
  if (!emoji) { res.status(400).json({ error: "Emoji obrigatório" }); return; }

  const [msg] = await db.select({ fromUserId: directMessagesTable.fromUserId, toUserId: directMessagesTable.toUserId })
    .from(directMessagesTable).where(eq(directMessagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Mensagem não encontrada" }); return; }

  const existing = await db.select({ id: dmReactionsTable.id })
    .from(dmReactionsTable)
    .where(and(eq(dmReactionsTable.messageId, messageId), eq(dmReactionsTable.userId, myId), eq(dmReactionsTable.emoji, String(emoji))));

  if (existing.length) {
    await db.delete(dmReactionsTable).where(eq(dmReactionsTable.id, existing[0].id));
  } else {
    await db.insert(dmReactionsTable).values({ messageId, userId: myId, emoji: String(emoji) });
  }

  const reactions = await db.select({ emoji: dmReactionsTable.emoji, userId: dmReactionsTable.userId, userName: usersTable.name })
    .from(dmReactionsTable).leftJoin(usersTable, eq(dmReactionsTable.userId, usersTable.id))
    .where(eq(dmReactionsTable.messageId, messageId));

  const grouped = Object.values(reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { emoji: r.emoji, count: 0, mine: false, users: [] };
    acc[r.emoji].count++;
    acc[r.emoji].users.push(r.userName ?? "?");
    if (r.userId === myId) acc[r.emoji].mine = true;
    return acc;
  }, {} as Record<string, { emoji: string; count: number; mine: boolean; users: string[] }>));

  broadcastDmReaction(msg.toUserId, msg.fromUserId, messageId, grouped);
  res.json(grouped);
});

// Mark conversation as read
router.post("/dm/:userId/read", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const fromId = parseInt(String(req.params.userId), 10);
  if (isNaN(fromId)) { res.status(400).json({ error: "ID inválido" }); return; }

  await db
    .update(directMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(eq(directMessagesTable.toUserId, myId), eq(directMessagesTable.fromUserId, fromId),
        sql`${directMessagesTable.readAt} IS NULL`)
    );
  broadcastDmRead(fromId, myId);

  res.sendStatus(204);
});

export default router;

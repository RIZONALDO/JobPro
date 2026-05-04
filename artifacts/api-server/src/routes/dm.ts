import { Router } from "express";
import { db, directMessagesTable, usersTable } from "@workspace/db";
import { eq, and, or, desc, asc, lt, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastDm } from "../lib/broadcast.js";

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

// Get messages between me and another user
router.get("/dm/:userId", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const messages = await db
    .select({
      id: directMessagesTable.id,
      fromUserId: directMessagesTable.fromUserId,
      toUserId: directMessagesTable.toUserId,
      content: directMessagesTable.content,
      createdAt: directMessagesTable.createdAt,
      readAt: directMessagesTable.readAt,
      fromName: usersTable.name,
      fromAvatar: usersTable.avatarUrl,
    })
    .from(directMessagesTable)
    .leftJoin(usersTable, eq(directMessagesTable.fromUserId, usersTable.id))
    .where(
      or(
        and(eq(directMessagesTable.fromUserId, myId), eq(directMessagesTable.toUserId, otherId)),
        and(eq(directMessagesTable.fromUserId, otherId), eq(directMessagesTable.toUserId, myId)),
      )
    )
    .orderBy(asc(directMessagesTable.createdAt))
    .limit(100);

  // Mark as read
  await db
    .update(directMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(eq(directMessagesTable.toUserId, myId), eq(directMessagesTable.fromUserId, otherId),
        sql`${directMessagesTable.readAt} IS NULL`)
    );

  res.json(messages);
});

// Send DM
router.post("/dm/:userId", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const toId = parseInt(req.params.userId, 10);
  if (isNaN(toId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { content } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Mensagem obrigatória" }); return; }

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ fromUserId: myId, toUserId: toId, content: String(content).trim() })
    .returning();

  const [from] = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, myId));

  const enriched = { ...msg, fromName: from?.name ?? null, fromAvatar: from?.avatarUrl ?? null };
  broadcastDm(toId, myId, enriched);
  res.status(201).json(enriched);
});

// Mark conversation as read
router.post("/dm/:userId/read", requireAuth, async (req, res): Promise<void> => {
  const myId = req.session.userId!;
  const fromId = parseInt(req.params.userId, 10);
  if (isNaN(fromId)) { res.status(400).json({ error: "ID inválido" }); return; }

  await db
    .update(directMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(eq(directMessagesTable.toUserId, myId), eq(directMessagesTable.fromUserId, fromId),
        sql`${directMessagesTable.readAt} IS NULL`)
    );

  res.sendStatus(204);
});

export default router;

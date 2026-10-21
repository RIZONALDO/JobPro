import { Router } from "express";
import {
  db, tasksTable, taskEventsTable,
  feedItemsTable, feedReactionsTable, feedCommentsTable,
  chatMessagesTable, chatReactionsTable, userPresenceTable, usersTable,
} from "@workspace/db";
import { eq, desc, asc, and, gt, lt, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  broadcastFeedReaction, broadcastFeedComment, broadcastFeedCommentDeleted,
  broadcastChatMessage, broadcastChatDeleted, broadcastChatReaction, broadcastPresence,
} from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";
import { getIo } from "../lib/io.js";
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
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, login: usersTable.login })
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

/** Tipos que aparecem no mural. Eventos antigos (pausada, cancelada, devolvida…) ficam só no histórico do job. */
const VISIBLE = ["manual_post", "kudos", "task_completed"];
const KIND: Record<string, string[]> = { all: VISIBLE, post: ["manual_post"], kudos: ["kudos"], delivery: ["task_completed"] };
const PAGE = 30;

/** Completa os itens do mural: pessoa reconhecida, detalhes da entrega (job, cliente, editor, gestor, no prazo) e papel do autor. */
async function enrichMural(items: typeof feedItemsTable.$inferSelect[], me: number) {
  const base = await enrichFeedItems(items, me);
  const userIds = [...new Set(items.flatMap(i => [i.targetUserId, i.actorId]).filter((x): x is number => x != null))];
  const taskIds = [...new Set(items.filter(i => i.type === "task_completed" && i.entityId).map(i => i.entityId as number))];
  const tasks = taskIds.length ? await db.select({
    id: tasksTable.id, title: tasksTable.title, n: tasksTable.taskNumber, y: tasksTable.taskYear, client: tasksTable.client,
    editorId: tasksTable.assignedToId, coordId: tasksTable.createdById, dueDate: tasksTable.dueDate,
  }).from(tasksTable).where(inArray(tasksTable.id, taskIds)) : [];
  const firstReview = new Map<number, Date>();
  if (taskIds.length) {
    const evs = await db.select({ taskId: taskEventsTable.taskId, at: taskEventsTable.createdAt }).from(taskEventsTable)
      .where(and(inArray(taskEventsTable.taskId, taskIds), eq(taskEventsTable.toStatus, "review"))).orderBy(asc(taskEventsTable.createdAt));
    for (const e of evs) if (!firstReview.has(e.taskId)) firstReview.set(e.taskId, e.at);
  }
  const allUsers = [...new Set([...userIds, ...tasks.flatMap(t => [t.editorId, t.coordId]).filter((x): x is number => x != null)])];
  const people = allUsers.length ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, login: usersTable.login, role: usersTable.role, jobTitle: usersTable.jobTitle })
    .from(usersTable).where(inArray(usersTable.id, allUsers)) : [];
  const pm = new Map(people.map(u => [u.id, u]));
  const code = (n: number, y: number) => `${String(n).padStart(3, "0")}.${String(y).padStart(2, "0")}`;
  return base.map(it => {
    const t = it.type === "task_completed" ? tasks.find(x => x.id === it.entityId) : undefined;
    const fr = t ? firstReview.get(t.id) : undefined;
    return {
      ...it,
      actorRole: it.actorId ? pm.get(it.actorId)?.role ?? null : null,
      actorTitle: it.actorId ? pm.get(it.actorId)?.jobTitle ?? null : null,
      target: it.targetUserId ? pm.get(it.targetUserId) ?? null : null,
      delivery: t ? {
        taskId: t.id, code: code(t.n, t.y), title: t.title, client: t.client,
        editor: t.editorId ? pm.get(t.editorId) ?? null : null, coordinator: t.coordId ? pm.get(t.coordId) ?? null : null,
        onTime: fr && t.dueDate ? fr <= t.dueDate : null,
      } : null,
    };
  });
}

// GET /feed?kind=all|post|kudos|delivery&before=<id>  →  { pinned, items, hasMore }
router.get("/feed", requireAuth, async (req, res): Promise<void> => {
  const me = req.session.userId!;
  const types = KIND[String(req.query.kind ?? "all")] ?? VISIBLE;
  const before = Number(req.query.before) || 0;
  const conds = [inArray(feedItemsTable.type, types), isNull(feedItemsTable.pinnedAt)];
  if (before) conds.push(lt(feedItemsTable.id, before));
  const rows = await db.select().from(feedItemsTable).where(and(...conds)).orderBy(desc(feedItemsTable.createdAt), desc(feedItemsTable.id)).limit(PAGE + 1);
  const pinnedRows = before ? [] : await db.select().from(feedItemsTable)
    .where(and(isNotNull(feedItemsTable.pinnedAt), inArray(feedItemsTable.type, ["manual_post", "kudos"]))).orderBy(desc(feedItemsTable.pinnedAt));
  res.json({
    pinned: await enrichMural(pinnedRows, me),
    items: await enrichMural(rows.slice(0, PAGE), me),
    hasMore: rows.length > PAGE,
  });
});

// Resumo da semana para a lateral do mural: só números da equipe, sem ranking de pessoas.
router.get("/feed/summary", requireAuth, async (_req, res): Promise<void> => {
  const nowLocal = new Date(Date.now() - 3 * 3600_000);                 // Brasília (sem horário de verão)
  const dow = (nowLocal.getUTCDay() + 6) % 7;                           // 0 = segunda
  const monday = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() - dow) + 3 * 3600_000;
  const prevMonday = monday - 7 * 86_400_000;
  const evs = await db.select({ taskId: taskEventsTable.taskId, at: taskEventsTable.createdAt }).from(taskEventsTable)
    .where(and(eq(taskEventsTable.toStatus, "completed"), gt(taskEventsTable.createdAt, new Date(prevMonday))));
  const thisWeek = evs.filter(e => +e.at >= monday), lastWeek = evs.filter(e => +e.at < monday);
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const e of thisWeek) days[Math.min(6, Math.floor((+e.at - monday) / 86_400_000))]++;
  const ids = [...new Set(thisWeek.map(e => e.taskId))];
  let onTime: number | null = null;
  if (ids.length) {
    const ts = await db.select({ id: tasksTable.id, due: tasksTable.dueDate }).from(tasksTable).where(inArray(tasksTable.id, ids));
    const rv = await db.select({ taskId: taskEventsTable.taskId, at: taskEventsTable.createdAt }).from(taskEventsTable)
      .where(and(inArray(taskEventsTable.taskId, ids), eq(taskEventsTable.toStatus, "review"))).orderBy(asc(taskEventsTable.createdAt));
    const first = new Map<number, Date>(); for (const r of rv) if (!first.has(r.taskId)) first.set(r.taskId, r.at);
    const rated = ts.filter(t => t.due && first.has(t.id));
    if (rated.length) onTime = Math.round((rated.filter(t => first.get(t.id)! <= t.due!).length / rated.length) * 100);
  }
  res.json({ delivered: new Set(thisWeek.map(e => e.taskId)).size, deliveredLastWeek: new Set(lastWeek.map(e => e.taskId)).size, days, onTime, today: dow });
});

// POST /feed  { content, kind: "post" | "kudos", targetUserId?, mentions? }
router.post("/feed", requireAuth, async (req, res): Promise<void> => {
  const { content, mentions, kind, targetUserId } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "Escreva alguma coisa" }); return; }
  const userId = req.session.userId!;
  const isKudos = kind === "kudos";
  const target = isKudos ? Number(targetUserId) : null;
  if (isKudos && (!target || target === userId)) { res.status(400).json({ error: "Escolha quem você quer reconhecer" }); return; }
  const [actor] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  let targetName = "";
  if (target) {
    const [t] = await db.select({ name: usersTable.name, status: usersTable.status }).from(usersTable).where(eq(usersTable.id, target));
    if (!t || t.status !== "active") { res.status(400).json({ error: "Pessoa não encontrada" }); return; }
    targetName = t.name;
  }
  await createFeedItem({
    type: isKudos ? "kudos" : "manual_post",
    title: isKudos ? `${actor?.name ?? "Alguém"} reconheceu ${targetName}` : `${actor?.name ?? "Alguém"} publicou`,
    content: String(content).trim(),
    actorId: userId,
    targetUserId: target ?? undefined,
  });
  if (target) await notify(target, "feed_kudos", "Você foi reconhecido(a)", `${actor?.name ?? "Alguém"} reconheceu você no mural: “${String(content).trim().slice(0, 120)}”`);
  await notifyMentions((mentions ?? []).filter((m: number) => m !== target), userId, "no mural");
  res.status(201).json({ ok: true });
});

// Fixar / desafixar recado no topo do mural (gestão)
router.post("/feed/:id/pin", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!["admin", "supervisor", "coordinator"].includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Só a gestão fixa recados" }); return; }
  const [item] = await db.select().from(feedItemsTable).where(eq(feedItemsTable.id, id));
  if (!item || !["manual_post", "kudos"].includes(item.type)) { res.status(404).json({ error: "Recado não encontrado" }); return; }
  const pin = !item.pinnedAt;
  await db.update(feedItemsTable).set({ pinnedAt: pin ? new Date() : null, pinnedById: pin ? req.session.userId! : null }).where(eq(feedItemsTable.id, id));
  try { getIo().emit("feed:changed"); } catch { /* sem socket */ }
  res.json({ pinned: pin });
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
      userLogin: usersTable.login,
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
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, login: usersTable.login })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const enriched = { ...comment, userName: user?.name ?? null, userAvatar: user?.avatarUrl ?? null, userLogin: user?.login ?? null };
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

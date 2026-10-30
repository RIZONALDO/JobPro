import { Router, type Request, type Response } from "express";
import {
  db, tasksTable, usersTable, queueEventsTable, holidaysTable, taskRevisionsTable, taskEventsTable, taskEditorsTable, taskFollowersTable,
} from "@workspace/db";
import { and, eq, inArray, desc, gte, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator, requireSupervisor } from "../lib/auth.js";
import { notify, notifyFollowers } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";
import {
  type QTask, type State, type TaskRow, QUEUE_STATUSES, loadState, loadCalendar, queueOf, isLate, frontPos, orderAt, blockRisk,
  schedule, recalcDues, newDues, inQueue, changedQueues, stampHeads, userNames, logEvent, invalidateHolidays,
} from "../lib/queue.js";
import { DAY, dayOff, dayKey, toLm, fmtLm, fmtH, workBetween } from "../lib/workcal.js";

const router = Router();

const isSup = (role?: string) => role === "admin" || role === "supervisor";
const isCoord = (role?: string) => isSup(role) || role === "coordinator";
const code = (r: TaskRow) => `${String(r.taskNumber ?? 0).padStart(3, "0")}.${String(r.taskYear ?? 0).padStart(2, "0")}`;
const q = (r: { title: string }) => `“${r.title}”`;

async function getRow(id: number) {
  const [r] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  return r ?? null;
}
const idParam = (req: Request) => parseInt(String(req.params.id), 10);

/** Notifica todos os supervisores/admins ativos. */
export async function notifySupervisors(title: string, message: string, taskId?: number) {
  const sups = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(inArray(usersTable.role, ["admin", "supervisor"]), eq(usersTable.status, "active")));
  await Promise.all(sups.map(s => notify(s.id, "queue_escalated", title, message, { taskId })));
}

/** 1º job da fila de cada editor. */
function heads(ts: QTask[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const ed of new Set(ts.map(t => t.editorId).filter((x): x is number => x != null))) {
    const h = queueOf(ts, ed)[0];
    if (h) out.set(ed, h.id);
  }
  return out;
}

/**
 * Toda ação passa por aqui: depois dela os prazos da fila são recalculados (horas de trabalho na ordem nova);
 * se o próximo job de um editor mudar por ação de outra pessoa, ele é avisado. Também dispara o realtime.
 */
async function watchHeads<T>(actorId: number, fn: (s: State) => Promise<T>): Promise<T> {
  const s0 = await loadState();
  const h0 = heads(s0.tasks);
  const out = await fn(s0);
  // recalcula só as filas que mudaram com esta ação
  const s1 = await loadState();
  const changed = changedQueues(s0.tasks, s1.tasks);
  await stampHeads(s1);
  if (changed.length) await recalcDues(actorId, { editors: changed, before: s0.tasks });
  const h1 = heads(s1.tasks);
  const names = await userNames();
  for (const [ed, id] of h1) {
    if (h0.get(ed) === id || ed === actorId) continue;
    const a = s0.rows.find(r => r.id === h0.get(ed)), b = s1.rows.find(r => r.id === id)!;
    await notify(ed, "queue_next_changed", "Seu próximo job mudou",
      `${a ? `Era ${q(a)}, agora é ${q(b)}` : `Agora é ${q(b)}`} (${names.get(actorId)?.name ?? "coordenação"}).`, { taskId: id });
  }
  broadcastTaskChange();
  return out;
}

/* ═════════════════════════ QUADRO ═════════════════════════ */

router.get("/queue/board", requireAuth, async (req, res): Promise<void> => {
  const me = req.session.userId!, role = req.session.userRole!;
  const s = await loadState();

  const users = await db.select({
    id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status, avatarUrl: usersTable.avatarUrl,
  }).from(usersTable);
  // inativo só ganha fila se ainda tiver edição pendente (na fila ou em andamento)
  const assigned = new Set(s.rows.filter(r => QUEUE_STATUSES.includes(r.status)).map(r => r.assignedToId).filter(Boolean));
  const editors = users.filter(u => (u.role === "editor" && u.status === "active") || assigned.has(u.id))
    .filter(u => role !== "editor" || u.id === me);
  const cal = await loadCalendar(editors.map(u => u.id));
  const today = Math.floor(s.now / DAY);

  const ids = s.rows.map(r => r.id);
  const evs = ids.length ? await db.select().from(queueEventsTable)
    .where(and(inArray(queueEventsTable.taskId, ids), inArray(queueEventsTable.kind, ["blocked", "sent"])))
    .orderBy(desc(queueEventsTable.createdAt)) : [];
  const lastEv = (id: number, kind: string) => evs.find(e => e.taskId === id && e.kind === kind);

  const pos = new Map<number, number>();
  for (const u of editors) queueOf(s.tasks, u.id).forEach((t, i) => pos.set(t.id, i));

  const visible = role === "editor" ? s.rows.filter(r => r.assignedToId === me) : s.rows;
  const fol = ids.length ? await db.select({ taskId: taskFollowersTable.taskId, userId: taskFollowersTable.userId }).from(taskFollowersTable).where(inArray(taskFollowersTable.taskId, ids)) : [];
  const tasks = visible.map(r => {
    const t = s.tasks.find(x => x.id === r.id)!;
    const sent = lastEv(r.id, "sent"), blk = lastEv(r.id, "blocked");
    return {
      id: r.id, code: code(r), title: r.title, client: r.client, color: r.color, folderUrl: r.folderUrl, description: r.description,
      status: r.status, editorId: r.assignedToId, coordId: r.createdById, followerIds: fol.filter(f => f.taskId === r.id).map(f => f.userId),
      playing: t.playing, order: r.queueOrder, hold: r.queueHold, pos: pos.get(r.id) ?? null,
      promised: t.promised, late: isLate(t, s.now), revisionCount: r.revisionCount, est: t.est,
      sentAt: sent ? toLm(sent.createdAt) : null, blockReason: blk?.text ?? null,
      blocked: r.status === "paused" ? { since: blk ? toLm(blk.createdAt) : null, critical: blockRisk(t.promised, s.now).critical } : null,
    };
  });

  // esteira: posição de cada job em minutos de expediente a partir de agora (régua da equipe: noite, almoço,
  // domingo e feriado não ocupam espaço). O 1º vai pelo plano (`schedule` sem `live`): o card tem o tamanho das horas e
  // não estica com o relógio (o que passou vira etiqueta); os outros, pela conta ao vivo (ninguém começa antes de agora).
  // Ausência do editor vira trecho marcado.
  const W = (lm: number) => workBetween(cal, s.now, lm);
  let lastDay = today + 13;
  const track = (ed: number) => {
    const q = queueOf(s.tasks, ed), sch = schedule(cal, q, s.now, ed), head = schedule(cal, q.slice(0, 1), s.now, ed, false);
    const items = q.map((t, i) => {
      const p = (i === 0 ? head : sch).get(t.id)!;
      // o 1º: horas já corridas desde que virou o 1º e quanto passou das horas dele (vira etiqueta no card)
      const done = i === 0 && p.start < s.now ? workBetween(cal, p.start, s.now, ed) : 0;
      return {
        id: t.id, a: W(Math.max(p.start, s.now)), b: W(p.end), start: p.start, end: p.end, due: p.due,
        done, over: Math.max(0, done - t.est),
      };
    });
    const freeAt = items.length ? items[items.length - 1].end : s.now;
    lastDay = Math.max(lastDay, Math.floor(freeAt / DAY) + 1);
    const off: { a: number; b: number; label: string }[] = [];
    const offDays: { day: number; off: string }[] = [];
    for (let d = today; d <= Math.max(today + 13, Math.floor(freeAt / DAY) + 7); d++) {
      const why = dayOff(cal, d, ed);
      if (!why || dayOff(cal, d)) continue;
      offDays.push({ day: d, off: why });
      const a = W(Math.max(s.now, d * DAY)), b = W((d + 1) * DAY), prev = off[off.length - 1];
      if (b <= a) continue;
      if (prev && prev.b === a && prev.label === why) prev.b = b; else off.push({ a, b, label: why });
    }
    return { items, freeAt, free: W(freeAt), off, offDays };
  };
  const editorInfo = editors.map(u => {
    const qq = queueOf(s.tasks, u.id);
    const byCoord: Record<number, number> = {};
    for (const t of qq) if (t.coordId) byCoord[t.coordId] = (byCoord[t.coordId] ?? 0) + 1;
    return {
      id: u.id, name: u.name, avatarUrl: u.avatarUrl, inactive: u.status !== "active",
      count: qq.length, late: qq.filter(t => isLate(t, s.now)).length, byCoord,
      offToday: dayOff(cal, today, u.id) && !dayOff(cal, today) ? dayOff(cal, today, u.id) : null,
      track: track(u.id),
    };
  });

  const people = users.filter(u => u.status === "active" || s.rows.some(r => r.createdById === u.id || r.assignedToId === u.id))
    .map(u => ({ id: u.id, name: u.name, role: u.role, avatarUrl: u.avatarUrl }));

  // quem mexe na fila (30 dias): jobs movidos por quem moveu; alterações do cliente pelo gestor do job
  let stats: Record<number, { moves: number; changes: number }> | undefined;
  if (role !== "editor") {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db.select({ coordId: queueEventsTable.coordId, actorId: queueEventsTable.actorId, kind: queueEventsTable.kind, n: sql<number>`count(*)::int` })
      .from(queueEventsTable)
      .where(and(gte(queueEventsTable.createdAt, since), inArray(queueEventsTable.kind, ["moved", "client_change"])))
      .groupBy(queueEventsTable.coordId, queueEventsTable.actorId, queueEventsTable.kind);
    stats = {};
    for (const r of rows) {
      const who = r.kind === "moved" ? r.actorId : r.coordId;
      if (!who) continue;
      const o = stats[who] ??= { moves: 0, changes: 0 };
      if (r.kind === "moved") o.moves += r.n; else o.changes += r.n;
    }
  }

  // feriados, para a fila avisar quando a folga entre dois prazos pega dia sem expediente
  const fromKey = dayKey(today - 7);
  const holidays = Object.fromEntries([...cal.holidays].filter(([k]) => k >= fromKey));
  // régua da esteira: cada dia com o trecho de expediente que ocupa (dia sem expediente fica com largura 0)
  const axis = Array.from({ length: lastDay - today + 1 }, (_, i) => {
    const d = today + i;
    return { day: d, a: W(Math.max(s.now, d * DAY)), b: W((d + 1) * DAY), off: dayOff(cal, d) };
  });
  res.json({ now: s.now, me, role, editors: editorInfo, people, tasks, stats, holidays, axis });
});

/** Atividade recente da equipe (dashboard): eventos da fila com o job e quem fez. */
router.get("/queue/activity", requireCoordinator, async (req, res): Promise<void> => {
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const rows = await db.select({ e: queueEventsTable, actor: usersTable.name, avatar: usersTable.avatarUrl, title: tasksTable.title, client: tasksTable.client, n: tasksTable.taskNumber, y: tasksTable.taskYear })
    .from(queueEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, queueEventsTable.actorId))
    .leftJoin(tasksTable, eq(tasksTable.id, queueEventsTable.taskId))
    .where(sql`${queueEventsTable.kind} not in ('idle_alert', 'reorder', 'blocked_alert', 'due_passed', 'due_auto')`)
    .orderBy(desc(queueEventsTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({
    id: r.e.id, kind: r.e.kind, text: r.e.text, at: r.e.createdAt, taskId: r.e.taskId, coordId: r.e.coordId, editorId: r.e.editorId,
    actorId: r.e.actorId, actor: r.actor, avatarUrl: r.avatar, title: r.title, client: r.client,
    taskCode: r.n ? `${String(r.n).padStart(3, "0")}.${String(r.y ?? "").padStart(2, "0").slice(-2)}` : null,
  })));
});

/** Histórico da fila de um job: quem fez o quê e por quê. */
router.get("/queue/tasks/:id/events", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req);
  const rows = await db.select({ e: queueEventsTable, name: usersTable.name }).from(queueEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, queueEventsTable.actorId))
    .where(eq(queueEventsTable.taskId, id)).orderBy(desc(queueEventsTable.createdAt)).limit(100);
  res.json(rows.map(r => ({ id: r.e.id, kind: r.e.kind, text: r.e.text, actor: r.name, at: r.e.createdAt })));
});

/** Causas que aparecem no histórico da fila, da mais forte para a mais fraca (uma por mudança). */
const HISTORY_CAUSES = ["moved", "reassign", "est_changed", "client_change", "unblocked", "blocked", "sent", "cancelled", "archived", "client_ok", "play", "assign"];
/** "sex 23/10 11:36" (fmtLm) → minutos locais, no ano de `ref`. Para registros antigos sem `data`. */
function parseLm(txt: string | undefined, ref: number): number | null {
  const m = txt?.match(/(\d\d)\/(\d\d) (\d\d):(\d\d)/);
  if (!m) return null;
  const y = new Date((ref - (-180)) * 60000).getUTCFullYear();
  let lm = Date.UTC(y, +m[2] - 1, +m[1], +m[3], +m[4]) / 60000;
  if (lm - ref > 180 * DAY) lm = Date.UTC(y - 1, +m[2] - 1, +m[1], +m[3], +m[4]) / 60000;
  return lm;
}

/**
 * Histórico da fila de um editor: cada mudança (mover, passar, horas, alteração do cliente, entrega…) com os prazos
 * que ela mexeu, do mais novo para o mais antigo. Os eventos de uma mesma ação (mesma pessoa, < 1,5 s) viram uma
 * mudança só: a causa + os prazos recalculados (`due_auto`), um por job (do primeiro "antes" ao último "depois").
 */
router.get("/queue/editors/:id/history", requireAuth, async (req, res): Promise<void> => {
  const ed = idParam(req), me = req.session.userId!, role = req.session.userRole;
  if (role === "editor" && ed !== me) { res.status(403).json({ error: "Acesso negado" }); return; }
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({ e: queueEventsTable, actor: usersTable.name, title: tasksTable.title })
    .from(queueEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, queueEventsTable.actorId))
    .leftJoin(tasksTable, eq(tasksTable.id, queueEventsTable.taskId))
    .where(and(gte(queueEventsTable.createdAt, since), inArray(queueEventsTable.kind, ["due_auto", ...HISTORY_CAUSES]),
      sql`(${queueEventsTable.editorId} = ${ed} OR (${queueEventsTable.kind} = 'moved' AND ${queueEventsTable.data}->>'fromEditor' = ${String(ed)}))`))
    .orderBy(queueEventsTable.createdAt, queueEventsTable.id);

  type Ep = { at: number; actorId: number | null; actor: string | null; evs: typeof rows };
  const eps: Ep[] = [];
  for (const r of rows) {
    const at = toLm(r.e.createdAt), last = eps[eps.length - 1];
    if (last && last.actorId === r.e.actorId && +r.e.createdAt - +last.evs[last.evs.length - 1].e.createdAt < 1500) last.evs.push(r);
    else eps.push({ at, actorId: r.e.actorId, actor: r.actor, evs: [r] });
  }
  const out = eps.map(ep => {
    const causes = ep.evs.filter(x => x.e.kind !== "due_auto")
      .sort((a, b) => HISTORY_CAUSES.indexOf(a.e.kind) - HISTORY_CAUSES.indexOf(b.e.kind));
    const c = causes[0];
    const byTask = new Map<number | null, { taskId: number | null; title: string; from: number | null; to: number | null; fromText: string | null; toText: string | null }>();
    for (const x of ep.evs.filter(y => y.e.kind === "due_auto")) {
      const d = x.e.data as { from?: number | null; to?: number } | null;
      const [ft, tt] = (x.e.text ?? "").replace(/^.*?: /, "").split(" → ");
      const from = d?.from ?? parseLm(ft, ep.at), to = d?.to ?? parseLm(tt, ep.at);
      const prev = byTask.get(x.e.taskId);
      if (prev) { prev.to = to; prev.toText = tt ?? null; }
      else byTask.set(x.e.taskId, { taskId: x.e.taskId, title: x.title ?? "job", from, to, fromText: ft ?? null, toText: tt ?? null });
    }
    // o que voltou ao mesmo prazo dentro da mesma ação não mudou
    const changes = [...byTask.values()].filter(c => c.from == null || c.to == null || c.from !== c.to);
    const data = (c?.e.data ?? null) as Record<string, unknown> | null;
    return {
      at: ep.at, actorId: ep.actorId, actor: ep.actor,
      cause: c ? { kind: c.e.kind, text: c.e.text, taskId: c.e.taskId, title: c.title, data,
        // saiu desta fila para outra
        left: c.e.kind === "moved" && data?.fromEditor === ed && data?.toEditor !== ed } : null,
      changes,
    };
  }).filter(ep => ep.changes.length || (ep.cause && ["moved", "reassign", "est_changed", "client_change"].includes(ep.cause.kind)));
  out.reverse();
  const deltas = out.flatMap(e => e.changes).map(c => c.from != null && c.to != null ? c.to - c.from : 0);
  // a fila como está agora, na ordem
  const st = await loadState();
  const queue = queueOf(st.tasks, ed).map((t, i) => ({
    pos: i + 1, id: t.id, title: t.title, est: t.est, due: t.promised, playing: t.playing, late: isLate(t, st.now),
    client: st.rows.find(r => r.id === t.id)?.client ?? null,
  }));
  res.json({
    editorId: ed, days, now: st.now, queue, episodes: out.slice(0, 80),
    summary: { changes: out.length, later: deltas.filter(d => d >= 15).length, earlier: deltas.filter(d => d <= -15).length },
  });
});

/* ═════════════════════════ AÇÕES DO EDITOR ═════════════════════════ */

/** Confere se o job é do editor logado. */
async function editorTask(req: Request, res: Response): Promise<TaskRow | null> {
  const r = await getRow(idParam(req));
  if (!r) { res.status(404).json({ error: "Job não encontrado" }); return null; }
  if (r.assignedToId !== req.session.userId) { res.status(403).json({ error: "Este job não está na sua fila" }); return null; }
  return r;
}

/** "Começar": o job fica em edição agora (e não sai mais da frente da fila). Não conta horas. */
export async function playTask(s: State, r: TaskRow, actorId: number) {
  // um job por vez
  for (const o of s.rows.filter(x => x.assignedToId === r.assignedToId && x.playingSince && x.id !== r.id)) {
    await db.update(tasksTable).set({ playingSince: null }).where(eq(tasksTable.id, o.id));
  }
  await db.update(tasksTable).set({ playingSince: new Date(), status: "in_progress" }).where(eq(tasksTable.id, r.id));
  if (r.status !== "in_progress") {
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "in_progress", changedById: actorId });
  }
  await logEvent({ kind: "play", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId });
}

/** Tira o job de "em edição agora" (e muda o status, se pedido). */
export async function stopTask(r: TaskRow, status?: string) {
  const set: Partial<TaskRow> = {};
  if (r.playingSince) set.playingSince = null;
  if (status) set.status = status;
  if (Object.keys(set).length) await db.update(tasksTable).set(set).where(eq(tasksTable.id, r.id));
}

router.post("/queue/tasks/:id/play", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  if (!QUEUE_STATUSES.includes(r.status) || r.queueHold) { res.status(400).json({ error: "Este job não está na sua fila" }); return; }
  const me = req.session.userId!;
  const ok = await watchHeads(me, async s => {
    if (queueOf(s.tasks, me)[0]?.id !== r.id) { res.status(409).json({ error: "Só o 1º job da fila pode ser começado. A ordem é dos gestores." }); return false; }
    if (r.playingSince) return true;
    await playTask(s, r, me);
    if (r.createdById && r.createdById !== me) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
      await notify(r.createdById, "task_started", "Job em edição", `${u?.name ?? "Editor"} começou ${q(r)}.`, { taskId: r.id });
    }
    return true;
  });
  if (ok) res.json({ ok: true });
});

export async function sendToApproval(r: TaskRow, actorId: number) {
  await stopTask(r, "review");
  await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "review", changedById: actorId });
  await logEvent({ kind: "sent", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId });
  if (r.createdById) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId));
    await notify(r.createdById, "task_review", "Job enviado para aprovação",
      `${u?.name ?? "Editor"} terminou ${q(r)}. Envie para o cliente aprovar.`, { taskId: r.id });
  }
  await notifyFollowers(r.id, [actorId, r.createdById], "task_review", "Job pronto para o cliente", `${q(r)} foi terminado e está indo para aprovação do cliente.`);
}

router.post("/queue/tasks/:id/send", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  if (!QUEUE_STATUSES.includes(r.status)) { res.status(400).json({ error: "Este job não está em edição" }); return; }
  if (!r.playingSince && r.status === "pending") { res.status(409).json({ error: "Toque em “Começar” no job antes de enviar para aprovação." }); return; }
  await watchHeads(req.session.userId!, () => sendToApproval(r, req.session.userId!));
  res.json({ ok: true });
});

router.post("/queue/tasks/:id/block", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) { res.status(400).json({ error: "Diga por que o job está travado" }); return; }
  const me = req.session.userId!;
  await watchHeads(me, async () => {
    await stopTask(r, "paused");
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "paused", changedById: me });
    await logEvent({ kind: "blocked", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text: reason });
  });
  // o prazo continua correndo: se vence logo (ou já venceu), a supervisão também sabe
  const risk = blockRisk(r.dueDate ? toLm(r.dueDate) : null, toLm(new Date()));
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
  const who = u?.name ?? "Editor";
  if (r.createdById) await notify(r.createdById, "queue_blocked", risk.critical ? "Job travado: prazo em risco" : "Job travado",
    `${who} marcou ${q(r)} como travado: ${reason}.${risk.text} O job saiu da fila até você destravar.`, { taskId: r.id });
  await notifyFollowers(r.id, [me, r.createdById], "queue_blocked", "Job travado", `${q(r)} está travado: ${reason}.${risk.text}`);
  if (risk.critical) await notifySupervisors("Job travado: prazo em risco", `${who} travou ${q(r)}: ${reason}.${risk.text}`, r.id);
  res.json({ ok: true });
});

/* ═════════════════════════ AÇÕES DA COORDENAÇÃO ═════════════════════════ */

async function coordTask(req: Request, res: Response): Promise<TaskRow | null> {
  const r = await getRow(idParam(req));
  if (!r) { res.status(404).json({ error: "Job não encontrado" }); return null; }
  const role = req.session.userRole;
  if (!isCoord(role)) { res.status(403).json({ error: "Acesso negado" }); return null; }
  if (!isSup(role) && r.createdById !== req.session.userId) { res.status(403).json({ error: "Você só mexe nos seus jobs" }); return null; }
  return r;
}

/** Destravar: volta para a fila do editor logo depois do job em edição (o prazo é recalculado). */
router.post("/queue/tasks/:id/unblock", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (r.status !== "paused") { res.status(400).json({ error: "O job não está travado" }); return; }
  if (!r.assignedToId) { res.status(400).json({ error: "O job está sem editor: escolha um em “Passar para outro editor”" }); return; }
  const out = await placeTask(r.id, r.assignedToId, "fila", req.session.userId!, req.session.userRole!, { at: "front" });
  if (out.status === 200) await logEvent({ kind: "unblocked", taskId: r.id, actorId: req.session.userId, coordId: r.createdById, editorId: r.assignedToId, text: "Destravado" });
  res.status(out.status).json(out.body);
});

/**
 * Encerrar job travado que ficou para trás: "delivered" = já foi entregue por fora → concluído;
 * "dropped" = não vai mais ser feito → cancelado. Os relatórios não contam esses jobs como entrega nem atraso.
 */
router.post("/queue/tasks/:id/archive", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (r.status !== "paused") { res.status(400).json({ error: "Só job travado pode ser encerrado assim" }); return; }
  const outcome = req.body?.outcome === "dropped" ? "dropped" : "delivered";
  const note = String(req.body?.reason ?? "").trim();
  if (outcome === "dropped" && !note) { res.status(400).json({ error: "Diga por que o job não vai mais ser feito" }); return; }
  const me = req.session.userId!;
  const status = outcome === "delivered" ? "completed" : "cancelled";
  const text = (outcome === "delivered" ? "Encerrado: já tinha sido entregue" : "Encerrado: não vai mais ser feito") + (note ? ` (${note})` : "");
  await watchHeads(me, async () => {
    await db.update(tasksTable).set({ status, playingSince: null }).where(eq(tasksTable.id, r.id));
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: "paused", toStatus: status, changedById: me });
    await logEvent({ kind: "archived", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text });
    if (r.assignedToId) await notify(r.assignedToId, "task_archived", "Job encerrado", `${q(r)} saiu da sua fila. ${text}.`, { taskId: r.id });
  });
  res.json({ ok: true });
});

/** Cliente aprovou: job concluído. */
router.post("/queue/tasks/:id/client-ok", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (r.status !== "review") { res.status(400).json({ error: "O job não está com o cliente" }); return; }
  const me = req.session.userId!;
  await watchHeads(me, async () => {
    await db.update(tasksTable).set({ status: "completed", playingSince: null }).where(eq(tasksTable.id, r.id));
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: "review", toStatus: "completed", changedById: me });
    await logEvent({ kind: "client_ok", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text: "Cliente aprovou" });
    if (r.assignedToId) await notify(r.assignedToId, "task_approved", "Job aprovado", `Cliente aprovou ${q(r)}. Job concluído.`, { taskId: r.id });
    await notifyFollowers(r.id, [me, r.assignedToId], "task_approved", "Job aprovado", `Cliente aprovou ${q(r)}. Job concluído.`);
    await createFeedItem({ type: "task_completed", title: `Tarefa concluída: "${r.title}"`, actorId: me, entityId: r.id, entityType: "task" }).catch(() => {});
  });
  res.json({ ok: true });
});

/**
 * Cliente pediu alteração (ou o job aprovado foi reaberto): nova rodada com novas horas de trabalho.
 * Volta para a fila do mesmo editor logo depois do job em edição; o prazo sai das horas.
 */
export async function newRound(r: TaskRow, actorId: number, role: string, comment: string, reopened: boolean, est: number) {
  if (!(est > 0)) return { status: 400, body: { error: "Informe as horas de trabalho da alteração" } };
  const n = (r.revisionCount ?? 0) + 1;
  const status = reopened ? "reopened" : "in_revision";
  await db.update(tasksTable).set({ status, revisionCount: n, playingSince: null, estMinutes: est, queueHold: false }).where(eq(tasksTable.id, r.id));
  await db.insert(taskRevisionsTable).values({ taskId: r.id, revisionNumber: n, comment, createdById: actorId });
  await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: status, changedById: actorId });
  await logEvent({ kind: "client_change", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId,
    text: `${reopened ? "Reaberto" : "Alteração"} ${n}: ${comment} (${fmtH(est)} de trabalho)` });
  if (r.assignedToId) await notify(r.assignedToId, "task_revision", reopened ? "Job reaberto" : "Alteração solicitada",
    `${reopened ? "Cliente voltou em" : "Cliente pediu alteração em"} ${q(r)}: ${comment}.`, { taskId: r.id });
  await notifyFollowers(r.id, [actorId, r.assignedToId], "task_revision", reopened ? "Job reaberto" : "Alteração do cliente", `${q(r)}: ${comment}.`);
  if (!r.assignedToId) { broadcastTaskChange(); return { status: 200, body: { message: "Alteração registrada. O job está sem editor." } }; }
  return placeTask(r.id, r.assignedToId, "fila", actorId, role, { at: "front" });
}

router.post("/queue/tasks/:id/client-change", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  const comment = String(req.body?.comment ?? "").trim();
  if (!comment) { res.status(400).json({ error: "Descreva a alteração" }); return; }
  if (!["review", "completed"].includes(r.status)) { res.status(400).json({ error: "Só jobs entregues podem receber alteração" }); return; }
  const out = await newRound(r, req.session.userId!, req.session.userRole!, comment, r.status === "completed", Number(req.body?.estMinutes));
  res.status(out.status).json(out.body);
});

/* ═════════════════════════ JOB NOVO / PASSAR PARA OUTRO / MUDAR PRAZO ═════════════════════════ */

async function activeEditorIds(): Promise<number[]> {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, "editor"), eq(usersTable.status, "active")));
  return rows.map(r => r.id);
}

/** Horas de trabalho válidas (minutos), ou null. */
export const parseEst = (v: unknown): number | null => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n <= 200 * 60 ? n : null; };

/**
 * Prévia: com estas horas, o job entra no fim da fila de cada editor e fica pronto quando? Não grava nada.
 * `endsAt` = quando o editor termina o que já tem; `due` = prazo de entrega do job no fim da fila.
 */
router.post("/queue/plan", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = req.body?.taskId ? Number(req.body.taskId) : null;
  const s = await loadState();
  const existing = taskId ? s.tasks.find(t => t.id === taskId) : null;
  const est = parseEst(req.body?.estMinutes) ?? existing?.est ?? 0;
  const eds = await activeEditorIds();
  const cal = await loadCalendar(eds);
  const today = Math.floor(s.now / DAY);
  const plans = eds.map(ed => {
    const q0 = queueOf(s.tasks, ed).filter(t => t.id !== taskId);
    const ghost: QTask = { id: -1, editorId: ed, coordId: null, title: "", status: "pending", playing: false, order: orderAt(q0, q0.length), promised: null, hold: false, est, since: null, headSince: null };
    const plan = schedule(cal, [...q0, ghost], s.now, ed);
    const g = plan.get(-1)!;
    return {
      editorId: ed, offToday: dayOff(cal, today, ed) && !dayOff(cal, today) ? dayOff(cal, today, ed) : null,
      count: q0.length, late: q0.filter(t => isLate(t, s.now)).length,
      pos: q0.length + 1, endsAt: q0.length ? g.start : null, start: g.start, due: g.due,
    };
  });
  res.json({ now: s.now, est, plans });
});

/** Prévia do formulário: com estas horas, para onde vai o prazo do job (a mesma conta de quando salva). */
router.post("/queue/tasks/:id/due-preview", requireCoordinator, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const est = parseEst(req.body?.estMinutes);
  const s = await loadState();
  const t = s.tasks.find(x => x.id === id);
  if (!t || !inQueue(t) || !est) { res.json({ due: null }); return; }
  const ed = t.editorId as number;
  const cal = await loadCalendar([ed]);
  const after = s.tasks.map(x => x.id === id ? { ...x, est } : x);
  res.json({ due: newDues(cal, after, s.now, ed, s.tasks).get(id) ?? null, now: s.now });
});

/**
 * Coloca um job na fila de um editor: no fim (padrão) ou logo depois do job em edição (`at: "front"`).
 * Qualquer gestor coloca em qualquer lugar; o prazo é recalculado pelas horas (watchHeads → recalcDues).
 *  - mode "gestor" → sem editor: a supervisão decide.
 * Serve para job novo, rascunho publicado, destravar, alteração do cliente e "passar para outro editor".
 */
export async function placeTask(
  taskId: number, editorId: number | null, mode: string, me: number, role: string,
  opts: { at?: "end" | "front" | number } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const names = await userNames();
  return watchHeads(me, async s => {
    const r = s.rows.find(x => x.id === taskId) ?? await getRow(taskId);
    if (!r) return { status: 404, body: { error: "Job não encontrado" } };
    const actor = names.get(me)?.name ?? "Coordenação";
    const prevEditor = r.assignedToId;
    const started = !["pending", "rascunho"].includes(r.status);
    const status = ["paused", "review", "rascunho"].includes(r.status) ? (started && r.status !== "rascunho" ? "in_progress" : "pending") : r.status;

    if (mode === "gestor") {
      await db.update(tasksTable).set({ playingSince: null, assignedToId: null, queueHold: false, status: status === "in_progress" ? "pending" : status, dueDate: null }).where(eq(tasksTable.id, r.id));
      await logEvent({ kind: "assign", taskId: r.id, actorId: me, coordId: r.createdById, text: "Sem editor: enviado para a supervisão decidir" });
      await notifySupervisors("Job sem editor", `${actor} pediu à supervisão um editor para ${q(r)} (${fmtH(r.estMinutes ?? 0)} de trabalho).`, r.id);
      if (prevEditor) await notify(prevEditor, "task_reassigned", "Job saiu da sua fila", `${q(r)} saiu da sua fila (${actor}).`, { taskId: r.id });
      return { status: 200, body: { message: `${q(r)} foi para a supervisão decidir.` } };
    }
    if (!editorId) return { status: 400, body: { error: "Escolha o editor" } };
    if (!(r.estMinutes > 0)) return { status: 400, body: { error: "Informe as horas de trabalho do job" } };
    const edName = names.get(editorId)?.name ?? "o editor";
    const q0 = queueOf(s.tasks, editorId).filter(t => t.id !== r.id);
    const keepPlaying = prevEditor === editorId && !!r.playingSince;
    const min = q0[0]?.playing ? 1 : 0;
    const k = keepPlaying ? 0 : opts.at === "front" ? min : typeof opts.at === "number" ? Math.max(min, Math.min(q0.length, opts.at)) : q0.length;

    await db.update(tasksTable).set({
      playingSince: keepPlaying ? r.playingSince : null, assignedToId: editorId, status, queueOrder: orderAt(q0, k), queueHold: false,
    }).where(eq(tasksTable.id, r.id));
    if (prevEditor !== editorId) {
      await db.insert(taskEditorsTable).values({ taskId: r.id, userId: editorId, assignedById: me }).onConflictDoNothing();
      if (prevEditor) {
        await db.delete(taskEditorsTable).where(and(eq(taskEditorsTable.taskId, r.id), eq(taskEditorsTable.userId, prevEditor)));
        await notify(prevEditor, "task_reassigned", "Job passado para outro editor", `${q(r)} foi passado para ${edName} (${actor}).`, { taskId: r.id });
        await notifyFollowers(r.id, [me, r.createdById], "task_reassigned", "Job mudou de editor", `${q(r)} foi passado para ${edName} (${actor}).`);
        await logEvent({ kind: "reassign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Passado de ${names.get(prevEditor)?.name} para ${edName}` });
      }
    }
    const where = `${k + 1}º na fila de ${edName}`;
    await logEvent({ kind: "assign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: where.charAt(0).toUpperCase() + where.slice(1) });
    if (prevEditor !== editorId || r.status !== status) await notify(editorId, "task_assigned", "Job na sua fila", `${actor} colocou ${q(r)} em ${k + 1}º na sua fila (${fmtH(r.estMinutes)} de trabalho).`, { taskId: r.id });
    return { status: 200, body: { message: `${q(r)} entrou em ${where}. O prazo sai das horas de trabalho.` } };
  });
}

/**
 * Mover na fila (arrastar): qualquer gestor, qualquer job, sem pedido. `index` = posição na fila de destino (0 = 1º).
 * O job em edição não sai da frente; ninguém entra antes dele. Os prazos de todos são recalculados.
 */
router.post("/queue/tasks/:id/move", requireCoordinator, async (req, res): Promise<void> => {
  const r = await getRow(idParam(req));
  if (!r) { res.status(404).json({ error: "Job não encontrado" }); return; }
  if (!QUEUE_STATUSES.includes(r.status) || !r.assignedToId) { res.status(400).json({ error: "Este job não está numa fila" }); return; }
  const me = req.session.userId!, names = await userNames();
  const editorId = req.body?.editorId ? Number(req.body.editorId) : r.assignedToId;
  const index = Math.max(0, Math.round(Number(req.body?.index ?? 0)) || 0);
  if (editorId !== r.assignedToId) {
    const u = names.get(editorId);
    if (!u || u.status !== "active" || u.role !== "editor") { res.status(400).json({ error: "Editor inativo não recebe jobs" }); return; }
  }
  if (r.playingSince && editorId === r.assignedToId) { res.status(409).json({ error: `${q(r)} está em edição: não sai da frente.` }); return; }
  const s0 = await loadState();
  const from = queueOf(s0.tasks, r.assignedToId).findIndex(t => t.id === r.id);
  const out = await placeTask(r.id, editorId, "fila", me, req.session.userRole!, { at: index });
  if (out.status !== 200) { res.status(out.status).json(out.body); return; }
  const s1 = await loadState();
  const to = queueOf(s1.tasks, editorId).findIndex(t => t.id === r.id);
  const edName = names.get(editorId)?.name ?? "o editor", actor = names.get(me)?.name ?? "Coordenação";
  const moved = editorId !== r.assignedToId ? `Movido para ${to + 1}º na fila de ${edName}` : `Movido de ${from + 1}º para ${to + 1}º na fila de ${edName}`;
  if (editorId !== r.assignedToId || from !== to) {
    await logEvent({ kind: "moved", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `${moved} (${actor})`,
      data: { fromEditor: r.assignedToId, toEditor: editorId, fromPos: from + 1, toPos: to + 1 } });
    if (r.createdById && r.createdById !== me) await notify(r.createdById, "queue_reorder", "Seu job foi movido", `${actor}: ${q(r)} ${moved.charAt(0).toLowerCase() + moved.slice(1)}.`, { taskId: r.id });
  }
  const [fresh] = await db.select({ dueDate: tasksTable.dueDate }).from(tasksTable).where(eq(tasksTable.id, r.id));
  res.json({ message: `${moved}. Prazo de entrega: ${fresh?.dueDate ? fmtLm(toLm(fresh.dueDate)) : "—"}.` });
});

router.post("/queue/tasks/:id/place", requireCoordinator, async (req, res): Promise<void> => {
  const r = await getRow(idParam(req));
  if (!r) { res.status(404).json({ error: "Job não encontrado" }); return; }
  if (["completed", "cancelled"].includes(r.status)) { res.status(400).json({ error: "Job encerrado" }); return; }
  const editorId = req.body?.editorId ? Number(req.body.editorId) : null;
  if (editorId) {
    const [u] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, editorId));
    if (!u || u.status !== "active") { res.status(400).json({ error: "Editor inativo não recebe jobs" }); return; }
  }
  // horas novas junto (ex.: passar para outro editor e ajustar as horas)
  const est = parseEst(req.body?.estMinutes);
  if (est && est !== r.estMinutes) {
    await db.update(tasksTable).set({ estMinutes: est }).where(eq(tasksTable.id, r.id));
    await logEvent({ kind: "est_changed", taskId: r.id, actorId: req.session.userId, coordId: r.createdById, editorId, text: `Horas de trabalho: ${fmtH(r.estMinutes ?? 0)} → ${fmtH(est)}`, data: { from: r.estMinutes ?? 0, to: est } });
  }
  const at = req.body?.at === "front" ? "front" : "end";
  const out = await placeTask(r.id, editorId, String(req.body?.mode ?? "fila"), req.session.userId!, req.session.userRole!, { at });
  res.status(out.status).json(out.body);
});

/* ═════════════════════════ REDISTRIBUIR (inativação, ausência) ═════════════════════════ */

/**
 * Quando alguém sai (inativado) ou fica fora (férias, afastamento), a supervisão redistribui de uma vez:
 *  - jobs que a pessoa edita → outro editor (fim da fila, na frente ou supervisão decide);
 *  - jobs que a pessoa coordena → outro gestor (troca o responsável, a posição na fila não muda).
 * Sugestão: o editor com menos jobs na fila (contando os já redistribuídos), no fim da fila; o prazo é recalculado
 * pelas horas (placeTask). Em ausência, fica com a pessoa se o prazo é depois da volta.
 */
type HandoffMode = "end" | "prio" | "gestor" | "keep" | "swap";
interface HandoffChoice { taskId: number; editorId: number | null; mode: HandoffMode }
const HANDOFF_MODES: HandoffMode[] = ["end", "prio", "gestor", "keep", "swap"];
const OWNER_ROLES = ["admin", "supervisor", "coordinator"];

async function handoffData(userId: number) {
  const s = await loadState();
  const editing = s.rows.filter(r => r.assignedToId === userId);
  // rascunhos não entram na fila, mas também podem estar no nome da pessoa
  const drafts = await db.select().from(tasksTable).where(and(eq(tasksTable.status, "rascunho"), sql`(${tasksTable.assignedToId} = ${userId} OR ${tasksTable.createdById} = ${userId})`));
  const owned = [...s.rows, ...drafts].filter(r => r.createdById === userId);
  const editingDrafts = drafts.filter(r => r.assignedToId === userId);
  return { s, editing: [...editing, ...editingDrafts], owned };
}

/** Quando a pessoa volta da ausência atual (minutos locais do início do dia seguinte ao fim), ou null. */
async function returnsAt(userId: number, now: number): Promise<number | null> {
  const cal = await loadCalendar([userId]);
  const key = new Date(Math.floor(now / DAY) * 86_400_000).toISOString().slice(0, 10);
  const ab = (cal.absences.get(userId) ?? []).filter(a => a.end >= key).sort((a, b) => a.start.localeCompare(b.start))[0];
  return ab ? Math.floor(Date.parse(ab.end + "T00:00:00Z") / 60000) + DAY : null;
}

router.post("/queue/handoff/:userId/preview", requireSupervisor, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  const fixed = new Map<number, HandoffChoice>();
  for (const c of Array.isArray(req.body?.choices) ? req.body.choices : []) {
    if (HANDOFF_MODES.includes(c?.mode)) fixed.set(Number(c.taskId), { taskId: Number(c.taskId), editorId: c.editorId ? Number(c.editorId) : null, mode: c.mode });
  }
  const [person] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!person) { res.status(404).json({ error: "Pessoa não encontrada" }); return; }
  const absence = req.body?.context === "absence" || (req.body?.context !== "inactivate" && person.status === "active");

  const { s, editing, owned } = await handoffData(userId);
  const names = await userNames();
  const users = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl }).from(usersTable);
  const eds = users.filter(u => u.role === "editor" && u.status === "active" && u.id !== userId).map(u => u.id);
  const back = absence ? await returnsAt(userId, s.now) : null;
  const cal = await loadCalendar(eds);
  const today = Math.floor(s.now / DAY);

  // simula tudo junto: a fila da pessoa começa vazia e cada job vai para o destino escolhido/sugerido
  const count = new Map(eds.map(ed => [ed, queueOf(s.tasks, ed).length]));
  const lightest = () => [...eds].sort((a, b) => count.get(a)! - count.get(b)!)[0] ?? null;
  const isQ = (r: TaskRow) => QUEUE_STATUSES.includes(r.status);
  const ord = [...editing].sort((a, b) => Number(isQ(b)) - Number(isQ(a)) || (a.dueDate ? +a.dueDate : Infinity) - (b.dueDate ? +b.dueDate : Infinity));
  const items = ord.map(r => {
    const want = fixed.get(r.id);
    const promised = r.dueDate ? toLm(r.dueDate) : null;
    let choice: HandoffChoice;
    if (!isQ(r)) {
      // com o cliente, travado, rascunho: só troca quem é o editor
      choice = want && ["swap", "keep"].includes(want.mode) ? want
        : { taskId: r.id, editorId: absence || r.status === "rascunho" ? null : lightest(), mode: absence ? "keep" : "swap" };
    } else if (want) choice = want;
    else if (absence && (promised == null || (back != null && promised >= back))) choice = { taskId: r.id, editorId: userId, mode: "keep" };
    else {
      const ed = lightest();
      choice = ed ? { taskId: r.id, editorId: ed, mode: "end" } : { taskId: r.id, editorId: null, mode: "gestor" };
    }
    if (isQ(r) && (choice.mode === "end" || choice.mode === "prio") && choice.editorId) count.set(choice.editorId, (count.get(choice.editorId) ?? 0) + 1);
    return { r, choice: { ...choice, taskId: r.id }, inQueue: isQ(r), promised };
  });

  const view = (r: TaskRow) => ({
    id: r.id, code: code(r), title: r.title, client: r.client, status: r.status, coordId: r.createdById, editorId: r.assignedToId,
    playing: !!r.playingSince, promised: r.dueDate ? toLm(r.dueDate) : null,
  });
  res.json({
    now: s.now, returnsAt: back,
    person: { ...person, isEditor: editing.length > 0 || person.role === "editor" },
    editors: users.filter(u => eds.includes(u.id)).map(u => ({
      id: u.id, name: u.name, jobTitle: u.jobTitle, avatarUrl: u.avatarUrl,
      before: queueOf(s.tasks, u.id).length, after: count.get(u.id) ?? 0, offToday: dayOff(cal, today, u.id),
    })),
    owners: users.filter(u => OWNER_ROLES.includes(u.role) && u.status === "active" && u.id !== userId)
      .map(u => ({ id: u.id, name: u.name, role: u.role, jobTitle: u.jobTitle, avatarUrl: u.avatarUrl })),
    editing: items.map(({ r, choice, inQueue, promised }) => ({
      ...view(r), inQueue, mode: choice.mode, to: choice.editorId, late: isLate({ promised }, s.now),
    })),
    owned: owned.map(view),
    names: Object.fromEntries([...names].map(([id, n]) => [id, n.name])),
  });
});

/** Aplica a redistribuição. Cada job passa pelas mesmas regras de sempre (placeTask, aqui pela supervisão). */
router.post("/queue/handoff/:userId", requireSupervisor, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId), me = req.session.userId!, role = req.session.userRole!;
  const names = await userNames();
  const { editing, owned } = await handoffData(userId);
  const editIds = new Set(editing.map(r => r.id)), ownIds = new Set(owned.map(r => r.id));
  const active = (id: number, roles: string[]) => { const u = names.get(id); return !!u && u.status === "active" && roles.includes(u.role) && id !== userId; };
  const actor = names.get(me)?.name ?? "Supervisão", who = names.get(userId)?.name ?? "—";
  const out = { owners: 0, moved: 0, swapped: 0, gestor: 0, requests: 0, kept: 0, errors: [] as string[] };

  // 1) responsável: antes de mexer nos editores, para os avisos já irem ao gestor novo
  for (const o of Array.isArray(req.body?.owned) ? req.body.owned : []) {
    const taskId = Number(o?.taskId), coordId = Number(o?.coordId);
    if (!ownIds.has(taskId) || !coordId) continue;
    if (!active(coordId, OWNER_ROLES)) { out.errors.push(`Gestor inválido para o job ${taskId}`); continue; }
    const r = owned.find(x => x.id === taskId)!;
    await db.update(tasksTable).set({ createdById: coordId }).where(eq(tasksTable.id, taskId));
    await db.delete(taskFollowersTable).where(and(eq(taskFollowersTable.taskId, taskId), eq(taskFollowersTable.userId, coordId)));
    await logEvent({ kind: "owner", taskId, actorId: me, coordId, editorId: r.assignedToId, text: `Responsável passou de ${who} para ${names.get(coordId)?.name} (${actor})` });
    await notify(coordId, "task_reassigned", "Job passou para você", `${actor} passou ${q(r)} para você. Antes era de ${who}.`, { taskId });
    out.owners++;
  }

  // 2) editor
  for (const c of Array.isArray(req.body?.editing) ? req.body.editing : []) {
    const taskId = Number(c?.taskId), mode = String(c?.mode) as HandoffMode, editorId = c?.editorId ? Number(c.editorId) : null;
    if (!editIds.has(taskId) || !HANDOFF_MODES.includes(mode) || mode === "keep") { if (mode === "keep") out.kept++; continue; }
    if (editorId && !active(editorId, ["editor"])) { out.errors.push(`Editor inválido para o job ${taskId}`); continue; }
    const r = await getRow(taskId);
    if (!r || r.assignedToId !== userId) continue;

    if (!QUEUE_STATUSES.includes(r.status)) {
      // com o cliente / travado / rascunho: só troca o editor; volta para a fila do novo quando reabrir
      await watchHeads(me, async () => {
        await db.update(tasksTable).set({ playingSince: null, assignedToId: editorId }).where(eq(tasksTable.id, r.id));
        await db.delete(taskEditorsTable).where(and(eq(taskEditorsTable.taskId, r.id), eq(taskEditorsTable.userId, userId)));
        if (editorId) await db.insert(taskEditorsTable).values({ taskId: r.id, userId: editorId, assignedById: me }).onConflictDoNothing();
        await logEvent({ kind: "reassign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Editor passou de ${who} para ${editorId ? names.get(editorId)?.name : "ninguém"} (${actor})` });
        if (editorId) await notify(editorId, "task_assigned", "Job passou para você", `${actor} passou ${q(r)} para você. Antes era de ${who}.`, { taskId: r.id });
      });
      out.swapped++;
      continue;
    }
    const resp = await placeTask(r.id, mode === "gestor" ? null : editorId, mode, me, role, { at: mode === "prio" ? "front" : "end" });
    if (resp.status !== 200) { out.errors.push(String(resp.body.error ?? `Falha no job ${taskId}`)); continue; }
    if (mode === "gestor") out.gestor++; else if (resp.body.pending) out.requests++; else out.moved++;
  }
  res.json(out);
});

/* ═════════════════════════ FERIADOS ═════════════════════════ */

router.get("/queue/holidays", requireAuth, async (_req, res): Promise<void> => {
  res.json(await db.select().from(holidaysTable).orderBy(holidaysTable.day));
});
router.post("/queue/holidays", requireSupervisor, async (req, res): Promise<void> => {
  const day = String(req.body?.day ?? ""), name = String(req.body?.name ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) { res.status(400).json({ error: "Informe a data e o nome" }); return; }
  const s0 = await loadState(), c0 = await loadCalendar();
  await db.insert(holidaysTable).values({ day, name }).onConflictDoUpdate({ target: holidaysTable.day, set: { name } });
  invalidateHolidays(); await recalcDues(req.session.userId, { before: s0.tasks, calBefore: c0 }); broadcastTaskChange();
  res.json({ ok: true });
});
router.delete("/queue/holidays/:day", requireSupervisor, async (req, res): Promise<void> => {
  const s0 = await loadState(), c0 = await loadCalendar();
  await db.delete(holidaysTable).where(eq(holidaysTable.day, String(req.params.day)));
  invalidateHolidays(); await recalcDues(req.session.userId, { before: s0.tasks, calBefore: c0 }); broadcastTaskChange();
  res.json({ ok: true });
});

export default router;

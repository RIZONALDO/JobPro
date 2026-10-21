import { Router, type Request, type Response } from "express";
import {
  db, tasksTable, usersTable, queueRequestsTable, queueEventsTable, appSettingsTable, holidaysTable, taskRevisionsTable, taskEventsTable, taskEditorsTable, taskFollowersTable,
} from "@workspace/db";
import { and, eq, inArray, desc, gte, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator, requireSupervisor } from "../lib/auth.js";
import { notify, notifyFollowers } from "../lib/notify.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";
import {
  type QTask, type State, type TaskRow, type Plan, QUEUE_STATUSES, loadState, schedule, heads, evaluate, queueOf, queueMinutes, rem, orderAt,
  orderAfterHead, moveFirstMut, planFor, unblockForecast, blockRisk, getLimit, accrue, userNames, changeText, logEvent, invalidateHolidays, toQ,
} from "../lib/queue.js";
import { DAY, WEEK_MINUTES, consume, workBetween, periods, dayOff, dayKey, toLm, fromLm, fmtLm, fmtH } from "../lib/workcal.js";

const router = Router();

const isSup = (role?: string) => role === "admin" || role === "supervisor";
const isCoord = (role?: string) => isSup(role) || role === "coordinator";
const code = (r: TaskRow) => `${String(r.taskNumber ?? 0).padStart(3, "0")}.${String(r.taskYear ?? 0).padStart(2, "0")}`;
const q = (r: TaskRow) => `“${r.title}”`;

async function getRow(id: number) {
  const [r] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  return r ?? null;
}
const idParam = (req: Request) => parseInt(String(req.params.id), 10);

/** Notifica todos os supervisores/admins ativos. */
async function notifySupervisors(title: string, message: string, taskId?: number) {
  const sups = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(inArray(usersTable.role, ["admin", "supervisor"]), eq(usersTable.status, "active")));
  await Promise.all(sups.map(s => notify(s.id, "queue_escalated", title, message, { taskId })));
}

/**
 * Toda ação passa por aqui: se o próximo job de um editor mudar por ação de outra pessoa, ele é avisado.
 * Também dispara o realtime para todas as telas.
 */
async function watchHeads<T>(actorId: number, fn: (s: State) => Promise<T>): Promise<T> {
  const s0 = await loadState();
  const h0 = heads(s0.cal, s0.tasks, s0.now);
  const out = await fn(s0);
  const s1 = await loadState();
  const h1 = heads(s1.cal, s1.tasks, s1.now);
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

/** Minutos de expediente hoje sem job iniciado, havendo job na fila (só para o lembrete; não aparece como contador). */
function idleMinutes(s: State, ed: number, idleSince: Date | null): number {
  const today = Math.floor(s.now / DAY);
  const ps = periods(s.cal, today, ed);
  if (!ps.length) return 0;
  const dayStart = today * DAY + ps[0][0];
  const from = Math.max(dayStart, idleSince ? toLm(idleSince) : -Infinity);
  return workBetween(s.cal, from, s.now, ed);
}

/** Job travado no quadro: desde quando, quanto expediente já ficou parado e o que acontece se destravar agora. */
function blockedInfo(s: State, r: TaskRow, at: Date | null) {
  const since = at ? toLm(at) : null;
  const ifNow = unblockForecast(s.cal, s.tasks, s.now, r.id);
  return {
    since, stopped: since != null ? workBetween(s.cal, since, s.now, r.assignedToId) : null,
    ifNow, critical: blockRisk(r.dueDate ? toLm(r.dueDate) : null, s.now, ifNow).critical,
  };
}

/* ═════════════════════════ QUADRO ═════════════════════════ */

router.get("/queue/board", requireAuth, async (req, res): Promise<void> => {
  const me = req.session.userId!, role = req.session.userRole!;
  const s = await loadState();
  const sch = schedule(s.cal, s.tasks, s.now);
  const limit = await getLimit();

  const users = await db.select({
    id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status,
    avatarUrl: usersTable.avatarUrl, idleSince: usersTable.idleSince,
  }).from(usersTable);
  // inativo só ganha fila se ainda tiver edição pendente (na fila ou em andamento); travado ou com o cliente
  // continua visível no job e em "Precisa de você", sem abrir uma fila para quem saiu
  const assigned = new Set(s.rows.filter(r => QUEUE_STATUSES.includes(r.status)).map(r => r.assignedToId).filter(Boolean));
  const editors = users.filter(u => (u.role === "editor" && u.status === "active") || assigned.has(u.id))
    .filter(u => role !== "editor" || u.id === me);

  const ids = s.rows.map(r => r.id);
  const evs = ids.length ? await db.select().from(queueEventsTable)
    .where(and(inArray(queueEventsTable.taskId, ids), inArray(queueEventsTable.kind, ["blocked", "sent"])))
    .orderBy(desc(queueEventsTable.createdAt)) : [];
  const lastEv = (id: number, kind: string) => evs.find(e => e.taskId === id && e.kind === kind);

  const visible = role === "editor" ? s.rows.filter(r => r.assignedToId === me) : s.rows;
  const fol = ids.length ? await db.select({ taskId: taskFollowersTable.taskId, userId: taskFollowersTable.userId }).from(taskFollowersTable).where(inArray(taskFollowersTable.taskId, ids)) : [];
  const tasks = visible.map(r => {
    const t = s.tasks.find(x => x.id === r.id)!, sl = sch.get(r.id);
    const sent = lastEv(r.id, "sent"), blk = lastEv(r.id, "blocked");
    return {
      id: r.id, code: code(r), title: r.title, client: r.client, color: r.color, folderUrl: r.folderUrl, description: r.description,
      status: r.status, editorId: r.assignedToId, coordId: r.createdById, followerIds: fol.filter(f => f.taskId === r.id).map(f => f.userId),
      est: r.estMinutes, worked: t.worked, playing: t.playing, order: r.queueOrder, hold: r.queueHold,
      notBefore: t.notBefore, lockReason: r.lockReason, promised: t.promised,
      promisedOriginal: r.dueDateOriginal ? toLm(r.dueDateOriginal) : null,
      estConfirmed: r.estConfirmed, estCoord: r.estCoordMinutes, estEditor: r.estEditorMinutes,
      estDisputeOpen: r.estDisputeOpen, estOwnerId: r.estOwnerId, waitingEst: !!r.estExpiredAt && QUEUE_STATUSES.includes(r.status),
      revisionCount: r.revisionCount,
      sentAt: sent ? toLm(sent.createdAt) : null, blockReason: blk?.text ?? null,
      slot: sl ? { ...sl, lateBy: Number.isFinite(sl.lateBy) ? sl.lateBy : null } : null,
      blocked: r.status === "paused" ? blockedInfo(s, r, blk?.createdAt ?? null) : null,
    };
  });

  const reqRows = await db.select().from(queueRequestsTable).where(eq(queueRequestsTable.status, "pendente"));
  const requests = reqRows
    .filter(r => role !== "editor" || r.editorId === me)
    .map(r => ({ ...r, createdAt: toLm(r.createdAt), newOrder: undefined }));

  // calendário para a régua: 14 dias a partir de hoje
  const today = Math.floor(s.now / DAY);
  const days = Array.from({ length: 14 }, (_, i) => today + i).map(d => ({
    day: d, key: dayKey(d), periods: periods(s.cal, d), off: dayOff(s.cal, d),
  }));

  const editorInfo = editors.map(u => {
    const qq = queueOf(s.tasks, u.id);
    const byCoord: Record<number, number> = {};
    for (const t of qq) if (t.coordId) byCoord[t.coordId] = (byCoord[t.coordId] ?? 0) + rem(t);
    const ends = qq.map(t => sch.get(t.id)!.end);
    const offDays = days.map(d => ({ day: d.day, off: dayOff(s.cal, d.day, u.id) })).filter(d => d.off && !days.find(x => x.day === d.day)!.off);
    const playing = qq.some(t => t.playing);
    return {
      id: u.id, name: u.name, avatarUrl: u.avatarUrl, inactive: u.status !== "active",
      queueMinutes: queueMinutes(s.tasks, u.id), byCoord,
      freeFrom: ends.length ? Math.max(...ends) : consume(s.cal, s.now, 0, u.id).start,
      idleMinutes: !playing && qq.length ? idleMinutes(s, u.id, u.idleSince) : 0,
      offToday: dayOff(s.cal, today, u.id), offDays,
      todayCap: periods(s.cal, today, u.id).reduce((a, [x, y]) => a + y - x, 0),
      todayDone: workBetween(s.cal, today * DAY, s.now, u.id),
    };
  });

  const people = users.filter(u => u.status === "active" || s.rows.some(r => r.createdById === u.id || r.assignedToId === u.id))
    .map(u => ({ id: u.id, name: u.name, role: u.role, avatarUrl: u.avatarUrl }));

  let stats: Record<number, { furou: number; contest: number; reneg: number; changes: number }> | undefined;
  if (role !== "editor") {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db.select({ coordId: queueEventsTable.coordId, kind: queueEventsTable.kind, n: sql<number>`count(*)::int` })
      .from(queueEventsTable)
      .where(and(gte(queueEventsTable.createdAt, since), inArray(queueEventsTable.kind, ["furou", "est_contest", "reneg", "client_change"])))
      .groupBy(queueEventsTable.coordId, queueEventsTable.kind);
    stats = {};
    for (const r of rows) {
      if (!r.coordId) continue;
      const o = stats[r.coordId] ??= { furou: 0, contest: 0, reneg: 0, changes: 0 };
      if (r.kind === "furou") o.furou = r.n; else if (r.kind === "est_contest") o.contest = r.n;
      else if (r.kind === "reneg") o.reneg = r.n; else o.changes = r.n;
    }
  }

  res.json({ now: s.now, limit, weekMinutes: WEEK_MINUTES, me, role, editors: editorInfo, people, tasks, requests, days, stats });
});

/** Histórico da fila de um job: quem fez o quê e por quê. */
/** Atividade recente da equipe (dashboard): eventos da fila com o job e quem fez. */
router.get("/queue/activity", requireCoordinator, async (req, res): Promise<void> => {
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const rows = await db.select({ e: queueEventsTable, actor: usersTable.name, avatar: usersTable.avatarUrl, title: tasksTable.title, client: tasksTable.client, n: tasksTable.taskNumber, y: tasksTable.taskYear })
    .from(queueEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, queueEventsTable.actorId))
    .leftJoin(tasksTable, eq(tasksTable.id, queueEventsTable.taskId))
    .where(sql`${queueEventsTable.kind} not in ('idle_alert', 'reorder', 'blocked_alert')`)
    .orderBy(desc(queueEventsTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({
    id: r.e.id, kind: r.e.kind, text: r.e.text, at: r.e.createdAt, taskId: r.e.taskId, coordId: r.e.coordId, editorId: r.e.editorId,
    actorId: r.e.actorId, actor: r.actor, avatarUrl: r.avatar, title: r.title, client: r.client,
    taskCode: r.n ? `${String(r.n).padStart(3, "0")}.${String(r.y ?? "").padStart(2, "0").slice(-2)}` : null,
  })));
});

router.get("/queue/tasks/:id/events", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req);
  const rows = await db.select({ e: queueEventsTable, name: usersTable.name }).from(queueEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, queueEventsTable.actorId))
    .where(eq(queueEventsTable.taskId, id)).orderBy(desc(queueEventsTable.createdAt)).limit(100);
  res.json(rows.map(r => ({ id: r.e.id, kind: r.e.kind, text: r.e.text, actor: r.name, at: r.e.createdAt })));
});

/* ═════════════════════════ AÇÕES DO EDITOR ═════════════════════════ */

/** Confere se o job é do editor logado e está na fila. */
async function editorTask(req: Request, res: Response): Promise<TaskRow | null> {
  const r = await getRow(idParam(req));
  if (!r) { res.status(404).json({ error: "Job não encontrado" }); return null; }
  if (r.assignedToId !== req.session.userId) { res.status(403).json({ error: "Este job não está na sua fila" }); return null; }
  return r;
}

export async function playTask(s: State, r: TaskRow, actorId: number) {
  // um job por vez: pausa qualquer outro em execução do mesmo editor
  for (const o of s.rows.filter(x => x.assignedToId === r.assignedToId && x.playingSince && x.id !== r.id)) {
    await db.update(tasksTable).set(accrue(s.cal, o, s.now)).where(eq(tasksTable.id, o.id));
  }
  await db.update(tasksTable).set({ playingSince: new Date(), status: "in_progress" }).where(eq(tasksTable.id, r.id));
  await db.update(usersTable).set({ idleSince: null, idleAlertedAt: null }).where(eq(usersTable.id, r.assignedToId!));
  if (r.status !== "in_progress") {
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "in_progress", changedById: actorId });
  }
  await logEvent({ kind: "play", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId });
}

export async function stopTask(s: State, r: TaskRow, status?: string) {
  const set: Partial<TaskRow> = { ...accrue(s.cal, r, s.now) };
  if (status) set.status = status;
  // job parado (sem ▶) e sem mudança de status: não há o que gravar
  if (Object.keys(set).length) await db.update(tasksTable).set(set).where(eq(tasksTable.id, r.id));
  if (r.assignedToId) await db.update(usersTable).set({ idleSince: new Date() }).where(eq(usersTable.id, r.assignedToId));
}

router.post("/queue/tasks/:id/play", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  if (!QUEUE_STATUSES.includes(r.status) || r.queueHold) { res.status(400).json({ error: "Este job não está na sua fila" }); return; }
  const me = req.session.userId!;
  const ok = await watchHeads(me, async s => {
    const sch = schedule(s.cal, s.tasks, s.now);
    const sl = sch.get(r.id);
    if (!sl || sl.pos !== 0) { res.status(409).json({ error: "Só o 1º job da fila pode ser começado. Para fazer outro antes, peça a troca." }); return false; }
    if (r.startDate && toLm(r.startDate) > s.now) { res.status(409).json({ error: `Este job só pode começar ${fmtLm(toLm(r.startDate))}${r.lockReason ? `: ${r.lockReason}` : ""}.` }); return false; }
    await playTask(s, r, me);
    if (r.createdById && r.createdById !== me) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
      await notify(r.createdById, "task_started", "Job em edição", `${u?.name ?? "Editor"} começou ${q(r)}.`, { taskId: r.id });
    }
    return true;
  });
  if (ok) res.json({ ok: true });
});

router.post("/queue/tasks/:id/pause", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  await watchHeads(req.session.userId!, async s => {
    await stopTask(s, r);
    await logEvent({ kind: "pause", taskId: r.id, actorId: req.session.userId, coordId: r.createdById, editorId: r.assignedToId });
  });
  res.json({ ok: true });
});

export async function sendToApproval(s: State, r: TaskRow, actorId: number) {
  await stopTask(s, r, "review");
  await db.update(tasksTable).set({ estExpiredAt: null }).where(eq(tasksTable.id, r.id));
  await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "review", changedById: actorId });
  const worked = s.tasks.find(t => t.id === r.id)?.worked ?? r.workedMinutes;
  await logEvent({ kind: "sent", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId, text: `${fmtH(worked)} de ${fmtH(r.estMinutes)} estimadas` });
  if (r.createdById) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId));
    await notify(r.createdById, "task_review", "Job enviado para aprovação",
      `${u?.name ?? "Editor"} terminou ${q(r)} (${fmtH(worked)} de ${fmtH(r.estMinutes)} estimadas). Envie para o cliente aprovar.`, { taskId: r.id });
  }
  await notifyFollowers(r.id, [actorId, r.createdById], "task_review", "Job pronto para o cliente", `${q(r)} foi terminado e está indo para aprovação do cliente.`);
}

router.post("/queue/tasks/:id/send", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  if (!QUEUE_STATUSES.includes(r.status)) { res.status(400).json({ error: "Este job não está em edição" }); return; }
  if (!r.playingSince && r.workedMinutes <= 0) { res.status(409).json({ error: "Toque em “Começar” no job antes de enviar para aprovação." }); return; }
  await watchHeads(req.session.userId!, s => sendToApproval(s, r, req.session.userId!));
  res.json({ ok: true });
});

router.post("/queue/tasks/:id/block", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) { res.status(400).json({ error: "Diga por que o job está travado" }); return; }
  const me = req.session.userId!;
  await watchHeads(me, async s => {
    await stopTask(s, r, "paused");
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: "paused", changedById: me });
    await logEvent({ kind: "blocked", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text: reason });
  });
  // job travado com prazo correndo: o aviso já diz quanto de folga sobra; se é crítico, a supervisão também sabe
  const s = await loadState();
  const risk = blockRisk(r.dueDate ? toLm(r.dueDate) : null, s.now, unblockForecast(s.cal, s.tasks, s.now, r.id));
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
  const who = u?.name ?? "Editor";
  if (r.createdById) await notify(r.createdById, "queue_blocked", risk.critical ? "Job travado: prazo em risco" : "Job travado",
    `${who} marcou ${q(r)} como travado: ${reason}.${risk.text} O job saiu da fila até você destravar.`, { taskId: r.id });
  await notifyFollowers(r.id, [me, r.createdById], "queue_blocked", "Job travado", `${q(r)} está travado: ${reason}.${risk.text}`);
  if (risk.critical) await notifySupervisors("Job travado: prazo em risco", `${who} travou ${q(r)}: ${reason}.${risk.text}`, r.id);
  res.json({ ok: true });
});

router.post("/queue/tasks/:id/inform", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  const minutes = Math.round(Number(req.body?.minutes));
  if (!(minutes > 0)) { res.status(400).json({ error: "Informe quanto falta" }); return; }
  const me = req.session.userId!;
  await watchHeads(me, async s => {
    const worked = s.tasks.find(t => t.id === r.id)!.worked;
    const before = schedule(s.cal, s.tasks, s.now);
    await db.update(tasksTable).set({ estMinutes: worked + minutes, estExpiredAt: null }).where(eq(tasksTable.id, r.id));
    await logEvent({ kind: "inform", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId,
      text: `Pediu mais tempo: faltam ${fmtH(minutes)} (total ${fmtH(worked + minutes)}, era ${fmtH(r.estMinutes)})` });
    // nova previsão com as horas novas
    const s2 = await loadState();
    const after = schedule(s2.cal, s2.tasks, s2.now);
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
    const name = u?.name ?? "Editor";
    const end = after.get(r.id)?.end;
    const due = r.dueDate ? toLm(r.dueDate) : null;
    const late = end != null && due != null && end > due;
    // jobs seguintes do mesmo editor que passam a atrasar por causa dessas horas, agrupados por gestor
    const hit = new Map<number, QTask[]>();
    for (const t of s2.tasks) {
      if (t.id === r.id || t.editorId !== r.assignedToId || !t.coordId) continue;
      if (after.get(t.id)?.late && !before.get(t.id)?.late) hit.set(t.coordId, [...(hit.get(t.coordId) ?? []), t]);
    }
    const list = (ts: QTask[]) => ts.map(t => `“${t.title}” (fica pronto ${fmtLm(after.get(t.id)!.end)}, prazo ${fmtLm(t.promised!)})`).join("; ");
    // dono do job: se passa do prazo, é ele quem decide
    if (r.createdById) {
      const mine = hit.get(r.createdById); hit.delete(r.createdById);
      await notify(r.createdById, "queue_inform", late || mine ? "Pediu mais tempo: vai passar do prazo" : "Pediu mais tempo",
        `${name} precisa de mais ${fmtH(minutes)} em ${q(r)} (total ${fmtH(worked + minutes)}).` +
        (end != null ? ` Fica pronto ${fmtLm(end)}` : "") +
        (late ? `, depois do prazo (${fmtLm(due!)}).` : end != null ? ", dentro do prazo." : "") +
        (mine ? ` Também passa a atrasar seu${mine.length > 1 ? "s" : ""} job${mine.length > 1 ? "s" : ""} ${list(mine)}.` : "") +
        (late || mine ? " Decida: outro editor ou novo prazo com o cliente." : ""), { taskId: r.id });
    }
    // outros gestores afetados: o job deles atrasa sem terem mexido em nada
    for (const [coordId, ts] of hit) {
      if (coordId === me) continue;
      await notify(coordId, "queue_inform", ts.length > 1 ? "Seus jobs vão atrasar" : "Seu job vai atrasar",
        `${name} precisa de mais ${fmtH(minutes)} em ${q(r)}, que vem antes na fila. Por isso ${list(ts)} passa${ts.length > 1 ? "m" : ""} do prazo. Decida: outro editor ou novo prazo com o cliente.`,
        { taskId: ts[0].id });
    }
  });
  res.json({ ok: true });
});

/** Editor confere a estimativa de um job novo: confirma ou manda a sua. Nunca recusa o job. */
router.post("/queue/tasks/:id/estimate", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  const me = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
  const name = u?.name ?? "Editor";
  await watchHeads(me, async () => {
    if (req.body?.confirm) {
      await db.update(tasksTable).set({ estConfirmed: true }).where(eq(tasksTable.id, r.id));
      await logEvent({ kind: "est_confirm", taskId: r.id, actorId: me, coordId: r.createdById, editorId: me, text: fmtH(r.estMinutes) });
      if (r.createdById) await notify(r.createdById, "queue_estimate", "Estimativa confirmada", `${name} confirmou ${fmtH(r.estMinutes)} para ${q(r)}.`, { taskId: r.id });
      return;
    }
    const minutes = Math.round(Number(req.body?.minutes));
    if (!(minutes > 0)) throw new Error("bad");
    await db.update(tasksTable).set({
      estConfirmed: true, estCoordMinutes: r.estMinutes, estEditorMinutes: minutes, estMinutes: minutes, estDisputeOpen: true, estOwnerId: me,
    }).where(eq(tasksTable.id, r.id));
    await logEvent({ kind: "est_contest", taskId: r.id, actorId: me, coordId: r.createdById, editorId: me,
      text: `Editor estima ${fmtH(minutes)}; coordenação estimou ${fmtH(r.estMinutes)}` });
    if (r.createdById) await notify(r.createdById, "queue_estimate", "Estimativa contestada",
      `${name} acha que ${q(r)} leva ${fmtH(minutes)} (você estimou ${fmtH(r.estMinutes)}). A fila já foi recalculada com ${fmtH(minutes)}.`, { taskId: r.id });
  }).catch(() => { res.status(400).json({ error: "Informe as horas" }); });
  if (!res.headersSent) res.json({ ok: true });
});

/**
 * Editor faz um job antes: troca na hora, sem pedir permissão. Os gestores dos jobs que mudam de previsão são avisados;
 * quem passa a ter job atrasado recebe o aviso de que precisa decidir (outro editor ou novo prazo com o cliente).
 */
router.post("/queue/tasks/:id/request-first", requireAuth, async (req, res): Promise<void> => {
  const r = await editorTask(req, res); if (!r) return;
  const me = req.session.userId!, dry = !!req.body?.dryRun;
  const names = await userNames();
  const s = await loadState();
  if (r.startDate && toLm(r.startDate) > s.now) { res.status(409).json({ error: `Este job só pode começar ${fmtLm(toLm(r.startDate))}.` }); return; }
  const ev = evaluate(s.cal, s.tasks, s.now, moveFirstMut(r.id));
  const hurt = ev.changes.filter(c => c.newlyLate);
  const impacts = ev.changes.map(c => changeText(c, names));
  const headPlaying = queueOf(s.tasks, me).some(t => t.playing && t.id !== r.id);
  if (dry) { res.json({ auto: true, impacts, newlyLate: hurt.map(c => c.t.id), headPlaying }); return; }
  const ed = names.get(me)?.name ?? "O editor", when = headPlaying ? "logo depois do job atual" : "agora";
  await watchHeads(me, async () => {
    const t = ev.ts.find(x => x.id === r.id)!;
    await db.update(tasksTable).set({ queueOrder: t.order }).where(eq(tasksTable.id, r.id));
    await logEvent({ kind: hurt.length ? "furou" : "reorder", taskId: r.id, actorId: me, coordId: r.createdById, editorId: me,
      text: `${ed} passou ${q(r)} para frente${hurt.length ? `. Passa a atrasar: ${hurt.map(c => `“${c.t.title}”`).join(", ")}` : ". Ninguém atrasa."}` });
    const coords = new Set([r.createdById, ...ev.changes.map(c => c.t.coordId)].filter((x): x is number => !!x));
    for (const c of coords) {
      const mine = hurt.filter(h => h.t.coordId === c);
      if (mine.length) await notify(c, "queue_reorder", mine.length > 1 ? "Seus jobs vão atrasar" : "Seu job vai atrasar",
        `${ed} vai fazer ${q(r)} ${when}. Com isso ${mine.map(h => `“${h.t.title}”`).join(", ")} passa${mine.length > 1 ? "m" : ""} do prazo. Decida: outro editor ou novo prazo com o cliente.`, { taskId: mine[0].t.id });
      else await notify(c, "queue_reorder", "Ordem da fila mudou",
        `${ed} vai fazer ${q(r)} ${when}.${c === r.createdById ? "" : " Seus jobs continuam no prazo."}`, { taskId: r.id });
    }
  });
  res.json({ auto: true, newlyLate: hurt.map(c => c.t.id), coords: [...new Set(hurt.map(c => c.t.coordId))] });
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

/** Coordenador sobe/desce o próprio job (troca com o vizinho). Se atrasar job de outro coordenador, vira pedido. */
router.post("/queue/tasks/:id/move", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  const dir = Number(req.body?.dir) < 0 ? -1 : 1, dry = !!req.body?.dryRun, me = req.session.userId!;
  const s = await loadState();
  const names = await userNames();
  const qq = queueOf(s.tasks, r.assignedToId ?? -1), i = qq.findIndex(t => t.id === r.id), j = i + dir;
  if (i < 0 || j < 0 || j >= qq.length) { res.status(400).json({ error: "Não dá para mover para lá" }); return; }
  const other = qq[j];
  if (qq[i].playing || other.playing) { res.status(409).json({ error: "Job em execução não muda de lugar: só o editor pausa." }); return; }
  const ev = evaluate(s.cal, s.tasks, s.now, ts => {
    const a = ts.find(x => x.id === r.id)!, b = ts.find(x => x.id === other.id)!;
    [a.order, b.order] = [b.order, a.order];
  });
  const hurt = ev.changes.filter(c => c.newlyLate && c.t.coordId !== r.createdById);
  const impacts = ev.changes.map(c => changeText(c, names));
  if (dry) { res.json({ auto: !hurt.length, impacts, approverId: hurt[0]?.t.coordId ?? null }); return; }
  await watchHeads(me, async () => {
    if (hurt.length) {
      await db.insert(queueRequestsTable).values({
        kind: "swap", taskId: r.id, swapWithId: other.id, editorId: r.assignedToId!, requestedById: me, approverId: hurt[0].t.coordId, impacts,
        passed: other.coordId !== r.createdById ? 1 : 0,
      });
      await notify(hurt[0].t.coordId!, "queue_request", "Pedido de mudança na fila",
        `${names.get(me)?.name} quer ${dir < 0 ? "subir" : "descer"} ${q(r)} na fila de ${names.get(r.assignedToId!)?.name}. Isso atrasa “${hurt[0].t.title}”.`, { taskId: r.id });
      await logEvent({ kind: "request", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text: `Pediu para ${dir < 0 ? "subir" : "descer"} ${q(r)}` });
      return;
    }
    await db.update(tasksTable).set({ queueOrder: other.order }).where(eq(tasksTable.id, r.id));
    await db.update(tasksTable).set({ queueOrder: qq[i].order }).where(eq(tasksTable.id, other.id));
    await logEvent({ kind: dir < 0 && other.coordId !== r.createdById ? "furou" : "reorder", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId,
      text: `${dir < 0 ? "Subiu" : "Desceu"} ${q(r)} na fila de ${names.get(r.assignedToId!)?.name}` });
    for (const c of new Set(ev.changes.map(c => c.t.coordId).filter((x): x is number => !!x && x !== r.createdById))) {
      await notify(c, "queue_reorder", "Ordem da fila mudou", `${names.get(me)?.name} mudou a ordem na fila de ${names.get(r.assignedToId!)?.name}. Seus jobs continuam no prazo.`, { taskId: r.id });
    }
  });
  res.json({ auto: !hurt.length, approverId: hurt[0]?.t.coordId ?? null });
});

/** Aprovar ou recusar um pedido. Quem decide: o coordenador afetado ou a supervisão. A mudança é recalculada na hora. */
router.post("/queue/requests/:id/decide", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req), ok = !!req.body?.ok, me = req.session.userId!, role = req.session.userRole;
  const [r] = await db.select().from(queueRequestsTable).where(eq(queueRequestsTable.id, id));
  if (!r || r.status !== "pendente") { res.status(404).json({ error: "Pedido não encontrado ou já respondido" }); return; }
  if (r.approverId !== me && !isSup(role)) { res.status(403).json({ error: "Este pedido não é para você" }); return; }
  const names = await userNames();
  const task = await getRow(r.taskId);
  if (!task) { res.status(404).json({ error: "Job não existe mais" }); return; }
  const actor = names.get(me)?.name ?? "Coordenação";
  if (r.kind === "reassign") {
    // troca de editor pedida por gestor: só a supervisão decide
    if (!isSup(role)) { res.status(403).json({ error: "Só a supervisão decide troca de editor" }); return; }
    await db.update(queueRequestsTable).set({ status: ok ? "aprovado" : "recusado", decidedById: me, decidedAt: new Date() }).where(eq(queueRequestsTable.id, id));
    const from = names.get(task.assignedToId ?? 0)?.name ?? "—", to = names.get(r.editorId)?.name;
    if (ok && QUEUE_STATUSES.includes(task.status) && task.assignedToId !== r.editorId) {
      const out = await placeTask(task.id, r.editorId, r.newOrder === "prio" ? "prio" : "end", me, role!, { approved: true });
      if (out.status !== 200) { res.status(out.status).json(out.body); return; }
      await notify(r.requestedById, "queue_decided", "Troca aprovada", `${actor} aprovou: ${q(task)} passou de ${from} para ${to}.`, { taskId: task.id });
    } else {
      if (ok) await db.update(queueRequestsTable).set({ status: "cancelado" }).where(eq(queueRequestsTable.id, id));
      await notify(r.requestedById, "queue_decided", ok ? "Troca não aplicada" : "Troca recusada",
        ok ? `${q(task)} já não está na fila para trocar de editor.` : `${actor} recusou passar ${q(task)} para ${to}. Continua com ${from}.`, { taskId: task.id });
      broadcastTaskChange();
    }
    await logEvent({ kind: "decide", taskId: r.taskId, actorId: me, coordId: task.createdById, editorId: r.editorId, text: `${actor} ${ok ? "aprovou" : "recusou"} a troca de editor` });
    res.json({ ok: true });
    return;
  }
  await watchHeads(me, async s => {
    await db.update(queueRequestsTable).set({ status: ok ? "aprovado" : "recusado", decidedById: me, decidedAt: new Date() }).where(eq(queueRequestsTable.id, id));
    if (r.kind === "first") {
      if (ok) {
        const ev = evaluate(s.cal, s.tasks, s.now, moveFirstMut(r.taskId));
        await db.update(tasksTable).set({ queueOrder: ev.ts.find(x => x.id === r.taskId)!.order }).where(eq(tasksTable.id, r.taskId));
        await notify(r.editorId, "queue_decided", "Pedido aprovado", `${actor} aprovou: faça ${q(task)} agora.`, { taskId: r.taskId });
      } else await notify(r.editorId, "queue_decided", "Pedido recusado", `${actor} recusou trocar ${q(task)}. Continue na ordem da fila.`, { taskId: r.taskId });
    } else if (r.kind === "swap") {
      const other = r.swapWithId ? s.rows.find(x => x.id === r.swapWithId) : null;
      if (ok && other && other.assignedToId === task.assignedToId) {
        await db.update(tasksTable).set({ queueOrder: other.queueOrder }).where(eq(tasksTable.id, task.id));
        await db.update(tasksTable).set({ queueOrder: task.queueOrder }).where(eq(tasksTable.id, other.id));
        if (r.passed) await logEvent({ kind: "furou", taskId: task.id, actorId: r.requestedById, coordId: task.createdById, editorId: task.assignedToId, text: `Subiu ${q(task)} (aprovado por ${actor})` });
      }
      await notify(r.requestedById, "queue_decided", ok ? "Pedido aprovado" : "Pedido recusado", `${actor} ${ok ? "aprovou" : "recusou"} a mudança na fila de ${names.get(r.editorId)?.name}.`, { taskId: r.taskId });
    } else if (r.kind === "insert") {
      const qq = queueOf(s.tasks, r.editorId).filter(t => t.id !== task.id);
      if (ok) {
        await db.update(tasksTable).set({ queueHold: false, queueOrder: Number(r.newOrder ?? orderAt(qq, qq.length)) }).where(eq(tasksTable.id, task.id));
        if (r.passed) await logEvent({ kind: "furou", taskId: task.id, actorId: r.requestedById, coordId: task.createdById, editorId: r.editorId, text: `Job novo na frente (aprovado por ${actor})` });
        await notify(r.requestedById, "queue_decided", "Prioridade aprovada", `${actor} aprovou: ${q(task)} entrou na frente na fila de ${names.get(r.editorId)?.name}.`, { taskId: task.id });
        await notify(r.editorId, "task_assigned", "Job novo na sua fila", `${q(task)} (${names.get(task.createdById ?? 0)?.name}) entrou na frente na sua fila. Confira a estimativa.`, { taskId: task.id });
      } else {
        await db.update(tasksTable).set({ queueHold: false, queueOrder: orderAt(qq, qq.length) }).where(eq(tasksTable.id, task.id));
        await notify(r.requestedById, "queue_decided", "Prioridade recusada", `${actor} recusou a prioridade. ${q(task)} entrou no fim da fila de ${names.get(r.editorId)?.name}: renegocie o prazo com o cliente.`, { taskId: task.id });
        await notify(r.editorId, "task_assigned", "Job novo na sua fila", `${names.get(task.createdById ?? 0)?.name} colocou ${q(task)} no fim da sua fila. Confira a estimativa.`, { taskId: task.id });
      }
    }
    await logEvent({ kind: "decide", taskId: r.taskId, actorId: me, coordId: task.createdById, editorId: r.editorId, text: `${actor} ${ok ? "aprovou" : "recusou"} o pedido` });
  });
  res.json({ ok: true });
});

router.post("/queue/requests/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const id = idParam(req), me = req.session.userId!;
  const [r] = await db.select().from(queueRequestsTable).where(eq(queueRequestsTable.id, id));
  if (!r || r.status !== "pendente") { res.status(404).json({ error: "Pedido não encontrado" }); return; }
  if (r.requestedById !== me && !isSup(req.session.userRole)) { res.status(403).json({ error: "Só quem pediu pode cancelar" }); return; }
  await db.update(queueRequestsTable).set({ status: "cancelado", decidedById: me, decidedAt: new Date() }).where(eq(queueRequestsTable.id, id));
  if (r.kind === "insert") {
    // o job novo vai para o fim da fila
    await watchHeads(me, async s => {
      const qq = queueOf(s.tasks, r.editorId).filter(t => t.id !== r.taskId);
      await db.update(tasksTable).set({ queueHold: false, queueOrder: orderAt(qq, qq.length) }).where(eq(tasksTable.id, r.taskId));
    });
  } else broadcastTaskChange();
  res.json({ ok: true });
});

/** Coordenador decide a estimativa contestada: usar a do editor ou manter a sua (o estouro fica na conta dele). */
router.post("/queue/tasks/:id/estimate-resolve", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (!r.estDisputeOpen) { res.status(400).json({ error: "Não há estimativa contestada" }); return; }
  const keep = !!req.body?.keep, me = req.session.userId!;
  const names = await userNames();
  await watchHeads(me, async () => {
    await db.update(tasksTable).set({
      estDisputeOpen: false,
      estMinutes: keep ? (r.estCoordMinutes ?? r.estMinutes) : (r.estEditorMinutes ?? r.estMinutes),
      estOwnerId: keep ? me : r.assignedToId,
    }).where(eq(tasksTable.id, r.id));
    await logEvent({ kind: keep ? "est_keep" : "est_use", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId,
      text: keep ? `Manteve ${fmtH(r.estCoordMinutes ?? 0)} contra ${fmtH(r.estEditorMinutes ?? 0)} do editor` : `Aceitou ${fmtH(r.estEditorMinutes ?? 0)} do editor` });
    if (r.assignedToId) await notify(r.assignedToId, "queue_estimate", keep ? "Estimativa mantida" : "Estimativa aceita",
      keep ? `${names.get(me)?.name} manteve ${fmtH(r.estCoordMinutes ?? 0)} para ${q(r)}. Se estourar, fica registrado na estimativa de ${names.get(me)?.name}.`
        : `${names.get(me)?.name} aceitou sua estimativa de ${fmtH(r.estEditorMinutes ?? 0)} para ${q(r)}.`, { taskId: r.id });
  });
  res.json({ ok: true });
});

/** Destravar: volta para a fila logo depois do job atual do editor. */
router.post("/queue/tasks/:id/unblock", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (r.status !== "paused") { res.status(400).json({ error: "O job não está travado" }); return; }
  const me = req.session.userId!;
  await watchHeads(me, async s => {
    const order = r.assignedToId ? orderAfterHead(s.cal, s.tasks, r.assignedToId, s.now, r.id) : 0;
    const status = r.workedMinutes > 0 ? "in_progress" : "pending";
    await db.update(tasksTable).set({ status, queueOrder: order }).where(eq(tasksTable.id, r.id));
    await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: "paused", toStatus: status, changedById: me });
    await logEvent({ kind: "unblocked", taskId: r.id, actorId: me, coordId: r.createdById, editorId: r.assignedToId, text: "Destravado: volta depois do job atual" });
    if (r.assignedToId) await notify(r.assignedToId, "task_resumed", "Job destravado", `${q(r)} foi destravado e volta logo depois do seu job atual.`, { taskId: r.id });
  });
  res.json({ ok: true });
});

/**
 * Encerrar job travado que ficou para trás (a fila andou): "delivered" = já foi entregue por fora → concluído;
 * "dropped" = não vai mais ser feito → cancelado. Fica marcado como arquivado (kind "archived") para os
 * relatórios não contarem como atraso nem como entrega no prazo.
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
 * Cliente pediu alteração (ou o job aprovado foi reaberto): nova rodada com horas próprias.
 * Entra logo depois do job atual do editor e o editor confere as horas.
 */
export async function newRound(s: State, r: TaskRow, actorId: number, minutes: number, comment: string, reopened: boolean) {
  const n = (r.revisionCount ?? 0) + 1;
  const worked = s.tasks.find(t => t.id === r.id)?.worked ?? r.workedMinutes;
  const order = r.assignedToId ? orderAfterHead(s.cal, s.tasks, r.assignedToId, s.now, r.id) : 0;
  const status = reopened ? "reopened" : "in_revision";
  await db.update(tasksTable).set({
    status, revisionCount: n, estMinutes: worked + minutes, workedMinutes: worked, playingSince: null, estExpiredAt: null,
    estConfirmed: false, queueOrder: order, queueHold: false,
  }).where(eq(tasksTable.id, r.id));
  await db.insert(taskRevisionsTable).values({ taskId: r.id, revisionNumber: n, comment, createdById: actorId });
  await db.insert(taskEventsTable).values({ taskId: r.id, fromStatus: r.status, toStatus: status, changedById: actorId });
  await logEvent({ kind: "client_change", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId,
    text: `${reopened ? "Reaberto" : "Alteração"} ${n} (${fmtH(minutes)}): ${comment}` });
  if (r.assignedToId) await notify(r.assignedToId, "task_revision", reopened ? "Job reaberto" : "Alteração solicitada",
    `${reopened ? "Cliente voltou em" : "Cliente pediu alteração em"} ${q(r)} (${fmtH(minutes)}): ${comment}. Entrou logo depois do seu job atual.`, { taskId: r.id });
  await notifyFollowers(r.id, [actorId, r.assignedToId], "task_revision", reopened ? "Job reaberto" : "Alteração do cliente", `${q(r)}: ${comment} (${fmtH(minutes)}).`);
}

router.post("/queue/tasks/:id/client-change", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  const minutes = Math.round(Number(req.body?.minutes)), comment = String(req.body?.comment ?? "").trim();
  if (!(minutes > 0)) { res.status(400).json({ error: "Informe as horas da alteração" }); return; }
  if (!comment) { res.status(400).json({ error: "Descreva a alteração" }); return; }
  if (!["review", "completed"].includes(r.status)) { res.status(400).json({ error: "Só jobs entregues podem receber alteração" }); return; }
  await watchHeads(req.session.userId!, s => newRound(s, r, req.session.userId!, minutes, comment, r.status === "completed"));
  res.json({ ok: true });
});

/* ═════════════════════════ JOB NOVO / PASSAR PARA OUTRO ═════════════════════════ */

function plansFor(s: State, nt: QTask, editorIds: number[], me: number, limit: number, names: Map<number, { name: string }>) {
  return editorIds.map(ed => {
    const p = planFor(s.cal, s.tasks, s.now, nt, ed, me, limit);
    return {
      editorId: ed, full: p.full, queueMinutes: p.queueMinutes, end: p.end, fits: p.fits,
      lateBy: nt.promised != null && !p.fits ? workBetween(s.cal, nt.promised, p.end) : 0,
      prio: {
        k: p.prio.k, end: p.prio.end, fits: p.prio.fits, passed: p.prio.passed,
        impacts: p.prio.changes.map(c => ({ text: changeText(c, names), bad: c.newlyLate })),
        approverId: p.prio.hurt[0]?.t.coordId ?? null,
      },
    };
  });
}

async function activeEditorIds(): Promise<number[]> {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, "editor"), eq(usersTable.status, "active")));
  return rows.map(r => r.id);
}

/** Prévia: quando cada editor entrega este job e o que acontece em cada opção. Não grava nada. */
router.post("/queue/plan", requireCoordinator, async (req, res): Promise<void> => {
  const me = req.session.userId!;
  const est = Math.round(Number(req.body?.estMinutes));
  if (!(est > 0)) { res.status(400).json({ error: "Informe as horas" }); return; }
  const due = req.body?.dueDate ? new Date(String(req.body.dueDate)) : null;
  const nb = req.body?.startDate ? new Date(String(req.body.startDate)) : null;
  const taskId = req.body?.taskId ? Number(req.body.taskId) : null;
  const s = await loadState(), limit = await getLimit(), names = await userNames();
  const existing = taskId ? s.tasks.find(t => t.id === taskId) : null;
  const coordId = existing?.coordId ?? me;
  const nt: QTask = {
    id: taskId ?? -1, editorId: null, coordId, title: String(req.body?.title || "Job novo"), status: existing?.status && QUEUE_STATUSES.includes(existing.status) ? existing.status : "pending",
    est, worked: existing?.worked ?? 0, playing: false, order: 0,
    notBefore: nb ? toLm(nb) : null, promised: due ? toLm(due) : null, hold: false,
  };
  const all = await activeEditorIds();
  const eds = all.filter(id => id !== existing?.editorId || !taskId);
  // entrega mais cedo fisicamente possível: o melhor editor livre agora, só no expediente
  const from = Math.max(s.now, nt.notBefore ?? 0), need = Math.max(0, est - nt.worked) || 60;
  const ends = all.map(ed => consume(s.cal, from, need, ed).end);
  const earliest = ends.length ? Math.min(...ends) : consume(s.cal, from, need).end;
  res.json({ now: s.now, limit, earliest, plans: plansFor(s, nt, eds, coordId, limit, names) });
});

/**
 * Coloca um job na fila de um editor.
 *  mode "end"   → no fim da fila. Se não cabe no prazo, o prazo passa para a data calculada (fica registrado).
 *  mode "prio"  → na posição mais para trás em que cabe no prazo. Se atrasar job de outro coordenador, vira pedido.
 *  mode "gestor"→ sem editor: a supervisão decide.
 * Serve para job novo, rascunho publicado e "passar para outro editor".
 */
export async function placeTask(
  taskId: number, editorId: number | null, mode: string, me: number, role: string,
  opts: { reason?: string; approved?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const names = await userNames(), limit = await getLimit();
  return watchHeads(me, async s => {
    const r = s.rows.find(x => x.id === taskId) ?? await getRow(taskId);
    if (!r) return { status: 404, body: { error: "Job não encontrado" } };
    const actor = names.get(me)?.name ?? "Coordenação";
    const prevEditor = r.assignedToId;
    const worked = s.tasks.find(t => t.id === r.id)?.worked ?? r.workedMinutes;
    const base: Partial<TaskRow> = { ...accrue(s.cal, r, s.now), estExpiredAt: null };
    const status = ["paused", "review", "rascunho"].includes(r.status) ? (worked > 0 ? "in_progress" : "pending") : r.status;
    // troca de mãos custa tempo: quem pega um job começado precisa entender o que foi feito
    const handover = prevEditor && editorId && prevEditor !== editorId && worked > 0 ? 60 : 0;

    if (mode === "gestor") {
      await db.update(tasksTable).set({ ...base, assignedToId: null, queueHold: false, status: status === "in_progress" ? "pending" : status }).where(eq(tasksTable.id, r.id));
      await logEvent({ kind: "assign", taskId: r.id, actorId: me, coordId: r.createdById, text: "Sem editor: enviado para a supervisão decidir" });
      await notifySupervisors("Job sem editor", `${actor} não achou editor que entregue ${q(r)} (${fmtH(r.estMinutes)})${r.dueDate ? ` até ${fmtLm(toLm(r.dueDate))}` : ""}. Decida: dar para alguém mesmo com a agenda cheia ou renegociar o prazo.`, r.id);
      if (prevEditor) await notify(prevEditor, "task_reassigned", "Job saiu da sua fila", `${q(r)} saiu da sua fila (${actor}).`, { taskId: r.id });
      return { status: 200, body: { message: `${q(r)} foi para a supervisão decidir.` } };
    }
    if (!editorId) return { status: 400, body: { error: "Escolha o editor" } };
    const nt: QTask = { ...(s.tasks.find(t => t.id === r.id) ?? toQ(s.cal, r, s.now)), status, est: r.estMinutes + handover, playing: false, hold: false, editorId: null };
    const p = planFor(s.cal, s.tasks, s.now, nt, editorId, r.createdById, limit);
    if (p.full && !isSup(role)) return { status: 409, body: { error: `A fila de ${names.get(editorId)?.name} passaria do limite de ${fmtH(limit)}. Mande para a supervisão.` } };

    // Gestor trocando o editor de um job que já tinha editor: se mexe em prazo (o do próprio job ou o de outro), a supervisão aprova antes.
    // Evita o pula-pula entre filas. O job fica onde está até a resposta.
    const touches = mode === "end" ? !p.fits && !!r.dueDate : mode === "prio" ? !p.prio.fits || p.prio.changes.some(c => c.newlyLate) : false;
    if (prevEditor && prevEditor !== editorId && !isSup(role) && !opts.approved && touches) {
      const reason = (opts.reason ?? "").trim();
      if (!reason) return { status: 400, body: { error: "Essa troca mexe em prazo e vai para a supervisão aprovar. Diga o motivo.", needsReason: true } };
      const from = names.get(prevEditor)?.name, edName = names.get(editorId)?.name;
      const impacts = mode === "end"
        ? [`Prazo de ${q(r)} passa de ${fmtLm(toLm(r.dueDate!))} para ${fmtLm(p.end)}`]
        : p.prio.changes.map(c => changeText(c, names));
      await db.insert(queueRequestsTable).values({
        kind: "reassign", taskId: r.id, editorId, requestedById: me, approverId: null, escalated: true,
        newOrder: mode, // na troca de editor guarda o modo pedido ("end" | "prio"); a posição é recalculada ao aprovar
        impacts: [`Motivo: ${reason}`, ...impacts], passed: p.prio.passed,
      });
      await logEvent({ kind: "request", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Pediu à supervisão para passar de ${from} para ${edName}: ${reason}` });
      await notifySupervisors("Troca de editor para aprovar", `${actor} quer passar ${q(r)} de ${from} para ${edName}, mexendo em prazo. Motivo: ${reason}`, r.id);
      return { status: 200, body: { message: `Pedido enviado à supervisão. ${q(r)} continua com ${from} até a resposta.`, pending: true } };
    }
    const qq = queueOf(s.tasks.filter(t => t.id !== r.id), editorId);
    const common: Partial<TaskRow> = { ...base, assignedToId: editorId, status, estMinutes: r.estMinutes + handover, estConfirmed: prevEditor === editorId ? r.estConfirmed : false };
    const edName = names.get(editorId)?.name;
    if (prevEditor !== editorId) {
      await db.insert(taskEditorsTable).values({ taskId: r.id, userId: editorId, assignedById: me }).onConflictDoNothing();
      if (prevEditor) {
        await db.delete(taskEditorsTable).where(and(eq(taskEditorsTable.taskId, r.id), eq(taskEditorsTable.userId, prevEditor)));
        await notify(prevEditor, "task_reassigned", "Job passado para outro editor", `${q(r)} foi passado para ${edName} (${actor}).`, { taskId: r.id });
        await notifyFollowers(r.id, [me, r.createdById], "task_reassigned", "Job mudou de editor", `${q(r)} foi passado para ${edName} (${actor}).`);
      }
      if (handover) await logEvent({ kind: "reassign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Passado de ${names.get(prevEditor!)?.name} para ${edName}. +1h de troca de mãos.` });
    }

    if (mode === "end") {
      const upd: Partial<TaskRow> = { ...common, queueOrder: orderAt(qq, qq.length), queueHold: false };
      let msg = `${q(r)} entrou no fim da fila de ${edName}. Pronto ${fmtLm(p.end)}.`;
      if (!p.fits && r.dueDate) {
        upd.dueDateOriginal = r.dueDateOriginal ?? r.dueDate;
        upd.dueDate = fromLm(p.end);
        await logEvent({ kind: "reneg", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Prazo empurrado de ${fmtLm(toLm(r.dueDate))} para ${fmtLm(p.end)}` });
        msg = `${q(r)} entrou no fim da fila de ${edName}. Novo prazo ${fmtLm(p.end)}: avise o cliente.`;
        await notifyFollowers(r.id, [me], "due_date_changed", "Prazo empurrado", `O prazo de ${q(r)} passou de ${fmtLm(toLm(r.dueDate))} para ${fmtLm(p.end)}.`);
      }
      await db.update(tasksTable).set(upd).where(eq(tasksTable.id, r.id));
      await logEvent({ kind: "assign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Fim da fila de ${edName}${p.full ? " (agenda já cheia, decisão da supervisão)" : ""}` });
      await notify(editorId, "task_assigned", "Job novo na sua fila",
        `${actor} colocou ${q(r)} no fim da sua fila com ${fmtH(r.estMinutes + handover)}${p.full ? ", com a agenda já cheia, por decisão da supervisão" : ""}. Confira a estimativa.`, { taskId: r.id });
      return { status: 200, body: { message: msg } };
    }

    // prioridade
    if (!p.prio.hurt.length || opts.approved) {
      await db.update(tasksTable).set({ ...common, queueOrder: p.prio.order, queueHold: false }).where(eq(tasksTable.id, r.id));
      if (p.prio.passed) await logEvent({ kind: "furou", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Na frente de ${p.prio.passed} job(s) de outro coordenador na fila de ${edName}. Ninguém atrasou.` });
      await logEvent({ kind: "assign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `${p.prio.k + 1}º na fila de ${edName}` });
      for (const c of new Set(p.prio.changes.map(c => c.t.coordId).filter((x): x is number => !!x && x !== r.createdById))) {
        await notify(c, "queue_reorder", "Ordem da fila mudou", `${actor} colocou ${q(r)} na frente na fila de ${edName}. Seus jobs continuam no prazo.`, { taskId: r.id });
      }
      await notify(editorId, "task_assigned", "Job novo na sua fila", `${actor} colocou ${q(r)} (${fmtH(r.estMinutes + handover)}) na frente na sua fila. Confira a estimativa.`, { taskId: r.id });
      return { status: 200, body: { message: `${q(r)} entrou em ${p.prio.k + 1}º na fila de ${edName}. Pronto ${fmtLm(p.prio.end)}.` } };
    }
    const approverId = p.prio.hurt[0].t.coordId!;
    await db.update(tasksTable).set({ ...common, queueOrder: p.prio.order, queueHold: true }).where(eq(tasksTable.id, r.id));
    await db.insert(queueRequestsTable).values({
      kind: "insert", taskId: r.id, editorId, requestedById: me, approverId, newOrder: String(p.prio.order),
      impacts: p.prio.changes.map(c => changeText(c, names)), passed: p.prio.passed,
    });
    await logEvent({ kind: "request", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Pediu prioridade na fila de ${edName}` });
    await notify(approverId, "queue_request", "Pedido de prioridade",
      `${actor} quer colocar ${q(r)} na frente na fila de ${edName}. Isso atrasa “${p.prio.hurt[0].t.title}”. Precisa da sua resposta.`, { taskId: r.id });
    return { status: 200, body: { message: `Pedido de prioridade enviado para ${names.get(approverId)?.name}. ${q(r)} fica fora da fila até a resposta.`, pending: true } };
  });
}

router.post("/queue/tasks/:id/place", requireCoordinator, async (req, res): Promise<void> => {
  const r = await coordTask(req, res); if (!r) return;
  if (["completed", "cancelled"].includes(r.status)) { res.status(400).json({ error: "Job encerrado" }); return; }
  const pend = await db.select().from(queueRequestsTable).where(and(eq(queueRequestsTable.taskId, r.id), eq(queueRequestsTable.status, "pendente")));
  for (const p of pend) await db.update(queueRequestsTable).set({ status: "cancelado", decidedAt: new Date(), decidedById: req.session.userId }).where(eq(queueRequestsTable.id, p.id));
  const editorId = req.body?.editorId ? Number(req.body.editorId) : null;
  if (editorId) {
    const [u] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, editorId));
    if (!u || u.status !== "active") { res.status(400).json({ error: "Editor inativo não recebe jobs" }); return; }
  }
  const out = await placeTask(r.id, editorId, String(req.body?.mode ?? "end"), req.session.userId!, req.session.userRole!, { reason: req.body?.reason });
  res.status(out.status).json(out.body);
});

/* ═════════════════════════ REDISTRIBUIR (inativação, ausência) ═════════════════════════ */

/**
 * Quando alguém sai (inativado) ou fica fora (férias, afastamento), a supervisão redistribui de uma vez:
 *  - jobs que a pessoa edita → outro editor, pelas mesmas regras de "passar para outro editor";
 *  - jobs que a pessoa coordena → outro gestor (troca o responsável, a posição na fila não muda).
 * A prévia simula tudo junto: cada job é encaixado contando com os anteriores já colocados.
 */
type HandoffMode = "end" | "prio" | "gestor" | "keep" | "swap";
interface HandoffChoice { taskId: number; editorId: number | null; mode: HandoffMode }
const HANDOFF_MODES: HandoffMode[] = ["end", "prio", "gestor", "keep", "swap"];
const OWNER_ROLES = ["admin", "supervisor", "coordinator"];

async function handoffData(userId: number) {
  const s = await loadState();
  const editing = s.rows.filter(r => r.assignedToId === userId);
  // rascunhos não entram no motor, mas também podem estar no nome da pessoa
  const drafts = await db.select().from(tasksTable).where(and(eq(tasksTable.status, "rascunho"), sql`(${tasksTable.assignedToId} = ${userId} OR ${tasksTable.createdById} = ${userId})`));
  const owned = [...s.rows, ...drafts].filter(r => r.createdById === userId);
  const editingDrafts = drafts.filter(r => r.assignedToId === userId);
  return { s, editing: [...editing, ...editingDrafts], owned };
}

/** Sugestão para um job da fila: entregar no prazo > prioridade sem atrasar ninguém > o mais cedo (prazo empurrado) > supervisão. */
function suggest(plans: Plan[]): { editorId: number | null; mode: HandoffMode } {
  const ok = plans.filter(p => !p.full);
  const best = (xs: Plan[], end: (p: Plan) => number) => xs.reduce<Plan | null>((a, p) => (!a || end(p) < end(a) ? p : a), null);
  const a = best(ok.filter(p => p.fits), p => p.end);
  if (a) return { editorId: a.editorId, mode: "end" };
  const b = best(ok.filter(p => p.prio.fits && !p.prio.hurt.length), p => p.prio.end);
  if (b) return { editorId: b.editorId, mode: "prio" };
  const c = best(ok, p => p.end);
  if (c) return { editorId: c.editorId, mode: "end" };
  return { editorId: null, mode: "gestor" };
}

function simulateHandoff(
  s: State, rows: TaskRow[], userId: number, eds: number[], limit: number,
  fixed: Map<number, HandoffChoice>, absence: boolean,
) {
  const pre = schedule(s.cal, s.tasks, s.now);
  // começa com a fila da pessoa vazia; cada job volta para ela só se ficar ("keep")
  const sim = s.tasks.map(t => (t.editorId === userId ? { ...t, editorId: null } : { ...t }));
  const isQ = (r: TaskRow) => QUEUE_STATUSES.includes(r.status);
  const ord = [...rows].sort((a, b) =>
    Number(isQ(b)) - Number(isQ(a)) ||
    (a.dueDate ? +a.dueDate : Infinity) - (b.dueDate ? +b.dueDate : Infinity) ||
    (pre.get(a.id)?.pos ?? 99) - (pre.get(b.id)?.pos ?? 99));

  const items = ord.map(r => {
    const t = sim.find(x => x.id === r.id);
    const preSlot = pre.get(r.id);
    const want = fixed.get(r.id);
    // fora da fila (com o cliente, travado, rascunho): só troca quem é o editor
    if (!t || !isQ(r)) {
      const lightest = [...eds].sort((a, b) => queueMinutes(sim, a) - queueMinutes(sim, b))[0] ?? null;
      const choice = want && ["swap", "keep"].includes(want.mode) ? want
        : { taskId: r.id, editorId: absence ? null : (r.status === "rascunho" ? null : lightest), mode: (absence ? "keep" : "swap") as HandoffMode };
      if (t && choice.mode === "keep") t.editorId = userId;
      else if (t) t.editorId = choice.editorId;
      return { r, choice: { ...choice, taskId: r.id }, plans: [] as Plan[], inQueue: false, preSlot };
    }
    const handover = t.worked > 0 ? 60 : 0;
    const nt: QTask = { ...t, est: t.est + handover, playing: false, hold: false, editorId: null };
    const plans = eds.map(ed => planFor(s.cal, sim, s.now, nt, ed, t.coordId, limit));
    let choice: HandoffChoice;
    if (want && (want.mode !== "end" && want.mode !== "prio" || plans.some(p => p.editorId === want.editorId))) choice = want;
    else if (absence && preSlot && !preSlot.late) choice = { taskId: r.id, editorId: userId, mode: "keep" }; // ainda entrega no prazo depois da volta
    else choice = { taskId: r.id, ...suggest(plans) };

    if (choice.mode === "keep") t.editorId = userId;
    else if (choice.mode === "end" || choice.mode === "prio") {
      const p = plans.find(x => x.editorId === choice.editorId)!;
      const q = queueOf(sim, choice.editorId!);
      Object.assign(t, nt, { editorId: choice.editorId, order: choice.mode === "prio" ? p.prio.order : orderAt(q, q.length) });
    }
    return { r, choice: { ...choice, taskId: r.id }, plans, inQueue: true, preSlot };
  });

  const after = schedule(s.cal, sim, s.now);
  return { items, after, sim };
}

/** Prévia: sugestão para cada job e o efeito de tudo junto. Não grava nada. */
router.post("/queue/handoff/:userId/preview", requireSupervisor, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  const fixed = new Map<number, HandoffChoice>();
  for (const c of Array.isArray(req.body?.choices) ? req.body.choices : []) {
    if (HANDOFF_MODES.includes(c?.mode)) fixed.set(Number(c.taskId), { taskId: Number(c.taskId), editorId: c.editorId ? Number(c.editorId) : null, mode: c.mode });
  }
  const [person] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!person) { res.status(404).json({ error: "Pessoa não encontrada" }); return; }
  // ausência (ou pessoa ainda ativa vista pela Fila): sugere esperar a volta quando ainda dá prazo
  const absence = req.body?.context === "absence" || (req.body?.context !== "inactivate" && person.status === "active");

  const { s, editing, owned } = await handoffData(userId);
  const limit = await getLimit(), names = await userNames();
  const users = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl }).from(usersTable);
  const eds = users.filter(u => u.role === "editor" && u.status === "active" && u.id !== userId).map(u => u.id);
  const { items, after, sim } = simulateHandoff(s, editing, userId, eds, limit, fixed, absence);
  const today = Math.floor(s.now / DAY);

  const view = (r: TaskRow) => ({
    id: r.id, code: code(r), title: r.title, client: r.client, status: r.status, coordId: r.createdById, editorId: r.assignedToId,
    est: r.estMinutes, worked: s.tasks.find(t => t.id === r.id)?.worked ?? r.workedMinutes, playing: !!r.playingSince,
    promised: r.dueDate ? toLm(r.dueDate) : null,
  });

  res.json({
    now: s.now, limit,
    person: { ...person, isEditor: editing.length > 0 || person.role === "editor" },
    editors: users.filter(u => eds.includes(u.id)).map(u => ({
      id: u.id, name: u.name, jobTitle: u.jobTitle, avatarUrl: u.avatarUrl,
      before: queueMinutes(s.tasks, u.id), after: queueMinutes(sim, u.id), offToday: dayOff(s.cal, today, u.id),
    })),
    owners: users.filter(u => OWNER_ROLES.includes(u.role) && u.status === "active" && u.id !== userId)
      .map(u => ({ id: u.id, name: u.name, role: u.role, jobTitle: u.jobTitle, avatarUrl: u.avatarUrl })),
    editing: items.map(({ r, choice, plans, inQueue, preSlot }) => {
      const a = after.get(r.id), p = plans.find(x => x.editorId === choice.editorId);
      const promised = r.dueDate ? toLm(r.dueDate) : null;
      return {
        ...view(r), inQueue, mode: choice.mode, to: choice.editorId,
        before: preSlot ? { end: preSlot.end, late: preSlot.late } : null,
        result: a ? { end: a.end, late: a.late, lateBy: Number.isFinite(a.lateBy) ? a.lateBy : null } : null,
        // "fim da fila" que não cabe: o prazo passa para quando dá; "prioridade" que atrasa alguém: vira pedido
        newPromised: choice.mode === "end" && a && promised != null && a.end > promised ? a.end : null,
        approverId: choice.mode === "prio" ? p?.prio.hurt[0]?.t.coordId ?? null : null,
        options: plans.map(x => ({
          editorId: x.editorId, end: x.end, fits: x.fits, full: x.full,
          prioEnd: x.prio.end, prioFits: x.prio.fits, prioApproverId: x.prio.hurt[0]?.t.coordId ?? null,
        })),
      };
    }),
    owned: owned.map(view),
    names: Object.fromEntries([...names].map(([id, n]) => [id, n.name])),
  });
});

/** Aplica a redistribuição. Cada job passa pelas mesmas regras de sempre (placeTask). */
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
    await db.update(queueRequestsTable).set({ approverId: coordId })
      .where(and(eq(queueRequestsTable.status, "pendente"), eq(queueRequestsTable.approverId, userId), eq(queueRequestsTable.taskId, taskId)));
    await logEvent({ kind: "owner", taskId, actorId: me, coordId, editorId: r.assignedToId, text: `Responsável passou de ${who} para ${names.get(coordId)?.name} (${actor})` });
    await notify(coordId, "task_reassigned", "Job passou para você", `${actor} passou ${q(r)} para você. Antes era de ${who}.`, { taskId });
    out.owners++;
  }
  // pedidos que esperavam a resposta de quem saiu e não são de jobs dele: vão para a supervisão
  if (req.body?.inactivate) {
    await db.update(queueRequestsTable).set({ approverId: null, escalated: true })
      .where(and(eq(queueRequestsTable.status, "pendente"), eq(queueRequestsTable.approverId, userId)));
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
      await watchHeads(me, async s => {
        await db.update(tasksTable).set({ ...accrue(s.cal, r, s.now), assignedToId: editorId }).where(eq(tasksTable.id, r.id));
        await db.delete(taskEditorsTable).where(and(eq(taskEditorsTable.taskId, r.id), eq(taskEditorsTable.userId, userId)));
        if (editorId) await db.insert(taskEditorsTable).values({ taskId: r.id, userId: editorId, assignedById: me }).onConflictDoNothing();
        await logEvent({ kind: "reassign", taskId: r.id, actorId: me, coordId: r.createdById, editorId, text: `Editor passou de ${who} para ${editorId ? names.get(editorId)?.name : "ninguém"} (${actor})` });
        if (editorId) await notify(editorId, "task_assigned", "Job passou para você", `${actor} passou ${q(r)} para você. Antes era de ${who}.`, { taskId: r.id });
      });
      out.swapped++;
      continue;
    }
    const pend = await db.select().from(queueRequestsTable).where(and(eq(queueRequestsTable.taskId, r.id), eq(queueRequestsTable.status, "pendente")));
    for (const p of pend) await db.update(queueRequestsTable).set({ status: "cancelado", decidedAt: new Date(), decidedById: me }).where(eq(queueRequestsTable.id, p.id));
    const resp = await placeTask(r.id, mode === "gestor" ? null : editorId, mode, me, role);
    if (resp.status !== 200) { out.errors.push(String(resp.body.error ?? `Falha no job ${taskId}`)); continue; }
    if (mode === "gestor") out.gestor++; else if (resp.body.pending) out.requests++; else out.moved++;
  }
  res.json(out);
});

/* ═════════════════════════ SUPERVISÃO ═════════════════════════ */

router.put("/queue/settings", requireSupervisor, async (req, res): Promise<void> => {
  const v = Math.round(Number(req.body?.limitMinutes));
  if (!(v >= 60)) { res.status(400).json({ error: "Limite inválido" }); return; }
  await db.insert(appSettingsTable).values({ key: "queue_limit_minutes", value: String(v) })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: String(v) } });
  broadcastTaskChange();
  res.json({ ok: true });
});

router.get("/queue/holidays", requireAuth, async (_req, res): Promise<void> => {
  res.json(await db.select().from(holidaysTable).orderBy(holidaysTable.day));
});
router.post("/queue/holidays", requireSupervisor, async (req, res): Promise<void> => {
  const day = String(req.body?.day ?? ""), name = String(req.body?.name ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) { res.status(400).json({ error: "Informe a data e o nome" }); return; }
  await db.insert(holidaysTable).values({ day, name }).onConflictDoUpdate({ target: holidaysTable.day, set: { name } });
  invalidateHolidays(); broadcastTaskChange();
  res.json({ ok: true });
});
router.delete("/queue/holidays/:day", requireSupervisor, async (req, res): Promise<void> => {
  await db.delete(holidaysTable).where(eq(holidaysTable.day, String(req.params.day)));
  invalidateHolidays(); broadcastTaskChange();
  res.json({ ok: true });
});

export default router;

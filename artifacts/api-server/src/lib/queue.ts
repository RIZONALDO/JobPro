/**
 * Fila em horas — substitui o antigo sistema de carga por complexidade.
 *
 * Regras:
 *  - Cada editor tem UMA fila. Um job por vez, sem sobreposição e sem paralelo.
 *  - A ordem é da coordenação. O editor só começa o 1º; pode pedir troca.
 *  - Início e fim previstos são CALCULADOS a partir de agora, só no expediente (lib/workcal.ts).
 *  - Prazo prometido (dueDate) fica separado da previsão: atraso = previsão passou do prazo.
 *  - Job em execução (▶) nunca é derrubado por troca de ordem.
 *  - "Não antes de" (startDate): se houver buraco antes, o sistema encaixa ali o próximo job que caiba.
 *  - Horas estimadas acabaram e o editor não informou quanto falta → reserva de 1h.
 *  - Mudança que atrasa job de OUTRO coordenador vira pedido de aprovação.
 */
import { db, tasksTable, usersTable, holidaysTable, userAbsencesTable, queueEventsTable, appSettingsTable } from "@workspace/db";
import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import {
  type Calendar, type Absence, DAY, RESERVA, consume, workBetween, inShift, toLm, fromLm, fmtLm, fmtH, dayKey,
} from "./workcal.js";
import { notify, notifyFollowers } from "./notify.js";
import { ABSENCE_LABEL } from "./availability.js";

export const QUEUE_STATUSES = ["pending", "in_progress", "in_revision", "reopened"];
export const DEFAULT_LIMIT = 40 * 60;

/* ═════════════════════════ MOTOR (funções puras) ═════════════════════════ */

export interface QTask {
  id: number;
  editorId: number | null;
  coordId: number | null;
  title: string;
  status: string;
  est: number;          // minutos estimados
  worked: number;       // minutos trabalhados (inclui o trecho em execução)
  playing: boolean;
  order: number;
  notBefore: number | null; // minutos locais
  promised: number | null;  // minutos locais
  hold: boolean;
}
export interface Slot {
  start: number; end: number; segs: [number, number][];
  late: boolean; lateBy: number; pos: number; filled: number | null; gapBefore: number;
}
export interface Change { t: QTask; from: number; to: number; newlyLate: boolean; lb: number }

export const rem = (t: QTask) => (t.est - t.worked > 0 ? t.est - t.worked : RESERVA);
export const inQueue = (t: QTask) => t.editorId != null && !t.hold && QUEUE_STATUSES.includes(t.status);
export function queueOf(ts: QTask[], ed: number): QTask[] {
  return ts.filter(t => inQueue(t) && t.editorId === ed)
    .sort((a, b) => (Number(b.playing) - Number(a.playing)) || a.order - b.order || a.id - b.id);
}
export const queueMinutes = (ts: QTask[], ed: number) => queueOf(ts, ed).reduce((s, t) => s + rem(t), 0);

/** Atraso em minutos de expediente (negativo = folga). */
export function lateBy(cal: Calendar, t: QTask, end: number): number {
  if (t.promised == null) return -Infinity;
  return end > t.promised ? workBetween(cal, t.promised, end) : -workBetween(cal, end, t.promised);
}

export function schedule(cal: Calendar, ts: QTask[], now: number): Map<number, Slot> {
  const r = new Map<number, Slot>();
  const eds = [...new Set(ts.filter(inQueue).map(t => t.editorId as number))];
  for (const ed of eds) {
    let cur = now, n = 0;
    const pend = queueOf(ts, ed);
    while (pend.length) {
      const start = consume(cal, cur, 0, ed).start, head = pend[0];
      let i = 0;
      if (!head.playing && head.notBefore != null && head.notBefore > start) {
        // buraco antes de um job travado por data: encaixa o próximo que caiba sem atrasá-lo
        const k = pend.findIndex((x, j) => j > 0 && !(x.notBefore != null && x.notBefore > start) && consume(cal, cur, rem(x), ed).end <= head.notBefore!);
        if (k > 0) i = k;
      }
      const t = pend.splice(i, 1)[0];
      const from = t.playing ? cur : Math.max(cur, t.notBefore ?? 0);
      const c = consume(cal, from, rem(t), ed);
      const lb = lateBy(cal, t, c.end);
      r.set(t.id, { ...c, late: lb > 0, lateBy: lb, pos: n++, filled: i > 0 ? head.id : null, gapBefore: workBetween(cal, cur, c.start, ed) });
      cur = c.end;
    }
  }
  return r;
}

export function heads(cal: Calendar, ts: QTask[], now: number): Map<number, number> {
  const sch = schedule(cal, ts, now), out = new Map<number, number>();
  for (const [id, s] of sch) if (s.pos === 0) { const t = ts.find(x => x.id === id)!; out.set(t.editorId!, id); }
  return out;
}

/** Avalia uma mudança sem gravar. */
export function evaluate(cal: Calendar, ts: QTask[], now: number, mutate: (ts: QTask[]) => void) {
  const before = schedule(cal, ts, now);
  const copy = ts.map(t => ({ ...t }));
  mutate(copy);
  const after = schedule(cal, copy, now);
  const changes: Change[] = [];
  for (const t of copy) {
    const b = before.get(t.id), a = after.get(t.id);
    if (!b || !a || b.end === a.end) continue;
    changes.push({ t, from: b.end, to: a.end, newlyLate: a.late && !b.late, lb: a.lateBy });
  }
  return { ts: copy, before, after, changes };
}

export const orderAt = (q: QTask[], k: number) =>
  !q.length ? 0 : k <= 0 ? q[0].order - 1 : k >= q.length ? q[q.length - 1].order + 1 : (q[k - 1].order + q[k].order) / 2;

/** Ordem para "logo depois do job atual" (job em execução nunca é derrubado). */
export function orderAfterHead(cal: Calendar, ts: QTask[], ed: number, now: number, excludeId?: number): number {
  const q = queueOf(ts, ed).filter(t => t.id !== excludeId);
  if (!q.length) return 0;
  const sch = schedule(cal, ts.filter(t => t.id !== excludeId), now);
  const sorted = [...q].sort((a, b) => sch.get(a.id)!.pos - sch.get(b.id)!.pos);
  const head = sorted[0];
  const idx = q.indexOf(head);
  return orderAt(q, idx + 1);
}

/** Editor pede para fazer um job antes: vai para o topo, ou logo depois do job em execução. */
export function moveFirstMut(id: number) {
  return (ts: QTask[]) => {
    const t = ts.find(x => x.id === id)!;
    const q = queueOf(ts, t.editorId!).filter(x => x !== t), head = q[0];
    if (head && head.playing) { const nx = q[1]; t.order = nx ? (head.order + nx.order) / 2 : head.order + 1; }
    else t.order = Math.min(...q.map(x => x.order), 0) - 1;
  };
}

/**
 * Job travado: se for destravado agora (volta logo depois do job atual do editor), quando fica pronto.
 * O prazo continua correndo enquanto o job está parado; isso mostra quanto de folga ainda resta.
 */
export function unblockForecast(cal: Calendar, ts: QTask[], now: number, id: number): { end: number; late: boolean; lateBy: number | null } | null {
  const t = ts.find(x => x.id === id);
  if (!t || !t.editorId) return null;
  const order = orderAfterHead(cal, ts, t.editorId, now, id);
  const ev = evaluate(cal, ts, now, xs => {
    const x = xs.find(y => y.id === id)!;
    Object.assign(x, { status: x.worked > 0 ? "in_progress" : "pending", order, hold: false, playing: false });
  });
  const sl = ev.after.get(id);
  return sl ? { end: sl.end, late: sl.late, lateBy: Number.isFinite(sl.lateBy) ? sl.lateBy : null } : null;
}

/** Folga abaixo disso (minutos de expediente) deixa um job travado crítico. */
export const BLOCK_CRITICAL_SLACK = 240;

/** Frase do prazo de um job travado, para os avisos. `critical` = já atrasa ou a folga é curta. */
export function blockRisk(promised: number | null, now: number, fc: ReturnType<typeof unblockForecast>): { text: string; critical: boolean } {
  if (promised == null) return { text: "", critical: false };
  if (promised <= now) return { text: ` O prazo já venceu (${fmtLm(promised)}).`, critical: true };
  if (!fc) return { text: ` Prazo ${fmtLm(promised)}.`, critical: false };
  if (fc.late) return { text: ` Prazo ${fmtLm(promised)}: mesmo destravando agora, fica pronto só ${fmtLm(fc.end)} (atrasa ${fmtH(fc.lateBy ?? 0)}).`, critical: true };
  const slack = fc.lateBy != null ? -fc.lateBy : Infinity;
  return {
    text: ` Prazo ${fmtLm(promised)}: destravando agora, fica pronto ${fmtLm(fc.end)}${Number.isFinite(slack) ? ` (folga de ${fmtH(slack)})` : ""}.`,
    critical: slack < BLOCK_CRITICAL_SLACK,
  };
}

/** Folga mínima entre o job ficar pronto e o prazo do cliente: prazo "em cima" quebra com qualquer imprevisto. */
export const FOLGA = 60;

export interface Plan {
  editorId: number; full: boolean; queueMinutes: number; end: number; fits: boolean;
  /** prazo sugerido se aceitar a data: pronto + 1h de folga */
  newDue: number;
  prio: { k: number; order: number; end: number; fits: boolean; changes: Change[]; hurt: Change[]; passed: number };
}
/** Onde um job (novo ou passado de outro editor) cabe na fila de `ed`. */
export function planFor(cal: Calendar, ts: QTask[], now: number, nt: QTask, ed: number, me: number | null, limit: number): Plan {
  const base = ts.filter(t => t.id !== nt.id);
  const q = queueOf(base, ed);
  const qm = queueMinutes(base, ed);
  const full = qm + rem(nt) > limit;
  const at = (k: number) => evaluate(cal, base, now, x => { x.push({ ...nt, editorId: ed, hold: false, playing: false, order: orderAt(q, k) }); });
  const evEnd = at(q.length), end = evEnd.after.get(nt.id)!.end;
  // cabe = fica pronto com pelo menos FOLGA de expediente antes do prazo
  const ok = (e: number) => nt.promised == null || consume(cal, e, FOLGA, ed).end <= nt.promised;
  const minK = q[0] && q[0].playing ? 1 : 0;
  let k = q.length, ev = evEnd;
  if (!ok(end)) {
    // a posição mais para trás em que ainda cabe no prazo
    k = minK;
    for (let j = q.length - 1; j >= minK; j--) if (ok(at(j).after.get(nt.id)!.end)) { k = j; break; }
    ev = at(k);
  }
  const pend = ev.after.get(nt.id)!.end;
  return {
    editorId: ed, full, queueMinutes: qm, end, fits: ok(end), newDue: consume(cal, end, FOLGA, ed).end,
    prio: {
      k, order: orderAt(q, k), end: pend, fits: ok(pend), changes: ev.changes,
      hurt: ev.changes.filter(c => c.newlyLate && c.t.coordId !== me), passed: q.slice(k).filter(x => x.coordId !== me).length,
    },
  };
}

/* ═════════════════════════ BANCO ═════════════════════════ */

let holidayCache: { at: number; map: Map<string, string> } | null = null;
export function invalidateHolidays() { holidayCache = null; }

export async function loadCalendar(editorIds?: number[]): Promise<Calendar> {
  if (!holidayCache || Date.now() - holidayCache.at > 60_000) {
    const rows = await db.select().from(holidaysTable);
    holidayCache = { at: Date.now(), map: new Map(rows.map(r => [r.day, r.name])) };
  }
  const from = dayKey(Math.floor(toLm(new Date()) / DAY) - 7);
  const conds = [gte(userAbsencesTable.endDate, from)];
  if (editorIds?.length) conds.push(inArray(userAbsencesTable.userId, editorIds));
  const abs = await db.select().from(userAbsencesTable).where(and(...conds));
  const absences = new Map<number, Absence[]>();
  for (const a of abs) {
    const l = absences.get(a.userId) ?? [];
    l.push({ start: a.startDate, end: a.endDate, label: ABSENCE_LABEL[a.type] ?? "Ausência" });
    absences.set(a.userId, l);
  }
  return { holidays: holidayCache.map, absences };
}

export async function getLimit(): Promise<number> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "queue_limit_minutes"));
  const v = row?.value ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}

export type TaskRow = typeof tasksTable.$inferSelect;

export function liveWorked(cal: Calendar, r: TaskRow, now: number): number {
  return r.workedMinutes + (r.playingSince ? workBetween(cal, toLm(r.playingSince), now, r.assignedToId) : 0);
}

export function toQ(cal: Calendar, r: TaskRow, now: number): QTask {
  return {
    id: r.id, editorId: r.assignedToId, coordId: r.createdById, title: r.title, status: r.status,
    est: r.estMinutes, worked: liveWorked(cal, r, now), playing: !!r.playingSince, order: r.queueOrder,
    notBefore: r.startDate ? toLm(r.startDate) : null, promised: r.dueDate ? toLm(r.dueDate) : null, hold: r.queueHold,
  };
}

/** Tudo o que está aberto (fila, com o cliente, travado, sem editor, aguardando prioridade). */
export async function loadState() {
  const rows = await db.select().from(tasksTable)
    .where(notInArray(tasksTable.status, ["completed", "cancelled", "rascunho"]));
  const editorIds = [...new Set(rows.map(r => r.assignedToId).filter((x): x is number => !!x))];
  const cal = await loadCalendar(editorIds);
  const now = toLm(new Date());
  const tasks = rows.map(r => toQ(cal, r, now));
  return { now, cal, rows, tasks };
}
export type State = Awaited<ReturnType<typeof loadState>>;

/** Para o relógio do job: soma o trecho em execução às horas trabalhadas. */
export function accrue(cal: Calendar, r: TaskRow, now: number): Partial<TaskRow> {
  if (!r.playingSince) return {};
  return { workedMinutes: liveWorked(cal, r, now), playingSince: null };
}

export async function userNames(): Promise<Map<number, { name: string; role: string; status: string }>> {
  const us = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status }).from(usersTable);
  return new Map(us.map(u => [u.id, { name: u.name, role: u.role, status: u.status }]));
}

export function changeText(c: Change, names: Map<number, { name: string }>): string {
  const coord = c.t.coordId ? names.get(c.t.coordId)?.name ?? "—" : "—";
  return `${c.t.title} (${coord}): pronto ${fmtLm(c.to)}${c.to < c.from ? ", mais cedo" : ""}${c.newlyLate ? ` e passa do prazo em ${fmtH(c.lb)}` : c.lb > 0 ? `, atrasado ${fmtH(c.lb)}` : ", no prazo"}`;
}

export async function logEvent(e: { kind: string; taskId?: number | null; actorId?: number | null; text?: string; coordId?: number | null; editorId?: number | null; data?: Record<string, unknown> }) {
  await db.insert(queueEventsTable).values({
    kind: e.kind, taskId: e.taskId ?? null, actorId: e.actorId ?? null, text: e.text ?? null,
    coordId: e.coordId ?? null, editorId: e.editorId ?? null, data: e.data ?? null,
  });
}

/* ═════════════════════════ PRAZO DO CLIENTE: SÓ COM ASSINATURA ═════════════════════════ */

/** Prazo mais cedo que dá para prometer a um job que fica pronto em `end`: + FOLGA, meia hora cheia, no expediente. */
export function safeDue(cal: Calendar, end: number, editorId?: number | null): number {
  let m = Math.ceil(consume(cal, end, FOLGA, editorId).end / 30) * 30;
  for (let g = 0; g < 2000 && !inShift(cal, m); g++) m += 30;
  return m;
}

/**
 * Muda o prazo do cliente com a assinatura de quem muda: fica no histórico do job (de → para, motivo, quem assinou)
 * e o editor e quem acompanha ficam sabendo. O prazo original fica guardado na primeira mudança.
 */
export async function signDue(r: TaskRow, due: number, actorId: number, why = "") {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId));
  const who = u?.name ?? "Gestor";
  const from = r.dueDate ? fmtLm(toLm(r.dueDate)) : "sem prazo";
  await db.update(tasksTable).set({ dueDate: fromLm(due), dueDateOriginal: r.dueDateOriginal ?? r.dueDate ?? null }).where(eq(tasksTable.id, r.id));
  await logEvent({ kind: "due_signed", taskId: r.id, actorId, coordId: r.createdById, editorId: r.assignedToId,
    text: `Prazo do cliente: ${from} → ${fmtLm(due)}.${why ? ` ${why}` : ""} Assinado por ${who}, que assume combinar o novo prazo com o cliente.`,
    data: { from: r.dueDate ? toLm(r.dueDate) : null, to: due } });
  if (r.assignedToId && r.assignedToId !== actorId) await notify(r.assignedToId, "due_date_changed", "Novo prazo", `Novo prazo de “${r.title}”: ${fmtLm(due)} (era ${from}), assinado por ${who}.`, { taskId: r.id });
  await notifyFollowers(r.id, [actorId, r.assignedToId], "due_date_changed", "Novo prazo", `O prazo de “${r.title}” passou de ${from} para ${fmtLm(due)}, assinado por ${who}.`);
}

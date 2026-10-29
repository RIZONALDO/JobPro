/**
 * Fila por horas de trabalho — o prazo de entrega anda com o trabalho.
 *
 * Regras:
 *  - Cada editor tem UMA fila, em ordem. O editor faz um job por vez, na ordem; só começa o 1º.
 *  - A ordem é dos gestores: qualquer gestor move qualquer job (arrastar), sem pedido de aprovação.
 *  - Job "em edição agora" (▶, `playing_since`) nunca sai da frente.
 *  - Cada job tem horas de trabalho (`est_minutes`). A PREVISÃO (`schedule`) é o fim das horas na ordem da fila,
 *    dentro do expediente do editor, + 1h de expediente (`BUFFER`): o 1º da fila conta a partir de quando virou o 1º
 *    (`head_since`, carimbado por `stampHeads`), tocando ou não em "Começar" (o Começar só acompanha e gera avisos);
 *    se as horas dele já acabaram e ele não saiu, vai até agora. Os outros vêm um depois do outro.
 *  - O PRAZO DE ENTREGA (`due_date`) é do gestor. Nasce da previsão quando o job entra na fila e só muda com ação de
 *    gestor (mover, horas, alteração do cliente, trocar de editor, feriado), e só o quanto essa ação mudou a previsão
 *    (`recalcDues` com o retrato de antes). Ação de editor (começar, enviar, travar) nunca mexe em prazo: se ele começa
 *    tarde, o atraso aparece (previsão passa do prazo), não vira prazo novo.
 *  - Atrasado = o prazo passou e o job não foi entregue.
 */
import { db, tasksTable, usersTable, holidaysTable, userAbsencesTable, queueEventsTable } from "@workspace/db";
import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import { notify } from "./notify.js";
import { type Calendar, type Absence, DAY, toLm, fromLm, dayKey, fmtLm, consume, shiftWork, workDelta } from "./workcal.js";
import { ABSENCE_LABEL } from "./availability.js";

export const QUEUE_STATUSES = ["pending", "in_progress", "in_revision", "reopened"];

export interface QTask {
  id: number;
  editorId: number | null;
  coordId: number | null;
  title: string;
  status: string;
  playing: boolean;         // em edição agora
  order: number;
  promised: number | null;  // prazo de entrega (minutos locais), calculado pelas horas
  hold: boolean;            // fora da fila (pedido antigo)
  est: number;              // horas de trabalho (minutos)
  since: number | null;     // em edição desde (minutos locais)
  headSince: number | null; // virou o 1º da fila em (minutos locais)
}

export const inQueue = (t: QTask) => t.editorId != null && !t.hold && QUEUE_STATUSES.includes(t.status);
/** Retrato da fila de um editor (ordem, em edição, horas): se mudou, os prazos dela são recalculados. */
export const queueSig = (ts: QTask[], ed: number) => queueOf(ts, ed).map(t => `${t.id}:${t.playing ? t.since : 0}:${t.est}`).join(",");
/** Editores cuja fila mudou entre dois momentos. */
export function changedQueues(a: QTask[], b: QTask[]): number[] {
  const eds = new Set([...a, ...b].filter(inQueue).map(t => t.editorId as number));
  return [...eds].filter(ed => queueSig(a, ed) !== queueSig(b, ed));
}

export function queueOf(ts: QTask[], ed: number): QTask[] {
  return ts.filter(t => inQueue(t) && t.editorId === ed)
    .sort((a, b) => (Number(b.playing) - Number(a.playing)) || a.order - b.order || a.id - b.id);
}
export const isLate = (t: { promised: number | null }, now: number) => t.promised != null && now > t.promised;

export const orderAt = (q: QTask[], k: number) =>
  !q.length ? 0 : k <= 0 ? q[0].order - 1 : k >= q.length ? q[q.length - 1].order + 1 : (q[k - 1].order + q[k].order) / 2;

/** Posição "na frente": o topo, ou logo depois do job em edição (que nunca é derrubado). */
export function frontPos(ts: QTask[], ed: number, excludeId?: number): { q: QTask[]; k: number; order: number } {
  const q = queueOf(ts, ed).filter(t => t.id !== excludeId);
  const k = q[0]?.playing ? 1 : 0;
  return { q, k, order: orderAt(q, k) };
}
/** Logo depois do job atual do editor (o 1º da fila). Usado ao destravar e na alteração do cliente. */
export function orderAfterHead(ts: QTask[], ed: number, excludeId?: number): number {
  const q = queueOf(ts, ed).filter(t => t.id !== excludeId);
  return orderAt(q, Math.min(1, q.length));
}
export const orderEnd = (ts: QTask[], ed: number, excludeId?: number) => {
  const q = queueOf(ts, ed).filter(t => t.id !== excludeId);
  return orderAt(q, q.length);
};

/** Margem entre o fim das horas de trabalho e o prazo de entrega (minutos de expediente). */
export const BUFFER = 60;

/**
 * Prazos da fila de um editor: cada job começa quando o anterior termina (o 1º, agora — ou quando começou, se em edição),
 * consome as horas dele no expediente do editor e o prazo é o fim + BUFFER.
 */
export function schedule(cal: Calendar, q: QTask[], now: number, ed: number): Map<number, { start: number; end: number; due: number }> {
  const out = new Map<number, { start: number; end: number; due: number }>();
  let cur = now;
  q.forEach((t, i) => {
    // o 1º conta de quando virou o 1º (clicar em Começar não move a conta); passou das horas e não saiu: vai até agora
    const from = i === 0 ? t.headSince ?? t.since ?? now : cur;
    const w = consume(cal, from, Math.max(0, t.est), ed);
    const end = i === 0 ? Math.max(w.end, now) : w.end;
    const due = consume(cal, end, BUFFER, ed).end;
    out.set(t.id, { start: w.start, end, due });
    cur = end;
  });
  return out;
}

/** Prazo perto disso (minutos) deixa um job travado crítico. */
const BLOCK_CRITICAL = 24 * 60;

/** Frase do prazo de um job travado, para os avisos. Crítico = prazo vencido ou vence em menos de 24h. */
export function blockRisk(promised: number | null, now: number): { text: string; critical: boolean } {
  if (promised == null) return { text: "", critical: false };
  if (promised <= now) return { text: ` O prazo já venceu (${fmtLm(promised)}).`, critical: true };
  return { text: ` Prazo ${fmtLm(promised)}.`, critical: promised - now < BLOCK_CRITICAL };
}

/* ═════════════════════════ BANCO ═════════════════════════ */

let holidayCache: { at: number; map: Map<string, string> } | null = null;
export function invalidateHolidays() { holidayCache = null; }

/** Feriados e ausências: o expediente de cada editor (horas de trabalho, quem está fora hoje, avisos do cron). */
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

export type TaskRow = typeof tasksTable.$inferSelect;

export function toQ(r: TaskRow): QTask {
  return {
    id: r.id, editorId: r.assignedToId, coordId: r.createdById, title: r.title, status: r.status,
    playing: !!r.playingSince, order: r.queueOrder, promised: r.dueDate ? toLm(r.dueDate) : null, hold: r.queueHold,
    est: r.estMinutes ?? 0, since: r.playingSince ? toLm(r.playingSince) : null,
    headSince: r.headSince ? toLm(r.headSince) : null,
  };
}

/** Tudo o que está aberto (fila, com o cliente, travado, sem editor, aguardando aprovação). */
export async function loadState() {
  const rows = await db.select().from(tasksTable)
    .where(notInArray(tasksTable.status, ["completed", "cancelled", "rascunho"]));
  const now = toLm(new Date());
  return { now, rows, tasks: rows.map(toQ) };
}
export type State = Awaited<ReturnType<typeof loadState>>;

/**
 * Carimba quando cada job virou o 1º da fila do editor (`head_since`) e limpa o de quem deixou de ser.
 * Chamado depois de mexer na fila e a cada minuto pelo relógio; devolve se mudou algo.
 */
export async function stampHeads(s?: State): Promise<boolean> {
  s ??= await loadState();
  const heads = new Set<number>();
  for (const ed of new Set(s.tasks.filter(inQueue).map(t => t.editorId as number))) heads.add(queueOf(s.tasks, ed)[0].id);
  const on = s.tasks.filter(t => heads.has(t.id) && t.headSince == null).map(t => t.id);
  const off = s.tasks.filter(t => !heads.has(t.id) && t.headSince != null).map(t => t.id);
  if (on.length) await db.update(tasksTable).set({ headSince: new Date() }).where(inArray(tasksTable.id, on));
  if (off.length) await db.update(tasksTable).set({ headSince: null }).where(inArray(tasksTable.id, off));
  return on.length + off.length > 0;
}

export async function userNames(): Promise<Map<number, { name: string; role: string; status: string }>> {
  const us = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, status: usersTable.status }).from(usersTable);
  return new Map(us.map(u => [u.id, { name: u.name, role: u.role, status: u.status }]));
}

export async function logEvent(e: { kind: string; taskId?: number | null; actorId?: number | null; text?: string; coordId?: number | null; editorId?: number | null; data?: Record<string, unknown> }) {
  await db.insert(queueEventsTable).values({
    kind: e.kind, taskId: e.taskId ?? null, actorId: e.actorId ?? null, text: e.text ?? null,
    coordId: e.coordId ?? null, editorId: e.editorId ?? null, data: e.data ?? null,
  });
}

/**
 * Recalcula o prazo de entrega de todos os jobs nas filas (depois de qualquer mudança na fila).
 * Grava só o que mudou, registra no histórico do job e avisa o gestor dono quando foi outra pessoa que mexeu.
 */
export async function recalcDues(
  actorId?: number | null,
  opts: { silent?: boolean; editors?: number[]; before?: QTask[]; calBefore?: Calendar } = {},
): Promise<number> {
  const users = await userNames();
  // o prazo é do gestor: ação de editor (começar, enviar, travar) não mexe em prazo nenhum
  if (actorId && users.get(actorId)?.role === "editor") return 0;
  const s = await loadState();
  // só as filas pedidas: o que acontece na fila de um editor não mexe nos prazos de outro
  const eds = [...new Set(s.tasks.filter(inQueue).map(t => t.editorId as number))].filter(e => !opts.editors || opts.editors.includes(e));
  if (!eds.length) return 0;
  const cal = await loadCalendar(eds);
  const names = actorId ? users.get(actorId)?.name : null;
  let n = 0;
  const byCoord = new Map<number, string[]>();
  for (const ed of eds) {
    const plan = schedule(cal, queueOf(s.tasks, ed), s.now, ed);
    // com o retrato de antes: o prazo anda só o quanto a ação do gestor mudou a previsão (atraso do editor fica de fora)
    const prev = opts.before ? schedule(opts.calBefore ?? cal, queueOf(opts.before, ed), s.now, ed) : null;
    for (const [id, p] of plan) {
      const t = s.tasks.find(x => x.id === id)!;
      const o = prev?.get(id);
      const due = o && t.promised != null ? shiftWork(cal, t.promised, workDelta(cal, o.due, p.due, ed), ed) : p.due;
      if (t.promised === due) continue;
      await db.update(tasksTable).set({ dueDate: fromLm(due) }).where(eq(tasksTable.id, id));
      n++;
      const from = t.promised != null ? fmtLm(t.promised) : "sem prazo";
      await logEvent({ kind: "due_auto", taskId: id, actorId: actorId ?? null, coordId: t.coordId, editorId: ed, text: `Prazo recalculado pela fila: ${from} → ${fmtLm(due)}`, data: { from: t.promised, to: due } });
      // avisa só mudança que conta (15 min ou mais), feita por outra pessoa, num aviso por gestor
      if (!opts.silent && t.coordId && t.coordId !== actorId && (t.promised == null || Math.abs(due - t.promised) >= 15)) {
        const l = byCoord.get(t.coordId) ?? [];
        l.push(`“${t.title}” ${from} → ${fmtLm(due)}`);
        byCoord.set(t.coordId, l);
      }
    }
  }
  for (const [c, l] of byCoord) {
    await notify(c, "due_date_changed", l.length > 1 ? "Prazos recalculados" : "Prazo recalculado",
      `A fila mudou${names ? ` (${names})` : ""}. ${l.length > 1 ? "Novos prazos: " : "Novo prazo: "}${l.join("; ")}.`);
  }
  return n;
}

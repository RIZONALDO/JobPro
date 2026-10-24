/**
 * Relógio da fila (roda a cada minuto). Só avisa no horário comercial (seg–sáb, sem feriado):
 *  - prazo de entrega venceu e o job não foi entregue → avisa o gestor dono e o editor (uma vez);
 *  - job travado: o prazo continua correndo. Lembra o responsável a cada 2h parado e avisa a supervisão
 *    uma vez quando o prazo vence ou fica a menos de 24h.
 */
import { db, usersTable, queueRequestsTable, queueEventsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { notify, notifyFollowers } from "./notify.js";
import { broadcastTaskChange } from "./broadcast.js";
import { logger } from "./logger.js";
import { loadState, loadCalendar, logEvent, isLate, blockRisk, recalcDues, QUEUE_STATUSES } from "./queue.js";
import { isWorking, toLm, fmtLm } from "./workcal.js";

const BLOCK_REMIND = 120;

const ago = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);

async function tick() {
  const s = await loadState();
  if (!isWorking(await loadCalendar([]), s.now)) return;
  let changed = false;
  const names = new Map((await db.select({ id: usersTable.id, name: usersTable.name, status: usersTable.status }).from(usersTable)).map(u => [u.id, u]));
  const sups = (await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(inArray(usersTable.role, ["admin", "supervisor"]), eq(usersTable.status, "active")))).map(u => u.id);

  // 1. prazo vencido (uma vez por prazo: se o prazo mudar e vencer de novo, avisa de novo)
  const late = s.tasks.filter(t => t.editorId && QUEUE_STATUSES.includes(t.status) && !t.hold && isLate(t, s.now));
  if (late.length) {
    const evs = await db.select({ taskId: queueEventsTable.taskId, data: queueEventsTable.data }).from(queueEventsTable)
      .where(and(inArray(queueEventsTable.taskId, late.map(t => t.id)), eq(queueEventsTable.kind, "due_passed")));
    for (const t of late) {
      if (evs.some(e => e.taskId === t.id && (e.data as { due?: number } | null)?.due === t.promised)) continue;
      const ed = names.get(t.editorId!)?.name ?? "o editor";
      const text = `O prazo de “${t.title}” venceu (${fmtLm(t.promised!)}) e o job ainda está na fila de ${ed}.`;
      if (t.coordId) await notify(t.coordId, "due_passed", "Prazo vencido", `${text} Ajuste as horas de trabalho, mova na fila ou passe para outro editor.`, { taskId: t.id });
      await notify(t.editorId!, "due_passed", "Prazo vencido", `O prazo de “${t.title}” venceu (${fmtLm(t.promised!)}).`, { taskId: t.id });
      await notifyFollowers(t.id, [t.coordId, t.editorId], "due_passed", "Prazo vencido", text);
      await logEvent({ kind: "due_passed", taskId: t.id, coordId: t.coordId, editorId: t.editorId, text: `Prazo vencido (${fmtLm(t.promised!)})`, data: { due: t.promised } });
      changed = true;
    }
  }

  // 2. job travado: o prazo não para
  const paused = s.rows.filter(r => r.status === "paused");
  if (paused.length) {
    const evs = await db.select().from(queueEventsTable)
      .where(and(inArray(queueEventsTable.taskId, paused.map(r => r.id)), inArray(queueEventsTable.kind, ["blocked", "blocked_alert"])))
      .orderBy(desc(queueEventsTable.createdAt));
    for (const r of paused) {
      const blk = evs.find(e => e.taskId === r.id && e.kind === "blocked");
      if (!blk) continue;
      const alerts = evs.filter(e => e.taskId === r.id && e.kind === "blocked_alert" && e.createdAt >= blk.createdAt);
      const stopped = s.now - toLm(blk.createdAt);
      const sinceLast = s.now - toLm(alerts[0]?.createdAt ?? blk.createdAt);
      const risk = blockRisk(r.dueDate ? toLm(r.dueDate) : null, s.now);
      const supsKnew = alerts.some(a => (a.data as { sups?: boolean } | null)?.sups);
      // a supervisão entra uma vez: quando o prazo fica em risco
      const toSups = risk.critical && !supsKnew;
      if (!toSups && sinceLast < BLOCK_REMIND) continue;
      const ed = names.get(r.assignedToId ?? 0)?.name ?? "o editor";
      const text = `“${r.title}” está travado há ${ago(stopped)} (${ed}: ${blk.text ?? "sem motivo"}).${risk.text}`;
      if (r.createdById) await notify(r.createdById, "queue_blocked", risk.critical ? "Job travado: prazo em risco" : "Job ainda travado",
        `${text} Destrave, passe para outro editor ou combine novo prazo com o cliente.`, { taskId: r.id });
      await notifyFollowers(r.id, [r.createdById], "queue_blocked", "Job ainda travado", text);
      if (toSups) for (const sp of sups) await notify(sp, "queue_escalated", "Job travado: prazo em risco",
        `${text} Responsável: ${names.get(r.createdById ?? 0)?.name ?? "—"}.`, { taskId: r.id });
      await logEvent({ kind: "blocked_alert", taskId: r.id, coordId: r.createdById, editorId: r.assignedToId,
        text: `Travado há ${ago(stopped)}${risk.critical ? ": prazo em risco" : ""}`, data: { sups: toSups || supsKnew, critical: risk.critical } });
      changed = true;
    }
  }

  if (changed) broadcastTaskChange();
}

/**
 * Uma vez, ao trocar para a fila por horas: os pedidos de aprovação pendentes são cancelados (mover é livre) e
 * os prazos de todas as filas são recalculados pelas horas de trabalho, na ordem atual. Marca `queue_by_hours`.
 */
async function queueByHours() {
  const [flag] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "queue_by_hours"));
  if (flag?.value === "done") return;
  await db.update(queueRequestsTable).set({ status: "cancelado", decidedAt: new Date() }).where(eq(queueRequestsTable.status, "pendente"));
  const n = await recalcDues(null, { silent: true });
  await db.insert(appSettingsTable).values({ key: "queue_by_hours", value: "done" }).onConflictDoUpdate({ target: appSettingsTable.key, set: { value: "done" } });
  logger.info({ n }, "fila por horas: prazos recalculados");
  broadcastTaskChange();
}

export function startQueueCron() {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    queueByHours().then(tick).catch(err => logger.error({ err }, "queue tick")).finally(() => { running = false; });
  };
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
}

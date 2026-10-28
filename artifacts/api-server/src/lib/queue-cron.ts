/**
 * Relógio da fila (roda a cada minuto). Só avisa no horário comercial (seg–sáb, sem feriado):
 *  - prazo de entrega venceu e o job não foi entregue → avisa o gestor dono e o editor (uma vez);
 *  - job travado: o prazo continua correndo. Lembra o responsável a cada 2h parado e avisa a supervisão
 *    uma vez quando o prazo vence ou fica a menos de 24h;
 *  - editor no expediente, com fila e sem job em edição há 30 min → lembra o editor de começar (uma vez por job/dia);
 *  - previsão passou do prazo (o âmbar da Agenda) → avisa o gestor dono enquanto ainda dá para agir (uma vez por prazo).
 */
import { db, usersTable, queueRequestsTable, queueEventsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { notify, notifyFollowers } from "./notify.js";
import { broadcastTaskChange } from "./broadcast.js";
import { logger } from "./logger.js";
import { loadState, loadCalendar, logEvent, isLate, blockRisk, recalcDues, queueOf, schedule, QUEUE_STATUSES } from "./queue.js";
import { DAY, isWorking, periods, workBetween, toLm, fmtLm } from "./workcal.js";

const BLOCK_REMIND = 120;
/** minutos de expediente sem job em edição até lembrar o editor */
const IDLE_NUDGE = 30;
/** previsão passando do prazo por isso (min) = job em risco, igual ao âmbar da Agenda */
const RISK_SLIP = 15;
/** eventos que são o relógio falando, não alguém mexendo na fila do editor */
const CLOCK_KINDS = ["due_auto", "due_passed", "due_risk", "idle_nudge", "blocked_alert"];

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

  // 3. editor parado: tem fila, está no expediente e nada em edição há IDLE_NUDGE min
  const eds = [...new Set(s.tasks.filter(t => t.editorId && QUEUE_STATUSES.includes(t.status) && !t.hold).map(t => t.editorId as number))];
  const cal = await loadCalendar(eds);
  const day = Math.floor(s.now / DAY);
  if (eds.length) {
    const evs = await db.select({ kind: queueEventsTable.kind, editorId: queueEventsTable.editorId, taskId: queueEventsTable.taskId, data: queueEventsTable.data, createdAt: queueEventsTable.createdAt })
      .from(queueEventsTable).where(and(inArray(queueEventsTable.editorId, eds), gte(queueEventsTable.createdAt, new Date(Date.now() - 3 * 86_400_000))))
      .orderBy(desc(queueEventsTable.createdAt));
    for (const ed of eds) {
      const q = queueOf(s.tasks, ed);
      if (!q.length || q[0].playing || !isWorking(cal, s.now, ed) || names.get(ed)?.status !== "active") continue;
      const head = q[0];
      if (evs.some(e => e.kind === "idle_nudge" && e.editorId === ed && e.taskId === head.id && (e.data as { day?: number } | null)?.day === day)) continue;
      // parado desde: a última mexida na fila dele (começou, enviou, travou, job novo, moveram…) ou o início do expediente de hoje
      const last = evs.find(e => e.editorId === ed && !CLOCK_KINDS.includes(e.kind));
      const dayStart = day * DAY + (periods(cal, day, ed)[0]?.[0] ?? 0);
      const idle = workBetween(cal, Math.max(dayStart, last ? toLm(last.createdAt) : dayStart), s.now, ed);
      if (idle < IDLE_NUDGE) continue;
      await notify(ed, "queue_idle", "Você ainda não começou", `Seu próximo job é “${head.title}” (prazo ${head.promised != null ? fmtLm(head.promised) : "sem prazo"}). Toque em Começar quando pegar nele.`, { taskId: head.id });
      await logEvent({ kind: "idle_nudge", taskId: head.id, coordId: head.coordId, editorId: ed, text: `Sem job em edição há ${ago(idle)}: lembrete para começar`, data: { day } });
      changed = true;
    }

    // 4. job em risco: a previsão já passa do prazo, avisa o gestor antes de vencer (uma vez por prazo)
    const risky: { t: typeof s.tasks[number]; due: number; why: string }[] = [];
    for (const ed of eds) {
      const q = queueOf(s.tasks, ed), plan = schedule(cal, q, s.now, ed);
      const edName = names.get(ed)?.name ?? "o editor";
      const head = q[0], headOver = head?.playing && (plan.get(head.id)?.end ?? Infinity) <= s.now;
      for (const t of q) {
        const p = plan.get(t.id)!;
        if (t.promised == null || isLate(t, s.now) || p.due - t.promised < RISK_SLIP) continue;
        if (evs.some(e => e.kind === "due_risk" && e.taskId === t.id && (e.data as { due?: number } | null)?.due === t.promised)) continue;
        const why = !head.playing ? `${edName} ainda não começou${t.id === head.id ? "" : " a fila"}.`
          : headOver ? `O job em edição de ${edName} já passou das horas de trabalho.`
          : t.id === head.id ? `${edName} começou tarde.` : `Os jobs na frente, na fila de ${edName}, não cabem antes.`;
        risky.push({ t, due: p.due, why });
      }
    }
    // um aviso por gestor e editor (o motivo é da fila daquele editor)
    const groups = new Map<string, typeof risky>();
    for (const r of risky) if (r.t.coordId) { const k = `${r.t.coordId}:${r.t.editorId}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    for (const [k, l] of groups) {
      const c = Number(k.split(":")[0]);
      const one = l.length === 1, a = l[0];
      await notify(c, "due_risk", one ? "Job em risco" : `${l.length} jobs em risco`,
        one ? `“${a.t.title}” não cabe no prazo (${fmtLm(a.t.promised!)}): pela conta de agora fica para ${fmtLm(a.due)}. ${a.why} Cobre o editor, passe para outro ou ajuste o prazo.`
          : `Pela conta de agora não cabem no prazo: ${l.map(r => `“${r.t.title}” (${fmtLm(r.t.promised!)} → ${fmtLm(r.due)})`).join("; ")}. ${a.why} Cobre o editor, passe para outro ou ajuste o prazo.`,
        { taskId: a.t.id });
    }
    for (const r of risky) {
      await logEvent({ kind: "due_risk", taskId: r.t.id, coordId: r.t.coordId, editorId: r.t.editorId, text: `Em risco: prazo ${fmtLm(r.t.promised!)}, previsão ${fmtLm(r.due)}. ${r.why}`, data: { due: r.t.promised, forecast: r.due } });
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

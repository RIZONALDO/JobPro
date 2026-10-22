/**
 * Relógio da fila (roda a cada minuto):
 *  - horas estimadas acabaram e o job não foi entregue → avisa editor e coordenador (reserva de 1h);
 *  - editor com job na fila e sem ▶ há 30 min de expediente → avisa o coordenador do próximo job;
 *  - pedido sem resposta há 30 min de expediente → vai para a supervisão;
 *  - job travado: o prazo continua correndo. Lembra o responsável a cada 2h de expediente parado e avisa
 *    a supervisão quando o prazo entra em risco (já atrasa ou sobra menos de 4h de folga se destravar agora).
 *  - job que passa a atrasar: o gestor dono recebe "assine o novo prazo" (uma vez, até assinar ou o atraso sumir);
 *  - fim do expediente: ▶ ligado pausa sozinho. A empresa não faz hora extra; sem isso o ▶ esquecido voltaria a
 *    contar às 08:30 e somaria horas que ninguém trabalhou.
 * Nada é avisado fora do expediente.
 */
import { db, tasksTable, usersTable, queueRequestsTable, queueEventsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { notify, notifyFollowers } from "./notify.js";
import { broadcastTaskChange } from "./broadcast.js";
import { logger } from "./logger.js";
import { loadState, schedule, queueOf, logEvent, unblockForecast, blockRisk, accrue, safeDue, QUEUE_STATUSES } from "./queue.js";
import { DAY, periods, workBetween, isWorking, inDayWindow, toLm, fmtH, fmtLm } from "./workcal.js";

const IDLE_ALERT = 30;
const ESCALATE_AFTER = 30;
const BLOCK_REMIND = 120;

async function tick() {
  let s = await loadState();
  let changed = false;
  const names = new Map((await db.select({ id: usersTable.id, name: usersTable.name, idleSince: usersTable.idleSince, idleAlertedAt: usersTable.idleAlertedAt, status: usersTable.status }).from(usersTable)).map(u => [u.id, u]));

  // 0. fim do expediente: pausa (de manhã o editor toca em Começar)
  for (const r of s.rows) {
    if (!r.playingSince || inDayWindow(s.cal, s.now, r.assignedToId)) continue;
    await db.update(tasksTable).set(accrue(s.cal, r, s.now)).where(eq(tasksTable.id, r.id));
    if (r.assignedToId) await db.update(usersTable).set({ idleSince: new Date() }).where(eq(usersTable.id, r.assignedToId));
    await logEvent({ kind: "pause", taskId: r.id, coordId: r.createdById, editorId: r.assignedToId, text: "Pausa automática: fim do expediente" });
    changed = true;
  }
  if (changed) s = await loadState();

  // 1. estimativa vencida
  for (const r of s.rows) {
    if (!r.playingSince || r.estExpiredAt) continue;
    const t = s.tasks.find(x => x.id === r.id)!;
    if (t.worked < r.estMinutes) continue;
    await db.update(tasksTable).set({ estExpiredAt: new Date() }).where(eq(tasksTable.id, r.id));
    const ed = names.get(r.assignedToId ?? 0)?.name ?? "Editor";
    const owner = r.estOwnerId ? names.get(r.estOwnerId)?.name : null;
    if (r.assignedToId) await notify(r.assignedToId, "queue_est_expired", "Horas estimadas acabaram",
      `As horas estimadas de “${r.title}” acabaram. Entregue ou diga quanto falta. Até lá o sistema reserva +1h.`, { taskId: r.id });
    if (r.createdById) await notify(r.createdById, "queue_est_expired", "Horas estimadas acabaram",
      `As horas estimadas de “${r.title}” acabaram e o job não foi entregue (${ed})${owner ? `. Estimativa usada: a de ${owner}` : ""}.`, { taskId: r.id });
    await notifyFollowers(r.id, [r.createdById, r.assignedToId], "queue_est_expired", "Horas estimadas acabaram", `As horas estimadas de “${r.title}” acabaram e o job ainda não foi entregue (${ed}).`);
    await logEvent({ kind: "est_expired", taskId: r.id, coordId: r.createdById, editorId: r.assignedToId, text: `Estimativa de ${fmtH(r.estMinutes)} acabou` });
    changed = true;
  }

  // 2. lembrete: próximo job ainda não iniciado (fala do job, não da pessoa)
  const sch = schedule(s.cal, s.tasks, s.now);
  const eds = [...new Set(s.tasks.filter(t => t.editorId).map(t => t.editorId as number))];
  const today = Math.floor(s.now / DAY);
  for (const ed of eds) {
    const u = names.get(ed);
    if (!u || u.status !== "active" || !isWorking(s.cal, s.now, ed)) continue;
    const qq = queueOf(s.tasks, ed);
    if (!qq.length || qq.some(t => t.playing)) continue;
    const ps = periods(s.cal, today, ed);
    const from = Math.max(today * DAY + ps[0][0], u.idleSince ? toLm(u.idleSince) : -Infinity);
    if (u.idleAlertedAt && toLm(u.idleAlertedAt) >= from) continue;
    const idle = workBetween(s.cal, from, s.now, ed);
    if (idle < IDLE_ALERT) continue;
    const head = qq.find(t => sch.get(t.id)?.pos === 0);
    if (!head) continue;
    // job travado por data ainda não pode começar: não precisa de lembrete
    if (head.notBefore != null && head.notBefore > s.now) continue;
    await db.update(usersTable).set({ idleAlertedAt: new Date() }).where(eq(usersTable.id, ed));
    if (head.coordId) await notify(head.coordId, "queue_idle", "Job aguardando início",
      `“${head.title}” é o próximo de ${u.name.split(" ")[0]} e ainda não foi iniciado. A previsão de entrega considera o início a partir de agora.`, { taskId: head.id });
    await notify(ed, "queue_idle", "Lembrete da fila",
      `Seu próximo job é “${head.title}”. Quando começar, toque em “Começar” para as horas contarem certo.`, { taskId: head.id });
    await logEvent({ kind: "idle_alert", taskId: head.id, coordId: head.coordId, editorId: ed, text: `“${head.title}” aguardando início` });
    changed = true;
  }

  // 2b. vai atrasar: o prazo do cliente precisa de um novo, assinado pelo gestor dono
  if (isWorking(s.cal, s.now)) {
    const late = s.tasks.filter(t => t.editorId && t.coordId && t.promised != null && QUEUE_STATUSES.includes(t.status) && !t.hold && sch.get(t.id)?.late);
    if (late.length) {
      const evs = await db.select({ taskId: queueEventsTable.taskId, kind: queueEventsTable.kind }).from(queueEventsTable)
        .where(and(inArray(queueEventsTable.taskId, late.map(t => t.id)), inArray(queueEventsTable.kind, ["due_sign_needed", "due_signed"])))
        .orderBy(desc(queueEventsTable.createdAt));
      for (const t of late) {
        if (evs.find(e => e.taskId === t.id)?.kind === "due_sign_needed") continue; // já avisado e ainda não assinado
        const sl = sch.get(t.id)!, min = safeDue(s.cal, sl.end, t.editorId);
        const text = `“${t.title}” vai atrasar ${fmtH(sl.lateBy)}: pela fila fica pronto ${fmtLm(sl.end)} e o prazo é ${fmtLm(t.promised!)}. Assine o novo prazo (a partir de ${fmtLm(min)}) ou passe para outro editor.`;
        await notify(t.coordId!, "due_sign_needed", "Assine o novo prazo", text, { taskId: t.id });
        await logEvent({ kind: "due_sign_needed", taskId: t.id, coordId: t.coordId, editorId: t.editorId, text: `Vai atrasar ${fmtH(sl.lateBy)}: novo prazo a assinar (a partir de ${fmtLm(min)})` });
        changed = true;
      }
    }
  }

  // 3. pedido sem resposta
  if (isWorking(s.cal, s.now)) {
    const reqs = await db.select().from(queueRequestsTable).where(and(eq(queueRequestsTable.status, "pendente"), eq(queueRequestsTable.escalated, false)));
    if (reqs.length) {
      const sups = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(inArray(usersTable.role, ["admin", "supervisor"]), eq(usersTable.status, "active")));
      for (const r of reqs) {
        if (workBetween(s.cal, toLm(r.createdAt), s.now) < ESCALATE_AFTER) continue;
        await db.update(queueRequestsTable).set({ escalated: true }).where(eq(queueRequestsTable.id, r.id));
        const t = s.rows.find(x => x.id === r.taskId);
        const who = names.get(r.requestedById)?.name, ap = names.get(r.approverId ?? 0)?.name;
        if (r.approverId) await notify(r.approverId, "queue_escalated", "Pedido sem resposta",
          `O pedido sobre “${t?.title}” está sem resposta há 30 min e foi para a supervisão.`, { taskId: r.taskId });
        for (const sp of sups) await notify(sp.id, "queue_escalated", "Pedido sem resposta",
          `Pedido de ${who} sobre “${t?.title}” (fila de ${names.get(r.editorId)?.name}) está sem resposta de ${ap} há 30 min. Você pode decidir.`, { taskId: r.taskId });
        changed = true;
      }
    }
  }
  // 4. job travado: o prazo não para
  const paused = s.rows.filter(r => r.status === "paused");
  if (paused.length && isWorking(s.cal, s.now)) {
    const evs = await db.select().from(queueEventsTable)
      .where(and(inArray(queueEventsTable.taskId, paused.map(r => r.id)), inArray(queueEventsTable.kind, ["blocked", "blocked_alert"])))
      .orderBy(desc(queueEventsTable.createdAt));
    const sups = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(inArray(usersTable.role, ["admin", "supervisor"]), eq(usersTable.status, "active")));
    for (const r of paused) {
      const blk = evs.find(e => e.taskId === r.id && e.kind === "blocked");
      if (!blk) continue;
      const alerts = evs.filter(e => e.taskId === r.id && e.kind === "blocked_alert" && e.createdAt >= blk.createdAt);
      const stopped = workBetween(s.cal, toLm(blk.createdAt), s.now, r.assignedToId);
      const sinceLast = workBetween(s.cal, alerts[0] ? toLm(alerts[0].createdAt) : toLm(blk.createdAt), s.now, r.assignedToId);
      const risk = blockRisk(r.dueDate ? toLm(r.dueDate) : null, s.now, unblockForecast(s.cal, s.tasks, s.now, r.id));
      const supsKnew = alerts.some(a => (a.data as { sups?: boolean } | null)?.sups);
      // a supervisão entra uma vez: quando o prazo fica em risco
      const toSups = risk.critical && !supsKnew;
      if (!toSups && sinceLast < BLOCK_REMIND) continue;
      const ed = names.get(r.assignedToId ?? 0)?.name ?? "o editor";
      const text = `“${r.title}” está travado há ${fmtH(stopped)} (${ed}: ${blk.text ?? "sem motivo"}).${risk.text}`;
      if (r.createdById) await notify(r.createdById, "queue_blocked", risk.critical ? "Job travado: prazo em risco" : "Job ainda travado",
        `${text} Destrave, passe para outro editor ou renegocie o prazo.`, { taskId: r.id });
      await notifyFollowers(r.id, [r.createdById], "queue_blocked", "Job ainda travado", text);
      if (toSups) for (const sp of sups) await notify(sp.id, "queue_escalated", "Job travado: prazo em risco",
        `${text} Responsável: ${names.get(r.createdById ?? 0)?.name ?? "—"}.`, { taskId: r.id });
      await logEvent({ kind: "blocked_alert", taskId: r.id, coordId: r.createdById, editorId: r.assignedToId,
        text: `Travado há ${fmtH(stopped)}${risk.critical ? ": prazo em risco" : ""}`, data: { sups: toSups || supsKnew, critical: risk.critical } });
      changed = true;
    }
  }

  if (changed) broadcastTaskChange();
}

/**
 * Uma vez, logo depois da migração do sistema antigo (init-fila.sql marca `legacy_est_fit = pending`):
 * as horas vieram da complexidade (3h/6h/12h), um chute. Elas não podem empurrar para além do prazo um job
 * que a coordenação já tinha combinado: a estimativa encolhe até caber no prazo (mínimo 30 min a mais do
 * que já foi feito) e fica "a confirmar" para o editor dizer as horas reais.
 */
async function fitLegacyEstimates() {
  const [flag] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "legacy_est_fit"));
  if (flag?.value !== "pending") return;
  const s = await loadState();
  for (const r of s.rows) {
    if (!QUEUE_STATUSES.includes(r.status) || r.estCoordMinutes != null || r.estEditorMinutes != null) continue;
    const t = s.tasks.find(x => x.id === r.id)!;
    const set: Partial<typeof r> = { estConfirmed: false };
    if (t.promised != null) {
      const from = Math.max(s.now, t.notBefore ?? 0);
      const fits = t.worked + (t.promised > from ? workBetween(s.cal, from, t.promised, r.assignedToId) : 0);
      if (r.estMinutes > fits) set.estMinutes = Math.max(fits, t.worked + 30);
    }
    await db.update(tasksTable).set(set).where(eq(tasksTable.id, r.id));
  }
  await db.update(appSettingsTable).set({ value: "done" }).where(eq(appSettingsTable.key, "legacy_est_fit"));
  logger.info("estimativas do sistema antigo ajustadas ao prazo");
}

export function startQueueCron() {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    fitLegacyEstimates().then(tick).catch(err => logger.error({ err }, "queue tick")).finally(() => { running = false; });
  };
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
}

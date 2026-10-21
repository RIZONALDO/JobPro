/**
 * Relatórios (análise). Um registro por job com o ciclo de vida já calculado; o front faz período,
 * comparação com o período anterior, recortes, gráficos e drill-down em cima disso (são centenas de jobs).
 *
 * Tempos em minutos de expediente (calendário da empresa: CLT, feriados), não em horas de relógio.
 * Fases: na fila (pending) · em edição (in_progress, in_revision, reopened) · travado (paused) · com o cliente (review).
 */
import { Router } from "express";
import { db, tasksTable, usersTable, taskEventsTable, queueEventsTable, queueRequestsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, ne, or, notInArray } from "drizzle-orm";
import { requireCoordinator } from "../lib/auth.js";
import { loadCalendar } from "../lib/queue.js";
import { workBetween, toLm } from "../lib/workcal.js";

const router = Router();

const STAGE: Record<string, "fila" | "edicao" | "travado" | "cliente"> = {
  pending: "fila", in_progress: "edicao", in_revision: "edicao", reopened: "edicao", paused: "travado", review: "cliente",
};
const code = (n: number, y: number) => `${String(n ?? 0).padStart(3, "0")}.${String(y ?? 0).padStart(2, "0")}`;

router.get("/reports/analytics", requireCoordinator, async (req, res): Promise<void> => {
  const me = req.session.userId!, role = req.session.userRole!;
  // até ~13 meses: cobre "este ano" e a comparação com o período anterior
  const since = new Date(Date.now() - 400 * 86_400_000);
  const conds = [
    ne(tasksTable.status, "rascunho"),
    or(gte(tasksTable.createdAt, since), notInArray(tasksTable.status, ["completed", "cancelled"])),
  ];
  // gestor vê os jobs dele; supervisão e admin veem todos
  if (role === "coordinator") conds.push(eq(tasksTable.createdById, me));
  const all = await db.select().from(tasksTable).where(and(...conds));
  // job travado que ficou para trás e foi encerrado ("archived") não entra: não é entrega nem atraso deste período
  const archived = all.length ? new Set((await db.select({ taskId: queueEventsTable.taskId }).from(queueEventsTable)
    .where(and(inArray(queueEventsTable.taskId, all.map(r => r.id)), eq(queueEventsTable.kind, "archived")))).map(e => e.taskId)) : new Set<number | null>();
  const rows = all.filter(r => !archived.has(r.id));
  const ids = rows.map(r => r.id);

  const evs = ids.length ? await db.select().from(taskEventsTable).where(inArray(taskEventsTable.taskId, ids)).orderBy(asc(taskEventsTable.createdAt)) : [];
  const qevs = ids.length ? await db.select({ taskId: queueEventsTable.taskId, kind: queueEventsTable.kind, text: queueEventsTable.text })
    .from(queueEventsTable)
    .where(and(inArray(queueEventsTable.taskId, ids), inArray(queueEventsTable.kind, ["blocked", "reneg", "reassign", "furou", "client_change", "est_contest", "est_expired"]))) : [];
  const cal = await loadCalendar();
  const now = toLm(new Date());

  const jobs = rows.map(r => {
    const tev = evs.filter(e => e.taskId === r.id);
    const created = toLm(r.createdAt);
    const stage = { fila: 0, edicao: 0, travado: 0, cliente: 0 };
    // percorre as transições: cada trecho soma na fase em que o job estava
    let cur = tev[0]?.fromStatus && tev[0].fromStatus !== "rascunho" ? tev[0].fromStatus : "pending";
    let at = tev[0]?.fromStatus === "rascunho" ? toLm(tev[0].createdAt) : created;
    for (const e of tev) {
      const t = toLm(e.createdAt);
      const k = STAGE[cur];
      if (k && t > at) stage[k] += workBetween(cal, at, t);
      cur = e.toStatus; at = Math.max(at, t);
    }
    if (STAGE[cur] && now > at && !["completed", "cancelled"].includes(r.status)) stage[STAGE[cur]] += workBetween(cal, at, now);

    const first = (s: string) => { const e = tev.find(x => x.toStatus === s); return e ? toLm(e.createdAt) : null; };
    const last = (s: string) => { const e = [...tev].reverse().find(x => x.toStatus === s); return e ? toLm(e.createdAt) : null; };
    const firstReview = first("review");
    const closedAt = r.status === "completed" ? last("completed") : null;
    const q = qevs.filter(e => e.taskId === r.id);
    const n = (k: string) => q.filter(e => e.kind === k).length;
    return {
      id: r.id, code: code(r.taskNumber, r.taskYear), title: r.title, client: r.client, status: r.status,
      editorId: r.assignedToId, coordId: r.createdById,
      created, firstStart: first("in_progress"), firstReview, closedAt, cancelledAt: r.status === "cancelled" ? last("cancelled") : null,
      due: r.dueDate ? toLm(r.dueDate) : null, dueOriginal: r.dueDateOriginal ? toLm(r.dueDateOriginal) : r.dueDate ? toLm(r.dueDate) : null,
      est: r.estMinutes, worked: r.workedMinutes, estCoord: r.estCoordMinutes, estEditor: r.estEditorMinutes,
      revisions: r.revisionCount ?? 0,
      // tempo até a 1ª versão e até a aprovação, em expediente
      leadFirst: firstReview != null ? workBetween(cal, created, firstReview) : null,
      leadClose: closedAt != null ? workBetween(cal, created, closedAt) : null,
      stage,
      blocks: n("blocked"), blockReasons: q.filter(e => e.kind === "blocked" && e.text).map(e => e.text!),
      reneg: n("reneg"), reassign: n("reassign"), furou: n("furou"), clientChanges: n("client_change"),
      estContest: n("est_contest"), estExpired: n("est_expired"),
    };
  });

  /* ── desempenho de quem decide (gestores e supervisão): quanto tempo cada coisa esperou por uma resposta ── */
  const allQ = ids.length ? await db.select().from(queueEventsTable).where(and(inArray(queueEventsTable.taskId, ids), gte(queueEventsTable.createdAt, since))).orderBy(asc(queueEventsTable.createdAt)) : [];
  // job concluído ou cancelado encerra o que estava esperando resposta nele
  const finished = new Map(rows.filter(r => ["completed", "cancelled"].includes(r.status)).map(r => [r.id, [...evs].reverse().find(e => e.taskId === r.id && ["completed", "cancelled"].includes(e.toStatus))?.createdAt ?? r.updatedAt]));
  const wait = (a: Date, b: Date | null) => workBetween(cal, toLm(a), b ? toLm(b) : now);
  const close = <T extends { taskId: number | null; open: boolean }>(x: T, at: Date): T & { wait: number } => {
    const f = x.open && x.taskId != null ? finished.get(x.taskId) : undefined;
    return { ...x, open: x.open && !f, wait: wait(at, x.open ? f ?? null : null) } as T & { wait: number };
  };
  // travado → destravado (ou passado para outro editor / saiu de "travado")
  const blocks = allQ.filter(e => e.kind === "blocked").map(e => {
    const after = allQ.find(x => x.taskId === e.taskId && x.createdAt > e.createdAt && ["unblocked", "reassign", "assign", "cancelled"].includes(x.kind));
    const st = evs.find(x => x.taskId === e.taskId && x.createdAt > e.createdAt && x.fromStatus === "paused");
    const end = [after?.createdAt, st?.createdAt].filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0] ?? null;
    const x = { taskId: e.taskId, coordId: e.coordId, at: toLm(e.createdAt), resolvedBy: end ? (after && +after.createdAt === +end ? after.actorId : st?.changedById ?? null) : null, open: !end };
    return end ? { ...x, wait: wait(e.createdAt, end) } : close(x, e.createdAt);
  });
  // estimativa contestada pelo editor → gestor decide (manter a dele ou usar a do editor)
  const disputes = allQ.filter(e => e.kind === "est_contest").map(e => {
    const end = allQ.find(x => x.taskId === e.taskId && x.createdAt > e.createdAt && ["est_keep", "est_use"].includes(x.kind));
    const x = { taskId: e.taskId, coordId: e.coordId, at: toLm(e.createdAt), resolvedBy: end?.actorId ?? null, open: !end };
    return end ? { ...x, wait: wait(e.createdAt, end.createdAt) } : close(x, e.createdAt);
  });
  // job mandado para a supervisão sem editor → alguém atribui
  const noEditor = allQ.filter(e => e.kind === "assign" && (e.text ?? "").startsWith("Sem editor")).map(e => {
    const end = allQ.find(x => x.taskId === e.taskId && x.createdAt > e.createdAt && x.kind === "assign" && x.editorId != null);
    const x = { taskId: e.taskId, coordId: e.coordId, at: toLm(e.createdAt), resolvedBy: end?.actorId ?? null, open: !end };
    return end ? { ...x, wait: wait(e.createdAt, end.createdAt) } : close(x, e.createdAt);
  });
  // pedidos (prioridade, troca, editor pede para fazer antes, troca de editor)
  const reqRows = ids.length ? await db.select().from(queueRequestsTable).where(and(inArray(queueRequestsTable.taskId, ids), gte(queueRequestsTable.createdAt, since))) : [];
  const requests = reqRows.map(r => ({
    id: r.id, kind: r.kind, taskId: r.taskId, requestedById: r.requestedById, approverId: r.approverId, decidedById: r.decidedById,
    status: r.status, escalated: r.escalated, at: toLm(r.createdAt), open: r.status === "pendente",
    wait: wait(r.createdAt, r.status === "pendente" ? null : r.decidedAt ?? r.createdAt),
  }));
  // ações de coordenação feitas por cada pessoa (o que ela moveu na fila)
  const ACT = ["assign", "unblocked", "est_keep", "est_use", "decide", "client_ok", "client_change", "request", "owner", "reassign", "cancelled", "reneg"];
  const actions = allQ.filter(e => e.actorId && ACT.includes(e.kind)).map(e => ({ actorId: e.actorId!, kind: e.kind, taskId: e.taskId, at: toLm(e.createdAt) }));

  const people = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl, status: usersTable.status }).from(usersTable);
  res.json({ now, me, role, jobs, people, team: { blocks, disputes, noEditor, requests, actions } });
});

export default router;

/**
 * Relatórios (análise). Um registro por job; o front faz período, comparação com o período anterior,
 * recortes, gráficos e drill-down em cima disso (são centenas de jobs).
 *
 * Sem horas e sem tempos de resposta: só entregas, prazo de entrega e retrabalho.
 */
import { Router } from "express";
import { db, tasksTable, usersTable, taskEventsTable, queueEventsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, ne, or, notInArray } from "drizzle-orm";
import { requireCoordinator } from "../lib/auth.js";
import { toLm } from "../lib/workcal.js";

const router = Router();

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
    .where(and(inArray(queueEventsTable.taskId, ids), inArray(queueEventsTable.kind, ["blocked", "due_changed", "due_signed", "reneg", "reassign", "furou", "client_change"]))) : [];
  const now = toLm(new Date());

  const jobs = rows.map(r => {
    const tev = evs.filter(e => e.taskId === r.id);
    const first = (s: string) => { const e = tev.find(x => x.toStatus === s); return e ? toLm(e.createdAt) : null; };
    const last = (s: string) => { const e = [...tev].reverse().find(x => x.toStatus === s); return e ? toLm(e.createdAt) : null; };
    const q = qevs.filter(e => e.taskId === r.id);
    const n = (...k: string[]) => q.filter(e => k.includes(e.kind)).length;
    return {
      id: r.id, code: code(r.taskNumber, r.taskYear), title: r.title, client: r.client, status: r.status,
      editorId: r.assignedToId, coordId: r.createdById,
      created: toLm(r.createdAt), firstStart: first("in_progress"), firstReview: first("review"),
      closedAt: r.status === "completed" ? last("completed") : null, cancelledAt: r.status === "cancelled" ? last("cancelled") : null,
      due: r.dueDate ? toLm(r.dueDate) : null, revisions: r.revisionCount ?? 0,
      blocks: n("blocked"), blockReasons: q.filter(e => e.kind === "blocked" && e.text).map(e => e.text!),
      dueChanged: n("due_changed", "due_signed", "reneg"), reassign: n("reassign"), furou: n("furou"), clientChanges: n("client_change"),
    };
  });

  const people = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, jobTitle: usersTable.jobTitle, avatarUrl: usersTable.avatarUrl, status: usersTable.status }).from(usersTable);
  res.json({ now, me, role, jobs, people });
});

export default router;

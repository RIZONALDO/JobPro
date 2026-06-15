/**
 * MONITOR — Motor de vigilância de execução
 *
 * Detecta desvios entre o plano (te_task_allocations) e a execução real.
 * Três sinais principais:
 *   1. Slot vencido sem confirmação  → sessão perdida
 *   2. Tarefa em risco de prazo      → capacidade restante < esforço restante
 *   3. Tarefa atrasada               → dueDate passou, não concluída
 */

import { Router } from "express";
import { db, tasksTable, usersTable, taskAllocationsTable, taskCoordinatorsTable } from "@workspace/db";
import { eq, and, lt, lte, gte, ne, inArray, or, isNotNull, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { notify } from "../lib/notify.js";

const router = Router();

// ── Constantes ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["pending", "in_progress", "review", "reopened"] as const;

type ExecStatus = "scheduled" | "done" | "partial" | "missed";
type RiskLevel  = "ok" | "at_risk" | "critical" | "overdue" | "recovering" | "not_started";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function daysUntil(dateStr: string, now: Date): number {
  const d = new Date(dateStr + "T23:59:59");
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

// ── Algoritmo central de risco ────────────────────────────────────────────────

interface AllocationRow {
  id:             number;
  workDate:       string;
  allocatedHours: number | null;
  execStatus:     string;
  actualHours:    number | null;
}

interface TaskRisk {
  taskId:             number;
  taskCode:           string;
  taskTitle:          string;
  editorId:           number | null;
  editorName:         string | null;
  riskLevel:          RiskLevel;
  riskScore:          number;   // remainingEffort / remainingCapacity (>1 = crítico)
  missedSlots:        number;   // slots passados sem confirmação
  hoursLost:          number;   // horas perdidas em slots missed
  confirmedHours:     number;   // horas efetivamente confirmadas (done + partial)
  remainingEffort:    number;   // effortHours - confirmedHours
  remainingCapacity:  number;   // soma de allocatedHours nos slots futuros
  daysUntilDeadline:  number;
  dueDate:            string | null;
  status:             string;
  nextSlot:           string | null;  // próxima data de trabalho agendada
}

function calcRisk(
  task: { id: number; taskCode: string; title: string; status: string;
          effortHours: number | null; dueDate: Date | null;
          assignedToId: number | null; editorName: string | null },
  allocations: AllocationRow[],
  today: string,
  now: Date,
): TaskRisk {
  const dueDateStr = task.dueDate ? toLocalStr(task.dueDate) : null;

  const pastSlots   = allocations.filter(a => a.workDate <  today);
  const futureSlots = allocations.filter(a => a.workDate >= today);

  const missedSlots    = pastSlots.filter(a => a.execStatus === "scheduled");
  const hoursLost      = missedSlots.reduce((s, a) => s + (a.allocatedHours ?? 0), 0);
  const confirmedHours = pastSlots
    .filter(a => a.execStatus === "done" || a.execStatus === "partial")
    .reduce((s, a) => s + (a.actualHours ?? a.allocatedHours ?? 0), 0);

  const effortHours       = task.effortHours ?? 0;
  const remainingEffort   = Math.max(0, effortHours - confirmedHours);
  const remainingCapacity = futureSlots.reduce((s, a) => s + (a.allocatedHours ?? 0), 0);
  const riskScore         = remainingCapacity > 0 ? remainingEffort / remainingCapacity : (remainingEffort > 0 ? Infinity : 0);

  const daysUntilDeadline = dueDateStr ? daysUntil(dueDateStr, now) : 999;
  const nextSlot = futureSlots.length > 0 ? futureSlots[0].workDate : null;

  // Determinar nível de risco
  let riskLevel: RiskLevel = "ok";

  if (dueDateStr && dueDateStr < today && !["completed","cancelled"].includes(task.status)) {
    // Prazo do cliente venceu — distingue "abandonada" de "em recuperação"
    riskLevel = futureSlots.length > 0 ? "recovering" : "overdue";
  } else if (pastSlots.length === 0) {
    // Nenhum slot passou ainda — execução não iniciou, não há desvio real para detectar
    riskLevel = "ok";
  } else if (task.status === "pending" && missedSlots.length === pastSlots.length) {
    riskLevel = "not_started"; // tinha slots, nunca confirmou nada
  } else if (riskScore > 1.2 || (remainingEffort > 0 && remainingCapacity === 0)) {
    riskLevel = "critical";   // capacidade futura insuficiente em >20%
  } else if (riskScore > 1.0 || daysUntilDeadline <= 1) {
    riskLevel = "at_risk";    // levemente insuficiente ou entrega amanhã
  }
  // riskScore ≤ 1.0 → ok: sessões perdidas já estão refletidas no riskScore via remainingEffort

  return {
    taskId:            task.id,
    taskCode:          task.taskCode,
    taskTitle:         task.title,
    editorId:          task.assignedToId,
    editorName:        task.editorName,
    riskLevel,
    riskScore:         isFinite(riskScore) ? Math.round(riskScore * 100) / 100 : 99,
    missedSlots:       missedSlots.length,
    hoursLost:         Math.round(hoursLost * 100) / 100,
    confirmedHours:    Math.round(confirmedHours * 100) / 100,
    remainingEffort:   Math.round(remainingEffort * 100) / 100,
    remainingCapacity: Math.round(remainingCapacity * 100) / 100,
    daysUntilDeadline,
    dueDate:           dueDateStr,
    status:            task.status,
    nextSlot,
  };
}

// ── GET /api/monitor/risks — visão do coordenador ────────────────────────────

router.get("/monitor/risks", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const userId = req.session.userId as number;
  const now    = new Date();
  const today  = toLocalStr(now);

  // Tarefas que o coordenador criou ou é co-coordenador
  const coCoordRows = await db
    .select({ taskId: taskCoordinatorsTable.taskId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.userId, userId));
  const coIds = coCoordRows.map(r => r.taskId);

  const taskCondition = coIds.length > 0
    ? or(eq(tasksTable.createdById, userId), inArray(tasksTable.id, coIds))!
    : eq(tasksTable.createdById, userId);

  // Busca tarefas ativas com editor
  const tasks = await db
    .select({
      id:           tasksTable.id,
      taskNumber:   tasksTable.taskNumber,
      taskYear:     tasksTable.taskYear,
      title:        tasksTable.title,
      status:       tasksTable.status,
      effortHours:  tasksTable.effortHours,
      dueDate:      tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
      editorName:   usersTable.name,
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assignedToId, usersTable.id))
    .where(and(
      taskCondition,
      inArray(tasksTable.status, [...ACTIVE_STATUSES]),
      ne(tasksTable.taskType, "multi_task"),
      isNotNull(tasksTable.effortHours),
    ));

  if (!tasks.length) { res.json([]); return; }

  // Busca todas as alocações das tarefas
  const taskIds = tasks.map(t => t.id);
  const allocs  = await db
    .select({
      id:             taskAllocationsTable.id,
      taskId:         taskAllocationsTable.taskId,
      workDate:       taskAllocationsTable.workDate,
      allocatedHours: taskAllocationsTable.allocatedHours,
      execStatus:     taskAllocationsTable.execStatus,
      actualHours:    taskAllocationsTable.actualHours,
    })
    .from(taskAllocationsTable)
    .where(inArray(taskAllocationsTable.taskId, taskIds))
    .orderBy(taskAllocationsTable.workDate);

  const allocsByTask = new Map<number, AllocationRow[]>();
  for (const a of allocs) {
    if (!allocsByTask.has(a.taskId)) allocsByTask.set(a.taskId, []);
    allocsByTask.get(a.taskId)!.push(a as AllocationRow);
  }

  const risks: TaskRisk[] = tasks
    .map(t => calcRisk(
      { ...t, taskCode: String(t.taskNumber).padStart(3,"0") + "." + String(t.taskYear).slice(-2) },
      allocsByTask.get(t.id) ?? [],
      today,
      now,
    ))
    .filter(r => r.riskLevel !== "ok")  // só retorna os que têm problema
    .sort((a, b) => {
      const order: RiskLevel[] = ["overdue","critical","not_started","at_risk","recovering","ok"];
      return order.indexOf(a.riskLevel) - order.indexOf(b.riskLevel);
    });

  res.json(risks);
});

// ── GET /api/monitor/dashboard — resumo numérico ─────────────────────────────

router.get("/monitor/dashboard", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const userId = req.session.userId as number;
  const now    = new Date();
  const today  = toLocalStr(now);

  const coCoordRows = await db
    .select({ taskId: taskCoordinatorsTable.taskId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.userId, userId));
  const coIds = coCoordRows.map(r => r.taskId);

  const taskCondition = coIds.length > 0
    ? or(eq(tasksTable.createdById, userId), inArray(tasksTable.id, coIds))!
    : eq(tasksTable.createdById, userId);

  const [slotsToday, missedToday, overdue, criticalCount] = await Promise.all([
    // Slots de hoje
    db.select({ count: sql<number>`count(*)::int` })
      .from(taskAllocationsTable)
      .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
      .where(and(taskCondition, eq(taskAllocationsTable.workDate, today),
        inArray(tasksTable.status, [...ACTIVE_STATUSES]))),

    // Slots de hoje ainda não confirmados
    db.select({ count: sql<number>`count(*)::int` })
      .from(taskAllocationsTable)
      .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
      .where(and(taskCondition, eq(taskAllocationsTable.workDate, today),
        eq(taskAllocationsTable.execStatus, "scheduled"),
        inArray(tasksTable.status, [...ACTIVE_STATUSES]))),

    // Tarefas atrasadas
    db.select({ count: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(and(taskCondition,
        inArray(tasksTable.status, [...ACTIVE_STATUSES]),
        lt(tasksTable.dueDate, new Date()))),

    // Slots passados sem confirmação (missed acumulado)
    db.select({ count: sql<number>`count(*)::int` })
      .from(taskAllocationsTable)
      .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
      .where(and(taskCondition,
        lt(taskAllocationsTable.workDate, today),
        eq(taskAllocationsTable.execStatus, "scheduled"),
        inArray(tasksTable.status, [...ACTIVE_STATUSES]))),
  ]);

  res.json({
    slotsToday:   slotsToday[0]?.count  ?? 0,
    pendingToday: missedToday[0]?.count  ?? 0,
    overdue:      overdue[0]?.count       ?? 0,
    missedTotal:  criticalCount[0]?.count ?? 0,
  });
});

// ── GET /api/monitor/my-today — slots do editor hoje ─────────────────────────

router.get("/monitor/my-today", requireAuth, async (req: any, res: any): Promise<void> => {
  const editorId = req.session.userId as number;
  const today    = toLocalStr(new Date());

  // Window functions para slotIndex e totalSlots sobre TODAS as alocações do editor
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY work_date) AS slot_index,
        COUNT(*)     OVER (PARTITION BY task_id)                    AS total_slots
      FROM te_task_allocations
      WHERE editor_id = ${editorId}
    )
    SELECT
      ta.id,
      ta.task_id                                                          AS "taskId",
      LPAD(t.task_number::text, 3, '0') || '.' || RIGHT(t.task_year::text, 2) AS "taskCode",
      t.title                                                             AS "taskTitle",
      t.client,
      t.status,
      ta.start_time    AS "startTime",
      ta.end_time      AS "endTime",
      ta.allocated_hours AS "allocatedHours",
      ta.exec_status   AS "execStatus",
      ta.actual_hours  AS "actualHours",
      ta.exec_note     AS "execNote",
      r.slot_index::int  AS "slotIndex",
      r.total_slots::int AS "totalSlots"
    FROM te_task_allocations ta
    INNER JOIN te_tasks t ON t.id = ta.task_id
    INNER JOIN ranked r   ON r.id = ta.id
    WHERE ta.editor_id = ${editorId}
      AND ta.work_date  = ${today}
      AND t.status IN ('pending','in_progress','review','reopened')
      AND t.task_type  != 'multi_task'
    ORDER BY ta.start_time
  `);

  res.json(result.rows);
});

// ── POST /api/monitor/slots/:id/confirm — editor confirma sessão ──────────────

router.post("/monitor/slots/:id/confirm", requireAuth, async (req: any, res: any): Promise<void> => {
  const allocationId = parseInt(req.params.id, 10);
  const userId       = req.session.userId as number;
  const { actualHours, note } = req.body as { actualHours?: number; note?: string };

  const [alloc] = await db.select({ id: taskAllocationsTable.id, taskId: taskAllocationsTable.taskId,
    editorId: taskAllocationsTable.editorId, allocatedHours: taskAllocationsTable.allocatedHours })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.id, allocationId));

  if (!alloc) { res.status(404).json({ error: "Slot não encontrado" }); return; }
  if (alloc.editorId !== userId) { res.status(403).json({ error: "Sem permissão" }); return; }

  const hours = actualHours ?? alloc.allocatedHours ?? 0;
  const status: ExecStatus = hours >= (alloc.allocatedHours ?? hours) * 0.9 ? "done" : "partial";

  await db.update(taskAllocationsTable)
    .set({ execStatus: status, actualHours: hours, execNote: note ?? null,
           confirmedAt: new Date(), confirmedBy: userId })
    .where(eq(taskAllocationsTable.id, allocationId));

  broadcastTaskChange();
  res.json({ ok: true, execStatus: status });
});

// ── POST /api/monitor/slots/:id/miss — registra slot como perdido ─────────────

router.post("/monitor/slots/:id/miss", requireAuth, async (req: any, res: any): Promise<void> => {
  const allocationId = parseInt(req.params.id, 10);
  const userId       = req.session.userId as number;
  const { note } = req.body as { note?: string };

  const [alloc] = await db.select({ editorId: taskAllocationsTable.editorId, taskId: taskAllocationsTable.taskId })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.id, allocationId));

  if (!alloc) { res.status(404).json({ error: "Slot não encontrado" }); return; }

  // Editor pode registrar o próprio slot; coordenador pode registrar qualquer um
  const role = req.session.userRole as string;
  if (role === "editor" && alloc.editorId !== userId) {
    res.status(403).json({ error: "Sem permissão" }); return;
  }

  await db.update(taskAllocationsTable)
    .set({ execStatus: "missed", actualHours: 0, execNote: note ?? null,
           confirmedAt: new Date(), confirmedBy: userId })
    .where(eq(taskAllocationsTable.id, allocationId));

  // Notifica coordenador da tarefa
  const [task] = await db.select({ createdById: tasksTable.createdById, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.id, alloc.taskId));

  if (task?.createdById && task.createdById !== userId) {
    await notify(task.createdById, "monitor_slot_missed", alloc.taskId, `Sessão perdida: "${task.title}"${note ? ` — ${note}` : ""}`);
  }

  broadcastTaskChange();
  res.json({ ok: true });
});

export default router;

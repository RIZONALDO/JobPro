/**
 * REPLANO — Replanejamento Adaptativo
 *
 * Endpoints:
 *   GET  /api/replano/context/:taskId              — o que aconteceu (carregado 1x)
 *   GET  /api/replano/editors/:taskId              — editores ranqueados por disponibilidade
 *   GET  /api/replano/preview/:taskId?editorId&mode — proposta de nova agenda (atualiza ao trocar opções)
 *   POST /api/replano/apply/:taskId                — confirma e aplica
 */

import { Router } from "express";
import {
  db, tasksTable, usersTable, taskAllocationsTable,
  taskCoordinatorsTable, appSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { requireCoordinator } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { notify } from "../lib/notify.js";

const router = Router();

const ACTIVE_STATUSES = ["pending", "in_progress", "review", "reopened"];
const CAPACITY_WEEKDAY  = 8;
const CAPACITY_SATURDAY = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundH(h: number) { return Math.round(h * 100) / 100; }

function toLocalStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

async function loadHolidays(): Promise<Set<string>> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable).where(eq(appSettingsTable.key, "calendar_holidays"));
  try { const a = JSON.parse(row?.value ?? "[]"); return new Set(Array.isArray(a) ? a : []); }
  catch { return new Set(); }
}

function dailyCapacity(d: Date, holidays: Set<string>): number {
  const dow = d.getDay();
  if (dow === 0) return 0;
  if (holidays.has(toLocalStr(d))) return 0;
  return dow === 6 ? CAPACITY_SATURDAY : CAPACITY_WEEKDAY;
}

function effortToClockStr(used: number, dow: number): string {
  const h = dow === 6 ? 8 + used : used < 4 ? 8 + used : 14 + (used - 4);
  return `${String(Math.floor(h)).padStart(2,"0")}:${String(Math.round((h % 1) * 60)).padStart(2,"0")}`;
}

function addWorkingDays(d: Date, n: number, holidays: Set<string>): Date {
  const r = new Date(d); let added = 0;
  while (added < n) { r.setDate(r.getDate() + 1); if (dailyCapacity(r, holidays) > 0) added++; }
  return r;
}

async function hoursUsed(editorId: number, dayStr: string, excludeTaskId: number): Promise<number> {
  const rows = await db
    .select({ h: taskAllocationsTable.allocatedHours })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskAllocationsTable.editorId, editorId),
      eq(taskAllocationsTable.workDate, dayStr),
      isNotNull(taskAllocationsTable.allocatedHours),
      inArray(tasksTable.status, ACTIVE_STATUSES),
      ne(tasksTable.taskType, "multi_task"),
      ne(tasksTable.id, excludeTaskId),
    ));
  return roundH(rows.reduce((s, r) => s + (r.h ?? 0), 0));
}

interface ReplanSlot { date: string; hours: number; startTime: string; endTime: string; }

/**
 * Distribui `remainingHours` a partir de `fromDate`.
 * mode='consecutive' → dias seguidos (padrão).
 * mode='alternating' → após cada dia trabalhado, pula o próximo dia útil.
 */
async function distributeHours(
  editorId: number,
  excludeTaskId: number,
  remainingHours: number,
  fromDate: Date,
  holidays: Set<string>,
  mode: "consecutive" | "alternating" = "consecutive",
  maxDays = 120,
): Promise<{ slots: ReplanSlot[]; lastDate: string }> {
  const slots: ReplanSlot[] = [];
  let rem = roundH(remainingHours);
  const cur = new Date(fromDate);
  cur.setHours(8, 0, 0, 0);
  let guard = 0;
  let skipNext = false;

  while (rem > 0.01 && guard++ < maxDays) {
    const cap = dailyCapacity(cur, holidays);
    if (cap > 0) {
      if (skipNext) {
        skipNext = false; // pula este dia útil (modo alternado)
        cur.setDate(cur.getDate() + 1);
        continue;
      }
      const dayStr = toLocalStr(cur);
      const used   = await hoursUsed(editorId, dayStr, excludeTaskId);
      const avail  = roundH(cap - used);
      if (avail > 0.01) {
        const alloc = roundH(Math.min(avail, rem));
        const dow   = cur.getDay();
        slots.push({
          date:      dayStr,
          hours:     alloc,
          startTime: effortToClockStr(used, dow),
          endTime:   effortToClockStr(roundH(used + alloc), dow),
        });
        rem = roundH(rem - alloc);
        if (mode === "alternating") skipNext = true;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  const lastDate = slots.length > 0 ? slots[slots.length - 1].date : toLocalStr(fromDate);
  return { slots, lastDate };
}

// ── Helpers de cálculo de horas restantes ────────────────────────────────────

function calcRemaining(
  allocs: { workDate: string; execStatus: string; allocatedHours: number | null; actualHours: number | null }[],
  effortHours: number,
  today: string,
) {
  const confirmedHours = allocs
    .filter(a => a.workDate < today && (a.execStatus === "done" || a.execStatus === "partial"))
    .reduce((s, a) => s + (a.actualHours ?? a.allocatedHours ?? 0), 0);
  const futureConfirmedHours = allocs
    .filter(a => a.workDate >= today && (a.execStatus === "done" || a.execStatus === "partial"))
    .reduce((s, a) => s + (a.actualHours ?? a.allocatedHours ?? 0), 0);
  return {
    confirmedHours: roundH(confirmedHours),
    remainingEffort: roundH(Math.max(0, effortHours - confirmedHours - futureConfirmedHours)),
  };
}

// ── GET /api/replano/context/:taskId ─────────────────────────────────────────
// Retorna o contexto "o que aconteceu" sem calcular proposta de agenda.

router.get("/replano/context/:taskId", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const taskId = parseInt(req.params.taskId, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      effortHours: tasksTable.effortHours, dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId, editorName: usersTable.name,
      editorAvatar: usersTable.avatarUrl,
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assignedToId, usersTable.id))
    .where(and(eq(tasksTable.id, taskId), ne(tasksTable.taskType, "multi_task")));

  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (!task.effortHours || !task.assignedToId) {
    res.status(400).json({ error: "Tarefa sem esforço ou editor definido" }); return;
  }

  const today = toLocalStr(new Date());
  const allocs = await db
    .select({ workDate: taskAllocationsTable.workDate, execStatus: taskAllocationsTable.execStatus,
              allocatedHours: taskAllocationsTable.allocatedHours, actualHours: taskAllocationsTable.actualHours })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId))
    .orderBy(taskAllocationsTable.workDate);

  const { confirmedHours, remainingEffort } = calcRemaining(allocs, task.effortHours, today);
  const missedSlots = allocs.filter(a => a.workDate < today && a.execStatus === "scheduled");
  const hoursLost   = roundH(missedSlots.reduce((s, a) => s + (a.allocatedHours ?? 0), 0));

  const dueDateStr = task.dueDate ? toLocalStr(task.dueDate) : null;
  const daysUntilDeadline = dueDateStr
    ? Math.ceil((new Date(dueDateStr + "T23:59:59").getTime() - Date.now()) / 86_400_000)
    : 999;

  res.json({
    taskId, taskTitle: task.title, taskStatus: task.status,
    currentEditorId: task.assignedToId, currentEditorName: task.editorName,
    currentEditorAvatar: task.editorAvatar,
    effortHours: task.effortHours, confirmedHours, remainingEffort,
    missedSlots: missedSlots.length, hoursLost,
    originalDueDate: dueDateStr, daysUntilDeadline,
  });
});

// ── GET /api/replano/editors/:taskId ─────────────────────────────────────────
// Retorna todos os editores ranqueados por disponibilidade para absorver o esforço restante.

// Aceita ?mode=consecutive|alternating — o ranqueamento reflete o modo escolhido
router.get("/replano/editors/:taskId", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const taskId = parseInt(req.params.taskId, 10);
  const mode   = (req.query.mode === "alternating" ? "alternating" : "consecutive") as "consecutive" | "alternating";
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, effortHours: tasksTable.effortHours, assignedToId: tasksTable.assignedToId })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task?.effortHours) { res.status(400).json({ error: "Tarefa sem esforço definido" }); return; }

  const today = toLocalStr(new Date());
  const allocs = await db
    .select({ workDate: taskAllocationsTable.workDate, execStatus: taskAllocationsTable.execStatus,
              allocatedHours: taskAllocationsTable.allocatedHours, actualHours: taskAllocationsTable.actualHours })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId));
  const { remainingEffort } = calcRemaining(allocs, task.effortHours, today);

  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(inArray(usersTable.role, ["editor"]));

  const holidays  = await loadHolidays();
  const startFrom = new Date(today + "T08:00:00");

  const ranked = await Promise.all(editors.map(async (e) => {
    const { slots, lastDate } = await distributeHours(e.id, taskId, remainingEffort, startFrom, holidays, mode);
    const hoursScheduled = roundH(slots.reduce((s, sl) => s + sl.hours, 0));
    const feasible = hoursScheduled >= remainingEffort - 0.01;
    const daysToFinish = feasible
      ? Math.ceil((new Date(lastDate + "T12:00:00").getTime() - startFrom.getTime()) / 86_400_000)
      : null;
    return {
      id: e.id, name: e.name, avatarUrl: e.avatarUrl,
      isCurrent: e.id === task.assignedToId,
      feasible, completionDate: feasible ? lastDate : null, daysToFinish,
    };
  }));

  ranked.sort((a, b) => {
    if (a.feasible && !b.feasible) return -1;
    if (!a.feasible && b.feasible) return 1;
    if (a.completionDate && b.completionDate) return a.completionDate.localeCompare(b.completionDate);
    return 0;
  });

  res.json(ranked);
});

// ── GET /api/replano/preview/:taskId?editorId=&mode= ─────────────────────────
// Proposta de nova agenda para um editor e modo específicos.

router.get("/replano/preview/:taskId", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const taskId   = parseInt(req.params.taskId, 10);
  const editorId = req.query.editorId ? parseInt(String(req.query.editorId), 10) : null;
  const mode     = (req.query.mode === "alternating" ? "alternating" : "consecutive") as "consecutive" | "alternating";
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, effortHours: tasksTable.effortHours,
              dueDate: tasksTable.dueDate, assignedToId: tasksTable.assignedToId })
    .from(tasksTable).where(and(eq(tasksTable.id, taskId), ne(tasksTable.taskType, "multi_task")));
  if (!task?.effortHours) { res.status(400).json({ error: "Tarefa sem esforço definido" }); return; }

  const targetEditor = editorId ?? task.assignedToId;
  if (!targetEditor) { res.status(400).json({ error: "Editor não definido" }); return; }

  const today = toLocalStr(new Date());
  const allocs = await db
    .select({ id: taskAllocationsTable.id, workDate: taskAllocationsTable.workDate,
              execStatus: taskAllocationsTable.execStatus, allocatedHours: taskAllocationsTable.allocatedHours,
              actualHours: taskAllocationsTable.actualHours })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId))
    .orderBy(taskAllocationsTable.workDate);

  const { remainingEffort } = calcRemaining(allocs, task.effortHours, today);
  if (remainingEffort <= 0) {
    res.json({ newSlots: [], feasible: true, deadlineExtended: false,
               originalDueDate: task.dueDate ? toLocalStr(task.dueDate) : null,
               suggestedDueDate: task.dueDate ? toLocalStr(task.dueDate) : null, message: "Tarefa já concluída." });
    return;
  }

  const holidays  = await loadHolidays();
  const startFrom = new Date(today + "T08:00:00");
  const { slots: newSlots, lastDate } = await distributeHours(targetEditor, taskId, remainingEffort, startFrom, holidays, mode);

  const originalDueDate = task.dueDate ? toLocalStr(task.dueDate) : null;
  const deadlineExtended = originalDueDate ? lastDate > originalDueDate : false;
  let suggestedDueDate = originalDueDate;
  if (deadlineExtended) suggestedDueDate = toLocalStr(addWorkingDays(new Date(lastDate + "T12:00:00"), 1, holidays));

  res.json({
    newSlots, feasible: roundH(newSlots.reduce((s, sl) => s + sl.hours, 0)) >= remainingEffort - 0.01,
    deadlineExtended, originalDueDate, suggestedDueDate,
  });
});

// ── POST /api/replano/apply/:taskId ──────────────────────────────────────────

router.post("/replano/apply/:taskId", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const taskId = parseInt(req.params.taskId, 10);
  const userId = req.session.userId as number;
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { newDueDate, editorId: newEditorId, mode = "consecutive" } =
    req.body as { newDueDate?: string; editorId?: number; mode?: string };

  const [task] = await db
    .select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
              effortHours: tasksTable.effortHours, dueDate: tasksTable.dueDate,
              assignedToId: tasksTable.assignedToId, createdById: tasksTable.createdById })
    .from(tasksTable).where(and(eq(tasksTable.id, taskId), ne(tasksTable.taskType, "multi_task")));

  if (!task?.effortHours) { res.status(400).json({ error: "Tarefa sem esforço ou editor" }); return; }

  const targetEditorId = newEditorId ?? task.assignedToId!;
  const today          = toLocalStr(new Date());
  const allocs = await db
    .select({ id: taskAllocationsTable.id, workDate: taskAllocationsTable.workDate,
              execStatus: taskAllocationsTable.execStatus, allocatedHours: taskAllocationsTable.allocatedHours,
              actualHours: taskAllocationsTable.actualHours })
    .from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId))
    .orderBy(taskAllocationsTable.workDate);

  const { remainingEffort } = calcRemaining(allocs, task.effortHours!, today);
  if (remainingEffort <= 0) { res.json({ ok: true, message: "Esforço já concluído." }); return; }

  const holidays = await loadHolidays();
  const { slots: newSlots, lastDate } = await distributeHours(
    targetEditorId, taskId, remainingEffort,
    new Date(today + "T08:00:00"), holidays,
    mode === "alternating" ? "alternating" : "consecutive",
  );
  if (newSlots.length === 0) {
    res.status(422).json({ error: "Nenhum slot disponível para este editor" }); return;
  }

  const toDelete     = allocs.filter(a => a.workDate >= today && a.execStatus === "scheduled").map(a => a.id);
  const pastMissedIds = allocs.filter(a => a.workDate < today && a.execStatus === "scheduled").map(a => a.id);

  await db.transaction(async (tx) => {
    // Marca sessões passadas perdidas como 'missed'
    for (const id of pastMissedIds) {
      await tx.update(taskAllocationsTable)
        .set({ execStatus: "missed", actualHours: 0, confirmedAt: new Date(), confirmedBy: userId })
        .where(eq(taskAllocationsTable.id, id));
    }
    // Remove slots futuros 'scheduled' antigos
    for (const id of toDelete) {
      await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.id, id));
    }
    // Insere novos slots
    for (const s of newSlots) {
      const existing = allocs.find(a => a.workDate === s.date && !toDelete.includes(a.id));
      if (existing) continue;
      await tx.insert(taskAllocationsTable).values({
        taskId, editorId: targetEditorId,
        workDate: s.date, allocatedHours: s.hours, startTime: s.startTime, endTime: s.endTime,
        execStatus: "scheduled",
      });
    }
    // Troca editor se selecionou outro
    if (newEditorId && newEditorId !== task.assignedToId) {
      await tx.update(tasksTable).set({ assignedToId: newEditorId, updatedAt: new Date() })
        .where(eq(tasksTable.id, taskId));
    }
    // Atualiza dueDate
    if (newDueDate) {
      await tx.update(tasksTable).set({ dueDate: new Date(newDueDate + "T23:59:59"), updatedAt: new Date() })
        .where(eq(tasksTable.id, taskId));
    }
    // Atualiza startDate se ainda não iniciou
    if (newSlots[0] && task.status === "pending") {
      await tx.update(tasksTable).set({ startDate: new Date(newSlots[0].date + "T08:00:00"), updatedAt: new Date() })
        .where(eq(tasksTable.id, taskId));
    }
  });

  // Notifica editor original se trocou
  const prevEditor = task.assignedToId;
  if (newEditorId && newEditorId !== prevEditor && prevEditor && prevEditor !== userId) {
    await notify(prevEditor, "replano_aplicado", taskId,
      `A tarefa "${task.title}" foi transferida para outro editor`);
  }
  // Notifica editor destino
  if (targetEditorId !== userId) {
    await notify(targetEditorId, "replano_aplicado", taskId,
      `Nova agenda para "${task.title}" — ${newSlots.length} sessão${newSlots.length !== 1 ? "ões" : ""} agendada${newSlots.length !== 1 ? "s" : ""}`);
  }

  broadcastTaskChange();
  res.json({ ok: true, taskId, slotsCreated: newSlots.length, newSlots, lastSlotDate: lastDate });
});

export default router;

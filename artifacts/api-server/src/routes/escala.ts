/**
 * ESCALA — Encaixe de Slots e Cargas para Alocação Livre e Automática
 *
 * Modelo único: effortHours + allocated_hours por slot (te_task_allocations)
 */
import { Router } from "express";
import { db, tasksTable, usersTable, taskAllocationsTable, appSettingsTable } from "@workspace/db";
import { eq, ne, and, inArray, isNotNull } from "drizzle-orm";
import { requireCoordinator } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { notify } from "../lib/notify.js";

const router = Router();

// ── Constantes ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["pending", "in_progress", "review", "reopened"];

// Capacidade real de trabalho por tipo de dia
const CAPACITY_WEEKDAY  = 8; // seg–sex: 8h–12h + 14h–18h
const CAPACITY_SATURDAY = 5; // sábado: 8h–13h

// Janela padrão sem deadline: ceil(effortHours/8) × 3 dias corridos, mín 3
const WINDOW_MULTIPLIER = 3;
const MIN_WINDOW_DAYS   = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Carrega feriados do banco uma única vez por request e retorna um Set de "YYYY-MM-DD"
async function loadHolidays(): Promise<Set<string>> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "calendar_holidays"));
  try {
    const arr = JSON.parse(row?.value ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

// holidays agora é parâmetro — Set de "YYYY-MM-DD" de feriados
function dailyCapacity(d: Date, holidays: Set<string> = new Set()): number {
  const dow = d.getDay();
  if (dow === 0) return 0; // domingo
  if (holidays.has(toLocalDateStr(d))) return 0; // feriado
  if (dow === 6) return CAPACITY_SATURDAY;
  return CAPACITY_WEEKDAY;
}

// Adiciona N dias onde capacity > 0 (dias úteis reais, respeitando feriados)
function addWorkingDays(d: Date, n: number, holidays: Set<string> = new Set()): Date {
  const r = new Date(d);
  let added = 0;
  while (added < n) {
    r.setDate(r.getDate() + 1);
    if (dailyCapacity(r, holidays) > 0) added++;
  }
  return r;
}

// Subtrai N horas úteis — respeita horário comercial, fim de semana e feriados
function subWorkingHours(d: Date, hours: number, holidays: Set<string> = new Set()): Date {
  if (hours <= 0) return d;
  const r = new Date(d);
  let rem = hours;
  let guard = 0;
  while (rem > 0.01 && guard++ < 500) {
    const cap = dailyCapacity(r, holidays);
    if (cap > 0) {
      const endH  = r.getDay() === 6 ? 13 : 18;
      const curH  = Math.min(r.getHours() + r.getMinutes() / 60, endH);
      const avail = roundH(Math.max(0, curH - 8));
      if (avail > 0.01) {
        const use  = Math.min(avail, rem);
        const newH = curH - use;
        r.setHours(Math.floor(newH), Math.round((newH % 1) * 60), 0, 0);
        rem = roundH(rem - use);
      } else {
        r.setDate(r.getDate() - 1);
        const prevEnd = dailyCapacity(r, holidays) > 0 ? (r.getDay() === 6 ? 13 : 18) : 18;
        r.setHours(prevEnd, 0, 0, 0);
      }
    } else {
      r.setDate(r.getDate() - 1);
      const prevEnd = r.getDay() === 6 ? 13 : 18;
      r.setHours(prevEnd, 0, 0, 0);
    }
  }
  return r;
}

// Data mais cedo em que effortHours terminaria com agenda vazia.
// Usa noon local como ancoragem para evitar drift UTC.
// Usa dailyCapacity (8h/5h) — espelha a capacidade real do findHourSlots.
function calcTheoreticalCompletion(start: Date, effortHours: number, holidays: Set<string> = new Set()): Date {
  let remaining = roundH(effortHours);
  const d = new Date(start);
  d.setHours(12, 0, 0, 0); // noon local — evita drift de fuso
  while (remaining > 0.01) {
    const cap = dailyCapacity(d, holidays);
    if (cap > 0) {
      remaining = roundH(remaining - Math.min(cap, remaining));
      if (remaining <= 0.01) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return d;
}
function roundH(h: number): number {
  return Math.round(h * 100) / 100; // evita floating point drift
}

/**
 * Converte horas acumuladas usadas num dia em horário de relógio ("HH:MM"),
 * respeitando o intervalo de almoço (12h-14h) nos dias úteis.
 *
 * Mapeamento seg-sex:
 *   0h usado → 08:00   |   4h usado → 14:00 (pulo do almoço)
 *   2h usado → 10:00   |   6h usado → 16:00
 *   4h usado → 14:00   |   8h usado → 18:00
 *
 * Sábado (sem almoço): 0h → 08:00, 5h → 13:00
 */
function hoursToClockTime(used: number, dow: number): string {
  let h: number;
  if (dow === 6) {
    h = 8 + used; // sábado: linear 08:00-13:00
  } else {
    h = used < 4 ? 8 + used : 14 + (used - 4); // seg-sex: pula almoço em 4h
  }
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = String(Math.round((h % 1) * 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}
function fmtHours(h: number): string {
  const total = Math.round(h * 60);
  const hrs   = Math.floor(total / 60);
  const mins  = total % 60;
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h${mins}min`;
}

// ── Horas comprometidas de um editor num dia (somente alocações explícitas) ───
async function escalaHoursUsed(
  editorId:      number,
  day:           Date,
  excludeTaskId?: number,
): Promise<number> {
  const dayStr = toDateStr(day);
  const excl   = excludeTaskId ? [ne(tasksTable.id, excludeTaskId)] : [];

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
      ...excl,
    ));

  return roundH(rows.reduce((s, r) => s + (r.h ?? 0), 0));
}

// ── findHourSlots — núcleo do ESCALA ─────────────────────────────────────────

interface HourSlot {
  date:      string; // YYYY-MM-DD
  hours:     number; // horas alocadas neste dia
  startTime: string; // "HH:MM" — horário de início no dia
  endTime:   string; // "HH:MM" — horário de término no dia
}

interface HourSlotResult {
  possible:            boolean;
  slots:               HourSlot[];
  projectedCompletion: string | null; // YYYY-MM-DD do último slot
  hoursFound:          number;
  hoursNeeded:         number;
  windowDays:          number;
}

/**
 * Encontra blocos de horas para um editor dentro de [startDate, deadline].
 * Preenche dias parcialmente quando necessário (ex: tarefa de 3h num dia de 8h
 * que já tem 6h ocupadas → aloca 2h nesse dia + 1h no seguinte).
 */
const WORK_END_HOUR = 18; // expediente encerra às 18h

/** True se a data `d` é dia passado ou hoje com expediente encerrado.
 *  Usa data LOCAL (toLocalDateStr) para evitar drift de fuso: na VPS (UTC)
 *  toDateStr retornaria data UTC, mas o expediente é em horário local (BRT). */
function isPastWorkday(d: Date, now: Date): boolean {
  const ds = toLocalDateStr(d);
  const ns = toLocalDateStr(now);
  if (ds < ns) return true;
  // Hora local via getHours() — funciona se TZ do processo estiver correto.
  // Na VPS, garantir TZ=America/Sao_Paulo no ecosystem.config.cjs.
  if (ds === ns && now.getHours() >= WORK_END_HOUR) return true;
  return false;
}

async function findHourSlots(
  editorId:       number,
  effortHours:    number,
  startDate:      Date,
  deadline:       Date,
  excludeTaskId?: number,
  holidays:       Set<string> = new Set(),
): Promise<HourSlotResult> {
  const windowDays = Math.round((deadline.getTime() - startDate.getTime()) / 86_400_000);
  const slots: HourSlot[] = [];
  let remaining = effortHours;
  const now = new Date();

  const current = new Date(startDate);
  current.setHours(12, 0, 0, 0);

  while (current <= deadline && remaining > 0.01) {
    if (isPastWorkday(current, now)) {
      current.setDate(current.getDate() + 1);
      continue;
    }
    const dow = current.getDay();
    const cap = dailyCapacity(current, holidays);
    if (cap > 0) {
      const used      = await escalaHoursUsed(editorId, current, excludeTaskId);
      const available = roundH(cap - used);
      if (available > 0.01) {
        const allocate  = roundH(Math.min(available, remaining));
        const startTime = hoursToClockTime(used, dow);
        const endTime   = hoursToClockTime(roundH(used + allocate), dow);
        slots.push({ date: toDateStr(current), hours: allocate, startTime, endTime });
        remaining = roundH(remaining - allocate);
      }
    }
    current.setDate(current.getDate() + 1);
  }

  const last = slots[slots.length - 1];
  return {
    possible:            remaining <= 0.01,
    slots,
    projectedCompletion: last?.date ?? null,
    hoursFound:          roundH(effortHours - remaining),
    hoursNeeded:         effortHours,
    windowDays,
  };
}

// ── GET /api/escala/options ───────────────────────────────────────────────────
//
// mode = "urgent" : janela = conclusão teórica (trabalho contínuo, sem conflitos)
// mode = "client" : janela = deadline fornecido pelo coordenador
// mode = "open"   : janela = dias úteis proporcionais ao esforço (não dias corridos)
router.get("/escala/options", requireCoordinator, async (req, res): Promise<void> => {
  const { effortHours, startDate, deadline, editorId, excludeTaskId, mode, reviewHours } = req.query;

  const effort  = parseFloat(String(effortHours ?? "4"));
  // Usa noon local para datas sem horário — evita drift UTC (ex: "2026-06-12" → UTC midnight → local dia anterior)
  const parseQueryDate = (s: string): Date => s.includes("T") ? new Date(s) : new Date(s + "T12:00:00");
  const start   = startDate ? parseQueryDate(String(startDate)) : new Date();
  const prefId  = editorId     ? parseInt(String(editorId))     : null;
  const exclId  = excludeTaskId ? parseInt(String(excludeTaskId)) : undefined;
  const modeStr = String(mode ?? "client");

  if (isNaN(effort) || effort <= 0 || effort > 400) {
    res.status(400).json({ error: "effortHours inválido (0.5–400)" }); return;
  }

  const holidays = await loadHolidays();

  let end: Date;
  let calculatedDeadline: string | null = null;

  if (modeStr === "urgent") {
    const theoretical = calcTheoreticalCompletion(start, effort, holidays);
    calculatedDeadline = toLocalDateStr(theoretical);
    const bufferDays = Math.max(5, Math.ceil(effort / CAPACITY_WEEKDAY) * 3);
    end = addWorkingDays(theoretical, bufferDays, holidays);
  } else if (modeStr === "open") {
    const workDays = Math.max(Math.ceil(effort / CAPACITY_WEEKDAY) * WINDOW_MULTIPLIER, MIN_WINDOW_DAYS);
    end = addWorkingDays(start, workDays, holidays);
    calculatedDeadline = toLocalDateStr(end);
  } else {
    if (!deadline) {
      res.status(400).json({ error: "deadline obrigatório no modo client" }); return;
    }
    end = parseQueryDate(String(deadline));
    const rHours = parseFloat(String(reviewHours ?? "0")) || 0;
    if (rHours > 0) end = subWorkingHours(end, rHours, holidays);
  }

  if (toLocalDateStr(end) < toLocalDateStr(start)) {
    res.status(400).json({ error: "deadline não pode ser anterior a startDate" }); return;
  }

  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.role, ["editor"]));

  const allResults = await Promise.all(
    editors.map(async (e) => {
      const result = await findHourSlots(e.id, effort, start, end, exclId, holidays);
      return { editor: e, ...result };
    })
  );

  const sorted = allResults.sort((a, b) => {
    if (a.possible && !b.possible) return -1;
    if (!a.possible && b.possible) return 1;
    if (a.projectedCompletion && b.projectedCompletion)
      return a.projectedCompletion.localeCompare(b.projectedCompletion);
    return 0;
  });

  const target       = prefId ? sorted.find(r => r.editor.id === prefId) ?? null : null;
  const alternatives = sorted.filter(r => r.editor.id !== prefId);
  const windowDays   = allResults[0]?.windowDays ?? 0;

  // Verifica se a janela comporta effortHours com agenda vazia (validação independente de disponibilidade)
  // Comparação por string local para evitar falso negativo por diferença de timestamp
  const theoreticalEnd         = calcTheoreticalCompletion(start, effort, holidays);
  const theoreticalMinDeadline = toLocalDateStr(theoreticalEnd);
  const windowFeasible         = theoreticalMinDeadline <= toLocalDateStr(end);

  res.json({ target, alternatives, windowDays, calculatedDeadline, windowFeasible, theoreticalMinDeadline });
});

// ── POST /api/escala/tasks/:id/allocate ──────────────────────────────────────
router.post("/escala/tasks/:id/allocate", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { editorId, slots, effortHours } = req.body as {
    editorId:    number;
    slots:       { date: string; hours: number; startTime?: string; endTime?: string }[];
    effortHours: number;
  };

  if (!editorId || !Array.isArray(slots) || slots.length === 0 || effortHours == null) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }

  const [task] = await db.select({ id: tasksTable.id })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.transaction(async (tx) => {
    await tx.update(tasksTable)
      .set({ effortHours })
      .where(eq(tasksTable.id, taskId));

    await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId));

    await tx.insert(taskAllocationsTable).values(
      slots.map(s => ({
        taskId,
        editorId,
        workDate:       s.date,
        allocatedHours: s.hours,
        startTime:      s.startTime ?? null,
        endTime:        s.endTime   ?? null,
      }))
    );
  });

  broadcastTaskChange();
  res.json({ ok: true, taskId, slots });
});

// ── Helpers para detecção de colisão ─────────────────────────────────────────

interface ConflictSlot { date: string; startTime: string; endTime: string; hours: number; }

interface ConflictInfo {
  taskId:          number;
  title:           string;
  color:           string | null;
  client:          string | null;
  dueDate:         string | null;
  coordinatorId:   number | null;
  coordinatorName: string;
  effortHours:     number | null;
  slots:           ConflictSlot[];
}

async function findConflictingAllocations(
  editorId:      number,
  proposedSlots: { date: string; startTime: string; endTime: string }[],
  excludeTaskId?: number,
): Promise<ConflictInfo[]> {
  const dates = [...new Set(proposedSlots.map(s => s.date))];
  if (dates.length === 0) return [];

  const rows = await db
    .select({
      taskId:         taskAllocationsTable.taskId,
      workDate:       taskAllocationsTable.workDate,
      startTime:      taskAllocationsTable.startTime,
      endTime:        taskAllocationsTable.endTime,
      allocatedHours: taskAllocationsTable.allocatedHours,
      title:          tasksTable.title,
      color:          tasksTable.color,
      client:         tasksTable.client,
      dueDate:        tasksTable.dueDate,
      effortHours:    tasksTable.effortHours,
      createdById:    tasksTable.createdById,
    })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskAllocationsTable.editorId, editorId),
      inArray(taskAllocationsTable.workDate, dates),
      inArray(tasksTable.status, ACTIVE_STATUSES),
      ne(tasksTable.taskType, "multi_task"),
      ...(excludeTaskId ? [ne(taskAllocationsTable.taskId, excludeTaskId)] : []),
    ));

  // Filtra por sobreposição de horário (strings HH:MM comparam corretamente)
  const overlapping = rows.filter(row => {
    const proposed = proposedSlots.find(s => s.date === row.workDate);
    if (!proposed) return false;
    if (!row.startTime || !row.endTime) return true; // sem horário = dia inteiro = colide sempre
    return row.startTime < proposed.endTime && row.endTime > proposed.startTime;
  });

  if (overlapping.length === 0) return [];

  const coordIds = [...new Set(overlapping.map(r => r.createdById).filter((id): id is number => id !== null))];
  const coords   = coordIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, coordIds))
    : [];

  const byTask = new Map<number, typeof overlapping>();
  for (const row of overlapping) {
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, []);
    byTask.get(row.taskId)!.push(row);
  }

  return [...byTask.entries()].map(([taskId, taskRows]) => {
    const first = taskRows[0];
    const coord = coords.find(c => c.id === first.createdById);
    return {
      taskId,
      title:           first.title,
      color:           first.color,
      client:          first.client,
      dueDate:         first.dueDate ? toDateStr(first.dueDate instanceof Date ? first.dueDate : new Date(first.dueDate as any)) : null,
      coordinatorId:   first.createdById,
      coordinatorName: coord?.name ?? "Coordenador",
      effortHours:     first.effortHours,
      slots: taskRows.map(r => ({
        date:      r.workDate,
        startTime: r.startTime ?? "08:00",
        endTime:   r.endTime   ?? "18:00",
        hours:     r.allocatedHours ?? 0,
      })),
    };
  });
}

// Versão de findHourSlots que aceita horas extras já ocupadas (para simulação de cascata)
async function findHourSlotsWithExtra(
  editorId:           number,
  effortHours:        number,
  startDate:          Date,
  deadline:           Date,
  excludeTaskId?:     number,
  additionalOccupied?: Record<string, number>,
  holidays:           Set<string> = new Set(),
): Promise<HourSlotResult> {
  const windowDays = Math.round((deadline.getTime() - startDate.getTime()) / 86_400_000);
  const slots: HourSlot[] = [];
  let remaining = effortHours;
  const now = new Date();

  const current = new Date(startDate);
  current.setHours(12, 0, 0, 0);

  while (current <= deadline && remaining > 0.01) {
    if (isPastWorkday(current, now)) {
      current.setDate(current.getDate() + 1);
      continue;
    }
    const dow = current.getDay();
    const cap = dailyCapacity(current, holidays);
    if (cap > 0) {
      const dateStr   = toDateStr(current);
      const used      = await escalaHoursUsed(editorId, current, excludeTaskId);
      const extra     = additionalOccupied?.[dateStr] ?? 0;
      const available = roundH(cap - used - extra);
      if (available > 0.01) {
        const allocate  = roundH(Math.min(available, remaining));
        const startTime = hoursToClockTime(roundH(used + extra), dow);
        const endTime   = hoursToClockTime(roundH(used + extra + allocate), dow);
        slots.push({ date: dateStr, hours: allocate, startTime, endTime });
        remaining = roundH(remaining - allocate);
      }
    }
    current.setDate(current.getDate() + 1);
  }

  const last = slots[slots.length - 1];
  return {
    possible:            remaining <= 0.01,
    slots,
    projectedCompletion: last?.date ?? null,
    hoursFound:          roundH(effortHours - remaining),
    hoursNeeded:         effortHours,
    windowDays,
  };
}

// ── POST /api/escala/check-conflicts ─────────────────────────────────────────
// Verifica colisões sem criar nada. Usado como pre-flight antes de criar tarefa.
router.post("/escala/check-conflicts", requireCoordinator, async (req, res): Promise<void> => {
  const { editorId, slots } = req.body as {
    editorId: number;
    slots:    { date: string; startTime: string; endTime: string }[];
  };

  if (!editorId || !Array.isArray(slots)) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }

  const conflicts = await findConflictingAllocations(editorId, slots);
  res.json({ hasConflicts: conflicts.length > 0, conflicts });
});

// ── POST /api/escala/preview-displacement ────────────────────────────────────
// Calcula novos slots para cada tarefa conflitante, levando em conta as horas
// que serão ocupadas pela nova tarefa + as realocações das anteriores (greedy
// por urgência de prazo).
router.post("/escala/preview-displacement", requireCoordinator, async (req, res): Promise<void> => {
  const { editorId, newSlots, conflictingTaskIds } = req.body as {
    editorId:           number;
    newSlots:           HourSlot[];
    conflictingTaskIds: number[];
  };

  if (!editorId || !Array.isArray(newSlots) || !Array.isArray(conflictingTaskIds)) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }

  const holidays = await loadHolidays();

  const conflictingTasks = await db
    .select({
      id:          tasksTable.id,
      title:       tasksTable.title,
      color:       tasksTable.color,
      client:      tasksTable.client,
      effortHours: tasksTable.effortHours,
      dueDate:     tasksTable.dueDate,
      createdById: tasksTable.createdById,
    })
    .from(tasksTable)
    .where(inArray(tasksTable.id, conflictingTaskIds));

  const coordIds = [...new Set(conflictingTasks.map(t => t.createdById).filter((id): id is number => id !== null))];
  const coords   = coordIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, coordIds))
    : [];

  // Horas extras já ocupadas pela nova tarefa (por dia)
  const additionalByDate: Record<string, number> = {};
  for (const s of newSlots) {
    additionalByDate[s.date] = (additionalByDate[s.date] ?? 0) + s.hours;
  }

  const now = new Date();
  const cascadeAdditional = { ...additionalByDate };
  const cascade: {
    taskId:          number;
    title:           string;
    color:           string | null;
    coordinatorName: string;
    dueDate:         string | null;
    originalSlots:   HourSlot[];
    newSlots:        HourSlot[];
    possible:        boolean;
  }[] = [];

  // Ordena por urgência de prazo (mais urgente primeiro)
  const sorted = [...conflictingTasks].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    const at = a.dueDate instanceof Date ? a.dueDate.getTime() : new Date(a.dueDate as any).getTime();
    const bt = b.dueDate instanceof Date ? b.dueDate.getTime() : new Date(b.dueDate as any).getTime();
    return at - bt;
  });

  for (const task of sorted) {
    const effort = task.effortHours ?? 4;
    const rawDue = task.dueDate
      ? (task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate as any))
      : null;
    // Prazo vencido ou sem prazo → janela de 15 dias úteis a partir de hoje
    const deadline = (!rawDue || rawDue <= now) ? addWorkingDays(now, 15) : rawDue;
    const deadlineExpired = !!rawDue && rawDue <= now;

    const currentAllocs = await db
      .select({
        workDate:       taskAllocationsTable.workDate,
        allocatedHours: taskAllocationsTable.allocatedHours,
        startTime:      taskAllocationsTable.startTime,
        endTime:        taskAllocationsTable.endTime,
      })
      .from(taskAllocationsTable)
      .where(eq(taskAllocationsTable.taskId, task.id));

    // Bloqueia os dias originais da tarefa: sem isso o algoritmo (que exclui
    // as próprias horas via excludeTaskId) encontra os mesmos dias "livres"
    // e devolve exatamente o mesmo slot.
    const blockedForTask = { ...cascadeAdditional };
    for (const a of currentAllocs) {
      blockedForTask[a.workDate] = (blockedForTask[a.workDate] ?? 0) + (a.allocatedHours ?? effort);
    }

    let newSlotsForTask = await findHourSlotsWithExtra(
      editorId, effort, now, deadline, task.id, blockedForTask, holidays,
    );

    // Se não encontrou antes do prazo, tenta com janela estendida (+15 dias úteis)
    let exceedsDeadline = false;
    if (!newSlotsForTask.possible && !deadlineExpired && rawDue) {
      const extendedDeadline = addWorkingDays(now, 15, holidays);
      const extended = await findHourSlotsWithExtra(
        editorId, effort, now, extendedDeadline, task.id, blockedForTask, holidays,
      );
      if (extended.possible) {
        newSlotsForTask = extended;
        exceedsDeadline = true;
      }
    }

    // Reserva os novos slots para que tarefas subsequentes os respeitem
    if (newSlotsForTask.possible) {
      for (const s of newSlotsForTask.slots) {
        cascadeAdditional[s.date] = (cascadeAdditional[s.date] ?? 0) + s.hours;
      }
    }

    cascade.push({
      taskId:          task.id,
      title:           task.title,
      color:           task.color,
      coordinatorName: coords.find(c => c.id === task.createdById)?.name ?? "Coordenador",
      dueDate:         rawDue ? toDateStr(rawDue) : null,
      deadlineExpired,
      exceedsDeadline,
      originalSlots:   currentAllocs.map(a => ({
        date:      a.workDate,
        hours:     a.allocatedHours ?? 0,
        startTime: a.startTime ?? "08:00",
        endTime:   a.endTime   ?? "18:00",
      })),
      newSlots:        newSlotsForTask.slots,
      possible:        newSlotsForTask.possible,
    });
  }

  res.json({ feasible: cascade.every(c => c.possible), cascade });
});

// ── POST /api/escala/confirm-displacement ────────────────────────────────────
// Aplica atomicamente: aloca nova tarefa + realoca todas as tarefas deslocadas.
router.post("/escala/confirm-displacement", requireCoordinator, async (req, res): Promise<void> => {
  const { newTaskId, newTaskEffortHours, editorId, newTaskSlots, cascade } = req.body as {
    newTaskId:          number;
    newTaskEffortHours: number;
    editorId:           number;
    newTaskSlots:       HourSlot[];
    cascade:            { taskId: number; newSlots: HourSlot[] }[];
  };

  if (!newTaskId || !editorId || !Array.isArray(newTaskSlots) || !Array.isArray(cascade)) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }

  await db.transaction(async (tx) => {
    // Atualiza effortHours + aloca nova tarefa
    await tx.update(tasksTable)
      .set({ effortHours: newTaskEffortHours })
      .where(eq(tasksTable.id, newTaskId));

    await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, newTaskId));
    if (newTaskSlots.length > 0) {
      await tx.insert(taskAllocationsTable).values(
        newTaskSlots.map(s => ({
          taskId:         newTaskId,
          editorId,
          workDate:       s.date,
          allocatedHours: s.hours,
          startTime:      s.startTime ?? null,
          endTime:        s.endTime   ?? null,
        }))
      );
    }

    // Realoca tarefas deslocadas
    for (const item of cascade) {
      await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, item.taskId));
      if (item.newSlots.length > 0) {
        await tx.insert(taskAllocationsTable).values(
          item.newSlots.map(s => ({
            taskId:         item.taskId,
            editorId,
            workDate:       s.date,
            allocatedHours: s.hours,
            startTime:      s.startTime ?? null,
            endTime:        s.endTime   ?? null,
          }))
        );
      }
    }
  });

  broadcastTaskChange();

  // Notifica o editor sobre cada tarefa deslocada
  if (cascade.length > 0) {
    const taskIds = cascade.map(c => c.taskId);
    const taskRows = await db
      .select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(inArray(tasksTable.id, taskIds));
    const titleMap = new Map(taskRows.map(t => [t.id, t.title]));

    for (const item of cascade) {
      if (item.newSlots.length === 0) continue;
      const title   = titleMap.get(item.taskId) ?? "Tarefa";
      const newDate = item.newSlots[0].date; // primeiro dia do novo bloco
      await notify(
        editorId,
        "task_rescheduled",
        "Agenda atualizada",
        `"${title}" foi reagendada para ${newDate} por conflito com uma nova tarefa`,
        { taskId: item.taskId }
      );
    }
  }

  res.json({ ok: true });
});

// ── DELETE /api/escala/tasks/:id/allocate ────────────────────────────────────
router.delete("/escala/tasks/:id/allocate", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  await db.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId));
  await db.update(tasksTable).set({ effortHours: null }).where(eq(tasksTable.id, taskId));

  res.json({ ok: true });
});

export default router;

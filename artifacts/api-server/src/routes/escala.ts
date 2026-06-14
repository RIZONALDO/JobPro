/**
 * ESCALA — Encaixe de Slots e Cargas para Alocação Livre e Automática
 *
 * Modelo único: effortHours + allocated_hours por slot (te_task_allocations)
 */
import { Router } from "express";
import { db, tasksTable, usersTable, taskAllocationsTable, taskCoordinatorsTable, appSettingsTable } from "@workspace/db";
import { eq, ne, and, inArray, or, isNotNull, gte, lte, sql } from "drizzle-orm";
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

// Data/hora mais cedo em que effortHours terminaria com agenda vazia.
// Respeita horário de início do 1º dia e retorna o TIMESTAMP real de conclusão
// (não apenas a data) — necessário para comparação com deadline com hora explícita.
function calcTheoreticalCompletion(start: Date, effortHours: number, holidays: Set<string> = new Set()): Date {
  let remaining = roundH(effortHours);
  const d = new Date(start);
  const startDateStr = toLocalDateStr(start);
  while (remaining > 0.01) {
    const cap = dailyCapacity(d, holidays);
    if (cap > 0) {
      const dow        = d.getDay();
      const isStartDay = toLocalDateStr(d) === startDateStr;
      const offset     = isStartDay ? clockToEffortHours(start.getHours() + start.getMinutes() / 60, dow) : 0;
      const available  = Math.max(0, cap - offset);
      const use        = Math.min(available, remaining);
      remaining        = roundH(remaining - use);
      if (remaining <= 0.01) {
        // Retorna o horário real em que o trabalho TERMINA (não o próximo horário disponível).
        // Usa <= 4 para que 4h de esforço = 12:00 (não 14:00, que seria o reinício pós-almoço).
        const totalUsed = roundH(offset + use);
        const h = dow === 6
          ? 8 + totalUsed
          : totalUsed <= 4 ? 8 + totalUsed : 14 + (totalUsed - 4);
        const result = new Date(d);
        result.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
        return result;
      }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
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
// Inverso de hoursToClockTime: converte hora de relógio em horas de esforço já consumidas no dia.
// Usado para calcular o offset do horário de início no primeiro dia de trabalho.
function clockToEffortHours(clockH: number, dow: number): number {
  if (dow === 6) return Math.max(0, Math.min(clockH - 8, 5)); // sáb: linear 08–13
  if (clockH <= 8)  return 0;
  if (clockH <= 12) return clockH - 8;                 // manhã: 08–12
  if (clockH <= 14) return 4;                          // almoço 12–14 → 4h consumidas
  return Math.min(4 + (clockH - 14), 8);              // tarde: 14–18
}

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
  const startDateStr = toLocalDateStr(startDate); // para detectar o primeiro dia

  const current = new Date(startDate); // preserva horário real de início

  while (current <= deadline && remaining > 0.01) {
    if (isPastWorkday(current, now)) {
      current.setDate(current.getDate() + 1);
      current.setHours(8, 0, 0, 0);
      continue;
    }
    const dow = current.getDay();
    const cap = dailyCapacity(current, holidays);
    if (cap > 0) {
      const dbUsed      = await escalaHoursUsed(editorId, current, excludeTaskId);
      // Offset do horário de início no 1º dia
      const isStartDay  = toLocalDateStr(current) === startDateStr;
      const startOffset = isStartDay ? clockToEffortHours(startDate.getHours() + startDate.getMinutes() / 60, dow) : 0;
      // No dia do deadline, limita as horas disponíveis pelo horário de entrega
      const isDeadlineDay   = toLocalDateStr(current) === toLocalDateStr(deadline);
      const deadlineOffset  = isDeadlineDay ? clockToEffortHours(deadline.getHours() + deadline.getMinutes() / 60, dow) : cap;
      const effectiveCap    = Math.min(cap, deadlineOffset);
      const used            = Math.max(dbUsed, startOffset);
      const available       = roundH(effectiveCap - used);
      if (available > 0.01) {
        const allocate  = roundH(Math.min(available, remaining));
        const startTime = hoursToClockTime(used, dow);
        const endTime   = hoursToClockTime(roundH(used + allocate), dow);
        slots.push({ date: toDateStr(current), hours: allocate, startTime, endTime });
        remaining = roundH(remaining - allocate);
      }
    }
    current.setDate(current.getDate() + 1);
    current.setHours(8, 0, 0, 0);
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
  // Compara timestamps: calcTheoreticalCompletion retorna o horário real de conclusão,
  // então 12h que terminam às 12:00 de sábado != deadline de 10:00 no mesmo sábado.
  const theoreticalEnd         = calcTheoreticalCompletion(start, effort, holidays);
  const theoreticalMinDeadline = toLocalDateStr(theoreticalEnd);
  const windowFeasible         = theoreticalEnd.getTime() <= end.getTime();

  // Capacidade total da janela com agenda vazia, respeitando horário de início e horário do deadline.
  // Mesma lógica de findHourSlots sem ocupação (dbUsed=0).
  const windowCapacityHours = (() => {
    let total = 0;
    const d = new Date(start);
    const startDateStr = toLocalDateStr(start);
    while (toLocalDateStr(d) <= toLocalDateStr(end)) {
      const cap = dailyCapacity(d, holidays);
      if (cap > 0) {
        const dow = d.getDay();
        const isStartDay    = toLocalDateStr(d) === startDateStr;
        const startOffset   = isStartDay
          ? clockToEffortHours(start.getHours() + start.getMinutes() / 60, dow)
          : 0;
        const isDeadlineDay  = toLocalDateStr(d) === toLocalDateStr(end);
        const deadlineOffset = isDeadlineDay
          ? clockToEffortHours(end.getHours() + end.getMinutes() / 60, dow)
          : cap;
        const effectiveCap  = Math.min(cap, deadlineOffset);
        const available     = roundH(Math.max(0, effectiveCap - startOffset));
        total = roundH(total + available);
      }
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
    }
    return total;
  })();

  res.json({ target, alternatives, windowDays, calculatedDeadline, windowFeasible, theoreticalMinDeadline, windowCapacityHours });
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

  const current = new Date(startDate); // preserva horário real de início
  const startDateStr = toLocalDateStr(startDate);

  while (current <= deadline && remaining > 0.01) {
    if (isPastWorkday(current, now)) {
      current.setDate(current.getDate() + 1);
      current.setHours(8, 0, 0, 0);
      continue;
    }
    const dow = current.getDay();
    const cap = dailyCapacity(current, holidays);
    if (cap > 0) {
      const dateStr        = toDateStr(current);
      const dbUsed         = await escalaHoursUsed(editorId, current, excludeTaskId);
      const extra          = additionalOccupied?.[dateStr] ?? 0;
      const isStartDay     = toLocalDateStr(current) === startDateStr;
      const startOffset    = isStartDay ? clockToEffortHours(startDate.getHours() + startDate.getMinutes() / 60, dow) : 0;
      const isDeadlineDay  = toLocalDateStr(current) === toLocalDateStr(deadline);
      const deadlineOffset = isDeadlineDay ? clockToEffortHours(deadline.getHours() + deadline.getMinutes() / 60, dow) : cap;
      const effectiveCap   = Math.min(cap, deadlineOffset);
      const used           = Math.max(dbUsed + extra, startOffset);
      const available      = roundH(effectiveCap - used);
      if (available > 0.01) {
        const allocate  = roundH(Math.min(available, remaining));
        const startTime = hoursToClockTime(used, dow);
        const endTime   = hoursToClockTime(roundH(used + allocate), dow);
        slots.push({ date: dateStr, hours: allocate, startTime, endTime });
        remaining = roundH(remaining - allocate);
      }
    }
    current.setDate(current.getDate() + 1);
    current.setHours(8, 0, 0, 0);
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

// ── GET /api/escala/allocations-on — editores com alocações numa data ────────
// Usado pelo painel de feriados para avisar conflitos antes de salvar.
router.get("/escala/allocations-on", requireCoordinator, async (req, res): Promise<void> => {
  const date = typeof req.query.date === "string" ? req.query.date : null;
  if (!date) { res.status(400).json({ error: "date obrigatório" }); return; }

  const rows = await db
    .select({ editorId: taskAllocationsTable.editorId, name: usersTable.name })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable,  eq(taskAllocationsTable.taskId,   tasksTable.id))
    .innerJoin(usersTable,  eq(taskAllocationsTable.editorId, usersTable.id))
    .where(and(
      eq(taskAllocationsTable.workDate, date),
      inArray(tasksTable.status, ACTIVE_STATUSES),
      ne(tasksTable.taskType, "multi_task"),
    ));

  const editors = [...new Map(rows.map(r => [r.editorId, r.name])).values()];
  res.json({ editors });
});

// ── GET /api/escala/editor/:id/schedule ─────────────────────────────────────
// Retorna alocações de um editor agrupadas por data, para os próximos N dias.
router.get("/escala/editor/:id/schedule", requireCoordinator, async (req, res): Promise<void> => {
  const editorId = parseInt(req.params.id as string, 10);
  if (isNaN(editorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const now  = new Date();
  const from = typeof req.query.from === "string" ? req.query.from : toLocalDateStr(now);
  const to   = typeof req.query.to   === "string" ? req.query.to   : toLocalDateStr(addDays(now, 14));

  const coordAlias = db.$with("coord").as(
    db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
  );

  const rows = await db
    .select({
      workDate:       taskAllocationsTable.workDate,
      startTime:      taskAllocationsTable.startTime,
      endTime:        taskAllocationsTable.endTime,
      hours:          taskAllocationsTable.allocatedHours,
      taskId:         tasksTable.id,
      taskNumber:     tasksTable.taskNumber,
      taskYear:       tasksTable.taskYear,
      taskTitle:      tasksTable.title,
      client:         tasksTable.client,
      status:         tasksTable.status,
      description:    tasksTable.description,
      priority:       tasksTable.priority,
      startDate:      tasksTable.startDate,
      dueDate:        tasksTable.dueDate,
      coordId:        tasksTable.createdById,
    })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskAllocationsTable.editorId, editorId),
      gte(taskAllocationsTable.workDate, from),
      lte(taskAllocationsTable.workDate, to),
      inArray(tasksTable.status, [...ACTIVE_STATUSES, "completed"]),
      ne(tasksTable.taskType, "multi_task"),
    ))
    .orderBy(taskAllocationsTable.workDate, taskAllocationsTable.startTime);

  // Busca nomes e avatares dos coordenadores em lote
  const coordIds = [...new Set(rows.map(r => r.coordId).filter((id): id is number => id !== null))];
  const coords   = coordIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable).where(inArray(usersTable.id, coordIds))
    : [];
  const coordMap = new Map(coords.map(c => [c.id, c]));

  type SlotOut = {
    taskId: number; taskCode: string; taskTitle: string;
    client: string | null; startTime: string | null; endTime: string | null;
    hours: number | null; status: string;
    description: string | null; priority: string | null;
    startDate: string | null; dueDate: string | null;
    coordinator: { id: number; name: string; avatarUrl: string | null } | null;
  };
  const byDate = new Map<string, { date: string; slots: SlotOut[] }>();
  for (const r of rows) {
    if (!byDate.has(r.workDate)) byDate.set(r.workDate, { date: r.workDate, slots: [] });
    const coord = r.coordId ? (coordMap.get(r.coordId) ?? null) : null;
    byDate.get(r.workDate)!.slots.push({
      taskId:      r.taskId,
      taskCode:    String(r.taskNumber).padStart(3, "0") + "." + String(r.taskYear).slice(-2),
      taskTitle:   r.taskTitle,
      client:      r.client,
      startTime:   r.startTime,
      endTime:     r.endTime,
      hours:       r.hours,
      status:      r.status,
      description: r.description ?? null,
      priority:    r.priority ?? null,
      startDate:   r.startDate ? toDateStr(r.startDate instanceof Date ? r.startDate : new Date(r.startDate as any)) : null,
      dueDate:     r.dueDate   ? toDateStr(r.dueDate   instanceof Date ? r.dueDate   : new Date(r.dueDate   as any)) : null,
      coordinator: coord ? { id: coord.id, name: coord.name, avatarUrl: coord.avatarUrl } : null,
    });
  }

  res.json([...byDate.values()]);
});

// ── GET /api/my-schedule ─────────────────────────────────────────────────────
// Retorna os slots de alocação futuros do editor logado (um slot = um dia de trabalho).
// Usado na tab Agendadas para mostrar tarefas intercaladas corretamente.
router.get("/my-schedule", async (req: any, res: any): Promise<void> => {
  const editorId = req.session?.userId;
  if (!editorId) { res.status(401).json({ error: "Não autenticado" }); return; }

  const now  = new Date();
  const from = toLocalDateStr(now);
  const to   = typeof req.query.to === "string" ? req.query.to : toLocalDateStr(addDays(now, 90));

  const rows = await db
    .select({
      workDate:   taskAllocationsTable.workDate,
      startTime:  taskAllocationsTable.startTime,
      endTime:    taskAllocationsTable.endTime,
      hours:      taskAllocationsTable.allocatedHours,
      taskId:     tasksTable.id,
      taskNumber: tasksTable.taskNumber,
      taskYear:   tasksTable.taskYear,
      taskTitle:  tasksTable.title,
      client:     tasksTable.client,
      status:     tasksTable.status,
      priority:   tasksTable.priority,
      revisionCount: tasksTable.revisionCount,
      createdById:   tasksTable.createdById,
    })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskAllocationsTable.editorId, editorId),
      gte(taskAllocationsTable.workDate, from),
      lte(taskAllocationsTable.workDate, to),
      inArray(tasksTable.status, ACTIVE_STATUSES),
      ne(tasksTable.taskType, "multi_task"),
    ))
    .orderBy(taskAllocationsTable.workDate, taskAllocationsTable.startTime);

  const coordIds = [...new Set(rows.map(r => r.createdById).filter((id): id is number => id !== null))];
  const coords   = coordIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable).where(inArray(usersTable.id, coordIds))
    : [];
  const coordMap = new Map(coords.map(c => [c.id, c]));

  const slots = rows.map(r => ({
    workDate:      r.workDate,
    startTime:     r.startTime,
    endTime:       r.endTime,
    hours:         r.hours,
    taskId:        r.taskId,
    taskCode:      String(r.taskNumber).padStart(3, "0") + "." + String(r.taskYear).slice(-2),
    taskTitle:     r.taskTitle,
    client:        r.client,
    color:         null,
    status:        r.status,
    priority:      r.priority,
    revisionCount: r.revisionCount ?? 0,
    coordinator:   r.createdById ? (coordMap.get(r.createdById) ?? null) : null,
  }));

  res.json(slots);
});

// ── GET /api/coordinator-schedule ────────────────────────────────────────────
// Retorna slots de alocação futuros de todas as tarefas do coordenador logado.
router.get("/coordinator-schedule", requireCoordinator, async (req: any, res: any): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Não autenticado" }); return; }

  const now  = new Date();
  const from = toLocalDateStr(now);
  const to   = typeof req.query.to === "string" ? req.query.to : toLocalDateStr(addDays(now, 90));

  // IDs das tarefas que o coordenador criou ou é co-coordenador
  const coCoordTaskIds = await db
    .select({ taskId: taskCoordinatorsTable.taskId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.userId, userId));
  const coIds = coCoordTaskIds.map(r => r.taskId);

  const taskCondition = coIds.length > 0
    ? or(eq(tasksTable.createdById, userId), inArray(tasksTable.id, coIds))!
    : eq(tasksTable.createdById, userId);

  const rows = await db
    .select({
      workDate:      taskAllocationsTable.workDate,
      startTime:     taskAllocationsTable.startTime,
      endTime:       taskAllocationsTable.endTime,
      hours:         taskAllocationsTable.allocatedHours,
      taskId:        tasksTable.id,
      taskNumber:    tasksTable.taskNumber,
      taskYear:      tasksTable.taskYear,
      taskTitle:     tasksTable.title,
      client:        tasksTable.client,
      status:        tasksTable.status,
      priority:      tasksTable.priority,
      revisionCount: tasksTable.revisionCount,
      editorId:      tasksTable.assignedToId,
    })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      taskCondition,
      gte(taskAllocationsTable.workDate, from),
      lte(taskAllocationsTable.workDate, to),
      inArray(tasksTable.status, ACTIVE_STATUSES),
      ne(tasksTable.taskType, "multi_task"),
    ))
    .orderBy(taskAllocationsTable.workDate, taskAllocationsTable.startTime);

  // Busca nomes dos editores em lote
  const editorIds = [...new Set(rows.map(r => r.editorId).filter((id): id is number => id !== null))];
  const editors   = editorIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable).where(inArray(usersTable.id, editorIds))
    : [];
  const editorMap = new Map(editors.map(e => [e.id, e]));

  const slots = rows.map(r => ({
    workDate:      r.workDate,
    startTime:     r.startTime,
    endTime:       r.endTime,
    hours:         r.hours,
    taskId:        r.taskId,
    taskCode:      String(r.taskNumber).padStart(3, "0") + "." + String(r.taskYear).slice(-2),
    taskTitle:     r.taskTitle,
    client:        r.client,
    color:         null,
    status:        r.status,
    priority:      r.priority,
    revisionCount: r.revisionCount ?? 0,
    editor:        r.editorId ? (editorMap.get(r.editorId) ?? null) : null,
  }));

  res.json(slots);
});

// ── syncTaskDates ─────────────────────────────────────────────────────────────
// Recalcula startDate e dueDate da tarefa a partir das alocações reais.
// startDate = data+hora do primeiro slot; dueDate = data+hora do último slot.
async function syncTaskDates(taskId: number): Promise<void> {
  const allocs = await db
    .select({
      workDate:  taskAllocationsTable.workDate,
      startTime: taskAllocationsTable.startTime,
      endTime:   taskAllocationsTable.endTime,
    })
    .from(taskAllocationsTable)
    .where(eq(taskAllocationsTable.taskId, taskId))
    .orderBy(taskAllocationsTable.workDate, taskAllocationsTable.startTime);

  if (allocs.length === 0) return;

  const first = allocs[0];
  const last  = allocs[allocs.length - 1];

  // Constrói datetimes locais: "YYYY-MM-DDTHH:MM:00"
  const newStart = new Date(`${first.workDate}T${first.startTime ?? "08:00"}:00`);
  const newDue   = new Date(`${last.workDate}T${last.endTime   ?? "18:00"}:00`);

  await db.update(tasksTable)
    .set({ startDate: newStart, dueDate: newDue })
    .where(eq(tasksTable.id, taskId));
}

// ── POST /api/escala/tasks/:id/resize-slot ───────────────────────────────────
// Atualiza startTime / endTime / allocatedHours de um slot específico.
router.post("/escala/tasks/:id/resize-slot", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string, 10);
  const { workDate, newWorkDate, startTime, endTime, allocatedHours } = req.body as {
    workDate: string; newWorkDate?: string; startTime: string; endTime: string; allocatedHours: number;
  };

  if (!workDate || !startTime || !endTime || allocatedHours == null) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }

  await db.update(taskAllocationsTable)
    .set({ workDate: newWorkDate ?? workDate, startTime, endTime, allocatedHours })
    .where(and(eq(taskAllocationsTable.taskId, taskId), eq(taskAllocationsTable.workDate, workDate)));

  await syncTaskDates(taskId);
  broadcastTaskChange();
  res.json({ ok: true });
});

// ── POST /api/escala/tasks/:id/add-day ──────────────────────────────────────
// Upsert de um slot em um dia específico (usado para "estender" — mantém slot original).
router.post("/escala/tasks/:id/add-day", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id as string, 10);
  const { workDate, startTime, endTime, allocatedHours } = req.body as {
    workDate: string; startTime: string; endTime: string; allocatedHours: number;
  };
  if (!workDate || !startTime || !endTime || allocatedHours == null) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }
  const [task] = await db.select({ editorId: tasksTable.assignedToId })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task?.editorId) { res.status(404).json({ error: "Tarefa sem editor" }); return; }

  await db.insert(taskAllocationsTable)
    .values({ taskId, editorId: task.editorId, workDate, startTime, endTime, allocatedHours })
    .onConflictDoUpdate({
      target: [taskAllocationsTable.taskId, taskAllocationsTable.workDate],
      set: { startTime, endTime, allocatedHours },
    });

  await syncTaskDates(taskId);
  broadcastTaskChange();
  res.json({ ok: true });
});

// ── DELETE /api/escala/tasks/:id/remove-day ──────────────────────────────────
// Remove a alocação de um dia específico sem excluir a tarefa.
router.delete("/escala/tasks/:id/remove-day", requireCoordinator, async (req, res): Promise<void> => {
  const taskId  = parseInt(req.params.id as string);
  const workDate = req.query.workDate as string;
  if (isNaN(taskId) || !workDate) { res.status(400).json({ error: "Parâmetros inválidos" }); return; }

  await db.delete(taskAllocationsTable)
    .where(and(eq(taskAllocationsTable.taskId, taskId), eq(taskAllocationsTable.workDate, workDate)));

  await syncTaskDates(taskId);
  broadcastTaskChange();
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

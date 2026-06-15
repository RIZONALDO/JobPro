import { Router } from "express";
import { db, tasksTable, usersTable, taskRevisionsTable, taskEventsTable, taskEditorsTable, taskFilesTable, taskCoordinatorsTable, reviewCommentsTable, reviewReadsTable, taskAllocationsTable, appSettingsTable } from "@workspace/db";
import { eq, ne, desc, asc, and, or, gte, lte, isNotNull, lt, inArray, isNull, sql, like } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { broadcastTaskChange, broadcastSubtaskProgress, broadcastSubtaskChanged } from "../lib/broadcast.js";
import { createFeedItem } from "../lib/feed.js";

const router = Router();

// ── ESCALA re-alocação ────────────────────────────────────────────────────────
const DAILY_CAP_REALLOC = (dow: number) => (dow === 0 ? 0 : dow === 6 ? 5 : 8);
const WORK_START = 8;
function toDateStrLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
// Date-only strings (no "T") são parseadas como UTC midnight, causando drift em fuso UTC-3.
// Este helper normaliza para noon local, garantindo que a data extraída via toDateStrLocal() seja sempre correta.
function parseDateSafe(raw: unknown): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  // Com offset explícito ou timestamp: parse direto
  const d = s.includes("T") ? new Date(s) : new Date(s + "T12:00:00");
  return isNaN(d.getTime()) ? "invalid" : d;
}
function hoursToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

// ── Regras de expediente ──────────────────────────────────────────────────────
// Horário de encerramento por dia da semana (local): seg-sex 17:30, sab 13:00
const BUSINESS_END: Record<number, number> = { 1: 17.5, 2: 17.5, 3: 17.5, 4: 17.5, 5: 17.5, 6: 13.0 };

async function getHolidays(): Promise<Set<string>> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "calendar_holidays"));
  try {
    const arr = JSON.parse(row?.value ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function isWorkingDay(d: Date, holidays: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 0) return false; // domingo
  return !holidays.has(toDateStrLocal(d));
}

// Retorna o próximo dia útil a partir de `from` (exclusivo — não inclui o próprio `from`)
function nextWorkingDay(from: Date, holidays: Set<string>): Date {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0); // noon local, evita drift
  do { d.setDate(d.getDate() + 1); } while (!isWorkingDay(d, holidays));
  return d;
}

// Retorna true se o horário atual já passou do encerramento do expediente (ou é domingo)
function isAfterBusinessHours(now: Date, holidays: Set<string>): boolean {
  const dow = now.getDay();
  if (!isWorkingDay(now, holidays)) return true;
  const endH = BUSINESS_END[dow];
  if (endH === undefined) return true; // dia sem expediente definido
  const currentH = now.getHours() + now.getMinutes() / 60;
  return currentH >= endH;
}

// Capacidade bruta de um dia (sem considerar carga existente)
function dailyCapBrute(d: Date, holidays: Set<string>): number {
  if (!isWorkingDay(d, holidays)) return 0;
  return d.getDay() === 6 ? 5 : 8;
}

// Data mais cedo possível para concluir effortHours a partir de start (agenda vazia)
// Usado para validar se a janela [start, deadline] é matematicamente possível
function calcMinDeadline(start: Date, effortHours: number, holidays: Set<string>): Date {
  let remaining = Math.round(effortHours * 100) / 100;
  const d = new Date(start);
  d.setHours(8, 0, 0, 0);
  while (remaining > 0.01) {
    const cap = dailyCapBrute(d, holidays);
    if (cap > 0) {
      remaining = Math.round((remaining - Math.min(cap, remaining)) * 100) / 100;
      if (remaining <= 0.01) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return d;
}

// Calcula o startDate efetivo para uma nova tarefa:
// - Dentro do expediente: hoje (noon local)
// - Após o expediente ou feriado/domingo: próximo dia útil
async function effectiveStartDate(holidays: Set<string>): Promise<Date> {
  const now = new Date();
  if (isAfterBusinessHours(now, holidays)) {
    return nextWorkingDay(now, holidays);
  }
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return today;
}

/**
 * Re-calcula alocações para uma tarefa ESCALA quando effortHours muda.
 * Não faz cascata — apenas procura os próximos slots livres do editor.
 */
async function reallocTask(
  taskId:      number,
  editorId:    number,
  effortHours: number,
  startDate:   Date | null,
  deadline:    Date | null,
): Promise<void> {
  const now      = new Date();
  const start    = startDate && startDate > now ? startDate : now;
  const end      = deadline && deadline > now
    ? deadline
    : new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // +15 dias corridos

  const slots: { workDate: string; allocatedHours: number; startTime: string; endTime: string }[] = [];
  let remaining = effortHours;

  const current = new Date(start);
  current.setHours(12, 0, 0, 0);

  while (current <= end && remaining > 0.01) {
    const ds  = toDateStrLocal(current);
    const dow = current.getDay();
    const cap = DAILY_CAP_REALLOC(dow);

    if (cap > 0) {
      const [usedRow] = await db
        .select({ total: sql<number>`COALESCE(SUM(${taskAllocationsTable.allocatedHours}), 0)::float` })
        .from(taskAllocationsTable)
        .where(and(
          eq(taskAllocationsTable.editorId, editorId),
          eq(taskAllocationsTable.workDate, ds),
          ne(taskAllocationsTable.taskId, taskId),
          isNotNull(taskAllocationsTable.allocatedHours),
        ));
      const used      = Number(usedRow?.total ?? 0);
      const available = Math.round((cap - used) * 100) / 100;

      if (available > 0.01) {
        const allocate = Math.round(Math.min(available, remaining) * 100) / 100;
        const startH   = WORK_START + used;
        slots.push({
          workDate:       ds,
          allocatedHours: allocate,
          startTime:      hoursToTime(startH),
          endTime:        hoursToTime(startH + allocate),
        });
        remaining = Math.round((remaining - allocate) * 100) / 100;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  await db.transaction(async tx => {
    await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId));
    if (slots.length > 0) {
      await tx.insert(taskAllocationsTable).values(
        slots.map(s => ({ taskId, editorId, ...s }))
      );
    }
  });
}

// Retorna os userIds dos co-coordenadores de uma tarefa (exclui o titular)
async function getCoCoordIds(taskId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: taskCoordinatorsTable.userId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.taskId, taskId));
  return rows.map(r => r.userId);
}

// Verifica se userId é co-coord da tarefa
async function isCoCoord(taskId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ userId: taskCoordinatorsTable.userId })
    .from(taskCoordinatorsTable)
    .where(and(eq(taskCoordinatorsTable.taskId, taskId), eq(taskCoordinatorsTable.userId, userId)));
  return !!row;
}

// Notifica titular + todos os co-coords de uma tarefa
async function notifyAllCoords(
  task: { id: number; createdById: number | null },
  excludeUserId: number | null,
  type: string,
  title: string,
  message: string,
) {
  const coIds = await getCoCoordIds(task.id);
  const targets = [...new Set([
    ...(task.createdById ? [task.createdById] : []),
    ...coIds,
  ])].filter(id => id !== excludeUserId);
  await Promise.all(targets.map(uid => notify(uid, type, title, message, { taskId: task.id })));
}

function fmtCode(num: number, year: number): string {
  return `${String(num).padStart(3, "0")}.${String(year).padStart(2, "0")}`;
}

const dueDateKey = (d: Date | string | null | undefined): string => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
};

// ── Utility: recalculate parent multi_task status based on subtasks ──────────
async function recalculateParentStatus(parentId: number, changedById: number): Promise<void> {
  try {
    const subtasks = await db
      .select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, parentId));

    if (subtasks.length === 0) return;

    const [parent] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, parentId));
    if (!parent) return;

    const allCompleted   = subtasks.every(s => s.status === "completed");
    const allCancelled   = subtasks.every(s => s.status === "cancelled");
    const anyActive      = subtasks.some(s => ["in_progress", "review", "reopened"].includes(s.status));
    const anyPending     = subtasks.some(s => s.status === "pending");

    let newStatus: string | null = null;

    if (allCompleted && parent.status !== "completed") {
      newStatus = "completed";
    } else if (allCancelled && parent.status !== "cancelled") {
      newStatus = "cancelled";
    } else if (anyActive && parent.status === "pending") {
      newStatus = "in_progress";
    } else if (!anyActive && anyPending && parent.status === "in_progress") {
      newStatus = "pending";
    }

    if (!newStatus) return;

    await db
      .update(tasksTable)
      .set({ status: newStatus })
      .where(eq(tasksTable.id, parentId));

    // Limpa alocações ESCALA do pai quando completa/cancela por rollup de subtarefas
    if (newStatus === "completed" || newStatus === "cancelled") {
      await db.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, parentId));
    }

    await db.insert(taskEventsTable).values({
      taskId: parentId,
      fromStatus: parent.status,
      toStatus: newStatus,
      changedById,
    });

    // Notify coordinator when multi_task auto-completes
    if (newStatus === "completed" && parent.createdById) {
      await notify(
        parent.createdById,
        "task_approved",
        "Multi-tarefa concluída",
        `Todas as subtarefas de "${parent.title}" foram concluídas`,
        { taskId: parentId }
      );
    }

    // Broadcast progress update
    const completed = subtasks.filter(s => s.status === "completed").length;
    broadcastSubtaskProgress(parentId, {
      total: subtasks.length,
      completed,
      percentage: Math.round((completed / subtasks.length) * 100),
    });

    broadcastTaskChange();
  } catch (err) {
    console.error("[recalculateParentStatus] error:", err);
  }
}

// ── Helper: get subtask progress for a list of parent task IDs ───────────────
async function getSubtaskProgressMap(parentIds: number[]): Promise<Map<number, { total: number; completed: number; inProgress: number; pending: number; percentage: number }>> {
  const map = new Map<number, { total: number; completed: number; inProgress: number; pending: number; percentage: number }>();
  if (parentIds.length === 0) return map;

  const rows = await db
    .select({ parentTaskId: tasksTable.parentTaskId, status: tasksTable.status })
    .from(tasksTable)
    .where(inArray(tasksTable.parentTaskId, parentIds));

  for (const row of rows) {
    const pid = row.parentTaskId!;
    if (!map.has(pid)) map.set(pid, { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 });
    const entry = map.get(pid)!;
    entry.total++;
    if (row.status === "completed") entry.completed++;
    else if (["in_progress", "review", "reopened"].includes(row.status)) entry.inProgress++;
    else if (row.status === "pending") entry.pending++;
  }

  // Compute percentage after all rows processed
  for (const [, entry] of map) {
    entry.percentage = entry.total > 0 ? Math.round((entry.completed / entry.total) * 100) : 0;
  }

  return map;
}

// ── Create task ──────────────────────────────────────────────────────────────
router.post("/tasks", requireCoordinator, async (req, res): Promise<void> => {
  const { title, description, startDate, dueDate, priority, complexity, assignedToId, editorIds,
          folderUrl, client, status, taskType, parentTaskId, subtasks, effortHours } = req.body ?? {};

  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  const resolvedType: string = taskType === "multi_task" ? "multi_task" : "task";
  const parsedAssignee = assignedToId ? parseInt(String(assignedToId), 10) : null;
  const initialStatus = status === "rascunho" ? "rascunho" : "pending";

  // Valida e parseia datas usando parseDateSafe (evita drift UTC com date-only strings)
  const parsedStart = parseDateSafe(startDate);
  const parsedDue   = parseDateSafe(dueDate);
  if (parsedStart === "invalid") { res.status(400).json({ error: "Data de início inválida" }); return; }
  if (parsedDue   === "invalid") { res.status(400).json({ error: "Prazo inválido" }); return; }
  if (parsedStart && parsedDue && parsedStart > parsedDue) {
    res.status(400).json({ error: "A data de início não pode ser depois do prazo" }); return;
  }

  // ── Regras de expediente (apenas para tarefas publicadas, não rascunhos) ──────
  const holidays = await getHolidays();
  const todayStr = toDateStrLocal(new Date());

  // Prazo retroativo: dueDate no passado nunca é permitido
  if (parsedDue && initialStatus !== "rascunho") {
    if (toDateStrLocal(parsedDue) < todayStr) {
      res.status(400).json({ error: "O prazo não pode ser uma data passada" }); return;
    }
  }

  // startDate: se informado no passado, rejeita
  let resolvedStart: Date | null = parsedStart;
  if (parsedStart && initialStatus !== "rascunho") {
    const startStr = toDateStrLocal(parsedStart);
    if (startStr < todayStr) {
      res.status(400).json({ error: "A data de início não pode ser retroativa" }); return;
    }
    // startDate = hoje mas já passou do expediente → avança para próximo dia útil
    if (startStr === todayStr && isAfterBusinessHours(new Date(), holidays)) {
      resolvedStart = nextWorkingDay(new Date(), holidays);
    }
  }

  // startDate não informado → calcula automaticamente (hoje ou próximo dia útil)
  if (!resolvedStart && initialStatus !== "rascunho") {
    resolvedStart = await effectiveStartDate(holidays);
  }

  // Valida que o resolvedStart (após auto-shift) não ultrapassa o dueDate
  if (resolvedStart && parsedDue && initialStatus !== "rascunho") {
    if (toDateStrLocal(resolvedStart) > toDateStrLocal(parsedDue)) {
      res.status(400).json({ error: "O prazo precisa ser posterior à data de início. Verifique as datas." }); return;
    }
  }

  // Valida viabilidade da janela: effortHours precisa caber entre startDate e dueDate
  // mesmo com agenda completamente vazia (se não cabe assim, nunca vai caber)
  if (resolvedStart && parsedDue && effortHours != null && initialStatus !== "rascunho") {
    const effort = parseFloat(String(effortHours));
    if (!isNaN(effort) && effort > 0) {
      const minEnd    = calcMinDeadline(resolvedStart, effort, holidays);
      const minEndStr = toDateStrLocal(minEnd);
      const dueStr    = toDateStrLocal(parsedDue);
      if (dueStr < minEndStr) {
        res.status(400).json({
          error: `Janela inviável: ${effort}h de trabalho requer prazo mínimo de ${minEndStr}. O prazo informado (${dueStr}) é insuficiente.`,
          code: "WINDOW_TOO_TIGHT",
          theoreticalMinDeadline: minEndStr,
        });
        return;
      }
    }
  }

  // Multi-task doesn't require editor or dueDate at the parent level
  if (resolvedType !== "multi_task") {
    if (initialStatus === "pending" && !parsedDue) {
      res.status(400).json({ error: "Informe o prazo antes de publicar a tarefa" }); return;
    }
    const allEditorIdsCheck = new Set<number>();
    if (parsedAssignee) allEditorIdsCheck.add(parsedAssignee);
    if (Array.isArray(editorIds)) editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIdsCheck.add(n));
    if (initialStatus === "pending" && allEditorIdsCheck.size === 0) {
      res.status(400).json({ error: "Atribua ao menos um editor para publicar a tarefa" }); return;
    }
  }

  // Multi-task must have at least one subtask to be published
  if (resolvedType === "multi_task" && initialStatus === "pending") {
    const incomingSubtasks = Array.isArray(subtasks) ? subtasks : [];
    if (incomingSubtasks.length === 0) {
      res.status(400).json({ error: "Adicione ao menos uma subtarefa antes de publicar a multi-tarefa" }); return;
    }
  }

  // Capacidade gerenciada pelo ESCALA — sem bloqueio por pontos legado.

  const seqResult = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
  const taskNumber = Number((seqResult.rows ?? seqResult)[0].nextval);
  const taskYear = new Date().getFullYear() % 100;

  const [task] = await db.insert(tasksTable).values({
    taskNumber,
    taskYear,
    title: String(title),
    description: description ? String(description) : null,
    client: client ? String(client) : null,
    startDate: resolvedStart,
    dueDate: parsedDue,
    priority: priority ?? "medium",
    complexity: complexity ?? "medium",
    status: initialStatus,
    assignedToId: resolvedType === "multi_task" ? null : parsedAssignee,
    folderUrl: folderUrl ? String(folderUrl) : null,
    createdById: req.session.userId,
    taskType: resolvedType,
    effortHours: effortHours != null ? parseFloat(String(effortHours)) : null,
  }).returning();

  // For regular tasks: add editors to junction table
  if (resolvedType !== "multi_task") {
    const allEditorIds = new Set<number>();
    if (parsedAssignee) allEditorIds.add(parsedAssignee);
    if (Array.isArray(editorIds)) {
      editorIds.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => allEditorIds.add(n));
    }
    for (const editorId of allEditorIds) {
      await db.insert(taskEditorsTable).values({
        taskId: task.id,
        userId: editorId,
        assignedById: req.session.userId,
      }).onConflictDoNothing();
      if (initialStatus !== "rascunho") {
        await notify(editorId, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi atribuída a você`,
          { taskId: task.id }
        );
      }
    }
  }

  // For multi_task: create subtasks from the subtasks array
  if (resolvedType === "multi_task" && Array.isArray(subtasks)) {
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      if (!sub?.title) continue;

      const subAssigneeId = sub.editorId ? parseInt(String(sub.editorId), 10) : null;
      const subSeq = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
      const subNumber = Number((subSeq.rows ?? subSeq)[0].nextval);

      const [subtask] = await db.insert(tasksTable).values({
        taskNumber: subNumber,
        taskYear,
        title: String(sub.title),
        description: sub.description ? String(sub.description) : null,
        client: client ? String(client) : null,
        dueDate: (() => { const d = parseDateSafe(sub.dueDate) ?? parseDateSafe(dueDate); return d && d !== "invalid" ? d : null; })(),
        priority: sub.priority ?? priority ?? "medium",
        complexity: sub.complexity ?? complexity ?? "medium",
        status: initialStatus === "rascunho" ? "rascunho" : "pending",
        assignedToId: subAssigneeId,
        folderUrl: null,
        createdById: req.session.userId,
        taskType: "subtask",
        parentTaskId: task.id,
        subtaskOrder: i,
      }).returning();

      if (subAssigneeId) {
        await db.insert(taskEditorsTable).values({
          taskId: subtask.id,
          userId: subAssigneeId,
          assignedById: req.session.userId,
        }).onConflictDoNothing();
        if (initialStatus !== "rascunho") {
          await notify(subAssigneeId, "task_assigned",
            "Nova subtarefa atribuída",
            `Você foi atribuído à subtarefa "${subtask.title}" da multi-tarefa "${task.title}"`,
            { taskId: subtask.id }
          );
        }
      }
    }
  }

  broadcastTaskChange();
  res.status(201).json(task);
});

// ── Overview (coordinator: all tasks created by coordinators) ────────────────
router.get("/tasks/overview", requireCoordinator, async (req, res): Promise<void> => {
  const { status, assignedToId, createdById } = req.query;
  const userId = req.session.userId!;

  const coordUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, ["coordinator", "supervisor", "admin"]));
  const coordIds = coordUsers.map(u => u.id);
  if (coordIds.length === 0) { res.json([]); return; }

  // Tarefas onde o user é co-coord (para incluir no overview)
  const coCoordTaskRows = await db
    .select({ taskId: taskCoordinatorsTable.taskId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.userId, userId));
  const coCoordTaskIds = coCoordTaskRows.map(r => r.taskId);

  // Condição base: leva em conta o filtro de createdById sem excluir co-coord tasks
  const parsedCreatedBy = createdById ? parseInt(String(createdById), 10) : null;
  const ownedByCoord = parsedCreatedBy
    ? and(inArray(tasksTable.createdById, coordIds), eq(tasksTable.createdById, parsedCreatedBy))!
    : inArray(tasksTable.createdById, coordIds);

  const ownerCondition = coCoordTaskIds.length
    ? or(ownedByCoord, inArray(tasksTable.id, coCoordTaskIds))!
    : ownedByCoord;

  const conditions: any[] = [
    ownerCondition,
    // Only show root tasks (multi_tasks and regular tasks), not subtasks
    isNull(tasksTable.parentTaskId),
  ];

  if (status === "active") {
    conditions.push(ne(tasksTable.status, "completed"));
    conditions.push(ne(tasksTable.status, "cancelled"));
  } else if (status && status !== "all") {
    conditions.push(eq(tasksTable.status, String(status)));
  } else if (!status) {
    conditions.push(ne(tasksTable.status, "completed"));
    conditions.push(ne(tasksTable.status, "cancelled"));
  }
  if (assignedToId) conditions.push(eq(tasksTable.assignedToId, parseInt(String(assignedToId), 10)));
  // createdById já integrado no ownerCondition acima

  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt));

  const taskIds = rows.map(r => r.id);
  const multiTaskIds = rows.filter(r => r.taskType === "multi_task").map(r => r.id);

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter((id): id is number => id !== null))];

  const persons = personIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, personIds))
    : [];
  const personMap = new Map(persons.map(p => [p.id, p]));

  // Co-coordenadores por tarefa
  const coCoordRows = taskIds.length
    ? await db
        .select({
          taskId:    taskCoordinatorsTable.taskId,
          userId:    usersTable.id,
          name:      usersTable.name,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(taskCoordinatorsTable)
        .innerJoin(usersTable, eq(taskCoordinatorsTable.userId, usersTable.id))
        .where(inArray(taskCoordinatorsTable.taskId, taskIds))
    : [];
  const coCoordMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const c of coCoordRows) {
    if (!coCoordMap.has(c.taskId)) coCoordMap.set(c.taskId, []);
    coCoordMap.get(c.taskId)!.push({ id: c.userId, name: c.name, avatarUrl: c.avatarUrl });
  }

  const editorRows = taskIds.length
    ? await db
        .select({
          taskId: taskEditorsTable.taskId,
          userId: usersTable.id,
          name: usersTable.name,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(taskEditorsTable)
        .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, taskIds))
    : [];

  const editorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of editorRows) {
    if (!editorsMap.has(e.taskId)) editorsMap.set(e.taskId, []);
    editorsMap.get(e.taskId)!.push({ id: e.userId, name: e.name, avatarUrl: e.avatarUrl });
  }

  // Get subtask progress for multi_tasks
  const progressMap = await getSubtaskProgressMap(multiTaskIds);

  // reviewedAt: quando a tarefa foi enviada para review pela PRIMEIRA vez
  const overviewReviewEvents = taskIds.length
    ? await db.select({ taskId: taskEventsTable.taskId, createdAt: taskEventsTable.createdAt })
        .from(taskEventsTable)
        .where(and(inArray(taskEventsTable.taskId, taskIds), eq(taskEventsTable.toStatus, "review")))
        .orderBy(asc(taskEventsTable.createdAt))
    : [];
  const overviewReviewedAtMap = new Map<number, Date>();
  for (const e of overviewReviewEvents) {
    if (!overviewReviewedAtMap.has(e.taskId)) overviewReviewedAtMap.set(e.taskId, e.createdAt);
  }

  // Fetch editors from subtasks for multi_task parents (item 8)
  const subtaskEditorRows = multiTaskIds.length
    ? await db
        .select({
          parentTaskId: tasksTable.parentTaskId,
          assignedToId: tasksTable.assignedToId,
        })
        .from(tasksTable)
        .where(and(inArray(tasksTable.parentTaskId, multiTaskIds), isNotNull(tasksTable.assignedToId)))
    : [];

  const subtaskAssigneeIds = [...new Set(subtaskEditorRows.map(r => r.assignedToId).filter(Boolean))] as number[];
  const subtaskAssignees = subtaskAssigneeIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, subtaskAssigneeIds))
    : [];
  const subtaskAssigneeMap = new Map(subtaskAssignees.map(u => [u.id, u]));

  // Build map: parentTaskId -> unique editors from subtasks
  const subtaskEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const row of subtaskEditorRows) {
    const pid = row.parentTaskId!;
    const uid = row.assignedToId!;
    if (!subtaskEditorsMap.has(pid)) subtaskEditorsMap.set(pid, []);
    const person = subtaskAssigneeMap.get(uid);
    if (person && !subtaskEditorsMap.get(pid)!.some(e => e.id === uid)) {
      subtaskEditorsMap.get(pid)!.push({ id: person.id, name: person.name, avatarUrl: person.avatarUrl });
    }
  }

  // File count + kind per task
  const overviewFileCounts = taskIds.length
    ? await db.select({
        taskId:   taskFilesTable.taskId,
        count:    sql<number>`count(*)::int`,
        hasVideo: sql<boolean>`bool_or(${taskFilesTable.mimeType} LIKE 'video/%')`,
        hasAudio: sql<boolean>`bool_or(${taskFilesTable.mimeType} LIKE 'audio/%')`,
      })
        .from(taskFilesTable).where(inArray(taskFilesTable.taskId, taskIds))
        .groupBy(taskFilesTable.taskId)
    : [];
  const overviewFileCountMap = new Map(overviewFileCounts.map(r => [r.taskId, Number(r.count)]));
  const overviewFileKindMap  = new Map(overviewFileCounts.map(r => [
    r.taskId,
    r.hasVideo && r.hasAudio ? "mixed" : r.hasVideo ? "video" : r.hasAudio ? "audio" : "other",
  ]));

  // Unread review comment count per task (comments not by current user, after last_read_at)
  const overviewUnreadComments = taskIds.length
    ? await db
        .select({ taskId: reviewCommentsTable.taskId, count: sql<number>`count(*)::int` })
        .from(reviewCommentsTable)
        .leftJoin(
          reviewReadsTable,
          and(eq(reviewReadsTable.taskId, reviewCommentsTable.taskId), eq(reviewReadsTable.userId, userId))
        )
        .where(and(
          inArray(reviewCommentsTable.taskId, taskIds),
          ne(reviewCommentsTable.userId, userId),
          or(isNull(reviewReadsTable.lastReadAt), sql`${reviewCommentsTable.createdAt} > ${reviewReadsTable.lastReadAt}`)
        ))
        .groupBy(reviewCommentsTable.taskId)
    : [];
  const overviewReviewCommentMap = new Map(overviewUnreadComments.map(r => [r.taskId, Number(r.count)]));

  // Alocações (todas as datas) para calcular slotIndex/totalSlots por tarefa ESCALA
  const overviewTodayStr = new Date().toISOString().slice(0, 10);
  const overviewAllAllocs = taskIds.length
    ? await db.select({ taskId: taskAllocationsTable.taskId, workDate: taskAllocationsTable.workDate })
        .from(taskAllocationsTable)
        .where(and(
          inArray(taskAllocationsTable.taskId, taskIds),
          sql`${taskAllocationsTable.allocatedHours} > 0`,
        ))
        .orderBy(taskAllocationsTable.workDate)
    : [];
  const overviewSlotDates = new Map<number, string[]>();
  for (const a of overviewAllAllocs) {
    if (!overviewSlotDates.has(a.taskId)) overviewSlotDates.set(a.taskId, []);
    overviewSlotDates.get(a.taskId)!.push(a.workDate);
  }
  const getOverviewSlot = (taskId: number) => {
    const dates  = overviewSlotDates.get(taskId) ?? [];
    const idx    = dates.indexOf(overviewTodayStr);
    return {
      hasAllocToday:  idx >= 0,
      todaySlotIndex: idx >= 0 ? idx + 1 : null,
      totalSlots:     dates.length > 1 ? dates.length : null,
    };
  };

  res.json(rows.map(r => ({
    id: r.id,
    taskCode: fmtCode(r.taskNumber, r.taskYear),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    complexity: r.complexity,
    startDate: r.startDate,
    dueDate: r.dueDate,
    folderUrl: r.folderUrl,
    revisionCount: r.revisionCount ?? 0,
    client: r.client,
    taskType: r.taskType,
    parentTaskId: r.parentTaskId,
    assignee: r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
    editors: r.taskType === "multi_task"
      ? subtaskEditorsMap.get(r.id) ?? []
      : editorsMap.get(r.id) ?? [],
    coordinator: r.createdById ? (personMap.get(r.createdById) ?? null) : null,
    coCoordinators: coCoordMap.get(r.id) ?? [],
    isOwn: r.createdById === userId,
    isCoCoord: coCoordTaskIds.includes(r.id),
    updatedAt: r.updatedAt,
    reviewedAt: overviewReviewedAtMap.get(r.id)?.toISOString() ?? null,
    subtaskProgress: r.taskType === "multi_task" ? (progressMap.get(r.id) ?? { total: 0, completed: 0, inProgress: 0, pending: 0 }) : null,
    fileCount:           overviewFileCountMap.get(r.id) ?? 0,
    fileKind:            overviewFileCountMap.get(r.id) ? (overviewFileKindMap.get(r.id) ?? null) : null,
    unreadCommentCount:  overviewReviewCommentMap.get(r.id) ?? 0,
    effortHours:         r.effortHours ?? null,
    editorComplexitySet: r.editorComplexitySet,
    ...getOverviewSlot(r.id),
  })));
});

// ── Status history (stacked line chart data) ──────────────────────────────────
router.get("/tasks/status-history", requireAuth, async (req, res): Promise<void> => {
  const DAYS = 14;
  const STATUS_KEYS = ["pending", "in_progress", "review", "completed", "paused", "cancelled"];

  const nowMs = Date.now();

  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 86_400_000);
    dates.push(d.toISOString().split("T")[0]);
  }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;

  // Exclude subtasks from status history chart to avoid double-counting
  const baseFilter = isNull(tasksTable.parentTaskId);
  const taskFilter = role === "editor"
    ? and(baseFilter, eq(tasksTable.assignedToId, userId))
    : (role === "coordinator" || role === "supervisor")
      ? and(baseFilter, eq(tasksTable.createdById, userId))
      : baseFilter;

  const allTasks = await db
    .select({ id: tasksTable.id, createdAt: tasksTable.createdAt })
    .from(tasksTable)
    .where(taskFilter);

  const allEvents = await db
    .select({ taskId: taskEventsTable.taskId, toStatus: taskEventsTable.toStatus, createdAt: taskEventsTable.createdAt })
    .from(taskEventsTable)
    .orderBy(asc(taskEventsTable.createdAt));

  const evtByTask = new Map<number, { toStatus: string; ts: number }[]>();
  for (const e of allEvents) {
    const ts = e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt).getTime();
    if (!evtByTask.has(e.taskId)) evtByTask.set(e.taskId, []);
    evtByTask.get(e.taskId)!.push({ toStatus: e.toStatus, ts });
  }

  const series: Record<string, number[]> = {};
  STATUS_KEYS.forEach(k => { series[k] = []; });

  for (const dateStr of dates) {
    const dayEndMs = new Date(dateStr + "T23:59:59.999Z").getTime();

    const counts: Record<string, number> = {};
    STATUS_KEYS.forEach(k => { counts[k] = 0; });

    for (const task of allTasks) {
      const createdMs = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
      if (createdMs > dayEndMs) continue;

      const evts = evtByTask.get(task.id) ?? [];
      let status = "pending";
      for (const e of evts) {
        if (e.ts <= dayEndMs) status = e.toStatus;
        else break;
      }
      if (counts[status] !== undefined) counts[status]++;
    }

    STATUS_KEYS.forEach(k => series[k].push(counts[k]));
  }

  res.json({ dates, series });
});

// ── Weekly Heatmap ────────────────────────────────────────────────────────────
router.get("/tasks/heatmap", requireCoordinator, async (_req, res): Promise<void> => {
  const tasks = await db
    .select({
      assignedToId: tasksTable.assignedToId,
      dueDate:      tasksTable.dueDate,
      status:       tasksTable.status,
      title:        tasksTable.title,
      client:       tasksTable.client,
    })
    .from(tasksTable)
    .where(
      and(
        ne(tasksTable.status, "completed"),
        ne(tasksTable.status, "cancelled"),
        ne(tasksTable.status, "rascunho"),
        isNotNull(tasksTable.dueDate),
        isNotNull(tasksTable.assignedToId),
        ne(tasksTable.taskType, "multi_task"), // exclude parent multi_tasks (no direct assignee)
      )
    );
  res.json(tasks);
});

// ── Get single task ──────────────────────────────────────────────────────────
router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [createdBy] = task.createdById
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, task.createdById))
    : [null];
  const [assignedTo] = task.assignedToId
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, task.assignedToId))
    : [null];
  const revisions = await db
    .select({ id: taskRevisionsTable.id, revisionNumber: taskRevisionsTable.revisionNumber, comment: taskRevisionsTable.comment, createdAt: taskRevisionsTable.createdAt })
    .from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, id)).orderBy(asc(taskRevisionsTable.revisionNumber));

  const editorRows = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(taskEditorsTable)
    .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
    .where(eq(taskEditorsTable.taskId, id));

  const coCoordRows = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(taskCoordinatorsTable)
    .innerJoin(usersTable, eq(taskCoordinatorsTable.userId, usersTable.id))
    .where(eq(taskCoordinatorsTable.taskId, id));

  // If multi_task: fetch subtasks with their editors
  let subtasks: object[] = [];
  let subtaskProgress: { total: number; completed: number; inProgress: number; pending: number } | null = null;

  if (task.taskType === "multi_task") {
    const subRows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, id))
      .orderBy(asc(tasksTable.subtaskOrder), asc(tasksTable.createdAt));

    const subIds = subRows.map(s => s.id);
    const subEditorRows = subIds.length
      ? await db
          .select({ taskId: taskEditorsTable.taskId, id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
          .from(taskEditorsTable)
          .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
          .where(inArray(taskEditorsTable.taskId, subIds))
      : [];

    const subEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
    for (const e of subEditorRows) {
      if (!subEditorsMap.has(e.taskId)) subEditorsMap.set(e.taskId, []);
      subEditorsMap.get(e.taskId)!.push({ id: e.id, name: e.name, avatarUrl: e.avatarUrl });
    }

    const assigneePersonIds = [...new Set(subRows.map(s => s.assignedToId).filter(Boolean))] as number[];
    const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
    if (assigneePersonIds.length > 0) {
      const assignees = await db
        .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, assigneePersonIds));
      assignees.forEach(a => assigneeMap.set(a.id, a));
    }

    subtasks = subRows.map(s => ({
      id: s.id,
      taskCode: fmtCode(s.taskNumber, s.taskYear),
      title: s.title,
      description: s.description,
      status: s.status,
      priority: s.priority,
      complexity: s.complexity,
      dueDate: s.dueDate,
      subtaskOrder: s.subtaskOrder,
      assignedToId: s.assignedToId,
      assignedTo: s.assignedToId ? (assigneeMap.get(s.assignedToId) ?? null) : null,
      editors: subEditorsMap.get(s.id) ?? [],
      revisionCount: s.revisionCount ?? 0,
    }));

    const totalSub = subRows.length;
    const completedSub = subRows.filter(s => s.status === "completed").length;
    const inProgressSub = subRows.filter(s => ["in_progress", "review", "reopened"].includes(s.status)).length;
    const pendingSub = subRows.filter(s => s.status === "pending").length;
    subtaskProgress = { total: totalSub, completed: completedSub, inProgress: inProgressSub, pending: pendingSub };
  }

  // If subtask: fetch parent info
  let parentTask: { id: number; taskCode: string; title: string; status: string } | null = null;
  if (task.taskType === "subtask" && task.parentTaskId) {
    const [parent] = await db
      .select({ id: tasksTable.id, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear, title: tasksTable.title, status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, task.parentTaskId));
    if (parent) {
      parentTask = { id: parent.id, taskCode: fmtCode(parent.taskNumber, parent.taskYear), title: parent.title, status: parent.status };
    }
  }

  const userId = req.session.userId!;
  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviewCommentsTable)
    .leftJoin(reviewReadsTable, and(eq(reviewReadsTable.taskId, id), eq(reviewReadsTable.userId, userId)))
    .where(and(
      eq(reviewCommentsTable.taskId, id),
      ne(reviewCommentsTable.userId, userId),
      or(isNull(reviewReadsTable.lastReadAt), sql`${reviewCommentsTable.createdAt} > ${reviewReadsTable.lastReadAt}`)
    ));

  res.json({
    ...task,
    taskCode: fmtCode(task.taskNumber, task.taskYear),
    createdBy: createdBy ?? null,
    assignedTo: assignedTo ?? null,
    coCoordinators: coCoordRows,
    revisions,
    editors: editorRows,
    subtasks,
    subtaskProgress,
    parentTask,
    unreadCommentCount: unreadRow?.count ?? 0,
  });
});

// ── Update task ──────────────────────────────────────────────────────────────
router.put("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  const { title, description, startDate, dueDate, priority, complexity, assignedToId, folderUrl, status, revisionComment, startComment, client, effortHours } = req.body ?? {};
  const update: Record<string, unknown> = {};
  let eventComment: string | undefined;

  if (role === "editor") {
    const [editorEntry] = await db.select({ taskId: taskEditorsTable.taskId })
      .from(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));
    const isAssigned = task.assignedToId === userId || !!editorEntry;
    if (!isAssigned) { res.status(403).json({ error: "Sem permissão" }); return; }
    if (status) {
      const s = String(status);
      const editorTransitions: Record<string, string[]> = {
        pending:     ["in_progress"],
        in_progress: ["review"],
        reopened:    ["in_progress"],
      };
      const allowed = editorTransitions[task.status] ?? [];
      if (!allowed.includes(s)) { res.status(400).json({ error: "Transição de status não permitida" }); return; }

      // Bloqueia iniciar tarefa antes do startDate agendado (compara data LOCAL, sem drift UTC)
      if (s === "in_progress" && task.startDate) {
        const todayStr = toDateStrLocal(new Date());
        const startStr = toDateStrLocal(task.startDate);
        if (startStr > todayStr) {
          res.status(400).json({ error: "Esta tarefa está agendada para iniciar em " + startStr + ". Aguarde a data para iniciá-la." });
          return;
        }
      }

      update.status = s;
      if (s === "in_progress" && task.startDate) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const startStr = task.startDate.toISOString().slice(0, 10);
        if (startStr > todayStr) update.startDate = new Date(todayStr + "T00:00:00Z");
      }

    }


    // ── Editor valida/ajusta horas estimadas pelo ESCALA ──
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;
  } else {
    if (role === "coordinator" && task.createdById !== userId) {
      // Subtarefa: verifica se é dono da tarefa pai
      if (task.taskType === "subtask" && task.parentTaskId) {
        const [parent] = await db.select({ createdById: tasksTable.createdById }).from(tasksTable).where(eq(tasksTable.id, task.parentTaskId));
        if (!parent || parent.createdById !== userId) {
          res.status(403).json({ error: "Sem permissão para editar esta subtarefa. Apenas o criador da multi-tarefa pode fazer isso." }); return;
        }
      } else if (!(await isCoCoord(id, userId))) {
        res.status(403).json({ error: "Sem permissão para editar esta tarefa. Apenas o criador, um co-coordenador ou Supervisor pode fazer isso." }); return;
      }
    }
    if (title) update.title = String(title);
    if (description !== undefined) update.description = description ? String(description) : null;
    if (client !== undefined) update.client = client ? String(client) : null;
    
    if (startDate !== undefined) {
      const ps = parseDateSafe(startDate);
      if (ps === "invalid") { res.status(400).json({ error: "Data de início inválida" }); return; }
      update.startDate = ps;
    }
    if (dueDate !== undefined) {
      if (dueDate) {
        const pd = parseDateSafe(dueDate);
        if (pd === "invalid" || pd === null) { res.status(400).json({ error: "Prazo inválido" }); return; }
        update.dueDate = pd;
      } else {
        if (task.status !== "rascunho") {
          res.status(400).json({ error: "Tarefas em andamento precisam ter um prazo definido" }); return;
        }
        update.dueDate = null;
      }
    }
    if (priority) update.priority = String(priority);
    if (complexity) update.complexity = String(complexity);
    if (assignedToId !== undefined && task.taskType !== "multi_task") {
      update.assignedToId = assignedToId ? parseInt(String(assignedToId), 10) : null;
    }
    if (folderUrl !== undefined) update.folderUrl = folderUrl ? String(folderUrl) : null;

    // ── effortHours: aceita mudança e re-aloca automaticamente ──
    if (effortHours !== undefined && task.effortHours != null) {
      const newEffort = parseFloat(String(effortHours));
      if (!isNaN(newEffort) && newEffort > 0 && Math.abs(newEffort - Number(task.effortHours)) > 0.01) {
        update.effortHours = newEffort;
        const editorId    = update.assignedToId ? Number(update.assignedToId) : (task.assignedToId ?? null);
        const newStart    = update.startDate !== undefined ? (update.startDate as Date | null) : task.startDate;
        const newDeadline = update.dueDate    !== undefined ? (update.dueDate    as Date | null) : task.dueDate;
        if (editorId) {
          await reallocTask(id, editorId, newEffort, newStart, newDeadline);
        }
      }
    }

    if (status) {
      const s = String(status);
      const TERMINAL = ["completed", "cancelled"];

      // Multi_task cannot be manually set to completed — it's derived from subtasks
      if (task.taskType === "multi_task" && s === "completed") {
        res.status(400).json({ error: "Multi-tarefas são concluídas automaticamente quando todas as subtarefas são finalizadas" }); return;
      }

      if (s === "cancelled" || s === "paused") {
        if (TERMINAL.includes(task.status)) {
          res.status(400).json({ error: "Não é possível alterar uma tarefa já finalizada ou cancelada" }); return;
        }
        const actionComment = revisionComment ? String(revisionComment).trim() : "";
        if (!actionComment) {
          res.status(400).json({ error: s === "cancelled" ? "Informe o motivo do cancelamento" : "Informe o motivo da pausa" }); return;
        }
        eventComment = actionComment;
        update.status = s;

        // If cancelling/pausing a multi_task, propagate to active subtasks
        if (task.taskType === "multi_task") {
          const activeSubtasks = await db
            .select({ id: tasksTable.id, assignedToId: tasksTable.assignedToId })
            .from(tasksTable)
            .where(and(
              eq(tasksTable.parentTaskId, id),
              ne(tasksTable.status, "completed"),
              ne(tasksTable.status, "cancelled"),
            ));
          for (const sub of activeSubtasks) {
            await db.update(tasksTable).set({ status: s }).where(eq(tasksTable.id, sub.id));
            if (sub.assignedToId) {
              await notify(sub.assignedToId, s === "cancelled" ? "task_cancelled" : "task_paused",
                s === "cancelled" ? "Subtarefa cancelada" : "Subtarefa pausada",
                `A subtarefa foi ${s === "cancelled" ? "cancelada" : "pausada"} junto com a multi-tarefa "${task.title}"${actionComment ? `: ${actionComment}` : ""}`,
                { taskId: sub.id }
              );
            }
          }
        }
      } else if (s === "reopened") {
        if (task.status !== "completed") {
          res.status(400).json({ error: "Só é possível reabrir tarefas aprovadas" }); return;
        }
        const comment = revisionComment ? String(revisionComment).trim() : "";
        if (!comment) { res.status(400).json({ error: "Informe o motivo da reabertura" }); return; }
        const newRevision = (task.revisionCount ?? 0) + 1;
        update.revisionCount = newRevision;
        update.status = "reopened";
        await db.insert(taskRevisionsTable).values({
          taskId: id,
          revisionNumber: newRevision,
          comment,
          createdById: userId,
        });
      } else if (s === "pending" && task.status === "cancelled") {
        const dueDateAfterUpdate = update.dueDate !== undefined ? update.dueDate : task.dueDate;
        if (!dueDateAfterUpdate && task.taskType !== "multi_task") {
          res.status(400).json({ error: "Informe um prazo para reativar a tarefa" }); return;
        }
        update.status = "pending";
      } else if (s === "pending" && (task.status === "paused" || task.status === "rascunho")) {
        if (task.status === "rascunho") {
          const dueDateAfterUpdate = update.dueDate !== undefined ? update.dueDate : task.dueDate;
          if (!dueDateAfterUpdate && task.taskType !== "multi_task") {
            res.status(400).json({ error: "Informe o prazo antes de publicar a tarefa" }); return;
          }
          if (task.taskType === "multi_task") {
            // Check at least one subtask exists
            const [subCount] = await db
              .select({ count: sql<number>`count(*)` })
              .from(tasksTable)
              .where(eq(tasksTable.parentTaskId, id));
            if (Number(subCount?.count ?? 0) === 0) {
              res.status(400).json({ error: "Adicione ao menos uma subtarefa antes de publicar a multi-tarefa" }); return;
            }
          } else {
            const existingEditors = await db.select({ id: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
            const { editorIds: newEditorIds } = req.body ?? {};
            const incomingEditorIds = Array.isArray(newEditorIds)
              ? (newEditorIds as unknown[]).map(Number).filter(n => !isNaN(n) && n > 0)
              : [];
            const hasEditors = existingEditors.length > 0 || task.assignedToId || update.assignedToId || incomingEditorIds.length > 0;
            if (!hasEditors) {
              res.status(400).json({ error: "Atribua ao menos um editor para publicar a tarefa" }); return;
            }
          }
        }
        update.status = "pending";
      } else if (s === "in_progress" && task.status === "review") {
        // Coordenador solicita alteração: review → in_progress com comentário obrigatório
        const comment = revisionComment ? String(revisionComment).trim() : "";
        if (!comment) { res.status(400).json({ error: "Informe o comentário de alteração" }); return; }
        const newRevision = (task.revisionCount ?? 0) + 1;
        update.revisionCount = newRevision;
        update.status = "in_progress";
        eventComment = comment;
        await db.insert(taskRevisionsTable).values({
          taskId: id,
          revisionNumber: newRevision,
          comment,
          createdById: userId,
        });
        // Notifica o editor
        if (task.assignedToId) {
          const taskCode = fmtCode(task.taskNumber ?? 0, task.taskYear ?? 0);
          await notify(
            task.assignedToId,
            "task_revision",
            "Alteração solicitada",
            `Alteração #${newRevision} em "${taskCode} ${task.title}": ${comment.slice(0, 120)}`,
            { taskId: id },
          );
        }
      } else {
        // Aprovação: task deve estar em review → só completed é válido
        if (task.status !== "review") { res.status(400).json({ error: `Coordenador só pode avaliar tarefas em revisão (status atual: ${task.status})` }); return; }
        if (s !== "completed") { res.status(400).json({ error: "Transição inválida" }); return; }
        update.status = s;
      }
    }
  }

  const [updated] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning();

  if (update.status && update.status !== task.status) {
    const resolvedComment = eventComment
      || (update.status === "in_progress" && startComment ? String(startComment).slice(0, 500) : undefined);
    await db.insert(taskEventsTable).values({
      taskId: id,
      fromStatus: task.status,
      toStatus: String(update.status),
      changedById: userId,
      ...(resolvedComment ? { revisionComment: resolvedComment } : {}),
    });
  }

  const newStatus = update.status as string | undefined;
  if (newStatus && newStatus !== task.status) {
    if (newStatus === "review" && task.createdById) {
      const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      const parentLabel = task.taskType === "subtask" ? "Subtarefa" : "Tarefa";
      await notifyAllCoords(task, null,
        "task_review",
        `${parentLabel} enviada para aprovação`,
        `${editor?.name ?? "Editor"} enviou "${task.title}" para aprovação`,
      );
    }
    if (newStatus === "in_progress" && task.createdById && task.createdById !== userId) {
      const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      await notifyAllCoords(task, null,
        "task_started",
        "Tarefa em edição",
        `${editor?.name ?? "Editor"} iniciou a edição de "${task.title}"`,
      );
    }
    if (newStatus === "cancelled") {
      const comment = eventComment ?? "";
      const cancelledEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const cancelRecipients = new Set<number>(cancelledEditors.map(e => e.userId));
      if (task.assignedToId) cancelRecipients.add(task.assignedToId);
      for (const recipientId of cancelRecipients) {
        await notify(recipientId, "task_cancelled",
          "Tarefa cancelada",
          `A tarefa "${task.title}" foi cancelada${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "paused") {
      const comment = eventComment ?? "";
      const pausedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const pauseRecipients = new Set<number>(pausedEditors.map(e => e.userId));
      if (task.assignedToId) pauseRecipients.add(task.assignedToId);
      for (const recipientId of pauseRecipients) {
        await notify(recipientId, "task_paused",
          "Tarefa pausada",
          `A tarefa "${task.title}" foi pausada${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "pending" && task.status === "paused") {
      const resumedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const resumeRecipients = new Set<number>(resumedEditors.map(e => e.userId));
      if (task.assignedToId) resumeRecipients.add(task.assignedToId);
      for (const recipientId of resumeRecipients) {
        await notify(recipientId, "task_resumed",
          "Tarefa retomada",
          `A tarefa "${task.title}" foi retomada pelo coordenador`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "pending" && task.status === "cancelled") {
      const reactivatedEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      const reactivateRecipients = new Set<number>(reactivatedEditors.map(e => e.userId));
      if (task.assignedToId) reactivateRecipients.add(task.assignedToId);
      for (const recipientId of reactivateRecipients) {
        await notify(recipientId, "task_reactivated",
          "Tarefa reativada",
          `A tarefa "${task.title}" foi reativada pelo coordenador`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "pending" && task.status === "rascunho") {
      const editorRows = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      for (const { userId: editorId } of editorRows) {
        await notify(editorId, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi publicada e atribuída a você`,
          { taskId: id }
        );
      }
    }
    if (newStatus === "completed" || newStatus === "cancelled") {
      // Libera os slots do ESCALA — o cálculo de carga já ignora por status,
      // mas manter registros órfãos polui a agenda e relatórios
      await db.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, id));
    }

    if (newStatus === "completed" && task.assignedToId && task.taskType !== "multi_task") {
      await notify(task.assignedToId, "task_approved",
        "Tarefa aprovada",
        `Sua tarefa "${task.title}" foi aprovada`,
        { taskId: id }
      );

      // Busca o arquivo de mídia mais recente da tarefa (maior revisionNumber)
      const [latestFile] = await db
        .select({
          id:       taskFilesTable.id,
          fileName: taskFilesTable.fileName,
          mimeType: taskFilesTable.mimeType,
        })
        .from(taskFilesTable)
        .where(
          and(
            eq(taskFilesTable.taskId, id),
            or(
              like(taskFilesTable.mimeType, "video/%"),
              like(taskFilesTable.mimeType, "audio/%")
            )
          )
        )
        .orderBy(desc(taskFilesTable.revisionNumber), desc(taskFilesTable.id))
        .limit(1);

      if (latestFile) {
        await createFeedItem({
          type: "media_approved",
          title: `Mídia aprovada: "${task.title}"`,
          content: JSON.stringify({
            fileId:   latestFile.id,
            taskId:   id,
            fileName: latestFile.fileName,
            mimeType: latestFile.mimeType,
          }),
          actorId:    userId,
          entityId:   id,
          entityType: "task",
        }).catch(() => {});
      }
    }
    if (newStatus === "reopened") {
      const comment = revisionComment ? String(revisionComment).trim() : "";
      if (task.assignedToId) {
        await notify(task.assignedToId, "task_reopened",
          "Tarefa reaberta",
          `A tarefa "${task.title}" foi reaberta${comment ? `: ${comment}` : ""}`,
          { taskId: id }
        );
      }
      const editorRows = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      for (const { userId: editorId } of editorRows) {
        if (editorId !== task.assignedToId) {
          await notify(editorId, "task_reopened",
            "Tarefa reaberta",
            `A tarefa "${task.title}" foi reaberta${comment ? `: ${comment}` : ""}`,
            { taskId: id }
          );
        }
      }
    }

    // If this is a subtask and status changed, recalculate parent status
    if (task.taskType === "subtask" && task.parentTaskId) {
      await recalculateParentStatus(task.parentTaskId, userId);
      broadcastSubtaskChanged(id, task.parentTaskId);
    }
  }

  if (update.assignedToId !== undefined && update.assignedToId !== task.assignedToId) {
    const newEditor = update.assignedToId as number | null;
    const oldEditor = task.assignedToId;

    if (task.status !== "rascunho") {
      if (oldEditor) {
        await notify(oldEditor, "task_reassigned",
          "Tarefa reatribuída",
          `A tarefa "${task.title}" foi reatribuída a outro editor`,
          { taskId: id }
        );
      }
      if (newEditor) {
        await notify(newEditor, "task_assigned",
          "Nova tarefa atribuída",
          `A tarefa "${task.title}" foi atribuída a você`,
          { taskId: id }
        );
      }
    }
    if (newEditor) {
      await db.insert(taskEditorsTable).values({
        taskId: id, userId: newEditor, assignedById: req.session.userId,
      }).onConflictDoNothing();
    }
    if (oldEditor && oldEditor !== newEditor) {
      await db.delete(taskEditorsTable)
        .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, oldEditor)));
    }
  }

  if (update.dueDate !== undefined) {
    const oldDate = task.dueDate ? (task.dueDate as Date).toISOString().split("T")[0] : null;
    const newDate = update.dueDate ? (update.dueDate as Date).toISOString().split("T")[0] : null;
    if (oldDate !== newDate) {
      const fmtBR = (iso: string | null) => iso ? iso.split("-").reverse().join("/") : "—";
      const recipients = new Set<number>();
      if (task.assignedToId) recipients.add(task.assignedToId);
      const extraEditors = await db.select({ userId: taskEditorsTable.userId }).from(taskEditorsTable).where(eq(taskEditorsTable.taskId, id));
      extraEditors.forEach(e => recipients.add(e.userId));
      if (task.status !== "rascunho") {
        for (const recipientId of recipients) {
          await notify(recipientId, "due_date_changed",
            "Prazo alterado",
            `O prazo de "${task.title}" foi alterado para ${fmtBR(newDate)}`,
            { taskId: id }
          );
        }
      }
    }
  }

  broadcastTaskChange();
  res.json(updated);
});

// ── Subtask routes ────────────────────────────────────────────────────────────

// Get subtasks of a multi_task
router.get("/tasks/:id/subtasks", requireAuth, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [parent] = await db.select({ id: tasksTable.id, taskType: tasksTable.taskType, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear }).from(tasksTable).where(eq(tasksTable.id, parentId));
  if (!parent) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  const parentCode = fmtCode(parent.taskNumber, parent.taskYear);

  const subRows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId))
    .orderBy(asc(tasksTable.subtaskOrder), asc(tasksTable.createdAt));

  const subIds = subRows.map(s => s.id);
  const subEditorRows = subIds.length
    ? await db
        .select({ taskId: taskEditorsTable.taskId, id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(taskEditorsTable)
        .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, subIds))
    : [];

  const subEditorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of subEditorRows) {
    if (!subEditorsMap.has(e.taskId)) subEditorsMap.set(e.taskId, []);
    subEditorsMap.get(e.taskId)!.push({ id: e.id, name: e.name, avatarUrl: e.avatarUrl });
  }

  const assigneeIds = [...new Set(subRows.map(s => s.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  res.json(subRows.map((s, i) => ({
    id: s.id,
    taskCode: `${parentCode}.${(s.subtaskOrder ?? i) + 1}`,
    title: s.title,
    description: s.description,
    status: s.status,
    priority: s.priority,
    complexity: s.complexity,
    dueDate: s.dueDate,
    subtaskOrder: s.subtaskOrder,
    assignedToId: s.assignedToId,
    assignedTo: s.assignedToId ? (assigneeMap.get(s.assignedToId) ?? null) : null,
    editors: subEditorsMap.get(s.id) ?? [],
    revisionCount: s.revisionCount ?? 0,
    folderUrl: s.folderUrl,
  })));
});

// Create a subtask inside a multi_task
router.post("/tasks/:id/subtasks", requireCoordinator, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [parent] = await db.select().from(tasksTable).where(eq(tasksTable.id, parentId));
  if (!parent) { res.status(404).json({ error: "Tarefa pai não encontrada" }); return; }
  if (parent.taskType !== "multi_task") {
    res.status(400).json({ error: "Só é possível criar subtarefas dentro de multi-tarefas" }); return;
  }

  if (req.session.userRole === "coordinator" && parent.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para adicionar subtarefas a esta multi-tarefa" }); return;
  }

  const { title, description, dueDate, priority, complexity, editorId } = req.body ?? {};
  if (!title) { res.status(400).json({ error: "Título obrigatório" }); return; }

  const subAssigneeId = editorId ? parseInt(String(editorId), 10) : null;

  // Get current max subtask order
  const [maxOrder] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(subtask_order), -1)` })
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  const taskYear = new Date().getFullYear() % 100;
  const seqResult = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
  const taskNumber = Number((seqResult.rows ?? seqResult)[0].nextval);

  const [subtask] = await db.insert(tasksTable).values({
    taskNumber,
    taskYear,
    title: String(title),
    description: description ? String(description) : null,
    client: parent.client,
    
    dueDate: dueDate ? new Date(String(dueDate)) : parent.dueDate,
    priority: priority ?? parent.priority ?? "medium",
    complexity: complexity ?? parent.complexity ?? "medium",
    status: parent.status === "rascunho" ? "rascunho" : "pending",
    assignedToId: subAssigneeId,
    createdById: req.session.userId,
    taskType: "subtask",
    parentTaskId: parentId,
    subtaskOrder: (Number(maxOrder?.maxOrder ?? -1)) + 1,
  }).returning();

  if (subAssigneeId) {
    await db.insert(taskEditorsTable).values({
      taskId: subtask.id,
      userId: subAssigneeId,
      assignedById: req.session.userId,
    }).onConflictDoNothing();

    if (parent.status !== "rascunho") {
      await notify(subAssigneeId, "task_assigned",
        "Nova subtarefa atribuída",
        `Você foi atribuído à subtarefa "${subtask.title}" da multi-tarefa "${parent.title}"`,
        { taskId: subtask.id }
      );
    }
  }

  // If multi_task was pending/in_progress, recalculate
  if (parent.status !== "rascunho") {
    await recalculateParentStatus(parentId, req.session.userId!);
  }

  broadcastTaskChange();
  res.status(201).json(subtask);
});

// Get progress of a multi_task
router.get("/tasks/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const subtasks = await db
    .select({ status: tasksTable.status })
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  const total = subtasks.length;
  const completed = subtasks.filter(s => s.status === "completed").length;
  const inProgress = subtasks.filter(s => ["in_progress", "review", "reopened"].includes(s.status)).length;
  const pending = subtasks.filter(s => s.status === "pending").length;
  const cancelled = subtasks.filter(s => s.status === "cancelled").length;

  res.json({
    total,
    completed,
    inProgress,
    pending,
    cancelled,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  });
});

// ── Return task (editor gives back) ─────────────────────────────────────────
router.post("/tasks/:id/return", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const role = req.session.userRole!;
  const userId = req.session.userId!;

  if (role === "editor" && task.assignedToId !== userId) {
    res.status(403).json({ error: "Você só pode devolver tarefas atribuídas a você." }); return;
  }
  if (!["pending", "in_progress", "review"].includes(task.status)) {
    res.status(400).json({ error: "Só é possível devolver uma tarefa pendente, em edição ou em revisão." }); return;
  }

  const returnComment = req.body?.returnComment ? String(req.body.returnComment).trim() : "";
  if (!returnComment) {
    res.status(400).json({ error: "Informe o motivo da devolução." }); return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasksTable)
    .set({ status: "pending", assignedToId: null })
    .where(eq(tasksTable.id, id))
    .returning();

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, userId)));

  await db.insert(taskEventsTable).values({
    taskId: id, fromStatus: prevStatus, toStatus: "pending", changedById: userId,
  });

  const [editor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const editorName = editor?.name ?? "Editor";

  // Notify the task owner (for subtask, notify the parent's creator)
  const notifyOwnerId = task.createdById;
  if (notifyOwnerId) {
    const label = task.taskType === "subtask" ? "subtarefa" : "tarefa";
    await notify(notifyOwnerId, "task_returned",
      `${label.charAt(0).toUpperCase() + label.slice(1)} devolvida`,
      `${editorName} devolveu "${task.title}": ${returnComment}`,
      { taskId: id },
    );
  }

  // If subtask: recalculate parent
  if (task.taskType === "subtask" && task.parentTaskId) {
    await recalculateParentStatus(task.parentTaskId, userId);
  }

  broadcastTaskChange();
  res.json(updated);
});

// ── Delete task ──────────────────────────────────────────────────────────────
router.delete("/tasks/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, status: tasksTable.status, assignedToId: tasksTable.assignedToId,
              createdById: tasksTable.createdById, title: tasksTable.title, taskType: tasksTable.taskType })
    .from(tasksTable).where(eq(tasksTable.id, id));

  if (!task) { res.sendStatus(204); return; }

  if (req.session.userRole === "coordinator" && task.createdById !== req.session.userId) {
    res.status(403).json({ error: "Sem permissão para excluir esta tarefa." }); return;
  }

  // For regular tasks: block if in-progress
  if (task.taskType !== "multi_task" && task.assignedToId !== null && task.status === "in_progress") {
    res.status(409).json({ error: "Esta tarefa está atribuída e em edição. Remova a atribuição antes de excluir.", blocked: true });
    return;
  }

  // For multi_task: notify editors of active subtasks before cascade delete
  if (task.taskType === "multi_task") {
    const activeSubtasks = await db
      .select({ id: tasksTable.id, assignedToId: tasksTable.assignedToId, title: tasksTable.title })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.parentTaskId, id),
        ne(tasksTable.status, "completed"),
        ne(tasksTable.status, "cancelled"),
        ne(tasksTable.status, "rascunho"),
      ));

    for (const sub of activeSubtasks) {
      const subEditors = await db
        .select({ userId: taskEditorsTable.userId })
        .from(taskEditorsTable)
        .where(eq(taskEditorsTable.taskId, sub.id));
      const recipients = new Set<number>(subEditors.map(e => e.userId));
      if (sub.assignedToId) recipients.add(sub.assignedToId);

      for (const recipientId of recipients) {
        await notify(recipientId, "task_cancelled",
          "Multi-tarefa excluída",
          `A multi-tarefa "${task.title}" e sua subtarefa "${sub.title}" foram excluídas`,
          { taskId: id }
        );
      }
    }
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id)); // CASCADE deletes subtasks
  broadcastTaskChange();
  res.sendStatus(204);
});

// ── My tasks ─────────────────────────────────────────────────────────────────
router.get("/my-tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  let tasks: (typeof tasksTable.$inferSelect)[];
  if (role === "editor") {
    const [primary, secondary] = await Promise.all([
      db.select().from(tasksTable).where(and(eq(tasksTable.assignedToId, userId), ne(tasksTable.status, "rascunho"))),
      db.select({ taskId: taskEditorsTable.taskId }).from(taskEditorsTable)
        .where(eq(taskEditorsTable.userId, userId)),
    ]);
    const secondaryIds = secondary.map(r => r.taskId);
    const primaryIds = primary.map(t => t.id);
    const missingIds = secondaryIds.filter(id => !primaryIds.includes(id));
    const extra = missingIds.length > 0
      ? await db.select().from(tasksTable).where(and(inArray(tasksTable.id, missingIds), ne(tasksTable.status, "rascunho")))
      : [];
    tasks = [...primary, ...extra].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    tasks = await db.select().from(tasksTable)
      .where(and(
        eq(tasksTable.createdById, userId),
        isNull(tasksTable.parentTaskId),
        ne(tasksTable.status, "rascunho"),
      ))
      .orderBy(desc(tasksTable.createdAt));
  }

  const taskNumMap = new Map<number, number>();
  [...tasks].sort((a, b) => a.id - b.id).forEach((t, i) => taskNumMap.set(t.id, i + 1));

  const taskIds = tasks.map(t => t.id);
  const editorRows = taskIds.length
    ? await db.select({ taskId: taskEditorsTable.taskId, userId: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(taskEditorsTable).innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
        .where(inArray(taskEditorsTable.taskId, taskIds))
    : [];
  const editorsMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const e of editorRows) {
    if (!editorsMap.has(e.taskId)) editorsMap.set(e.taskId, []);
    editorsMap.get(e.taskId)!.push({ id: e.userId, name: e.name, avatarUrl: e.avatarUrl });
  }

  // Fetch parent task info for subtasks
  const subtaskTasks = tasks.filter(t => t.taskType === "subtask" && t.parentTaskId);
  const parentIds = [...new Set(subtaskTasks.map(t => t.parentTaskId!))];
  const parentMap = new Map<number, { id: number; taskCode: string; title: string }>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: tasksTable.id, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear, title: tasksTable.title })
      .from(tasksTable)
      .where(inArray(tasksTable.id, parentIds));
    parents.forEach(p => parentMap.set(p.id, { id: p.id, taskCode: fmtCode(p.taskNumber, p.taskYear), title: p.title }));
  }

  // Multi-task progress
  const multiTaskIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiTaskIds);

  // File count + kind per task
  const myFileCounts = taskIds.length
    ? await db.select({
        taskId:   taskFilesTable.taskId,
        count:    sql<number>`count(*)::int`,
        hasVideo: sql<boolean>`bool_or(${taskFilesTable.mimeType} LIKE 'video/%')`,
        hasAudio: sql<boolean>`bool_or(${taskFilesTable.mimeType} LIKE 'audio/%')`,
      })
        .from(taskFilesTable).where(inArray(taskFilesTable.taskId, taskIds))
        .groupBy(taskFilesTable.taskId)
    : [];
  const myFileCountMap  = new Map(myFileCounts.map(r => [r.taskId, Number(r.count)]));
  const myFileKindMap   = new Map(myFileCounts.map(r => [
    r.taskId,
    r.hasVideo && r.hasAudio ? "mixed" : r.hasVideo ? "video" : r.hasAudio ? "audio" : "other",
  ]));

  // reviewedAt: quando a tarefa foi enviada para review pela PRIMEIRA vez
  // (usado para determinar se o editor entregou no prazo originalmente)
  const reviewEvents = taskIds.length
    ? await db.select({ taskId: taskEventsTable.taskId, createdAt: taskEventsTable.createdAt })
        .from(taskEventsTable)
        .where(and(inArray(taskEventsTable.taskId, taskIds), eq(taskEventsTable.toStatus, "review")))
        .orderBy(asc(taskEventsTable.createdAt))
    : [];
  const reviewedAtMap = new Map<number, Date>();
  for (const e of reviewEvents) {
    if (!reviewedAtMap.has(e.taskId)) reviewedAtMap.set(e.taskId, e.createdAt);
  }

  // Unread review comment count per task (comments not by current user, after last_read_at)
  const unreadCommentRows = taskIds.length
    ? await db
        .select({ taskId: reviewCommentsTable.taskId, count: sql<number>`count(*)::int` })
        .from(reviewCommentsTable)
        .leftJoin(
          reviewReadsTable,
          and(eq(reviewReadsTable.taskId, reviewCommentsTable.taskId), eq(reviewReadsTable.userId, userId))
        )
        .where(and(
          inArray(reviewCommentsTable.taskId, taskIds),
          ne(reviewCommentsTable.userId, userId),
          or(isNull(reviewReadsTable.lastReadAt), sql`${reviewCommentsTable.createdAt} > ${reviewReadsTable.lastReadAt}`)
        ))
        .groupBy(reviewCommentsTable.taskId)
    : [];
  const reviewCommentCountMap = new Map(unreadCommentRows.map(r => [r.taskId, Number(r.count)]));

  // Alocações (todas as datas) para calcular slotIndex/totalSlots por tarefa ESCALA
  const myTodayStr = new Date().toISOString().slice(0, 10);
  const myAllAllocs = taskIds.length
    ? await db.select({ taskId: taskAllocationsTable.taskId, workDate: taskAllocationsTable.workDate })
        .from(taskAllocationsTable)
        .where(and(
          inArray(taskAllocationsTable.taskId, taskIds),
          sql`${taskAllocationsTable.allocatedHours} > 0`,
        ))
        .orderBy(taskAllocationsTable.workDate)
    : [];
  const mySlotDates = new Map<number, string[]>();
  for (const a of myAllAllocs) {
    if (!mySlotDates.has(a.taskId)) mySlotDates.set(a.taskId, []);
    mySlotDates.get(a.taskId)!.push(a.workDate);
  }
  const getMySlot = (taskId: number) => {
    const dates  = mySlotDates.get(taskId) ?? [];
    const idx    = dates.indexOf(myTodayStr);
    return {
      hasAllocToday:  idx >= 0,
      todaySlotIndex: idx >= 0 ? idx + 1 : null,
      totalSlots:     dates.length > 1 ? dates.length : null,
    };
  };

  // Buscar criadores e assignees em lote
  const myPersonIds = [...new Set([
    ...tasks.map(t => t.createdById),
    ...tasks.map(t => t.assignedToId),
  ].filter((id): id is number => id !== null))];
  const myPersons = myPersonIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable).where(inArray(usersTable.id, myPersonIds))
    : [];
  const myPersonMap = new Map(myPersons.map(p => [p.id, p]));

  // Co-coords em lote
  const myCoCoordRows = taskIds.length
    ? await db
        .select({ taskId: taskCoordinatorsTable.taskId, id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(taskCoordinatorsTable)
        .innerJoin(usersTable, eq(taskCoordinatorsTable.userId, usersTable.id))
        .where(inArray(taskCoordinatorsTable.taskId, taskIds))
    : [];
  const myCoCoordMap = new Map<number, { id: number; name: string; avatarUrl: string | null }[]>();
  for (const c of myCoCoordRows) {
    if (!myCoCoordMap.has(c.taskId)) myCoCoordMap.set(c.taskId, []);
    myCoCoordMap.get(c.taskId)!.push({ id: c.id, name: c.name, avatarUrl: c.avatarUrl });
  }

  const tasksWithDetails = await Promise.all(tasks.map(async (t) => {
    const createdBy = t.createdById ? (myPersonMap.get(t.createdById) ?? null) : null;
    const assignedTo = t.assignedToId ? (myPersonMap.get(t.assignedToId) ?? null) : null;
    const revisions = await db.select({
      id: taskRevisionsTable.id,
      revisionNumber: taskRevisionsTable.revisionNumber,
      comment: taskRevisionsTable.comment,
      createdAt: taskRevisionsTable.createdAt,
    }).from(taskRevisionsTable).where(eq(taskRevisionsTable.taskId, t.id)).orderBy(asc(taskRevisionsTable.revisionNumber));
    return {
      ...t,
      taskCode: fmtCode(t.taskNumber, t.taskYear),
      createdBy: createdBy ?? null,
      coCoordinators: myCoCoordMap.get(t.id) ?? [],
      assignedTo: assignedTo ?? null,
      editors: editorsMap.get(t.id) ?? [],
      revisions,
      number: taskNumMap.get(t.id) ?? 0,
      parentTask: t.parentTaskId ? (parentMap.get(t.parentTaskId) ?? null) : null,
      subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
      reviewedAt: reviewedAtMap.get(t.id)?.toISOString() ?? null,
      fileCount:          myFileCountMap.get(t.id) ?? 0,
      fileKind:           myFileCountMap.get(t.id) ? (myFileKindMap.get(t.id) ?? null) : null,
      unreadCommentCount: reviewCommentCountMap.get(t.id) ?? 0,
      ...getMySlot(t.id),
    };
  }));

  res.json(tasksWithDetails);
});

// ── Activity feed ─────────────────────────────────────────────────────────────
router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  const events = await db
    .select({
      id: taskEventsTable.id,
      taskId: taskEventsTable.taskId,
      fromStatus: taskEventsTable.fromStatus,
      toStatus: taskEventsTable.toStatus,
      changedById: taskEventsTable.changedById,
      createdAt: taskEventsTable.createdAt,
      taskTitle: tasksTable.title,
      taskClient: tasksTable.client,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
      taskStatus: tasksTable.status,
      taskType: tasksTable.taskType,
      parentTaskId: tasksTable.parentTaskId,
    })
    .from(taskEventsTable)
    .innerJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
    .where(role === "editor" ? eq(tasksTable.assignedToId, userId) : undefined)
    .orderBy(desc(taskEventsTable.createdAt))
    .limit(15);

  const changerIds = [...new Set(events.map(e => e.changedById).filter(Boolean))] as number[];
  const changers: Record<number, string> = {};
  await Promise.all(changerIds.map(async cid => {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, cid));
    if (u) changers[u.id] = u.name;
  }));

  res.json(events.map(e => ({
    ...e,
    taskCode: fmtCode(e.taskNumber, e.taskYear),
    changedByName: e.changedById ? changers[e.changedById] ?? null : null,
  })));
});

// ── Calendar ──────────────────────────────────────────────────────────────────
router.get("/calendar", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;

  const fromParam = String(req.query.from ?? "");
  const toParam   = String(req.query.to   ?? "");
  const weekParam = String(req.query.week ?? "");

  let startDate: Date;
  let endDate:   Date;

  if (fromParam && toParam) {
    startDate = new Date(fromParam + "T00:00:00Z");
    endDate   = new Date(toParam   + "T00:00:00Z");
  } else {
    let weekStart: Date;
    if (weekParam) {
      weekStart = new Date(weekParam + "T00:00:00Z");
    } else {
      weekStart = new Date();
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
      weekStart.setHours(0, 0, 0, 0);
    }
    startDate = weekStart;
    endDate   = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
  }

  const weekStartStr = startDate.toISOString().split("T")[0];
  const weekEndStr   = endDate.toISOString().split("T")[0];

  const editorJunctionSubq = db
    .select({ taskId: taskEditorsTable.taskId })
    .from(taskEditorsTable)
    .where(eq(taskEditorsTable.userId, userId));

  const roleFilter = role === "editor"
    ? or(eq(tasksTable.assignedToId, userId), inArray(tasksTable.id, editorJunctionSubq))
    : and(ne(tasksTable.status, "rascunho"), ne(tasksTable.taskType, "multi_task")); // coordinators: exclude multi_task parents (show subtasks instead)

  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      startDate: tasksTable.startDate,
      dueDate: tasksTable.dueDate,
      
      client: tasksTable.client,
      assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById,
      taskType: tasksTable.taskType,
      parentTaskId: tasksTable.parentTaskId,
    })
    .from(tasksTable)
    .where(and(
      roleFilter,
      isNotNull(tasksTable.dueDate),
      // fetch tasks that overlap the window: dueDate >= windowStart AND (startDate <= windowEnd OR startDate is null)
      sql`${tasksTable.dueDate} >= ${weekStartStr}`,
      or(
        isNull(tasksTable.startDate),
        sql`${tasksTable.startDate} <= ${weekEndStr}`,
      ),
    ))
    .orderBy(asc(tasksTable.dueDate));

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter(Boolean))] as number[];

  const personMap: Record<number, string> = {};
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, personIds));
    persons.forEach(p => { personMap[p.id] = p.name; });
  }

  res.json(rows.map(r => ({
    ...r,
    assigneeName:    r.assignedToId ? personMap[r.assignedToId] ?? null : null,
    coordinatorId:   r.createdById ?? null,
    coordinatorName: r.createdById ? personMap[r.createdById] ?? null : null,
  })));
});

// ── Workload (hours-based) ────────────────────────────────────────────────────
function dailyCapHours(d: Date): number {
  const dow = d.getDay();
  if (dow === 0) return 0;
  if (dow === 6) return 5;
  return 8;
}

const WORKLOAD_ACTIVE = ["pending", "in_progress", "review", "reopened"] as string[];

router.get("/workload", requireCoordinator, async (req, res): Promise<void> => {
  const todayStr    = new Date().toISOString().slice(0, 10);
  const projDateStr = typeof req.query.date === "string" ? req.query.date : todayStr;
  const projDate    = new Date(projDateStr);
  const dailyCap    = dailyCapHours(projDate);

  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, login: usersTable.login, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.role, "editor"));

  const result = await Promise.all(editors.map(async editor => {
    const allocRows = await db
      .select({ h: taskAllocationsTable.allocatedHours })
      .from(taskAllocationsTable)
      .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
      .where(and(
        eq(taskAllocationsTable.editorId, editor.id),
        eq(taskAllocationsTable.workDate, projDateStr),
        isNotNull(taskAllocationsTable.allocatedHours),
        inArray(tasksTable.status, WORKLOAD_ACTIVE),
        ne(tasksTable.taskType, "multi_task"),
      ));

    const hoursToday = Math.round(allocRows.reduce((s, r) => s + (r.h ?? 0), 0) * 100) / 100;

    const activeTasks = await db
      .select({ id: tasksTable.id, status: tasksTable.status })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.assignedToId, editor.id),
        inArray(tasksTable.status, WORKLOAD_ACTIVE),
        ne(tasksTable.taskType, "multi_task"),
      ));

    return {
      id: editor.id, name: editor.name, login: editor.login, avatarUrl: editor.avatarUrl ?? null,
      hoursToday,
      dailyCap,
      taskCount: activeTasks.length,
      byStatus: {
        pending:     activeTasks.filter(t => t.status === "pending").length,
        in_progress: activeTasks.filter(t => t.status === "in_progress").length,
        review:      activeTasks.filter(t => t.status === "review").length,
      },
    };
  }));

  result.sort((a, b) => b.hoursToday - a.hoursToday);
  res.json(result);
});

// ── Workload calendar — horas por dia para um editor ─────────────────────────
router.get("/workload/calendar", requireCoordinator, async (req, res): Promise<void> => {
  const editorId = parseInt(req.query.editorId as string, 10);
  const monthStr = typeof req.query.month === "string" ? req.query.month : "";
  if (!editorId || !monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    res.status(400).json({ error: "editorId e month (YYYY-MM) são obrigatórios" }); return;
  }

  const [year, month] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay    = `${monthStr}-01`;
  const lastDay     = `${monthStr}-${String(daysInMonth).padStart(2, "0")}`;

  // v2: alocações do mês
  const allocRows = await db
    .select({ workDate: taskAllocationsTable.workDate, allocatedHours: taskAllocationsTable.allocatedHours })
    .from(taskAllocationsTable)
    .innerJoin(tasksTable, eq(taskAllocationsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskAllocationsTable.editorId, editorId),
      isNotNull(tasksTable.effortHours),
      inArray(tasksTable.status, WORKLOAD_ACTIVE),
      ne(tasksTable.taskType, "multi_task"),
      gte(taskAllocationsTable.workDate, firstDay),
      lte(taskAllocationsTable.workDate, lastDay),
    ));

  const allocByDay = new Map<string, number>();
  for (const r of allocRows) {
    allocByDay.set(r.workDate, (allocByDay.get(r.workDate) ?? 0) + (r.allocatedHours ?? 0));
  }

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr  = `${monthStr}-${String(d).padStart(2, "0")}`;
    const dayDate = new Date(dayStr);
    const cap     = dailyCapHours(dayDate);
    const hours   = Math.round((allocByDay.get(dayStr) ?? 0) * 100) / 100;
    days.push({ date: dayStr, hours, cap });
  }

  res.json(days);
});

// ── Workload period-check — delegado ao ESCALA; sem bloqueio por complexidade ─
router.get("/workload/period-check", requireCoordinator, async (_req, res): Promise<void> => {
  res.json({ blocked: false, conflictDays: [], maxScore: 0 });
});

// ── Nível 2: agenda geral de todos os editores ────────────────────────────────
// GET /api/agenda
router.get("/agenda", requireCoordinator, async (_req, res): Promise<void> => {
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.role, "editor"));

  // Tarefas ativas — exclui paused (consistente com /api/workload)
  const tasks = await db
    .select({
      id:           tasksTable.id,
      taskNumber:   tasksTable.taskNumber,
      taskYear:     tasksTable.taskYear,
      title:        tasksTable.title,
      status:       tasksTable.status,
      priority:     tasksTable.priority,
      complexity:   tasksTable.complexity,
      client:       tasksTable.client,
      startDate:    tasksTable.startDate,
      dueDate:      tasksTable.dueDate,
      effortHours:  tasksTable.effortHours,
      assignedToId: tasksTable.assignedToId,
      createdById:  tasksTable.createdById,
    })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "paused"),
      ne(tasksTable.status, "rascunho"),
      ne(tasksTable.taskType, "multi_task"),
      isNotNull(tasksTable.assignedToId),
    ));

  // Editores adicionais via te_task_editors
  const editorIds = editors.map(e => e.id);
  const extraLinks = editorIds.length
    ? await db
        .select({ taskId: taskEditorsTable.taskId, userId: taskEditorsTable.userId })
        .from(taskEditorsTable)
        .where(inArray(taskEditorsTable.userId, editorIds))
    : [];

  const extraByEditor = new Map<number, Set<number>>();
  extraLinks.forEach(l => {
    if (!extraByEditor.has(l.userId)) extraByEditor.set(l.userId, new Set());
    extraByEditor.get(l.userId)!.add(l.taskId);
  });

  const creatorIds = [...new Set(tasks.map(t => t.createdById).filter(Boolean))] as number[];
  const creatorMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (creatorIds.length > 0) {
    const creators = await db
      .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, creatorIds));
    creators.forEach(c => creatorMap.set(c.id, c));
  }

  // Alocações ESCALA v2 — para calcular horas reais por dia no frontend
  const allTaskIds = tasks.map(t => t.id);
  const allocRows = allTaskIds.length
    ? await db
        .select({
          taskId:         taskAllocationsTable.taskId,
          editorId:       taskAllocationsTable.editorId,
          workDate:       taskAllocationsTable.workDate,
          allocatedHours: taskAllocationsTable.allocatedHours,
          startTime:      taskAllocationsTable.startTime,
          endTime:        taskAllocationsTable.endTime,
        })
        .from(taskAllocationsTable)
        .where(inArray(taskAllocationsTable.taskId, allTaskIds))
    : [];

  // Agrupa alocações por editor
  const allocByEditor = new Map<number, { taskId: number; workDate: string; allocatedHours: number | null }[]>();
  for (const a of allocRows) {
    if (!allocByEditor.has(a.editorId)) allocByEditor.set(a.editorId, []);
    allocByEditor.get(a.editorId)!.push({
      taskId:         a.taskId,
      workDate:       a.workDate,
      allocatedHours: a.allocatedHours ? Number(a.allocatedHours) : null,
      startTime:      a.startTime ?? null,
      endTime:        a.endTime   ?? null,
    });
  }

  const result = editors.map(editor => {
    const extraIds = extraByEditor.get(editor.id) ?? new Set<number>();
    const editorTasks = tasks.filter(t =>
      t.assignedToId === editor.id || extraIds.has(t.id)
    );
    return {
      editor,
      tasks: editorTasks.map(t => ({
        id:          t.id,
        taskCode:    fmtCode(t.taskNumber ?? 0, t.taskYear ?? 0),
        title:       t.title,
        status:      t.status,
        priority:    t.priority,
        complexity:  t.complexity,
        client:      t.client,
        startDate:   t.startDate ? t.startDate.toISOString() : null,
        dueDate:     t.dueDate   ? t.dueDate.toISOString()   : null,
        effortHours: t.effortHours ?? null,
        creator:     t.createdById ? (creatorMap.get(t.createdById) ?? null) : null,
      })),
      allocations: allocByEditor.get(editor.id) ?? [],
    };
  });

  res.json(result);
});

// ── Dashboard extras ──────────────────────────────────────────────────────────
router.get("/dashboard-extras", requireAuth, async (_req, res): Promise<void> => {
  const todayStr = new Date().toISOString().split("T")[0];

  const baseOverdue = and(
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    ne(tasksTable.taskType, "multi_task"),
    isNotNull(tasksTable.dueDate),
    sql`${tasksTable.dueDate} < ${todayStr}`,
  );

  const overdueRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId,
      client: tasksTable.client,
      
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
    })
    .from(tasksTable)
    .where(baseOverdue);

  const assigneeIds = [...new Set(overdueRows.map(t => t.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a));
  }

  const atRisk = overdueRows.map(t => ({
    ...t,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    assignee: t.assignedToId ? (assigneeMap.get(t.assignedToId) ?? null) : null,
    assigneeName: t.assignedToId ? (assigneeMap.get(t.assignedToId)?.name ?? null) : null,
  }));

  res.json({ atRisk });
});

// ── Deadline overview ─────────────────────────────────────────────────────────
router.get("/deadline-overview", requireAuth, async (req, res): Promise<void> => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr    = today.toISOString().split("T")[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split("T")[0];
  const in3daysStr  = new Date(today.getTime() + 3 * 86400000).toISOString().split("T")[0];
  const in7daysStr  = new Date(today.getTime() + 7 * 86400000).toISOString().split("T")[0];

  const userId = req.session.userId!;
  const role   = req.session.userRole!;

  const BUCKETS = [
    { key: "overdue", label: "Atrasadas", color: "#ef4444" },
    { key: "today",   label: "Hoje",      color: "#f97316" },
    { key: "in3days", label: "Próx. 3d",  color: "#f59e0b" },
    { key: "week",    label: "Semana",    color: "#22c55e" },
    { key: "later",   label: "+7 dias",   color: "#94a3b8" },
  ];

  const baseWhere = and(
    ne(tasksTable.status, "completed"),
    ne(tasksTable.status, "cancelled"),
    ne(tasksTable.status, "paused"),
    ne(tasksTable.taskType, "multi_task"),
    isNotNull(tasksTable.dueDate)
  );
  const taskWhere = role === "editor"
    ? and(baseWhere, eq(tasksTable.assignedToId, userId))
    : baseWhere;

  const rows = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, dueDate: tasksTable.dueDate,
      assignedToId: tasksTable.assignedToId, client: tasksTable.client, 
      taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear,
    })
    .from(tasksTable).where(taskWhere).orderBy(asc(tasksTable.dueDate));

  const getBucket = (d: string): string => {
    if (d < todayStr)    return "overdue";
    if (d < tomorrowStr) return "today";
    if (d < in3daysStr)  return "in3days";
    if (d < in7daysStr)  return "week";
    return "later";
  };

  const counts: Record<string, number> = { overdue: 0, today: 0, in3days: 0, week: 0, later: 0 };
  rows.forEach(t => { if (t.dueDate) counts[getBucket(dueDateKey(t.dueDate))]++; });

  const PRIORITY_W: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const urgentRows = rows
    .filter(t => t.dueDate && ["overdue", "today", "in3days"].includes(getBucket(dueDateKey(t.dueDate))))
    .sort((a, b) => {
      const bA = getBucket(dueDateKey(a.dueDate)), bB = getBucket(dueDateKey(b.dueDate));
      const ORDER = ["overdue", "today", "in3days"];
      if (bA !== bB) return ORDER.indexOf(bA) - ORDER.indexOf(bB);
      const pw = (PRIORITY_W[b.priority] ?? 1) - (PRIORITY_W[a.priority] ?? 1);
      return pw !== 0 ? pw : dueDateKey(a.dueDate).localeCompare(dueDateKey(b.dueDate));
    })
    .slice(0, 5);

  const assigneeIds = [...new Set(urgentRows.map(t => t.assignedToId).filter(Boolean))] as number[];
  const assigneeMap = new Map<number, string>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a.name));
  }

  const urgent = urgentRows.map(t => ({
    id: t.id, taskCode: fmtCode(t.taskNumber, t.taskYear), title: t.title, status: t.status, priority: t.priority,
    dueDate: t.dueDate, client: t.client, 
    assigneeName: t.assignedToId ? (assigneeMap.get(t.assignedToId) ?? null) : null,
    bucket: getBucket(dueDateKey(t.dueDate)),
  }));

  res.json({
    buckets: BUCKETS.map(b => ({ ...b, count: counts[b.key] ?? 0 })),
    urgent, total: rows.length,
    urgentCount: (counts.overdue ?? 0) + (counts.today ?? 0),
  });
});

// ── Pipeline (all active tasks kanban) ───────────────────────────────────────
router.get("/pipeline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.userRole!;
  const isEditor = role === "editor";

  // Exclude subtasks from pipeline root view (they show inside multi_task cards)
  const baseWhere = and(ne(tasksTable.status, "rascunho"), isNull(tasksTable.parentTaskId));

  let taskIds: number[] | null = null;
  if (isEditor) {
    const [primary, secondary] = await Promise.all([
      db.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(eq(tasksTable.assignedToId, userId), ne(tasksTable.status, "rascunho"))),
      db.select({ taskId: taskEditorsTable.taskId }).from(taskEditorsTable)
        .where(eq(taskEditorsTable.userId, userId)),
    ]);
    taskIds = [...new Set([...primary.map(t => t.id), ...secondary.map(r => r.taskId)])];
  }

  const tasks = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      priority: tasksTable.priority, complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate,  client: tasksTable.client,
      revisionCount: tasksTable.revisionCount, assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById, createdAt: tasksTable.createdAt,
      taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear,
      taskType: tasksTable.taskType,
    })
    .from(tasksTable)
    .where(isEditor && taskIds !== null && taskIds.length > 0
      ? and(baseWhere, inArray(tasksTable.id, taskIds))
      : isEditor
        ? and(baseWhere, eq(tasksTable.id, -1))
        : baseWhere
    )
    .orderBy(desc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...tasks.map(t => t.assignedToId), ...tasks.map(t => t.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  // Fetch subtask progress for multi_tasks
  const multiIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

  res.json(tasks.map(t => ({
    ...t,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
    subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
  })));
});

// ── Task lifecycle ────────────────────────────────────────────────────────────
router.get("/tasks/:id/lifecycle", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [events, revisions] = await Promise.all([
    db.select({
      id: taskEventsTable.id,
      fromStatus: taskEventsTable.fromStatus,
      toStatus: taskEventsTable.toStatus,
      changedById: taskEventsTable.changedById,
      meta: taskEventsTable.meta,
      createdAt: taskEventsTable.createdAt,
    }).from(taskEventsTable)
      .where(eq(taskEventsTable.taskId, id))
      .orderBy(asc(taskEventsTable.createdAt)),

    db.select({
      id: taskRevisionsTable.id,
      revisionNumber: taskRevisionsTable.revisionNumber,
      comment: taskRevisionsTable.comment,
      createdById: taskRevisionsTable.createdById,
      createdAt: taskRevisionsTable.createdAt,
    }).from(taskRevisionsTable)
      .where(eq(taskRevisionsTable.taskId, id))
      .orderBy(asc(taskRevisionsTable.createdAt)),
  ]);

  const personIds = [...new Set([
    task.createdById,
    task.assignedToId,
    ...events.map(e => e.changedById),
    ...revisions.map(r => r.createdById),
  ].filter((x): x is number => x !== null))];

  const personMap = new Map<number, { id: number; name: string; role: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  const revisionQueue = [...revisions];
  const steps: object[] = [];

  steps.push({
    type: "created",
    at: task.createdAt,
    by: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    meta: { title: task.title, client: task.client, priority: task.priority,  },
  });

  for (const e of events) {
    const parsedMeta = e.meta ? (() => { try { return JSON.parse(e.meta); } catch { return {}; } })() : {};
    const isReviewEvent = e.toStatus === "file_uploaded" || e.toStatus === "comment_added";
    const step: Record<string, unknown> = {
      type: isReviewEvent ? e.toStatus : "status_change",
      at:   e.createdAt,
      by:   e.changedById ? (personMap.get(e.changedById) ?? null) : null,
      meta: isReviewEvent ? parsedMeta : { fromStatus: e.fromStatus, toStatus: e.toStatus, ...parsedMeta },
    };
    if (e.toStatus === "review" && revisionQueue.length > 0) {
      const rev = revisionQueue.shift()!;
      (step.meta as Record<string, unknown>).revisionComment = rev.comment;
      (step.meta as Record<string, unknown>).revisionNumber = rev.revisionNumber;
    }
    steps.push(step);
  }

  // For multi_task, attach subtask progress
  const subtaskProgress = task.taskType === "multi_task"
    ? ((await getSubtaskProgressMap([task.id])).get(task.id) ?? null)
    : null;

  res.json({
    task: {
      id: task.id,
      taskCode: fmtCode(task.taskNumber, task.taskYear),
      title: task.title,
      status: task.status,
      priority: task.priority,
      complexity: task.complexity,
      client: task.client,
      
      dueDate: task.dueDate,
      revisionCount: task.revisionCount ?? 0,
      taskType: task.taskType,
      parentTaskId: task.parentTaskId,
      subtaskProgress,
      assignee: task.assignedToId ? (personMap.get(task.assignedToId) ?? null) : null,
      coordinator: task.createdById ? (personMap.get(task.createdById) ?? null) : null,
    },
    steps,
  });
});


router.get("/timeline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  const editorFilter = role === "editor"
    ? eq(tasksTable.assignedToId, userId)
    : isNull(tasksTable.parentTaskId); // coordinators see root tasks only

  const tasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      priority: tasksTable.priority,
      complexity: tasksTable.complexity,
      dueDate: tasksTable.dueDate,
      
      client: tasksTable.client,
      revisionCount: tasksTable.revisionCount,
      folderUrl: tasksTable.folderUrl,
      assignedToId: tasksTable.assignedToId,
      createdById: tasksTable.createdById,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
      taskNumber: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
      taskType: tasksTable.taskType,
    })
    .from(tasksTable)
    .where(editorFilter)
    .orderBy(asc(tasksTable.dueDate), asc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...tasks.map(t => t.assignedToId), ...tasks.map(t => t.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  // Fetch subtasks for multi_tasks
  const multiIds = tasks.filter(t => t.taskType === "multi_task").map(t => t.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

  res.json(tasks.map(t => ({
    id: t.id,
    taskCode: fmtCode(t.taskNumber, t.taskYear),
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    complexity: t.complexity,
    dueDate: t.dueDate,
    
    client: t.client,
    revisionCount: t.revisionCount,
    folderUrl: t.folderUrl,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    taskType: t.taskType,
    assignee: t.assignedToId ? (personMap.get(t.assignedToId) ?? null) : null,
    coordinator: t.createdById ? (personMap.get(t.createdById) ?? null) : null,
    subtaskProgress: t.taskType === "multi_task" ? (progressMap.get(t.id) ?? null) : null,
  })));
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/reports", requireCoordinator, async (req, res): Promise<void> => {
  const { from, to, assignedToId: filterEditor, status: filterStatus, client: filterClient,
          priority: filterPriority, complexity: filterComplexity, scope } = req.query as Record<string, string | undefined>;

  const userId = req.session.userId!;
  const userRole = req.session.userRole!;

  const conditions: any[] = [
    // Exclude subtasks from top-level reports (they inflate counts)
    isNull(tasksTable.parentTaskId),
    from ? gte(tasksTable.createdAt, new Date(from + "T00:00:00")) : undefined,
    to   ? lte(tasksTable.createdAt, new Date(to   + "T23:59:59")) : undefined,
    filterEditor ? eq(tasksTable.assignedToId, parseInt(filterEditor, 10)) : undefined,
    filterStatus ? eq(tasksTable.status, filterStatus) : undefined,
    filterClient ? eq(tasksTable.client, filterClient) : undefined,
    filterPriority ? eq(tasksTable.priority, filterPriority) : undefined,
    filterComplexity ? eq(tasksTable.complexity, filterComplexity) : undefined,
  ].filter(Boolean);

  // "Minhas" scope: only tasks created by this coordinator
  if (scope === "own" || userRole === "coordinator") {
    conditions.push(eq(tasksTable.createdById, userId));
  }

  const rows = await db.select().from(tasksTable).where(and(...conditions)).orderBy(desc(tasksTable.createdAt));

  const personIds = [...new Set([
    ...rows.map(r => r.assignedToId),
    ...rows.map(r => r.createdById),
  ].filter((id): id is number => id !== null))];

  const personMap = new Map<number, { id: number; name: string; avatarUrl: string | null }>();
  if (personIds.length > 0) {
    const persons = await db
      .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(inArray(usersTable.id, personIds));
    persons.forEach(p => personMap.set(p.id, p));
  }

  // Fetch subtask progress for multi_tasks in report
  const multiIds = rows.filter(r => r.taskType === "multi_task").map(r => r.id);
  const progressMap = await getSubtaskProgressMap(multiIds);

  res.json({
    tasks: rows.map(r => ({
      id: r.id,
      taskCode: fmtCode(r.taskNumber, r.taskYear),
      title: r.title,
      status: r.status,
      priority: r.priority,
      complexity: r.complexity,
      client: r.client,
      
      revisionCount: r.revisionCount,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      taskType: r.taskType,
      assignee:    r.assignedToId ? (personMap.get(r.assignedToId) ?? null) : null,
      coordinator: r.createdById  ? (personMap.get(r.createdById)  ?? null) : null,
      subtaskProgress: r.taskType === "multi_task" ? (progressMap.get(r.id) ?? null) : null,
    })),
  });
});


// ── Task editors: add / remove / reassign ────────────────────────────────────

router.get("/tasks/:id/editors", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const editors = await db
    .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, login: usersTable.login })
    .from(taskEditorsTable)
    .innerJoin(usersTable, eq(taskEditorsTable.userId, usersTable.id))
    .where(eq(taskEditorsTable.taskId, id));
  res.json(editors);
});

router.post("/tasks/:id/editors", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.insert(taskEditorsTable).values({
    taskId: id, userId: editorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  if (task.status !== "rascunho") {
    await notify(editorId, "task_assigned",
      "Tarefa atribuída a você",
      `Você foi adicionado à tarefa "${task.title}"`,
      { taskId: id }
    );
  }

  broadcastTaskChange();
  res.json({ ok: true });
});

router.delete("/tasks/:id/editors/:editorId", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const editorId = parseInt(req.params.editorId, 10);
  if (isNaN(id) || isNaN(editorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  await db.delete(taskEditorsTable)
    .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, editorId)));

  if (task.status !== "rascunho") {
    await notify(editorId, "task_reassigned",
      "Removido de tarefa",
      `Você foi removido da tarefa "${task.title}"`,
      { taskId: id }
    );
  }

  broadcastTaskChange();
  res.json({ ok: true });
});

router.post("/tasks/:id/reassign", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const newEditorId = parseInt(String(req.body.editorId), 10);
  if (isNaN(id) || isNaN(newEditorId)) { res.status(400).json({ error: "IDs inválidos" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const [newEditorUser] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, newEditorId));
  if (!newEditorUser) { res.status(404).json({ error: "Editor não encontrado" }); return; }

  const oldEditorId = task.assignedToId;

  if (oldEditorId && oldEditorId !== newEditorId) {
    await notify(oldEditorId, "task_reassigned",
      "Tarefa reatribuída",
      `A tarefa "${task.title}" foi reatribuída para ${newEditorUser.name}`,
      { taskId: id }
    );
    await db.delete(taskEditorsTable)
      .where(and(eq(taskEditorsTable.taskId, id), eq(taskEditorsTable.userId, oldEditorId)));
  }

  const [updated] = await db.update(tasksTable)
    .set({ assignedToId: newEditorId })
    .where(eq(tasksTable.id, id))
    .returning();

  await db.insert(taskEditorsTable).values({
    taskId: id, userId: newEditorId, assignedById: req.session.userId,
  }).onConflictDoNothing();

  await notify(newEditorId, "task_assigned",
    "Tarefa atribuída a você",
    `A tarefa "${task.title}" foi atribuída a você`,
    { taskId: id }
  );

  // Re-aloca slots ESCALA para o novo editor
  if (task.effortHours && newEditorId) {
    await reallocTask(id, newEditorId, Number(task.effortHours), task.startDate, task.dueDate);
  }

  // If subtask reassignment, recalculate parent
  if (task.taskType === "subtask" && task.parentTaskId) {
    await recalculateParentStatus(task.parentTaskId, req.session.userId!);
  }

  broadcastTaskChange();
  res.json(updated);
});

// ── POST /api/tasks/:id/realloc ──────────────────────────────────────────────
// Força re-alocação de slots ESCALA com parâmetros opcionais de override.
// Usado pelo frontend após alterar prazo ou editor via UI.
router.post("/tasks/:id/realloc", requireCoordinator, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (!task.effortHours) { res.status(400).json({ error: "Tarefa sem effortHours" }); return; }

  const editorId = req.body.editorId ? parseInt(String(req.body.editorId), 10) : (task.assignedToId ?? null);
  const startDate = req.body.startDate ? new Date(String(req.body.startDate)) : task.startDate;
  const deadline  = req.body.deadline  ? new Date(String(req.body.deadline))  : task.dueDate;

  if (!editorId) { res.status(400).json({ error: "Sem editor atribuído" }); return; }

  await reallocTask(id, editorId, Number(task.effortHours), startDate, deadline);
  broadcastTaskChange();
  res.json({ ok: true });
});

// ── POST /api/tasks/:id/invite-reviewer ──────────────────────────────────────
router.post("/tasks/:id/invite-reviewer", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { userIds, message } = req.body as { userIds: number[]; message?: string };
  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: "Informe ao menos um usuário" }); return;
  }

  const [task] = await db.select({ id: tasksTable.id, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const inviter = await db.select({ name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, req.session.userId!));
  const inviterName = inviter[0]?.name ?? "Alguém";

  const notifMessage = message?.trim()
    ? `${inviterName}: "${message.trim()}"`
    : `${inviterName} convidou você para revisar esta entrega.`;

  await Promise.all(userIds.map(uid =>
    notify(uid, "review_invite",
      `Revisão: ${task.title}`,
      notifMessage,
      { taskId }
    )
  ));

  res.json({ ok: true, count: userIds.length });
});

// ── GET /api/coordinators — lista coordenadores/supervisores/admins ───────────
router.get("/coordinators", requireCoordinator, async (req, res): Promise<void> => {
  const coords = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.role, ["coordinator", "supervisor", "admin"]));
  res.json(coords.filter(c => c.id !== req.session.userId));
});

// ── GET /api/tasks/:id/coordinators ──────────────────────────────────────────
router.get("/tasks/:id/coordinators", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl, addedAt: taskCoordinatorsTable.addedAt })
    .from(taskCoordinatorsTable)
    .innerJoin(usersTable, eq(taskCoordinatorsTable.userId, usersTable.id))
    .where(eq(taskCoordinatorsTable.taskId, taskId));
  res.json(rows);
});

// ── POST /api/tasks/:id/coordinators — só o titular pode adicionar ────────────
router.post("/tasks/:id/coordinators", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select({ id: tasksTable.id, title: tasksTable.title, createdById: tasksTable.createdById, taskType: tasksTable.taskType })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (task.taskType !== "task") { res.status(400).json({ error: "Co-coordenadores só podem ser adicionados a tarefas simples" }); return; }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  if (role === "coordinator" && task.createdById !== userId) {
    res.status(403).json({ error: "Apenas o titular da tarefa pode adicionar co-coordenadores" }); return;
  }

  const { targetUserId } = req.body as { targetUserId: number };
  if (!targetUserId) { res.status(400).json({ error: "targetUserId obrigatório" }); return; }
  if (targetUserId === task.createdById) { res.status(400).json({ error: "O titular já é responsável pela tarefa" }); return; }

  const [targetUser] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!targetUser || !["coordinator", "supervisor", "admin"].includes(targetUser.role)) {
    res.status(400).json({ error: "Usuário não é coordenador" }); return;
  }

  // Upsert — não duplica
  await db.insert(taskCoordinatorsTable)
    .values({ taskId, userId: targetUserId })
    .onConflictDoNothing();

  const [inviter] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  await notify(targetUserId, "coord_added",
    "Você foi adicionado como co-coordenador",
    `${inviter?.name ?? "Alguém"} adicionou você à tarefa "${task.title}"`,
    { taskId },
  );

  res.json({ ok: true });
});

// ── DELETE /api/tasks/:id/coordinators/:userId — só o titular pode remover ───
router.delete("/tasks/:id/coordinators/:targetId", requireCoordinator, async (req, res): Promise<void> => {
  const taskId   = parseInt(req.params.id, 10);
  const targetId = parseInt(req.params.targetId, 10);
  if (isNaN(taskId) || isNaN(targetId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db.select({ createdById: tasksTable.createdById, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  if (role === "coordinator" && task.createdById !== userId) {
    res.status(403).json({ error: "Apenas o titular da tarefa pode remover co-coordenadores" }); return;
  }

  await db.delete(taskCoordinatorsTable)
    .where(and(eq(taskCoordinatorsTable.taskId, taskId), eq(taskCoordinatorsTable.userId, targetId)));

  res.json({ ok: true });
});

// ── POST /api/tasks/:id/transfer — transfere titularidade para outro coord ─────
router.post("/tasks/:id/transfer", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [task] = await db
    .select({ id: tasksTable.id, title: tasksTable.title, createdById: tasksTable.createdById, taskType: tasksTable.taskType, taskNumber: tasksTable.taskNumber, taskYear: tasksTable.taskYear })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Tarefa não encontrada" }); return; }
  if (task.taskType !== "task") { res.status(400).json({ error: "Transferência só é permitida para tarefas simples" }); return; }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  if (role === "coordinator" && task.createdById !== userId) {
    res.status(403).json({ error: "Apenas o titular pode transferir a tarefa" }); return;
  }

  const { toUserId } = req.body as { toUserId: number };
  if (!toUserId) { res.status(400).json({ error: "toUserId obrigatório" }); return; }
  if (toUserId === task.createdById) { res.status(400).json({ error: "Este coordenador já é o titular" }); return; }

  const [target] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, toUserId));
  if (!target || !["coordinator", "supervisor", "admin"].includes(target.role)) {
    res.status(400).json({ error: "Usuário não é coordenador" }); return;
  }

  // Se o alvo já é co-coord, remove da tabela (vai virar titular)
  await db.delete(taskCoordinatorsTable)
    .where(and(eq(taskCoordinatorsTable.taskId, taskId), eq(taskCoordinatorsTable.userId, toUserId)));

  // Troca o titular
  await db.update(tasksTable)
    .set({ createdById: toUserId, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId));

  // Registra evento no histórico
  await db.insert(taskEventsTable).values({
    taskId,
    fromStatus: "transferred",
    toStatus:   "transferred",
    changedById: userId,
    meta: JSON.stringify({ fromUserId: task.createdById, toUserId, toUserName: target.name }),
  });

  const [transferer] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const taskCode = fmtCode(task.taskNumber, task.taskYear);

  // Notifica o novo titular
  await notify(toUserId, "task_transferred",
    "Tarefa transferida para você",
    `${transferer?.name ?? "Alguém"} transferiu "${taskCode} ${task.title}" para sua responsabilidade`,
    { taskId },
  );

  broadcastTaskChange();
  res.json({ ok: true });
});

// ── Mark review comments as read ──────────────────────────────────────────────
router.post("/tasks/:id/review/mark-read", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const userId = req.session.userId!;
  if (isNaN(taskId)) { res.status(400).json({ error: "invalid id" }); return; }

  await db
    .insert(reviewReadsTable)
    .values({ userId, taskId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [reviewReadsTable.userId, reviewReadsTable.taskId],
      set: { lastReadAt: new Date() },
    });

  res.json({ ok: true });
});

export default router;

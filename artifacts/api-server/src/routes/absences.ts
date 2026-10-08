import { Router } from "express";
import { db, usersTable, userAbsencesTable, tasksTable, dutySchedulesTable } from "@workspace/db";
import { and, eq, gte, lte, ne, desc, asc, or, isNull } from "drizzle-orm";
import { requireAuth, requireSupervisor } from "../lib/auth.js";
import { ABSENCE_TYPES, ABSENCE_LABEL, getAbsencesInRange, todayStr } from "../lib/availability.js";
import { broadcastTaskChange } from "../lib/broadcast.js";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseBody(body: any): { error?: string; value?: { userId: number; startDate: string; endDate: string; type: string; notes: string | null } } {
  const userId = parseInt(String(body?.userId ?? ""), 10);
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  const type = String(body?.type ?? "vacation");
  const notes = body?.notes ? String(body.notes).trim() || null : null;
  if (!userId) return { error: "Usuário obrigatório" };
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return { error: "Datas inválidas (use AAAA-MM-DD)" };
  if (endDate < startDate) return { error: "A data final deve ser igual ou posterior à inicial" };
  if (!(ABSENCE_TYPES as readonly string[]).includes(type)) return { error: "Tipo de ausência inválido" };
  return { value: { userId, startDate, endDate, type, notes } };
}

/** Tarefas abertas e plantões do usuário que caem dentro do período — usado como aviso. */
async function conflictsFor(userId: number, startDate: string, endDate: string) {
  const startD = new Date(startDate + "T00:00:00Z");
  const endD = new Date(endDate + "T23:59:59Z");
  const tasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, startDate: tasksTable.startDate, dueDate: tasksTable.dueDate, status: tasksTable.status })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.assignedToId, userId),
      ne(tasksTable.status, "completed"),
      ne(tasksTable.status, "cancelled"),
      ne(tasksTable.status, "rascunho"),
      // ativa em algum dia do período: começou até o fim e não termina antes do início
      or(isNull(tasksTable.startDate), lte(tasksTable.startDate, endD)),
      or(isNull(tasksTable.dueDate), gte(tasksTable.dueDate, startD)),
    ))
    .orderBy(asc(tasksTable.dueDate));
  const duties = await db
    .select({ id: dutySchedulesTable.id, date: dutySchedulesTable.weekendStart })
    .from(dutySchedulesTable)
    .where(and(
      eq(dutySchedulesTable.editorId, userId),
      gte(dutySchedulesTable.weekendStart, startDate),
      lte(dutySchedulesTable.weekendStart, endDate),
    ))
    .orderBy(asc(dutySchedulesTable.weekendStart));
  return { tasks, duties };
}

// GET /api/absences?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=N
// Sem from/to: ausências atuais e futuras.
router.get("/absences", requireAuth, async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : todayStr();
  const to   = typeof req.query.to   === "string" && DATE_RE.test(req.query.to)   ? req.query.to   : "9999-12-31";
  const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : null;
  const list = await getAbsencesInRange(from, to, userId ? [userId] : undefined);
  res.json(list);
});

// GET /api/absences/history?userId=N — todas as ausências (inclusive passadas) de um usuário
router.get("/absences/history", requireAuth, async (req, res): Promise<void> => {
  const userId = parseInt(String(req.query.userId ?? ""), 10);
  if (!userId) { res.status(400).json({ error: "userId obrigatório" }); return; }
  const rows = await db.select().from(userAbsencesTable)
    .where(eq(userAbsencesTable.userId, userId))
    .orderBy(desc(userAbsencesTable.startDate))
    .limit(50);
  res.json(rows.map(r => ({ ...r, label: ABSENCE_LABEL[r.type] ?? "Ausência" })));
});

// GET /api/absences/conflicts?userId=N&startDate=&endDate= — o que a ausência afeta (aviso)
router.get("/absences/conflicts", requireAuth, async (req, res): Promise<void> => {
  const userId = parseInt(String(req.query.userId ?? ""), 10);
  const startDate = String(req.query.startDate ?? "");
  const endDate = String(req.query.endDate ?? "");
  if (!userId || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    res.status(400).json({ error: "userId, startDate e endDate são obrigatórios" }); return;
  }
  res.json(await conflictsFor(userId, startDate, endDate));
});

router.post("/absences", requireSupervisor, async (req, res): Promise<void> => {
  const parsed = parseBody(req.body);
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value!;

  const [user] = await db.select({ id: usersTable.id, status: usersTable.status }).from(usersTable).where(eq(usersTable.id, v.userId));
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  if (user.status !== "active") { res.status(400).json({ error: "Usuário inativo — não é possível registrar ausência" }); return; }

  const overlap = await getAbsencesInRange(v.startDate, v.endDate, [v.userId]);
  if (overlap.length > 0) {
    res.status(409).json({ error: "Já existe uma ausência registrada que se sobrepõe a esse período" }); return;
  }

  const [row] = await db.insert(userAbsencesTable).values({ ...v, createdById: req.session.userId }).returning();
  const conflicts = await conflictsFor(v.userId, v.startDate, v.endDate);
  broadcastTaskChange();
  res.status(201).json({ absence: { ...row, label: ABSENCE_LABEL[row!.type] ?? "Ausência" }, conflicts });
});

router.put("/absences/:id", requireSupervisor, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select().from(userAbsencesTable).where(eq(userAbsencesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Ausência não encontrada" }); return; }

  const parsed = parseBody({ ...existing, ...req.body, userId: existing.userId });
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value!;

  const overlap = (await getAbsencesInRange(v.startDate, v.endDate, [v.userId])).filter(a => a.id !== id);
  if (overlap.length > 0) {
    res.status(409).json({ error: "Já existe uma ausência registrada que se sobrepõe a esse período" }); return;
  }

  const [row] = await db.update(userAbsencesTable)
    .set({ startDate: v.startDate, endDate: v.endDate, type: v.type, notes: v.notes })
    .where(eq(userAbsencesTable.id, id)).returning();
  const conflicts = await conflictsFor(v.userId, v.startDate, v.endDate);
  broadcastTaskChange();
  res.json({ absence: { ...row, label: ABSENCE_LABEL[row!.type] ?? "Ausência" }, conflicts });
});

router.delete("/absences/:id", requireSupervisor, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db.delete(userAbsencesTable).where(eq(userAbsencesTable.id, id));
  broadcastTaskChange();
  res.sendStatus(204);
});

export default router;

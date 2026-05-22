import { Router } from "express";
import { db, dutySchedulesTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

function getAllSaturdaysInYear(year: number): string[] {
  const saturdays: string[] = [];
  const d = new Date(year, 0, 1);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  while (d.getFullYear() === year) {
    saturdays.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 7);
  }
  return saturdays;
}

function getThisWeekendSaturday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -1 : 6 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// GET /api/duty/upcoming — last + this + next weekend + upcoming holidays in the next ~30 days
router.get("/duty/upcoming", requireAuth, async (_req, res): Promise<void> => {
  const thisSat = getThisWeekendSaturday();

  const lastSat = new Date(thisSat); lastSat.setDate(lastSat.getDate() - 7);
  const nextSat = new Date(thisSat); nextSat.setDate(nextSat.getDate() + 7);
  const until   = new Date(thisSat); until.setDate(until.getDate() + 37);

  const lastSatStr = lastSat.toISOString().split("T")[0];
  const thisSatStr = thisSat.toISOString().split("T")[0];
  const nextSatStr = nextSat.toISOString().split("T")[0];
  const untilStr   = until.toISOString().split("T")[0];
  const todayStr   = new Date().toISOString().split("T")[0];

  const rows = await db
    .select({
      id: dutySchedulesTable.id,
      weekendStart: dutySchedulesTable.weekendStart,
      slotType: dutySchedulesTable.slotType,
      notes: dutySchedulesTable.notes,
      editorId: usersTable.id,
      editorName: usersTable.name,
      editorAvatarUrl: usersTable.avatarUrl,
    })
    .from(dutySchedulesTable)
    .leftJoin(usersTable, eq(dutySchedulesTable.editorId, usersTable.id))
    .where(and(gte(dutySchedulesTable.weekendStart, lastSatStr), lte(dutySchedulesTable.weekendStart, untilStr)));

  const sunOf = (satStr: string) => {
    const d = new Date(satStr + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const editorsByDate = (dateStr: string) =>
    rows
      .filter(r => r.weekendStart === dateStr && r.editorId)
      .map(r => ({ id: r.editorId!, name: r.editorName!, avatarUrl: r.editorAvatarUrl ?? null, slotType: r.slotType }));

  const group = (satStr: string) => ({
    weekendStart: satStr,
    satEditors: editorsByDate(satStr),
    sunEditors: editorsByDate(sunOf(satStr)),
  });

  // Weekday-only entries (holidays / special days) — exclude all Sat & Sun
  const holidayByDate = new Map<string, { dutyDate: string; notes: string | null; editors: { id: number; name: string; avatarUrl: string | null }[] }>();
  for (const row of rows) {
    const dow = new Date(row.weekendStart + "T12:00:00").getDay();
    if (dow !== 6 && dow !== 0 && row.weekendStart >= lastSatStr) {
      if (!holidayByDate.has(row.weekendStart)) {
        holidayByDate.set(row.weekendStart, { dutyDate: row.weekendStart, notes: row.notes ?? null, editors: [] });
      }
      if (row.editorId) {
        holidayByDate.get(row.weekendStart)!.editors.push({
          id: row.editorId!, name: row.editorName!, avatarUrl: row.editorAvatarUrl ?? null,
        });
      }
    }
  }

  res.setHeader("Cache-Control", "no-cache, no-store");
  res.json({
    lastWeekend:      group(lastSatStr),
    thisWeekend:      group(thisSatStr),
    nextWeekend:      group(nextSatStr),
    upcomingHolidays: Array.from(holidayByDate.values()),
  });
});

// GET /api/duty?year=2026&month=5 — entries for a specific month (or full year if month omitted)
// Returns only dates that have entries; the frontend synthesises empty slots.
router.get("/duty", requireAuth, async (req, res): Promise<void> => {
  const year     = parseInt(String(req.query.year  ?? new Date().getFullYear()), 10);
  const monthRaw = req.query.month !== undefined ? parseInt(String(req.query.month), 10) : null;

  let start: string;
  let end:   string;

  if (monthRaw !== null && monthRaw >= 1 && monthRaw <= 12) {
    const m       = String(monthRaw).padStart(2, "0");
    const lastDay = new Date(year, monthRaw, 0).getDate();
    start = `${year}-${m}-01`;
    end   = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
  } else {
    start = `${year}-01-01`;
    end   = `${year}-12-31`;
  }

  const rows = await db
    .select({
      id: dutySchedulesTable.id,
      weekendStart: dutySchedulesTable.weekendStart,
      slotType: dutySchedulesTable.slotType,
      notes: dutySchedulesTable.notes,
      editorId: usersTable.id,
      editorName: usersTable.name,
      editorAvatarUrl: usersTable.avatarUrl,
    })
    .from(dutySchedulesTable)
    .leftJoin(usersTable, eq(dutySchedulesTable.editorId, usersTable.id))
    .where(and(gte(dutySchedulesTable.weekendStart, start), lte(dutySchedulesTable.weekendStart, end)))
    .orderBy(dutySchedulesTable.weekendStart);

  const byDate = new Map<string, {
    weekendStart: string;
    editors: { id: number; name: string; avatarUrl: string | null; scheduleId: number; slotType: string }[];
    notes: string | null;
  }>();

  for (const row of rows) {
    if (!byDate.has(row.weekendStart)) {
      byDate.set(row.weekendStart, { weekendStart: row.weekendStart, editors: [], notes: null });
    }
    const entry = byDate.get(row.weekendStart)!;
    if (row.notes) entry.notes = row.notes;
    if (row.editorId) {
      entry.editors.push({
        id: row.editorId,
        name: row.editorName!,
        avatarUrl: row.editorAvatarUrl ?? null,
        scheduleId: row.id,
        slotType: row.slotType,
      });
    }
  }

  res.setHeader("Cache-Control", "no-cache, no-store");
  res.json(Array.from(byDate.values()));
});

// POST /api/duty/sorteio — annual draw for exactly 2 editors (admin/supervisor)
// Algorithm: editors alternate Sat/Sun each weekend.
//   Weekend 0: editorA → Sat, editorB → Sun
//   Weekend 1: editorB → Sat, editorA → Sun  … and so on
router.post("/duty/sorteio", requireAuth, async (req, res): Promise<void> => {
  if (!["admin", "supervisor"].includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Sem permissão" }); return; }
  const { year, editorIds, replaceExisting } = req.body ?? {};

  if (!year || !Array.isArray(editorIds) || editorIds.length !== 2) {
    res.status(400).json({ error: "Informe o ano e exatamente 2 editores" }); return;
  }

  const parsedYear = parseInt(String(year), 10);
  const [idA, idB] = (editorIds as unknown[]).map(Number);

  if (isNaN(idA) || isNaN(idB) || idA <= 0 || idB <= 0 || idA === idB) {
    res.status(400).json({ error: "Informe 2 editores distintos e válidos" }); return;
  }

  const saturdays = getAllSaturdaysInYear(parsedYear);

  if (replaceExisting) {
    // Remove Sáb + Dom; preserva feriados em dias úteis
    const allEntries = await db
      .select({ id: dutySchedulesTable.id, weekendStart: dutySchedulesTable.weekendStart })
      .from(dutySchedulesTable)
      .where(and(gte(dutySchedulesTable.weekendStart, `${parsedYear}-01-01`),
                 lte(dutySchedulesTable.weekendStart, `${parsedYear}-12-31`)));
    const weekendIds = allEntries
      .filter(r => {
        const dow = new Date(r.weekendStart + "T12:00:00").getDay();
        return dow === 6 || dow === 0;
      })
      .map(r => r.id);
    if (weekendIds.length > 0) {
      await db.delete(dutySchedulesTable).where(inArray(dutySchedulesTable.id, weekendIds));
    }
  }

  // Weekend i (0-indexed): Sáb → editors[i%2], Dom → editors[(i+1)%2]
  const editors = [idA, idB];
  const inserts = saturdays.flatMap((sat, i) => {
    const editorSat = editors[i % 2];
    const editorSun = editors[(i + 1) % 2];
    const sun = new Date(sat + "T12:00:00");
    sun.setDate(sun.getDate() + 1);
    const sunStr = sun.toISOString().split("T")[0];
    return [
      { weekendStart: sat,    editorId: editorSat, slotType: "normal", createdById: req.session.userId },
      { weekendStart: sunStr, editorId: editorSun, slotType: "normal", createdById: req.session.userId },
    ];
  });

  await db.insert(dutySchedulesTable).values(inserts).onConflictDoNothing();
  res.json({ weeks: saturdays.length, entries: inserts.length });
});

// POST /api/duty — add editor or create event on any date
// editorId may be omitted when creating a named event (notes required in that case)
router.post("/duty", requireAuth, async (req, res): Promise<void> => {
  if (!["admin", "supervisor"].includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Sem permissão" }); return; }
  const { weekendStart, editorId, notes, slotType: bodySlotType } = req.body ?? {};
  if (!weekendStart) { res.status(400).json({ error: "Data obrigatória" }); return; }
  if (!editorId && !notes) { res.status(400).json({ error: "Informe o editor ou o nome do evento" }); return; }

  const dateStr  = String(weekendStart);
  const parsedId = editorId ? parseInt(String(editorId), 10) : null;

  // Event-only row (no editor)
  if (!parsedId) {
    const [row] = await db.insert(dutySchedulesTable).values({
      weekendStart: dateStr,
      editorId: null as unknown as number,
      slotType: "extra",
      notes: String(notes),
      createdById: req.session.userId,
    }).onConflictDoNothing().returning();
    res.json(row ?? null);
    return;
  }

  const dow    = new Date(dateStr + "T12:00:00").getDay();
  const isWknd = dow === 6 || dow === 0;

  let slotType = "extra";
  if (bodySlotType && ["normal", "extra"].includes(String(bodySlotType))) {
    slotType = String(bodySlotType);
  } else if (isWknd) {
    const [{ existing }] = await db
      .select({ existing: count() })
      .from(dutySchedulesTable)
      .where(eq(dutySchedulesTable.weekendStart, dateStr));
    slotType = Number(existing) === 0 ? "normal" : "extra";
  }

  const [row] = await db.insert(dutySchedulesTable).values({
    weekendStart: dateStr,
    editorId: parsedId,
    slotType,
    notes: notes ? String(notes) : null,
    createdById: req.session.userId,
  }).onConflictDoNothing().returning();

  res.json(row ?? null);
});

// DELETE /api/duty/all — clear entire schedule (admin)
router.delete("/duty/all", requireAuth, async (req, res): Promise<void> => {
  if (!["admin", "supervisor"].includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(dutySchedulesTable);
  res.json({ ok: true });
});

// DELETE /api/duty/:id — remove a single entry (admin)
router.delete("/duty/:id", requireAuth, async (req, res): Promise<void> => {
  if (!["admin", "supervisor"].includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Sem permissão" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(dutySchedulesTable).where(eq(dutySchedulesTable.id, id));
  res.json({ ok: true });
});

export default router;

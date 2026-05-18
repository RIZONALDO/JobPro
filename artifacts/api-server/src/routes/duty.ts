import { Router } from "express";
import { db, dutySchedulesTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
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
      editorId: usersTable.id,
      editorName: usersTable.name,
      editorAvatarUrl: usersTable.avatarUrl,
    })
    .from(dutySchedulesTable)
    .leftJoin(usersTable, eq(dutySchedulesTable.editorId, usersTable.id))
    .where(and(gte(dutySchedulesTable.weekendStart, lastSatStr), lte(dutySchedulesTable.weekendStart, untilStr)));

  const group = (satStr: string) => ({
    weekendStart: satStr,
    editors: rows
      .filter(r => r.weekendStart === satStr && r.editorId)
      .map(r => ({ id: r.editorId!, name: r.editorName!, avatarUrl: r.editorAvatarUrl ?? null })),
  });

  // Non-Saturday entries from today onwards (holidays / special days)
  const weekendDates = new Set([lastSatStr, thisSatStr, nextSatStr]);
  const holidayByDate = new Map<string, { dutyDate: string; editors: { id: number; name: string; avatarUrl: string | null }[] }>();
  for (const row of rows) {
    const isSaturday = new Date(row.weekendStart + "T12:00:00").getDay() === 6;
    if (!weekendDates.has(row.weekendStart) && !isSaturday && row.weekendStart >= todayStr) {
      if (!holidayByDate.has(row.weekendStart)) {
        holidayByDate.set(row.weekendStart, { dutyDate: row.weekendStart, editors: [] });
      }
      if (row.editorId) {
        holidayByDate.get(row.weekendStart)!.editors.push({
          id: row.editorId!, name: row.editorName!, avatarUrl: row.editorAvatarUrl ?? null,
        });
      }
    }
  }

  res.json({
    lastWeekend:      group(lastSatStr),
    thisWeekend:      group(thisSatStr),
    nextWeekend:      group(nextSatStr),
    upcomingHolidays: Array.from(holidayByDate.values()),
  });
});

// GET /api/duty?year=2026 — all weekends + holiday entries for year
router.get("/duty", requireAuth, async (req, res): Promise<void> => {
  const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const rows = await db
    .select({
      id: dutySchedulesTable.id,
      weekendStart: dutySchedulesTable.weekendStart,
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
    editors: { id: number; name: string; avatarUrl: string | null; scheduleId: number }[];
    notes: string | null;
  }>();

  for (const row of rows) {
    if (!byDate.has(row.weekendStart)) {
      byDate.set(row.weekendStart, { weekendStart: row.weekendStart, editors: [], notes: row.notes });
    }
    if (row.editorId) {
      byDate.get(row.weekendStart)!.editors.push({
        id: row.editorId,
        name: row.editorName!,
        avatarUrl: row.editorAvatarUrl ?? null,
        scheduleId: row.id,
      });
    }
  }

  const allSaturdays = getAllSaturdaysInYear(year);
  const satSet = new Set(allSaturdays);
  // Include non-Saturday dates (holidays/special days) that have entries
  const extraDates = Array.from(byDate.keys()).filter(d => !satSet.has(d));
  const allDates = [...allSaturdays, ...extraDates].sort();

  const result = allDates.map(d =>
    byDate.get(d) ?? { weekendStart: d, editors: [], notes: null }
  );

  res.json(result);
});

// POST /api/duty/bulk — rotate editors across all weekends of a year (admin)
// Round-robin: with editors [A, B], assigns A→wk1, B→wk2, A→wk3, B→wk4, …
router.post("/duty/bulk", requireAuth, async (req, res): Promise<void> => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Sem permissão" }); return; }
  const { year, editorIds, replaceExisting } = req.body ?? {};

  if (!year || !Array.isArray(editorIds) || editorIds.length === 0) {
    res.status(400).json({ error: "Informe o ano e ao menos um editor" }); return;
  }

  const parsedYear    = parseInt(String(year), 10);
  const parsedEditors = (editorIds as unknown[]).map(Number).filter(n => !isNaN(n) && n > 0);
  const saturdays     = getAllSaturdaysInYear(parsedYear);

  if (replaceExisting) {
    // Only delete Saturday entries; preserve manually added holidays
    const satEntries = await db
      .select({ id: dutySchedulesTable.id, weekendStart: dutySchedulesTable.weekendStart })
      .from(dutySchedulesTable)
      .where(and(gte(dutySchedulesTable.weekendStart, `${parsedYear}-01-01`),
                 lte(dutySchedulesTable.weekendStart, `${parsedYear}-12-31`)));
    const satIds = satEntries
      .filter(r => new Date(r.weekendStart + "T12:00:00").getDay() === 6)
      .map(r => r.id);
    if (satIds.length > 0) {
      await db.delete(dutySchedulesTable).where(inArray(dutySchedulesTable.id, satIds));
    }
  }

  // One editor per weekend, rotating through the list
  const inserts = saturdays.map((sat, i) => ({
    weekendStart: sat,
    editorId: parsedEditors[i % parsedEditors.length],
    createdById: req.session.userId,
  }));

  await db.insert(dutySchedulesTable).values(inserts).onConflictDoNothing();
  res.json({ weeks: saturdays.length, entries: inserts.length });
});

// POST /api/duty — add editor to any date (weekend or holiday) — admin only
router.post("/duty", requireAuth, async (req, res): Promise<void> => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Sem permissão" }); return; }
  const { weekendStart, editorId, notes } = req.body ?? {};
  if (!weekendStart || !editorId) { res.status(400).json({ error: "Dados obrigatórios" }); return; }

  const [row] = await db.insert(dutySchedulesTable).values({
    weekendStart: String(weekendStart),
    editorId: parseInt(String(editorId), 10),
    notes: notes ? String(notes) : null,
    createdById: req.session.userId,
  }).onConflictDoNothing().returning();

  res.json(row ?? null);
});

// DELETE /api/duty/:id — remove a single entry (admin)
router.delete("/duty/:id", requireAuth, async (req, res): Promise<void> => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Sem permissão" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(dutySchedulesTable).where(eq(dutySchedulesTable.id, id));
  res.json({ ok: true });
});

export default router;

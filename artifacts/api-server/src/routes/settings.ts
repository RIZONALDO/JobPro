import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.key] = row.value ?? null;
  res.json(settings);
});

router.put("/settings", requireAdmin, async (req, res): Promise<void> => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") { res.status(400).json({ error: "Body inválido" }); return; }

  for (const [key, value] of Object.entries(updates)) {
    await db.insert(appSettingsTable).values({ key, value: String(value) })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: String(value) } });
  }

  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.key] = row.value ?? null;
  res.json(settings);
});

export default router;

import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import { pool } from "@workspace/db";

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

router.post("/admin/reset", requireAdmin, async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`
      TRUNCATE
        te_task_events,
        te_task_revisions,
        te_notifications,
        te_user_presence,
        te_direct_messages,
        te_chat_messages,
        te_feed_reactions,
        te_feed_comments,
        te_feed_items,
        te_tasks
      CASCADE;
    `);
    await client.query(`DELETE FROM te_users WHERE role != 'admin'`);
    await client.query(`DELETE FROM session`);
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

export default router;

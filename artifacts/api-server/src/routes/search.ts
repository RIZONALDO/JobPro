import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/search", requireAuth, async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) {
    res.json({ tasks: [], users: [], projects: [] });
    return;
  }

  const like = `%${q}%`;

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const [tasks, users, projects] = await Promise.all([
    safe(() => db.execute(sql`
      SELECT DISTINCT
        t.id,
        LPAD(t.task_number::text, 3, '0') || '.' || LPAD(t.task_year::text, 2, '0') AS "taskCode",
        t.title,
        t.status,
        t.client,
        au.name       AS "assignedName",
        au.avatar_url AS "assignedAvatar"
      FROM te_tasks t
      LEFT JOIN te_users        au ON t.assigned_to_id = au.id
      LEFT JOIN te_users        cu ON t.created_by_id  = cu.id
      LEFT JOIN te_task_editors te ON te.task_id = t.id
      LEFT JOIN te_users        eu ON te.user_id  = eu.id
      WHERE
           t.title       ILIKE ${like}
        OR t.description ILIKE ${like}
        OR t.client      ILIKE ${like}
        OR t.notes       ILIKE ${like}
        OR (LPAD(t.task_number::text, 3, '0') || '.' || LPAD(t.task_year::text, 2, '0')) ILIKE ${like}
        OR au.name ILIKE ${like}
        OR cu.name ILIKE ${like}
        OR eu.name ILIKE ${like}
      ORDER BY t.id DESC
      LIMIT 8
    `).then(r => r.rows), []),

    safe(() => db.execute(sql`
      SELECT id, name, avatar_url AS "avatarUrl", job_title AS "jobTitle", role
      FROM te_users
      WHERE
           name      ILIKE ${like}
        OR email     ILIKE ${like}
        OR phone     ILIKE ${like}
        OR job_title ILIKE ${like}
      ORDER BY name
      LIMIT 5
    `).then(r => r.rows), []),

    safe(() => db.execute(sql`
      SELECT id, name, client, status
      FROM te_projects
      WHERE
           name        ILIKE ${like}
        OR client      ILIKE ${like}
        OR description ILIKE ${like}
      ORDER BY name
      LIMIT 5
    `).then(r => r.rows), []),
  ]);

  res.json({ tasks, users, projects });
});

export default router;

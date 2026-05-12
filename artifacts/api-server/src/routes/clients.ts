import { Router } from "express";
import { db, clientsTable } from "@workspace/db";
import { asc, ilike, sql } from "drizzle-orm";
import { requireAuth, requireCoordinator } from "../lib/auth.js";

const router = Router();

// List all clients
router.get("/clients", requireAuth, async (_req, res): Promise<void> => {
  const clients = await db.select().from(clientsTable).orderBy(asc(clientsTable.name));
  res.json(clients);
});

// Create a new client (case-insensitive duplicate check)
router.post("/clients", requireCoordinator, async (req, res): Promise<void> => {
  const name = String(req.body.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "Nome obrigatório" }); return; }

  // Check for existing (case-insensitive)
  const [existing] = await db.select().from(clientsTable)
    .where(sql`lower(${clientsTable.name}) = lower(${name})`);
  if (existing) { res.json(existing); return; }

  const [created] = await db.insert(clientsTable).values({ name }).returning();
  res.status(201).json(created);
});

export default router;

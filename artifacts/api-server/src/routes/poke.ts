import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastPoke } from "../lib/broadcast.js";

const router = Router();

router.post("/poke/:userId", requireAuth, async (req, res): Promise<void> => {
  const fromId = req.session.userId!;
  const toId = parseInt(req.params.userId, 10);
  if (isNaN(toId) || toId === fromId) { res.status(400).json({ error: "ID inválido" }); return; }

  const [from] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, fromId));
  broadcastPoke(toId, from?.name ?? "Alguém");
  res.sendStatus(204);
});

export default router;

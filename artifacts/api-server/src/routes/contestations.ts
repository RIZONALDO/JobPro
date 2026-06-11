import { Router } from "express";
import {
  db, contestationsTable, usersTable, tasksTable,
  taskAllocationsTable, notificationsTable,
} from "@workspace/db";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import { requireCoordinator } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";

const router = Router();

// ── GET /api/contestations ────────────────────────────────────────────────────
router.get("/contestations", requireCoordinator, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const rows = await db
    .select()
    .from(contestationsTable)
    .where(or(
      eq(contestationsTable.requesterId, userId),
      eq(contestationsTable.targetCoordinatorId, userId),
    ))
    .orderBy(desc(contestationsTable.createdAt));

  const ids = [...new Set([
    ...rows.map(r => r.requesterId),
    ...rows.map(r => r.targetCoordinatorId),
  ])];

  const users = ids.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
        .from(usersTable).where(inArray(usersTable.id, ids))
    : [];

  const uMap = new Map(users.map(u => [u.id, u]));

  res.json(rows.map(r => ({
    ...r,
    requester:         uMap.get(r.requesterId)         ?? null,
    targetCoordinator: uMap.get(r.targetCoordinatorId) ?? null,
  })));
});

// ── POST /api/contestations ───────────────────────────────────────────────────
router.post("/contestations", requireCoordinator, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const {
    editorId, editorName,
    displacedTaskId, displacedTaskTitle, displacedTaskColor,
    originalSlots, proposedSlots,
    targetCoordinatorId,
  } = req.body;

  if (!editorId || !displacedTaskId || !originalSlots || !proposedSlots || !targetCoordinatorId) {
    res.status(400).json({ error: "Parâmetros inválidos" }); return;
  }
  if (targetCoordinatorId === userId) {
    res.status(400).json({ error: "Não é possível contestar suas próprias tarefas" }); return;
  }

  const existing = await db
    .select({ id: contestationsTable.id })
    .from(contestationsTable)
    .where(and(
      eq(contestationsTable.displacedTaskId, displacedTaskId),
      eq(contestationsTable.status, "pending"),
    ))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Já existe uma proposta pendente para essa tarefa" }); return;
  }

  const [c] = await db.insert(contestationsTable).values({
    requesterId:         userId,
    targetCoordinatorId,
    editorId,
    editorName:          editorName ?? "Editor",
    displacedTaskId,
    displacedTaskTitle,
    displacedTaskColor:  displacedTaskColor ?? null,
    originalSlots,
    proposedSlots,
    status: "pending",
  }).returning();

  // Notifica o coordenador alvo
  await db.insert(notificationsTable).values({
    userId:  targetCoordinatorId,
    type:    "contestation_received",
    title:   "Proposta de reagendamento",
    message: `Solicitação para mover "${displacedTaskTitle}"`,
    taskId:  displacedTaskId,
  });

  res.status(201).json(c);
});

// ── PUT /api/contestations/:id/accept ────────────────────────────────────────
router.put("/contestations/:id/accept", requireCoordinator, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string);
  const userId = req.session.userId!;

  const [c] = await db.select().from(contestationsTable).where(eq(contestationsTable.id, id));
  if (!c)                             { res.status(404).json({ error: "Não encontrada" });          return; }
  if (c.targetCoordinatorId !== userId) { res.status(403).json({ error: "Sem permissão" });           return; }
  if (c.status !== "pending")         { res.status(400).json({ error: "Não está pendente" });        return; }

  const slots = c.proposedSlots as { date: string; hours: number; startTime?: string; endTime?: string }[];

  await db.transaction(async (tx) => {
    await tx.delete(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, c.displacedTaskId));
    if (slots.length > 0) {
      await tx.insert(taskAllocationsTable).values(
        slots.map(s => ({
          taskId:         c.displacedTaskId,
          editorId:       c.editorId,
          workDate:       s.date,
          allocatedHours: s.hours,
          startTime:      s.startTime ?? null,
          endTime:        s.endTime   ?? null,
        }))
      );
    }
    await tx.update(contestationsTable)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(eq(contestationsTable.id, id));
  });

  await db.insert(notificationsTable).values({
    userId:  c.requesterId,
    type:    "contestation_responded",
    title:   "Reagendamento aceito ✓",
    message: `"${c.displacedTaskTitle}" foi movida para o novo horário`,
    taskId:  c.displacedTaskId,
  });

  broadcastTaskChange();
  res.json({ ok: true });
});

// ── PUT /api/contestations/:id/refuse ────────────────────────────────────────
router.put("/contestations/:id/refuse", requireCoordinator, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string);
  const userId = req.session.userId!;
  const { reason } = req.body as { reason?: string };

  const [c] = await db.select().from(contestationsTable).where(eq(contestationsTable.id, id));
  if (!c)                             { res.status(404).json({ error: "Não encontrada" }); return; }
  if (c.targetCoordinatorId !== userId) { res.status(403).json({ error: "Sem permissão" });  return; }
  if (c.status !== "pending")         { res.status(400).json({ error: "Não está pendente" }); return; }

  await db.update(contestationsTable)
    .set({ status: "refused", refusalReason: reason ?? null, respondedAt: new Date() })
    .where(eq(contestationsTable.id, id));

  await db.insert(notificationsTable).values({
    userId:  c.requesterId,
    type:    "contestation_responded",
    title:   "Reagendamento recusado",
    message: reason ? `Motivo: ${reason}` : `"${c.displacedTaskTitle}" não será movida`,
    taskId:  c.displacedTaskId,
  });

  res.json({ ok: true });
});

// ── DELETE /api/contestations/:id ────────────────────────────────────────────
router.delete("/contestations/:id", requireCoordinator, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string);
  const userId = req.session.userId!;

  const [c] = await db.select().from(contestationsTable).where(eq(contestationsTable.id, id));
  if (!c)                   { res.status(404).json({ error: "Não encontrada" });                         return; }
  if (c.requesterId !== userId) { res.status(403).json({ error: "Sem permissão" });                        return; }
  if (c.status !== "pending") { res.status(400).json({ error: "Só é possível cancelar propostas pendentes" }); return; }

  await db.update(contestationsTable)
    .set({ status: "cancelled" })
    .where(eq(contestationsTable.id, id));

  res.json({ ok: true });
});

export default router;

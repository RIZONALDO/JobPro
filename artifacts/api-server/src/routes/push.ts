import { Router } from "express";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { getVapidPublicKey } from "../lib/webpush.js";

const router = Router();

/** Retorna a chave pública VAPID para o frontend criar a subscription */
router.get("/push/vapid-public-key", requireAuth, (_req, res): void => {
  const key = getVapidPublicKey();
  if (!key) { res.status(503).json({ error: "Push não configurado" }); return; }
  res.json({ publicKey: key });
});

/** Salva (ou atualiza) a subscription do browser no banco */
router.post("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Dados incompletos" });
    return;
  }

  // Upsert: endpoint é unique — se já existir para outro user, atualiza; se for o mesmo user, ignora
  const existing = await db
    .select({ id: pushSubscriptionsTable.id, userId: pushSubscriptionsTable.userId })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  if (existing.length > 0) {
    if (existing[0].userId !== userId) {
      // Endpoint trocou de usuário (browser compartilhado) — atualizar
      await db.update(pushSubscriptionsTable)
        .set({ userId, p256dh: keys.p256dh, auth: keys.auth })
        .where(eq(pushSubscriptionsTable.id, existing[0].id));
    }
    // Mesmo usuário: já está salvo, não precisa fazer nada
    res.sendStatus(204);
    return;
  }

  await db.insert(pushSubscriptionsTable).values({
    userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });

  res.sendStatus(204);
});

/** Remove a subscription (quando usuário desativa notificações push) */
router.delete("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const { endpoint } = req.body as { endpoint: string };

  if (!endpoint) { res.status(400).json({ error: "endpoint obrigatório" }); return; }

  await db.delete(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.userId, userId),
      eq(pushSubscriptionsTable.endpoint, endpoint),
    ));

  res.sendStatus(204);
});

export default router;

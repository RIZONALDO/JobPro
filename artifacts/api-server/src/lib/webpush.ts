import webpush from "web-push";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let initialized = false;

export function initVapid() {
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT ?? "mailto:admin@jobpro.app";

  if (!publicKey || !privateKey) {
    console.warn("[webpush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configurados — push desativado");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
  console.info("[webpush] VAPID inicializado");
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!initialized) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  console.info(`[webpush] userId=${userId} subs=${subs.length} title="${payload.title}"`);
  if (subs.length === 0) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
          { TTL: 60 }
        );
        console.info(`[webpush] enviado ok subId=${sub.id}`);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        console.warn(`[webpush] erro subId=${sub.id} status=${status}`, err);
        // 410 Gone = subscription expirou, remover do banco
        if (status === 410 || status === 404) {
          await db.delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, sub.id));
          console.info(`[webpush] subscription removida subId=${sub.id}`);
        }
      }
    })
  );
}

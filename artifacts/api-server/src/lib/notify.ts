import { db, notificationsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { broadcastNotification } from "./broadcast.js";
import { sendPushToUser } from "./webpush.js";

export interface AppNotification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  taskId: number | null;
  jobId: number | null;
  createdAt: Date;
}

export async function notify(
  userId: number,
  type: string,
  title: string,
  message: string,
  refs?: { taskId?: number; jobId?: number }
) {
  // Usuários inativos saíram da equipe: não recebem notificação nem push.
  const [target] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, userId));
  if (!target || target.status !== "active") return;

  const [row] = await db.insert(notificationsTable).values({
    userId,
    type,
    title,
    message,
    taskId: refs?.taskId ?? null,
    jobId: refs?.jobId ?? null,
  }).returning();

  // Enviar via socket em tempo real
  broadcastNotification(userId, row as AppNotification);

  // Enviar push nativo (background / aba fechada) — fire-and-forget
  sendPushToUser(userId, { title, body: message }).catch(() => {});
}

export async function notifyAdmins(
  type: string,
  title: string,
  message: string,
  refs?: { taskId?: number; jobId?: number }
) {
  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.status, "active")));
  await Promise.all(admins.map(a => notify(a.id, type, title, message, refs)));
}

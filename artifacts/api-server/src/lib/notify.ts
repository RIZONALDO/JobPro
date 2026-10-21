import { db, notificationsTable, usersTable, taskFollowersTable } from "@workspace/db";
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

/** Ids dos gestores que acompanham o job. */
export async function taskFollowers(taskId: number): Promise<number[]> {
  const rows = await db.select({ userId: taskFollowersTable.userId }).from(taskFollowersTable).where(eq(taskFollowersTable.taskId, taskId));
  return rows.map(r => r.userId);
}

/** Avisa os acompanhantes do job, menos quem fez a ação e quem já foi avisado. */
export async function notifyFollowers(taskId: number, exclude: (number | null | undefined)[], type: string, title: string, message: string) {
  const skip = new Set(exclude.filter((x): x is number => x != null));
  for (const uid of await taskFollowers(taskId)) if (!skip.has(uid)) await notify(uid, type, title, message, { taskId });
}

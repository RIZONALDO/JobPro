import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastNotification } from "./broadcast.js";

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
    .where(eq(usersTable.role, "admin"));
  await Promise.all(admins.map(a => notify(a.id, type, title, message, refs)));
}

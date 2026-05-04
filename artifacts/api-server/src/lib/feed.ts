import { db, feedItemsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getIo } from "./io.js";

export async function createFeedItem(params: {
  type: string;
  title: string;
  content?: string;
  actorId?: number;
  entityId?: number;
  entityType?: string;
  jobId?: number;
}) {
  const [item] = await db.insert(feedItemsTable).values({
    type: params.type,
    title: params.title,
    content: params.content ?? null,
    actorId: params.actorId ?? null,
    entityId: params.entityId ?? null,
    entityType: params.entityType ?? null,
    jobId: params.jobId ?? null,
  }).returning();

  let actor: { id: number; name: string; avatarUrl: string | null } | null = null;
  if (params.actorId) {
    const [u] = await db
      .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, params.actorId));
    actor = u ?? null;
  }

  const enriched = { ...item, actor, reactions: [], commentCount: 0 };
  try { getIo().emit("feed:new_item", enriched); } catch {}

  return item;
}

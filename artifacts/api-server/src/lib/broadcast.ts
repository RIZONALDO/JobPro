import { getIo } from "./io.js";
import type { AppNotification } from "./notify.js";

export function broadcastFeedReaction(feedItemId: number, reactions: unknown[]) {
  try { getIo().emit("feed:reaction", { feedItemId, reactions }); } catch {}
}

export function broadcastFeedComment(feedItemId: number, comment: unknown) {
  try { getIo().emit("feed:comment", { feedItemId, comment }); } catch {}
}

export function broadcastFeedCommentDeleted(feedItemId: number, commentId: number) {
  try { getIo().emit("feed:comment_deleted", { feedItemId, commentId }); } catch {}
}

export function broadcastChatMessage(message: unknown) {
  try { getIo().emit("chat:message", message); } catch {}
}

export function broadcastPresence(userId: number, isOnline: boolean, user: { id: number; name: string; avatarUrl: string | null }) {
  try { getIo().emit("presence:update", { userId, isOnline, user }); } catch {}
}

export function broadcastTaskChange() {
  try { getIo().emit("tasks:changed", {}); } catch {}
}

export function broadcastNotification(userId: number, notification: AppNotification) {
  try {
    getIo().to(`user:${userId}`).emit("notification:new", notification);
  } catch {}
}

export function broadcastPoke(toUserId: number, fromName: string) {
  try { getIo().to(`user:${toUserId}`).emit("poke:received", { fromName }); } catch {}
}

export function broadcastDm(toUserId: number, fromUserId: number, message: unknown) {
  try {
    getIo().to(`user:${toUserId}`).emit("dm:message", message);
    getIo().to(`user:${fromUserId}`).emit("dm:message", message);
  } catch {}
}

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

export function broadcastDmRead(senderUserId: number, readerUserId: number) {
  try { getIo().to(`user:${senderUserId}`).emit("dm:read", { byUserId: readerUserId }); } catch {}
}

export function broadcastSubtaskProgress(parentTaskId: number, progress: { total: number; completed: number; percentage: number }) {
  try { getIo().emit("multitask:progress", { parentTaskId, progress }); } catch {}
}

export function broadcastSubtaskChanged(subtaskId: number, parentTaskId: number) {
  try { getIo().emit("subtask:changed", { subtaskId, parentTaskId }); } catch {}
}

export function broadcastChatDeleted(messageId: number) {
  try { getIo().emit("chat:deleted", { messageId }); } catch {}
}

export function broadcastChatReaction(messageId: number, reactions: unknown[]) {
  try { getIo().emit("chat:reaction", { messageId, reactions }); } catch {}
}

export function broadcastDmDeleted(toUserId: number, fromUserId: number, messageId: number) {
  try {
    getIo().to(`user:${toUserId}`).emit("dm:deleted", { messageId });
    getIo().to(`user:${fromUserId}`).emit("dm:deleted", { messageId });
  } catch {}
}

export function broadcastDmReaction(toUserId: number, fromUserId: number, messageId: number, reactions: unknown[]) {
  try {
    getIo().to(`user:${toUserId}`).emit("dm:reaction", { messageId, reactions });
    getIo().to(`user:${fromUserId}`).emit("dm:reaction", { messageId, reactions });
  } catch {}
}

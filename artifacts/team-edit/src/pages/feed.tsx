import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useEffect, useRef, useState, useCallback } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { usePageTitle } from "@/lib/use-page-title";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import {
  Trash2, Zap, Folder,
  CheckCircle2, FolderCheck, Edit3, SmilePlus, MessageCircle, Pencil, X, Check, RotateCcw, Undo2,
  PauseCircle, XCircle, PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvatarDisplay } from "@/components/ui/avatar-display";

// ── Types ───────────────────────────────────────────────────────

interface MentionUser { id: number; name: string; avatarUrl: string | null; }
interface FeedActor { id: number; name: string; avatarUrl: string | null; }
interface FeedReaction { id: number; feedItemId: number; userId: number; emoji: string; userName: string | null; }
interface FeedComment {
  id: number; feedItemId: number; userId: number; content: string;
  createdAt: string; userName: string | null; userAvatar: string | null;
}
interface FeedItem {
  id: number; type: string; title: string; content: string | null;
  actorId: number | null; actor: FeedActor | null; reactions: FeedReaction[]; commentCount: number;
  myReactions: string[]; jobId: number | null; entityId: number | null;
  entityType: string | null; createdAt: string;
}
interface OnlineUser {
  userId: number; name: string | null; avatarUrl: string | null; isOnline: boolean;
}

// ── Constants ────────────────────────────────────────────────────

const FEED_ICON: Record<string, React.ReactNode> = {
  task_completed:    <CheckCircle2 className="h-4 w-4 text-green-500" />,
  task_reopened:     <RotateCcw className="h-4 w-4 text-rose-500" />,
  task_returned:     <Undo2 className="h-4 w-4 text-amber-500" />,
  task_paused:       <PauseCircle className="h-4 w-4 text-violet-500" />,
  task_cancelled:    <XCircle className="h-4 w-4 text-red-500" />,
  task_resumed:      <PlayCircle className="h-4 w-4 text-blue-500" />,
  task_reactivated:  <PlayCircle className="h-4 w-4 text-emerald-500" />,
  job_completed:     <Zap className="h-4 w-4 text-indigo-500" />,
  project_completed: <FolderCheck className="h-4 w-4 text-green-600" />,
  project_created:   <Folder className="h-4 w-4 text-blue-500" />,
  manual_post:       <Edit3 className="h-4 w-4 text-violet-500" />,
};

const FEED_ACCENT: Record<string, string> = {
  task_completed:    "border-t-green-400",
  task_reopened:     "border-t-rose-400",
  task_returned:     "border-t-amber-400",
  task_paused:       "border-t-violet-400",
  task_cancelled:    "border-t-red-400",
  task_resumed:      "border-t-blue-400",
  task_reactivated:  "border-t-emerald-400",
  job_completed:     "border-t-indigo-400",
  project_completed: "border-t-green-500",
  project_created:   "border-t-blue-400",
  manual_post:       "border-t-violet-400",
};

// ── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}


function parseMentions(text: string, users: MentionUser[]): number[] {
  const ids: number[] = [];
  const matches = text.match(/@([\w][\w\s]{0,30})/g) ?? [];
  for (const m of matches) {
    const q = m.slice(1).trim().toLowerCase();
    const found = users.find(u => u.name.toLowerCase() === q);
    if (found && !ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}

function renderMentions(text: string) {
  const parts = text.split(/(@[\w][\w\s]{0,30})/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <strong key={i}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}

// ── MentionTextarea ───────────────────────────────────────────────

function MentionTextarea({
  value, onChange, onSend, users, placeholder, rows = 1, className,
}: {
  value: string; onChange: (v: string) => void; onSend?: () => void;
  users: MentionUser[]; placeholder?: string; rows?: number; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showDrop, setShowDrop] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  const [query, setQuery] = useState("");
  const [atIndex, setAtIndex] = useState(-1);
  const [selIdx, setSelIdx] = useState(0);

  const filtered = users
    .filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const checkAt = (val: string, cursor: number) => {
    const before = val.slice(0, cursor);
    const m = before.match(/@([\w\s]{0,30})$/);
    if (m && !m[1].startsWith(" ")) {
      setQuery(m[1]); setAtIndex(before.length - m[0].length); setShowDrop(true); setSelIdx(0);
    } else { setShowDrop(false); }
  };

  const selectUser = (u: MentionUser) => {
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, atIndex);
    const after = value.slice(cursor);
    onChange(`${before}@${u.name} ${after}`);
    setShowDrop(false);
    setTimeout(() => {
      if (!ref.current) return;
      const pos = before.length + u.name.length + 2;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDrop && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[selIdx]) selectUser(filtered[selIdx]); return; }
      if (e.key === "Escape")    { setShowDrop(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && onSend) { e.preventDefault(); onSend(); }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); checkAt(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder={placeholder}
        rows={rows}
        className={cn("resize-none overflow-hidden border-none shadow-none focus-visible:ring-0 bg-transparent p-0 text-sm placeholder:text-[hsl(var(--muted-foreground))]", className)}
      />
      {showDrop && filtered.length > 0 && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 w-56 rounded-xl border bg-[hsl(var(--card))] shadow-2xl z-[200] overflow-hidden">
          <div className="px-3 py-1.5 border-b bg-[hsl(var(--muted))]/30">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Mencionar</span>
          </div>
          {filtered.map((u, i) => (
            <button key={u.id} type="button" onMouseDown={e => { e.preventDefault(); selectUser(u); }}
              className={cn("flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors",
                i === selIdx ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "hover:bg-[hsl(var(--muted))]"
              )}>
              <AvatarDisplay name={u.name ?? "?"} avatarUrl={u.avatarUrl} size={24} />
              <span className="font-medium truncate">@{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EmojiReactions ────────────────────────────────────────────────

function EmojiReactions({ feedItemId, reactions, myUserId, onUpdate }: {
  feedItemId: number; reactions: FeedReaction[]; myUserId: number;
  onUpdate: (newReactions: FeedReaction[]) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const { theme } = useTheme();
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = async (emoji: string) => {
    try {
      const updated = await apiPost<FeedReaction[]>(`/api/feed/${feedItemId}/reactions`, { emoji });
      onUpdate(updated);
    } catch {}
  };

  const grouped = Object.entries(
    reactions.reduce<Record<string, { count: number; users: string[]; mine: boolean }>>((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, users: [], mine: false };
      acc[r.emoji].count++;
      acc[r.emoji].users.push(r.userName ?? "?");
      if (r.userId === myUserId) acc[r.emoji].mine = true;
      return acc;
    }, {})
  );

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {grouped.map(([emoji, g]) => (
        <button key={emoji} title={g.users.join(", ")} onClick={() => toggle(emoji)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-all",
            g.mine
              ? "bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]"
              : "bg-[hsl(var(--muted))]/50 border-transparent hover:border-[hsl(var(--border))]"
          )}>
          <span>{emoji}</span>
          <span className="text-xs font-semibold">{g.count}</span>
        </button>
      ))}

      <div className="relative" ref={pickerRef}>
        <button onClick={() => setShowPicker(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground))]/30 transition-all">
          <SmilePlus className="h-4 w-4" />
        </button>
        {showPicker && (
          <div className="absolute bottom-10 left-0 z-[100]">
            <Picker
              data={data}
              onEmojiSelect={(e: { native: string }) => { toggle(e.native); setShowPicker(false); }}
              locale="pt"
              theme={theme}
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2}
              perLine={8}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── FeedCard ─────────────────────────────────────────────────────

function FeedCard({ item, myUserId, myRole, users, onReact, updatedReactions, onDelete, onEdit }: {
  item: FeedItem; myUserId: number; myRole: string; users: MentionUser[];
  onReact: (itemId: number, newReactions: FeedReaction[]) => void;
  updatedReactions?: FeedReaction[];
  onDelete: (itemId: number) => void;
  onEdit: (itemId: number, content: string) => void;
}) {
  const reactions = updatedReactions ?? item.reactions;
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.content ?? "");
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  const isAuthor = item.actorId === myUserId;
  const canManage = isAuthor || ["admin", "supervisor"].includes(myRole);

  const saveEdit = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await apiPut(`/api/feed/${item.id}`, { content: editText.trim() });
      onEdit(item.id, editText.trim());
      setEditing(false);
    } catch { toast.error("Erro ao editar"); }
    finally { setSaving(false); }
  };

  const deletePost = async () => {
    try {
      await apiDelete(`/api/feed/${item.id}`);
      onDelete(item.id);
    } catch { toast.error("Erro ao excluir"); }
  };

  useEffect(() => {
    if (expanded && comments.length === 0) {
      setLoadingComments(true);
      apiFetch<FeedComment[]>(`/api/feed/${item.id}/comments`)
        .then(setComments).catch(() => {}).finally(() => setLoadingComments(false));
    }
  }, [expanded]);

  useEffect(() => {
    const socket = getSocket();
    const onNew = ({ feedItemId, comment }: { feedItemId: number; comment: FeedComment }) => {
      if (feedItemId !== item.id) return;
      setComments(prev => prev.some(c => c.id === comment.id) ? prev : [...prev, comment]);
      setCommentCount(prev => prev + 1);
    };
    const onDel = ({ feedItemId, commentId }: { feedItemId: number; commentId: number }) => {
      if (feedItemId !== item.id) return;
      setComments(prev => prev.filter(c => c.id !== commentId));
      setCommentCount(prev => Math.max(0, prev - 1));
    };
    socket.on("feed:comment", onNew);
    socket.on("feed:comment_deleted", onDel);
    return () => { socket.off("feed:comment", onNew); socket.off("feed:comment_deleted", onDel); };
  }, [item.id]);

  const sendComment = async () => {
    if (!commentText.trim()) return;
    setSending(true);
    try {
      const mentions = parseMentions(commentText, users);
      const c = await apiPost<FeedComment>(`/api/feed/${item.id}/comments`, { content: commentText, mentions });
      if (!comments.some(x => x.id === c.id)) {
        setComments(prev => [...prev, c]);
        setCommentCount(prev => prev + 1);
      }
      setCommentText("");
    } catch {
      toast.error("Erro ao enviar comentário");
    } finally { setSending(false); }
  };

  const deleteComment = async (commentId: number) => {
    try {
      await apiDelete(`/api/feed/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setCommentCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  return (
    <div className={cn("rounded-2xl border-t-4 bg-[hsl(var(--card))] shadow-sm overflow-visible", FEED_ACCENT[item.type] ?? "border-t-slate-300")}>

      {/* Header */}
      <div className="flex gap-3 px-5 pt-4 pb-3">
        <AvatarDisplay name={item.actor?.name ?? "?"} avatarUrl={item.actor?.avatarUrl ?? null} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm">{item.actor?.name ?? "Sistema"}</span>
              <span className="text-[hsl(var(--muted-foreground))] text-xs">·</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{timeAgo(item.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {FEED_ICON[item.type]}
              {canManage && item.type === "manual_post" && !editing && (
                <>
                  {isAuthor && (
                    <button onClick={() => { setEditText(item.content ?? ""); setEditing(true); }}
                      className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={deletePost}
                    className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight">{item.title}</p>
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <div className="px-5 pb-4 space-y-2">
          <MentionTextarea
            value={editText} onChange={setEditText} users={users}
            placeholder="Editar publicação..."
            rows={3} className="w-full text-[15px] leading-relaxed border rounded-xl px-3 py-2 bg-[hsl(var(--muted))]/30"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors px-3 py-1.5 rounded-lg hover:bg-[hsl(var(--muted))]/40">
              <X className="h-3.5 w-3.5" />Cancelar
            </button>
            <button onClick={saveEdit} disabled={saving || !editText.trim()}
              className="flex items-center gap-1 text-xs text-white bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
              <Check className="h-3.5 w-3.5" />Salvar
            </button>
          </div>
        </div>
      ) : item.content ? (
        <div className="px-5 pb-4">
          <p className="text-[15px] leading-relaxed">{renderMentions(item.content)}</p>
        </div>
      ) : null}

      {/* Divider */}
      <div className="border-t mx-5" />

      {/* Actions bar */}
      <div className="px-5 py-2.5 flex items-center gap-4">
        <EmojiReactions
          feedItemId={item.id}
          reactions={reactions}
          myUserId={myUserId}
          onUpdate={r => onReact(item.id, r)}
        />
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-auto flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <MessageCircle className="h-4 w-4" />
          <span>{commentCount}</span>
        </button>
      </div>

      {/* Comments */}
      {expanded && (
        <div className="border-t">
          {loadingComments ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))] px-5 py-3">Carregando...</p>
          ) : (
            <div className="divide-y">
              {comments.map(c => (
                <div key={c.id} className="flex gap-3 px-5 py-3 group">
                  <AvatarDisplay name={c.userName ?? "?"} avatarUrl={c.userAvatar} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <strong className="font-semibold mr-1">{c.userName ?? "?"}</strong>
                      {renderMentions(c.content)}
                    </p>
                    <span className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 block">{timeAgo(c.createdAt)}</span>
                  </div>
                  {(c.userId === myUserId || ["admin", "supervisor"].includes(myRole)) && (
                    <button onClick={() => deleteComment(c.id)}
                      className="opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-all shrink-0 self-start mt-0.5">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Comment input — Instagram style */}
          <div className="flex gap-3 px-5 py-3 border-t items-start">
            <AvatarDisplay name={user?.name ?? "?"} avatarUrl={user?.avatarUrl ?? null} size={32} />
            <div className="flex-1 flex items-end gap-2 bg-[hsl(var(--muted))]/40 rounded-2xl px-3 py-2">
              <MentionTextarea
                value={commentText}
                onChange={setCommentText}
                onSend={sendComment}
                users={users}
                placeholder="Adicionar comentário..."
                rows={1}
                className="flex-1 min-h-[20px] text-sm leading-snug"
              />
              {commentText.trim() && (
                <button onClick={sendComment} disabled={sending}
                  className="text-[hsl(var(--primary))] font-semibold text-sm shrink-0 hover:opacity-70 transition-opacity pb-0.5">
                  Publicar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────

export default function FeedPage() {
  usePageTitle("Feed");
  const { user } = useAuth();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [postText, setPostText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postFocused, setPostFocused] = useState(false);
  const [reactionsMap, setReactionsMap] = useState<Record<number, FeedReaction[]>>({});

  const [allUsers, setAllUsers] = useState<MentionUser[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFeed = useCallback(() => {
    apiFetch<FeedItem[]>("/api/feed")
      .then(setItems).catch(() => toast.error("Erro ao carregar feed"))
      .finally(() => setLoadingFeed(false));
  }, []);

  const ping = useCallback(() => { apiPost("/api/presence/ping", {}).catch(() => {}); }, []);

  useEffect(() => {
    loadFeed();
    apiFetch<OnlineUser[]>("/api/presence").then(setOnlineUsers).catch(() => {});
    apiFetch<MentionUser[]>("/api/users").then(setAllUsers).catch(() => {});
    ping();
    pingRef.current = setInterval(ping, 30_000);
    return () => { if (pingRef.current) clearInterval(pingRef.current); };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onFeedItem = (item: FeedItem) =>
      setItems(prev => prev.some(i => i.id === item.id) ? prev : [item, ...prev]);
    const onFeedReaction = ({ feedItemId, reactions }: { feedItemId: number; reactions: FeedReaction[] }) =>
      setReactionsMap(prev => ({ ...prev, [feedItemId]: reactions }));
    socket.on("feed:new_item", onFeedItem);
    socket.on("feed:reaction", onFeedReaction);
    return () => {
      socket.off("feed:new_item", onFeedItem);
      socket.off("feed:reaction", onFeedReaction);
    };
  }, [user]);

  const publish = async () => {
    if (!postText.trim()) return;
    setPosting(true);
    try {
      const mentions = parseMentions(postText, allUsers);
      await apiPost("/api/feed", { content: postText, mentions });
      setPostText(""); setPostFocused(false);
    } catch { toast.error("Erro ao publicar"); }
    finally { setPosting(false); }
  };

  const myInitials = user?.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* ── Compose box — Twitter/Instagram style ─────────────── */}
      <div className="relative rounded-2xl border bg-[hsl(var(--card))] shadow-sm overflow-visible">
        <div className="flex gap-3 p-4">
          {/* Avatar */}
          <div className="shrink-0 pt-0.5">
            <AvatarDisplay name={user?.name ?? "?"} avatarUrl={user?.avatarUrl ?? null} size={40} />
          </div>

          {/* Compose area */}
          <div className="flex-1 min-w-0">
            <MentionTextarea
              value={postText}
              onChange={setPostText}
              users={allUsers}
              placeholder="No que você está pensando?"
              rows={postFocused || postText ? 4 : 2}
              className={cn("w-full text-[15px] leading-relaxed transition-all", postFocused || postText ? "min-h-[90px]" : "min-h-[44px]")}
            />

            {(postFocused || postText) && (
              <div className="flex items-center justify-between pt-3 mt-2 border-t">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">@ para mencionar · Ctrl+Enter publica</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setPostText(""); setPostFocused(false); }}
                    className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors px-2 py-1">
                    Cancelar
                  </button>
                  <Button size="sm" onClick={publish} disabled={posting || !postText.trim()} className="rounded-full px-5">
                    Publicar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Click anywhere in the empty state to expand */}
        {!postFocused && !postText && (
          <div className="absolute inset-0 cursor-text" onClick={() => setPostFocused(true)} />
        )}
      </div>

      {/* ── Feed items ───────────────────────────────────────── */}
      {loadingFeed ? (
        <div className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3 text-center">
          <Zap className="h-12 w-12 text-[hsl(var(--muted-foreground))]/20" />
          <p className="font-semibold text-[hsl(var(--muted-foreground))]">Nenhuma atividade ainda.</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]/60">Eventos de tarefas, jobs e projetos aparecerão aqui.</p>
        </div>
      ) : (
        items.map(item => (
          <FeedCard
            key={item.id} item={item}
            myUserId={user?.id ?? 0} myRole={user?.role ?? "editor"}
            users={allUsers} onReact={(id, r) => setReactionsMap(prev => ({ ...prev, [id]: r }))}
            updatedReactions={reactionsMap[item.id]}
            onDelete={id => setItems(prev => prev.filter(i => i.id !== id))}
            onEdit={(id, content) => setItems(prev => prev.map(i => i.id === id ? { ...i, content } : i))}
          />
        ))
      )}

    </div>
  );
}

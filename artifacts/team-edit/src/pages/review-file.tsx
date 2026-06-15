import { useEffect, useState, useRef, useCallback, useMemo, forwardRef } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBreadcrumb } from "@/contexts/BreadcrumbContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { fmtDate } from "@/lib/utils";
import { VideoPlayer, AudioPlayer, fmtTime, formatTimecode, type Marker, type PlayerHandle, type TimeFormat } from "@/components/player";
import {
  ArrowLeft, Send, CheckCircle, CheckCircle2,
  MessageSquare, Loader2, RotateCcw, Upload, Download, Film,
  Pencil, Trash2, MoreHorizontal, Search, X, ChevronDown, ChevronRight, GitCompareArrows,
  Pen, ArrowUpRight, Square, UserPlus, Link2, Check,
} from "lucide-react";

const ANN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff"];
const ANN_STROKE = 0.008;
import { ShapeEl, type AnnotationShape } from "@/components/AnnotationDrawer";
import { AnnotationOverlay } from "@/components/AnnotationOverlay";
import { ComparePlayer, type VersionFile } from "@/components/ComparePlayer";
import { RiPenNibLine } from "react-icons/ri";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface TaskDetail {
  id: number; taskCode?: string; title: string; status: string;
  revisionCount: number; createdBy: Person | null; editors: Person[];
}
interface TaskFile {
  id: number; fileName: string; originalName: string | null; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; fileOrder: number | null; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null;
  hlsPath: string | null; processingStatus: string;
}
interface ReviewReply {
  id: number; userId: number; body: string; createdAt: string;
  userName: string | null; userAvatarUrl: string | null;
}
interface ReviewComment {
  id: number; taskFileId: number | null; parentId: number | null;
  userId: number; timestampSec: number | null;
  annotations: string | null;
  body: string; resolvedAt: string | null; createdAt: string;
  userName: string | null; userAvatarUrl: string | null;
  replies: ReviewReply[];
}

// ── CommentCard ───────────────────────────────────────────────────────────────

const CommentCard = forwardRef<HTMLDivElement, {
  comment: ReviewComment;
  commentIndex: number;
  currentUserId?: number;
  isCoord?: boolean;
  highlighted?: boolean;
  isUnread?: boolean;
  timeFormat: TimeFormat;
  onSeek: (t: number, annotations?: string | null) => void;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, body: string) => void;
  onSubmitReply: (parentId: number, body: string) => Promise<void>;
  onMarkRead?: () => void;
}>(function CommentCard({ comment, commentIndex, currentUserId, isCoord, highlighted = false, isUnread = false, timeFormat, onSeek, onResolve, onDelete, onEdit, onSubmitReply, onMarkRead }, ref) {
  const [editing, setEditing]           = useState(false);
  const [editBody, setEditBody]         = useState(comment.body);
  const [saving, setSaving]             = useState(false);
  const [showReply, setShowReply]       = useState(false);
  const [replyBody, setReplyBody]       = useState("");
  const [replyMention, setReplyMention] = useState<string | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [menuOpen, setMenuOpen]         = useState(false);
  const editRef  = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const menuRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const resolved  = !!comment.resolvedAt;
  const canModify = currentUserId === comment.userId || isCoord;

  const startEdit = () => {
    setEditBody(comment.body); setEditing(true); setShowReply(false);
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 30);
  };
  const cancelEdit = () => { setEditing(false); setEditBody(comment.body); };
  const saveEdit = async () => {
    if (!editBody.trim() || editBody.trim() === comment.body) { cancelEdit(); return; }
    setSaving(true);
    try { await onEdit(comment.id, editBody.trim()); setEditing(false); }
    finally { setSaving(false); }
  };

  const openReply = (mention?: string) => {
    setReplyMention(mention ?? null);
    setShowReply(true); setEditing(false);
    setTimeout(() => replyRef.current?.focus(), 30);
  };
  const cancelReply = () => { setShowReply(false); setReplyBody(""); setReplyMention(null); };
  const submitReply = async () => {
    if (!replyBody.trim() || sendingReply) return;
    setSendingReply(true);
    const body = replyMention ? `@${replyMention} ${replyBody.trim()}` : replyBody.trim();
    try { await onSubmitReply(comment.id, body); setShowReply(false); setReplyBody(""); setReplyMention(null); }
    catch { /* toast handled by parent */ }
    finally { setSendingReply(false); }
  };

  const hasTimestamp = comment.timestampSec != null;

  return (
    <div ref={ref}
      onClick={() => {
        onMarkRead?.();
        if (hasTimestamp && !editing) onSeek(comment.timestampSec!, comment.annotations ?? null);
      }}
      className={`relative group/card rounded-lg border border-[hsl(var(--border))] transition-all hover:bg-[hsl(var(--muted))] ${highlighted && !resolved ? "bg-[hsl(var(--muted))]" : "bg-[hsl(var(--muted)/0.4)]"} ${hasTimestamp && !editing ? "cursor-pointer" : "cursor-default"}`}
      >

      {/* ── Header: avatar + nome + data — # absoluto no canto ── */}
      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2 pr-8">
        <AvatarDisplay name={comment.userName ?? "?"} avatarUrl={comment.userAvatarUrl} size={18} className="shrink-0" />
        <span className="text-[11px] font-semibold text-[hsl(var(--foreground))]/75 truncate leading-none">
          {comment.userName?.split(" ")[0]}
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]/45 shrink-0">
          {fmtDate(comment.createdAt)}
        </span>
        {isUnread && (
          <span className="h-2 w-2 rounded-full shrink-0 animate-pulse" style={{ background: "hsl(var(--primary))" }} />
        )}
      </div>
      <span className="absolute top-2 right-2.5 text-[10px] font-mono text-[hsl(var(--muted-foreground))]/25 select-none pointer-events-none">
        #{commentIndex}
      </span>

      {/* Timecode */}
      {comment.timestampSec != null && (
        <div className="px-3 pt-1 pb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center text-[13px] font-mono font-bold px-2.5 py-1 rounded-md"
            style={{ background: "rgba(var(--primary-rgb,99,74,255),0.08)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
            {formatTimecode(comment.timestampSec, timeFormat)}
          </span>
          {comment.annotations && (
            <RiPenNibLine className="h-3 w-3 text-[hsl(var(--primary))]/50" />
          )}
        </div>
      )}

      {/* Body / inline edit */}
      <div className="px-3 pt-1 pb-2" onClick={editing ? e => e.stopPropagation() : undefined}>
        {editing ? (
          <div className="space-y-2">
            <textarea ref={editRef} value={editBody} onChange={e => setEditBody(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") cancelEdit(); }}
              className="w-full resize-none rounded-md px-2.5 py-2 text-sm text-[hsl(var(--foreground))]/85 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/50"
              style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--primary)/0.4)", minHeight: 56, lineHeight: 1.5 }} />
            <div className="flex gap-1.5">
              <button onClick={cancelEdit} className="px-2.5 py-1 rounded text-[11px] font-medium text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">Cancelar</button>
              <button onClick={saveEdit} disabled={saving || !editBody.trim()}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-white disabled:opacity-40 transition-colors"
                style={{ background: "hsl(var(--primary))" }}>
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}Salvar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]/70">
            {comment.body}
          </p>
        )}
      </div>

      {/* Footer: Responder (esq) · ⋯ + checker (dir) */}
      {!editing && currentUserId !== undefined && (
        <div className="px-3 pb-2 flex items-center justify-between" onClick={e => e.stopPropagation()}>
          {/* Esquerda */}
          <button onClick={() => openReply()}
            className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]/45 hover:text-[hsl(var(--primary))] transition-colors">
            Responder
          </button>

          {/* Direita: ⋯ + checker */}
          <div className="flex items-center gap-0.5">
            {canModify && (
              <div ref={menuRef} className="relative">
                <button onClick={() => setMenuOpen(v => !v)}
                  className="btn-click-bounce h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))]/70 transition-colors opacity-0 group-hover/card:opacity-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <div className="absolute bottom-full right-0 mb-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl py-1 z-50"
                    style={{ minWidth: 148, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                    {currentUserId === comment.userId && (
                      <button onClick={() => { startEdit(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-[hsl(var(--foreground))]/75 hover:bg-[hsl(var(--muted))] transition-colors">
                        <Pencil className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />Editar
                      </button>
                    )}
                    <button onClick={() => { onDelete(comment.id); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="h-3 w-3" />Deletar
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => onResolve(comment.id)}
              title={resolved ? "Reabrir" : "Marcar como resolvido"}
              className="btn-click-bounce h-6 w-6 flex items-center justify-center transition-colors"
              style={{ color: resolved ? "#22c55e" : "rgba(255,255,255,0.2)" }}>
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="border-t border-[hsl(var(--border))]/40">
          {comment.replies.map((r, i) => (
            <div key={r.id} className={`group/reply flex bg-[hsl(var(--muted))]/20 ${i > 0 ? "border-t border-[hsl(var(--border))]/20" : ""}`}>

              {/* Coluna esquerda: avatar + linha vertical */}
              <div className="flex flex-col items-center pl-3 pr-2 pt-2.5 shrink-0" style={{ width: 36 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                  <AvatarDisplay name={r.userName ?? "?"} avatarUrl={r.userAvatarUrl} size={18} />
                </div>
                {i < comment.replies.length - 1 && (
                  <div className="flex-1 w-px mt-1.5" style={{ background: "rgba(255,255,255,0.07)", minHeight: 6 }} />
                )}
              </div>

              {/* Conteúdo */}
              <div className="flex-1 min-w-0 py-2.5 pr-3">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-semibold text-[hsl(var(--foreground))]/75">{r.userName?.split(" ")[0]}</span>
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]/40">{fmtDate(r.createdAt)}</span>
                </div>
                <p className="text-xs text-[hsl(var(--foreground))]/70 leading-snug">{r.body}</p>
                {currentUserId !== undefined && (
                  <button
                    onClick={e => { e.stopPropagation(); openReply(r.userName?.split(" ")[0]); }}
                    className="mt-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))]/35 hover:text-[hsl(var(--primary))] transition-colors opacity-0 group-hover/reply:opacity-100">
                    Responder
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Inline reply ── */}
      {showReply && (
        <div className="border-t border-[hsl(var(--border))]/40 px-3 pt-2 pb-3" onClick={e => e.stopPropagation()}>
          <div className="rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-[hsl(var(--primary))]/40 transition-all border border-[hsl(var(--border))]"
            style={{ background: "rgba(255,255,255,0.06)" }}>
            {/* Chip @mention fixo */}
            {replyMention && (
              <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0">
                <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md"
                  style={{ background: "hsl(var(--primary)/0.12)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                  @{replyMention}
                </span>
              </div>
            )}
            <textarea ref={replyRef}
              value={replyBody}
              onChange={e => {
                setReplyBody(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitReply(); }
                if (e.key === "Escape") cancelReply();
              }}
              placeholder="Digite sua resposta…"
              className="w-full resize-none px-3 pt-2 pb-1 text-sm text-[hsl(var(--foreground))]/85 placeholder-[hsl(var(--muted-foreground))]/40 focus:outline-none bg-transparent"
              style={{ minHeight: 34, maxHeight: 100, lineHeight: 1.55 }}
              rows={1} />
            <div className="flex items-center justify-end gap-1.5 px-2 pb-2">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]/30 flex-1">Enter · Esc cancela</span>
              <button onClick={cancelReply}
                className="h-6 px-2 rounded text-[10px] font-medium text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))]/70 border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                Cancelar
              </button>
              <button onClick={submitReply} disabled={sendingReply || !replyBody.trim()}
                className="h-6 px-2.5 rounded text-[10px] font-semibold disabled:opacity-35 transition-all flex items-center gap-1"
                style={{ background: replyBody.trim() ? "hsl(var(--primary))" : "transparent", color: replyBody.trim() ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))", border: replyBody.trim() ? "none" : "1px solid hsl(var(--border))" }}>
                {sendingReply ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});


// ── InviteReviewerModal ───────────────────────────────────────────────────────

interface Coordinator { id: number; name: string; role: string; avatarUrl: string | null; }

function InviteReviewerModal({ taskId, taskTitle, onClose }: { taskId: number; taskTitle: string; onClose: () => void }) {
  const [coords, setCoords]     = useState<Coordinator[]>([]);
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage]   = useState("");
  const [sending, setSending]   = useState(false);

  useEffect(() => { apiFetch<Coordinator[]>("/api/coordinators").then(setCoords).catch(() => {}); }, []);

  const filtered = coords.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const toggle   = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSend = async () => {
    if (!selected.size) return;
    setSending(true);
    try {
      await apiFetch(`/api/tasks/${taskId}/invite-reviewer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected], message: message.trim() || undefined }),
      });
      toast.success(`Convite enviado para ${selected.size} pessoa${selected.size > 1 ? "s" : ""}!`);
      onClose();
    } catch { toast.error("Erro ao enviar convite"); }
    finally { setSending(false); }
  };

  const ROLE_LABEL: Record<string, string> = { admin: "Admin", supervisor: "Superv.", coordinator: "Coord." };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "hsl(var(--card))", maxHeight: "80vh" }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[hsl(var(--border))]">
          <UserPlus className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Convidar para revisão</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/50 truncate">{taskTitle}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]/60 transition-colors">
            <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]/60" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 h-8">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar coordenador…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]/40" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0
            ? <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-6">Nenhum coordenador encontrado</p>
            : filtered.map(c => {
              const on = selected.has(c.id);
              return (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[hsl(var(--muted))]/50 transition-colors text-left">
                  <AvatarDisplay name={c.name} avatarUrl={c.avatarUrl} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[hsl(var(--foreground))]/85 truncate">{c.name}</p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{ROLE_LABEL[c.role] ?? c.role}</p>
                  </div>
                  <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
                    {on && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                </button>
              );
            })}
        </div>
        <div className="px-4 pb-3 border-t border-[hsl(var(--border))] pt-3">
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Mensagem opcional…" rows={2}
            className="w-full text-xs rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 outline-none resize-none placeholder:text-[hsl(var(--muted-foreground))]/40" />
        </div>
        <div className="flex items-center justify-between px-4 pb-4 gap-3">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50">
            {selected.size > 0 ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}` : "Nenhum selecionado"}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              Cancelar
            </button>
            <button onClick={handleSend} disabled={!selected.size || sending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors"
              style={{ background: "hsl(var(--primary))" }}>
              <Send className="h-3 w-3" />{sending ? "Enviando…" : "Enviar convite"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ReviewFilePage ────────────────────────────────────────────────────────────

export default function ReviewFilePage() {
  const { taskId, fileId } = useParams<{ taskId: string; fileId: string }>();
  const [, navigate]       = useLocation();
  const { user }           = useAuth();
  const { set: setBreadcrumb, clear: clearBreadcrumb } = useBreadcrumb();

  const tId = parseInt(taskId);
  const fId = parseInt(fileId);

  const [task, setTask]         = useState<TaskDetail | null>(null);
  const [file, setFile]         = useState<TaskFile | null>(null);
  const [allFiles, setAllFiles] = useState<TaskFile[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading]   = useState(true);

  const [readSet, setReadSet] = useState<Set<number>>(new Set());

  const [body, setBody]             = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [approving, setApproving]   = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [commentSearch, setCommentSearch]   = useState("");
  const [versionMenuOpen, setVersionMenuOpen]       = useState(false);
  const [versionSubmenuOpen, setVersionSubmenuOpen] = useState(false);
  const [compareMode, setCompareMode]             = useState(false);
  const [compareActiveSide, setCompareActiveSide] = useState<"left" | "right">("right");
  const [compareSideFiles, setCompareSideFiles]   = useState<{ left: number; right: number } | null>(null);
  const [compareCommentsMap, setCompareCommentsMap] = useState<Record<number, ReviewComment[]>>({});
  // derived — fileId do lado ativo no compare
  const compareActiveFileId = compareSideFiles ? compareSideFiles[compareActiveSide] : fId;

  // Anotações de frame
  const [pendingFrame, setPendingFrame] = useState<{ time: number } | null>(null);

  // Modo de desenho in-place (sobre o vídeo)
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annShapes,  setAnnShapes]          = useState<AnnotationShape[]>([]);
  const [annPreview, setAnnPreview]         = useState<AnnotationShape | null>(null);
  const [annTool,    setAnnTool]            = useState<"pen" | "arrow" | "rect">("pen");
  const [annColor,   setAnnColor]           = useState(ANN_COLORS[0]);
  const [videoAr,    setVideoAr]            = useState(16 / 9);
  const annSvgRef   = useRef<SVGSVGElement>(null);
  const annStart    = useRef<{ x: number; y: number } | null>(null);
  const annPts      = useRef<number[]>([]);
  const annActive   = useRef(false);
  const [seekTarget, setSeekTarget]   = useState<{ t: number; n: number } | null>(null);
  const [timeFormat, setTimeFormat]   = useState<TimeFormat>("standard");
  const [newMarkerTimestamp, setNewMarkerTimestamp] = useState<number | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);

  // Timecode em tempo real — atualizado via RAF sem re-renders
  const composerTimeBadgeRef = useRef<HTMLSpanElement>(null);
  const timeFormatRef        = useRef<TimeFormat>("standard");
  useEffect(() => { timeFormatRef.current = timeFormat; }, [timeFormat]);

  const playerRef        = useRef<PlayerHandle>(null);
  const comparePlayerRef = useRef<PlayerHandle>(null);
  const compareModeRef   = useRef(false);
  useEffect(() => { compareModeRef.current = compareMode; }, [compareMode]);
  // Retorna o ref do player ativo (compare ou simples)
  const activePlayer = () => compareModeRef.current ? comparePlayerRef.current : playerRef.current;

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const commentRefs    = useRef<Map<number, HTMLDivElement>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerBadgeRef   = useRef<HTMLSpanElement>(null);
  const versionPickerRef   = useRef<HTMLDivElement>(null);
  const versionBtnRef      = useRef<HTMLButtonElement>(null);
  const [versionDropPos, setVersionDropPos] = useState<{ top: number; left: number } | null>(null);

  // Annotations SVG visíveis sobre o vídeo pausado (estilo Frame.io)
  const [viewAnnotations, setViewAnnotations] = useState<string | null>(null);
  const annOverlayKey   = useRef(0);
  const viewAnnTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAnn      = useRef<string | null>(null);

  // Ajusta o padding-left do textarea conforme a largura real do badge de timecode
  useEffect(() => {
    const badge = composerBadgeRef.current;
    const ta    = textareaRef.current;
    if (!badge || !ta) return;
    // Lê após o browser ter atualizado o texto do badge (próximo frame)
    requestAnimationFrame(() => {
      ta.style.paddingLeft = `${badge.offsetWidth + 12}px`;
    });
  }, [timeFormat]);

  const isCoord  = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";
  const isEditor = user?.role === "editor";
  const isVideo  = !!file?.mimeType?.startsWith("video/");
  const isAudio  = !!file?.mimeType?.startsWith("audio/");
  const isTaskOwner = isCoord && !!user && task?.createdBy?.id === user.id;
  const canApprove  = isTaskOwner && task?.status === "review";
  const isApproved  = task?.status === "completed" || !!file?.approvedAt;

  // Usa HLS quando disponível — melhor qualidade adaptativa; fallback para stream direto
  const streamUrl = (f: TaskFile) =>
    f.hlsPath && f.processingStatus === "ready"
      ? `/api/tasks/${tId}/files/${f.id}/hls/master.m3u8`
      : `/api/tasks/${tId}/files/${f.id}/stream`;
  const downloadUrl = (f: TaskFile) => `/api/tasks/${tId}/files/${f.id}/download`;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${tId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${tId}/files`).catch(() => [] as TaskFile[]),
      apiFetch<ReviewComment[]>(`/api/tasks/${tId}/review-comments?fileId=${fId}`).catch(() => [] as ReviewComment[]),
    ]).then(([t, files, coms]) => {
      setTask(t); setAllFiles(files);
      setFile(files.find(x => x.id === fId) ?? null);
      setComments(coms);
    }).catch(() => toast.error("Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [tId, fId]);

  useEffect(() => {
    setReadSet(new Set());
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tId, fId]);

  // Chama mark-read no backend ao sair da página
  useEffect(() => {
    return () => { apiPost(`/api/tasks/${tId}/review/mark-read`, {}).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tId]);

  // RAF loop — atualiza badge de timecode sem causar re-renders
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const t = activePlayer()?.getCurrentTime();
      if (composerTimeBadgeRef.current && t !== undefined && isFinite(t)) {
        composerTimeBadgeRef.current.textContent = formatTimecode(t, timeFormatRef.current);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (comments.length)
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [comments.length]);


  // Fecha o version picker ao clicar fora
  useEffect(() => {
    if (!versionMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (versionPickerRef.current && !versionPickerRef.current.contains(e.target as Node)) {
        setVersionMenuOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [versionMenuOpen]);

  // Files that are versions of the current asset (same fileName), oldest first
  // Usa a mesma lógica de review-task.tsx: fileOrder tem prioridade, depois revisionNumber, depois createdAt
  const versionFiles = useMemo(() =>
    allFiles
      .filter(f => f.fileName === file?.fileName)
      .sort((a, b) => {
        const aOrd = a.fileOrder ?? null;
        const bOrd = b.fileOrder ?? null;
        if (aOrd !== null && bOrd !== null) return aOrd - bOrd;
        if (aOrd !== null) return -1;
        if (bOrd !== null) return 1;
        if (a.revisionNumber !== b.revisionNumber) return a.revisionNumber - b.revisionNumber;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
  , [allFiles, file]);

  const search = useSearch();
  const autoCompareRef = useRef(false);

  // Breadcrumb no Shell header (após versionFiles estar disponível)
  useEffect(() => {
    if (!task || !file) return;
    const versionIdx = versionFiles.findIndex(vf => vf.id === fId) + 1;
    const versionSuffix = versionFiles.length > 1
      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--primary))", color: "#fff" }}>v{versionIdx}</span>
      : null;
    setBreadcrumb([
      ...(task.taskCode ? [{ label: task.taskCode, mono: true, muted: true }] : []),
      { label: task.title, href: `/review/${tId}`, muted: true },
      { label: file.originalName ?? file.fileName },
    ], versionSuffix);
    return () => clearBreadcrumb();
  }, [task?.id, task?.title, task?.taskCode, file?.id, file?.originalName, file?.fileName, versionFiles.length, fId]);

  // Auto-abre compare mode quando a URL contém ?compare=1 (vindo do botão Comparar na lista)
  useEffect(() => {
    if (autoCompareRef.current || !task || !file || versionFiles.length < 2) return;
    if (new URLSearchParams(search).get("compare") !== "1") return;
    autoCompareRef.current = true;
    const cur = versionFiles.findIndex(vf => vf.id === fId);
    const leftIdx  = cur > 0 ? cur - 1 : 0;
    const rightIdx = cur > 0 ? cur : Math.min(1, versionFiles.length - 1);
    const leftFileId  = versionFiles[leftIdx]?.id ?? fId;
    const rightFileId = versionFiles[rightIdx]?.id ?? fId;
    setCompareSideFiles({ left: leftFileId, right: rightFileId });
    setCompareActiveSide("right");
    setCompareCommentsMap({ [fId]: comments });
    if (leftFileId !== fId) {
      apiFetch<ReviewComment[]>(`/api/tasks/${tId}/review-comments?fileId=${leftFileId}`)
        .catch(() => [] as ReviewComment[])
        .then(cs => setCompareCommentsMap(prev => ({
          ...prev,
          [leftFileId]: cs.map(c => ({ ...c, replies: Array.isArray(c.replies) ? c.replies : [] })),
        })));
    }
    setCompareMode(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, file?.id, versionFiles.length]);

  // Quando compareMode está ativo, usa os comentários do lado selecionado; senão usa comments normais
  const compareActiveComments: ReviewComment[] = useMemo(() =>
    compareMode ? (compareCommentsMap[compareActiveFileId] ?? []) : comments
  , [compareMode, compareCommentsMap, compareActiveFileId, comments]);

  const markers: Marker[] = useMemo(() =>
    compareActiveComments.filter(c => c.timestampSec != null).map(c => ({
      timestampSec:   c.timestampSec!,
      orderIndex:     0,
      color:          (c.resolvedAt ? "emerald" : "amber") as Marker["color"],
      avatarUrl:   c.userAvatarUrl,
      userName:    c.userName,
      annotations: c.annotations,
      commentBody: c.body,
    })), [compareActiveComments]);

  // Comentários exibidos na sidebar — varia por modo
  const sidebarComments: ReviewComment[] = useMemo(() => {
    if (compareMode) return compareActiveComments;
    return comments;
  }, [compareMode, compareActiveComments, comments]);

  // Carrega comentários de um arquivo de versão no mapa (sem re-carregar se já existir)
  const loadCompareComments = useCallback((fileId: number) => {
    if (compareCommentsMap[fileId] !== undefined) return;
    apiFetch<ReviewComment[]>(`/api/tasks/${tId}/review-comments?fileId=${fileId}`)
      .catch(() => [] as ReviewComment[])
      .then(cs => setCompareCommentsMap(prev => ({
        ...prev,
        [fileId]: cs.map(c => ({ ...c, replies: Array.isArray(c.replies) ? c.replies : [] })),
      })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tId, compareCommentsMap]);

  const handleMarkerClick = (t: number, annotations?: string | null) => {
    if (!compareMode) {
      // Player simples: seek via prop + pausa via ref (handleSeeked vai mostrar a annotation)
      setSeekTarget(prev => ({ t, n: (prev?.n ?? 0) + 1 }));
      playerRef.current?.pause();
    } else {
      // Compare mode: seek/pausa direto via ref nos dois vídeos
      comparePlayerRef.current?.seekTo(t);
      comparePlayerRef.current?.pause();
    }

    let ann = annotations ?? null;

    const withTs = compareActiveComments.filter(c => c.timestampSec != null);
    if (withTs.length) {
      const closest = withTs.reduce((best, c) =>
        Math.abs(c.timestampSec! - t) < Math.abs(best.timestampSec! - t) ? c : best
      );
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      setHighlightedCommentId(closest.id);
      setTimeout(() => {
        commentRefs.current.get(closest.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 40);
      highlightTimer.current = setTimeout(() => setHighlightedCommentId(null), 2200);
      if (!ann) ann = closest.annotations ?? null;
    }

    if (viewAnnTimer.current) clearTimeout(viewAnnTimer.current);
    setViewAnnotations(null);
    if (!ann) { pendingAnn.current = null; return; }

    if (compareMode) {
      // Em compare mode não há evento "seeked" do VideoPlayer, mostra imediatamente
      annOverlayKey.current++;
      setViewAnnotations(ann);
      viewAnnTimer.current = setTimeout(() => setViewAnnotations(null), 5000);
    } else {
      pendingAnn.current = ann;
    }
  };

  const handleSeeked = () => {
    const ann = pendingAnn.current;
    if (!ann) return;
    pendingAnn.current = null;
    if (viewAnnTimer.current) clearTimeout(viewAnnTimer.current);
    annOverlayKey.current++;
    setViewAnnotations(ann);
    viewAnnTimer.current = setTimeout(() => setViewAnnotations(null), 5000);
  };

  const handleSubmit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      const time = pendingFrame?.time ?? activePlayer()?.getCurrentTime() ?? null;
      const targetFileId = compareMode ? compareActiveFileId : fId;
      const payload: Record<string, unknown> = { taskFileId: targetFileId, body: body.trim() };
      if (time != null) {
        payload.timestampSec = time;
        if (annShapes.length > 0)
          payload.annotations = JSON.stringify({ ar: videoAr, shapes: annShapes });
      }
      const newComment = await apiPost<ReviewComment>(`/api/tasks/${tId}/review-comments`, payload);
      if (compareMode) {
        setCompareCommentsMap(prev => ({
          ...prev,
          [targetFileId]: [...(prev[targetFileId] ?? []), { ...newComment, replies: [] }],
        }));
      } else {
        setComments(prev => [...prev, { ...newComment, replies: [] }]);
      }
      if (newComment.timestampSec != null) {
        setNewMarkerTimestamp(newComment.timestampSec);
        setTimeout(() => setNewMarkerTimestamp(null), 900);
      }

      // Se havia anotações, exibe o SVG overlay no vídeo por 4s
      if (newComment.annotations) {
        if (viewAnnTimer.current) clearTimeout(viewAnnTimer.current);
        setViewAnnotations(newComment.annotations);
        viewAnnTimer.current = setTimeout(() => setViewAnnotations(null), 4000);
      }

      setBody("");
      setPendingFrame(null);
      setAnnShapes([]);
      setAnnotationMode(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch { toast.error("Erro ao enviar comentário"); }
    finally { setSubmitting(false); }
  };

  const handleOpenDrawer = () => {
    if (annotationMode) { setAnnotationMode(false); return; }
    const player = activePlayer();
    const time = player?.getCurrentTime();
    if (time == null) { toast.error("Pausa o vídeo num frame primeiro"); return; }
    setVideoAr(player?.getNaturalAr() ?? 16 / 9);
    setPendingFrame({ time });
    setAnnotationMode(true);
  };

  const toSVGCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = annSvgRef.current!;
    const pt  = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const inv = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: inv.x, y: inv.y };
  };

  const onAnnDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x, y } = toSVGCoords(e);
    annActive.current = true;
    annStart.current  = { x, y };
    if (annTool === "pen") {
      annPts.current = [x, y];
      setAnnPreview({ tool: "pen", color: annColor, size: ANN_STROKE, points: [x, y] });
    }
  };

  const onAnnMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!annActive.current || !annStart.current) return;
    const { x, y } = toSVGCoords(e);
    const { x: x1, y: y1 } = annStart.current;
    if (annTool === "pen") {
      annPts.current = [...annPts.current, x, y];
      setAnnPreview({ tool: "pen", color: annColor, size: ANN_STROKE, points: [...annPts.current] });
    } else if (annTool === "arrow") {
      setAnnPreview({ tool: "arrow", color: annColor, size: ANN_STROKE, x1, y1, x2: x, y2: y });
    } else {
      setAnnPreview({ tool: "rect", color: annColor, size: ANN_STROKE,
        x: Math.min(x1, x), y: Math.min(y1, y),
        w: Math.abs(x - x1), h: Math.abs(y - y1) });
    }
  };

  const onAnnUp = () => {
    if (!annActive.current) return;
    annActive.current = false;
    if (annPreview) setAnnShapes(s => [...s, annPreview]);
    setAnnPreview(null);
    annStart.current = null;
    annPts.current   = [];
  };


  const handleResolve = async (commentId: number) => {
    try {
      await apiPatch(`/api/tasks/${tId}/review-comments/${commentId}/resolve`, {});
      const applyResolve = (cs: ReviewComment[]) => cs.map(c =>
        c.id === commentId ? { ...c, resolvedAt: c.resolvedAt ? null : new Date().toISOString() } : c
      );
      if (compareMode) {
        setCompareCommentsMap(prev => ({ ...prev, [compareActiveFileId]: applyResolve(prev[compareActiveFileId] ?? []) }));
      } else {
        setComments(prev => applyResolve(prev));
      }
    } catch { toast.error("Erro ao atualizar"); }
  };

  const handleDelete = async (commentId: number) => {
    try {
      await apiDelete(`/api/tasks/${tId}/review-comments/${commentId}`);
      if (compareMode) {
        setCompareCommentsMap(prev => ({ ...prev, [compareActiveFileId]: (prev[compareActiveFileId] ?? []).filter(c => c.id !== commentId) }));
      } else {
        setComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch { toast.error("Erro ao excluir comentário"); }
  };

  const handleEditComment = async (commentId: number, body: string) => {
    try {
      await apiPatch(`/api/tasks/${tId}/review-comments/${commentId}`, { body });
      const applyEdit = (cs: ReviewComment[]) => cs.map(c => c.id === commentId ? { ...c, body } : c);
      if (compareMode) {
        setCompareCommentsMap(prev => ({ ...prev, [compareActiveFileId]: applyEdit(prev[compareActiveFileId] ?? []) }));
      } else {
        setComments(prev => applyEdit(prev));
      }
    } catch { toast.error("Erro ao editar comentário"); throw new Error("fail"); }
  };

  const handleSubmitReply = async (parentId: number, body: string) => {
    try {
      const targetFileId = compareMode ? compareActiveFileId : fId;
      const newReply = await apiPost<ReviewComment>(`/api/tasks/${tId}/review-comments`, {
        taskFileId: targetFileId, parentId, body,
      });
      const applyReply = (cs: ReviewComment[]) => cs.map(c =>
        c.id === parentId ? { ...c, replies: [...c.replies, newReply as unknown as ReviewReply] } : c
      );
      if (compareMode) {
        setCompareCommentsMap(prev => ({ ...prev, [targetFileId]: applyReply(prev[targetFileId] ?? []) }));
      } else {
        setComments(prev => applyReply(prev));
      }
    } catch { toast.error("Erro ao enviar resposta"); throw new Error("fail"); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      // Força o mesmo fileName do ativo atual → garante nova versão do mesmo ativo
      const renamed = new File([f], file?.fileName ?? f.name, { type: f.type || file?.mimeType || undefined });
      const form = new FormData(); form.append("file", renamed);
      const res = await fetch(`/api/tasks/${tId}/files`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error();
      const newFile = await res.json();
      toast.success("Nova versão enviada!");
      navigate(`/review/${tId}/${newFile.id}`);
    } catch { toast.error("Erro ao enviar"); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const ids = allFiles.map(f => f.id);
      if (ids.length) await apiPatch(`/api/tasks/${tId}/files/approve`, { fileIds: ids });
      await apiPut(`/api/tasks/${tId}`, { status: "completed" });
      toast.success("Tarefa aprovada!");
      setTask(prev => prev ? { ...prev, status: "completed" } : prev);
      setConfirmApprove(false);
    } catch { toast.error("Erro ao aprovar"); }
    finally { setApproving(false); }
  };

  const unresolvedCount = sidebarComments.filter(c => !c.resolvedAt).length;

  const loadingScreen = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );

  if (loading) return loadingScreen;
  if (!task || !file) return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(var(--background))]">
      <p className="text-[hsl(var(--muted-foreground))] text-sm">Arquivo não encontrado</p>
    </div>
  );

  return (
    <>
    <style>{`
      @keyframes avatarMarkerBounce {
        0%   { transform: scale(0.6) translateY(-5px); opacity: 0; }
        55%  { transform: scale(1.15) translateY(-1px); opacity: 1; }
        80%  { transform: scale(0.95) translateY(1px); }
        100% { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes btnBounce {
        0%,100% { transform: scale(1); }
        35%     { transform: scale(1.28); }
        65%     { transform: scale(0.88); }
        82%     { transform: scale(1.08); }
      }
      .btn-click-bounce:active { animation: btnBounce 0.32s ease-out; }
    `}</style>
    <div className="fixed inset-0 z-[100] flex flex-col bg-[hsl(var(--background))]">

      {/* ── TOP BAR — oculto em compare mode ── */}
      {!compareMode && <header className="shrink-0 flex items-center gap-3 px-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]"
        style={{ height: 56 }}>

        <button onClick={() => navigate("/tasks")}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
          {task.taskCode && (
            <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--border))] shrink-0" />
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 truncate max-w-[160px]">
            {task.title}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--border))] shrink-0" />
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]/85 truncate">{file.originalName ?? file.fileName}</span>
          {/* Version picker */}
          {versionFiles.length > 1 && (
            <div ref={versionPickerRef} className="relative shrink-0">
              <button ref={versionBtnRef}
                onClick={() => {
                  const rect = versionBtnRef.current?.getBoundingClientRect();
                  if (rect) setVersionDropPos({ top: rect.bottom + 4, left: rect.left });
                  setVersionMenuOpen(v => !v);
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold hover:opacity-80 transition-opacity"
                style={{ background: "hsl(var(--primary))", color: "#fff" }}>
                v{versionFiles.findIndex(vf => vf.id === fId) + 1}
                <ChevronDown className="h-2.5 w-2.5 opacity-70" />
              </button>
              {versionMenuOpen && versionDropPos && (
                <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden py-1"
                  style={{ position: "fixed", top: versionDropPos.top, left: versionDropPos.left, zIndex: 9999, boxShadow: "0 8px 24px rgba(0,0,0,0.22)", minWidth: 220 }}>
                  {versionFiles.map((vf, i) => {
                    const isActive = vf.id === fId;
                    return (
                      <button key={vf.id}
                        onClick={() => {
                          setVersionMenuOpen(false);
                          if (!isActive) navigate(`/review/${tId}/${vf.id}`);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[hsl(var(--muted))] transition-colors"
                        style={{ background: isActive ? "hsl(var(--muted)/0.6)" : undefined }}>
                        <div className="shrink-0 rounded overflow-hidden bg-black" style={{ width: 52, height: 30 }}>
                          <video src={streamUrl(vf)} preload="metadata" muted playsInline
                            onLoadedMetadata={e => { (e.target as HTMLVideoElement).currentTime = 0.5; }}
                            className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold" style={{ color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                              v{i + 1}
                            </span>
                            {i === versionFiles.length - 1 && (
                              <span className="text-[9px] text-[hsl(var(--muted-foreground))]/40">atual</span>
                            )}
                            {vf.approvedAt && (
                              <span className="text-[9px] font-semibold text-emerald-500 px-1 py-px rounded bg-emerald-500/10 border border-emerald-500/20">✓ aprovada</span>
                            )}
                          </div>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 truncate leading-tight">
                            {vf.originalName ?? vf.fileName}
                          </p>
                        </div>
                        {isActive && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--primary))" }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ações direita */}

        <div className="flex items-center gap-1.5 shrink-0">
          {isTaskOwner && (
            <button onClick={() => setInviteOpen(true)}
              className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/70 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              <UserPlus className="h-3 w-3" />Convidar
            </button>
          )}
          <button onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copiado!"); }}
            className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/70 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            <Link2 className="h-3 w-3" />Compartilhar
          </button>
          {versionFiles.length > 1 && (
            <button
              onClick={() => {
                const cur = versionFiles.findIndex(vf => vf.id === fId);
                const leftIdx  = cur > 0 ? cur - 1 : 0;
                const rightIdx = cur > 0 ? cur : Math.min(1, versionFiles.length - 1);
                const leftFileId  = versionFiles[leftIdx]?.id ?? fId;
                const rightFileId = versionFiles[rightIdx]?.id ?? fId;
                setCompareSideFiles({ left: leftFileId, right: rightFileId });
                setCompareActiveSide("right");
                setCompareCommentsMap({ [fId]: comments });
                if (leftFileId !== fId) {
                  apiFetch<ReviewComment[]>(`/api/tasks/${tId}/review-comments?fileId=${leftFileId}`)
                    .catch(() => [] as ReviewComment[])
                    .then(cs => setCompareCommentsMap(prev => ({
                      ...prev,
                      [leftFileId]: cs.map(c => ({ ...c, replies: Array.isArray(c.replies) ? c.replies : [] })),
                    })));
                }
                setCompareMode(true);
              }}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg text-[hsl(var(--foreground))]/70 border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-all">
              <GitCompareArrows className="h-3 w-3" />Comparar
            </button>
          )}
          {file.revisionNumber > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-medium text-amber-500 px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/8">
              <RotateCcw className="h-2.5 w-2.5" />{file.revisionNumber}ª alt.
            </span>
          )}
          {(task.status === "completed" || file.approvedAt) && versionFiles[versionFiles.length - 1]?.id === fId && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/8">
              <CheckCircle className="h-3 w-3" />Aprovado
            </span>
          )}
          <a href={downloadUrl(file)} download={file.fileName}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
            <Download className="h-3.5 w-3.5" />
          </a>
          {isEditor && !isApproved && (
            <>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleUpload} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg text-[hsl(var(--foreground))]/70 border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-all disabled:opacity-40">
                <Upload className="h-3 w-3" />{uploading ? "Enviando…" : "Nova versão"}
              </button>
            </>
          )}
          {canApprove && !confirmApprove && (
            <button onClick={() => setConfirmApprove(true)}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white bg-emerald-600 hover:bg-emerald-500 transition-colors">
              <CheckCircle className="h-3.5 w-3.5" />Aprovar
            </button>
          )}
          {confirmApprove && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Confirmar?</span>
              <button onClick={() => setConfirmApprove(false)}
                className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]">
                Cancelar
              </button>
              <button onClick={handleApprove} disabled={approving}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 transition-colors">
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}Sim
              </button>
            </div>
          )}
        </div>
      </header>}

      {/* ── BODY: player + sidebar — mobile: coluna, desktop: linha ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

        {/* ── VIDEO ── mobile: altura fixa 16:9, desktop: flex-1 */}
        <div className="flex flex-col bg-black h-[56vw] min-h-[180px] max-h-[55vh] md:h-auto md:max-h-none md:flex-1">

          {/* Compare mode — wrapper relativo para posicionar o overlay de anotação */}
          {compareMode && (() => {
            const cur = versionFiles.findIndex(vf => vf.id === fId);
            const defaultLeft  = cur > 0 ? cur - 1 : 0;
            const defaultRight = cur > 0 ? cur : Math.min(1, versionFiles.length - 1);
            return (
              <>
              {/* Barra para sair do compare */}
              <div className="shrink-0 flex items-center px-2 border-b"
                style={{ height: 32, background: "rgba(0,0,0,0.9)", borderColor: "rgba(255,255,255,0.08)" }}>
                <button onClick={() => setCompareMode(false)}
                  className="flex items-center gap-1.5 h-6 px-2 rounded-md text-white/45 hover:text-white hover:bg-white/10 transition-colors text-[11px] font-medium">
                  <ArrowLeft className="h-3 w-3" />
                  Sair do compare
                </button>
              </div>

              <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
                <ComparePlayer
                  ref={comparePlayerRef}
                  versionFiles={versionFiles}
                  streamUrlOf={(f: VersionFile) => streamUrl(f as TaskFile)}
                  defaultLeftIdx={defaultLeft}
                  defaultRightIdx={defaultRight}
                  markers={markers}
                  onMarkerClick={handleMarkerClick}
                  timeFormat={timeFormat}
                  newMarkerTimestamp={newMarkerTimestamp}
                  onActiveSideChange={(side, fileId) => {
                    // Ao trocar lado, cancela anotação em progresso para não postar no arquivo errado
                    if (annotationMode) { setAnnotationMode(false); setAnnShapes([]); setPendingFrame(null); }
                    setCompareActiveSide(side);
                    setCompareSideFiles(prev => prev ? { ...prev, [side]: fileId } : null);
                    loadCompareComments(fileId);
                  }}
                  onSideVersionChange={(side, fileId) => {
                    setCompareSideFiles(prev => prev ? { ...prev, [side]: fileId } : null);
                    loadCompareComments(fileId);
                  }}
                  onClose={() => setCompareMode(false)}
                  onCloseSide={(keepIdx) => {
                    setCompareMode(false);
                    const keepId = versionFiles[keepIdx]?.id;
                    if (keepId && keepId !== fId) navigate(`/review/${tId}/${keepId}`);
                  }}
                />

                {/* Overlay de anotação — sibling direto do ComparePlayer, sobre o lado ativo.
                    Renderizado aqui (não como prop) para que setAnnPreview atualize o SVG
                    sem passar por ComparePlayer — evita problema de reconciliação. */}
                {(annotationMode || (viewAnnotations && !annotationMode)) && (
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left:  compareActiveSide === "left"  ? 0 : "50%",
                      right: compareActiveSide === "right" ? 0 : "50%",
                      zIndex: 50,
                      pointerEvents: "none",
                    }}>
                    {viewAnnotations && !annotationMode && (
                      <AnnotationOverlay
                        key={annOverlayKey.current}
                        annotations={viewAnnotations}
                        fit="meet"
                      />
                    )}
                    {annotationMode && (
                      <svg ref={annSvgRef}
                        viewBox={`0 0 ${videoAr} 1`}
                        preserveAspectRatio="xMidYMid meet"
                        className="absolute inset-0 w-full h-full"
                        style={{ cursor: "crosshair", touchAction: "none", pointerEvents: "auto" }}
                        onMouseDown={onAnnDown} onMouseMove={onAnnMove}
                        onMouseUp={onAnnUp} onMouseLeave={onAnnUp}>
                        {annShapes.map((s, i) => <ShapeEl key={i} shape={s} />)}
                        {annPreview && <ShapeEl shape={annPreview} />}
                      </svg>
                    )}
                  </div>
                )}
              </div>
              </>
            );
          })()}

          <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden", display: compareMode ? "none" : undefined }}>
            {isVideo && (
              <VideoPlayer ref={playerRef} key={file.id}
                src={streamUrl(file)} fill
                seekTo={seekTarget} markers={markers} onMarkerClick={handleMarkerClick}
                onScrub={() => { setViewAnnotations(null); pendingAnn.current = null; }}
                onSeeked={handleSeeked}
                timeFormat={timeFormat} onTimeFormatChange={setTimeFormat}
                newMarkerTimestamp={newMarkerTimestamp}
                overlay={viewAnnotations && !annotationMode
                  ? <AnnotationOverlay
                      key={annOverlayKey.current}
                      annotations={viewAnnotations}
                      className="z-[60]"
                      fit="meet"
                    />
                  : undefined}
              />
            )}
            {isAudio && (
              <AudioPlayer ref={playerRef} key={file.id}
                src={streamUrl(file)} fileName={file.originalName ?? file.fileName}
                fill
                seekTo={seekTarget} markers={markers} onMarkerClick={handleMarkerClick}
                onScrub={() => { setViewAnnotations(null); pendingAnn.current = null; }}
                onSeeked={handleSeeked}
                timeFormat={timeFormat} onTimeFormatChange={setTimeFormat}
                overlay={viewAnnotations && !annotationMode
                  ? <AnnotationOverlay
                      key={annOverlayKey.current}
                      annotations={viewAnnotations}
                      className="z-[60]"
                      fit="meet"
                    />
                  : undefined}
              />
            )}
            {!isVideo && !isAudio && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/20">
                <Film className="h-12 w-12" />
                <p className="text-sm">Formato não suportado</p>
              </div>
            )}


            {/* ── SVG de anotação — overlay editável ── */}
            {annotationMode && (
              <svg ref={annSvgRef}
                viewBox={`0 0 ${videoAr} 1`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 w-full h-full z-[30]"
                style={{ cursor: "crosshair", touchAction: "none" }}
                onMouseDown={onAnnDown}
                onMouseMove={onAnnMove}
                onMouseUp={onAnnUp}
                onMouseLeave={onAnnUp}>
                {annShapes.map((s, i) => <ShapeEl key={i} shape={s} />)}
                {annPreview && <ShapeEl shape={annPreview} />}
              </svg>
            )}
          </div>
        </div>

        {/* ── SIDEBAR ── mobile: flex-1 (preenche abaixo do vídeo), desktop: 360px fixo */}
        <div className="flex-1 md:flex-none md:w-[360px] flex flex-col border-t md:border-t-0 md:border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">

          {/* Sidebar header */}
          {/* Header do sidebar — busca de comentários */}
          <div className="shrink-0 flex items-center gap-2 px-3 border-b border-[hsl(var(--border))]" style={{ height: 44 }}>
            <div className="flex-1 flex items-center gap-2 rounded-md px-2.5 h-7"
              style={{ background: "hsl(var(--muted)/0.6)", border: "1px solid hsl(var(--border))" }}>
              <Search className="h-3 w-3 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
              <input
                value={commentSearch}
                onChange={e => setCommentSearch(e.target.value)}
                placeholder="Buscar comentários…"
                className="flex-1 bg-transparent text-xs text-[hsl(var(--foreground))]/80 placeholder-[hsl(var(--muted-foreground))]/40 outline-none"
              />
              {commentSearch && (
                <button onClick={() => setCommentSearch("")}
                  className="text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--foreground))]/70">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {unresolvedCount > 0 && (
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                {unresolvedCount}
              </span>
            )}
            {comments.length > 0 && unresolvedCount === 0 && (
              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full shrink-0">✓</span>
            )}
          </div>



          {/* Comments — única área que scrola */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            {sidebarComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center py-12">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-[hsl(var(--muted))] border border-[hsl(var(--border))]">
                  <MessageSquare className="h-5 w-5 text-[hsl(var(--muted-foreground))]/30" />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]/60 leading-relaxed">
                  <>Posicione o vídeo num frame,<br />digite e pressione <span className="text-[hsl(var(--foreground))]/50 font-medium">Enter</span></>
                </p>
              </div>
            ) : (() => {
              const q = commentSearch.trim().toLowerCase();
              const filtered = q ? sidebarComments.filter(c => c.body.toLowerCase().includes(q)) : sidebarComments;
              const isReadOnly = compareMode || isApproved;
              return filtered.length === 0
                ? <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-8">Nenhum resultado</p>
                : filtered.map((c, i) => {
                    const isUnread = c.userId !== user?.id && !readSet.has(c.id);
                    return (
                      <CommentCard key={c.id} comment={c} commentIndex={i + 1}
                        ref={(el: HTMLDivElement | null) => { if (el) commentRefs.current.set(c.id, el); else commentRefs.current.delete(c.id); }}
                        currentUserId={isReadOnly ? undefined : user?.id}
                        isCoord={isReadOnly ? false : isCoord}
                        highlighted={highlightedCommentId === c.id}
                        isUnread={isUnread}
                        timeFormat={timeFormat}
                        onSeek={handleMarkerClick} onResolve={handleResolve}
                        onDelete={handleDelete} onEdit={handleEditComment}
                        onSubmitReply={handleSubmitReply}
                        onMarkRead={() => setReadSet(prev => { const n = new Set(prev); n.add(c.id); return n; })} />
                    );
                  });
            })()}
            <div ref={commentsEndRef} />
          </div>

          {/* ── Composer (com toolbar de anotação acima quando ativo) ── */}
          {user && !isApproved && (
            <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-2">

              {/* Toolbar de anotação — visível só quando annotationMode está ativo */}
              {annotationMode && (
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]/50">
                  {/* Tool picker */}
                  <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-[hsl(var(--border))]"
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    {([
                      { id: "pen",   Icon: Pen,         label: "Lápis" },
                      { id: "arrow", Icon: ArrowUpRight, label: "Seta" },
                      { id: "rect",  Icon: Square,       label: "Retângulo" },
                    ] as const).map(({ id, Icon, label }) => (
                      <button key={id} onClick={() => setAnnTool(id)} title={label}
                        className="h-6 w-6 flex items-center justify-center rounded transition-colors"
                        style={{
                          background: annTool === id ? "hsl(var(--primary))" : "transparent",
                          color:      annTool === id ? "white" : "hsl(var(--muted-foreground))",
                        }}>
                        <Icon className="h-3 w-3" />
                      </button>
                    ))}
                  </div>

                  {/* Color picker */}
                  <div className="flex items-center gap-1.5">
                    {ANN_COLORS.map(c => (
                      <button key={c} onClick={() => setAnnColor(c)}
                        className="rounded-full transition-all shrink-0"
                        style={{
                          background:    c,
                          width:         annColor === c ? 16 : 12,
                          height:        annColor === c ? 16 : 12,
                          outline:       annColor === c ? "2px solid hsl(var(--primary))" : "none",
                          outlineOffset: 2,
                        }} />
                    ))}
                  </div>

                  <div className="flex-1" />

                  {/* Undo */}
                  <button onClick={() => setAnnShapes(s => s.slice(0, -1))}
                    disabled={annShapes.length === 0}
                    className="h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--foreground))]/70 hover:bg-[hsl(var(--muted))] disabled:opacity-30 transition-colors"
                    title="Desfazer">
                    <RotateCcw className="h-3 w-3" />
                  </button>

                  {/* Limpar tudo */}
                  {annShapes.length > 0 && (
                    <button onClick={() => setAnnShapes([])}
                      className="h-6 px-1.5 flex items-center rounded-md text-[10px] text-red-500/60 hover:text-red-500 hover:bg-red-500/8 transition-colors"
                      title="Limpar anotações">
                      Limpar
                    </button>
                  )}
                </div>
              )}

              {/* Textarea */}
              <div className="relative rounded-lg focus-within:ring-1 focus-within:ring-[hsl(var(--primary))]/40 transition-all border border-[hsl(var(--border))]"
                style={{ background: "rgba(255,255,255,0.06)" }}>

                <span ref={composerBadgeRef}
                  className="pointer-events-none absolute left-2.5 top-[8px] inline-flex items-center text-[13px] font-mono font-bold px-2 py-0.5 rounded select-none"
                  style={{ background: "hsl(var(--primary)/0.12)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.22)" }}>
                  <span ref={composerTimeBadgeRef}>0:00.0</span>
                </span>

                <textarea ref={textareaRef}
                  value={body}
                  onChange={e => {
                    setBody(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Comentar neste frame…"
                  className="w-full resize-none pr-3 pb-2 text-sm text-[hsl(var(--foreground))]/85 placeholder-[hsl(var(--muted-foreground))]/40 focus:outline-none bg-transparent"
                  style={{ minHeight: 38, maxHeight: 110, overflowY: "auto", lineHeight: "22px", paddingTop: 9, paddingLeft: 82 }}
                  rows={1} />

                {/* Footer: botão draw (toggle) + enviar */}
                <div className="flex items-center gap-1.5 px-2 pb-2 -mt-1">
                  {(isVideo || isAudio) && (
                    <button onClick={handleOpenDrawer} title={annotationMode ? "Fechar ferramenta" : "Anotar neste frame"}
                      className="h-6 w-6 flex items-center justify-center rounded-md transition-colors"
                      style={{
                        background: annotationMode ? "hsl(var(--primary))" : annShapes.length > 0 ? "hsl(var(--primary)/0.12)" : "transparent",
                        color:      annotationMode ? "white" : annShapes.length > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                        border:     `1px solid ${annotationMode ? "hsl(var(--primary))" : annShapes.length > 0 ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))"}`
                      }}>
                      <RiPenNibLine className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div className="flex-1" />
                  <button onClick={handleSubmit} disabled={submitting || !body.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold disabled:opacity-30 transition-all"
                    style={{ background: body.trim() ? "hsl(var(--primary))" : "transparent", color: body.trim() ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))", border: body.trim() ? "none" : "1px solid hsl(var(--border))" }}>
                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          )}
        {/* Aviso de aprovação — substitui o composer */}
        {isApproved && (
          <div className="shrink-0 border-t border-[hsl(var(--border))] px-4 py-3 flex items-center gap-2"
            style={{ background: "hsl(var(--card))" }}>
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/50">
              Tarefa aprovada — comentários encerrados
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
    {inviteOpen && task && (
      <InviteReviewerModal taskId={tId} taskTitle={task.title} onClose={() => setInviteOpen(false)} />
    )}
    </>
  );
}

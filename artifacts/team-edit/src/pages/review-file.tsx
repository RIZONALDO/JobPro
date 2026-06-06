import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { apiFetch, apiPost, apiPut, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { fmtDate } from "@/lib/utils";
import { VideoPlayer, AudioPlayer, fmtTime, type Marker } from "@/components/player";
import {
  ArrowLeft, MapPin, Send, CheckCircle, CheckCircle2,
  MessageSquare, Loader2, X, RotateCcw, Upload, Download,
  Film, Music,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string;
  revisionCount: number; dueDate: string | null;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  taskType: string;
}
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null; approvedByName?: string | null;
}
interface ReviewReply {
  id: number; userId: number; body: string; createdAt: string;
  userName: string | null; userAvatarUrl: string | null; userRole: string | null;
  resolvedAt: string | null;
}
interface ReviewComment {
  id: number; taskFileId: number | null; parentId: number | null;
  userId: number; timestampSec: number | null; frameThumbnail: string | null;
  body: string; resolvedAt: string | null; resolvedById: number | null;
  createdAt: string;
  userName: string | null; userAvatarUrl: string | null; userRole: string | null;
  replies: ReviewReply[];
}

// ── CommentCard ───────────────────────────────────────────────────────────────

function CommentCard({ comment, currentUserId, onSeek, onResolve, onReply }: {
  comment: ReviewComment;
  currentUserId: number | undefined;
  onSeek: (t: number) => void;
  onResolve: (id: number) => void;
  onReply: (id: number, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const resolved = !!comment.resolvedAt;

  return (
    <div className={`rounded-xl border transition-all ${resolved ? "border-white/5 opacity-50" : "border-white/10"}`}
      style={{ background: resolved ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)" }}>

      {/* Frame thumbnail + timecode */}
      {comment.timestampSec != null && (
        <button onClick={() => onSeek(comment.timestampSec!)}
          className="w-full flex items-center gap-2 px-3 pt-3 group/seek">
          {comment.frameThumbnail
            ? <img src={comment.frameThumbnail} alt="frame" className="h-10 w-[72px] rounded-md object-cover shrink-0 ring-1 ring-white/10 group-hover/seek:ring-[hsl(var(--primary))]/50 transition-all" />
            : <div className="h-10 w-[72px] rounded-md shrink-0 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Film className="h-4 w-4 text-white/20" />
              </div>
          }
          <span className="text-[10px] font-mono text-[hsl(var(--primary))]/70 group-hover/seek:text-[hsl(var(--primary))] transition-colors">
            ⏱ {fmtTime(comment.timestampSec)}
          </span>
        </button>
      )}

      {/* Body */}
      <div className="px-3 pt-2 pb-1">
        <p className={`text-sm leading-snug ${resolved ? "line-through text-white/30" : "text-white/80"}`}>
          {comment.body}
        </p>
      </div>

      {/* Author + actions */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <AvatarDisplay name={comment.userName ?? "?"} avatarUrl={comment.userAvatarUrl} size={18} />
        <span className="text-[10px] text-white/30 flex-1 truncate">{comment.userName?.split(" ")[0]} · {fmtDate(comment.createdAt)}</span>
        <button onClick={() => onReply(comment.id, comment.userName ?? "?")}
          className="text-[10px] text-white/25 hover:text-white/60 transition-colors px-1">
          Responder
        </button>
        <button onClick={() => onResolve(comment.id)}
          title={resolved ? "Reabrir" : "Marcar como resolvido"}
          className={`h-5 w-5 rounded flex items-center justify-center transition-colors ${resolved ? "text-emerald-400/50 hover:text-emerald-400" : "text-white/20 hover:text-emerald-400"}`}>
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="border-t border-white/6 mx-2 mb-2">
          {comment.replies.map((r, i) => (
            <div key={r.id} className={`px-2 py-2 ${i > 0 ? "border-t border-white/5" : ""}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <AvatarDisplay name={r.userName ?? "?"} avatarUrl={r.userAvatarUrl} size={14} />
                <span className="text-[10px] text-white/30">{r.userName?.split(" ")[0]}</span>
                <span className="text-[10px] text-white/15 ml-auto">{fmtDate(r.createdAt)}</span>
              </div>
              <p className="text-xs text-white/60 leading-snug">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ReviewFilePage ────────────────────────────────────────────────────────────

export default function ReviewFilePage() {
  const { taskId, fileId } = useParams<{ taskId: string; fileId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const tId = parseInt(taskId);
  const fId = parseInt(fileId);

  const [task, setTask]     = useState<TaskDetail | null>(null);
  const [file, setFile]     = useState<TaskFile | null>(null);
  const [allFiles, setAllFiles] = useState<TaskFile[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading]   = useState(true);

  // Comment composition
  const [body, setBody]               = useState("");
  const [pendingFrame, setPendingFrame] = useState<{ time: number; dataUrl: string | null } | null>(null);
  const [replyTo, setReplyTo]         = useState<{ id: number; name: string } | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  // Player
  const [seekTarget, setSeekTarget] = useState<{ t: number; n: number } | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [approving, setApproving]   = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const isCoord  = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";
  const isEditor = user?.role === "editor";
  const canComment = !!(user);
  const canApprove = isCoord && task?.status === "review";
  const isVideo = !!file?.mimeType?.startsWith("video/");
  const isAudio = !!file?.mimeType?.startsWith("audio/");

  const streamUrl  = (f: TaskFile) => `/api/tasks/${tId}/files/${f.id}/stream`;
  const downloadUrl = (f: TaskFile) => `/api/tasks/${tId}/files/${f.id}/download`;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${tId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${tId}/files`).catch(() => [] as TaskFile[]),
      apiFetch<ReviewComment[]>(`/api/tasks/${tId}/review-comments?fileId=${fId}`).catch(() => [] as ReviewComment[]),
    ]).then(([t, files, coms]) => {
      setTask(t);
      setAllFiles(files);
      const f = files.find(x => x.id === fId) ?? null;
      setFile(f);
      setComments(coms);
    }).catch(() => toast.error("Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [tId, fId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (comments.length) commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  const markers: Marker[] = useMemo(() =>
    comments
      .filter(c => c.timestampSec != null)
      .map(c => ({
        timestampSec: c.timestampSec!,
        orderIndex: 0,
        color: c.resolvedAt ? "emerald" : "amber",
      })),
    [comments]
  );

  const handleCapture = useCallback((time: number, dataUrl: string | null) => {
    setPendingFrame({ time, dataUrl });
    setReplyTo(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handleMarkerClick = (t: number) =>
    setSeekTarget(prev => ({ t, n: (prev?.n ?? 0) + 1 }));

  const handleSubmit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        taskFileId: fId,
        body: body.trim(),
      };
      if (replyTo) {
        payload.parentId = replyTo.id;
      } else {
        if (pendingFrame) {
          payload.timestampSec = pendingFrame.time;
          payload.frameThumbnail = pendingFrame.dataUrl ?? undefined;
        }
      }
      const newComment = await apiPost<ReviewComment>(`/api/tasks/${tId}/review-comments`, payload);
      if (replyTo) {
        setComments(prev => prev.map(c =>
          c.id === replyTo.id ? { ...c, replies: [...c.replies, newComment as unknown as ReviewReply] } : c
        ));
      } else {
        setComments(prev => [...prev, { ...newComment, replies: [] }]);
      }
      setBody(""); setPendingFrame(null); setReplyTo(null);
    } catch { toast.error("Erro ao enviar comentário"); }
    finally { setSubmitting(false); }
  };

  const handleResolve = async (commentId: number) => {
    try {
      await apiPatch(`/api/tasks/${tId}/review-comments/${commentId}/resolve`, {});
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, resolvedAt: c.resolvedAt ? null : new Date().toISOString() } : c
      ));
    } catch { toast.error("Erro ao atualizar comentário"); }
  };

  const handleReplyInit = (id: number, name: string) => {
    setReplyTo({ id, name });
    setPendingFrame(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
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

  const handleUploadVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", f);
      const res = await fetch(`/api/tasks/${tId}/files`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error();
      toast.success("Nova versão enviada!");
      navigate(`/review/${tId}`);
    } catch { toast.error("Erro ao enviar arquivo"); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const unresolvedCount = comments.filter(c => !c.resolvedAt).length;
  const totalCount = comments.length;

  if (loading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: "#0a0b0f" }}>
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );
  if (!task || !file) return (
    <div className="h-screen flex items-center justify-center" style={{ background: "#0a0b0f" }}>
      <p className="text-white/40">Arquivo não encontrado</p>
    </div>
  );

  return (
    <div className="h-screen flex flex-col" style={{ background: "#0a0b0f" }}>

      {/* ── TOP BAR ── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/8"
        style={{ background: "rgba(10,11,15,0.95)", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <button onClick={() => navigate(`/review/${tId}`)}
          className="flex items-center gap-1.5 text-white/35 hover:text-white/70 transition-colors shrink-0 py-1 px-1">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-white/20 text-sm">/</span>
        <button onClick={() => navigate(`/review/${tId}`)} className="text-xs text-white/40 hover:text-white/70 transition-colors truncate max-w-[200px]">
          {task.taskCode ? `${task.taskCode} — ` : ""}{task.title}
        </button>
        <span className="text-white/20 text-sm">/</span>
        <span className="text-xs text-white/80 font-medium truncate flex-1">{file.fileName}</span>

        <div className="flex items-center gap-2 shrink-0">
          {file.revisionNumber > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400/70 px-2 py-0.5 rounded-full border border-amber-400/15 bg-amber-400/5">
              <RotateCcw className="h-2.5 w-2.5" />{file.revisionNumber}ª alt.
            </span>
          )}
          {task.status === "completed" || file.approvedAt ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-400/20 bg-emerald-400/5">
              <CheckCircle className="h-3 w-3" />Aprovado
            </span>
          ) : null}
          <a href={downloadUrl(file)} download={file.fileName}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-white/25 hover:text-white/70 hover:bg-white/8 transition-colors">
            <Download className="h-4 w-4" />
          </a>
          {isEditor && (
            <>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleUploadVersion} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white/80 border border-white/10 hover:border-white/20 hover:bg-white/8 transition-all disabled:opacity-40">
                <Upload className="h-3 w-3" />
                {uploading ? "Enviando…" : "Nova versão"}
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">Confirmar aprovação?</span>
              <button onClick={() => setConfirmApprove(false)} className="text-[11px] text-white/40 hover:text-white/70 px-2 py-1 rounded border border-white/10 hover:bg-white/5">Cancelar</button>
              <button onClick={handleApprove} disabled={approving}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 transition-colors">
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                Confirmar
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── BODY: player + sidebar ── */}
      <div className="flex-1 flex min-h-0">

        {/* ── VIDEO COLUMN ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          {/* Player */}
          <div className="flex-1 flex items-center justify-center min-h-0 bg-black">
            {isVideo && (
              <VideoPlayer key={file.id} src={streamUrl(file)}
                reviewMode={canComment}
                seekTo={seekTarget} markers={markers} onMarkerClick={handleMarkerClick}
                onCapture={handleCapture}
                maxHeight="calc(100vh - 112px)" />
            )}
            {isAudio && (
              <AudioPlayer key={file.id} src={streamUrl(file)} fileName={file.fileName}
                reviewMode={canComment}
                seekTo={seekTarget} markers={markers} onMarkerClick={handleMarkerClick}
                onCapture={handleCapture} />
            )}
            {!isVideo && !isAudio && (
              <div className="flex flex-col items-center gap-3 text-white/20">
                <Film className="h-12 w-12" />
                <p className="text-sm">Formato não suportado para visualização</p>
              </div>
            )}
          </div>

          {/* File strip */}
          {allFiles.length > 1 && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-white/8 overflow-x-auto scrollbar-none" style={{ background: "rgba(0,0,0,0.7)" }}>
              <span className="text-[10px] text-white/25 shrink-0">Versões:</span>
              {allFiles.map(f => (
                <button key={f.id} onClick={() => navigate(`/review/${tId}/${f.id}`)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-all ${f.id === fId ? "bg-[hsl(var(--primary))] text-white" : "text-white/40 hover:text-white/70 hover:bg-white/8"}`}>
                  {f.mimeType?.startsWith("video/") ? <Film className="h-3 w-3" /> : <Music className="h-3 w-3" />}
                  {f.revisionNumber === 0 ? "Original" : `${f.revisionNumber}ª alt.`}
                  {f.approvedAt && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── SIDEBAR ── */}
        <div className="w-80 shrink-0 flex flex-col border-l border-white/8" style={{ background: "#111318" }}>

          {/* Sidebar header */}
          <div className="shrink-0 px-4 py-3 border-b border-white/8 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-white/30" />
            <span className="text-sm font-semibold text-white/70 flex-1">Comentários</span>
            {totalCount > 0 && (
              <div className="flex items-center gap-1.5">
                {unresolvedCount > 0 && (
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full">
                    {unresolvedCount} pendente{unresolvedCount > 1 ? "s" : ""}
                  </span>
                )}
                {unresolvedCount === 0 && (
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full">
                    Tudo resolvido
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Comments list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5">
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <MessageSquare className="h-5 w-5 text-white/15" />
                </div>
                <p className="text-xs text-white/25 leading-relaxed">
                  Pause o vídeo e clique<br /><span className="text-amber-400/60 font-medium">Marcar</span> para comentar num frame
                </p>
              </div>
            ) : comments.map(c => (
              <CommentCard key={c.id} comment={c} currentUserId={user?.id}
                onSeek={handleMarkerClick} onResolve={handleResolve} onReply={handleReplyInit} />
            ))}
            <div ref={commentsEndRef} />
          </div>

          {/* ── Comment composer ── */}
          {canComment && (
            <div className="shrink-0 border-t border-white/8 p-3 space-y-2" style={{ background: "#0d0e13" }}>

              {/* Reply banner */}
              {replyTo && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20">
                  <span className="text-[11px] text-[hsl(var(--primary))]/80 flex-1 truncate">
                    ↩ Respondendo a {replyTo.name.split(" ")[0]}
                  </span>
                  <button onClick={() => setReplyTo(null)} className="text-white/25 hover:text-white/60 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Frame preview */}
              {pendingFrame && !replyTo && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-400/8 border border-amber-400/15">
                  {pendingFrame.dataUrl
                    ? <img src={pendingFrame.dataUrl} alt="frame" className="h-8 w-14 rounded object-cover shrink-0" />
                    : <div className="h-8 w-14 rounded shrink-0 flex items-center justify-center" style={{ background: "rgba(251,191,36,0.1)" }}>
                        <MapPin className="h-4 w-4 text-amber-400/50" />
                      </div>
                  }
                  <span className="text-[10px] font-mono text-amber-400/70 flex-1">⏱ {fmtTime(pendingFrame.time)}</span>
                  <button onClick={() => setPendingFrame(null)} className="text-white/25 hover:text-white/60 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Textarea */}
              <div className="flex gap-2 items-end">
                {user && <AvatarDisplay name={user.name} avatarUrl={(user as any).avatarUrl} size={24} className="shrink-0 mb-0.5" />}
                <div className="flex-1 relative">
                  <textarea ref={textareaRef}
                    value={body}
                    onChange={e => { setBody(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
                    placeholder={replyTo ? `Responder a ${replyTo.name.split(" ")[0]}…` : pendingFrame ? "Descreva o que precisa mudar…" : "Adicionar comentário…"}
                    className="w-full resize-none rounded-xl px-3 py-2 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/40"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", minHeight: 40, maxHeight: 120, overflowY: "auto", lineHeight: 1.5 }}
                    rows={1} />
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center gap-2 pl-8">
                {!replyTo && (
                  <button onClick={() => {
                    // Capture current frame via the player's capture callback
                    // The player must already be paused; we trigger capture by simulating "Marcar"
                    // Actually we just show a hint — the player's Marcar button does the real capture
                  }}
                    className="text-[11px] text-white/25 hover:text-amber-400/70 transition-colors flex items-center gap-1">
                    <MapPin className="h-3 w-3" />Use o botão Marcar no player
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={handleSubmit} disabled={submitting || !body.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-30 transition-all"
                  style={{ background: body.trim() ? "hsl(var(--primary))" : "rgba(255,255,255,0.08)" }}>
                  {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {replyTo ? "Responder" : "Enviar"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

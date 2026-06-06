import {
  useEffect, useState, useMemo, useRef, useCallback,
} from "react";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { fmtDate } from "@/lib/utils";
import {
  Clock, FolderOpen, Copy, Tag,
  Film, Music, Download, Link2, Trash2,
  MapPin, Send, X, CheckCircle, CheckCircle2,
  Loader2, Clapperboard, AudioLines, ChevronRight, RotateCcw,
  Package, Share2, ExternalLink,
} from "lucide-react";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { VideoPlayer, AudioPlayer, fmtTime, type Marker } from "@/components/player";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "entrega" | "envio";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface FrameComment {
  id: number; timestampSec: number; orderIndex: number;
  frameThumbnail: string | null; body: string;
}
interface ReviewBatch {
  id: number; taskFileId: number | null; revisionNumber: number;
  commentCount: number; submittedAt: string; submittedByName: string | null;
  comments: FrameComment[];
}
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null; approvedByName?: string | null;
}
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string; priority: string;
  complexity: string; dueDate: string | null; startDate?: string | null;
  folderUrl: string | null; revisionCount: number; notes?: string | null;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  revisions: Revision[]; createdAt: string; updatedAt: string;
  taskType: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}
interface PendingComment {
  localId: string; timestampSec: number; orderIndex: number;
  body: string; thumbnailDataUrl: string | null;
}
interface Props {
  taskId: number; onClose: () => void;
  onOpenTask?: (id: number) => void;
  initialTab?: Tab;
  onDone?: () => void;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

const fmtSize = (b: number | null) =>
  !b ? "" : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const revLabel = (n: number) => (n === 0 ? "Original" : `${n}ª alt.`);

// ── TaskModal ─────────────────────────────────────────────────────────────────

export function TaskModal({ taskId, onClose, onOpenTask, initialTab = "entrega", onDone }: Props) {
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [sharing, setSharing] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Player
  const [selected, setSelected] = useState<TaskFile | null>(null);
  const [activeRev, setActiveRev] = useState<number>(0);
  const [seekTarget, setSeekTarget] = useState<{ t: number; n: number } | null>(null);

  // Review inline (aba Entrega)
  const [reviewMode, setReviewMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [capturedFrame, setCapturedFrame] = useState<{ time: number; dataUrl: string | null } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${taskId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`).catch(() => [] as TaskFile[]),
      apiFetch<ReviewBatch[]>(`/api/tasks/${taskId}/review-batches`).catch(() => [] as ReviewBatch[]),
    ]).then(([t, f, b]) => {
      setTask(t); setFiles(f); setBatches(b);
      if (f.length > 0 && !selected) {
        const last = f[f.length - 1];
        setSelected(last); setActiveRev(last.revisionNumber);
      }
    }).catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);


  const streamUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/stream` : `/api/tasks/${taskId}/files/${f.id}/stream`;
  const downloadUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/download` : `/api/tasks/${taskId}/files/${f.id}/download`;
  const isVideo = (f: TaskFile) => !!f.mimeType?.startsWith("video/");
  const isAudio = (f: TaskFile) => !!f.mimeType?.startsWith("audio/");

  const revisionGroups = useMemo(() => {
    const map = new Map<number, TaskFile[]>();
    files.forEach(f => { if (!map.has(f.revisionNumber)) map.set(f.revisionNumber, []); map.get(f.revisionNumber)!.push(f); });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [files]);

  const activeFiles = useMemo(() => revisionGroups.find(([n]) => n === activeRev)?.[1] ?? [], [revisionGroups, activeRev]);

  // Marcadores no scrubber: amber = pendentes, sky = revisões anteriores
  const allMarkers: Marker[] = useMemo(() => [
    ...pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "amber" as const })),
    ...batches.flatMap(b => b.comments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "sky" as const }))),
  ], [pendingComments, batches]);

  const handleCapture = useCallback((time: number, dataUrl: string | null) => {
    setCapturedFrame({ time, dataUrl }); setCommentBody("");
  }, []);
  const saveComment = () => {
    if (!commentBody.trim() || !capturedFrame) return;
    setPendingComments(prev => [...prev, { localId: crypto.randomUUID(), timestampSec: capturedFrame.time, orderIndex: prev.length + 1, body: commentBody.trim(), thumbnailDataUrl: capturedFrame.dataUrl }]);
    setCapturedFrame(null); setCommentBody("");
  };
  const removeComment = (id: string) =>
    setPendingComments(prev => prev.filter(c => c.localId !== id).map((c, i) => ({ ...c, orderIndex: i + 1 })));
  const handleMarkerClick = (t: number) => setSeekTarget(prev => ({ t, n: (prev?.n ?? 0) + 1 }));

  const handleSubmitBatch = async () => {
    if (!pendingComments.length || !selected) return;
    setSubmitting(true);
    try {
      await apiPost(`/api/tasks/${taskId}/review-batches`, {
        taskFileId: selected.id,
        comments: pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, body: c.body, thumbnailDataUrl: c.thumbnailDataUrl ?? undefined })),
      });
      toast.success(`Revisão enviada — ${pendingComments.length} comentário${pendingComments.length > 1 ? "s" : ""}`);
      onDone?.(); onClose();
    } catch { toast.error("Erro ao enviar revisão"); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const ids = files.map(f => f.id);
      if (ids.length) await apiPatch(`/api/tasks/${taskId}/files/approve`, { fileIds: ids });
      await apiPut(`/api/tasks/${taskId}`, { status: "completed" });
      toast.success("Tarefa aprovada!"); onDone?.(); onClose();
    } catch { toast.error("Erro ao aprovar"); }
    finally { setApproving(false); }
  };

  const generateLink = async (fileId: number) => {
    setSharing(fileId);
    try {
      const { token } = await apiPost<{ token: string }>(`/api/tasks/${taskId}/files/${fileId}/share`, {});
      const url = `${window.location.origin}/p/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: token } : f));
    } catch { toast.error("Erro ao gerar link"); }
    finally { setSharing(null); }
  };

  const removeFile = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success("Arquivo removido");
    } catch { toast.error("Erro ao remover arquivo"); }
  };

  const isCoord   = isCoordinator;
  const canReview = isCoord && task?.status === "review";
  const isApproved = task?.status === "completed";

  const tabs: { id: Tab; icon: React.ReactNode; label: string; disabled?: boolean }[] = isCoord ? [
    { id: "entrega", icon: <Package  className="h-3.5 w-3.5" />, label: "Entrega" },
    { id: "envio",   icon: <Share2   className="h-3.5 w-3.5" />, label: "Envio ao cliente", disabled: !isApproved },
  ] : [
    { id: "entrega", icon: <Package className="h-3.5 w-3.5" />, label: "Material entregue" },
  ];

  const approvedFile = files.find(f => f.approvedAt) ?? files[files.length - 1] ?? null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden h-[90vh] flex flex-col rounded-2xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))]">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando</DialogTitle>
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ── HEADER ── */}
            <div className="shrink-0 px-5 pt-4 pb-0 border-b border-[hsl(var(--border))]">
              <div className="flex items-baseline gap-2 flex-wrap mb-1">
                {task.taskCode && <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span>}
                <h2 className="text-base font-bold text-[hsl(var(--foreground))] leading-snug">{task.title}</h2>
              </div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none ${STATUS_CHIP[task.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                {task.revisionCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30">
                    <RotateCcw className="h-2.5 w-2.5" />{task.revisionCount} alt.
                  </span>
                )}
                {task.client && <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1"><Tag className="h-3 w-3" />{task.client}</span>}
                {task.editors?.[0] && <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1.5"><AvatarDisplay name={task.editors[0].name} avatarUrl={task.editors[0].avatarUrl} size={14} />{task.editors[0].name.split(" ")[0]}</span>}
              </div>
              <div className="flex -mb-px">
                {tabs.map(tab => (
                  <button key={tab.id} onClick={() => !tab.disabled && setActiveTab(tab.id)} disabled={tab.disabled}
                    className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold border-b-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      activeTab === tab.id ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── CONTEÚDO ── */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

              {/* ══════════════════════════════════════════════════
                  TAB — ENTREGA
              ══════════════════════════════════════════════════ */}
              {activeTab === "entrega" && (
                <>
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                      <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                        <Package className="h-6 w-6 text-[hsl(var(--muted-foreground))]/30" />
                      </div>
                      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Aguardando entrega do editor</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]/50">O editor ainda não enviou arquivos para esta tarefa.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

                      {/* Player */}
                      <div className="bg-black relative shrink-0">
                        {selected && isVideo(selected) && (
                          <VideoPlayer key={selected.id} src={streamUrl(selected)}
                            reviewMode={reviewMode && canReview}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick}
                            onCapture={reviewMode && canReview ? handleCapture : () => {}} />
                        )}
                        {selected && isAudio(selected) && (
                          <AudioPlayer key={selected.id} src={streamUrl(selected)} fileName={selected.fileName}
                            reviewMode={reviewMode && canReview}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick}
                            onCapture={reviewMode && canReview ? handleCapture : () => {}} />
                        )}

                        {/* Frame capture overlay */}
                        {capturedFrame && reviewMode && canReview && (
                          <div className="absolute inset-0 flex items-center justify-center z-20"
                            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}>
                            <div className="bg-[hsl(var(--card))] rounded-2xl overflow-hidden w-80 shadow-2xl border border-[hsl(var(--border))]">
                              {capturedFrame.dataUrl
                                ? <img src={capturedFrame.dataUrl} alt="frame" className="w-full block" />
                                : <div className="w-full h-20 bg-[hsl(var(--muted))]/40 flex items-center justify-center"><AudioLines className="h-5 w-5 text-[hsl(var(--muted-foreground))]/30" /></div>}
                              <div className="p-3 space-y-2.5">
                                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">⏱ {fmtTime(capturedFrame.time)}</p>
                                <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Escape") setCapturedFrame(null); }}
                                  placeholder="Descreva o que precisa ser alterado…"
                                  className="w-full text-sm resize-none border border-[hsl(var(--border))] rounded-xl p-2.5 bg-[hsl(var(--muted))]/30 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                  rows={3} autoFocus />
                                <div className="flex gap-2">
                                  <button onClick={() => setCapturedFrame(null)} className="flex-1 py-2 rounded-xl border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Cancelar</button>
                                  <button onClick={saveComment} disabled={!commentBody.trim()} className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-40">Salvar</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* File info bar */}
                      {selected && (
                        <div className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border))] flex items-center gap-2.5 bg-[hsl(var(--muted))]/20">
                          <div className="h-6 w-6 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                            {isVideo(selected) ? <Film className="h-3 w-3 text-violet-500" /> : <Music className="h-3 w-3 text-violet-500" />}
                          </div>
                          <p className="text-xs font-medium truncate flex-1">{selected.fileName}</p>
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50 shrink-0">{fmtSize(selected.fileSize)}</span>
                          <a href={downloadUrl(selected)} download={selected.fileName}
                            className="shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                            <Download className="h-3 w-3" />Baixar
                          </a>
                          <button onClick={() => removeFile(selected.id)}
                            className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/25 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {/* Approved banner */}
                      {isApproved && (
                        <div className="shrink-0 px-4 py-2 border-b border-emerald-200/60 dark:border-emerald-800/30 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center gap-2">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Material aprovado</p>
                          <span className="text-[10px] text-emerald-600/60 ml-1">{fmtDate(task.updatedAt)}</span>
                        </div>
                      )}

                      {/* Review toolbar — coordinator when status = review */}
                      {canReview && !confirmApprove && (
                        <div className="shrink-0 px-4 py-2.5 border-b border-[hsl(var(--border))] flex items-center gap-2 bg-[hsl(var(--muted))]/10">
                          <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden text-[11px] font-semibold">
                            <button
                              onClick={() => { setReviewMode(false); setPendingComments([]); setCapturedFrame(null); }}
                              className={`px-3 py-1.5 transition-colors ${!reviewMode ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
                              Visualizar
                            </button>
                            <button
                              onClick={() => setReviewMode(true)}
                              className={`px-3 py-1.5 border-l border-[hsl(var(--border))] transition-colors ${reviewMode ? "bg-amber-500 text-white" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
                              Revisar frames
                            </button>
                          </div>
                          <div className="flex-1" />
                          {reviewMode && pendingComments.length > 0 && (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">
                              {pendingComments.length} coment.
                            </span>
                          )}
                          {reviewMode && (
                            <button onClick={handleSubmitBatch} disabled={submitting || pendingComments.length === 0}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold rounded-lg disabled:opacity-40 transition-colors shrink-0">
                              <Send className="h-3 w-3" />
                              {submitting ? "Enviando…" : "Enviar ao editor"}
                            </button>
                          )}
                          <button onClick={() => setConfirmApprove(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-lg transition-colors shrink-0">
                            <CheckCircle className="h-3 w-3" />Aprovar
                          </button>
                        </div>
                      )}

                      {/* Approve confirmation inline */}
                      {confirmApprove && canReview && (
                        <div className="shrink-0 px-4 py-2.5 border-b border-emerald-300/60 dark:border-emerald-800/30 bg-emerald-50/70 dark:bg-emerald-950/25 flex items-center gap-3">
                          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex-1">Confirmar aprovação? A tarefa será concluída e o editor notificado.</p>
                          <button onClick={() => setConfirmApprove(false)}
                            className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                            Cancelar
                          </button>
                          <button onClick={handleApprove} disabled={approving}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-lg disabled:opacity-60 transition-colors shrink-0">
                            {approving
                              ? <><Loader2 className="h-3 w-3 animate-spin" /><span>Aprovando…</span></>
                              : <><CheckCircle className="h-3 w-3" /><span>Confirmar</span></>}
                          </button>
                        </div>
                      )}

                      {/* Pending comments list (review mode) */}
                      {reviewMode && canReview && (
                        <div className="shrink-0 border-b border-amber-200/40 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10"
                          style={{ maxHeight: 132, overflowY: "auto" }}>
                          {pendingComments.length === 0 ? (
                            <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))]/50 py-3">
                              Pause o vídeo e clique <span className="font-medium text-amber-600 dark:text-amber-400">Marcar</span> para adicionar comentários
                            </p>
                          ) : pendingComments.map((c, i) => (
                            <div key={c.localId}
                              className={`flex items-start gap-2.5 px-4 py-2 ${i > 0 ? "border-t border-amber-200/20 dark:border-amber-800/15" : ""}`}>
                              <span className="shrink-0 text-[10px] font-bold text-amber-600 mt-0.5 w-4 tabular-nums">{i + 1}</span>
                              {c.thumbnailDataUrl && <img src={c.thumbnailDataUrl} className="h-8 w-[56px] rounded object-cover shrink-0 ring-1 ring-amber-400/30" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mb-0.5">{fmtTime(c.timestampSec)}</p>
                                <p className="text-xs text-[hsl(var(--foreground))]/80 leading-snug line-clamp-1">{c.body}</p>
                              </div>
                              <button onClick={() => removeComment(c.localId)}
                                className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))]/30 hover:text-red-500 transition-colors">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Scrollable section */}
                      <div className="flex-1 min-h-0 overflow-y-auto">

                        {/* Version pills (only when multiple revisions) */}
                        {revisionGroups.length > 1 && (
                          <div className="border-b border-[hsl(var(--border))] px-4 py-2.5 flex items-center gap-1 overflow-x-auto scrollbar-none">
                            {revisionGroups.map(([revNum, revFiles], idx) => {
                              const isActive = activeRev === revNum;
                              const approved = revFiles.some(f => f.approvedAt);
                              return (
                                <div key={revNum} className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => { setActiveRev(revNum); setSelected(revFiles[revFiles.length - 1]); }}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                      isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                                        : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
                                    {revLabel(revNum)}
                                    {approved && <CheckCircle2 className={`h-3 w-3 ${isActive ? "opacity-80" : "text-emerald-500"}`} />}
                                  </button>
                                  {idx < revisionGroups.length - 1 && <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/30" />}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Files in active revision (only when multiple) */}
                        {activeFiles.length > 1 && (
                          <div className="px-4 py-2 space-y-1 border-b border-[hsl(var(--border))]">
                            {activeFiles.map(f => (
                              <button key={f.id} onClick={() => { setSelected(f); setActiveRev(f.revisionNumber); }}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors ${
                                  f.id === selected?.id
                                    ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20"
                                    : "hover:bg-[hsl(var(--muted))]/50 border border-transparent"}`}>
                                {isVideo(f)
                                  ? <Clapperboard className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                                  : <AudioLines className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />}
                                <span className={`text-[11px] font-medium truncate flex-1 ${f.id === selected?.id ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>{f.fileName}</span>
                                {f.approvedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Previous batches (collapsible) */}
                        {batches.length > 0 && (
                          <div className="border-b border-[hsl(var(--border))]">
                            <button onClick={() => setBatchesOpen(v => !v)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[hsl(var(--muted))]/30 transition-colors">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Revisões enviadas</span>
                              <span className="ml-1 text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/40 dark:border-amber-800/30 px-1.5 py-0.5 rounded-full">{batches.length}</span>
                              <ChevronRight className={`h-3 w-3 text-[hsl(var(--muted-foreground))]/30 ml-auto transition-transform duration-150 ${batchesOpen ? "rotate-90" : ""}`} />
                            </button>
                            {batchesOpen && (
                              <div className="px-4 pb-3 space-y-2">
                                {batches.map(batch => (
                                  <div key={batch.id} className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                                    <div className="px-3 py-2 bg-[hsl(var(--muted))]/30 flex items-center gap-2">
                                      <span className="h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-950/50 border border-amber-300/70 dark:border-amber-700/60 flex items-center justify-center text-[10px] font-bold text-amber-600 shrink-0">{batch.revisionNumber}</span>
                                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{batch.revisionNumber}ª alteração</span>
                                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]/40 ml-auto">{fmtDate(batch.submittedAt)}</span>
                                    </div>
                                    {batch.comments.map((fc, ci) => (
                                      <button key={fc.id}
                                        onClick={() => handleMarkerClick(fc.timestampSec)}
                                        className={`w-full flex items-start gap-2.5 px-3 py-2 hover:bg-[hsl(var(--muted))]/40 transition-colors text-left ${ci > 0 ? "border-t border-[hsl(var(--border))]" : ""}`}>
                                        <span className="shrink-0 text-[10px] font-bold text-amber-500 mt-0.5 w-4 tabular-nums">{fc.orderIndex}</span>
                                        {fc.frameThumbnail
                                          ? <img src={fc.frameThumbnail} className="h-8 w-[56px] rounded object-cover shrink-0" />
                                          : <span className="shrink-0 h-8 w-[56px] rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 flex items-center justify-center text-[9px] font-mono text-amber-600">{fmtTime(fc.timestampSec)}</span>}
                                        <p className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))]/80 leading-snug pt-0.5">{fc.body}</p>
                                      </button>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ══════════════════════════════════════════════════
                  TAB 3 — ENVIO AO CLIENTE
                  "Fechar o loop"
              ══════════════════════════════════════════════════ */}
              {activeTab === "envio" && (
                <div className="p-5 space-y-5">

                  {/* Status */}
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isApproved ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/30" : "bg-[hsl(var(--muted))]/30 border-[hsl(var(--border))]"}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isApproved ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-[hsl(var(--muted))]"}`}>
                      <CheckCircle className={`h-4 w-4 ${isApproved ? "text-emerald-500" : "text-[hsl(var(--muted-foreground))]/30"}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isApproved ? "text-emerald-700 dark:text-emerald-400" : "text-[hsl(var(--muted-foreground))]"}`}>
                        {isApproved ? "Material aprovado" : "Aguardando aprovação"}
                      </p>
                      {isApproved && task.updatedAt && (
                        <p className="text-[11px] text-emerald-600/70 dark:text-emerald-500/60">{fmtDate(task.updatedAt)}</p>
                      )}
                    </div>
                  </div>

                  {/* Compartilhar arquivo */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Compartilhar arquivo com o cliente</p>
                    {approvedFile ? (
                      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 bg-[hsl(var(--muted))]/20">
                          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            {isVideo(approvedFile) ? <Film className="h-4 w-4 text-violet-500" /> : <Music className="h-4 w-4 text-violet-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{approvedFile.fileName}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmtSize(approvedFile.fileSize)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-[hsl(var(--border))] border-t border-[hsl(var(--border))]">
                          <a href={downloadUrl(approvedFile)} download={approvedFile.fileName}
                            className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium hover:bg-[hsl(var(--muted))]/50 transition-colors">
                            <Download className="h-3.5 w-3.5" />Baixar arquivo
                          </a>
                          {approvedFile.publicToken ? (
                            <button onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/p/${approvedFile.publicToken}`); toast.success("Link copiado"); }}
                              className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors">
                              <Link2 className="h-3.5 w-3.5" />Copiar link público
                            </button>
                          ) : (
                            <button onClick={() => generateLink(approvedFile.id)} disabled={sharing === approvedFile.id}
                              className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 transition-colors disabled:opacity-50">
                              <Link2 className="h-3.5 w-3.5" />
                              {sharing === approvedFile.id ? "Gerando…" : "Gerar link público"}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-6 rounded-xl border border-dashed border-[hsl(var(--border))] text-center">
                        <p className="text-sm text-[hsl(var(--muted-foreground))]/50">Nenhum arquivo disponível</p>
                      </div>
                    )}
                  </div>

                  {/* Pasta do projeto */}
                  {task.folderUrl && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Pasta do projeto</p>
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]">
                        <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]/50" />
                        <span className="flex-1 text-sm text-[hsl(var(--foreground))]/70 break-all leading-snug select-all text-xs">{task.folderUrl}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] transition-colors">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <a href={task.folderUrl} target="_blank" rel="noopener noreferrer"
                            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Brief do cliente */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Briefing</p>
                    <div className="rounded-xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                      {task.client && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Cliente</span>
                          <span className="text-xs font-medium">{task.client}</span>
                        </div>
                      )}
                      {task.dueDate && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Prazo</span>
                          <span className="text-xs font-medium">{fmtDate(task.dueDate)}</span>
                        </div>
                      )}
                      {task.createdBy && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Coordenador</span>
                          <span className="text-xs font-medium">{task.createdBy.name}</span>
                        </div>
                      )}
                      {task.editors?.length > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Editor</span>
                          <span className="text-xs font-medium">{task.editors.map(e => e.name).join(", ")}</span>
                        </div>
                      )}
                      {task.description && (
                        <div className="flex items-start gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0 mt-0.5">Nota</span>
                          <span className="text-xs text-[hsl(var(--foreground))]/70 leading-relaxed">{task.description}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

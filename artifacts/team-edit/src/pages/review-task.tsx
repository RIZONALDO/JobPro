import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { apiFetch, apiPost, apiPatch, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBreadcrumb } from "@/contexts/BreadcrumbContext";
import { useRealtime } from "@/hooks/use-realtime";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { fmtDate } from "@/lib/utils";
import {
  ArrowLeft, Film, Music, CheckCircle, Clock,
  RotateCcw, Play, Upload, FileVideo, GitCompareArrows,
  MoreHorizontal, Trash2, GripVertical, Layers, X, MessageSquare,
  ExternalLink, CalendarDays, User2, AlertCircle, Zap, Download, Copy, Folder, Link2,
  UserPlus, Search, Send, Check,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string; notes: string | null;
  revisionCount: number; dueDate: string | null; startDate: string | null;
  priority: string; complexity: string; folderUrl: string | null;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  coCoordinators?: Person[];
  taskType: string;
  parentTask: { id: number; taskCode: string; title: string } | null;
  unreadCommentCount: number;
}
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  revisionNumber: number; fileOrder: number | null; originalName: string | null; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null;
  thumbnailPath: string | null; proxyPath: string | null; hlsPath: string | null;
  processingStatus: string;
}

// ── InviteReviewerModal ───────────────────────────────────────────────────────

interface Coordinator { id: number; name: string; role: string; avatarUrl: string | null; }

function InviteReviewerModal({ taskId, taskTitle, onClose }: { taskId: number; taskTitle: string; onClose: () => void }) {
  const [coords, setCoords]       = useState<Coordinator[]>([]);
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [message, setMessage]     = useState("");
  const [sending, setSending]     = useState(false);

  useEffect(() => {
    apiFetch<Coordinator[]>("/api/coordinators").then(setCoords).catch(() => {});
  }, []);

  const filtered = coords.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: number) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSend = async () => {
    if (!selected.size) return;
    setSending(true);
    try {
      await apiFetch(`/api/tasks/${taskId}/invite-reviewer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected], message: message.trim() || undefined },
      )});
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

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[hsl(var(--border))]">
          <UserPlus className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Convidar para revisão</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/50 truncate">{taskTitle}</p>
          </div>
          <button onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]/60 transition-colors">
            <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]/60" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 h-8">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar coordenador…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]/40" />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-6">Nenhum coordenador encontrado</p>
          ) : filtered.map(c => {
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

        {/* Mensagem */}
        <div className="px-4 pb-3 border-t border-[hsl(var(--border))] pt-3">
          <textarea
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Mensagem opcional para o convite…"
            rows={2}
            className="w-full text-xs rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 outline-none resize-none placeholder:text-[hsl(var(--muted-foreground))]/40 focus:border-[hsl(var(--primary))]/50 transition-colors" />
        </div>

        {/* Footer */}
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

// ── VersionManagerModal ───────────────────────────────────────────────────────

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VersionManagerModal({ taskId, versions, onClose, onSaved }: {
  taskId: number;
  versions: TaskFile[];
  onClose: () => void;
  onSaved: (orderedIds: number[]) => void;
}) {
  const [items, setItems] = useState<TaskFile[]>([...versions]);
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const isDirty = items.map(i => i.id).join(",") !== versions.map(i => i.id).join(",");

  const onDragStart = (i: number) => { setDragFrom(i); };
  const onDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i); };
  const onDrop      = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragFrom === null || dragFrom === i) { setDragFrom(null); setDragOver(null); return; }
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragFrom, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragFrom(null);
    setDragOver(null);
  };
  const onDragEnd = () => { setDragFrom(null); setDragOver(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/files/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ order: items.map(i => i.id) }),
      });
      if (!res.ok) throw new Error();
      onSaved(items.map(i => i.id));
      onClose();
    } catch { toast.error("Erro ao salvar ordem"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "hsl(var(--card))", maxHeight: "80vh" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[hsl(var(--border))]">
          <Layers className="h-4 w-4 text-[hsl(var(--muted-foreground))]/60 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Gerenciar versões</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]/50 truncate">{versions[0]?.fileName}</p>
          </div>
          <button onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]/60 transition-colors shrink-0">
            <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]/60" />
          </button>
        </div>

        {/* Instrução */}
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]/40 px-5 py-2.5 border-b border-[hsl(var(--border))]">
          Arraste para reordenar · a última posição é exibida como versão atual
        </p>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {items.map((v, i) => {
            const isLatest = i === items.length - 1;
            return (
              <div key={v.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={e => onDragOver(e, i)}
                onDrop={e => onDrop(e, i)}
                onDragEnd={onDragEnd}
                className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/50 cursor-grab active:cursor-grabbing select-none transition-colors"
                style={{
                  opacity: dragFrom === i ? 0.35 : 1,
                  background: dragOver === i && dragFrom !== i ? "hsl(var(--primary)/0.08)" : undefined,
                  borderLeft: dragOver === i && dragFrom !== i ? "2px solid hsl(var(--primary))" : undefined,
                }}>
                <GripVertical className="h-4 w-4 text-[hsl(var(--muted-foreground))]/25 shrink-0" />
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: isLatest ? "hsl(var(--primary))" : "rgba(255,255,255,0.08)",
                    color: isLatest ? "#fff" : "hsl(var(--muted-foreground))",
                  }}>
                  V{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))]/80 truncate">
                    {v.originalName ?? v.fileName}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]/40">
                    {fmtDate(v.createdAt)}{v.fileSize ? ` · ${fmtSize(v.fileSize)}` : ""}
                    {v.approvedAt && <span className="ml-1.5 text-emerald-400">✓ Aprovado</span>}
                  </p>
                </div>
                {isLatest && (
                  <span className="text-[10px] font-semibold text-[hsl(var(--primary))]/70 shrink-0">atual</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-colors"
            style={{ background: "hsl(var(--primary))" }}>
            {saving ? "Salvando…" : "Salvar ordem"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── EmptyCard — estado vazio idêntico ao VideoCard com drag-and-drop ─────────

function EmptyCard({ taskId, task, isEditor, uploading, uploadProgress, onClickUpload, onDrop, integrated = false }: {
  taskId: number; task: TaskDetail; isEditor: boolean; uploading: boolean;
  uploadProgress: number | null;
  onClickUpload: () => void;
  onDrop: (e: React.ChangeEvent<HTMLInputElement>) => void;
  integrated?: boolean;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const dragCount = useRef(0);
  const inputRef  = useRef<HTMLInputElement>(null);

  const triggerBounce = () => {
    setBouncing(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setBouncing(true)));
    setTimeout(() => setBouncing(false), 600);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isEditor) return;
    e.preventDefault();
    dragCount.current += 1;
    if (dragCount.current === 1) { setIsDragOver(true); triggerBounce(); }
  };
  const handleDragOver  = (e: React.DragEvent) => { if (!isEditor) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCount.current -= 1;
    if (dragCount.current === 0) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCount.current = 0;
    setIsDragOver(false);
    if (!isEditor) return;
    const f = e.dataTransfer.files[0];
    if (!f?.type.match(/^(video|audio)\//)) { toast.error("Apenas vídeo ou áudio"); return; }
    // Cria um evento sintético compatível com o handler de upload
    const dt = new DataTransfer(); dt.items.add(f);
    const fakeEvt = { target: { files: dt.files, value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;
    onDrop(fakeEvt);
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden"
        onChange={e => { onDrop(e); }} />

      <div className={`group relative${bouncing ? " card-bounce" : ""}`}>
        <button
          onClick={() => isEditor && onClickUpload()}
          onDragEnter={handleDragEnter} onDragOver={handleDragOver}
          onDragLeave={handleDragLeave} onDrop={handleDrop}
          disabled={!isEditor || uploading}
          className={`w-full flex flex-col text-left focus:outline-none transition-all duration-200 disabled:cursor-default ${integrated ? "" : "rounded-xl overflow-hidden border focus:ring-2 focus:ring-[hsl(var(--primary))]/50"}`}
          style={integrated ? {
            boxShadow: isDragOver ? "inset 0 0 0 2px hsl(var(--primary)/0.4)" : undefined,
          } : {
            background: "rgba(255,255,255,0.05)",
            borderColor: isDragOver ? "hsl(var(--primary))" : "rgba(255,255,255,0.10)",
            boxShadow: isDragOver ? "0 0 0 2px hsl(var(--primary)/0.25)" : undefined,
          }}>

          {/* Thumbnail area */}
          <div className="relative w-full aspect-video bg-zinc-900 overflow-hidden flex items-center justify-center">
            {/* Progresso de upload */}
            {uploadProgress !== null && (
              <div className="absolute inset-0 flex items-center justify-center z-10"
                style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}>
                {(() => {
                  const r = 26, circ = 2 * Math.PI * r;
                  const dash = circ - (uploadProgress / 100) * circ;
                  return (
                    <div className="relative flex items-center justify-center">
                      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                        <circle cx="36" cy="36" r={r} fill="none" stroke="white" strokeWidth="4"
                          strokeDasharray={circ} strokeDashoffset={dash}
                          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.2s ease" }} />
                      </svg>
                      <span className="absolute text-sm font-bold text-white tabular-nums">
                        {uploadProgress}%
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}
            {isDragOver ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                style={{ background: "hsl(var(--primary)/0.18)", backdropFilter: "blur(4px)" }}>
                <Upload className="h-7 w-7" style={{ color: "hsl(var(--primary))" }} />
                <span className="text-[12px] font-semibold" style={{ color: "hsl(var(--primary))" }}>Soltar para enviar</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 select-none">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center border border-white/10"
                  style={{ background: "rgba(255,255,255,0.04)" }}>
                  {isEditor
                    ? <Upload className="h-5 w-5 text-white/30" />
                    : <Film   className="h-5 w-5 text-white/20" />}
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-white/40">
                    {isEditor ? "Enviar para revisão" : "Aguardando entrega"}
                  </p>
                  <p className="text-[10px] text-white/20 mt-0.5">
                    {isEditor ? "Clique ou arraste o arquivo aqui" : "Aguardando entrega do editor"}
                  </p>
                </div>
              </div>
            )}
          </div>

        {/* Footer vazio — mantém espaço proporcional ao card (não necessário em modo integrado) */}
        {!integrated && <div className="h-12" />}
        </button>
      </div>

    </div>
  );
}

// ── VideoCard ─────────────────────────────────────────────────────────────────

const CARD_BOUNCE_STYLE = `
@keyframes cardBounce {
  0%,100% { transform: scale(1); }
  30%      { transform: scale(1.035); }
  60%      { transform: scale(0.975); }
  80%      { transform: scale(1.015); }
}
.card-bounce { animation: cardBounce 0.55s ease-out; }
`;

interface CommentCount { total: number; unresolved: number; }

function VideoCard({ file, taskId, task, versionCount, allVersions, prevFileId, isCoord, isEditor, uploadProgress, commentCount, unreadCount, onDropNewVersion, onDeleteVersion, onManageVersions, onApprove, onClick, integrated = false }: {
  file: TaskFile; taskId: number; task: TaskDetail;
  versionCount: number;
  allVersions: TaskFile[];
  prevFileId: number | null;
  isCoord: boolean;
  isEditor: boolean;
  uploadProgress: number | null;
  commentCount: CommentCount | null;
  unreadCount: number;
  onDropNewVersion: (f: File) => void;
  onDeleteVersion: () => void;
  onManageVersions: () => void;
  onApprove: () => void;
  onClick: () => void;
  integrated?: boolean;
}) {
  const [, navigate] = useLocation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [canvasThumb, setCanvasThumb] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const dragCount = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playPromise = useRef<Promise<void> | null>(null);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isVideo    = !!file.mimeType?.startsWith("video/");
  const isAudio    = !!file.mimeType?.startsWith("audio/");
  const isReady    = file.processingStatus === "ready";

  const hasServerThumb = !!file.thumbnailPath;

  // Captura primeiro frame disponível via canvas — sem seek, sem aguardar buffer
  const captureFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || hasServerThumb || canvasThumb || v.videoWidth === 0) return;
    try {
      const scale = Math.min(1, 640 / v.videoWidth);
      const c = document.createElement("canvas");
      c.width  = v.videoWidth  * scale;
      c.height = v.videoHeight * scale;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.75);
      if (dataUrl.length > 1000) setCanvasThumb(dataUrl); // descarta frames pretos/vazios
    } catch {}
  }, [hasServerThumb, canvasThumb]);
  // Hover usa proxy 360p (leve); fallback para stream original
  // Hover: proxy 360p só quando pronto, senão stream original
  const hoverUrl = file.proxyPath && isReady
    ? `/api/tasks/${taskId}/files/${file.id}/proxy/stream`
    : `/api/tasks/${taskId}/files/${file.id}/stream`;
  // Thumbnail: sempre mostra quando disponível, independente do status de transcodificação
  const thumbUrl = file.thumbnailPath
    ? `/api/tasks/${taskId}/files/${file.id}/thumbnail`
    : null;

  // Cancela timer e encadeia pause na promise de play ao desmontar
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      const v = videoRef.current;
      if (!v) return;
      if (playPromise.current) {
        playPromise.current.then(() => v.pause()).catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
    };
  }, []);

  const stopVideo = (v: HTMLVideoElement) => {
    const p = playPromise.current;
    if (p) {
      p.then(() => {
        v.pause();
        v.currentTime = Math.max(0, (v.duration || 0) * 0.1);
      }).catch(() => {});
      playPromise.current = null;
    } else {
      v.pause();
      v.currentTime = Math.max(0, (v.duration || 0) * 0.1);
    }
  };

  const onMouseEnter = () => {
    if (!isVideo) return;
    hoverTimer.current = setTimeout(() => {
      setHovering(true);
      const v = videoRef.current;
      if (v && isVideo) {
        // Não reseta currentTime — o vídeo já está na posição do thumbnail (10%)
        // e essa posição já está em buffer. Resetar para 0 forçaria download extra → tela preta.
        playPromise.current = v.play() ?? null;
        playPromise.current?.catch(() => { playPromise.current = null; });
      }
    }, 180);
  };
  const onMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovering(false);
    const v = videoRef.current;
    if (v) stopVideo(v);
  };

  const statusBadge = () => {
    if (file.approvedAt)                return { label: "Aprovado",           cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
    if (task.status === "review")       return { label: "Aguardando revisão", cls: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
    if (task.status === "completed")    return { label: "Concluído",          cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
    return { label: "Em progresso", cls: "bg-sky-500/15 text-sky-400 border-sky-500/20" };
  };
  const badge = statusBadge();

  const triggerBounce = () => {
    setBouncing(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setBouncing(true)));
    setTimeout(() => setBouncing(false), 600);
  };

  const canDropNewVersion = isEditor && task.status !== "completed";

  const handleDragEnter = (e: React.DragEvent) => {
    if (!canDropNewVersion) return;
    e.preventDefault();
    dragCount.current += 1;
    if (dragCount.current === 1) { setIsDragOver(true); triggerBounce(); }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!canDropNewVersion) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCount.current -= 1;
    if (dragCount.current === 0) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCount.current = 0;
    setIsDragOver(false);
    if (!canDropNewVersion) return;
    const f = e.dataTransfer.files[0];
    if (!f?.type.match(/^(video|audio)\//)) { toast.error("Apenas vídeo ou áudio"); return; }
    onDropNewVersion(f);
  };

  // Cascata lateral ortogonal — deslocamento puro X+Y, todos do mesmo tamanho
  const stackDepth = Math.min(versionCount - 1, 2);
  const offset = 4; // px por camada

  return (
    <div className="relative" style={integrated ? {} : { paddingRight: stackDepth * offset, paddingBottom: stackDepth * offset }}>
      {/* Stack layers — ocultos em modo integrado */}
      {!integrated && stackDepth >= 2 && (
        <div className="absolute rounded-xl"
          style={{
            top: 0, left: 0,
            right: stackDepth * offset,
            bottom: stackDepth * offset,
            transform: `translateX(${offset * 2}px) translateY(${offset * 2}px)`,
            background: "rgba(255,255,255,0.022)",
            border: "1px solid rgba(255,255,255,0.07)",
            zIndex: 0,
          }} />
      )}
      {!integrated && stackDepth >= 1 && (
        <div className="absolute rounded-xl"
          style={{
            top: 0, left: 0,
            right: stackDepth * offset,
            bottom: stackDepth * offset,
            transform: `translateX(${offset}px) translateY(${offset}px)`,
            background: "rgba(255,255,255,0.040)",
            border: "1px solid rgba(255,255,255,0.10)",
            zIndex: 1,
          }} />
      )}

      {/* Main card */}
      <div className={`group relative${bouncing ? " card-bounce" : ""}`} style={{ zIndex: 2 }}>
        <button onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
          onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          className={`w-full flex flex-col text-left focus:outline-none transition-all duration-200 ${integrated ? "" : "rounded-xl overflow-hidden border focus:ring-2 focus:ring-[hsl(var(--primary))]/50"}`}
          style={integrated ? {
            boxShadow: isDragOver ? "inset 0 0 0 2px hsl(var(--primary)/0.4)" : undefined,
          } : {
            background: "rgba(255,255,255,0.05)",
            borderColor: isDragOver ? "hsl(var(--primary))" : "rgba(255,255,255,0.10)",
            boxShadow: isDragOver ? "0 0 0 2px hsl(var(--primary)/0.25)" : undefined,
          }}>

        {/* Thumbnail / preview */}
        <div className="relative w-full aspect-video bg-zinc-900 overflow-hidden">
          {/* Hover preview — proxy 360p quando pronto, senão stream original */}
          {isVideo && (
            <video ref={videoRef} src={hoverUrl} preload="metadata" muted playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: hovering ? 1 : 0, transition: "opacity 0.25s" }}
              onLoadedData={captureFrame}
              onLoadedMetadata={e => setVideoDuration((e.currentTarget as HTMLVideoElement).duration || null)} />
          )}
          {/* Thumbnail: servidor (pronto) ou canvas (capturado no cliente enquanto processa) */}
          {(thumbUrl || canvasThumb) && (
            <img src={thumbUrl ?? canvasThumb!} alt={file.originalName ?? file.fileName}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: hovering ? 0 : 1, transition: "opacity 0.25s" }} />
          )}
          {/* Placeholder — cover de áudio ou ícone simples para vídeo */}
          {!thumbUrl && !canvasThumb && !hovering && (
            isAudio ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                style={{ background: "radial-gradient(ellipse at 50% 38%, hsl(var(--primary)/0.18) 0%, transparent 65%), #08080d" }}>
                <div className="flex items-center justify-center"
                  style={{ width: 44, height: 44, borderRadius: 11, background: "hsl(var(--primary)/0.10)", border: "1px solid hsl(var(--primary)/0.22)" }}>
                  <Music className="h-5 w-5" style={{ color: "hsl(var(--primary))", opacity: 0.7 }} />
                </div>
                <p className="text-[10px] text-white/25 font-medium px-3 text-center truncate w-full">
                  {file.originalName ?? file.fileName}
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {isVideo
                  ? <Film className="h-10 w-10 text-white/15" />
                  : <FileVideo className="h-10 w-10 text-white/15" />}
              </div>
            )
          )}
          {/* Badge sutil "processando" — não bloqueia o card */}
          {file.processingStatus === "processing" && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md"
              style={{ background: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)" }}>
              <div className="h-2 w-2 rounded-full border border-white/30 border-t-white/80 animate-spin" />
              <span className="text-[9px] font-medium text-white/60 leading-none">Otimizando…</span>
            </div>
          )}
          <div className="absolute inset-0"
            style={{ opacity: hovering ? 0 : 1, transition: "opacity 0.2s", background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 55%)" }}>
            {!hovering && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-11 w-11 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}>
                  <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                </div>
              </div>
            )}
          </div>

          {/* Version badge — top left — only when there are multiple versions */}
          {versionCount > 1 && (
            <div className="absolute top-2 left-2">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[hsl(var(--primary))] text-white">
                V{versionCount}
              </span>
            </div>
          )}

          {/* Approved: check + botão de download ao hover */}
          {file.approvedAt && (
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <a
                href={`/api/tasks/${taskId}/files/${file.id}/download`}
                download={file.originalName ?? file.fileName}
                onClick={e => e.stopPropagation()}
                className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
                title="Baixar versão aprovada">
                <Download className="h-3.5 w-3.5 text-white/80" />
              </a>
              <CheckCircle className="h-5 w-5 text-emerald-400 drop-shadow-lg" />
            </div>
          )}


          {/* Drag-over overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-t-xl"
              style={{ background: "hsl(var(--primary)/0.18)", backdropFilter: "blur(4px)" }}>
              <Upload className="h-7 w-7" style={{ color: "hsl(var(--primary))" }} />
              <span className="text-[12px] font-semibold" style={{ color: "hsl(var(--primary))" }}>
                Soltar para nova versão
              </span>
            </div>
          )}

          {/* Progresso circular de upload */}
          {uploadProgress !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-t-xl"
              style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}>
              {(() => {
                const r = 26, circ = 2 * Math.PI * r;
                const dash = circ - (uploadProgress / 100) * circ;
                return (
                  <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                    <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                    <circle cx="36" cy="36" r={r} fill="none" stroke="white" strokeWidth="4"
                      strokeDasharray={circ} strokeDashoffset={dash}
                      strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.2s ease" }} />
                  </svg>
                );
              })()}
              <span className="absolute text-sm font-bold text-white tabular-nums">
                {uploadProgress < 100 ? `${uploadProgress}%` : "✓"}
              </span>
            </div>
          )}
        </div>

        {/* Footer: título + balão de comentários + duração */}
        <div className="px-3 py-2.5 flex items-center gap-2">
          <p className="text-xs font-medium text-white/70 truncate leading-snug flex-1">
            {file.originalName ?? file.fileName}
          </p>
          {commentCount && (
            <div className="relative shrink-0">
              <MessageSquare
                className="h-4 w-4 shrink-0"
                style={unreadCount > 0
                  ? { fill: "rgba(239,68,68,0.18)", stroke: "#ef4444" }
                  : { fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.25)" }}
              />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-[3px] rounded-full flex items-center justify-center font-bold text-white leading-none"
                  style={{ background: "#ef4444", fontSize: "7px" }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
          )}
          {videoDuration != null && (
            <span className="text-[10px] font-mono text-white/30 shrink-0">
              {Math.floor(videoDuration / 60)}:{String(Math.floor(videoDuration % 60)).padStart(2, "0")}
            </span>
          )}
        </div>
        </button>

        {/* Menu ⋯ — editor e coordenador */}
        {(isEditor || isCoord) && !file.approvedAt && (
          <>
            {isEditor && (
              <input ref={versionInputRef} type="file" accept="video/*,audio/*" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onDropNewVersion(f);
                  e.target.value = "";
                }} />
            )}
            <div ref={menuRef} className="absolute top-2 right-2" style={{ zIndex: 10 }}>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
                className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                <MoreHorizontal className="h-3.5 w-3.5 text-white/80" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-48 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                  style={{ background: "hsl(var(--card))", top: "100%" }}>

                  {/* Editor: importar nova versão */}
                  {isEditor && (
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(false); versionInputRef.current?.click(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[hsl(var(--foreground))]/70 hover:bg-[hsl(var(--muted))]/60 transition-colors">
                      <Upload className="h-3.5 w-3.5 shrink-0" />
                      Importar versão
                    </button>
                  )}

                  {/* Ambos: gerenciar versões */}
                  {allVersions.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(false); onManageVersions(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[hsl(var(--foreground))]/70 hover:bg-[hsl(var(--muted))]/60 transition-colors">
                      <Layers className="h-3.5 w-3.5 shrink-0" />
                      Gerenciar versões
                    </button>
                  )}

                  {/* Coordenador: aprovar */}
                  {isCoord && (
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(false); onApprove(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                      <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                      Aprovar entrega
                    </button>
                  )}

                  {/* Editor ou coord: excluir versão atual */}
                  {(isEditor || isCoord) && (() => {
                    const hasComments = (commentCount?.total ?? 0) > 0;
                    return (
                      <>
                        <div className="mx-3 my-1 border-t border-white/8" />
                        <button
                          disabled={hasComments}
                          title={hasComments ? "Não é possível excluir uma versão que já tem comentários" : undefined}
                          onClick={e => {
                            e.stopPropagation();
                            setMenuOpen(false);
                            if (confirm("Remover esta versão? Esta ação não pode ser desfeita.")) {
                              onDeleteVersion();
                            }
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-red-400 hover:bg-red-500/10 disabled:hover:bg-transparent">
                          <Trash2 className="h-3.5 w-3.5 shrink-0" />
                          Excluir versão
                        </button>
                      </>
                    );
                  })()}

                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── AssetPanel ────────────────────────────────────────────────────────────────

function AssetPanel({ taskId, task, assets, files, isEditor, isOwner, uploadProgressMap, commentCounts, onUpload, onDropNewVersion, onDeleteVersion, onManageVersions, onApprove, onNavigate }: {
  taskId: number;
  task: TaskDetail;
  assets: Array<{ latest: TaskFile; allVersions: TaskFile[]; prevFileId: number | null; versionCount: number }>;
  files: TaskFile[];
  isEditor: boolean;
  isOwner: boolean;
  uploadProgressMap: Record<string, number>;
  commentCounts: Record<number, CommentCount>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDropNewVersion: (fileName: string, file: File) => void;
  onDeleteVersion: (fileId: number, fileName: string) => void;
  onManageVersions: (versions: TaskFile[]) => void;
  onApprove: (fileId: number) => void;
  onNavigate: (fileId: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      className="shrink-0 w-[360px]"
      onSubmit={e => e.preventDefault()}
    >
      <input ref={fileInputRef} type="file" accept="video/*,audio/*" className="hidden"
        disabled={!isEditor} onChange={onUpload} />

      {/* Card unificado vertical */}
      <div className="rounded-xl overflow-hidden border" style={{ background: "hsl(var(--card))", borderColor: "rgba(255,255,255,0.10)" }}>

        {/* Área do ativo */}
        {files.length === 0 ? (
          <EmptyCard
            taskId={taskId} task={task} isEditor={isEditor} uploading={false}
            uploadProgress={uploadProgressMap["__first__"] ?? null}
            onClickUpload={() => fileInputRef.current?.click()}
            onDrop={onUpload}
            integrated
          />
        ) : (
          <div className="flex flex-col">
            {assets.length > 1 && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 px-4 pt-3 pb-1">
                {assets.length} ativos
              </p>
            )}
            {assets.map(({ latest, allVersions, prevFileId, versionCount }) => {
              const totalComments = allVersions.reduce((s, v) => s + (commentCounts[v.id]?.total ?? 0), 0);
              const assetCount = totalComments > 0
                ? { total: totalComments, unresolved: commentCounts[latest.id]?.unresolved ?? 0 }
                : null;
              const unreadCount = task.unreadCommentCount ?? 0;
              return (
                <VideoCard key={latest.id} file={latest} taskId={taskId} task={task}
                  versionCount={versionCount} allVersions={allVersions}
                  prevFileId={prevFileId} isCoord={isOwner} isEditor={isEditor}
                  uploadProgress={uploadProgressMap[latest.fileName] ?? null}
                  commentCount={assetCount && assetCount.total > 0 ? assetCount : null}
                  unreadCount={unreadCount}
                  onDropNewVersion={f => onDropNewVersion(latest.fileName, f)}
                  onDeleteVersion={() => onDeleteVersion(latest.id, latest.fileName)}
                  onManageVersions={() => onManageVersions(allVersions)}
                  onApprove={() => onApprove(latest.id)}
                  onClick={() => onNavigate(latest.id)}
                  integrated />
              );
            })}
          </div>
        )}

        {/* Metadados da tarefa */}
        <TaskMeta task={task} isEditor={isEditor} />
      </div>
    </form>
  );
}

// ── TaskMeta — metadados abaixo do card de ativos ────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa" };
const COMPLEXITY_LABEL: Record<string, string> = { high: "Alta", medium: "Média", low: "Simples" };

const PRIORITY_CLS: Record<string, string> = {
  high:   "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};
const COMPLEXITY_CLS: Record<string, string> = {
  high:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  medium: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  low:    "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.split("\n").length > 4 || text.length > 220;
  return (
    <div>
      <p className={`text-[12px] text-[hsl(var(--foreground))]/60 leading-snug whitespace-pre-wrap ${!expanded && needsExpand ? "line-clamp-4" : ""}`}>
        {text}
      </p>
      {needsExpand && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[10px] font-semibold text-[hsl(var(--primary))]/70 hover:text-[hsl(var(--primary))] transition-colors">
          {expanded ? "Ver menos ▲" : "Ver mais ▼"}
        </button>
      )}
    </div>
  );
}

function SlateCell({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 px-3 py-2 border-r border-b border-[hsl(var(--border))]/60 last:border-r-0 ${className}`}>
      <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/45 leading-none">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TaskMeta({ task, isEditor }: { task: TaskDetail; isEditor: boolean }) {
  return (
    <div className="border-t border-[hsl(var(--border))]">

      {/* Grade tipo claquete — 2 colunas */}
      <div className="grid grid-cols-2">

        {task.client && (
          <SlateCell label="Cliente" className="col-span-2 border-r-0">
            <span className="text-[13px] font-bold text-[hsl(var(--foreground))]/80">{task.client}</span>
          </SlateCell>
        )}

        {task.startDate && (
          <SlateCell label="Início">
            <span className="text-[12px] font-medium text-[hsl(var(--foreground))]/65">{fmtDate(task.startDate)}</span>
          </SlateCell>
        )}

        {task.dueDate && (
          <SlateCell label="Prazo" className="border-r-0">
            <span className="text-[12px] font-medium text-[hsl(var(--foreground))]/65">{fmtDate(task.dueDate)}</span>
          </SlateCell>
        )}

        {isEditor ? (
          task.createdBy && (
            <SlateCell label={`Coord.${(task.coCoordinators?.length ?? 0) > 0 ? ` (${1 + (task.coCoordinators?.length ?? 0)})` : ""}`} className="col-span-2 border-r-0">
              <div className="flex items-center" style={{ gap: 0 }} onClick={e => e.stopPropagation()}>
                {[task.createdBy, ...(task.coCoordinators ?? [])].slice(0, 4).map((c, i) => (
                  <div key={c.id} style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 4 - i }}>
                    <ChatAvatarButton userId={c.id} name={c.name} avatarUrl={c.avatarUrl} size={22}
                      taskId={task.id} taskCode={task.taskCode} taskTitle={task.title} />
                  </div>
                ))}
                {(task.coCoordinators?.length ?? 0) === 0 && (
                  <span className="text-[12px] font-medium text-[hsl(var(--foreground))]/65 ml-1.5">{task.createdBy.name}</span>
                )}
              </div>
            </SlateCell>
          )
        ) : (() => {
          const coordId = task.createdBy?.id;
          const all: Person[] = [];
          if (task.assignedTo) all.push(task.assignedTo);
          task.editors.forEach(e => {
            if (e.id !== coordId && !all.find(a => a.id === e.id)) all.push(e);
          });
          if (!all.length) return null;
          return (
            <SlateCell label={all.length === 1 ? "Editor" : "Editores"} className="col-span-2 border-r-0">
              <div className="flex items-center gap-2 flex-wrap">
                {all.map(e => (
                  <div key={e.id} className="flex items-center gap-1.5">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={18} />
                    <span className="text-[12px] font-medium text-[hsl(var(--foreground))]/65">{e.name}</span>
                  </div>
                ))}
              </div>
            </SlateCell>
          );
        })()}

        <SlateCell label="Prioridade">
          <span className={`inline-flex text-[11px] font-bold px-2 py-0.5 rounded-full border ${PRIORITY_CLS[task.priority] ?? PRIORITY_CLS.low}`}>
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </span>
        </SlateCell>

        <SlateCell label="Complexidade" className="border-r-0">
          <span className={`inline-flex text-[11px] font-bold px-2 py-0.5 rounded-full border ${COMPLEXITY_CLS[task.complexity] ?? COMPLEXITY_CLS.low}`}>
            {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
          </span>
        </SlateCell>

        {task.revisionCount > 0 && (
          <SlateCell label="Revisões" className="col-span-2 border-r-0">
            <span className="flex items-center gap-1 text-[12px] font-bold text-amber-400">
              <RotateCcw className="h-3 w-3" />{task.revisionCount}
            </span>
          </SlateCell>
        )}

        {task.description && (
          <SlateCell label="Briefing" className="col-span-2 border-r-0">
            <ExpandableText text={task.description} />
          </SlateCell>
        )}

        {task.notes && (
          <SlateCell label="Notas" className="col-span-2 border-r-0">
            <ExpandableText text={task.notes} />
          </SlateCell>
        )}

        {task.folderUrl && (
          <SlateCell label="Pasta" className="col-span-2 border-r-0 border-b-0">
            <div className="flex items-start gap-1.5 min-w-0">
              <Folder className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/35 shrink-0 mt-px" />
              <span className="text-[11px] text-[hsl(var(--foreground))]/55 break-all leading-snug flex-1 min-w-0 font-mono">
                {task.folderUrl}
              </span>
              <button
                onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))]/35 hover:text-[hsl(var(--foreground))]/60 hover:bg-[hsl(var(--muted))]/60 transition-colors"
                title="Copiar caminho">
                <Copy className="h-2.5 w-2.5" />
              </button>
            </div>
          </SlateCell>
        )}
      </div>
    </div>
  );
}

// ── ReviewTaskPage ────────────────────────────────────────────────────────────

export default function ReviewTaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [, navigate] = useLocation();
  const { user }    = useAuth();
  const { set: setBreadcrumb, clear: clearBreadcrumb } = useBreadcrumb();

  const [task, setTask]       = useState<TaskDetail | null>(null);
  const [files, setFiles]     = useState<TaskFile[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<number, CommentCount>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressMap, setUploadProgressMap] = useState<Record<string, number>>({});
  const [manageVersions, setManageVersions] = useState<TaskFile[] | null>(null);

  const id = parseInt(taskId);
  const isEditor  = user?.role === "editor";
  const isOwner   = !isEditor && !!user && task?.createdBy?.id === user.id;
  const [inviteOpen, setInviteOpen] = useState(false);

  const fetchFiles = useCallback(() => {
    apiFetch<TaskFile[]>(`/api/tasks/${id}/files`).then(setFiles).catch(() => {});
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${id}`),
      apiFetch<TaskFile[]>(`/api/tasks/${id}/files`).catch(() => [] as TaskFile[]),
      apiFetch<Record<number, CommentCount>>(`/api/tasks/${id}/review-comments/counts`).catch(() => ({})),
    ]).then(([t, f, counts]) => { setTask(t); setFiles(f); setCommentCounts(counts); })
      .catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [id]);

  // Refaz fetch de arquivos quando o pipeline de transcodificação broadcastar
  useRealtime({ onTasksChanged: fetchFiles });

  useEffect(() => {
    if (!task) return;
    const actions = (
      <div className="flex items-center gap-1.5">
        {isOwner && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/70 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            <UserPlus className="h-3 w-3" />
            Convidar
          </button>
        )}
        <button
          onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copiado!"); }}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/70 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/60 transition-colors"
          title="Copiar link de revisão">
          <Link2 className="h-3 w-3" />
          Compartilhar
        </button>
      </div>
    );
    setBreadcrumb([
      ...(task.taskCode ? [{ label: task.taskCode, mono: true, muted: true }] : []),
      { label: task.title },
    ], undefined, "/tasks", actions);
    return () => clearBreadcrumb();
  }, [task?.id, task?.title, task?.taskCode]);

  // Group files by fileName — files with the same name are versions of the same asset.
  // Within each group, sort by revisionNumber asc then createdAt asc so latest is last.
  const assets = useMemo(() => {
    const map = new Map<string, TaskFile[]>();
    files.forEach(f => {
      if (!map.has(f.fileName)) map.set(f.fileName, []);
      map.get(f.fileName)!.push(f);
    });
    map.forEach((arr, k) => map.set(k, arr.sort((a, b) => {
      const aOrd = a.fileOrder ?? null;
      const bOrd = b.fileOrder ?? null;
      if (aOrd !== null && bOrd !== null) return aOrd - bOrd;
      if (aOrd !== null) return -1;
      if (bOrd !== null) return 1;
      if (a.revisionNumber !== b.revisionNumber) return a.revisionNumber - b.revisionNumber;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })));
    return [...map.values()].map(versions => ({
      latest:       versions[versions.length - 1],
      allVersions:  versions,
      prevFileId:   versions.length > 1 ? versions[versions.length - 2].id : null,
      versionCount: versions.length,
    }));
  }, [files]);

  // Upload da primeira entrega (sem ativo ainda)
  // Upload via XHR com rastreamento de progresso
  // progressKey: chave no uploadProgressMap (fileName do ativo ou "__first__" para primeira entrega)
  const uploadWithProgress = (progressKey: string, form: FormData, onSuccess: (f: TaskFile) => void, onErr: string) => {
    setUploadProgressMap(p => ({ ...p, [progressKey]: 0 }));
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    // onprogress: % de bytes enviados ao servidor
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setUploadProgressMap(p => ({ ...p, [progressKey]: Math.round((e.loaded / e.total) * 95) })); // até 95% — os 5% restantes são processamento no servidor
    };
    // onload: servidor respondeu (após thumbnail ~1-2s)
    xhr.onload = () => {
      setUploadProgressMap(p => { const n = { ...p }; delete n[progressKey]; return n; });
      if (xhr.status >= 200 && xhr.status < 300) {
        onSuccess(JSON.parse(xhr.responseText));
      } else {
        toast.error(onErr);
      }
    };
    xhr.onerror = () => {
      setUploadProgressMap(p => { const n = { ...p }; delete n[progressKey]; return n; });
      toast.error(onErr);
    };
    xhr.open("POST", `/api/tasks/${id}/files`);
    xhr.send(form);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append("file", file);
    uploadWithProgress(
      "__first__", form,
      (newFile) => { setFiles(prev => [...prev, newFile]); toast.success("Arquivo enviado!"); },
      "Erro ao enviar arquivo",
    );
    e.target.value = "";
  };

  // Nova versão via drag-drop ou menu
  const handleDropNewVersion = (assetFileName: string, droppedFile: File) => {
    // Detecta o tipo do ativo existente pelo mimeType de qualquer versão dele
    const assetMime = files.find(f => f.fileName === assetFileName)?.mimeType ?? "";
    const assetIsVideo = assetMime.startsWith("video/");
    const assetIsAudio = assetMime.startsWith("audio/");
    const fileIsVideo  = droppedFile.type.startsWith("video/");
    const fileIsAudio  = droppedFile.type.startsWith("audio/");

    // Tipo diferente do ativo arrastado → roteamento inteligente
    if ((assetIsVideo && fileIsAudio) || (assetIsAudio && fileIsVideo)) {
      const targetPrefix = fileIsAudio ? "audio/" : "video/";
      // Já existe um ativo do mesmo tipo do arquivo? → nova versão dele
      const existing = files.find(f => f.mimeType?.startsWith(targetPrefix));
      if (existing) {
        // Renomeia para o fileName do ativo existente e envia como nova versão
        const renamed = new File([droppedFile], existing.fileName, { type: droppedFile.type });
        const form = new FormData();
        form.append("file", renamed);
        form.append("originalName", droppedFile.name);
        uploadWithProgress(
          existing.fileName, form,
          (newFile) => { setFiles(prev => [...prev, newFile]); toast.success("Nova versão adicionada!"); },
          "Erro ao enviar nova versão",
        );
      } else {
        // Nenhum ativo desse tipo ainda → cria o primeiro
        const form = new FormData();
        form.append("file", droppedFile);
        uploadWithProgress(
          droppedFile.name, form,
          (newFile) => { setFiles(prev => [...prev, newFile]); toast.success("Novo ativo adicionado!"); },
          "Erro ao enviar arquivo",
        );
      }
      return;
    }

    // Mesmo tipo → nova versão do ativo existente
    const renamed = new File([droppedFile], assetFileName, { type: droppedFile.type });
    const form = new FormData();
    form.append("file", renamed);
    form.append("originalName", droppedFile.name);
    uploadWithProgress(
      assetFileName, form,
      (newFile) => { setFiles(prev => [...prev, newFile]); toast.success("Nova versão adicionada!"); },
      "Erro ao enviar nova versão",
    );
  };

  // Aplica nova ordem retornada pelo modal
  const handleVersionsReordered = (orderedIds: number[]) => {
    setFiles(prev => {
      const byId = new Map(prev.map(f => [f.id, f]));
      const reordered = orderedIds.map((id, idx) => ({ ...byId.get(id)!, fileOrder: idx }));
      const rest = prev.filter(f => !orderedIds.includes(f.id));
      return [...rest, ...reordered];
    });
  };

  // Remove a versão mais recente de um ativo
  const handleApprove = async (_fileId: number) => {
    try {
      // Aprova todos os arquivos da tarefa (igual ao review-file.tsx)
      const allFileIds = files.map(f => f.id);
      if (allFileIds.length) await apiPatch(`/api/tasks/${id}/files/approve`, { fileIds: allFileIds });
      // Muda status da tarefa para completed
      await apiPut(`/api/tasks/${id}`, { status: "completed" });
      const now = new Date().toISOString();
      setFiles(prev => prev.map(f => ({ ...f, approvedAt: now })));
      setTask(prev => prev ? { ...prev, status: "completed" } : prev);
      toast.success("Tarefa aprovada!");
    } catch { toast.error("Erro ao aprovar"); }
  };

  const handleDeleteVersion = async (fileId: number, _fileName: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/files/${fileId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      setFiles(prev => {
        const remaining = prev.filter(f => f.id !== fileId);
        // Se era o último arquivo e a tarefa estava em review → status volta para in_progress localmente
        if (remaining.length === 0) {
          setTask(t => t?.status === "review" ? { ...t, status: "in_progress" } : t);
        }
        return remaining;
      });
      toast.success("Versão removida");
    } catch { toast.error("Erro ao remover versão"); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );
  if (!task) return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <p className="text-[hsl(var(--muted-foreground))]">Tarefa não encontrada</p>
    </div>
  );

  const taskColor = task.color || "#6366f1";

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-[hsl(var(--background))]">
      <style>{CARD_BOUNCE_STYLE}</style>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <AssetPanel
          taskId={id} task={task} assets={assets} files={files}
          isEditor={isEditor} isOwner={isOwner} uploadProgressMap={uploadProgressMap} commentCounts={commentCounts}
          onUpload={handleUpload}
          onDropNewVersion={handleDropNewVersion}
          onDeleteVersion={handleDeleteVersion}
          onApprove={handleApprove}
          onManageVersions={versions => setManageVersions(versions)}
          onNavigate={fileId => {
            navigate(`/review/${id}/${fileId}`);
          }}
        />
      </div>

      {/* Modal gerenciar versões */}
      {manageVersions && (
        <VersionManagerModal
          taskId={id}
          versions={manageVersions}
          onClose={() => setManageVersions(null)}
          onSaved={orderedIds => {
            handleVersionsReordered(orderedIds);
            setManageVersions(null);
          }}
        />
      )}

      {/* Modal convidar revisores */}
      {inviteOpen && (
        <InviteReviewerModal
          taskId={id}
          taskTitle={task.title}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}

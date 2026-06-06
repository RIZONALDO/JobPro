import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { fmtDate } from "@/lib/utils";
import {
  ArrowLeft, Film, Music, CheckCircle, Clock, AlertCircle,
  RotateCcw, Play, FileVideo, Upload,
} from "lucide-react";
import { STATUS_LABEL } from "@/lib/status";

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
  revisionNumber: number; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null;
}

// ── VideoCard ─────────────────────────────────────────────────────────────────

function VideoCard({ file, taskId, task, onClick }: {
  file: TaskFile; taskId: number; task: TaskDetail; onClick: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isVideo = !!file.mimeType?.startsWith("video/");
  const isAudio = !!file.mimeType?.startsWith("audio/");
  const streamUrl = `/api/tasks/${taskId}/files/${file.id}/stream`;

  // Generate thumbnail at 10% of duration
  const onVideoMeta = useCallback(() => {
    const v = videoRef.current; if (!v || !isVideo) return;
    v.currentTime = Math.max(0, v.duration * 0.1);
  }, [isVideo]);

  const onVideoSeeked = useCallback(() => {
    const v = videoRef.current; if (!v || thumb) return;
    try {
      const scale = Math.min(1, 640 / (v.videoWidth || 640));
      const c = document.createElement("canvas");
      c.width = (v.videoWidth || 640) * scale; c.height = (v.videoHeight || 360) * scale;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      setThumb(c.toDataURL("image/jpeg", 0.75));
    } catch { /* ignore cross-origin */ }
  }, [thumb]);

  const onMouseEnter = () => {
    hoverTimer.current = setTimeout(() => {
      setHovering(true);
      const v = videoRef.current; if (v && isVideo) { v.currentTime = 0; v.play().catch(() => {}); }
    }, 200);
  };
  const onMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovering(false);
    const v = videoRef.current; if (v) { v.pause(); v.currentTime = Math.max(0, (v.duration || 0) * 0.1); }
  };

  const statusBadge = () => {
    if (file.approvedAt) return { label: "Aprovado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
    if (task.status === "review") return { label: "Aguardando revisão", cls: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
    if (task.status === "in_revision") return { label: "Em correção", cls: "bg-orange-500/15 text-orange-400 border-orange-500/20" };
    if (task.status === "completed") return { label: "Concluído", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
    return { label: "Em progresso", cls: "bg-sky-500/15 text-sky-400 border-sky-500/20" };
  };
  const badge = statusBadge();

  return (
    <button onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      className="group flex flex-col rounded-xl overflow-hidden border border-white/8 bg-white/4 hover:bg-white/8 hover:border-white/15 transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50">

      {/* Thumbnail / preview area */}
      <div className="relative w-full aspect-video bg-zinc-900 overflow-hidden">
        {isVideo && (
          <video ref={videoRef} src={streamUrl} preload="metadata" muted playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: hovering ? 1 : 0, transition: "opacity 0.25s" }}
            onLoadedMetadata={onVideoMeta} onSeeked={onVideoSeeked} />
        )}
        {thumb && (
          <img src={thumb} alt={file.fileName} className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: hovering ? 0 : 1, transition: "opacity 0.25s" }} />
        )}
        {!thumb && !hovering && (
          <div className="absolute inset-0 flex items-center justify-center">
            {isVideo ? <Film className="h-10 w-10 text-white/20" />
              : isAudio ? <Music className="h-10 w-10 text-white/20" />
              : <FileVideo className="h-10 w-10 text-white/20" />}
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: hovering ? 0 : 1, transition: "opacity 0.2s", background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)" }}>
          <div className="h-11 w-11 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}>
            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
          </div>
        </div>

        {/* Rev pill */}
        {file.revisionNumber > 0 && (
          <div className="absolute top-2 left-2">
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-black/70 text-amber-300 border border-amber-400/20">
              <RotateCcw className="h-2.5 w-2.5" />{file.revisionNumber}ª alt.
            </span>
          </div>
        )}
        {file.approvedAt && (
          <div className="absolute top-2 right-2">
            <CheckCircle className="h-5 w-5 text-emerald-400 drop-shadow-lg" />
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="p-3 flex flex-col gap-2">
        <p className="text-sm font-semibold text-white/90 truncate leading-snug">{file.fileName}</p>

        <div className="flex items-center gap-2">
          {task.editors[0] && (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <AvatarDisplay name={task.editors[0].name} avatarUrl={task.editors[0].avatarUrl} size={16} />
              <span className="text-[11px] text-white/50 truncate">{task.editors[0].name.split(" ")[0]}</span>
            </div>
          )}
          <span className="text-[10px] text-white/30 shrink-0 tabular-nums">{fmtDate(file.createdAt)}</span>
        </div>

        <span className={`self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
    </button>
  );
}

// ── ReviewTaskPage ────────────────────────────────────────────────────────────

export default function ReviewTaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const id = parseInt(taskId);
  const isEditor = user?.role === "editor";

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${id}`),
      apiFetch<TaskFile[]>(`/api/tasks/${id}/files`).catch(() => [] as TaskFile[]),
    ]).then(([t, f]) => { setTask(t); setFiles(f); })
      .catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [id]);

  // Latest file per revision group
  const latestFiles = (() => {
    const map = new Map<number, TaskFile>();
    files.forEach(f => {
      const cur = map.get(f.revisionNumber);
      if (!cur || new Date(f.createdAt) > new Date(cur.createdAt)) map.set(f.revisionNumber, f);
    });
    return [...map.values()].sort((a, b) => b.revisionNumber - a.revisionNumber);
  })();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`/api/tasks/${id}/files`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error();
      const newFile = await res.json();
      setFiles(prev => [...prev, newFile]);
      toast.success("Arquivo enviado com sucesso!");
    } catch { toast.error("Erro ao enviar arquivo"); }
    finally { setUploading(false); e.target.value = ""; }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f1117" }}>
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );

  if (!task) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f1117" }}>
      <p className="text-white/40">Tarefa não encontrada</p>
    </div>
  );

  const taskColor = task.color || "#6366f1";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0f1117" }}>

      {/* Header */}
      <header className="shrink-0 border-b border-white/8" style={{ background: "rgba(15,17,23,0.95)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 40 }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <button onClick={() => navigate("/tasks")}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors shrink-0">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Tarefas</span>
          </button>
          <span className="text-white/20">/</span>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: taskColor }} />
            {task.taskCode && <span className="text-xs text-white/30 font-mono shrink-0">{task.taskCode}</span>}
            <h1 className="text-sm font-semibold text-white/90 truncate">{task.title}</h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {task.revisionCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400/80">
                <RotateCcw className="h-3 w-3" />{task.revisionCount} alt.
              </span>
            )}
            {task.dueDate && (
              <span className="flex items-center gap-1 text-[11px] text-white/30">
                <Clock className="h-3 w-3" />{fmtDate(task.dueDate)}
              </span>
            )}
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
              style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
              {STATUS_LABEL[task.status] ?? task.status}
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">

        {/* Section header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-white/80">Material entregue</h2>
            <p className="text-xs text-white/30 mt-0.5">{latestFiles.length} arquivo{latestFiles.length !== 1 ? "s" : ""} · clique para revisar</p>
          </div>
          {isEditor && (
            <>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleUpload} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
                style={{ background: "hsl(var(--primary))" }}>
                <Upload className="h-4 w-4" />
                {uploading ? "Enviando…" : "Nova versão"}
              </button>
            </>
          )}
        </div>

        {/* Cards grid */}
        {latestFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="h-16 w-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Film className="h-8 w-8 text-white/15" />
            </div>
            <p className="text-sm text-white/30">Nenhum arquivo entregue ainda</p>
            {isEditor && (
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: "hsl(var(--primary))" }}>
                <Upload className="h-4 w-4" />Enviar arquivo
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {latestFiles.map(file => (
              <VideoCard key={file.id} file={file} taskId={id} task={task}
                onClick={() => navigate(`/review/${id}/${file.id}`)} />
            ))}
          </div>
        )}

        {/* Task info strip */}
        {task.description && (
          <div className="mt-10 p-4 rounded-xl border border-white/8 bg-white/3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/20 mb-2">Briefing</p>
            <p className="text-sm text-white/50 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          </div>
        )}
      </main>
    </div>
  );
}

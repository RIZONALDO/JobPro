import { useEffect, useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBreadcrumb } from "@/contexts/BreadcrumbContext";
import { useRealtime } from "@/hooks/use-realtime";
import { ArrowLeft, Upload, Film } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskDetail {
  id: number; taskCode?: string; title: string; status: string;
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
}
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  revisionNumber: number; fileOrder: number | null; originalName: string | null; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null;
  thumbnailPath: string | null; proxyPath: string | null; hlsPath: string | null;
  processingStatus: string;
}

// ── EmptyCard — estado de primeira entrega ────────────────────────────────────

const CARD_BOUNCE_STYLE = `
@keyframes cardBounce {
  0%,100% { transform: scale(1); }
  30%      { transform: scale(1.035); }
  60%      { transform: scale(0.975); }
  80%      { transform: scale(1.015); }
}
.card-bounce { animation: cardBounce 0.55s ease-out; }
`;

function EmptyCard({ isEditor, uploading, uploadProgress, onClickUpload, onDrop }: {
  isEditor: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  onClickUpload: () => void;
  onDrop: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [bouncing, setBouncing]     = useState(false);
  const dragCount = useRef(0);
  const inputRef  = useRef<HTMLInputElement>(null);

  const triggerBounce = () => {
    setBouncing(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setBouncing(true)));
    setTimeout(() => setBouncing(false), 600);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isEditor) return;
    e.preventDefault(); dragCount.current += 1;
    if (dragCount.current === 1) { setIsDragOver(true); triggerBounce(); }
  };
  const handleDragOver  = (e: React.DragEvent) => { if (!isEditor) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); dragCount.current -= 1;
    if (dragCount.current === 0) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); dragCount.current = 0; setIsDragOver(false);
    if (!isEditor) return;
    const f = e.dataTransfer.files[0];
    if (!f?.type.match(/^(video|audio)\//)) { toast.error("Apenas vídeo ou áudio"); return; }
    const dt = new DataTransfer(); dt.items.add(f);
    const fakeEvt = { target: { files: dt.files, value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;
    onDrop(fakeEvt);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <style>{CARD_BOUNCE_STYLE}</style>
      <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={onDrop} />
      <div className={`group relative${bouncing ? " card-bounce" : ""}`}>
        <button
          onClick={() => isEditor && onClickUpload()}
          onDragEnter={handleDragEnter} onDragOver={handleDragOver}
          onDragLeave={handleDragLeave} onDrop={handleDrop}
          disabled={!isEditor || uploading}
          className="w-full flex flex-col text-left focus:outline-none transition-all duration-200 disabled:cursor-default rounded-xl overflow-hidden border focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderColor: isDragOver ? "hsl(var(--primary))" : "rgba(255,255,255,0.10)",
            boxShadow:   isDragOver ? "0 0 0 2px hsl(var(--primary)/0.25)" : undefined,
          }}>
          <div className="relative w-full aspect-video bg-zinc-900 overflow-hidden flex items-center justify-center">
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
                      <span className="absolute text-sm font-bold text-white tabular-nums">{uploadProgress}%</span>
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
                  {isEditor ? <Upload className="h-5 w-5 text-white/30" /> : <Film className="h-5 w-5 text-white/20" />}
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
        </button>
      </div>
    </div>
  );
}

// ── ReviewTaskPage — smart redirect ──────────────────────────────────────────
// Se a tarefa já tem arquivo: redireciona direto para o player.
// Se não tem: mostra EmptyCard para o editor fazer a primeira entrega.

export default function ReviewTaskPage() {
  const { taskId }              = useParams<{ taskId: string }>();
  const [, navigate]            = useLocation();
  const { user }                = useAuth();
  const { set: setBreadcrumb, clear: clearBreadcrumb } = useBreadcrumb();

  const tId     = parseInt(taskId);
  const isEditor = user?.role === "editor";

  const [task, setTask]               = useState<TaskDetail | null>(null);
  const [loading, setLoading]         = useState(true);
  const [noFiles, setNoFiles]         = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const backPath = isEditor ? "/fila" : "/tasks";

  const redirectToLatest = (files: TaskFile[]) => {
    if (files.length === 0) { setNoFiles(true); return; }
    // Versão mais recente de cada ativo = maior revisionNumber, depois mais novo
    const latest = [...files].sort((a, b) => {
      if (b.revisionNumber !== a.revisionNumber) return b.revisionNumber - a.revisionNumber;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
    navigate(`/review/${tId}/${latest.id}`, { replace: true });
  };

  useEffect(() => {
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${tId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${tId}/files`).catch(() => [] as TaskFile[]),
    ]).then(([t, fs]) => {
      setTask(t);
      redirectToLatest(fs);
    }).catch(() => {
      toast.error("Erro ao carregar tarefa");
      setNoFiles(true);
    }).finally(() => setLoading(false));
  }, [tId]);

  // Recheck quando transcodificação terminar (SSE)
  useRealtime({
    onTasksChanged: () => {
      if (!noFiles) return;
      apiFetch<TaskFile[]>(`/api/tasks/${tId}/files`).then(redirectToLatest).catch(() => {});
    },
  });

  useEffect(() => {
    if (!task) return;
    setBreadcrumb([
      ...(task.taskCode ? [{ label: task.taskCode, mono: true, muted: true }] : []),
      { label: task.title },
    ], undefined, backPath);
    return () => clearBreadcrumb();
  }, [task?.id, task?.title, task?.taskCode, backPath]);

  const uploadWithProgress = (form: FormData) => {
    setUploading(true);
    setUploadProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 95));
    };
    xhr.onload = () => {
      setUploading(false); setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success("Arquivo enviado!");
        navigate(`/review/${tId}/${(JSON.parse(xhr.responseText) as TaskFile).id}`, { replace: true });
      } else { toast.error("Erro ao enviar arquivo"); }
    };
    xhr.onerror = () => { setUploading(false); setUploadProgress(null); toast.error("Erro ao enviar arquivo"); };
    xhr.open("POST", `/api/tasks/${tId}/files`);
    xhr.send(form);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const form = new FormData(); form.append("file", f);
    uploadWithProgress(form);
    e.target.value = "";
  };

  if (loading) return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );

  // Tem arquivos — aguarda o navigate do useEffect acima
  if (!noFiles) return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 flex items-center gap-3 px-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]" style={{ height: 56 }}>
        <button onClick={() => navigate(backPath)}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {task?.taskCode && <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span>}
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]/85 truncate">{task?.title}</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-8 bg-[hsl(var(--background))]">
        <EmptyCard
          isEditor={isEditor} uploading={uploading} uploadProgress={uploadProgress}
          onClickUpload={() => fileInputRef.current?.click()} onDrop={handleUpload}
        />
      </div>

      <input ref={fileInputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleUpload} />
    </div>
  );
}

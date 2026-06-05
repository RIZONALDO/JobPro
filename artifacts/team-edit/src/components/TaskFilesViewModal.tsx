import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Clapperboard, AudioLines, Download, CheckCircle2, ChevronRight } from "lucide-react";

interface TaskFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  publicToken: string | null;
  revisionNumber: number;
  createdAt: string;
  uploaderName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  taskId: number;
  taskCode?: string;
  taskTitle: string;
}

function fmtSize(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function revLabel(n: number) {
  return n === 0 ? "Original" : `${n}ª alt.`;
}

export function TaskFilesViewModal({ open, onClose, taskId, taskCode, taskTitle }: Props) {
  const [files,    setFiles]    = useState<TaskFile[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<TaskFile | null>(null);
  const [activeRev, setActiveRev] = useState<number>(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`)
      .then(f => {
        setFiles(f);
        const last = f[f.length - 1] ?? null;
        setSelected(last);
        setActiveRev(last?.revisionNumber ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, taskId]);

  const revisionGroups = useMemo(() => {
    const map = new Map<number, TaskFile[]>();
    files.forEach(f => {
      if (!map.has(f.revisionNumber)) map.set(f.revisionNumber, []);
      map.get(f.revisionNumber)!.push(f);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [files]);

  const activeFiles = useMemo(
    () => revisionGroups.find(([n]) => n === activeRev)?.[1] ?? [],
    [revisionGroups, activeRev]
  );

  const streamUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/stream` : `/api/tasks/${taskId}/files/${f.id}/download`;

  const downloadUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/download` : `/api/tasks/${taskId}/files/${f.id}/download`;

  const isVideo = (f: TaskFile) => f.mimeType?.startsWith("video/");
  const isAudio = (f: TaskFile) => f.mimeType?.startsWith("audio/");

  const selectFile = (f: TaskFile) => {
    setSelected(f);
    setActiveRev(f.revisionNumber);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden rounded-2xl max-h-[92vh] flex flex-col bg-[hsl(var(--card))] border border-[hsl(var(--border))]">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-2.5 border-b border-[hsl(var(--border))]">
          <DialogTitle className="flex-1 min-w-0 text-left">
            <div className="flex items-baseline gap-2 min-w-0">
              {taskCode && (
                <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/60">
                  {taskCode}
                </span>
              )}
              <span className="text-sm font-semibold truncate text-[hsl(var(--foreground))]">{taskTitle}</span>
            </div>
          </DialogTitle>
        </div>

        {/* ── Loading / empty ───────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-5 w-5 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Clapperboard className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum arquivo enviado</p>
          </div>
        ) : (
          <>
            {/* ── Player ────────────────────────────────────────────── */}
            <div className="bg-black flex items-center justify-center shrink-0" style={{ minHeight: 260 }}>
              {selected && (
                isVideo(selected) ? (
                  <video
                    key={selected.id}
                    controls
                    className="w-full"
                    style={{ maxHeight: "calc(92vh - 260px)", minHeight: 180 }}
                  >
                    <source src={streamUrl(selected)} type={selected.mimeType ?? "video/mp4"} />
                  </video>
                ) : isAudio(selected) ? (
                  <div className="flex flex-col items-center gap-4 py-8 px-6 w-full max-w-xs">
                    <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--primary))]/10 flex items-center justify-center">
                      <AudioLines className="h-6 w-6 text-[hsl(var(--primary))]" />
                    </div>
                    <p className="text-xs font-medium text-zinc-300 text-center truncate w-full">{selected.fileName}</p>
                    <audio key={selected.id} controls className="w-full">
                      <source src={streamUrl(selected)} type={selected.mimeType ?? "audio/mpeg"} />
                    </audio>
                  </div>
                ) : null
              )}
            </div>

            {/* ── Info bar ──────────────────────────────────────────── */}
            {selected && (
              <div className="shrink-0 px-4 py-2 border-t border-[hsl(var(--border))] flex items-center gap-3 bg-[hsl(var(--muted))]/30">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[hsl(var(--foreground))] truncate">{selected.fileName}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    {[
                      selected.uploaderName?.split(" ")[0],
                      fmtDate(selected.createdAt),
                      fmtSize(selected.fileSize),
                    ].filter(Boolean).join(" · ")}
                    {selected.approvedAt && (
                      <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        · ✓ {selected.approvedByName?.split(" ")[0] ?? "Aprovado"}
                      </span>
                    )}
                  </p>
                </div>
                <a
                  href={downloadUrl(selected)}
                  download={selected.fileName}
                  className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--foreground))]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </a>
              </div>
            )}

            {/* ── Histórico de versões ───────────────────────────────── */}
            <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">

              {/* Pills de revisão */}
              <div className="flex items-center gap-1 px-4 pt-3 pb-2 overflow-x-auto scrollbar-none">
                {revisionGroups.map(([revNum, revFiles], idx) => {
                  const isActive = activeRev === revNum;
                  const isApproved = revFiles.some(f => f.approvedAt);
                  return (
                    <div key={revNum} className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setActiveRev(revNum);
                          setSelected(revFiles[revFiles.length - 1]);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                          ${isActive
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                            : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                          }`}
                      >
                        {revLabel(revNum)}
                        {isApproved && (
                          <CheckCircle2 className={`h-3 w-3 shrink-0 ${isActive ? "opacity-80" : "text-emerald-500"}`} />
                        )}
                      </button>
                      {idx < revisionGroups.length - 1 && (
                        <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/30 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Arquivos da revisão ativa */}
              <div className="px-4 pb-3 space-y-1">
                {activeFiles.map(f => (
                  <button
                    key={f.id}
                    onClick={() => selectFile(f)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors
                      ${f.id === selected?.id
                        ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20"
                        : "hover:bg-[hsl(var(--muted))]/50 border border-transparent"
                      }`}
                  >
                    {isVideo(f)
                      ? <Clapperboard className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                      : <AudioLines className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                    }
                    <span className={`text-[11px] font-medium truncate flex-1 ${f.id === selected?.id ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>
                      {f.fileName}
                    </span>
                    {f.approvedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

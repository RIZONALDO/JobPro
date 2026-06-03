import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Film, Music, Download, ChevronRight } from "lucide-react";

interface TaskFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  publicToken: string | null;
  revisionNumber: number;
  createdAt: string;
  uploaderName: string | null;
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

export function TaskFilesViewModal({ open, onClose, taskId, taskCode, taskTitle }: Props) {
  const [files,    setFiles]    = useState<TaskFile[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<TaskFile | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`)
      .then(f => { setFiles(f); setSelected(f[f.length - 1] ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, taskId]);

  const streamUrl = (f: TaskFile) =>
    f.publicToken
      ? `/api/public/${f.publicToken}/stream`
      : `/api/tasks/${taskId}/files/${f.id}/download`;

  const downloadUrl = (f: TaskFile) =>
    f.publicToken
      ? `/api/public/${f.publicToken}/download`
      : `/api/tasks/${taskId}/files/${f.id}/download`;

  const isVideo = (f: TaskFile) => f.mimeType?.startsWith("video/");
  const isAudio = (f: TaskFile) => f.mimeType?.startsWith("audio/");

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden rounded-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0">
          <DialogTitle className="text-base font-semibold leading-snug flex items-center gap-2">
            <Film className="h-4 w-4 text-violet-500 shrink-0" />
            <span className="truncate">
              {taskCode && <span className="font-mono text-[hsl(var(--muted-foreground))]/50 mr-1">{taskCode}</span>}
              {taskTitle}
            </span>
          </DialogTitle>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Film className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum arquivo enviado</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">

            {/* Sidebar — lista de arquivos */}
            <div className="w-52 shrink-0 border-r border-[hsl(var(--border))] overflow-y-auto">
              {files.map(f => {
                const active = selected?.id === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelected(f)}
                    className={[
                      "w-full flex items-center gap-2.5 px-3 py-3 text-left border-b border-[hsl(var(--border))]/50 transition-colors",
                      active
                        ? "bg-violet-500/10 border-l-2 border-l-violet-500"
                        : "hover:bg-[hsl(var(--muted))]/40",
                    ].join(" ")}
                  >
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-violet-500/20" : "bg-[hsl(var(--muted))]/50"}`}>
                      {isVideo(f) ? <Film className={`h-3.5 w-3.5 ${active ? "text-violet-500" : "text-[hsl(var(--muted-foreground))]"}`} />
                        : <Music className={`h-3.5 w-3.5 ${active ? "text-violet-500" : "text-[hsl(var(--muted-foreground))]"}`} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold truncate leading-snug">{f.fileName}</p>
                      <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-0.5">
                        {f.revisionNumber > 0 ? `Alt. ${f.revisionNumber}` : "Original"}
                        {f.uploaderName && ` · ${f.uploaderName.split(" ")[0]}`}
                      </p>
                    </div>
                    {active && <ChevronRight className="h-3 w-3 text-violet-500 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Player */}
            {selected && (
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="flex-1 flex items-center justify-center bg-black/40 p-4 min-h-0">
                  {isVideo(selected) ? (
                    <video
                      key={selected.id}
                      controls
                      className="max-w-full max-h-full rounded-xl shadow-xl"
                      style={{ maxHeight: "calc(90vh - 200px)" }}
                    >
                      <source src={streamUrl(selected)} type={selected.mimeType ?? "video/mp4"} />
                    </video>
                  ) : isAudio(selected) ? (
                    <div className="w-full max-w-sm flex flex-col items-center gap-4 py-6">
                      <div className="h-16 w-16 rounded-2xl bg-violet-500/20 flex items-center justify-center">
                        <Music className="h-8 w-8 text-violet-400" />
                      </div>
                      <p className="text-sm font-semibold text-white text-center truncate w-full px-4">{selected.fileName}</p>
                      <audio key={selected.id} controls className="w-full">
                        <source src={streamUrl(selected)} type={selected.mimeType ?? "audio/mpeg"} />
                      </audio>
                    </div>
                  ) : null}
                </div>

                {/* File info + download */}
                <div className="shrink-0 px-4 py-3 border-t border-[hsl(var(--border))] flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{selected.fileName}</p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      {fmtSize(selected.fileSize)}
                      {selected.uploaderName && ` · ${selected.uploaderName.split(" ")[0]}`}
                      {" · "}{fmtDate(selected.createdAt)}
                    </p>
                  </div>
                  <a
                    href={downloadUrl(selected)}
                    download={selected.fileName}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[hsl(var(--muted))]/60 hover:bg-[hsl(var(--muted))] transition-colors shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Baixar
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

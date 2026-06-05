import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Clapperboard, AudioLines, Download, ChevronRight, CheckCircle2 } from "lucide-react";

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`)
      .then(f => { setFiles(f); setSelected(f[f.length - 1] ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, taskId]);

  // Agrupa arquivos por número de revisão, em ordem cronológica
  const revisionGroups = useMemo(() => {
    const map = new Map<number, TaskFile[]>();
    files.forEach(f => {
      if (!map.has(f.revisionNumber)) map.set(f.revisionNumber, []);
      map.get(f.revisionNumber)!.push(f);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [files]);

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
      <DialogContent className="max-w-3xl w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden rounded-2xl max-h-[92vh] flex flex-col bg-zinc-950 border border-zinc-800/80">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0 border border-violet-500/20">
            <Clapperboard className="h-4 w-4 text-violet-400" />
          </div>
          <DialogTitle className="flex-1 min-w-0 text-left">
            {taskCode && <p className="text-[10px] text-zinc-500 font-mono leading-none mb-0.5 tracking-widest uppercase">{taskCode}</p>}
            <p className="text-sm font-semibold text-zinc-100 truncate leading-snug">{taskTitle}</p>
          </DialogTitle>
        </div>

        {/* ── States: loading / empty ─────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-6 w-6 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Clapperboard className="h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500">Nenhum arquivo enviado</p>
          </div>
        ) : (
          <>
            {/* ── Player ─────────────────────────────────────────────── */}
            <div className="bg-black flex items-center justify-center" style={{ minHeight: 300 }}>
              {selected && (
                isVideo(selected) ? (
                  <video
                    key={selected.id}
                    controls
                    className="w-full"
                    style={{ maxHeight: "calc(92vh - 280px)", minHeight: 200 }}
                  >
                    <source src={streamUrl(selected)} type={selected.mimeType ?? "video/mp4"} />
                  </video>
                ) : isAudio(selected) ? (
                  <div className="flex flex-col items-center gap-5 py-10 px-6 w-full max-w-sm">
                    <div className="h-20 w-20 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                      <AudioLines className="h-9 w-9 text-sky-400" />
                    </div>
                    <p className="text-sm font-semibold text-white text-center truncate w-full">{selected.fileName}</p>
                    <audio key={selected.id} controls className="w-full">
                      <source src={streamUrl(selected)} type={selected.mimeType ?? "audio/mpeg"} />
                    </audio>
                  </div>
                ) : null
              )}
            </div>

            {/* ── Info bar ───────────────────────────────────────────── */}
            {selected && (
              <div className="shrink-0 px-4 py-2.5 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-zinc-200 truncate">{selected.fileName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {selected.uploaderName && <span className="text-[10px] text-zinc-500">{selected.uploaderName.split(" ")[0]}</span>}
                    <span className="text-[10px] text-zinc-700">·</span>
                    <span className="text-[10px] text-zinc-500">{fmtDate(selected.createdAt)}</span>
                    {selected.fileSize && <>
                      <span className="text-[10px] text-zinc-700">·</span>
                      <span className="text-[10px] text-zinc-500">{fmtSize(selected.fileSize)}</span>
                    </>}
                  </div>
                </div>
                <a
                  href={downloadUrl(selected)}
                  download={selected.fileName}
                  className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors shrink-0 border border-zinc-700/50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </a>
              </div>
            )}

            {/* ── Revision history ───────────────────────────────────── */}
            <div className="shrink-0 border-t border-zinc-800 px-4 pt-3 pb-4 bg-zinc-950">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600 mb-3">
                Histórico de entregas · {revisionGroups.length} {revisionGroups.length === 1 ? "versão" : "versões"}
              </p>
              <div className="flex items-start gap-2 overflow-x-auto pb-1 scrollbar-none">
                {revisionGroups.map(([revNum, revFiles], idx) => {
                  const isCurrentRev = revFiles.some(f => f.id === selected?.id);
                  return (
                    <div key={revNum} className="flex items-center gap-2 shrink-0">
                      <div className={`rounded-xl border p-3 w-[148px] transition-all
                        ${isCurrentRev
                          ? "border-violet-500/50 bg-violet-500/10"
                          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"}`}
                      >
                        {/* Revision label + approved badge */}
                        <div className="flex items-center justify-between mb-2.5">
                          <span className={`text-[10px] font-bold tracking-wide ${isCurrentRev ? "text-violet-400" : "text-zinc-500"}`}>
                            {revLabel(revNum)}
                          </span>
                          {revFiles.some(f => f.approvedAt) ? (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Aprovado
                            </span>
                          ) : isCurrentRev ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                          ) : null}
                        </div>

                        {/* Files dentro da revisão */}
                        <div className="flex flex-col gap-1">
                          {revFiles.map(f => (
                            <button
                              key={f.id}
                              onClick={() => setSelected(f)}
                              className={`flex items-center gap-1.5 w-full text-left rounded-lg px-1.5 py-1.5 transition-colors
                                ${f.id === selected?.id
                                  ? "bg-violet-500/25 text-violet-300"
                                  : "hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
                            >
                              {isVideo(f)
                                ? <Clapperboard className="h-3 w-3 shrink-0" />
                                : <AudioLines className="h-3 w-3 shrink-0" />}
                              <span className="text-[10px] font-medium truncate flex-1">{f.fileName}</span>
                              {f.approvedAt && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />}
                            </button>
                          ))}
                        </div>

                        {/* Uploader + data + quem aprovou */}
                        {revFiles[0] && (
                          <p className="text-[9px] text-zinc-600 mt-2 leading-snug truncate">
                            {revFiles[0].uploaderName?.split(" ")[0]}
                            {" · "}
                            {fmtDate(revFiles[0].createdAt)}
                            {revFiles.some(f => f.approvedAt) && revFiles.find(f => f.approvedByName) && (
                              <> · <span className="text-emerald-600">{revFiles.find(f => f.approvedByName)!.approvedByName?.split(" ")[0]}</span></>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Seta entre revisões */}
                      {idx < revisionGroups.length - 1 && (
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-700 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

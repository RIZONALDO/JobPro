import { useState, useRef, useCallback } from "react";
import { apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Film, Music, X, CheckCircle, Send } from "lucide-react";

interface Props {
  open: boolean;
  taskId: number;
  taskCode?: string;
  taskTitle: string;
  onDone: () => void;
  onCancel: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskFileUploadModal({ open, taskId, taskCode, taskTitle, onDone, onCancel }: Props) {
  const [file,        setFile]        = useState<File | null>(null);
  const [progress,    setProgress]    = useState(0);
  const [uploading,   setUploading]   = useState(false);
  const [uploaded,    setUploaded]    = useState(false);
  const [sending,     setSending]     = useState(false);
  const [dragging,    setDragging]    = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef   = useRef<XMLHttpRequest | null>(null);

  const reset = () => {
    setFile(null); setProgress(0);
    setUploading(false); setUploaded(false); setSending(false);
    if (xhrRef.current) { xhrRef.current.abort(); xhrRef.current = null; }
  };

  const handleCancel = () => { reset(); onCancel(); };

  const pick = (picked: File) => {
    const ok = picked.type.startsWith("video/") || picked.type.startsWith("audio/");
    if (!ok) { toast.error("Apenas vídeo ou áudio"); return; }
    if (picked.size > 500 * 1024 * 1024) { toast.error("Máximo 500 MB"); return; }
    setFile(picked); setProgress(0); setUploaded(false);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pick(f);
  }, []);

  const uploadAndSend = async () => {
    if (!file) { await send(); return; }
    setUploading(true); setProgress(0);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      const form = new FormData();
      form.append("file", file);

      xhr.upload.onprogress = e => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 201) { setProgress(100); setUploaded(true); resolve(); }
        else { try { reject(new Error(JSON.parse(xhr.responseText).error ?? "Erro no upload")); } catch { reject(new Error("Erro no upload")); } }
      };
      xhr.onerror   = () => reject(new Error("Erro de rede"));
      xhr.onabort   = () => reject(new Error("Cancelado"));

      xhr.open("POST", `/api/tasks/${taskId}/files`);
      xhr.withCredentials = true;
      xhr.send(form);
    }).catch(err => {
      setUploading(false);
      toast.error(err.message);
      throw err;
    });

    setUploading(false);
    await send();
  };

  const send = async () => {
    setSending(true);
    try {
      await apiPut(`/api/tasks/${taskId}`, { status: "review" });
      toast.success("Enviado para aprovação");
      reset();
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
      setSending(false);
    }
  };

  const isVideo = file?.type.startsWith("video/");
  const isAudio = file?.type.startsWith("audio/");
  const busy    = uploading || sending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !busy) handleCancel(); }}>
      <DialogContent className="max-w-md w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
              <Send className="h-4 w-4 text-violet-500" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-snug">Enviar para aprovação</DialogTitle>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                {taskCode && <span className="font-mono mr-1">{taskCode}</span>}{taskTitle}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-4">

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !file && !busy && inputRef.current?.click()}
            className={[
              "relative rounded-xl border-2 border-dashed transition-all",
              file ? "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 cursor-default"
                   : "cursor-pointer hover:border-violet-400 hover:bg-violet-500/5",
              dragging ? "border-violet-400 bg-violet-500/8 scale-[1.01]" : "border-[hsl(var(--border))]",
            ].join(" ")}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }}
            />

            {!file ? (
              <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
                <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/50 flex items-center justify-center">
                  <Upload className="h-6 w-6 text-[hsl(var(--muted-foreground))]/50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Arraste ou clique para selecionar</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">Vídeo ou áudio · máx 500 MB</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                  {isVideo ? <Film className="h-5 w-5 text-violet-500" />
                           : isAudio ? <Music className="h-5 w-5 text-violet-500" />
                           : <Film className="h-5 w-5 text-violet-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{file.name}</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{fmtSize(file.size)}</p>
                </div>
                {!busy && !uploaded && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setFile(null); setProgress(0); }}
                    className="h-6 w-6 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {uploaded && <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />}
              </div>
            )}

            {/* Progress bar */}
            {uploading && (
              <div className="px-4 pb-3.5">
                <div className="h-1.5 rounded-full bg-[hsl(var(--muted))]/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5 text-right">{progress}%</p>
              </div>
            )}
          </div>

          {/* Info */}
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] text-center px-2">
            O arquivo ficará disponível para o coordenador na tarefa.
            Você pode enviar sem arquivo clicando em <strong>Pular</strong>.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center gap-2 justify-between">
          <Button variant="ghost" size="sm" className="h-9 rounded-xl text-[hsl(var(--muted-foreground))]"
            onClick={handleCancel} disabled={busy}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 rounded-xl"
              onClick={send} disabled={busy || uploaded}>
              {sending && !uploading ? "Enviando…" : "Pular"}
            </Button>
            <Button size="sm" className="h-9 rounded-xl gap-1.5 bg-violet-500 hover:bg-violet-600 text-white"
              onClick={uploadAndSend} disabled={busy || !file || uploaded}>
              <Send className="h-3.5 w-3.5" />
              {uploading ? `${progress}%…` : sending ? "Enviando…" : "Enviar com arquivo"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { toast } from "sonner";
import { FolderOpen, Copy, Check, Layers, FileText, Calendar } from "lucide-react";

interface Person { id: number; name: string; avatarUrl?: string | null; }

interface TaskDetails {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  client: string | null;
  folderUrl: string | null;
  priority: string;
  complexity: string;
  status: string;
  color: string | null;
  startDate: string | null;
  dueDate: string | null;
  taskType: string;
  revisionCount: number;
  assignedTo: Person | null;
  createdBy: Person | null;
  coCoordinators: Person[];
  editors: Person[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: number | null;
}

const PRIORITY_LABELS: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

function fmtDT(d: string) {
  const dt = new Date(d);
  const day = dt.getDate(); const mon = dt.getMonth() + 1;
  const h = dt.getHours(); const m = dt.getMinutes();
  const time = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  return `${day}/${mon} ${time}`;
}

function fmtTime(d: string) {
  const dt = new Date(d);
  const h = dt.getHours(); const m = dt.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

export function TaskDetailsModal({ open, onOpenChange, taskId }: Props) {
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyFolder = () => {
    if (!task?.folderUrl) return;
    navigator.clipboard.writeText(task.folderUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (!open || !taskId) return;
    setLoading(true);
    apiFetch<TaskDetails>(`/api/tasks/${taskId}`)
      .then(setTask)
      .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
      .finally(() => setLoading(false));
  }, [open, taskId]);

  useEffect(() => { if (!open) setTask(null); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-16px)] sm:max-w-md p-0 gap-0 overflow-hidden rounded-3xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[88vh]">
        <DialogTitle className="sr-only">Detalhes da tarefa</DialogTitle>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading || !task ? (
            <div className="px-6 py-12 flex items-center justify-center gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          ) : (
            <div className="px-6 pt-7 pb-5 space-y-6">

              {/* ── Identidade ─────────────────────────────────────────── */}
              <div className="flex items-center gap-2 min-h-[24px]">
                {task.taskCode && (
                  <span className="font-mono text-[11px] font-bold tracking-tight text-[hsl(var(--primary))]/60">
                    {task.taskCode}
                  </span>
                )}
                {task.taskType === "multi_task" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
                    <Layers className="h-3 w-3" />Multi-tarefa
                  </span>
                )}
                {task.taskType === "task" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))]">
                    <FileText className="h-3 w-3" />Tarefa simples
                  </span>
                )}
              </div>

              {/* ── Título ─────────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Título</p>
                <p className="w-full h-11 px-0 text-xl font-black border-0 border-b-2 flex items-center"
                  style={{ borderBottomColor: "hsl(var(--primary))", opacity: 0.7 }}>
                  {task.title}
                </p>
              </div>

              {/* ── Briefing ───────────────────────────────────────────── */}
              {task.description && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Briefing</p>
                  <p className="text-sm rounded-2xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))] px-3 py-2.5 leading-relaxed whitespace-pre-wrap opacity-70 min-h-[80px]">
                    {task.description}
                  </p>
                </div>
              )}

              {/* ── Cliente ────────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Cliente</p>
                <p className="h-10 flex items-center text-sm px-3 rounded-2xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))] opacity-70">
                  {task.client || <span className="text-[hsl(var(--muted-foreground))]/30">—</span>}
                </p>
              </div>

              {/* ── Pasta / Arquivos ───────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Pasta / Arquivos</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/40 pointer-events-none" />
                    <p className="pl-9 h-10 flex items-center text-sm rounded-2xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))] opacity-70 truncate">
                      {task.folderUrl || <span className="text-[hsl(var(--muted-foreground))]/30">—</span>}
                    </p>
                  </div>
                  {task.folderUrl && (
                    <button type="button" onClick={copyFolder}
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                      {copied
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Copy className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                      }
                    </button>
                  )}
                </div>
              </div>

              {/* ── Prioridade ─────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Prioridade</p>
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map(p => (
                    <div key={p}
                      className={`flex-1 h-9 rounded-full text-xs font-bold flex items-center justify-center border
                        ${task.priority === p
                          ? p === "high"   ? "bg-red-500   border-red-500   text-white"
                          : p === "medium" ? "bg-amber-500 border-amber-500 text-white"
                          :                  "bg-slate-500 border-slate-500 text-white"
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-40"
                        }`}>
                      {PRIORITY_LABELS[p]}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Agenda ─────────────────────────────────────────────── */}
              {(task.startDate || task.dueDate) && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Agenda</p>
                  <div className="h-10 flex items-center gap-2 px-3 rounded-2xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))] opacity-70">
                    <Calendar className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
                    {task.startDate && (
                      <span className="text-sm font-semibold tabular-nums">{fmtTime(task.startDate)}</span>
                    )}
                    {task.startDate && task.dueDate && (
                      <span className="text-[hsl(var(--muted-foreground))]/30 text-xs">→</span>
                    )}
                    {task.dueDate && (() => {
                      const sameDay = task.startDate &&
                        new Date(task.startDate).toDateString() === new Date(task.dueDate!).toDateString();
                      return (
                        <span className="text-sm font-semibold tabular-nums">
                          {sameDay ? fmtTime(task.dueDate) : fmtDT(task.dueDate)}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ── Editor + Coord ─────────────────────────────────────── */}
              {(task.assignedTo || task.editors.length > 0 || task.createdBy) && (
                <div className="space-y-3">
                  {(task.assignedTo || task.editors.length > 0) && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Editor</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {[task.assignedTo, ...task.editors].filter(Boolean).map((p, i) => (
                          <div key={p!.id} className="flex items-center gap-1.5">
                            <ChatAvatarButton userId={p!.id} name={p!.name} avatarUrl={p!.avatarUrl}
                              size={26} taskId={task.id} taskCode={task.taskCode} taskTitle={task.title} />
                            {i === 0 && <span className="text-sm text-[hsl(var(--foreground))]/70">{p!.name.split(" ")[0]}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {task.createdBy && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Coordenador</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {[task.createdBy, ...task.coCoordinators].map((p, i) => (
                          <div key={p.id} className="flex items-center gap-1.5">
                            <ChatAvatarButton userId={p.id} name={p.name} avatarUrl={p.avatarUrl}
                              size={26} taskId={task.id} taskCode={task.taskCode} taskTitle={task.title} />
                            {i === 0 && <span className="text-sm text-[hsl(var(--foreground))]/70">{p.name.split(" ")[0]}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 shrink-0 bg-[hsl(var(--card))]">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              Fechar
            </button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

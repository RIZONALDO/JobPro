import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import {
  Clock, FolderOpen, RotateCcw, Calendar, AlertTriangle,
  Layers, Copy, ChevronRight, Hash, Zap,
} from "lucide-react";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }

interface SubtaskSummary {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  assignedTo: Person | null;
  editors: Person[];
  subtaskOrder: number;
}

interface SubtaskProgress {
  total: number; completed: number; inProgress: number;
  pending: number; cancelled: number; percentage: number;
}

interface TaskDetail {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  client: string | null;
  color: string;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  startDate?: string | null;
  folderUrl: string | null;
  revisionCount: number;
  createdBy: Person | null;
  assignedTo: Person | null;
  editors: Person[];
  revisions: Revision[];
  createdAt: string;
  updatedAt: string;
  taskType: string;
  subtasks?: SubtaskSummary[];
  subtaskProgress?: SubtaskProgress;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const COMPLEXITY_ICON:  Record<string, string> = { low: "○", medium: "◑", high: "●" };
const COMPLEXITY_CLS:   Record<string, string> = {
  low: "text-slate-400", medium: "text-blue-500", high: "text-purple-500",
};

const STATUS_DOT: Record<string, string> = {
  pending:     "bg-slate-400",
  in_progress: "bg-blue-500",
  review:      "bg-violet-500",
  in_revision: "bg-amber-500",
  completed:   "bg-emerald-500",
  cancelled:   "bg-red-500",
  paused:      "bg-purple-400",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed", "cancelled", "paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function Prop({ icon, label, children }: {
  icon: React.ReactNode; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">{label}</p>
      <div className="flex items-center gap-1.5">{icon}{children}</div>
    </div>
  );
}

interface Props { taskId: number; onClose: () => void; onOpenTask?: (id: number) => void; }

export function TaskModal({ taskId, onClose, onOpenTask }: Props) {
  const [task,    setTask]    = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<TaskDetail>(`/api/tasks/${taskId}`)
      .then(setTask)
      .catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const overdue = task ? isOverdue(task.dueDate, task.status) : false;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col rounded-3xl border-0 shadow-2xl">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando</DialogTitle>
            <div className="flex flex-col items-center justify-center py-24 gap-3 bg-[hsl(var(--card))]">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ═══════════════════════════════════════
                HERO — cor da tarefa preenchendo o topo
                ═══════════════════════════════════════ */}
            <div
              className="relative shrink-0 px-6 pt-6 pb-14"
              style={{ background: `linear-gradient(145deg, ${task.color}, ${task.color}99)` }}
            >
              {/* overlay escuro garante legibilidade em cores claras */}
              <div className="absolute inset-0 bg-black/25 rounded-t-3xl pointer-events-none" />

              <div className="relative z-10">
                {/* breadcrumb subtarefa */}
                {task.taskType === "subtask" && task.parentTask && (
                  <button
                    type="button"
                    onClick={() => onOpenTask?.(task.parentTask!.id)}
                    className="flex items-center gap-1 mb-3 text-white/60 hover:text-white/90 transition-colors text-xs"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" />
                    {task.parentTask.taskCode && <span className="font-mono">{task.parentTask.taskCode}</span>}
                    <span className="truncate max-w-[160px]">{task.parentTask.title}</span>
                  </button>
                )}

                {/* código + tipo */}
                <div className="flex items-center gap-2 mb-3">
                  {task.taskCode && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-white/50 bg-white/10 px-2 py-0.5 rounded-md">
                      <Hash className="h-2.5 w-2.5" />{task.taskCode}
                    </span>
                  )}
                  <MultiTaskBadge taskType={task.taskType} />
                </div>

                {/* título */}
                <h2 className="text-[22px] font-extrabold text-white leading-snug tracking-tight mb-2">
                  {task.title}
                </h2>

                {/* cliente */}
                {task.client && (
                  <p className="text-white/65 text-sm font-medium">{task.client}</p>
                )}
              </div>

              {/* status pill — flutua sobre a curva */}
              <div className="absolute bottom-0 left-6 translate-y-1/2 z-20 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-lg border border-white/10 backdrop-blur-sm
                  ${STATUS_CLASS[task.status] ?? "bg-slate-100 text-slate-700"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] ?? "bg-slate-400"}`} />
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                {task.revisionCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 shadow-lg border border-amber-200/50">
                    <RotateCcw className="h-3 w-3" />
                    {task.revisionCount}
                  </span>
                )}
              </div>

              {/* curva branca na base do hero */}
              <div
                className="absolute bottom-0 left-0 right-0 h-8 rounded-t-3xl pointer-events-none"
                style={{ background: "hsl(var(--card))" }}
              />
            </div>

            {/* ═══════════════════════════════════════
                CORPO BRANCO — scrollável
                ═══════════════════════════════════════ */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-[hsl(var(--card))]">

              {/* espaço para o status pill que flutua */}
              <div className="h-6" />

              {/* PROPRIEDADES — grid 2 colunas */}
              <div className="mx-4 mb-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-y divide-[hsl(var(--border))]">

                  {/* Prazo */}
                  <div className="px-4 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">Prazo</p>
                    {task.dueDate ? (
                      <div className={`flex items-center gap-1.5 ${overdue ? "text-red-500" : "text-[hsl(var(--foreground))]"}`}>
                        {overdue
                          ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          : <Calendar className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />}
                        <span className="text-sm font-semibold leading-tight">{fmtDateHuman(task.dueDate)}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-[hsl(var(--muted-foreground))]/40">—</span>
                    )}
                    {overdue && <p className="text-[10px] font-bold text-red-500 mt-0.5">Atrasada</p>}
                  </div>

                  {/* Prioridade */}
                  <div className="px-4 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">Prioridade</p>
                    <PriorityBadge priority={task.priority} showLabel className="text-sm" />
                  </div>

                  {/* Complexidade */}
                  <div className="px-4 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">Complexidade</p>
                    <div className={`flex items-center gap-1.5 ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                      <Layers className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-sm font-semibold">{COMPLEXITY_LABEL[task.complexity] ?? task.complexity}</span>
                    </div>
                  </div>

                  {/* Progresso (multi) ou campo livre */}
                  <div className="px-4 py-3">
                    {task.taskType === "multi_task" && task.subtaskProgress ? (
                      <>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">Progresso</p>
                        <SubtaskProgressBar
                          total={task.subtaskProgress.total}
                          completed={task.subtaskProgress.completed}
                          percentage={task.subtaskProgress.percentage}
                        />
                      </>
                    ) : (
                      <>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">Criado em</p>
                        <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-sm font-medium">{fmtDate(task.createdAt)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* EQUIPE */}
              {(task.createdBy || task.editors?.length > 0) && (
                <div className="mx-4 mb-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3 px-1">Equipe</p>
                  <div className="flex flex-wrap gap-2">
                    {task.createdBy && (
                      <div className="flex items-center gap-2.5 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-2xl px-3 py-2">
                        <AvatarDisplay name={task.createdBy.name} avatarUrl={task.createdBy.avatarUrl ?? null} size={28} />
                        <div>
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Coordenador</p>
                          <p className="text-xs font-semibold leading-none">{task.createdBy.name.split(" ").slice(0,2).join(" ")}</p>
                        </div>
                      </div>
                    )}
                    {task.editors?.map(e => (
                      <div key={e.id} className="flex items-center gap-2.5 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-2xl px-3 py-2">
                        <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={28} />
                        <div>
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Editor</p>
                          <p className="text-xs font-semibold leading-none">{e.name.split(" ").slice(0,2).join(" ")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DESCRIÇÃO */}
              <div className="mx-4 mb-4 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
                <div className="px-4 py-3 bg-[hsl(var(--muted))]/20 border-b border-[hsl(var(--border))]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Descrição</p>
                </div>
                <div className="px-4 py-4">
                  {task.description ? (
                    <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                  ) : (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem descrição.</p>
                  )}
                </div>
              </div>

              {/* SUBTAREFAS */}
              {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                <div className="mx-4 mb-4 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-4 py-3 bg-[hsl(var(--muted))]/20 border-b border-[hsl(var(--border))] flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Subtarefas</p>
                    <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/40">{task.subtasks.length}</span>
                  </div>
                  <div className="divide-y divide-[hsl(var(--border))]">
                    {task.subtasks.map(sub => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => onOpenTask?.(sub.id)}
                        className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/40 transition-colors group"
                      >
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: sub.status === "completed" ? "#22c55e" : sub.status === "in_progress" ? "#3b82f6" : sub.status === "cancelled" ? "#ef4444" : "#a1a1aa" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{sub.title}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 mt-0.5">
                            {STATUS_LABEL[sub.status] ?? sub.status}
                            {sub.assignedTo && ` · ${sub.assignedTo.name.split(" ")[0]}`}
                          </p>
                        </div>
                        {sub.assignedTo && (
                          <AvatarDisplay name={sub.assignedTo.name} avatarUrl={sub.assignedTo.avatarUrl} style={{ width: 22, height: 22, fontSize: 8, flexShrink: 0 }} />
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/25 group-hover:text-[hsl(var(--primary))] shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* PASTA */}
              {task.folderUrl && (
                <div className="mx-4 mb-4 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-4 py-3 bg-[hsl(var(--muted))]/20 border-b border-[hsl(var(--border))]">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Pasta / Arquivos</p>
                  </div>
                  <div className="px-4 py-3 flex items-start gap-2.5">
                    <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]/50" />
                    <span className="flex-1 text-sm text-[hsl(var(--foreground))]/80 break-all leading-snug select-all">{task.folderUrl}</span>
                    <button
                      type="button"
                      title="Copiar"
                      onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                      className="shrink-0 p-1.5 rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* ALTERAÇÕES */}
              {task.revisions.length > 0 && (
                <div className="mx-4 mb-4 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-4 py-3 bg-[hsl(var(--muted))]/20 border-b border-[hsl(var(--border))] flex items-center gap-2">
                    <Zap className="h-3 w-3 text-amber-500" />
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Histórico de alterações</p>
                  </div>
                  <div className="px-4 py-4 space-y-4">
                    {task.revisions.map((r, idx) => (
                      <div key={r.id} className="flex gap-3">
                        <div className="flex flex-col items-center shrink-0">
                          <div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-950/50 border border-amber-300/70 dark:border-amber-700/60 flex items-center justify-center text-[10px] font-bold text-amber-600 shrink-0">
                            {r.revisionNumber}
                          </div>
                          {idx < task.revisions.length - 1 && (
                            <div className="w-px flex-1 mt-1.5 bg-[hsl(var(--border))]" />
                          )}
                        </div>
                        <div className="pb-2 min-w-0 flex-1">
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 mb-1">{fmtDate(r.createdAt)}</p>
                          <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed">{r.comment}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FOOTER */}
              <div className="mx-4 mb-6 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]/30">
                <Clock className="h-3 w-3 shrink-0" />
                <span>Criado {fmtDate(task.createdAt)}</span>
                <span>·</span>
                <span>Atualizado {fmtDate(task.updatedAt)}</span>
              </div>

            </div>{/* end body */}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

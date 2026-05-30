import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import {
  Clock, FolderOpen, RotateCcw, Calendar, Tag,
  Layers, Copy, ChevronRight, Hash, AlertTriangle,
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
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  cancelled: number;
  percentage: number;
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
const COMPLEXITY_CLS:   Record<string, string> = {
  low:    "text-slate-400",
  medium: "text-blue-500",
  high:   "text-purple-500",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed", "cancelled", "paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

const SECTION_LABEL = "text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3";

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
      <DialogContent className="max-w-2xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col rounded-2xl">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando tarefa</DialogTitle>
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {loading ? "Carregando…" : "Tarefa não encontrada"}
              </span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ── Color band ── */}
            <div className="h-[6px] shrink-0 w-full rounded-t-2xl" style={{ background: task.color }} />

            {/* ── Scrollable body ── */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ── HERO HEADER ── */}
              <div
                className="px-6 pt-5 pb-5 border-b"
                style={{ background: `linear-gradient(135deg, ${task.color}10 0%, transparent 70%)` }}
              >
                {/* Breadcrumb para subtarefa */}
                {task.taskType === "subtask" && task.parentTask && (
                  <div className="mb-3">
                    <ParentTaskBreadcrumb parentTask={task.parentTask} onClickParent={onOpenTask} />
                  </div>
                )}

                {/* Code + badges */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  {task.taskCode && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]/60 bg-[hsl(var(--muted))]/60 px-2 py-0.5 rounded-md">
                      <Hash className="h-2.5 w-2.5" />{task.taskCode}
                    </span>
                  )}
                  <Badge className={`${STATUS_CLASS[task.status] ?? ""} text-xs px-2.5 py-0.5`}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
                  <MultiTaskBadge taskType={task.taskType} parentTitle={task.parentTask?.title} />
                </div>

                {/* Title */}
                <h2 className="text-xl sm:text-[22px] font-bold leading-snug tracking-tight mb-2">
                  {task.title}
                </h2>

                {/* Client */}
                {task.client ? (
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50" />
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">{task.client}</span>
                  </div>
                ) : (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/30 italic">Sem cliente</span>
                )}
              </div>

              {/* ── META ROW ── */}
              <div className="px-6 py-3 border-b flex items-center gap-3 flex-wrap bg-[hsl(var(--muted))]/20">
                <PriorityBadge priority={task.priority} showLabel />

                <span className="w-px h-4 bg-[hsl(var(--border))] shrink-0" />

                <div className="flex items-center gap-1.5">
                  <Layers className={`h-3.5 w-3.5 shrink-0 ${COMPLEXITY_CLS[task.complexity] ?? ""}`} />
                  <span className={`text-xs font-medium ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                    {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
                  </span>
                </div>

                {task.dueDate && (
                  <>
                    <span className="w-px h-4 bg-[hsl(var(--border))] shrink-0" />
                    <div className={`flex items-center gap-1.5 ${overdue ? "text-red-500" : "text-[hsl(var(--foreground))]/70"}`}>
                      {overdue
                        ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        : <Calendar className="h-3.5 w-3.5 shrink-0" />}
                      <span className="text-xs font-medium">{fmtDateHuman(task.dueDate)}</span>
                      {overdue && <span className="text-[10px] font-bold">· Atrasada</span>}
                    </div>
                  </>
                )}

                {task.revisionCount > 0 && (
                  <>
                    <span className="w-px h-4 bg-[hsl(var(--border))] shrink-0" />
                    <div className="flex items-center gap-1.5 text-amber-500">
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-semibold">
                        {task.revisionCount} alteraç{task.revisionCount === 1 ? "ão" : "ões"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* ── EQUIPE ── */}
              {(task.createdBy || task.editors?.length > 0) && (
                <div className="px-6 py-4 border-b">
                  <p className={SECTION_LABEL}>Equipe</p>
                  <div className="flex items-center gap-5 flex-wrap">
                    {task.createdBy && (
                      <div className="flex items-center gap-2.5">
                        <AvatarDisplay name={task.createdBy.name} avatarUrl={task.createdBy.avatarUrl ?? null} size={34} />
                        <div>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Coordenador</p>
                          <p className="text-xs font-semibold">{task.createdBy.name.split(" ").slice(0, 2).join(" ")}</p>
                        </div>
                      </div>
                    )}
                    {task.editors?.map(e => (
                      <div key={e.id} className="flex items-center gap-2.5">
                        <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={34} />
                        <div>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Editor</p>
                          <p className="text-xs font-semibold">{e.name.split(" ").slice(0, 2).join(" ")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── PROGRESSO (multi_task) ── */}
              {task.taskType === "multi_task" && task.subtaskProgress && (
                <div className="px-6 py-4 border-b">
                  <p className={SECTION_LABEL}>Progresso</p>
                  <SubtaskProgressBar
                    total={task.subtaskProgress.total}
                    completed={task.subtaskProgress.completed}
                    percentage={task.subtaskProgress.percentage}
                  />
                </div>
              )}

              {/* ── DESCRIÇÃO ── */}
              <div className="px-6 py-4 border-b">
                <p className={SECTION_LABEL}>Descrição</p>
                {task.description ? (
                  <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed whitespace-pre-wrap">
                    {task.description}
                  </p>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]/35 italic">Sem descrição.</p>
                )}
              </div>

              {/* ── SUBTAREFAS ── */}
              {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                <div className="px-6 py-4 border-b">
                  <p className={SECTION_LABEL}>Subtarefas · {task.subtasks.length}</p>
                  <div className="space-y-1.5">
                    {task.subtasks.map(sub => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => onOpenTask?.(sub.id)}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50 hover:border-[hsl(var(--primary))]/30 transition-all group"
                      >
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: sub.status === "completed" ? "#22c55e" : sub.status === "in_progress" ? "#3b82f6" : sub.status === "cancelled" ? "#ef4444" : "#a1a1aa" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{sub.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{STATUS_LABEL[sub.status] ?? sub.status}</span>
                            {sub.assignedTo && (
                              <>
                                <span className="text-[10px] text-[hsl(var(--muted-foreground))]/40">·</span>
                                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{sub.assignedTo.name.split(" ")[0]}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {sub.assignedTo && (
                          <AvatarDisplay name={sub.assignedTo.name} avatarUrl={sub.assignedTo.avatarUrl} style={{ width: 22, height: 22, fontSize: 8, flexShrink: 0 }} />
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/30 group-hover:text-[hsl(var(--primary))] transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── PASTA / ARQUIVOS ── */}
              {task.folderUrl && (
                <div className="px-6 py-4 border-b">
                  <p className={SECTION_LABEL}>Pasta / Arquivos</p>
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]">
                    <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]/60" />
                    <span className="flex-1 text-sm text-[hsl(var(--foreground))] break-all leading-snug select-all">
                      {task.folderUrl}
                    </span>
                    <button
                      type="button"
                      title="Copiar caminho"
                      onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                      className="shrink-0 p-1.5 rounded-lg text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* ── HISTÓRICO DE ALTERAÇÕES ── */}
              {task.revisions.length > 0 && (
                <div className="px-6 py-4 border-b">
                  <p className={SECTION_LABEL}>Histórico de alterações</p>
                  <div className="space-y-3">
                    {task.revisions.map((r, idx) => (
                      <div key={r.id} className="flex gap-3">
                        <div className="flex flex-col items-center shrink-0">
                          <div className="h-6 w-6 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 flex items-center justify-center text-[10px] font-bold text-amber-600">
                            {r.revisionNumber}
                          </div>
                          {idx < task.revisions.length - 1 && (
                            <div className="w-px flex-1 mt-1 bg-[hsl(var(--border))]" />
                          )}
                        </div>
                        <div className="pb-3 min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-semibold text-amber-600">Alteração #{r.revisionNumber}</span>
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{fmtDate(r.createdAt)}</span>
                          </div>
                          <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed">{r.comment}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TIMESTAMPS ── */}
              <div className="px-6 py-3 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]/40">
                <Clock className="h-3 w-3 shrink-0" />
                <span>Criado {fmtDate(task.createdAt)}</span>
                <span>·</span>
                <span>Atualizado {fmtDate(task.updatedAt)}</span>
              </div>

            </div>{/* end scrollable body */}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

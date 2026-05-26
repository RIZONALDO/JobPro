import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import {
  Clock, FolderOpen, RotateCcw, Calendar, Tag,
  Hash, Layers, Copy, ChevronRight,
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
  folderUrl: string | null;
  revisionCount: number;
  createdBy: Person | null;
  assignedTo: Person | null;
  editors: Person[];
  revisions: Revision[];
  createdAt: string;
  updatedAt: string;
  // multi-task
  taskType: string;
  subtasks?: SubtaskSummary[];
  subtaskProgress?: SubtaskProgress;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const COMPLEXITY_CLS: Record<string, string> = {
  low:    "text-slate-500",
  medium: "text-blue-600",
  high:   "text-purple-600",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed", "cancelled", "paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1">
      {children}
    </p>
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
      <DialogContent className="max-w-2xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando tarefa</DialogTitle>
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/30 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {loading ? "Carregando…" : "Tarefa não encontrada"}
              </span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ── TOP ACCENT BAR ── */}
            <div className="h-[3px] shrink-0 w-full" style={{ backgroundColor: task.color }} />

            {/* ── SPLIT BODY ── */}
            <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">

              {/* ══ LEFT SIDEBAR ══ */}
              <div
                className="w-full sm:w-52 shrink-0 flex flex-col sm:border-r border-b sm:border-b-0 overflow-y-auto"
                style={{ backgroundColor: task.color + "0a" }}
              >
                {/* Task ID + status */}
                <div className="px-4 pt-4 pb-3 border-b border-[hsl(var(--border))]/60">
                  {task.taskCode && (
                    <div className="flex items-center gap-1 mb-2">
                      <Hash className="h-3 w-3 text-[hsl(var(--muted-foreground))]/40" />
                      <span className="font-mono text-[10px] text-[hsl(var(--primary))] tracking-wider">
                        {task.taskCode}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Badge className={`${STATUS_CLASS[task.status] ?? ""} text-xs px-2.5 py-0.5 w-fit`}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </Badge>
                    <MultiTaskBadge taskType={task.taskType} parentTitle={task.parentTask?.title} />
                  </div>

                  {/* Progress bar for multi_task */}
                  {task.taskType === "multi_task" && task.subtaskProgress && (
                    <div className="mt-3">
                      <SubtaskProgressBar
                        total={task.subtaskProgress.total}
                        completed={task.subtaskProgress.completed}
                        percentage={task.subtaskProgress.percentage}
                      />
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]/60">
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3.5">
                  {/* Priority */}
                  <div>
                    <SideLabel>Prioridade</SideLabel>
                    <div className="flex items-center gap-1.5">
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>

                  {/* Complexity */}
                  <div>
                    <SideLabel>Complexidade</SideLabel>
                    <div className="flex items-center gap-1.5">
                      <Layers className={`h-3.5 w-3.5 shrink-0 ${COMPLEXITY_CLS[task.complexity] ?? ""}`} />
                      <span className={`text-sm font-semibold ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                        {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
                      </span>
                    </div>
                  </div>

                  {/* Due date / closed date */}
                  <div>
                    {task.status === "completed" ? (
                      <>
                        <SideLabel>Encerrada em</SideLabel>
                        <div className="flex items-center gap-1.5 text-emerald-600">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-sm font-semibold">{fmtDateHuman(task.updatedAt)}</span>
                        </div>
                        {task.dueDate && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50 pl-5">
                            Prazo era {fmtDateHuman(task.dueDate)}
                          </span>
                        )}
                      </>
                    ) : task.status === "cancelled" ? (
                      <>
                        <SideLabel>Cancelada em</SideLabel>
                        <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-sm font-semibold">{fmtDateHuman(task.updatedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <SideLabel>Prazo</SideLabel>
                        {task.dueDate ? (
                          <div className={`flex flex-col gap-0.5 ${overdue ? "text-red-600" : "text-[hsl(var(--foreground))]"}`}>
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 shrink-0" />
                              <span className="text-sm font-semibold">{fmtDateHuman(task.dueDate)}</span>
                            </div>
                            {overdue && (
                              <span className="text-[10px] font-bold text-red-500 pl-5">Atrasada</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-[hsl(var(--muted-foreground))]/40">Sem prazo</span>
                        )}
                      </>
                    )}
                  </div>

                  {/* Revisions */}
                  <div>
                    <SideLabel>Alterações</SideLabel>
                    <div className="flex items-center gap-1.5">
                      <RotateCcw className={`h-3.5 w-3.5 shrink-0 ${task.revisionCount > 0 ? "text-orange-500" : "text-[hsl(var(--muted-foreground))]/30"}`} />
                      <span className={`text-sm font-bold ${task.revisionCount > 0 ? "text-orange-600" : "text-[hsl(var(--muted-foreground))]/30"}`}>
                        {task.revisionCount > 0 ? `${task.revisionCount} solicita${task.revisionCount === 1 ? "ção" : "ções"}` : "Nenhuma"}
                      </span>
                    </div>
                  </div>
                  </div>{/* end grid */}
                </div>

                {/* Team */}
                {(task.createdBy || task.editors?.length > 0) && (
                  <div className="px-4 py-3 border-b border-[hsl(var(--border))]/60">
                    <SideLabel>Equipe</SideLabel>
                    <div className="flex flex-wrap gap-3 sm:block sm:space-y-3">
                    {task.createdBy && (
                      <div className="flex items-center gap-2.5">
                        <AvatarDisplay
                          name={task.createdBy.name}
                          avatarUrl={task.createdBy.avatarUrl ?? null}
                          size={36}
                        />
                        <div className="min-w-0">
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">Coordenador</p>
                          <p className="text-xs font-semibold truncate">{task.createdBy.name}</p>
                        </div>
                      </div>
                    )}
                    {task.editors?.length > 0 && (
                      <div className="flex items-start gap-2.5">
                        <StackedAvatars people={task.editors} size={36} max={4} />
                        <div className="min-w-0">
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">
                            {task.editors.length === 1 ? "Editor" : "Editores"}
                          </p>
                          <p className="text-xs font-semibold leading-snug">
                            {task.editors.map(e => e.name.split(" ")[0]).join(", ")}
                          </p>
                        </div>
                      </div>
                    )}
                    </div>{/* end flex-wrap */}
                  </div>
                )}

                {/* Timestamps — hidden on mobile */}
                <div className="hidden sm:block mt-auto px-4 py-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]/50">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>Criado {fmtDate(task.createdAt)}</span>
                  </div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]/40 pl-[18px]">
                    Atualizado {fmtDate(task.updatedAt)}
                  </p>
                </div>
              </div>

              {/* ══ RIGHT CONTENT ══ */}
              <div className="flex-1 min-w-0 overflow-y-auto flex flex-col">

                {/* Title + client */}
                <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 border-b">
                  {/* Parent breadcrumb for subtasks */}
                  {task.taskType === "subtask" && task.parentTask && (
                    <div className="mb-2">
                      <ParentTaskBreadcrumb
                        parentTask={task.parentTask}
                        onClickParent={onOpenTask}
                      />
                    </div>
                  )}
                  <h2 className="text-lg sm:text-[22px] font-bold leading-tight tracking-tight mb-1.5">
                    {task.title}
                  </h2>
                  {task.client ? (
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                      <span className="text-sm text-[hsl(var(--muted-foreground))]">{task.client}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-[hsl(var(--muted-foreground))]/40">Sem cliente</span>
                  )}
                </div>

                {/* Description */}
                {task.description ? (
                  <div className="px-4 sm:px-6 py-4 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-2">
                      Descrição
                    </p>
                    <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed whitespace-pre-wrap">
                      {task.description}
                    </p>
                  </div>
                ) : (
                  <div className="px-4 sm:px-6 py-4 border-b">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]/40 italic">Sem descrição.</p>
                  </div>
                )}

                {/* Subtasks list — only for multi_task */}
                {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                  <div className="px-4 sm:px-6 py-4 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-3 flex items-center gap-1.5">
                      <Layers className="h-3 w-3" /> Subtarefas ({task.subtasks.length})
                    </p>
                    <div className="space-y-2">
                      {task.subtasks.map(sub => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => onOpenTask?.(sub.id)}
                          className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/40 transition-colors group"
                        >
                          <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_CLASS[sub.status] ? "" : "bg-muted"}`}
                            style={{ backgroundColor: sub.status === "completed" ? "#22c55e" : sub.status === "in_progress" ? "#3b82f6" : sub.status === "cancelled" ? "#ef4444" : "#a1a1aa" }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{sub.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">
                                {STATUS_LABEL[sub.status] ?? sub.status}
                              </span>
                              {sub.assignedTo && (
                                <>
                                  <span className="text-[10px] text-muted-foreground/40">·</span>
                                  <span className="text-[10px] text-muted-foreground">{sub.assignedTo.name.split(" ")[0]}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {sub.assignedTo && (
                            <AvatarDisplay name={sub.assignedTo.name} avatarUrl={sub.assignedTo.avatarUrl} style={{ width: 24, height: 24, fontSize: 8, flexShrink: 0 }} />
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Folder path */}
                {task.folderUrl && (
                  <div className="px-4 sm:px-6 py-3 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-2">
                      Pasta / Arquivos
                    </p>
                    <div className="flex items-start gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]" />
                      <span className="flex-1 text-sm text-[hsl(var(--foreground))] break-all leading-snug select-all">
                        {task.folderUrl}
                      </span>
                      <button
                        type="button"
                        title="Copiar caminho"
                        onClick={() => navigator.clipboard.writeText(task.folderUrl!)}
                        className="shrink-0 p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Revision history */}
                {task.revisions.length > 0 && (
                  <div className="px-4 sm:px-6 py-4 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-3 flex items-center gap-1.5">
                      <RotateCcw className="h-3 w-3" /> Histórico de alterações
                    </p>
                    <div className="space-y-3">
                      {task.revisions.map((r, idx) => (
                        <div key={r.id} className="flex gap-3">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="h-6 w-6 rounded-full bg-orange-100 dark:bg-orange-950/40 border border-orange-300 dark:border-orange-800 flex items-center justify-center text-[10px] font-bold text-orange-600">
                              {r.revisionNumber}
                            </div>
                            {idx < task.revisions.length - 1 && (
                              <div className="w-px flex-1 bg-orange-200 dark:bg-orange-900/40 mt-1" />
                            )}
                          </div>
                          <div className="pb-3 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-semibold text-orange-600">
                                Alteração #{r.revisionNumber}
                              </span>
                              <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/40" />
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                {fmtDate(r.createdAt)}
                              </span>
                            </div>
                            <p className="text-xs text-[hsl(var(--foreground))] leading-relaxed">{r.comment}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

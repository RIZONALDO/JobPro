import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import {
  Clock, FolderOpen, RotateCcw, Calendar,
  AlertTriangle, Layers, Copy, ChevronRight, Tag,
} from "lucide-react";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }

interface SubtaskSummary {
  id: number; taskCode?: string; title: string; status: string;
  assignedTo: Person | null; editors: Person[]; subtaskOrder: number;
}
interface SubtaskProgress {
  total: number; completed: number; inProgress: number;
  pending: number; cancelled: number; percentage: number;
}
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string; priority: string;
  complexity: string; dueDate: string | null; startDate?: string | null;
  folderUrl: string | null; revisionCount: number;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  revisions: Revision[]; createdAt: string; updatedAt: string;
  taskType: string; subtasks?: SubtaskSummary[];
  subtaskProgress?: SubtaskProgress;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const COMPLEXITY_CLS:   Record<string, string> = {
  low: "text-slate-400", medium: "text-blue-500", high: "text-purple-500",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed","cancelled","paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1.5">
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
      <DialogContent className="max-w-2xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-2xl">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando</DialogTitle>
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ── BARRA DE COR + CABEÇALHO ── */}
            <div className="shrink-0">
              <div className="h-[3px] w-full" style={{ background: task.color }} />
              <div className="px-5 sm:px-6 py-4 border-b border-[hsl(var(--border))]">
                {task.taskType === "subtask" && task.parentTask && (
                  <div className="mb-2">
                    <ParentTaskBreadcrumb parentTask={task.parentTask} onClickParent={onOpenTask} />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold leading-snug text-[hsl(var(--foreground))]">
                      {task.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    <Badge className={`${STATUS_CLASS[task.status] ?? ""} text-xs px-2.5 py-0.5 shrink-0`}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </Badge>
                    <MultiTaskBadge taskType={task.taskType} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── SPLIT: coluna principal + sidebar ── */}
            <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">

              {/* ══ COLUNA PRINCIPAL ══ */}
              <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">

                {/* Descrição */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50">Descrição</p>
                  {task.description ? (
                    <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed whitespace-pre-wrap">
                      {task.description}
                    </p>
                  ) : (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem descrição.</p>
                  )}
                </div>

                {/* Subtarefas */}
                {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1.5">
                      <Layers className="h-3 w-3" /> Subtarefas ({task.subtasks.length})
                    </p>
                    <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]/60">
                      {task.subtasks.map(sub => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => onOpenTask?.(sub.id)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--muted))]/40 transition-colors group"
                        >
                          <div
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: sub.status === "completed" ? "#22c55e" : sub.status === "in_progress" ? "#3b82f6" : sub.status === "cancelled" ? "#ef4444" : "#a1a1aa" }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{sub.title}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 mt-0.5">
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

                {/* Pasta */}
                {task.folderUrl && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50">Pasta / Arquivos</p>
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]">
                      <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]/50" />
                      <span className="flex-1 text-sm text-[hsl(var(--foreground))]/70 break-all leading-snug select-all">{task.folderUrl}</span>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                        className="shrink-0 p-1 rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Histórico de alterações */}
                {task.revisions.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1.5">
                      <RotateCcw className="h-3 w-3" /> Histórico de alterações
                    </p>
                    <div className="space-y-3">
                      {task.revisions.map((r, idx) => (
                        <div key={r.id} className="flex gap-3">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="h-6 w-6 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center text-[10px] font-bold text-amber-600">
                              {r.revisionNumber}
                            </div>
                            {idx < task.revisions.length - 1 && (
                              <div className="w-px flex-1 mt-1 bg-[hsl(var(--border))]" />
                            )}
                          </div>
                          <div className="pb-2 min-w-0 flex-1">
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]/40 mb-1">{fmtDate(r.createdAt)}</p>
                            <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed">{r.comment}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]/30 pt-1">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>Criado {fmtDate(task.createdAt)}</span>
                  <span>·</span>
                  <span>Atualizado {fmtDate(task.updatedAt)}</span>
                </div>
              </div>

              {/* ══ SIDEBAR ══ */}
              <div className="w-full sm:w-60 lg:w-64 shrink-0 border-t sm:border-t-0 sm:border-l border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/15 overflow-y-auto px-4 py-5 space-y-5">

                {/* Número sequencial */}
                {task.taskCode && (
                  <div>
                    <SideLabel>Número</SideLabel>
                    <span className="font-mono text-base font-bold text-[hsl(var(--foreground))]">
                      {task.taskCode}
                    </span>
                  </div>
                )}

                {/* Cliente */}
                <div>
                  <SideLabel>Cliente</SideLabel>
                  {task.client ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
                      {task.client}
                    </div>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]/30">—</span>
                  )}
                </div>

                {/* Datas */}
                <div>
                  <SideLabel>Período</SideLabel>
                  <div className="space-y-1">
                    {task.startDate && (
                      <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 w-10 shrink-0">Início</span>
                        <span className="font-medium text-[hsl(var(--foreground))]">{fmtDateHuman(task.startDate)}</span>
                      </div>
                    )}
                    {task.dueDate ? (
                      <div className={`flex items-center gap-1.5 text-sm ${overdue ? "text-red-500" : "text-[hsl(var(--muted-foreground))]"}`}>
                        {overdue
                          ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          : <Calendar className="h-3.5 w-3.5 shrink-0" />}
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 w-10 shrink-0">Prazo</span>
                        <span className={`font-medium ${overdue ? "text-red-500" : "text-[hsl(var(--foreground))]"}`}>{fmtDateHuman(task.dueDate)}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-[hsl(var(--muted-foreground))]/30">Sem prazo</span>
                    )}
                    {overdue && <p className="text-[10px] font-bold text-red-500 pl-5">Atrasada</p>}
                  </div>
                </div>

                {/* Prioridade */}
                <div>
                  <SideLabel>Prioridade</SideLabel>
                  <PriorityBadge priority={task.priority} showLabel className="text-sm" />
                </div>

                {/* Complexidade */}
                <div>
                  <SideLabel>Complexidade</SideLabel>
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                    <Layers className="h-3.5 w-3.5 shrink-0" />
                    {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
                  </div>
                </div>

                {/* Equipe */}
                {(task.createdBy || task.editors?.length > 0) && (
                  <div>
                    <SideLabel>Equipe</SideLabel>
                    <div className="space-y-2">
                      {task.createdBy && (
                        <div className="flex items-center gap-2">
                          <AvatarDisplay name={task.createdBy.name} avatarUrl={task.createdBy.avatarUrl ?? null} size={28} />
                          <div className="min-w-0">
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Coordenador</p>
                            <p className="text-xs font-semibold truncate">{task.createdBy.name}</p>
                          </div>
                        </div>
                      )}
                      {task.editors?.map(e => (
                        <div key={e.id} className="flex items-center gap-2">
                          <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={28} />
                          <div className="min-w-0">
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Editor</p>
                            <p className="text-xs font-semibold truncate">{e.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Progresso multi_task */}
                {task.taskType === "multi_task" && task.subtaskProgress && (
                  <div>
                    <SideLabel>Progresso</SideLabel>
                    <SubtaskProgressBar
                      total={task.subtaskProgress.total}
                      completed={task.subtaskProgress.completed}
                      percentage={task.subtaskProgress.percentage}
                    />
                  </div>
                )}

                {/* Alterações */}
                {task.revisionCount > 0 && (
                  <div>
                    <SideLabel>Alterações</SideLabel>
                    <div className="flex items-center gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                        {task.revisionCount} solicitaç{task.revisionCount === 1 ? "ão" : "ões"}
                      </span>
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

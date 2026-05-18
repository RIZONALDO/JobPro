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

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }

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

interface Props { taskId: number; onClose: () => void; }

export function TaskModal({ taskId, onClose }: Props) {
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
                      <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]/50 tracking-wider">
                        {task.taskCode}
                      </span>
                    </div>
                  )}
                  <Badge className={`${STATUS_CLASS[task.status] ?? ""} text-xs px-2.5 py-0.5 w-fit`}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
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

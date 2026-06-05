import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { fmtDate } from "@/lib/utils";
import {
  Clock, FolderOpen, RotateCcw, Calendar, AlertTriangle,
  Layers, Copy, ChevronRight, Hash, Tag, Zap,
  Film, Music, Download, Link2, Trash2, FileVideo,
} from "lucide-react";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; createdAt: string;
  uploaderName: string | null;
}

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
const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-400", in_progress: "bg-blue-500", review: "bg-violet-500",
  in_revision: "bg-amber-500", completed: "bg-emerald-500",
  cancelled: "bg-red-500", paused: "bg-purple-400",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed","cancelled","paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

interface Props { taskId: number; onClose: () => void; onOpenTask?: (id: number) => void; }

export function TaskModal({ taskId, onClose, onOpenTask }: Props) {
  const [task,    setTask]    = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [files,   setFiles]   = useState<TaskFile[]>([]);
  const [sharing, setSharing] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${taskId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`).catch(() => [] as TaskFile[]),
    ]).then(([t, f]) => { setTask(t); setFiles(f); })
      .catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const generateLink = async (fileId: number) => {
    setSharing(fileId);
    try {
      const { token } = await apiPost<{ token: string }>(`/api/tasks/${taskId}/files/${fileId}/share`, {});
      const url = `${window.location.origin}/p/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: token } : f));
    } catch { toast.error("Erro ao gerar link"); }
    finally { setSharing(null); }
  };

  const revokeLink = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}/share`);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: null } : f));
      toast.success("Link revogado");
    } catch { toast.error("Erro ao revogar link"); }
  };

  const removeFile = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success("Arquivo removido");
    } catch { toast.error("Erro ao remover arquivo"); }
  };

  function fmtSize(b: number | null) {
    if (!b) return "";
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  const overdue = task ? isOverdue(task.dueDate, task.status) : false;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col rounded-2xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))]">

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

            {/* ── HEADER ── */}
            <div className="shrink-0 px-6 pt-6 pb-5 border-b border-[hsl(var(--border))]">
              {/* breadcrumb subtarefa */}
              {task.taskType === "subtask" && task.parentTask && (
                <div className="mb-3">
                  <ParentTaskBreadcrumb parentTask={task.parentTask} onClickParent={onOpenTask} />
                </div>
              )}

              {/* número sequencial + título */}
              <h2 className="text-[20px] font-bold leading-snug tracking-tight text-[hsl(var(--foreground))] mb-3 flex items-baseline gap-2 flex-wrap">
                {task.taskCode && (
                  <>
                    <span className="font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span>
                    <span className="text-[hsl(var(--muted-foreground))]/30 shrink-0">|</span>
                  </>
                )}
                <span>{task.title}</span>
              </h2>

              {/* linha de metadados: status · tipo · alterações · cliente */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none ${STATUS_CHIP[task.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                <MultiTaskBadge taskType={task.taskType} />
                {task.revisionCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40">
                    <RotateCcw className="h-3 w-3" />{task.revisionCount} alt.
                  </span>
                )}
                <span className="text-[hsl(var(--border))]">·</span>
                <span className="text-[11px] flex items-center gap-1">
                  <Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))]/40" />
                  {task.client
                    ? <span className="text-[hsl(var(--muted-foreground))]/60">{task.client}</span>
                    : <span className="text-[hsl(var(--muted-foreground))]/25 italic">Sem cliente</span>
                  }
                </span>
              </div>
            </div>

            {/* ── CORPO SCROLLÁVEL ── */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* PROPRIEDADES — grid 2×2 */}
              <div className="grid grid-cols-2 divide-x divide-y divide-[hsl(var(--border))] border-b border-[hsl(var(--border))]">

                <div className="px-5 py-3.5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5 flex items-center gap-1"><Clock className="h-3 w-3 shrink-0 text-current" />Entrega</p>
                  {task.dueDate ? (
                    <div className={`flex items-center gap-1.5 ${overdue ? "text-red-500" : "text-[hsl(var(--foreground))]"}`}>
                      {overdue
                        ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        : <Calendar className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]/60" />}
                      <span className="text-sm font-semibold">{fmtDate(task.dueDate)}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]/30">—</span>
                  )}
                  {overdue && <p className="text-[10px] font-bold text-red-500 mt-0.5">Atrasada</p>}
                </div>

                <div className="px-5 py-3.5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Prioridade</p>
                  <PriorityBadge priority={task.priority} showLabel className="text-sm" />
                </div>

                <div className="px-5 py-3.5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Complexidade</p>
                  <div className={`flex items-center gap-1.5 ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                    <Layers className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-sm font-semibold">{COMPLEXITY_LABEL[task.complexity] ?? task.complexity}</span>
                  </div>
                </div>

                <div className="px-5 py-3.5">
                  {task.taskType === "multi_task" && task.subtaskProgress ? (
                    <>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Progresso</p>
                      <SubtaskProgressBar
                        total={task.subtaskProgress.total}
                        completed={task.subtaskProgress.completed}
                        percentage={task.subtaskProgress.percentage}
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Atualizado</p>
                      <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{fmtDate(task.updatedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* EQUIPE */}
              <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Equipe</p>
                {(task.createdBy || task.editors?.length > 0) ? (
                  <div className="flex flex-wrap gap-2">
                    {task.createdBy && (
                      <div className="flex items-center gap-2 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl px-3 py-2">
                        <AvatarDisplay name={task.createdBy.name} avatarUrl={task.createdBy.avatarUrl ?? null} size={26} />
                        <div>
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Coordenador</p>
                          <p className="text-xs font-semibold leading-none">{task.createdBy.name.split(" ").slice(0,2).join(" ")}</p>
                        </div>
                      </div>
                    )}
                    {task.editors?.map(e => (
                      <div key={e.id} className="flex items-center gap-2 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl px-3 py-2">
                        <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={26} />
                        <div>
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Editor</p>
                          <p className="text-xs font-semibold leading-none">{e.name.split(" ").slice(0,2).join(" ")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem equipe atribuída.</p>
                )}
              </div>

              {/* DESCRIÇÃO */}
              <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Direcionamento</p>
                {task.description ? (
                  <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem descrição.</p>
                )}
              </div>

              {/* SUBTAREFAS */}
              {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">
                    Subtarefas · {task.subtasks.length}
                  </p>
                  <div className="space-y-1">
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

              {/* PASTA */}
              <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Pasta / Arquivos</p>
                {task.folderUrl ? (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]">
                    <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]/50" />
                    <span className="flex-1 text-sm text-[hsl(var(--foreground))]/70 break-all leading-snug select-all">{task.folderUrl}</span>
                    <button
                      type="button"
                      title="Copiar"
                      onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                      className="shrink-0 p-1 rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/20 border border-dashed border-[hsl(var(--border))]">
                    <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]/25" />
                    <span className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Nenhuma pasta vinculada.</span>
                  </div>
                )}
              </div>

              {/* ALTERAÇÕES */}
              <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                <div className="flex items-center gap-1.5 mb-3">
                  <Zap className="h-3 w-3 text-amber-500" />
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Histórico de alterações</p>
                </div>
                {task.revisions.length > 0 ? (
                  <div className="space-y-4">
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
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/40 mb-1">{fmtDate(r.createdAt)}</p>
                          <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed">{r.comment}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Nenhuma alteração solicitada.</p>
                )}
              </div>

              {/* ARQUIVOS */}
              {files.length > 0 && (
                <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                  <div className="flex items-center gap-1.5 mb-3">
                    <FileVideo className="h-3 w-3 text-violet-500" />
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">
                      Arquivos entregues · {files.length}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {files.map(f => {
                      const isVideo = f.mimeType?.startsWith("video/");
                      const isAudio = f.mimeType?.startsWith("audio/");
                      return (
                        <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]">
                          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            {isVideo ? <Film className="h-4 w-4 text-violet-500" />
                              : isAudio ? <Music className="h-4 w-4 text-violet-500" />
                              : <Film className="h-4 w-4 text-violet-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{f.fileName}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                              {fmtSize(f.fileSize)}
                              {f.uploaderName && ` · ${f.uploaderName.split(" ")[0]}`}
                              {f.revisionNumber > 0 && ` · Alt. ${f.revisionNumber}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Download */}
                            <a
                              href={f.publicToken
                                ? `/api/public/${f.publicToken}/download`
                                : `/api/tasks/${taskId}/files/${f.id}/download`}
                              download={f.fileName}
                              title="Baixar"
                              className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                            {/* Link público */}
                            {f.publicToken ? (
                              <button
                                title="Link ativo — clique para copiar"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(`${window.location.origin}/p/${f.publicToken}`);
                                  toast.success("Link copiado");
                                }}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                title="Gerar link público"
                                onClick={() => generateLink(f.id)}
                                disabled={sharing === f.id}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors disabled:opacity-40"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {/* Remover */}
                            <button
                              title="Remover arquivo"
                              onClick={() => removeFile(f.id)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* FOOTER timestamps */}
              <div className="px-5 py-3 flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]/30">
                <span>Criado em {fmtDate(task.createdAt)}</span>
              </div>

            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

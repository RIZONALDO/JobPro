import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPut } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import {
  Clock, FolderOpen, AlertTriangle, CheckCircle2,
  RotateCcw, Calendar, Tag, PauseCircle, XCircle, PlayCircle,
  Hash, Layers, ExternalLink, ChevronRight,
} from "lucide-react";

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
  revisions: Revision[];
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_LABEL: Record<string, string>  = { low: "Baixa", medium: "Média", high: "Alta" };
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const PRIORITY_DOT: Record<string, string> = {
  low:    "bg-green-500",
  medium: "bg-amber-500",
  high:   "bg-red-500",
};

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
  const { user } = useAuth();
  const { toast } = useToast();
  const [task,             setTask]             = useState<TaskDetail | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [revisionComment,  setRevisionComment]  = useState("");
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [submitting,       setSubmitting]       = useState(false);
  const [confirmAction,    setConfirmAction]    = useState<"cancel" | "pause" | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<TaskDetail>(`/api/tasks/${taskId}`)
      .then(setTask)
      .catch(() => toast({ title: "Erro ao carregar tarefa", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const isCoord  = user?.role !== "editor";
  const INACTIVE = ["completed", "cancelled"];
  const canApprove = isCoord && task?.status === "review";
  const canPause   = isCoord && task !== null && !INACTIVE.includes(task.status) && task.status !== "paused";
  const canCancel  = isCoord && task !== null && !INACTIVE.includes(task.status);
  const canResume  = isCoord && task?.status === "paused";
  const hasActions = canApprove || canPause || canCancel || canResume;

  const approve = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      await apiPut(`/api/tasks/${task.id}`, { status: "completed" });
      toast({ title: "Tarefa aprovada" });
      load();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const submitRevision = async () => {
    if (!task || !revisionComment.trim()) return;
    setSubmitting(true);
    try {
      await apiPut(`/api/tasks/${task.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast({ title: "Alteração solicitada" });
      setRevisionComment(""); setShowRevisionForm(false); load();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const performAction = async (action: "cancel" | "pause" | "resume") => {
    if (!task) return;
    setSubmitting(true);
    try {
      const statusMap = { cancel: "cancelled", pause: "paused", resume: "pending" };
      await apiPut(`/api/tasks/${task.id}`, { status: statusMap[action] });
      toast({ title: { cancel: "Tarefa cancelada", pause: "Tarefa pausada", resume: "Tarefa retomada" }[action] });
      setConfirmAction(null); load();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const overdue = task ? isOverdue(task.dueDate, task.status) : false;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">

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
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* ══ LEFT SIDEBAR ══ */}
              <div
                className="w-52 shrink-0 flex flex-col border-r overflow-y-auto"
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
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]/60 space-y-3.5">
                  {/* Priority */}
                  <div>
                    <SideLabel>Prioridade</SideLabel>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? "bg-muted"}`} />
                      <span className="text-sm font-semibold">{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
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

                  {/* Due date */}
                  <div>
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
                </div>

                {/* Team */}
                {(task.createdBy || task.assignedTo) && (
                  <div className="px-4 py-3 border-b border-[hsl(var(--border))]/60 space-y-3">
                    <SideLabel>Equipe</SideLabel>
                    {task.createdBy && (
                      <div className="flex items-center gap-2.5">
                        <AvatarDisplay
                          name={task.createdBy.name}
                          avatarUrl={task.createdBy.avatarUrl ?? null}
                          style={{ width: 30, height: 30, fontSize: 10, flexShrink: 0 }}
                        />
                        <div className="min-w-0">
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">Coordenador</p>
                          <p className="text-xs font-semibold truncate">{task.createdBy.name}</p>
                        </div>
                      </div>
                    )}
                    {task.assignedTo && (
                      <div className="flex items-center gap-2.5">
                        <AvatarDisplay
                          name={task.assignedTo.name}
                          avatarUrl={task.assignedTo.avatarUrl ?? null}
                          style={{ width: 30, height: 30, fontSize: 10, flexShrink: 0 }}
                        />
                        <div className="min-w-0">
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">Editor</p>
                          <p className="text-xs font-semibold truncate">{task.assignedTo.name}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Timestamps */}
                <div className="mt-auto px-4 py-3 space-y-1">
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
                <div className="px-6 pt-5 pb-4 border-b">
                  <h2 className="text-[22px] font-bold leading-tight tracking-tight mb-1.5">
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
                  <div className="px-6 py-4 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-2">
                      Descrição
                    </p>
                    <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed whitespace-pre-wrap">
                      {task.description}
                    </p>
                  </div>
                ) : (
                  <div className="px-6 py-4 border-b">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]/40 italic">Sem descrição.</p>
                  </div>
                )}

                {/* Folder link */}
                {task.folderUrl && (
                  <div className="px-6 py-3 border-b">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-2">
                      Pasta / Arquivos
                    </p>
                    <a
                      href={task.folderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-[hsl(var(--primary))] hover:underline group"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0" />
                      <span className="break-all leading-snug">{task.folderUrl}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  </div>
                )}

                {/* Revision history */}
                {task.revisions.length > 0 && (
                  <div className="px-6 py-4 border-b">
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

                {/* Revision form */}
                {showRevisionForm && (
                  <div className="px-6 py-4 border-t space-y-3 bg-orange-50/60 dark:bg-orange-950/10">
                    <Label className="text-sm font-semibold text-orange-700">
                      Descreva a alteração solicitada
                    </Label>
                    <Textarea
                      value={revisionComment}
                      onChange={e => setRevisionComment(e.target.value)}
                      placeholder="Descreva detalhadamente o que precisa ser alterado…"
                      rows={4}
                      className="resize-none"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1"
                        onClick={() => { setShowRevisionForm(false); setRevisionComment(""); }}>
                        Cancelar
                      </Button>
                      <Button
                        className="flex-1 bg-orange-600 hover:bg-orange-700 gap-1.5"
                        onClick={submitRevision}
                        disabled={!revisionComment.trim() || submitting}
                      >
                        <AlertTriangle className="h-4 w-4" />
                        {submitting ? "Enviando…" : "Solicitar alteração"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Confirm strip */}
                {confirmAction !== null && (
                  <div className="px-6 py-4 border-t bg-red-50/60 dark:bg-red-950/10 space-y-3">
                    <p className="text-sm text-red-700 font-medium">
                      {confirmAction === "cancel"
                        ? "Tem certeza que deseja cancelar esta tarefa? Esta ação não pode ser desfeita."
                        : "Tem certeza que deseja pausar esta tarefa?"}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1"
                        onClick={() => setConfirmAction(null)} disabled={submitting}>
                        Voltar
                      </Button>
                      <Button
                        className={`flex-1 gap-1.5 ${confirmAction === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}`}
                        onClick={() => performAction(confirmAction)}
                        disabled={submitting}
                      >
                        {confirmAction === "cancel"
                          ? <><XCircle className="h-4 w-4" />{submitting ? "Cancelando…" : "Cancelar tarefa"}</>
                          : <><PauseCircle className="h-4 w-4" />{submitting ? "Pausando…" : "Pausar tarefa"}</>}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── ACTIONS FOOTER ── */}
            {isCoord && !showRevisionForm && confirmAction === null && hasActions && (
              <div className="border-t px-6 py-3 flex flex-wrap gap-2 shrink-0 bg-[hsl(var(--card))]">
                {canApprove && (
                  <Button className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 gap-1.5 h-9"
                    onClick={approve} disabled={submitting}>
                    <CheckCircle2 className="h-4 w-4" /> Aprovar
                  </Button>
                )}
                {canApprove && (
                  <Button variant="outline" className="flex-1 min-w-[140px] text-orange-600 border-orange-300 hover:bg-orange-50 gap-1.5 h-9"
                    onClick={() => setShowRevisionForm(true)}>
                    <AlertTriangle className="h-4 w-4" /> Solicitar alteração
                  </Button>
                )}
                {canResume && (
                  <Button variant="outline" className="flex-1 min-w-[100px] text-purple-700 border-purple-300 hover:bg-purple-50 gap-1.5 h-9"
                    onClick={() => performAction("resume")} disabled={submitting}>
                    <PlayCircle className="h-4 w-4" /> Retomar
                  </Button>
                )}
                {canPause && (
                  <Button variant="outline" className="flex-1 min-w-[100px] text-purple-700 border-purple-300 hover:bg-purple-50 gap-1.5 h-9"
                    onClick={() => setConfirmAction("pause")} disabled={submitting}>
                    <PauseCircle className="h-4 w-4" /> Pausar
                  </Button>
                )}
                {canCancel && (
                  <Button variant="outline" className="flex-1 min-w-[100px] text-red-600 border-red-300 hover:bg-red-50 gap-1.5 h-9"
                    onClick={() => setConfirmAction("cancel")} disabled={submitting}>
                    <XCircle className="h-4 w-4" /> Cancelar
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

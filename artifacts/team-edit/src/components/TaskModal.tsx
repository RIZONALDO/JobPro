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
  Clock, User, FolderOpen, AlertTriangle, CheckCircle2,
  RotateCcw, Calendar, Tag, PauseCircle, XCircle, PlayCircle,
  Hash, Layers, Zap, ExternalLink,
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

const PRIORITY_CLS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
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
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">

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

            {/* ── Accent bar ── */}
            <div className="h-[3px] shrink-0 w-full" style={{ backgroundColor: task.color }} />

            {/* ── Scrollable body ── */}
            <div className="overflow-y-auto flex-1 min-h-0">

              {/* ── HEADER ── */}
              <div className="px-6 pt-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {task.taskCode && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Hash className="h-3 w-3 text-[hsl(var(--muted-foreground))]/50" />
                        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]/60 tracking-wide">
                          {task.taskCode}
                        </span>
                      </div>
                    )}
                    <h2 className="text-xl font-bold leading-snug tracking-tight">{task.title}</h2>
                    {task.client && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                        <span className="text-sm text-[hsl(var(--muted-foreground))]">{task.client}</span>
                      </div>
                    )}
                  </div>
                  <Badge className={`${STATUS_CLASS[task.status] ?? ""} shrink-0 text-xs px-2.5 py-1`}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
                </div>
              </div>

              {/* ── PROPERTIES ── */}
              <div className="border-t bg-[hsl(var(--muted))]/20 px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
                {/* Priority */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1.5">Prioridade</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${PRIORITY_CLS[task.priority] ?? ""}`}>
                    {PRIORITY_LABEL[task.priority] ?? task.priority}
                  </span>
                </div>

                {/* Complexity */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1.5">Complexidade</p>
                  <div className="flex items-center gap-1">
                    <Layers className={`h-3.5 w-3.5 ${COMPLEXITY_CLS[task.complexity] ?? ""}`} />
                    <span className={`text-sm font-semibold ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                      {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
                    </span>
                  </div>
                </div>

                {/* Due date */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1.5">Prazo</p>
                  {task.dueDate ? (
                    <div className={`flex items-center gap-1 ${overdue ? "text-red-600" : "text-[hsl(var(--foreground))]"}`}>
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-sm font-semibold">{fmtDateHuman(task.dueDate)}</span>
                      {overdue && <span className="text-[10px] font-bold text-red-500 ml-0.5">atrasada</span>}
                    </div>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]/40">—</span>
                  )}
                </div>

                {/* Revisions */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1.5">Alterações</p>
                  <div className="flex items-center gap-1">
                    <RotateCcw className={`h-3.5 w-3.5 ${task.revisionCount > 0 ? "text-orange-500" : "text-[hsl(var(--muted-foreground))]/40"}`} />
                    <span className={`text-sm font-bold ${task.revisionCount > 0 ? "text-orange-600" : "text-[hsl(var(--muted-foreground))]/40"}`}>
                      {task.revisionCount > 0 ? `${task.revisionCount}×` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── TEAM ── */}
              {(task.createdBy || task.assignedTo) && (
                <div className="border-t px-6 py-4">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-3">Equipe</p>
                  <div className="flex flex-col gap-3">
                    {task.createdBy && (
                      <div className="flex items-center gap-3">
                        <AvatarDisplay
                          name={task.createdBy.name}
                          avatarUrl={task.createdBy.avatarUrl ?? null}
                          style={{ width: 32, height: 32, fontSize: 11, flexShrink: 0 }}
                        />
                        <div className="min-w-0">
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">Coordenador</p>
                          <p className="text-sm font-semibold leading-none truncate">{task.createdBy.name}</p>
                        </div>
                      </div>
                    )}
                    {task.assignedTo && (
                      <div className="flex items-center gap-3">
                        <AvatarDisplay
                          name={task.assignedTo.name}
                          avatarUrl={task.assignedTo.avatarUrl ?? null}
                          style={{ width: 32, height: 32, fontSize: 11, flexShrink: 0 }}
                        />
                        <div className="min-w-0">
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">Editor</p>
                          <p className="text-sm font-semibold leading-none truncate">{task.assignedTo.name}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── DESCRIPTION ── */}
              {task.description && (
                <div className="border-t px-6 py-4">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-2">Descrição</p>
                  <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed whitespace-pre-wrap">{task.description}</p>
                </div>
              )}

              {/* ── FOLDER LINK ── */}
              {task.folderUrl && (
                <div className="border-t px-6 py-4">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-2">Pasta / Link</p>
                  <a
                    href={task.folderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-sm text-[hsl(var(--primary))] hover:underline group"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="break-all leading-snug">{task.folderUrl}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                </div>
              )}

              {/* ── TIMESTAMPS ── */}
              <div className="border-t bg-[hsl(var(--muted))]/10 px-6 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-[hsl(var(--muted-foreground))]/50" />
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]/60">Criado {fmtDate(task.createdAt)}</span>
                </div>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]/60">
                  Atualizado {fmtDate(task.updatedAt)}
                </span>
              </div>

              {/* ── REVISION HISTORY ── */}
              {task.revisions.length > 0 && (
                <div className="border-t px-6 py-4">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-3 flex items-center gap-1.5">
                    <RotateCcw className="h-3 w-3" /> Histórico de alterações
                  </p>
                  <div className="flex flex-col gap-3">
                    {task.revisions.map(r => (
                      <div key={r.id} className="relative pl-5">
                        <div className="absolute left-0 top-0 bottom-0 w-px bg-orange-200 dark:bg-orange-900" />
                        <div className="absolute left-[-4px] top-[6px] w-2 h-2 rounded-full bg-orange-400 ring-2 ring-[hsl(var(--background))]" />
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-orange-600">Alteração #{r.revisionNumber}</span>
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmtDate(r.createdAt)}</span>
                        </div>
                        <p className="text-xs text-[hsl(var(--foreground))] leading-relaxed">{r.comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── REVISION FORM ── */}
              {showRevisionForm && (
                <div className="border-t px-6 py-4 space-y-3 bg-orange-50/60 dark:bg-orange-950/10">
                  <Label className="text-sm font-semibold text-orange-700">Descreva a alteração solicitada</Label>
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

              {/* ── CONFIRM STRIP ── */}
              {confirmAction !== null && (
                <div className="border-t px-6 py-4 bg-red-50/60 dark:bg-red-950/10 space-y-3">
                  <p className="text-sm text-red-700 font-medium">
                    {confirmAction === "cancel"
                      ? "Tem certeza que deseja cancelar esta tarefa? Esta ação não pode ser desfeita."
                      : "Tem certeza que deseja pausar esta tarefa?"}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setConfirmAction(null)} disabled={submitting}>
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

            {/* ── ACTIONS FOOTER ── */}
            {isCoord && !showRevisionForm && confirmAction === null && hasActions && (
              <div className="border-t px-6 py-3 flex flex-wrap gap-2 shrink-0 bg-[hsl(var(--card))]">
                {canApprove && (
                  <Button className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 gap-1.5 h-9" onClick={approve} disabled={submitting}>
                    <CheckCircle2 className="h-4 w-4" /> Aprovar
                  </Button>
                )}
                {canApprove && (
                  <Button variant="outline" className="flex-1 min-w-[120px] text-orange-600 border-orange-300 hover:bg-orange-50 gap-1.5 h-9"
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

import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPut } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate } from "@/lib/utils";
import {
  Clock, User, FolderOpen, AlertTriangle, CheckCircle2,
  RotateCcw, Calendar, Tag,
} from "lucide-react";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }

interface TaskDetail {
  id: number;
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

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const PRIORITY_CLS: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-red-100 text-red-700 border-red-200",
};

interface Props { taskId: number; onClose: () => void; }

export function TaskModal({ taskId, onClose }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [revisionComment, setRevisionComment] = useState("");
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<TaskDetail>(`/api/tasks/${taskId}`)
      .then(setTask)
      .catch(() => toast({ title: "Erro ao carregar tarefa", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const isCoord = user?.role !== "editor";
  const canApprove = isCoord && task?.status === "review";

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
      setRevisionComment("");
      setShowRevisionForm(false);
      load();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {loading || !task ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            {loading ? "Carregando..." : "Tarefa não encontrada"}
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="h-3 w-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: task.color }} />
                <div className="min-w-0">
                  <DialogTitle className="text-left leading-snug">{task.title}</DialogTitle>
                  {task.client && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 flex items-center gap-1">
                      <Tag className="h-3 w-3" />{task.client}
                    </p>
                  )}
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Status badges */}
              <div className="flex flex-wrap gap-2">
                <Badge className={STATUS_CLASS[task.status] ?? ""}>{STATUS_LABEL[task.status] ?? task.status}</Badge>
                <Badge variant="outline" className={PRIORITY_CLS[task.priority] ?? ""}>
                  {PRIORITY_LABEL[task.priority] ?? task.priority}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {COMPLEXITY_LABEL[task.complexity] ?? task.complexity}
                </Badge>
                {task.revisionCount > 0 && (
                  <Badge variant="outline" className="text-orange-600 border-orange-300">
                    {task.revisionCount}× alteração
                  </Badge>
                )}
              </div>

              {/* Description */}
              {task.description && (
                <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{task.description}</p>
              )}

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {task.dueDate && (
                  <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>Prazo: <strong className="text-[hsl(var(--foreground))]">{fmtDate(task.dueDate)}</strong></span>
                  </div>
                )}
                {task.assignedTo && (
                  <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span>Editor: <strong className="text-[hsl(var(--foreground))]">{task.assignedTo.name}</strong></span>
                  </div>
                )}
                {task.createdBy && (
                  <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                    <User className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span>Criado por: <strong className="text-[hsl(var(--foreground))]">{task.createdBy.name}</strong></span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{fmtDate(task.createdAt)}</span>
                </div>
              </div>

              {/* Folder link */}
              {task.folderUrl && (
                <a href={task.folderUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:underline">
                  <FolderOpen className="h-3.5 w-3.5" /> Abrir pasta do projeto
                </a>
              )}

              {/* Revision history */}
              {task.revisions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide flex items-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" /> Histórico de alterações
                  </p>
                  <div className="space-y-2">
                    {task.revisions.map(r => (
                      <div key={r.id} className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-orange-600">Alteração #{r.revisionNumber}</span>
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmtDate(r.createdAt)}</span>
                        </div>
                        <p className="text-xs text-[hsl(var(--foreground))] leading-snug">{r.comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Coordinator actions */}
              {canApprove && !showRevisionForm && (
                <div className="flex gap-2 pt-2 border-t">
                  <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-1.5" onClick={approve} disabled={submitting}>
                    <CheckCircle2 className="h-4 w-4" /> Aprovar
                  </Button>
                  <Button variant="outline" className="flex-1 text-orange-600 border-orange-300 hover:bg-orange-50 gap-1.5"
                    onClick={() => setShowRevisionForm(true)}>
                    <AlertTriangle className="h-4 w-4" /> Solicitar alteração
                  </Button>
                </div>
              )}

              {/* Revision form */}
              {showRevisionForm && (
                <div className="space-y-3 pt-2 border-t">
                  <Label htmlFor="rev-comment" className="text-sm font-medium">Descreva a alteração solicitada</Label>
                  <Textarea
                    id="rev-comment"
                    value={revisionComment}
                    onChange={e => setRevisionComment(e.target.value)}
                    placeholder="Descreva detalhadamente o que precisa ser alterado..."
                    rows={4}
                    className="resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setShowRevisionForm(false); setRevisionComment(""); }} className="flex-1">
                      Cancelar
                    </Button>
                    <Button
                      onClick={submitRevision}
                      disabled={!revisionComment.trim() || submitting}
                      className="flex-1 bg-orange-600 hover:bg-orange-700"
                    >
                      {submitting ? "Enviando…" : "Solicitar alteração"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

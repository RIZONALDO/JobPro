import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { useParams, Link, useLocation } from "wouter";
import { apiFetch, apiPost, apiPut, apiDelete, ApiError } from "@/lib/api";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, MessageSquare, AlertTriangle, Info, MoreVertical, Undo2, FolderOpen, ExternalLink, PauseCircle, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CoordinatorAvatar, EditorAvatars } from "@/components/ui/avatar-group";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { JOB_STATUS_CLASS, JOB_STATUS_LABEL, JOB_STATUS_OPTIONS } from "@/lib/job-status";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ActiveWorkGuardDialog, type GuardLevel } from "@/components/ActiveWorkGuardDialog";

interface AssignedUser { id: number; name: string; login: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  number: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  assignedTo: AssignedUser | null;
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  revisionCount: number;
  revisions: Revision[];
  folderUrl: string | null;
}
interface Job {
  id: number;
  projectNumber: number;
  jobNumber: number;
  projectId: number;
  name: string;
  description: string | null;
  createdAt: string;
  status: string;
  tasks: Task[];
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  project: { id: number; name: string; color: string } | null;
}
interface Editor { id: number; name: string; login: string; }
interface EditorWorkload {
  id: number;
  name: string;
  score: number;
  taskCount: number;
  byComplexity: { low: number; medium: number; high: number };
}

function workloadLevel(score: number): "ok" | "moderate" | "high" | "critical" {
  if (score <= 3)  return "ok";
  if (score <= 9)  return "moderate";
  if (score <= 18) return "high";
  return "critical";
}


const EDITOR_TRANSITIONS: Record<string, string> = {
  pending:     "in_progress",
  in_progress: "review",
  in_revision: "review",
};
const EDITOR_ACTION_LABEL: Record<string, string> = {
  pending:     "Iniciar edição",
  in_progress: "Enviar para aprovação",
  in_revision: "Enviar para aprovação",
};

export default function JobDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [editors, setEditors] = useState<Editor[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState({ title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "" });
  const [saving, setSaving] = useState(false);

  // Revision request dialog
  const [revisionDialog, setRevisionDialog] = useState<Task | null>(null);
  const [confirmTask, setConfirmTask] = useState<{ id: number; title: string; action: "cancel" | "pause" } | null>(null);
  const [sendingConfirm, setSendingConfirm] = useState(false);
  const [revisionComment, setRevisionComment] = useState("");
  const [sendingRevision, setSendingRevision] = useState(false);

  // Expanded revisions per task
  const [expandedRevisions, setExpandedRevisions] = useState<Set<number>>(new Set());

  // Guard dialog
  const [guard, setGuard] = useState<{
    open: boolean; level: GuardLevel; activeTasks: number;
    action: string; resourceName: string; onConfirm: () => Promise<void>;
  }>({ open: false, level: "warning", activeTasks: 0, action: "", resourceName: "", onConfirm: async () => {} });

  const doTaskAction = async (taskId: number, action: "cancel" | "pause") => {
    setSendingConfirm(true);
    try {
      await apiPut(`/api/tasks/${taskId}`, { status: action === "cancel" ? "cancelled" : "paused" });
      toast({ title: action === "cancel" ? "Tarefa cancelada" : "Tarefa pausada" });
      setConfirmTask(null);
      load();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSendingConfirm(false); }
  };

  const load = useCallback(() => {
    apiFetch<Job>(`/api/jobs/${params.id}`).then(setJob).catch(() => toast({ title: "Erro ao carregar job", variant: "destructive" })).finally(() => setLoading(false));
  }, [params.id, toast]);

  useEffect(() => {
    load();
    if (user?.role !== "editor") {
      apiFetch<Editor[]>("/api/users").then(u => setEditors(u.filter((x: Editor & { role?: string }) => (x as any).role === "editor")));
      apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
    }
  }, [params.id, user?.role, load]);

  const jobId = parseInt(params.id ?? "0", 10);

  useRealtime({
    onTasksChanged: (d) => { if (d.jobId === jobId) load(); },
    onJobsChanged: (d) => {
      if (d.deleted && d.jobId === jobId) {
        toast({ title: "Este job foi excluído pelo coordenador." });
        navigate(job?.project ? `/projects/${job.project.id}` : "/projects");
        return;
      }
      if (d.jobId === jobId && d.newStatus) {
        const msg: Record<string, string> = {
          entregue: "Job marcado como entregue pelo coordenador.",
          aprovado: "Job marcado como aprovado pelo coordenador.",
          pausado:  "Job pausado pelo coordenador.",
        };
        if (msg[d.newStatus]) toast({ title: msg[d.newStatus] });
      }
      load();
    },
    onProjectsChanged: (d) => {
      if (!job || d.projectId !== job.projectId) return;
      if (d.deleted) {
        toast({ title: "O projeto foi excluído pelo coordenador." });
        navigate("/projects");
        return;
      }
      if (d.newStatus) {
        const msg: Record<string, string> = {
          pausado:   "O projeto foi pausado pelo coordenador.",
          concluido: "O projeto foi concluído pelo coordenador.",
          arquivado: "O projeto foi arquivado pelo coordenador.",
        };
        if (msg[d.newStatus]) toast({ title: msg[d.newStatus] });
      }
    },
  });

  const openNew = () => { setEditingTask(null); setForm({ title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "" }); setShowDialog(true); };
  const openEdit = (t: Task) => {
    setEditingTask(t);
    setForm({ title: t.title, description: t.description ?? "", dueDateTime: t.dueDate ?? "", priority: t.priority, complexity: (t as any).complexity ?? "medium", assignedToId: t.assignedTo ? String(t.assignedTo.id) : "", folderUrl: t.folderUrl ?? "" });
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast({ title: "Título obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    const payload = { title: form.title, description: form.description, dueDate: form.dueDateTime || null, priority: form.priority, complexity: form.complexity, assignedToId: form.assignedToId || null, folderUrl: form.folderUrl };
    try {
      if (editingTask) {
        await apiPut(`/api/tasks/${editingTask.id}`, payload);
        toast({ title: "Tarefa atualizada" });
      } else {
        await apiPost(`/api/jobs/${params.id}/tasks`, payload);
        toast({ title: "Tarefa criada" });
      }
      setShowDialog(false);
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const doUpdateJobStatus = async (status: string, force = false) => {
    if (!job) return;
    try {
      await apiPut(`/api/jobs/${job.id}${force ? "?force=true" : ""}`, { status });
      load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level, newStatus } = err.data as { activeTasks: number; level: GuardLevel; newStatus: string };
        const actionMap: Record<string, string> = { entregue: "marcar como entregue", aprovado: "marcar como aprovado" };
        setGuard({
          open: true, level, activeTasks,
          action: actionMap[newStatus] ?? "alterar o status de",
          resourceName: job.name,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doUpdateJobStatus(status, true); },
        });
      } else {
        toast({ title: err instanceof Error ? err.message : "Erro ao atualizar status", variant: "destructive" });
      }
    }
  };
  const updateJobStatus = (status: string) => doUpdateJobStatus(status);

  const updateStatus = async (task: Task, status: string) => {
    try {
      await apiPut(`/api/tasks/${task.id}`, { status });
      load();
    } catch (err: unknown) { toast({ title: err instanceof Error ? err.message : "Erro ao atualizar status", variant: "destructive" }); }
  };

  const openRevisionDialog = (task: Task) => {
    setRevisionDialog(task);
    setRevisionComment("");
  };

  const submitRevision = async () => {
    if (!revisionDialog) return;
    if (!revisionComment.trim()) { toast({ title: "Informe o comentário da alteração", variant: "destructive" }); return; }
    setSendingRevision(true);
    try {
      await apiPut(`/api/tasks/${revisionDialog.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast({ title: "Alteração solicitada" });
      setRevisionDialog(null);
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally { setSendingRevision(false); }
  };

  const toggleRevisions = (taskId: number) => {
    setExpandedRevisions(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const del = async (id: number) => {
    try {
      await apiDelete(`/api/tasks/${id}`);
      load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ title: err.message, variant: "destructive" });
      } else {
        toast({ title: err instanceof Error ? err.message : "Erro ao excluir", variant: "destructive" });
      }
    }
  };

  const returnTask = async (id: number) => {
    try {
      await apiPost(`/api/tasks/${id}/return`, {});
      load();
      toast({ title: "Tarefa devolvida." });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao devolver", variant: "destructive" });
    }
  };

  const isEditor = user?.role === "editor";
  const isCoord = !isEditor;

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm p-4">Carregando...</div>;
  if (!job) return <div className="p-4">Job não encontrado.</div>;

  return (
    <div className="space-y-4">
      {/* Job banner */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="px-5 pt-2.5 pb-3 flex flex-col gap-2">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]/60">
            <Link href="/projects" className="hover:text-[hsl(var(--foreground))] transition-colors">Projetos</Link>
            <span className="select-none mx-0.5">›</span>
            {job.project
              ? <Link href={`/projects/${job.project.id}`} className="hover:text-[hsl(var(--foreground))] transition-colors">Jobs</Link>
              : <span>Jobs</span>
            }
            <span className="select-none mx-0.5">›</span>
            <span className="text-[hsl(var(--primary))] font-medium">Tarefas</span>
          </nav>
          {/* Info */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{job.projectNumber}.{job.jobNumber}</span>
              <span className="font-semibold truncate">{job.name}</span>
              {isCoord ? (
                <Select value={job.status} onValueChange={updateJobStatus}>
                  <SelectTrigger className={`h-6 text-xs px-2 rounded-full border ${JOB_STATUS_CLASS[job.status] ?? ""} w-auto gap-1 shrink-0`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge className={`text-xs px-1.5 shrink-0 ${JOB_STATUS_CLASS[job.status] ?? "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                  {JOB_STATUS_LABEL[job.status] ?? job.status}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 shrink-0">
              {job.createdBy && <CoordinatorAvatar person={job.createdBy} />}
              {(() => {
                const editorsList = job.tasks.map(t => t.assignedTo).filter((u): u is NonNullable<typeof u> => u !== null);
                const unique = [...new Map(editorsList.map(e => [e.id, e])).values()];
                return unique.length > 0
                  ? <><span className="text-[hsl(var(--muted-foreground))]/30 text-xs">|</span><EditorAvatars people={unique} /></>
                  : null;
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        {/* Cabeçalho das colunas */}
        <div className="flex border-b bg-[hsl(var(--muted))]/30">
          <div className="flex-1 flex items-center px-5 py-3">
            <div className="flex-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 pr-3">Tarefa</div>
            <div className="w-52 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Status</div>
            <div className="w-12 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 text-center">Ed.</div>
            <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Entrega</div>
            <div className="w-56 shrink-0 flex justify-end">
              {isCoord && <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" />Nova tarefa</Button>}
            </div>
          </div>
        </div>

        {job.tasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Nenhuma tarefa criada.
          </div>
        ) : (
          <>
          {job.tasks.map((t, idx) => (
            <div key={t.id} className={`group ${idx < job.tasks.length - 1 ? "border-b" : ""}`}>
              <div className="flex">
                {/* Main row */}
                <div className="flex flex-1 items-stretch px-5 hover:bg-[hsl(var(--muted))]/40 transition-colors min-h-[44px]">

                  {/* Título — flex-1 */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center py-2 pr-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">
                        {job.projectNumber}.{job.jobNumber}.{t.number}
                      </span>
                      <span className="text-sm font-medium truncate">{t.title}</span>
                    </div>
                    {t.description && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.description}</span>
                    )}
                  </div>

                  {/* Status — w-52 */}
                  <div className="w-52 shrink-0 flex items-center gap-1.5">
                    <Badge className={`text-xs px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                    {t.revisionCount > 0 && (
                      <span className="text-xs font-semibold text-orange-500">Alt.{t.revisionCount}</span>
                    )}
                    {t.revisions.length > 0 && (
                      <button type="button" onClick={() => toggleRevisions(t.id)}
                        className="text-orange-400 hover:text-orange-600 transition-colors" title="Ver alterações">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Assignee — w-12 */}
                  <div className="w-12 shrink-0 flex items-center justify-center">
                    {t.assignedTo && <EditorAvatars people={[t.assignedTo]} />}
                  </div>

                  {/* Data — w-28 */}
                  <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5">
                    {t.dueDate && (() => {
                      const h = fmtDateHuman(t.dueDate); const n = fmtDate(t.dueDate);
                      return <>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">{h}</span>
                        {h !== n && <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{n}</span>}
                      </>;
                    })()}
                  </div>

                  {/* Ações — w-56 */}
                  <div className="w-56 shrink-0 flex items-center justify-end gap-1 py-2">
                    {t.folderUrl && (
                      <a href={t.folderUrl} target="_blank" rel="noreferrer" title="Abrir pasta no servidor"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {isEditor && t.assignedTo?.id === user?.id && ["pending", "in_progress", "in_revision"].includes(t.status) && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => returnTask(t.id)}>
                        <Undo2 className="h-3 w-3 mr-1" />Devolver
                      </Button>
                    )}
                    {isEditor && t.assignedTo?.id === user?.id && EDITOR_TRANSITIONS[t.status] && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5"
                        onClick={() => updateStatus(t, EDITOR_TRANSITIONS[t.status])}>
                        {EDITOR_ACTION_LABEL[t.status]}
                      </Button>
                    )}
                    {isCoord && t.status === "review" && (
                      <>
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700"
                          onClick={() => updateStatus(t, "completed")}>✓ Aprovar</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                          onClick={() => openRevisionDialog(t)}>↩ Alterar</Button>
                      </>
                    )}
                    {isCoord && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => del(t.id)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"><Trash2 className="h-3.5 w-3.5" />Excluir</DropdownMenuItem>
                          {!["completed","cancelled"].includes(t.status) && (
                            <>
                              <DropdownMenuSeparator />
                              {t.status !== "paused" && (
                                <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}
                                  className="text-purple-700 focus:text-purple-700">
                                  <PauseCircle className="h-3.5 w-3.5" />Pausar tarefa
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}
                                className="text-red-600 focus:text-red-600">
                                <XCircle className="h-3.5 w-3.5" />Cancelar tarefa
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable: revision comments */}
              {expandedRevisions.has(t.id) && t.revisions.length > 0 && (
                <div className="px-5 pb-3 pt-1 space-y-2 border-t border-orange-100 bg-orange-50/40">
                  {t.revisions.map(r => (
                    <div key={r.id}>
                      <span className="text-xs font-semibold text-orange-600 mr-2">Alt. #{r.revisionNumber}</span>
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {fmtShort(r.createdAt)}
                      </span>
                      <p className="text-xs text-[hsl(var(--foreground))] mt-0.5">{r.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
        )}
      </div>

      {/* Task create/edit dialog */}

      {isCoord && (
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingTask ? "Editar tarefa" : "Nova tarefa"}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Título *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Título da tarefa" />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Prioridade</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Complexidade</Label>
                  <Select value={form.complexity} onValueChange={v => setForm(f => ({ ...f, complexity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Simples</SelectItem>
                      <SelectItem value="medium">Moderada</SelectItem>
                      <SelectItem value="high">Complexa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-3">
                  <Label>Previsão de entrega</Label>
                  <DateTimePicker
                    value={form.dueDateTime}
                    onChange={v => setForm(f => ({ ...f, dueDateTime: v }))}
                    withTime
                    min={job?.createdAt ? job.createdAt.split("T")[0] : undefined}
                    placeholder="Selecionar data e horário"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Atribuir a</Label>
                <Select value={form.assignedToId || "none"} onValueChange={v => setForm(f => ({ ...f, assignedToId: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar editor..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguém</SelectItem>
                    {editors.map(e => {
                      const wl = workload.find(w => w.id === e.id);
                      const score = wl?.score ?? 0;
                      const level = workloadLevel(score);
                      const labelCfg: Record<string, { label: string; cls: string }> = {
                        ok:       { label: score === 0 ? "Livre" : "Tranquilo", cls: score === 0 ? "text-slate-400" : "text-green-500" },
                        moderate: { label: "Ocupado",   cls: "text-amber-400"  },
                        high:     { label: "Apertado",  cls: "text-orange-500" },
                        critical: { label: "No limite", cls: "text-red-500"    },
                      };
                      const { label, cls } = labelCfg[level];
                      return (
                        <SelectItem key={e.id} value={String(e.id)}>
                          <span className="flex items-center gap-2">
                            {e.name}
                            <span className={`text-xs font-semibold ${cls}`}>{label}</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {/* Alerta de carga */}
                {(() => {
                  const id = form.assignedToId ? parseInt(form.assignedToId) : null;
                  const wl = id ? workload.find(w => w.id === id) : null;
                  if (!wl) return null;
                  const level = workloadLevel(wl.score);
                  if (level === "ok") return null;

                  const cfg = {
                    moderate: { bg: "bg-amber-50 border-amber-200",  icon: "text-amber-500",  text: "text-amber-800",  msg: "Este editor está ocupado." },
                    high:     { bg: "bg-orange-50 border-orange-200", icon: "text-orange-500", text: "text-orange-800", msg: "Este editor está com a agenda apertada." },
                    critical: { bg: "bg-red-50 border-red-200",       icon: "text-red-500",    text: "text-red-800",   msg: "Atenção: este editor está no limite!" },
                  }[level]!;

                  return (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 mt-1.5 ${cfg.bg}`}>
                      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.icon}`} />
                      <div className={`text-xs ${cfg.text}`}>
                        <p className="font-semibold">{cfg.msg}</p>
                        <p className="mt-0.5 opacity-80">
                          {wl.taskCount} tarefa(s) ativa(s)
                          {(wl.byComplexity?.high ?? 0) > 0 && ` · ${wl.byComplexity.high} complexa(s)`}
                          {(wl.byComplexity?.medium ?? 0) > 0 && ` · ${wl.byComplexity.medium} moderada(s)`}.
                          Você ainda pode atribuir esta tarefa.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" />Pasta no servidor</Label>
                <div className="flex gap-1.5">
                  <Input value={form.folderUrl} onChange={e => setForm(f => ({ ...f, folderUrl: e.target.value }))} placeholder="https://… ou smb://…" />
                  {form.folderUrl && (
                    <a href={form.folderUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-md border bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] transition-colors">
                      <ExternalLink className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                    </a>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Revision comment dialog */}
      {/* Cancel / Pause confirm */}
      <Dialog open={!!confirmTask} onOpenChange={open => !open && setConfirmTask(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmTask?.action === "cancel" ? "Cancelar tarefa" : "Pausar tarefa"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {confirmTask?.action === "cancel"
              ? <>Tem certeza que deseja <strong>cancelar</strong> a tarefa <em>"{confirmTask?.title}"</em>? O editor será notificado.</>
              : <>Tem certeza que deseja <strong>pausar</strong> a tarefa <em>"{confirmTask?.title}"</em>? O editor será notificado.</>}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTask(null)} disabled={sendingConfirm}>Voltar</Button>
            <Button
              className={confirmTask?.action === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}
              onClick={() => confirmTask && doTaskAction(confirmTask.id, confirmTask.action)}
              disabled={sendingConfirm}
            >
              {sendingConfirm ? "Aguarde…" : confirmTask?.action === "cancel" ? "Confirmar cancelamento" : "Confirmar pausa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revisionDialog} onOpenChange={open => !open && setRevisionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar alteração</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {revisionDialog && revisionDialog.revisionCount > 0 && (
              <p className="text-xs text-orange-600 font-medium">Esta será a Alteração #{revisionDialog.revisionCount + 1}</p>
            )}
            <div className="space-y-1.5">
              <Label>Comentário do cliente *</Label>
              <Textarea
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar..."
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionDialog(null)}>Cancelar</Button>
            <Button onClick={submitRevision} disabled={sendingRevision} className="bg-orange-600 hover:bg-orange-700">
              {sendingRevision ? "Enviando..." : "↩ Solicitar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActiveWorkGuardDialog
        open={guard.open}
        onClose={() => setGuard(g => ({ ...g, open: false }))}
        onConfirm={guard.onConfirm}
        level={guard.level}
        activeTasks={guard.activeTasks}
        action={guard.action}
        resourceType="job"
        resourceName={guard.resourceName}
      />
    </div>
  );
}

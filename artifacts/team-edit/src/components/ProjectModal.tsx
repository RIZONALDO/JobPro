import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch, apiPost, apiPut, apiDelete, ApiError } from "@/lib/api";
import { fmtDate, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Briefcase, Pencil, Trash2, MoreVertical, MessageSquare, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Undo2, FolderOpen, ExternalLink, PauseCircle, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CoordinatorAvatar, EditorAvatars } from "@/components/ui/avatar-group";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { JOB_STATUS_CLASS, JOB_STATUS_LABEL, JOB_STATUS_OPTIONS } from "@/lib/job-status";
import { PROJ_STATUS_CLASS, PROJ_STATUS_LABEL } from "@/lib/project-status";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ActiveWorkGuardDialog, type GuardLevel } from "@/components/ActiveWorkGuardDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }

interface ProjectJob {
  createdBy: Person | null;
  id: number; number: number; name: string; description: string | null;
  status: string; taskCount: number; completedCount: number;
  assignees: Person[];
}
interface Project {
  id: number; number: number; name: string; client: string | null;
  description: string | null; status: string; color: string;
  createdAt: string;
  coordinator: Person | null; jobs: ProjectJob[];
}
interface Task {
  id: number; number: number; title: string; description: string | null;
  dueDate: string | null; status: string; priority: string;
  assignedTo: (Person & { login: string }) | null;
  createdBy: Person | null;
  revisionCount: number; revisions: Revision[]; folderUrl: string | null;
}
interface JobDetail {
  id: number; projectNumber: number; jobNumber: number; projectId: number;
  name: string; description: string | null; createdAt: string;
  status: string; tasks: Task[];
  createdBy: Person | null;
  project: { id: number; name: string; color: string } | null;
}
interface Editor { id: number; name: string; login: string; }
interface EditorWorkload {
  id: number; name: string; score: number; taskCount: number;
  byComplexity: { low: number; medium: number; high: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EDITOR_TRANSITIONS: Record<string, string> = {
  pending: "in_progress", in_progress: "review", in_revision: "review",
};
const EDITOR_ACTION_LABEL: Record<string, string> = {
  pending: "Iniciar", in_progress: "Enviar para aprovação", in_revision: "Enviar para aprovação",
};

function workloadLevel(score: number): "ok" | "moderate" | "high" | "critical" {
  if (score <= 3)  return "ok";
  if (score <= 9)  return "moderate";
  if (score <= 18) return "high";
  return "critical";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { projectId: number; projectIds?: number[]; initialJobId?: number; onClose: () => void; }

export function ProjectModal({ projectId: initialId, projectIds = [], initialJobId, onClose }: Props) {
  const { user } = useAuth();
  const isEditor = user?.role === "editor";
  const isCoord  = !isEditor;

  // ── Navigation ────────────────────────────────────────────────────────────
  const [currentId, setCurrentId] = useState(initialId);
  const idx     = projectIds.indexOf(currentId);
  const hasPrev = idx > 0;
  const hasNext = idx !== -1 && idx < projectIds.length - 1;

  // ── Data ──────────────────────────────────────────────────────────────────
  const [project,     setProject]    = useState<Project | null>(null);
  const [jobDetail,   setJobDetail]  = useState<JobDetail | null>(null);
  const [editors,     setEditors]    = useState<Editor[]>([]);
  const [workload,    setWorkload]   = useState<EditorWorkload[]>([]);
  const [loadingProj, setLoadingProj] = useState(true);
  const [loadingJob,  setLoadingJob]  = useState(false);

  // ── Selected job ──────────────────────────────────────────────────────────
  const [selectedJobId, setSelectedJobId] = useState<number | null>(initialJobId ?? null);

  const goTo = (id: number) => {
    setCurrentId(id);
    setSelectedJobId(null);
    setJobDetail(null);
    setProject(null);
  };

  // ── Job form ──────────────────────────────────────────────────────────────
  const [jobDialog,  setJobDialog]  = useState(false);
  const [editingJob, setEditingJob] = useState<ProjectJob | null>(null);
  const [jobForm,    setJobForm]    = useState({ name: "", description: "", status: "aberto" });
  const [savingJob,  setSavingJob]  = useState(false);

  // ── Task form ─────────────────────────────────────────────────────────────
  const [taskDialog,  setTaskDialog]  = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskForm,    setTaskForm]    = useState({ title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "" });
  const [savingTask,  setSavingTask]  = useState(false);

  // ── Guard dialog ──────────────────────────────────────────────────────────
  const [guard, setGuard] = useState<{
    open: boolean; level: GuardLevel; activeTasks: number;
    action: string; resourceType: "projeto" | "job"; resourceName: string;
    allTasks?: boolean; onConfirm: () => Promise<void>;
  }>({ open: false, level: "critical", activeTasks: 0, action: "", resourceType: "job", resourceName: "", onConfirm: async () => {} });

  // ── Revision ──────────────────────────────────────────────────────────────
  const [revisionTask,    setRevisionTask]    = useState<Task | null>(null);
  const [confirmTask, setConfirmTask] = useState<{ id: number; title: string; action: "cancel" | "pause" } | null>(null);
  const [sendingConfirm, setSendingConfirm] = useState(false);
  const [revisionComment, setRevisionComment] = useState("");
  const [sendingRevision, setSendingRevision] = useState(false);
  const [expandedRev,     setExpandedRev]     = useState<Set<number>>(new Set());

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadProject = useCallback(() => {
    setLoadingProj(true);
    apiFetch<Project>(`/api/projects/${currentId}`)
      .then(setProject)
      .catch(() => toast.error("Erro ao carregar projeto"))
      .finally(() => setLoadingProj(false));
  }, [currentId]);

  const doTaskAction = async (taskId: number, action: "cancel" | "pause") => {
    setSendingConfirm(true);
    try {
      await apiPut(`/api/tasks/${taskId}`, { status: action === "cancel" ? "cancelled" : "paused" });
      toast(action === "cancel" ? "Tarefa cancelada" : "Tarefa pausada");
      setConfirmTask(null);
      loadJob();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setSendingConfirm(false); }
  };

  const loadJob = useCallback(() => {
    if (!selectedJobId) return;
    setLoadingJob(true);
    apiFetch<JobDetail>(`/api/jobs/${selectedJobId}`)
      .then(setJobDetail)
      .catch(() => toast.error("Erro ao carregar job"))
      .finally(() => setLoadingJob(false));
  }, [selectedJobId]);

  useEffect(() => { loadProject(); }, [loadProject]);
  useEffect(() => { if (selectedJobId) loadJob(); }, [selectedJobId, loadJob]);
  useEffect(() => {
    if (!isCoord) return;
    apiFetch<(Editor & { role?: string })[]>("/api/users")
      .then(u => setEditors(u.filter(x => (x as any).role === "editor")));
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
  }, [isCoord]);

  useRealtime({
    onProjectsChanged: (d) => {
      if (d.deleted && d.projectId === currentId) {
        toast.info("Este projeto foi excluído pelo coordenador.");
        onClose();
        return;
      }
      if (d.projectId === currentId && d.newStatus) {
        const msg: Record<string, string> = { pausado: "Projeto pausado.", concluido: "Projeto concluído.", arquivado: "Projeto arquivado." };
        if (msg[d.newStatus]) toast.info(msg[d.newStatus]);
      }
      loadProject();
    },
    onJobsChanged: (d) => {
      if (d.projectId !== currentId) return;
      if (d.deleted && d.jobId === selectedJobId) {
        toast.info("Este job foi excluído pelo coordenador.");
        setSelectedJobId(null);
        setJobDetail(null);
      }
      if (d.newStatus && d.jobId === selectedJobId) {
        const msg: Record<string, string> = { entregue: "Job marcado como entregue.", aprovado: "Job marcado como aprovado." };
        if (msg[d.newStatus]) toast.info(msg[d.newStatus]);
      }
      loadProject();
      if (selectedJobId && !d.deleted) loadJob();
    },
    onTasksChanged: (d) => { if (d.projectId === currentId) { loadProject(); if (selectedJobId) loadJob(); } },
  });

  // ── Job CRUD ──────────────────────────────────────────────────────────────
  const openNewJob  = () => { setEditingJob(null); setJobForm({ name: "", description: "", status: "aberto" }); setJobDialog(true); };
  const openEditJob = (j: ProjectJob) => {
    setEditingJob(j);
    setJobForm({ name: j.name, description: j.description ?? "", status: j.status });
    setJobDialog(true);
  };
  const doSaveJob = async (force = false) => {
    if (!jobForm.name.trim()) { toast.error("Nome obrigatório"); return; }
    setSavingJob(true);
    const payload = { name: jobForm.name, description: jobForm.description, ...(editingJob ? { status: jobForm.status } : {}) };
    const url = editingJob
      ? `/api/jobs/${editingJob.id}${force ? "?force=true" : ""}`
      : `/api/projects/${currentId}/jobs`;
    try {
      if (editingJob) { await apiPut(url, payload); toast.success("Job atualizado"); }
      else { await apiPost(url, payload); toast.success("Job criado"); }
      setJobDialog(false); loadProject();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level, newStatus } = err.data as { activeTasks: number; level: GuardLevel; newStatus: string };
        const actionMap: Record<string, string> = { entregue: "marcar como entregue", aprovado: "marcar como aprovado" };
        setGuard({
          open: true, level, activeTasks,
          action: actionMap[newStatus] ?? "alterar o status de",
          resourceType: "job", resourceName: jobForm.name,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doSaveJob(true); },
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    } finally { setSavingJob(false); }
  };
  const saveJob = () => doSaveJob(false);

  const doDelJob = async (id: number, name: string, force = false) => {
    try {
      await apiDelete(`/api/jobs/${id}${force ? "?force=true" : ""}`);
      if (selectedJobId === id) { setSelectedJobId(null); setJobDetail(null); }
      loadProject();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level } = err.data as { activeTasks: number; level: GuardLevel };
        setGuard({
          open: true, level, activeTasks, action: "excluir",
          resourceType: "job", resourceName: name, allTasks: true,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doDelJob(id, name, true); },
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao excluir");
      }
    }
  };
  const delJob = (id: number, name: string) => doDelJob(id, name);

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  const openNewTask  = () => { setEditingTask(null); setTaskForm({ title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "" }); setTaskDialog(true); };
  const openEditTask = (t: Task) => {
    setEditingTask(t);
    setTaskForm({ title: t.title, description: t.description ?? "", dueDateTime: t.dueDate ?? "", priority: t.priority, complexity: (t as any).complexity ?? "medium", assignedToId: t.assignedTo ? String(t.assignedTo.id) : "", folderUrl: t.folderUrl ?? "" });
    setTaskDialog(true);
  };
  const saveTask = async () => {
    if (!taskForm.title.trim()) { toast.error("Título obrigatório"); return; }
    setSavingTask(true);
    const payload = { title: taskForm.title, description: taskForm.description, dueDate: taskForm.dueDateTime || null, priority: taskForm.priority, complexity: taskForm.complexity, assignedToId: taskForm.assignedToId || null, folderUrl: taskForm.folderUrl };
    try {
      if (editingTask) { await apiPut(`/api/tasks/${editingTask.id}`, payload); toast.success("Tarefa atualizada"); }
      else { await apiPost(`/api/jobs/${selectedJobId}/tasks`, payload); toast.success("Tarefa criada"); }
      setTaskDialog(false); loadJob();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSavingTask(false); }
  };
  const updateStatus = async (task: Task, status: string) => {
    try { await apiPut(`/api/tasks/${task.id}`, { status }); loadJob(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); }
  };
  const delTask = async (id: number) => {
    try {
      await apiDelete(`/api/tasks/${id}`);
      loadJob();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao excluir");
      }
    }
  };
  const returnTask = async (id: number) => {
    try {
      await apiPost(`/api/tasks/${id}/return`, {});
      loadJob();
      toast.success("Tarefa devolvida.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao devolver");
    }
  };
  const submitRevision = async () => {
    if (!revisionTask || !revisionComment.trim()) { toast.error("Informe o comentário"); return; }
    setSendingRevision(true);
    try {
      await apiPut(`/api/tasks/${revisionTask.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast.success("Alteração solicitada");
      setRevisionTask(null);
      loadJob();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setSendingRevision(false); }
  };
  const toggleRev = (id: number) => setExpandedRev(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // ── Render ────────────────────────────────────────────────────────────────
  const color = project?.color ?? "#6366f1";

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          Main app-screen modal
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-[92vw] w-[92vw] h-[88vh] p-0 flex flex-col gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl">

          {/* Visually hidden title for a11y */}
          <DialogHeader className="sr-only">
            <DialogTitle>{project?.name ?? "Projeto"}</DialogTitle>
          </DialogHeader>

          {/* ── App header bar ─────────────────────────────────────────── */}
          <div
            className="shrink-0 flex flex-col gap-1 px-5 py-3 pr-14"
            style={{ background: `linear-gradient(135deg, ${color}18 0%, transparent 60%)`, borderBottom: `1px solid ${color}30` }}
          >
            {/* Top row */}
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                {loadingProj ? (
                  <span className="h-6 w-52 rounded bg-[hsl(var(--muted))]/60 animate-pulse block" />
                ) : (
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-bold uppercase tracking-[0.1em] shrink-0 text-[hsl(var(--primary))]">
                      Projeto
                    </span>
                    <span className="text-sm font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">
                      #{project?.number}
                    </span>
                    <span className="text-sm font-bold truncate" style={{ color }}>
                      {project?.name}
                    </span>
                    {project?.client && (
                      <span className="text-sm text-[hsl(var(--muted-foreground))] truncate hidden sm:block shrink-0">
                        · {project.client}
                      </span>
                    )}
                    {project?.status && (
                      <Badge className={`text-xs px-1.5 shrink-0 ${PROJ_STATUS_CLASS[project.status] ?? ""}`}>
                        {PROJ_STATUS_LABEL[project.status] ?? project.status}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {project?.coordinator && <CoordinatorAvatar person={project.coordinator} />}
                {project && (() => {
                  const coordId = project.coordinator?.id;
                  const otherCoords = [...new Map(
                    project.jobs
                      .map(j => j.createdBy)
                      .filter((p): p is Person => p !== null && p.id !== coordId)
                      .map(p => [p.id, p])
                  ).values()];
                  const editorPeople = [...new Map(
                    project.jobs.flatMap(j => j.assignees)
                      .filter(p => p.id !== coordId)
                      .map(p => [p.id, p])
                  ).values()];
                  return (
                    <>
                      {otherCoords.map(p => <CoordinatorAvatar key={p.id} person={p} />)}
                      {editorPeople.length > 0 && (
                        <><span className="text-[hsl(var(--muted-foreground))]/30 text-xs">|</span><EditorAvatars people={editorPeople} max={6} /></>
                      )}
                    </>
                  );
                })()}
                {projectIds.length > 1 && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={() => goTo(projectIds[idx - 1])}
                      className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors hover:bg-[hsl(var(--muted))] disabled:opacity-25 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span className="text-sm font-mono text-[hsl(var(--muted-foreground))]/60 w-10 text-center tabular-nums">
                      {idx + 1}/{projectIds.length}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={() => goTo(projectIds[idx + 1])}
                      className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors hover:bg-[hsl(var(--muted))] disabled:opacity-25 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Briefing line */}
            {!loadingProj && project?.description && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2 leading-relaxed">
                {project.description}
              </p>
            )}
          </div>

          {/* ── Body: sidebar + main ───────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">

            {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
            <div className="w-64 shrink-0 flex flex-col bg-[hsl(var(--muted))]/20" style={{ borderRight: `1px solid ${color}20` }}>

              {/* Sidebar header */}
              <div className="flex items-center justify-between px-4 py-2.5 shrink-0" style={{ borderBottom: `1px solid ${color}20` }}>
                <span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Jobs
                </span>
                {isCoord && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 rounded-lg hover:bg-[hsl(var(--muted))]"
                    onClick={openNewJob}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Jobs list */}
              <div className="flex-1 overflow-y-auto py-1">
                {loadingProj ? (
                  <div className="space-y-1 p-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-14 rounded-lg bg-[hsl(var(--muted))]/50 animate-pulse" />
                    ))}
                  </div>
                ) : !project || project.jobs.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
                    <Briefcase className="h-7 w-7 text-[hsl(var(--muted-foreground))]/25" />
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum job ainda.</p>
                    {isCoord && (
                      <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={openNewJob}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Criar job
                      </Button>
                    )}
                  </div>
                ) : (
                  project.jobs.map(j => {
                    const pct  = j.taskCount > 0 ? Math.round(j.completedCount / j.taskCount * 100) : 0;
                    const isSel = selectedJobId === j.id;
                    return (
                      <div
                        key={j.id}
                        className={`relative group mx-1 my-0.5 rounded-lg transition-all ${
                          isSel ? "shadow-sm" : "hover:bg-[hsl(var(--muted))]/60"
                        }`}
                        style={isSel ? { backgroundColor: `${color}14` } : undefined}
                      >
                        {/* Selected left bar */}
                        {isSel && (
                          <span
                            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                            style={{ backgroundColor: color }}
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedJobId(j.id)}
                          className="w-full text-left px-3 py-2.5 pl-4"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">
                              {project.number}.{j.number}
                            </span>
                            <span className={`text-xs font-semibold truncate flex-1 ${isSel ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--foreground))]/80"}`}>
                              {j.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs px-1 py-0 ${JOB_STATUS_CLASS[j.status] ?? ""}`}>
                              {JOB_STATUS_LABEL[j.status] ?? j.status}
                            </Badge>
                            {j.taskCount > 0 && (
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <div className="flex-1 h-1 rounded-full bg-[hsl(var(--muted))]">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${pct}%`, backgroundColor: isSel ? color : `${color}99` }}
                                  />
                                </div>
                                <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">{pct}%</span>
                              </div>
                            )}
                          </div>
                        </button>

                        {isCoord && (
                          <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditJob(j)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => delJob(j.id, j.name)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]">
                                  <Trash2 className="h-3.5 w-3.5" />Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── RIGHT MAIN PANEL ─────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--background))]">

              {!selectedJobId ? (
                /* Empty state */
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                  <div
                    className="h-16 w-16 rounded-2xl flex items-center justify-center"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    <Briefcase className="h-8 w-8" style={{ color }} />
                  </div>
                  <div>
                    <p className="font-semibold text-[hsl(var(--foreground))]">Selecione um job</p>
                    <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                      Escolha um job na lista à esquerda para ver e gerenciar as tarefas.
                    </p>
                  </div>
                  {isCoord && project && project.jobs.length === 0 && (
                    <Button onClick={openNewJob} style={{ backgroundColor: color }}>
                      <Plus className="h-4 w-4 mr-1.5" />Criar primeiro job
                    </Button>
                  )}
                </div>

              ) : loadingJob ? (
                /* Loading skeleton */
                <div className="flex-1 p-6 space-y-3">
                  <div className="h-12 rounded-xl bg-[hsl(var(--muted))]/50 animate-pulse" />
                  <div className="h-8  rounded-lg  bg-[hsl(var(--muted))]/40 animate-pulse" />
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-11 rounded-lg bg-[hsl(var(--muted))]/30 animate-pulse" />
                  ))}
                </div>

              ) : jobDetail ? (
                <>
                  {/* ── Job sub-header ──────────────────────────────── */}
                  <div className="shrink-0 flex items-center gap-3 px-6" style={{ height: 54, borderBottom: `1px solid ${color}20` }}>
                    <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">
                      {jobDetail.projectNumber}.{jobDetail.jobNumber}
                    </span>
                    <span className="font-semibold truncate flex-1">{jobDetail.name}</span>
                    <Badge className={`text-xs px-1.5 shrink-0 ${JOB_STATUS_CLASS[jobDetail.status] ?? ""}`}>
                      {JOB_STATUS_LABEL[jobDetail.status] ?? jobDetail.status}
                    </Badge>
                    {isCoord && (
                      <Button size="sm" onClick={openNewTask} className="shrink-0 h-8">
                        <Plus className="h-4 w-4 mr-1.5" />Nova tarefa
                      </Button>
                    )}
                  </div>

                  {/* ── Column headers ───────────────────────────────── */}
                  <div className="shrink-0 flex items-center px-6 py-2.5 bg-[hsl(var(--muted))]/25" style={{ borderBottom: `1px solid ${color}20` }}>
                    <div className="flex-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 pr-3">Tarefa</div>
                    <div className="w-48 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Status</div>
                    <div className="w-32 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Editor</div>
                    <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Entrega</div>
                    <div className="w-52 shrink-0" />
                  </div>

                  {/* ── Task rows ────────────────────────────────────── */}
                  <div className="flex-1 overflow-y-auto divide-y divide-[hsl(var(--muted))]">
                    {jobDetail.tasks.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 py-16 text-center">
                        <div className="h-12 w-12 rounded-xl bg-[hsl(var(--muted))]/50 flex items-center justify-center">
                          <CheckCircle2 className="h-6 w-6 text-[hsl(var(--muted-foreground))]/30" />
                        </div>
                        <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa criada.</p>
                        {isCoord && (
                          <Button size="sm" variant="outline" onClick={openNewTask}>
                            <Plus className="h-4 w-4 mr-1.5" />Criar tarefa
                          </Button>
                        )}
                      </div>
                    ) : jobDetail.tasks.map(t => (
                      <div key={t.id}>
                        <div className="flex items-stretch px-6 hover:bg-[hsl(var(--muted))]/30 transition-colors min-h-[46px]">
                          {/* Title */}
                          <div className="flex-1 min-w-0 flex flex-col justify-center py-2.5 pr-3">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/40 shrink-0">
                                {jobDetail.projectNumber}.{jobDetail.jobNumber}.{t.number}
                              </span>
                              <span className="text-sm font-medium truncate">{t.title}</span>
                            </div>
                            {t.description && (
                              <span className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">{t.description}</span>
                            )}
                          </div>
                          {/* Status */}
                          <div className="w-48 shrink-0 flex items-center gap-1.5">
                            <Badge className={`text-xs px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                              {STATUS_LABEL[t.status] ?? t.status}
                            </Badge>
                            {t.revisionCount > 0 && (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                                {t.revisionCount} {t.revisionCount === 1 ? "alteração" : "alterações"}
                              </span>
                            )}
                            {t.revisions.length > 0 && (
                              <button type="button" onClick={() => toggleRev(t.id)}
                                className="text-orange-400 hover:text-orange-600 transition-colors">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {/* Assignee */}
                          <div className="w-32 shrink-0 flex items-center gap-1.5">
                            {t.assignedTo
                              ? <><EditorAvatars people={[t.assignedTo]} /><span className="text-xs truncate text-[hsl(var(--muted-foreground))]">@{t.assignedTo.login}</span></>
                              : <span className="text-xs text-[hsl(var(--muted-foreground))]/50 italic">não atribuído</span>
                            }
                          </div>
                          {/* Due date */}
                          <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5">
                            {t.dueDate && (
                              <span className="text-xs text-[hsl(var(--muted-foreground))]">{fmtDate(t.dueDate)}</span>
                            )}
                          </div>
                          {/* Actions */}
                          <div className="w-52 shrink-0 flex items-center justify-end gap-1 py-2">
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
                                  onClick={() => { setRevisionTask(t); setRevisionComment(""); }}>↩ Alterar</Button>
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
                                  <DropdownMenuItem onClick={() => openEditTask(t)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => delTask(t.id)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]">
                                    <Trash2 className="h-3.5 w-3.5" />Excluir
                                  </DropdownMenuItem>
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
                        {/* Revision comments */}
                        {expandedRev.has(t.id) && t.revisions.length > 0 && (
                          <div className="px-6 pb-3 pt-2 space-y-2 border-t border-orange-100 bg-orange-50/40">
                            {t.revisions.map(r => (
                              <div key={r.id}>
                                <span className="text-xs font-bold text-orange-600 mr-2">Alt. #{r.revisionNumber}</span>
                                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                                  {fmtShort(r.createdAt)}
                                </span>
                                <p className="text-xs mt-0.5">{r.comment}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════════════
          Job form dialog
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={jobDialog} onOpenChange={setJobDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingJob ? "Editar job" : "Novo job"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome do job" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={jobForm.description} onChange={e => setJobForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            {editingJob && (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={jobForm.status} onValueChange={v => setJobForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJobDialog(false)}>Cancelar</Button>
            <Button onClick={saveJob} disabled={savingJob}>{savingJob ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════════════
          Task form dialog
          ════════════════════════════════════════════════════════════════════ */}
      {isCoord && (
        <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTask ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Título *</Label>
                <Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Título da tarefa" />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Prioridade</Label>
                  <Select value={taskForm.priority} onValueChange={v => setTaskForm(f => ({ ...f, priority: v }))}>
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
                  <Select value={taskForm.complexity} onValueChange={v => setTaskForm(f => ({ ...f, complexity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Simples</SelectItem>
                      <SelectItem value="medium">Moderada</SelectItem>
                      <SelectItem value="high">Complexa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Previsão de entrega</Label>
                  <DateTimePicker
                    value={taskForm.dueDateTime}
                    onChange={v => setTaskForm(f => ({ ...f, dueDateTime: v }))}
                    withTime
                    min={jobDetail?.createdAt ? jobDetail.createdAt.split("T")[0] : undefined}
                    placeholder="Selecionar data e horário"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Atribuir a</Label>
                <Select value={taskForm.assignedToId || "none"} onValueChange={v => setTaskForm(f => ({ ...f, assignedToId: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar editor…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguém</SelectItem>
                    {editors.map(e => {
                      const wl    = workload.find(w => w.id === e.id);
                      const score = wl?.score ?? 0;
                      const level = workloadLevel(score);
                      const cfg: Record<string, { label: string; cls: string }> = {
                        ok:       { label: score === 0 ? "Livre" : "Tranquilo", cls: score === 0 ? "text-slate-400" : "text-green-500" },
                        moderate: { label: "Ocupado",   cls: "text-amber-400"  },
                        high:     { label: "Apertado",  cls: "text-orange-500" },
                        critical: { label: "No limite", cls: "text-red-500"    },
                      };
                      const { label, cls } = cfg[level];
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
                {(() => {
                  const id = taskForm.assignedToId ? parseInt(taskForm.assignedToId) : null;
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
                          {(wl.byComplexity?.high   ?? 0) > 0 && ` · ${wl.byComplexity.high} complexa(s)`}
                          {(wl.byComplexity?.medium ?? 0) > 0 && ` · ${wl.byComplexity.medium} moderada(s)`}.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" />Pasta no servidor</Label>
                <div className="flex gap-1.5">
                  <Input value={taskForm.folderUrl} onChange={e => setTaskForm(f => ({ ...f, folderUrl: e.target.value }))} placeholder="https://… ou smb://…" />
                  {taskForm.folderUrl && (
                    <a href={taskForm.folderUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-md border bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] transition-colors">
                      <ExternalLink className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                    </a>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTaskDialog(false)}>Cancelar</Button>
              <Button onClick={saveTask} disabled={savingTask}>{savingTask ? "Salvando…" : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel / Pause confirm */}
      <Dialog open={!!confirmTask} onOpenChange={open => !open && setConfirmTask(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmTask?.action === "cancel" ? "Cancelar tarefa" : "Pausar tarefa"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {confirmTask?.action === "cancel"
              ? <>Tem certeza que deseja <strong>cancelar</strong> a tarefa <em>"{confirmTask?.title}"</em>? O editor sera notificado.</>
              : <>Tem certeza que deseja <strong>pausar</strong> a tarefa <em>"{confirmTask?.title}"</em>? O editor sera notificado.</>}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTask(null)} disabled={sendingConfirm}>Voltar</Button>
            <Button
              className={confirmTask?.action === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}
              onClick={() => confirmTask && doTaskAction(confirmTask.id, confirmTask.action)}
              disabled={sendingConfirm}
            >
              {sendingConfirm ? "Aguarde..." : confirmTask?.action === "cancel" ? "Confirmar cancelamento" : "Confirmar pausa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════════════
          Revision dialog
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={!!revisionTask} onOpenChange={open => !open && setRevisionTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Solicitar alteração</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {revisionTask && revisionTask.revisionCount > 0 && (
              <p className="text-xs text-orange-600 font-medium">Esta será a Alteração #{revisionTask.revisionCount + 1}</p>
            )}
            <div className="space-y-1.5">
              <Label>Comentário do cliente *</Label>
              <Textarea
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar…"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionTask(null)}>Cancelar</Button>
            <Button onClick={submitRevision} disabled={sendingRevision} className="bg-orange-600 hover:bg-orange-700">
              {sendingRevision ? "Enviando…" : "↩ Solicitar alteração"}
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
        resourceType={guard.resourceType}
        resourceName={guard.resourceName}
        allTasks={guard.allTasks}
      />
    </>
  );
}

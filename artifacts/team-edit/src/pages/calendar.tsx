import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, CalendarDays, Plus, AlertTriangle, FolderOpen, ExternalLink } from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { toLocalDate } from "@/lib/utils";
import { usePageTitle } from "@/lib/use-page-title";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";

interface CalendarTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  jobId: number;
  jobName: string | null;
  assignedToId: number | null;
  assigneeName: string | null;
}

interface ProjectSummary { id: number; name: string; client: string | null; status: string; }
interface JobSummary { id: number; name: string; createdAt: string; dueDate: string | null; }
interface Editor { id: number; name: string; login: string; role: string; }
interface EditorWorkload { id: number; score: number; taskCount: number; byComplexity: { low: number; medium: number; high: number }; }

const PRIORITY_COLOR: Record<string, string> = {
  low: "border-l-green-400",
  medium: "border-l-amber-400",
  high: "border-l-red-400",
};

const DAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDay(d: Date): string {
  return `${d.getDate()} ${MONTHS_PT[d.getMonth()]}`;
}

function workloadLevel(score: number): "ok" | "moderate" | "high" | "critical" {
  if (score <= 3)  return "ok";
  if (score <= 9)  return "moderate";
  if (score <= 18) return "high";
  return "critical";
}

const EMPTY_FORM = { title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "", projectId: "", jobId: "" };

export default function Calendar() {
  usePageTitle("Calendário");
  const { user } = useAuth();
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);

  const isCoord = user?.role !== "editor";

  // Coordinator data
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [editors, setEditors] = useState<Editor[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);

  // Jobs for selected project (lazy-loaded)
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [editJobInfo, setEditJobInfo] = useState<{ jobName: string; projectName: string } | null>(null);
  const [taskForm, setTaskForm] = useState(EMPTY_FORM);
  const [savingTask, setSavingTask] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const loadCalendar = useCallback(() => {
    setLoading(true);
    apiFetch<CalendarTask[]>(`/api/calendar?week=${fmt(weekStart)}`)
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar calendário", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [weekStart]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  useEffect(() => {
    if (!isCoord) return;
    apiFetch<ProjectSummary[]>("/api/projects").then(setProjects).catch(() => {});
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => x.role === "editor")))
      .catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
  }, [isCoord]);

  // Load jobs when project changes in create mode
  useEffect(() => {
    if (editMode || !taskForm.projectId) { setJobs([]); return; }
    apiFetch<{ jobs: JobSummary[] }>(`/api/projects/${taskForm.projectId}`)
      .then(p => setJobs(p.jobs ?? []))
      .catch(() => setJobs([]));
  }, [taskForm.projectId, editMode]);

  const openCreate = (dateStr: string) => {
    setEditMode(false);
    setEditTaskId(null);
    setEditJobInfo(null);
    setJobs([]);
    setTaskForm({ ...EMPTY_FORM, dueDateTime: dateStr });
    setDialogOpen(true);
  };

  const openEdit = async (t: CalendarTask) => {
    setEditMode(true);
    setEditTaskId(t.id);
    setEditJobInfo(null);
    setTaskForm(EMPTY_FORM);
    setLoadingEdit(true);
    setDialogOpen(true);
    try {
      const job = await apiFetch<{ name: string; project: { name: string } | null; tasks: any[] }>(`/api/jobs/${t.jobId}`);
      const fullTask = job.tasks.find((x: any) => x.id === t.id);
      if (!fullTask) throw new Error("Tarefa não encontrada no job");
      setEditJobInfo({ jobName: job.name, projectName: job.project?.name ?? "—" });
      setTaskForm({
        title: fullTask.title ?? "",
        description: fullTask.description ?? "",
        dueDateTime: fullTask.dueDate ?? "",
        priority: fullTask.priority ?? "medium",
        complexity: fullTask.complexity ?? "medium",
        assignedToId: fullTask.assignedToId ? String(fullTask.assignedToId) : "",
        folderUrl: fullTask.folderUrl ?? "",
        projectId: "",
        jobId: String(t.jobId),
      });
    } catch {
      toast({ title: "Erro ao carregar tarefa", variant: "destructive" });
      setDialogOpen(false);
    } finally {
      setLoadingEdit(false);
    }
  };

  const saveTask = async () => {
    if (!taskForm.title.trim()) { toast({ title: "Título obrigatório", variant: "destructive" }); return; }
    if (!editMode && !taskForm.jobId) { toast({ title: "Selecione um job", variant: "destructive" }); return; }
    const payload = {
      title: taskForm.title,
      description: taskForm.description || null,
      dueDate: taskForm.dueDateTime || null,
      priority: taskForm.priority,
      complexity: taskForm.complexity,
      assignedToId: taskForm.assignedToId || null,
      folderUrl: taskForm.folderUrl || null,
    };
    setSavingTask(true);
    try {
      if (editMode && editTaskId) {
        await apiPut(`/api/tasks/${editTaskId}`, payload);
        toast({ title: "Tarefa atualizada" });
      } else {
        await apiPost(`/api/jobs/${taskForm.jobId}/tasks`, payload);
        toast({ title: "Tarefa criada" });
      }
      setDialogOpen(false);
      loadCalendar();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao salvar", variant: "destructive" });
    } finally {
      setSavingTask(false);
    }
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = toLocalDate(new Date());

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS_PT[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;

  const tasksByDay = (day: Date) =>
    tasks.filter(t => t.dueDate && toLocalDate(new Date(t.dueDate)) === toLocalDate(day));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5 text-[hsl(var(--primary))]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Meu Calendário</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {isCoord ? "Tarefas que você atribuiu" : "Suas tarefas"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setWeekStart(d => addDays(d, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">{weekLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setWeekStart(d => addDays(d, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => setWeekStart(getMonday(new Date()))}>
            Hoje
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {weekDays.map((day, i) => {
            const isToday = fmt(day) === today;
            const dateStr = fmt(day);
            return (
              <div key={i} className={`relative group px-2 py-3 text-center border-r last:border-r-0 ${isToday ? "bg-[hsl(var(--primary))]/5" : "bg-[hsl(var(--muted))]/30"}`}>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  {DAYS_PT[i]}
                </p>
                <p className={`text-lg font-bold mt-0.5 leading-none ${isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
                  {day.getDate()}
                </p>
                {isToday && <div className="h-1 w-1 rounded-full bg-[hsl(var(--primary))] mx-auto mt-1" />}
                {isCoord && (
                  <button
                    type="button"
                    onClick={() => openCreate(dateStr)}
                    title="Nova tarefa"
                    className="absolute top-1 right-1 h-5 w-5 rounded flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Task rows */}
        <div className="grid grid-cols-7 min-h-[400px]">
          {weekDays.map((day, i) => {
            const isToday = fmt(day) === today;
            const dayTasks = tasksByDay(day);
            return (
              <div key={i} className={`border-r last:border-r-0 p-2 space-y-1.5 align-top ${isToday ? "bg-[hsl(var(--primary))]/5" : ""}`}>
                {loading ? (
                  <div className="h-8 rounded bg-[hsl(var(--muted))]/50 animate-pulse" />
                ) : dayTasks.map(t => (
                  <div key={t.id}
                    onClick={() => isCoord && openEdit(t)}
                    className={`rounded-lg border bg-white px-2 py-1.5 border-l-2 ${PRIORITY_COLOR[t.priority] ?? "border-l-slate-300"} shadow-sm ${isCoord ? "cursor-pointer hover:shadow-md hover:border-[hsl(var(--primary))]/40 transition-all" : ""}`}
                  >
                    <p className="text-xs font-medium leading-tight line-clamp-2">{t.title}</p>
                    {t.jobName && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{t.jobName}</p>
                    )}
                    <div className="flex items-center justify-between mt-1 gap-1 flex-wrap">
                      <Badge className={`text-[9px] px-1 py-0 leading-4 ${STATUS_CLASS[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      {isCoord && t.assigneeName && (
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                          {t.assigneeName.split(" ")[0]}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Task create / edit dialog — coordinator only */}
      {isCoord && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editMode ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
            </DialogHeader>

            {loadingEdit ? (
              <div className="space-y-3 py-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-9 rounded-lg bg-[hsl(var(--muted))]/50 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-4 py-2">
                {/* Project/job: selectors on create, labels on edit */}
                {editMode ? (
                  editJobInfo && (
                    <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="font-medium text-[hsl(var(--foreground))]">{editJobInfo.projectName}</span>
                      <span className="mx-1.5">·</span>
                      <span>{editJobInfo.jobName}</span>
                    </div>
                  )
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Projeto *</Label>
                      <Select
                        value={taskForm.projectId || "none"}
                        onValueChange={v => setTaskForm(f => ({ ...f, projectId: v === "none" ? "" : v, jobId: "" }))}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecionar projeto…" /></SelectTrigger>
                        <SelectContent>
                          {projects
                            .filter(p => p.status === "ativo")
                            .map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}{p.client ? ` · ${p.client}` : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Job *</Label>
                      <Select
                        value={taskForm.jobId || "none"}
                        onValueChange={v => setTaskForm(f => ({ ...f, jobId: v === "none" ? "" : v }))}
                        disabled={!taskForm.projectId || jobs.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={
                            !taskForm.projectId ? "Selecione um projeto primeiro" :
                            jobs.length === 0 ? "Nenhum job disponível" :
                            "Selecionar job…"
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs.map(j => (
                            <SelectItem key={j.id} value={String(j.id)}>{j.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {/* Title */}
                <div className="space-y-1.5">
                  <Label>Título *</Label>
                  <Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Título da tarefa" />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Textarea value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} rows={2} />
                </div>

                {/* Priority + Complexity + Due date */}
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
                      placeholder="Selecionar data e horário"
                    />
                  </div>
                </div>

                {/* Assignee with workload */}
                <div className="space-y-1.5">
                  <Label>Atribuir a</Label>
                  <Select
                    value={taskForm.assignedToId || "none"}
                    onValueChange={v => setTaskForm(f => ({ ...f, assignedToId: v === "none" ? "" : v }))}
                  >
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
                              <span className={`text-[10px] font-semibold ${cls}`}>{label}</span>
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

                {/* Folder URL */}
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
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={saveTask} disabled={savingTask || loadingEdit}>
                {savingTask ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

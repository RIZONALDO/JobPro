import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useMemo } from "react";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ClipboardList, MoreVertical, FolderOpen, AlertTriangle,
  CheckCircle2, Clock, ArrowUpRight, X, PauseCircle, XCircle,
  Pencil, Trash2, Plus, ChevronUp, ChevronDown, ChevronsUpDown,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { TaskFormModal } from "@/components/task-form-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { RefreshCw, UserPlus } from "lucide-react";
import { fmtDate, fmtDateHuman } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; login: string; avatarUrl?: string | null; }

interface OverviewTask {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  folderUrl: string | null;
  revisionCount: number;
  client: string | null;
  color: string;
  assignee: Person | null;
  editors: Person[];
  coordinator: Person | null;
  isOwn: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLASS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
};

const STATUS_OPTIONS = [
  { value: "all",         label: "Todos os status" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Em revisão" },
  { value: "in_revision", label: "Em alteração" },
  { value: "completed",   label: "Concluída" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function TasksOverview() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const { toast } = useToast();
  const { openTask } = useTaskModal();

  const isSuper = user?.role === "admin" || user?.role === "supervisor";
  const canCreate = isSuper || user?.role === "coordinator";

  const [tasks,        setTasks]        = useState<OverviewTask[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [editors,      setEditors]      = useState<(Person & { role: string })[]>([]);
  const [coordinators, setCoordinators] = useState<(Person & { role: string })[]>([]);

  // Filters
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEditor, setFilterEditor] = useState("all");
  const [filterCoord,  setFilterCoord]  = useState("all");

  // Sort
  const [sortKey, setSortKey] = useState<string>("taskCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Revision dialog
  const [revisionTask,    setRevisionTask]    = useState<OverviewTask | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [sendingRevision, setSendingRevision] = useState(false);
  const [confirmTask, setConfirmTask] = useState<{ id: number; title: string; action: "cancel" | "pause" } | null>(null);
  const [sendingConfirm, setSendingConfirm] = useState(false);

  // Create / Edit modal
  const [formOpen,    setFormOpen]    = useState(false);
  const [editTaskId,  setEditTaskId]  = useState<number | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  // Reassign / add editor modal
  const [reassignTarget, setReassignTarget] = useState<{ taskId: number; taskTitle: string; assignedTo: Person | null; mode: "reassign" | "add" } | null>(null);
  const [deleting,     setDeleting]     = useState(false);

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

  const deleteTask = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/tasks/${deleteTarget.id}`);
      toast({ title: "Tarefa excluída" });
      setDeleteTarget(null);
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao excluir", variant: "destructive" });
    } finally { setDeleting(false); }
  };

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<OverviewTask[]>("/api/tasks/overview")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar tarefas", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiFetch<(Person & { role: string })[]>("/api/users").then(users => {
      setEditors(users.filter(u => u.role === "editor"));
      setCoordinators(users.filter(u => ["coordinator", "supervisor", "admin"].includes(u.role)));
    }).catch(() => {});
  }, []);

  useRealtime({ onTasksChanged: load });

  // ── Client-side filters ───────────────────────────────────────────────────

  const filtered = tasks.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor) return false;
    if (filterCoord  !== "all" && String(t.coordinator?.id ?? "") !== filterCoord) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const hasFilter = search || filterStatus !== "all" || filterEditor !== "all" || filterCoord !== "all";
  const clearFilters = () => { setSearch(""); setFilterStatus("all"); setFilterEditor("all"); setFilterCoord("all"); };

  // ── Client-side sort ──────────────────────────────────────────────────────

  const STATUS_ORDER_SORT = ["pending","in_progress","in_revision","review","paused","cancelled","completed"];
  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "taskCode": {
          const an = a.taskCode ?? ""; const bn = b.taskCode ?? "";
          cmp = an.localeCompare(bn, undefined, { numeric: true });
          break;
        }
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "status":
          cmp = STATUS_ORDER_SORT.indexOf(a.status) - STATUS_ORDER_SORT.indexOf(b.status);
          break;
        case "priority":
          cmp = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
          break;
        case "assignee":
          cmp = (a.assignee?.name ?? "").localeCompare(b.assignee?.name ?? "");
          break;
        case "dueDate": {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          cmp = da - db;
          break;
        }
        case "coordinator":
          cmp = (a.coordinator?.name ?? "").localeCompare(b.coordinator?.name ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Summary stats ─────────────────────────────────────────────────────────

  const now = new Date();
  const stats = {
    total:      filtered.length,
    inProgress: filtered.filter(t => t.status === "in_progress").length,
    review:     filtered.filter(t => t.status === "review").length,
    overdue:    filtered.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "completed").length,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAct = (t: OverviewTask) => t.isOwn || isSuper;
  const isOverdue = (t: OverviewTask) => !!(t.dueDate && new Date(t.dueDate) < now && t.status !== "completed");

  const approve = async (t: OverviewTask) => {
    try {
      await apiPut(`/api/tasks/${t.id}`, { status: "completed" });
      toast({ title: "Tarefa aprovada" });
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao aprovar", variant: "destructive" });
    }
  };

  const submitRevision = async () => {
    if (!revisionTask || !revisionComment.trim()) {
      toast({ title: "Informe o comentário", variant: "destructive" });
      return;
    }
    setSendingRevision(true);
    try {
      await apiPut(`/api/tasks/${revisionTask.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast({ title: "Alteração solicitada" });
      setRevisionTask(null);
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSendingRevision(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tarefa…"
          className="h-9 w-52 text-sm"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterEditor} onValueChange={setFilterEditor}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue placeholder="Todos os editores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os editores</SelectItem>
            {editors.map(e => (
              <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCoord} onValueChange={setFilterCoord}>
          <SelectTrigger className="h-9 w-48 text-sm">
            <SelectValue placeholder="Todos os coordenadores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os coordenadores</SelectItem>
            {coordinators.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-9 text-xs gap-1.5 text-[hsl(var(--muted-foreground))]"
            onClick={clearFilters}>
            <X className="h-3 w-3" />Limpar
          </Button>
        )}
        {!canCreate ? null : (
          <Button size="sm" className="h-9 gap-1.5 ml-auto" onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />Nova tarefa
          </Button>
        )}
        <span className={!canCreate ? "ml-auto" : ""} style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">

        {/* Column headers */}
        {(() => {
          const SortIcon = ({ col }: { col: string }) => {
            if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
            return sortDir === "asc"
              ? <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]" />
              : <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]" />;
          };
          const Th = ({ col, label, cls }: { col: string; label: string; cls: string }) => (
            <button
              onClick={() => toggleSort(col)}
              className={`${cls} flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] transition-colors select-none ${sortKey === col ? "text-[hsl(var(--primary))]/80" : ""}`}
            >
              {label}<SortIcon col={col} />
            </button>
          );
          return (
            <div className="flex items-center px-4 py-2.5 bg-[hsl(var(--muted))]/30 border-b">
              <div className="flex-1 pr-4"><Th col="taskCode" label="Tarefa" cls="" /></div>
              <div className="w-36 shrink-0"><Th col="status" label="Status" cls="" /></div>
              <div className="w-24 shrink-0"><Th col="priority" label="Prioridade" cls="" /></div>
              <div className="w-36 shrink-0"><Th col="assignee" label="Editor" cls="" /></div>
              <div className="w-28 shrink-0"><Th col="dueDate" label="Prazo" cls="" /></div>
              <div className="w-32 shrink-0"><Th col="coordinator" label="Coordenador" cls="" /></div>
              <div className="w-52 shrink-0" />
            </div>
          );
        })()}

        {/* Loading skeleton */}
        {loading ? (
          <div className="divide-y divide-[hsl(var(--muted))]">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center px-4 py-3 gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-48 rounded bg-[hsl(var(--muted))]/60 animate-pulse" />
                  <div className="h-3 w-32 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                </div>
                {[36, 24, 36, 28, 32].map((w, j) => (
                  <div key={j} className={`h-6 w-${w} rounded bg-[hsl(var(--muted))]/40 animate-pulse shrink-0`} />
                ))}
                <div className="w-52 shrink-0" />
              </div>
            ))}
          </div>

        ) : sorted.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {hasFilter ? "Nenhuma tarefa corresponde aos filtros." : "Nenhuma tarefa encontrada."}
            </p>
            {hasFilter && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            )}
          </div>

        ) : (
          /* Task rows */
          <div className="divide-y divide-[hsl(var(--muted))]">
            {sorted.map(t => {
              const overdue   = isOverdue(t);
              const canActNow = canAct(t);

              return (
                <div
                  key={t.id}
                  className="flex items-stretch px-4 hover:bg-[hsl(var(--muted))]/20 transition-colors min-h-[54px] cursor-pointer"
                  onClick={() => t.status === 'pending' && canActNow ? (setEditTaskId(t.id), setFormOpen(true)) : openTask(t.id)}
                  style={{ borderLeft: `3px solid ${t.projectColor ?? "#6366f1"}` }}
                >
                  {/* Tarefa */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center py-2.5 pr-4">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {t.taskCode && (
                        <span className="text-sm font-bold font-mono shrink-0" style={{ color: t.color }}>{t.taskCode}</span>
                      )}
                      <span className="text-sm font-medium truncate">{t.title}</span>
                      {t.revisionCount > 0 && (
                        <span className="text-xs font-bold text-orange-500 shrink-0">Alt.{t.revisionCount}</span>
                      )}
                    </div>
                    {(t.projectName || t.jobName) && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                        {t.projectName}{t.jobName ? ` · ${t.jobName}` : ""}
                      </p>
                    )}
                    {t.description && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-0.5">{t.description}</p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="w-36 shrink-0 flex items-center">
                    <Badge className={`text-xs px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>

                  {/* Prioridade */}
                  <div className="w-24 shrink-0 flex items-center">
                    <Badge variant="outline" className={`text-xs px-1.5 ${PRIORITY_CLASS[t.priority] ?? ""}`}>
                      {PRIORITY_LABEL[t.priority] ?? t.priority}
                    </Badge>
                  </div>

                  {/* Editor */}
                  <div className="w-36 shrink-0 flex items-center gap-2">
                    {t.editors && t.editors.length > 0 ? (
                      <>
                        <StackedAvatars people={t.editors} size={28} max={3} />
                        {t.editors.length === 1 && (
                          <span className="text-xs font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]/40 italic">não atribuído</span>
                    )}
                  </div>

                  {/* Prazo */}
                  <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5">
                    {t.dueDate ? (
                      <>
                        <span className={`text-xs ${overdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                          {fmtDateHuman(t.dueDate)}
                        </span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]/50">{fmtDate(t.dueDate)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>
                    )}
                  </div>

                  {/* Coordenador */}
                  <div className="w-32 shrink-0 flex items-center">
                    <span className={`text-xs truncate ${t.isOwn ? "text-[hsl(var(--primary))] font-medium" : "text-[hsl(var(--muted-foreground))]"}`}>
                      {t.isOwn ? "Você" : (t.coordinator?.name ?? "—")}
                    </span>
                  </div>

                  {/* Ações */}
                  <div className="w-52 shrink-0 flex items-center justify-end gap-1 py-2" onClick={e => e.stopPropagation()}>
                    {t.folderUrl && (
                      <a href={t.folderUrl} target="_blank" rel="noreferrer" title="Abrir pasta no servidor"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {t.status === "review" && canActNow && (
                      <>
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700"
                          onClick={() => approve(t)}>
                          ✓ Aprovar
                        </Button>
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs px-2.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                          onClick={() => { setRevisionTask(t); setRevisionComment(""); }}>
                          ↩ Alterar
                        </Button>
                      </>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openTask(t.id)}>
                          <ArrowUpRight className="h-3.5 w-3.5" />Ver detalhes
                        </DropdownMenuItem>
                        {t.status === "pending" && canActNow && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" />Editar tarefa
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget({ id: t.id, title: t.title })}
                              className="">
                              <Trash2 className="h-3.5 w-3.5" />Excluir tarefa
                            </DropdownMenuItem>
                          </>
                        )}
                        {!["completed","cancelled"].includes(t.status) && canActNow && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" })}>
                              <RefreshCw className="h-3.5 w-3.5" />Reatribuir tarefa
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "add" })}>
                              <UserPlus className="h-3.5 w-3.5" />Adicionar editor
                            </DropdownMenuItem>
                          </>
                        )}
                        {!["completed","cancelled"].includes(t.status) && (
                          <>
                            <DropdownMenuSeparator />
                            {t.status !== "paused" && (
                              <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}
                                className="">
                                <PauseCircle className="h-3.5 w-3.5" />Pausar tarefa
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}
                              className="">
                              <XCircle className="h-3.5 w-3.5" />Cancelar tarefa
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cancel / Pause confirm dialog ─────────────────────────────────── */}
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

      {/* ── Revision dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!revisionTask} onOpenChange={open => !open && setRevisionTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar alteração</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {revisionTask && revisionTask.revisionCount > 0 && (
              <p className="text-xs text-orange-600 font-medium">
                Esta será a Alteração #{revisionTask.revisionCount + 1}
              </p>
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
            <Button onClick={submitRevision} disabled={sendingRevision}
              className="bg-orange-600 hover:bg-orange-700">
              {sendingRevision ? "Enviando…" : "↩ Solicitar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task form modal */}
      {reassignTarget && (
        <ReassignEditorModal
          open={!!reassignTarget}
          onOpenChange={v => { if (!v) setReassignTarget(null); }}
          onSaved={() => { setReassignTarget(null); load(); }}
          taskId={reassignTarget.taskId}
          taskTitle={reassignTarget.taskTitle}
          currentAssignedTo={reassignTarget.assignedTo}
          mode={reassignTarget.mode}
        />
      )}

      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={load}
        editTaskId={editTaskId}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir tarefa</DialogTitle></DialogHeader>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Tem certeza que deseja <strong>excluir</strong> a tarefa <em>"{deleteTarget?.title}"</em>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteTask} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir tarefa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
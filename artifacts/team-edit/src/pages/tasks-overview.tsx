import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearch } from "wouter";
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
  ClipboardList, MoreVertical, FolderOpen,
  ArrowUpRight, X, PauseCircle, XCircle,
  Pencil, Trash2, Plus, ChevronUp, ChevronDown, ChevronsUpDown, Send,
  SlidersHorizontal, Check, Undo2, Search,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS, isTerminal } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { TaskFormModal } from "@/components/task-form-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { RefreshCw, UserPlus } from "lucide-react";
import { fmtClosedCycle, fmtPrazoWeek } from "@/lib/utils";
import { PrazoCell } from "@/components/prazo-cell";

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
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────


const STATUS_OPTIONS = [
  { value: "active",      label: "Ativas" },
  { value: "all",         label: "Todas" },
  { value: "rascunho",    label: "Rascunho" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Em revisão" },
  { value: "in_revision", label: "Em alteração" },
  { value: "paused",      label: "Pausada" },
  { value: "completed",   label: "Concluída" },
  { value: "cancelled",   label: "Cancelada" },
];

const TASK_GROUPS = [
  { key: "rascunho", label: "Rascunhos",    statuses: ["rascunho"],              color: "#a1a1aa" },
  { key: "pending",  label: "Pendentes",    statuses: ["pending"],               color: "#64748b" },
  { key: "editing",  label: "Em edição",    statuses: ["in_progress"],           color: "#3b82f6" },
  { key: "approval", label: "Em aprovação", statuses: ["in_revision", "review"], color: "#f59e0b" },
  { key: "paused",   label: "Pausadas",     statuses: ["paused"],                color: "#a855f7" },
  { key: "done",     label: "Concluídas",   statuses: ["completed"],             color: "#22c55e" },
  { key: "cancelled",label: "Canceladas",   statuses: ["cancelled"],             color: "#ef4444" },
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

  const urlSearch = useSearch();
  const [highlighted, setHighlighted] = useState<number | null>(() => {
    const v = new URLSearchParams(window.location.search).get("highlight");
    return v ? parseInt(v, 10) : null;
  });
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(urlSearch).get("highlight");
    if (v) setHighlighted(parseInt(v, 10));
  }, [urlSearch]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 3000);
    return () => clearTimeout(timer);
  }, [highlighted]);
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading]);

  // Filters
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterEditor, setFilterEditor] = useState("all");
  const defaultCoord = (!isSuper && user?.role === "coordinator") ? String(user?.id ?? "all") : "all";
  const [filterCoord,  setFilterCoord]  = useState(defaultCoord);

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

  // Mobile filter panel toggle
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
      load(true);
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
      load(true);
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao excluir", variant: "destructive" });
    } finally { setDeleting(false); }
  };

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const qs = filterStatus !== "active" ? `?status=${filterStatus}` : "";
    apiFetch<OverviewTask[]>(`/api/tasks/overview${qs}`)
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar tarefas", variant: "destructive" }))
      .finally(() => { if (!silent) setLoading(false); });
  }, [filterStatus, toast]);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onTasksChanged: () => load(true) });

  const editors = useMemo(() => {
    const map = new Map<number, Person>();
    tasks.forEach(t => {
      t.editors.forEach(e => map.set(e.id, e));
      if (t.assignee) map.set(t.assignee.id, t.assignee);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const coordinators = useMemo(() => {
    const map = new Map<number, Person>();
    tasks.forEach(t => { if (t.coordinator) map.set(t.coordinator.id, t.coordinator); });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // ── Client-side filters ───────────────────────────────────────────────────

  // status is server-side; editor/coord/search are client-side
  const filtered = tasks.filter(t => {
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor &&
        !t.editors.some(e => String(e.id) === filterEditor)) return false;
    if (filterCoord  !== "all" && String(t.coordinator?.id ?? "") !== filterCoord) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilter = search || filterStatus !== "active" || filterEditor !== "all" || filterCoord !== defaultCoord;
  const clearFilters = () => { setSearch(""); setFilterStatus("active"); setFilterEditor("all"); setFilterCoord(defaultCoord); };

  // ── Client-side sort ──────────────────────────────────────────────────────

  const STATUS_ORDER_SORT = ["rascunho","pending","in_progress","in_revision","review","paused","cancelled","completed"];
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAct = (t: OverviewTask) => t.isOwn || isSuper;
  const isOverdue = (t: OverviewTask) => !!(t.dueDate && new Date(t.dueDate) < now && !isTerminal(t.status));

  const approve = async (t: OverviewTask) => {
    try {
      await apiPut(`/api/tasks/${t.id}`, { status: "completed" });
      toast({ title: "Tarefa aprovada" });
      load(true);
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
      load(true);
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSendingRevision(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-[hsl(var(--background))]">

      {/* ── Filters ──────────────────────────────────────────────────────── */}

      {/* Mobile filter bar (< sm) */}
      <div className="sm:hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm p-3 space-y-2">
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tarefa…"
            className="h-9 flex-1 text-sm min-w-0"
          />
          <Button
            variant="outline" size="sm"
            className={`h-9 shrink-0 gap-1.5 relative ${mobileFiltersOpen || (filterStatus !== "all" || filterEditor !== "all" || filterCoord !== "all") ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : ""}`}
            onClick={() => setMobileFiltersOpen(v => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {(filterStatus !== "all" || filterEditor !== "all" || filterCoord !== "all") && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[hsl(var(--primary))] text-white text-[10px] font-bold flex items-center justify-center">
                {[filterStatus !== "active", filterEditor !== "all", filterCoord !== "all"].filter(Boolean).length}
              </span>
            )}
          </Button>
          {canCreate && (
            <Button size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>

        {mobileFiltersOpen && (
          <div className="rounded-xl border bg-[hsl(var(--muted))]/20 p-3 space-y-2">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 text-sm w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterEditor} onValueChange={setFilterEditor}>
              <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Todos os editores" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os editores</SelectItem>
                {editors.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCoord} onValueChange={setFilterCoord}>
              <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Geral</SelectItem>
                {user && <SelectItem value={String(user.id)}>Minhas</SelectItem>}
                {coordinators.filter(c => c.id !== user?.id).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasFilter && (
              <Button variant="outline" size="sm" className="h-8 text-xs w-full gap-1.5" onClick={clearFilters}>
                <X className="h-3 w-3" />Limpar filtros
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-[hsl(var(--muted-foreground))] px-0.5">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
          {hasFilter ? " encontrada" + (filtered.length !== 1 ? "s" : "") : ""}
        </p>
      </div>

      {/* Desktop filter bar (sm+) */}
      <div className="hidden sm:flex items-center gap-2.5 flex-wrap rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tarefa…"
            className="pl-8 h-8 text-sm bg-[hsl(var(--background))]"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterEditor} onValueChange={setFilterEditor}>
          <SelectTrigger className="h-8 w-40 text-xs">
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
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Geral</SelectItem>
            {user && <SelectItem value={String(user.id)}>Minhas</SelectItem>}
            {coordinators.filter(c => c.id !== user?.id).map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilter && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded-md px-2.5 h-8 transition-colors">
            <X className="h-3 w-3" />Limpar
          </button>
        )}
        {canCreate && (
          <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />Nova tarefa
          </Button>
        )}
        <span className={`text-xs text-[hsl(var(--muted-foreground))] shrink-0 ${!canCreate ? "ml-auto" : ""}`}>
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* Column headers — desktop fixed, não scrollam */}
        {(() => {
          const SortIcon = ({ col }: { col: string }) => {
            if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
            return sortDir === "asc"
              ? <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]" />
              : <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]" />;
          };
          const Th = ({ col, label }: { col: string; label: string }) => (
            <button
              onClick={() => toggleSort(col)}
              className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] transition-colors select-none ${sortKey === col ? "text-[hsl(var(--primary))]/80" : ""}`}
            >
              {label}<SortIcon col={col} />
            </button>
          );
          return (
            <div className="hidden md:flex shrink-0 items-center px-4 py-2.5 bg-[hsl(var(--muted))]/30 border-b">
              <div className="flex-1 pr-3"><Th col="taskCode" label="Tarefa" /></div>
              <div className="w-32 shrink-0"><Th col="status" label="Status" /></div>
              <div className="w-20 shrink-0 hidden lg:block"><Th col="priority" label="Prior." /></div>
              <div className="w-32 shrink-0"><Th col="assignee" label="Editor" /></div>
              <div className="w-28 shrink-0 hidden lg:block"><Th col="dueDate" label="Prazo" /></div>
              <div className="w-24 shrink-0 hidden xl:block"><Th col="coordinator" label="Coord." /></div>
              <div className="w-32 shrink-0" />
            </div>
          );
        })()}

        {/* Body scrollável */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

        {/* Loading skeleton */}
        {loading ? (
          <div className="divide-y divide-[hsl(var(--muted))]">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center px-4 py-3 gap-3">
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-48 rounded bg-[hsl(var(--muted))]/60 animate-pulse" />
                  <div className="h-3 w-24 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                </div>
                <div className="hidden md:flex items-center gap-3">
                  <div className="h-6 w-20 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  <div className="h-6 w-16 rounded bg-[hsl(var(--muted))]/40 animate-pulse hidden lg:block" />
                  <div className="h-6 w-20 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  <div className="h-6 w-16 rounded bg-[hsl(var(--muted))]/40 animate-pulse hidden lg:block" />
                </div>
                <div className="h-7 w-7 rounded bg-[hsl(var(--muted))]/40 animate-pulse shrink-0" />
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
          <div>
            {TASK_GROUPS.map(group => {
              const groupTasks = sorted.filter(t => group.statuses.includes(t.status));
              if (!groupTasks.length) return null;
              return (
                <div key={group.key}>
                  <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-1.5 bg-[hsl(var(--card))]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                    <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupTasks.length}</span>
                  </div>
                  <div className="divide-y divide-[hsl(var(--muted))]">
                    {groupTasks.map(t => {
                      const overdue   = isOverdue(t);
                      const canActNow = canAct(t);
                      const isHighlighted = highlighted === t.id;

              // Shared dropdown — rendered in both mobile and desktop slots
              const DropdownItems = () => (
                <DropdownMenuContent align="end">
                  {t.status !== "rascunho" && (
                    <DropdownMenuItem onClick={() => openTask(t.id)}>
                      <ArrowUpRight className="h-3.5 w-3.5" />Ver detalhes
                    </DropdownMenuItem>
                  )}
                  {(t.status === "pending" || t.status === "rascunho") && canActNow && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />Editar tarefa
                      </DropdownMenuItem>
                      {t.status === "rascunho" && (
                        <DropdownMenuItem
                          onClick={() => apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(load)}
                          className="text-zinc-700 focus:text-zinc-700 font-medium">
                          <Send className="h-3.5 w-3.5" />Publicar
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setDeleteTarget({ id: t.id, title: t.title })}>
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
                        <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}>
                          <PauseCircle className="h-3.5 w-3.5" />Pausar tarefa
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}>
                        <XCircle className="h-3.5 w-3.5" />Cancelar tarefa
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              );

              return (
                <div
                  key={t.id}
                  ref={isHighlighted ? highlightRef : null}
                  className="flex items-stretch px-4 hover:bg-[hsl(var(--muted))]/20 transition-all cursor-pointer"
                  onClick={() => (t.status === 'pending' || t.status === 'rascunho') && canActNow ? (setEditTaskId(t.id), setFormOpen(true)) : openTask(t.id)}
                  style={{
                    borderLeft: `3px ${t.status === "rascunho" ? "dashed" : "solid"} ${t.status === "rascunho" ? "#a1a1aa" : (t.color ?? "#6366f1")}`,
                    opacity: t.status === "rascunho" ? 0.75 : 1,
                    backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined,
                    boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined,
                  }}
                >

                  {/* ── Mobile card layout (< md) ──────────────────────── */}
                  <div className="md:hidden flex items-start py-3 w-full min-w-0" style={{ gap: "10px" }}>

                    {/* Left: all task info */}
                    <div className="flex-1 min-w-0" style={{ minWidth: 0 }}>

                      {/* Row 1: code + title (truncates) */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: "5px", minWidth: 0 }}>
                        {t.taskCode && (
                          <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px", fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap", flexShrink: 0, opacity: 0.55, letterSpacing: "-0.02em" }}>
                            {t.taskCode}
                          </span>
                        )}
                        <span style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                          {t.title}
                        </span>
                        {t.revisionCount > 0 && (
                          <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", opacity: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
                            ↩{t.revisionCount}
                          </span>
                        )}
                      </div>

                      {/* Row 2: client (if any) */}
                      {t.client && (
                        <p style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                          {t.client}
                        </p>
                      )}

                      {/* Row 3: status + priority + due date */}
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                        <Badge className={`text-xs px-1.5 py-0 h-5 ${STATUS_CLASS[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                        <PriorityBadge priority={t.priority} />
                        {(() => {
                          const closed = fmtClosedCycle(t.status, t.dueDate, t.updatedAt);
                          if (closed) return (
                            <span style={{ fontSize: "11px", fontWeight: 600 }} className={closed.cls}>
                              {closed.line1}{closed.line2 ? ` · ${closed.line2}` : ""}
                            </span>
                          );
                          if (!t.dueDate) return null;
                          const { label } = fmtPrazoWeek(t.dueDate);
                          return (
                            <span style={{ fontSize: "11px", color: overdue ? "#ef4444" : "hsl(var(--muted-foreground))", fontWeight: overdue ? 600 : 400 }}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Row 4: editors */}
                      {t.editors && t.editors.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px" }}>
                          <StackedAvatars people={t.editors} size={30} max={3} />
                          <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.editors.map(e => e.name.split(" ")[0]).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: action buttons */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {t.status === "rascunho" && canActNow && (
                        <Button size="sm"
                          className={`h-8 w-8 p-0 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                          disabled={!t.editors || t.editors.length === 0}
                          title={!t.editors || t.editors.length === 0 ? "Atribua um editor antes de publicar" : "Publicar"}
                          onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(load); }}>
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {t.status === "review" && canActNow && (
                        <div style={{ display: "flex", gap: "4px" }}>
                          <Button size="sm" className="h-8 text-xs px-2.5 bg-green-600 hover:bg-green-700"
                            onClick={e => { e.stopPropagation(); approve(t); }}>✓</Button>
                          <Button size="sm" variant="outline"
                            className="h-8 text-xs px-2.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                            onClick={e => { e.stopPropagation(); setRevisionTask(t); setRevisionComment(""); }}>↩</Button>
                        </div>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownItems />
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* ── Desktop table columns (md+) ────────────────────── */}

                  {/* Tarefa */}
                  <div className="hidden md:flex flex-1 min-w-0 flex-col justify-center py-3 pr-3">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      {t.taskCode && (
                        <span className="text-[11px] font-semibold font-mono shrink-0 text-[hsl(var(--muted-foreground))]/55 tracking-tight">
                          {t.taskCode}
                        </span>
                      )}
                      <span className="text-sm font-semibold truncate">{t.title}</span>
                      {t.revisionCount > 0 && (
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 shrink-0">↩{t.revisionCount}</span>
                      )}
                    </div>
                    {t.client && (
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60 truncate mt-0.5">{t.client}</p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="hidden md:flex w-32 shrink-0 items-center">
                    <Badge className={`text-[11px] px-2 py-0.5 font-medium ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>

                  {/* Prioridade — only on lg+ */}
                  <div className="hidden lg:flex w-20 shrink-0 items-center">
                    <PriorityBadge priority={t.priority} />
                  </div>

                  {/* Editor */}
                  <div className="hidden md:flex w-32 shrink-0 items-center gap-1.5">
                    {t.editors && t.editors.length > 0 ? (
                      <>
                        <div className="flex items-center" style={{ gap: 0 }}>
                          {t.editors.slice(0, 3).map((e, i) => (
                            <div key={e.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: t.editors.length - i }}>
                              <ChatAvatarButton
                                userId={e.id}
                                name={e.name}
                                avatarUrl={e.avatarUrl}
                                size={28}
                                taskId={t.id}
                                taskCode={t.taskCode}
                                taskTitle={t.title}
                              />
                            </div>
                          ))}
                        </div>
                        {t.editors.length === 1 && (
                          <span className="text-[11px] font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">—</span>
                    )}
                  </div>

                  {/* Prazo — only on lg+ */}
                  <div className="hidden lg:flex w-28 shrink-0 items-center">
                    <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} />
                  </div>

                  {/* Coordenador — only on xl+ */}
                  <div className="hidden xl:flex w-24 shrink-0 items-center gap-1.5">
                    {t.isOwn ? (
                      <span className="text-[11px] text-[hsl(var(--primary))] font-semibold truncate">Você</span>
                    ) : t.coordinator ? (
                      <>
                        <ChatAvatarButton
                          userId={t.coordinator.id}
                          name={t.coordinator.name}
                          avatarUrl={t.coordinator.avatarUrl}
                          size={30}
                          taskId={t.id}
                          taskCode={t.taskCode}
                          taskTitle={t.title}
                        />
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.coordinator.name.split(" ")[0]}</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">—</span>
                    )}
                  </div>

                  {/* Ações — desktop (largura fixa w-32 para não desalinhar) */}
                  <div className="hidden md:flex w-32 shrink-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                    {t.folderUrl && (
                      <a href={t.folderUrl} target="_blank" rel="noreferrer" title="Abrir pasta"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {t.status === "rascunho" && canActNow && (
                      <Button size="icon"
                        className={`h-7 w-7 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                        disabled={!t.editors || t.editors.length === 0}
                        title={!t.editors || t.editors.length === 0 ? "Atribua um editor antes de publicar" : "Publicar"}
                        onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(load); }}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {t.status === "review" && canActNow && (
                      <>
                        <Button size="icon" className="h-7 w-7 bg-green-600 hover:bg-green-700" title="Aprovar"
                          onClick={e => { e.stopPropagation(); approve(t); }}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="outline"
                          className="h-7 w-7 text-orange-600 border-orange-300 hover:bg-orange-50" title="Solicitar alteração"
                          onClick={e => { e.stopPropagation(); setRevisionTask(t); setRevisionComment(""); }}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownItems />
                    </DropdownMenu>
                  </div>

                </div>
              );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        </div>{/* fim body scrollável */}
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

      {reassignTarget && (
        <ReassignEditorModal
          open={!!reassignTarget}
          onOpenChange={v => { if (!v) setReassignTarget(null); }}
          onSaved={() => { setReassignTarget(null); load(true); }}
          taskId={reassignTarget.taskId}
          taskTitle={reassignTarget.taskTitle}
          currentAssignedTo={reassignTarget.assignedTo}
          mode={reassignTarget.mode}
        />
      )}

      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => load(true)}
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

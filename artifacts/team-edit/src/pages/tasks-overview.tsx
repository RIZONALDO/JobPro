import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useSearch } from "wouter";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
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
  ClipboardList, MoreVertical,
  ArrowUpRight, X, PauseCircle, XCircle,
  Pencil, Trash2, Plus, ChevronUp, ChevronDown, ChevronsUpDown, Send,
  SlidersHorizontal, Search, CalendarClock, ChevronRight,
  CheckCircle2, RotateCcw, AlertTriangle,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS, isTerminal } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { TaskFormModal } from "@/components/task-form-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { EditorAvailabilityModal } from "@/components/editor-availability-modal";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { RefreshCw, UserPlus } from "lucide-react";
import { fmtClosedCycle, fmtPrazoWeek, fmtDate } from "@/lib/utils";
import { PrazoCell } from "@/components/prazo-cell";
import { DateRangePicker } from "@/components/ui/date-range-picker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; login: string; avatarUrl?: string | null; }

function scoreColor(score: number): string {
  if (score === 0)  return "#94a3b8";
  if (score <= 6)   return "#22c55e";
  if (score <= 11)  return "#f97316";
  return "#ef4444";
}
function scoreLabel(score: number): string {
  if (score === 0)  return "Disponível";
  if (score <= 6)   return "Ocupado";
  if (score <= 11)  return "Muito ocupado";
  return "No limite";
}

interface OverviewTask {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: string;
  startDate: string | null;
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
  // multi-task
  taskType?: string;
  subtaskProgress?: { total: number; completed: number; percentage: number };
}

interface SubtaskDetail {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  subtaskOrder: number;
  assignedTo: { id: number; name: string; avatarUrl?: string | null } | null;
  editors: { id: number; name: string; avatarUrl?: string | null }[];
  dueDate: string | null;
  revisionCount: number;
  folderUrl: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────


const STATUS_OPTIONS = [
  { value: "active",      label: "Ativas" },
  { value: "all",         label: "Todas" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Em revisão" },
  { value: "in_revision", label: "Em alteração" },
  { value: "reopened",    label: "Reaberta" },
  { value: "paused",      label: "Pausada" },
  { value: "completed",   label: "Concluída" },
  { value: "cancelled",   label: "Cancelada" },
];

const TASK_GROUPS = [
  { key: "pending",  label: "Pendentes",    statuses: ["pending"],               color: "#64748b" },
  { key: "editing",  label: "Em edição",    statuses: ["in_progress"],           color: "#3b82f6" },
  { key: "revision",  label: "Em alteração", statuses: ["in_revision"],          color: "#f97316" },
  { key: "approval",  label: "Em aprovação", statuses: ["review"],               color: "#f59e0b" },
  { key: "reopened", label: "Reabertas",    statuses: ["reopened"],              color: "#e11d48" },
  { key: "paused",   label: "Pausadas",     statuses: ["paused"],                color: "#a855f7" },
  { key: "done",     label: "Concluídas",   statuses: ["completed"],             color: "#22c55e" },
  { key: "cancelled",label: "Canceladas",   statuses: ["cancelled"],             color: "#ef4444" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function TasksOverview() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const { openTask } = useTaskModal();

  const isSuper = user?.role === "admin" || user?.role === "supervisor";
  const canCreate = isSuper || user?.role === "coordinator";

  const [tasks,   setTasks]   = useState<OverviewTask[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [filterStatus, setFilterStatus] = useState("all");
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

  // Reopen dialog
  interface EditorWorkload { id: number; score: number; taskCount: number; }
  const COMPLEXITY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };
  const [reopenTask,        setReopenTask]        = useState<OverviewTask | null>(null);
  const [reopenComment,     setReopenComment]     = useState("");
  const [reopenDueDate,     setReopenDueDate]     = useState("");
  const [reopenComplexity,  setReopenComplexity]  = useState("medium");
  const [reopenPriority,    setReopenPriority]    = useState("medium");
  const [reopenWorkload,    setReopenWorkload]    = useState<EditorWorkload[]>([]);
  const [loadingWorkload,   setLoadingWorkload]   = useState(false);
  const [sendingReopen,     setSendingReopen]     = useState(false);

  // Busca carga em tempo real quando o dialog de reabertura abre
  useEffect(() => {
    if (!reopenTask) return;
    setLoadingWorkload(true);
    apiFetch<EditorWorkload[]>("/api/workload")
      .then(setReopenWorkload)
      .catch(() => {})
      .finally(() => setLoadingWorkload(false));
  }, [reopenTask]);
  const [sendingRevision, setSendingRevision] = useState(false);
  const [confirmTask, setConfirmTask] = useState<{ id: number; title: string; action: "cancel" | "pause" | "resume" | "reactivate" } | null>(null);
  const [confirmComment, setConfirmComment] = useState("");
  const [sendingConfirm, setSendingConfirm] = useState(false);

  // Change due date dialog
  const [changeDueDateTask,  setChangeDueDateTask]  = useState<OverviewTask | null>(null);
  const [changeDueDateValue, setChangeDueDateValue] = useState("");
  const [sendingDueDate,     setSendingDueDate]     = useState(false);

  // Collapsible subtask expansion
  const [expandedIds,            setExpandedIds]            = useState<Set<number>>(new Set());
  const [subtasksMap,            setSubtasksMap]            = useState<Map<number, SubtaskDetail[]>>(new Map());
  const [loadingSubtasks,        setLoadingSubtasks]        = useState<Set<number>>(new Set());
  const [revisionSubtask,        setRevisionSubtask]        = useState<{ id: number; title: string; parentId: number } | null>(null);
  const [revisionSubtaskComment, setRevisionSubtaskComment] = useState("");
  const [sendingRevisionSubtask, setSendingRevisionSubtask] = useState(false);

  // Mobile filter panel toggle
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // View tabs: todas / tarefas do dia / agendadas
  const [viewTab, setViewTab] = useState<"all" | "today" | "scheduled">("today");

  // Create / Edit modal
  const [formOpen,   setFormOpen]   = useState(false);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  // Reassign / add editor modal
  const [reassignTarget, setReassignTarget] = useState<{ taskId: number; taskTitle: string; assignedTo: Person | null; mode: "reassign" | "add" } | null>(null);
  // Availability modal
  const [availEditor, setAvailEditor] = useState<{ id: number; name: string; avatarUrl?: string | null } | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // Approve confirmation
  const [approveTarget, setApproveTarget] = useState<{ taskId: number; title: string; parentId?: number } | null>(null);
  const [approvingTarget, setApprovingTarget] = useState(false);

  const doTaskAction = async (taskId: number, action: "cancel" | "pause" | "resume" | "reactivate") => {
    setSendingConfirm(true);
    try {
      if (action === "resume" || action === "reactivate") {
        await apiPut(`/api/tasks/${taskId}`, { status: "pending" });
        toast.success(action === "reactivate" ? "Tarefa reativada." : "Tarefa retomada.");
      } else {
        await apiPut(`/api/tasks/${taskId}`, {
          status: action === "cancel" ? "cancelled" : "paused",
          revisionComment: confirmComment.trim(),
        });
        toast(action === "cancel" ? "Tarefa cancelada." : "Tarefa pausada.");
      }
      setConfirmTask(null);
      setConfirmComment("");
      load(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setSendingConfirm(false); }
  };

  const deleteTask = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/tasks/${deleteTarget.id}`);
      toast.success("Tarefa excluída");
      setDeleteTarget(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally { setDeleting(false); }
  };

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const qs = filterStatus !== "active" ? `?status=${filterStatus}` : "";
    apiFetch<OverviewTask[]>(`/api/tasks/overview${qs}`)
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => { if (!silent) setLoading(false); });
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  // Keep a ref that always reflects the current expandedIds set (to avoid stale closure in the realtime callback)
  const expandedIdsRef = useRef<Set<number>>(expandedIds);
  useEffect(() => { expandedIdsRef.current = expandedIds; }, [expandedIds]);

  useRealtime({
    onTasksChanged: () => load(true),

    // Fired by subtask:changed — refresh ALL currently expanded panels immediately,
    // without waiting for the debounced load(true). This is the primary real-time
    // mechanism for keeping coordinator panels in sync.
    onSubtaskChanged: () => {
      expandedIdsRef.current.forEach(parentId => {
        apiFetch<SubtaskDetail[]>(`/api/tasks/${parentId}/subtasks`)
          .then(subs => setSubtasksMap(p => new Map(p).set(parentId, subs)))
          .catch(() => {});
      });
    },

    // Fired by multitask:progress — updates the progress chip on the parent row
    // and refreshes the expanded panel for that specific parent.
    onMultitaskProgress: (event) => {
      const { parentTaskId, progress } = event;
      setTasks(prev => prev.map(t =>
        t.id === parentTaskId
          ? { ...t, subtaskProgress: { total: progress.total, completed: progress.completed, percentage: progress.percentage } }
          : t
      ));
      if (expandedIdsRef.current.has(parentTaskId)) {
        apiFetch<SubtaskDetail[]>(`/api/tasks/${parentTaskId}/subtasks`)
          .then(subs => setSubtasksMap(p => new Map(p).set(parentTaskId, subs)))
          .catch(() => {});
      }
    },
  });

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
  // Rascunhos ficam na aba Rascunho — excluídos da Lista
  const filtered = tasks.filter(t => {
    if (t.status === "rascunho") return false;
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor &&
        !t.editors.some(e => String(e.id) === filterEditor)) return false;
    if (filterCoord  !== "all" && String(t.coordinator?.id ?? "") !== filterCoord) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilter = search || filterStatus !== "all" || filterEditor !== "all" || filterCoord !== defaultCoord;
  const clearFilters = () => { setSearch(""); setFilterStatus("all"); setFilterEditor("all"); setFilterCoord(defaultCoord); };

  // ── Client-side sort ──────────────────────────────────────────────────────

  const STATUS_ORDER_SORT = ["pending","in_progress","in_revision","review","reopened","paused","cancelled","completed"];
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


  // ── Tab filtering ─────────────────────────────────────────────────────────

  // Data local (não UTC) para evitar bug de fuso horário
  const TAB_TODAY_STR = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // Uma tarefa é "agendada" se: status pré-execução E data de referência > hoje.
  const SCHEDULED_STATUSES = new Set(["pending", "in_progress", "paused"]);
  const isTaskScheduled = (t: OverviewTask) => {
    if (!SCHEDULED_STATUSES.has(t.status)) return false;
    const ref = t.startDate ?? (t.status === "pending" ? t.dueDate : null);
    if (!ref) return false;
    return ref.split("T")[0] > TAB_TODAY_STR;
  };

  const ACTIVE_STATUSES = new Set(["pending", "in_progress", "in_revision", "review"]);

  const tabFiltered = useMemo(() => {
    if (viewTab === "today")
      return sorted.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status));
    if (viewTab === "scheduled")
      return sorted.filter(t => isTaskScheduled(t));
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, viewTab]);

  // ── Summary stats ─────────────────────────────────────────────────────────

  const now = new Date(); now.setHours(0, 0, 0, 0);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAct = (t: OverviewTask) => t.isOwn || isSuper;
  const isOverdue = (t: OverviewTask) => {
    if (!t.dueDate || isTerminal(t.status)) return false;
    const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
    return due < now;
  };

  const doApprove = async () => {
    if (!approveTarget) return;
    setApprovingTarget(true);
    try {
      await apiPut(`/api/tasks/${approveTarget.taskId}`, { status: "completed" });
      toast.success(approveTarget.parentId ? "Subtarefa aprovada" : "Tarefa aprovada");
      if (approveTarget.parentId) {
        apiFetch<SubtaskDetail[]>(`/api/tasks/${approveTarget.parentId}/subtasks`)
          .then(subs => setSubtasksMap(p => new Map(p).set(approveTarget!.parentId!, subs)));
      }
      setApproveTarget(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar");
    } finally {
      setApprovingTarget(false);
    }
  };

  const submitRevision = async () => {
    if (!revisionTask || !revisionComment.trim()) {
      toast.error("Informe o comentário");
      return;
    }
    setSendingRevision(true);
    try {
      await apiPut(`/api/tasks/${revisionTask.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast.success("Alteração solicitada");
      setRevisionTask(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSendingRevision(false);
    }
  };

  const submitReopen = async () => {
    if (!reopenTask || !reopenComment.trim()) {
      toast.error("Informe o motivo da reabertura");
      return;
    }
    const primaryEditor = reopenTask.assignee ?? reopenTask.editors?.[0] ?? null;
    setSendingReopen(true);
    try {
      await apiPut(`/api/tasks/${reopenTask.id}`, {
        status: "reopened",
        revisionComment: reopenComment.trim(),
        complexity: reopenComplexity,
        priority: reopenPriority,
        ...(reopenDueDate ? { dueDate: reopenDueDate } : {}),
      });
      toast.success("Tarefa reaberta");
      setReopenTask(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSendingReopen(false);
    }
  };

  const submitChangeDueDate = async () => {
    if (!changeDueDateTask || !changeDueDateValue) {
      toast.error("Selecione uma nova data");
      return;
    }
    setSendingDueDate(true);
    try {
      await apiPut(`/api/tasks/${changeDueDateTask.id}`, { dueDate: changeDueDateValue });
      toast.success("Prazo atualizado");
      setChangeDueDateTask(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar prazo");
    } finally {
      setSendingDueDate(false);
    }
  };

  const toggleExpand = (taskId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
        if (!subtasksMap.has(taskId)) {
          setLoadingSubtasks(p => new Set(p).add(taskId));
          apiFetch<SubtaskDetail[]>(`/api/tasks/${taskId}/subtasks`)
            .then(subs => setSubtasksMap(p => new Map(p).set(taskId, subs)))
            .catch(() => toast.error("Erro ao carregar subtarefas"))
            .finally(() => setLoadingSubtasks(p => { const n = new Set(p); n.delete(taskId); return n; }));
        }
      }
      return next;
    });
  };

  const submitRevisionSubtask = async () => {
    if (!revisionSubtask || !revisionSubtaskComment.trim()) { toast.error("Informe o comentário"); return; }
    setSendingRevisionSubtask(true);
    try {
      await apiPut(`/api/tasks/${revisionSubtask.id}`, { status: "in_progress", revisionComment: revisionSubtaskComment.trim() });
      toast.success("Alteração solicitada");
      apiFetch<SubtaskDetail[]>(`/api/tasks/${revisionSubtask.parentId}/subtasks`)
        .then(subs => setSubtasksMap(p => new Map(p).set(revisionSubtask!.parentId, subs)));
      setRevisionSubtask(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setSendingRevisionSubtask(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden p-2 sm:p-4 gap-2 sm:gap-4 bg-[hsl(var(--background))]">


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
            className={`h-9 shrink-0 gap-1.5 relative ${mobileFiltersOpen || (filterStatus !== "all" || filterEditor !== "all" || filterCoord !== defaultCoord) ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]/70" : ""}`}
            onClick={() => setMobileFiltersOpen(v => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {(filterStatus !== "all" || filterEditor !== "all" || filterCoord !== defaultCoord) && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[hsl(var(--primary))] text-white text-[10px] font-bold flex items-center justify-center">
                {[filterStatus !== "all", filterEditor !== "all", filterCoord !== defaultCoord].filter(Boolean).length}
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
          {tabFiltered.length} tarefa{tabFiltered.length !== 1 ? "s" : ""}
          {hasFilter ? " encontrada" + (tabFiltered.length !== 1 ? "s" : "") : ""}
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
          {tabFiltered.length} tarefa{tabFiltered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* ── Tab bar (underline) ─── */}
        <div className="flex shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2">
          {([
            { key: "today",     label: "Tarefas do dia", count: sorted.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status)).length },
            { key: "scheduled", label: "Agendadas",      count: sorted.filter(t => isTaskScheduled(t)).length },
            { key: "all",       label: "Todas",          count: sorted.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setViewTab(tab.key)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewTab === tab.key
                  ? "text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              }`}
            >
              {tab.label}
              <span className={`tabular-nums text-[10px] px-1.5 py-px rounded-full font-bold transition-colors ${
                viewTab === tab.key
                  ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
                  : "bg-[hsl(var(--muted))]/80 text-[hsl(var(--muted-foreground))]/60"
              }`}>
                {tab.count}
              </span>
              {viewTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--primary))] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Column headers — desktop fixed, não scrollam */}
        {(() => {
          const SortIcon = ({ col }: { col: string }) => {
            if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
            return sortDir === "asc"
              ? <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]/70" />
              : <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]/70" />;
          };
          const Th = ({ col, label }: { col: string; label: string }) => (
            <button
              onClick={() => toggleSort(col)}
              className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] transition-colors select-none ${sortKey === col ? "text-[hsl(var(--primary))]/70/80" : ""}`}
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
              {viewTab === "scheduled"
                ? <div className="w-44 shrink-0 hidden lg:block"><Th col="startDate" label="Período" /></div>
                : <div className="w-28 shrink-0 hidden lg:block"><Th col="dueDate" label="Prazo" /></div>
              }
              <div className="w-24 shrink-0 hidden xl:block"><Th col="coordinator" label="Coord." /></div>
              <div className="w-52 shrink-0" />
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

        ) : tabFiltered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {viewTab === "scheduled" ? "Nenhuma tarefa agendada para o futuro." :
               viewTab === "today" ? "Nenhuma tarefa ativa para hoje." :
               hasFilter ? "Nenhuma tarefa corresponde aos filtros." : "Nenhuma tarefa encontrada."}
            </p>
            {hasFilter && viewTab === "all" && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            )}
          </div>

        ) : (
          <div>
            {TASK_GROUPS.map(group => {
              const groupTasks = tabFiltered.filter(t => group.statuses.includes(t.status));
              if (!groupTasks.length) return null;
              return (
                <div key={group.key}>
                  <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 mt-4 bg-[hsl(var(--card))]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                    <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupTasks.length}</span>
                  </div>
                  <div className="divide-y divide-[hsl(var(--muted))]">
                    {groupTasks.map(t => {
                      const overdue      = isOverdue(t);
                      const canActNow    = canAct(t);
                      const isHighlighted = highlighted === t.id;
                      const isUnassigned = t.status === "pending" && (!t.editors || t.editors.length === 0) && !t.assignee;

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
                          onClick={() => {
                            if (!t.dueDate) {
                              toast.error("Defina o prazo antes de publicar");
                              setEditTaskId(t.id); setFormOpen(true);
                              return;
                            }
                            apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true));
                          }}
                          className="text-zinc-700 focus:text-zinc-700 font-medium">
                          <Send className="h-3.5 w-3.5" />Publicar
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setDeleteTarget({ id: t.id, title: t.title })}>
                        <Trash2 className="h-3.5 w-3.5" />Excluir tarefa
                      </DropdownMenuItem>
                    </>
                  )}
                  {t.status === "cancelled" && canActNow && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "reactivate" })}>
                        <ArrowUpRight className="h-3.5 w-3.5" />Reativar tarefa
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget({ id: t.id, title: t.title })}>
                        <Trash2 className="h-3.5 w-3.5" />Excluir tarefa
                      </DropdownMenuItem>
                    </>
                  )}
                  {t.status === "completed" && canActNow && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => { setReopenTask(t); setReopenComment(""); setReopenDueDate(""); setReopenComplexity(t.complexity ?? "medium"); setReopenPriority(t.priority ?? "medium"); }}>
                        <RotateCcw className="h-3.5 w-3.5" />Reabrir tarefa
                      </DropdownMenuItem>
                    </>
                  )}
                  {t.status === "paused" && canActNow && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "resume" })}>
                        <ArrowUpRight className="h-3.5 w-3.5" />Retomar tarefa
                      </DropdownMenuItem>
                    </>
                  )}
                  {!["completed","cancelled","rascunho"].includes(t.status) && canActNow && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setChangeDueDateValue(t.dueDate ?? ""); setChangeDueDateTask(t); }}>
                        <CalendarClock className="h-3.5 w-3.5" />Alterar prazo
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

              const isExpanded    = expandedIds.has(t.id);
              const subList       = subtasksMap.get(t.id) ?? [];
              const isLoadingSubs = loadingSubtasks.has(t.id);
              // Safe percentage — computed from completed/total as fallback if API didn't include it
              const subPct = t.subtaskProgress
                ? (t.subtaskProgress.percentage ?? (
                    t.subtaskProgress.total > 0
                      ? Math.round((t.subtaskProgress.completed / t.subtaskProgress.total) * 100)
                      : 0
                  ))
                : 0;

              return (
                <Fragment key={t.id}>
                <div
                  ref={isHighlighted ? highlightRef : null}
                  className="flex items-stretch px-4 hover:bg-[hsl(var(--muted))]/20 transition-all cursor-pointer"
                  onClick={() => (t.status === 'pending' || t.status === 'rascunho') && canActNow ? (setEditTaskId(t.id), setFormOpen(true)) : openTask(t.id)}
                  style={{
                    borderLeft: `3px ${t.status === "rascunho" ? "dashed" : "solid"} ${group.color}`,
                    opacity: t.status === "rascunho" ? 0.75 : 1,
                    backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined,
                    boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined,
                  }}
                >

                  {/* ── Mobile card layout (< md) ──────────────────────── */}
                  <div className="md:hidden flex items-start py-4 w-full min-w-0 gap-3">

                    {/* Left: all task info */}
                    <div className="flex-1 min-w-0">

                      {/* Row 1: code + title + revision chip */}
                      <div className="flex items-baseline gap-2 min-w-0">
                        {t.taskType === "multi_task" && (
                          <button
                            className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
                            onClick={e => { e.stopPropagation(); toggleExpand(t.id); }}
                          >
                            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                          </button>
                        )}
                        {t.taskCode && (
                          <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">
                            {t.taskCode}
                          </span>
                        )}
                        <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-snug">
                          {t.title}
                        </span>
                        {t.revisionCount > 0 && (
                          <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                            {t.revisionCount} {t.revisionCount === 1 ? "alteração" : "alterações"}
                          </span>
                        )}
                      </div>

                      {/* Row 1b: multi-task compact progress chip */}
                      {t.taskType === "multi_task" && t.subtaskProgress && t.subtaskProgress.total > 0 && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <MultiTaskBadge taskType="multi_task" />
                          <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]/70 font-medium">
                            {t.subtaskProgress.completed}/{t.subtaskProgress.total}
                          </span>
                          <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                subPct === 100 ? "bg-green-500" :
                                subPct >= 66 ? "bg-blue-500" :
                                subPct >= 33 ? "bg-indigo-400" : "bg-slate-400"
                              }`}
                              style={{ width: `${subPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Row 2: client */}
                      {t.client && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-1 leading-snug">
                          {t.client}
                        </p>
                      )}

                      {/* Row 3: status + priority + due date / período */}
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        <Badge className={`text-xs px-2 py-0.5 font-medium shrink-0 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                        {isUnassigned && <span className="text-[11px] text-slate-400 shrink-0">sem editor</span>}
                        <PriorityBadge priority={t.priority} />
                        {viewTab === "scheduled" ? (
                          (t.startDate || t.dueDate) && (() => {
                            const fmtD = (d: string) => d.split("T")[0].split("-").slice(1).reverse().join("/");
                            const s = t.startDate ? fmtD(t.startDate) : null;
                            const e = t.dueDate   ? fmtD(t.dueDate)   : null;
                            return (
                              <span className="flex items-center gap-1 text-xs tabular-nums shrink-0 font-semibold">
                                {s && <span className="text-sky-500">{s}</span>}
                                {s && e && s !== e && <span className="text-[hsl(var(--muted-foreground))]/40 font-normal">→</span>}
                                {e && <span className={overdue ? "text-red-500" : "text-[hsl(var(--foreground))]/75"}>{e}</span>}
                              </span>
                            );
                          })()
                        ) : (() => {
                          const closed = fmtClosedCycle(t.status, t.dueDate, t.updatedAt);
                          if (closed) return (
                            <span className={`text-xs font-semibold shrink-0 ${closed.cls}`}>
                              {closed.line1}{closed.line2 ? ` · ${closed.line2}` : ""}
                            </span>
                          );
                          if (!t.dueDate) return null;
                          const { label } = fmtPrazoWeek(t.dueDate);
                          return (
                            <span className={`text-xs shrink-0 tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]/60"}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Row 4: editors */}
                      {t.editors && t.editors.length > 0 && (
                        <div className="flex items-center gap-2 mt-2.5">
                          <StackedAvatars people={t.editors} size={26} max={3} />
                          <span className="text-xs text-[hsl(var(--muted-foreground))]/70 truncate">
                            {t.editors.map(e => e.name.split(" ")[0]).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {t.status === "rascunho" && canActNow && (
                        <Button size="icon"
                          className={`h-8 w-8 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                          disabled={!t.editors || t.editors.length === 0}
                          title={!t.editors || t.editors.length === 0 ? "Atribua um editor antes de publicar" : "Publicar"}
                          onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {t.status === "review" && canActNow && (
                        <div className="flex gap-1.5 flex-wrap">
                          <Button size="sm"
                            className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
                            onClick={e => { e.stopPropagation(); setApproveTarget({ taskId: t.id, title: t.title }); }}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aprovar
                          </Button>
                          <Button size="sm" variant="outline"
                            className="h-8 gap-1.5 text-amber-600 border-amber-400 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700/60 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                            onClick={e => { e.stopPropagation(); setRevisionTask(t); setRevisionComment(""); }}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Revisar
                          </Button>
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
                    <div className="flex items-baseline gap-2 min-w-0">
                      {t.taskType === "multi_task" && (
                        <button
                          className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
                          onClick={e => { e.stopPropagation(); toggleExpand(t.id); }}
                          title={isExpanded ? "Recolher subtarefas" : "Expandir subtarefas"}
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                        </button>
                      )}
                      {t.taskCode && (
                        <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">
                          {t.taskCode}
                        </span>
                      )}
                      <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
                      {t.revisionCount > 0 && (
                        <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                          {t.revisionCount} {t.revisionCount === 1 ? "alteração" : "alterações"}
                        </span>
                      )}
                    </div>
                    {t.client && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5">{t.client}</p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="hidden md:flex w-36 shrink-0 flex-col gap-1 justify-center">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className={`text-[11px] px-2 py-0.5 font-medium ${STATUS_CLASS[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      <MultiTaskBadge taskType={t.taskType ?? "task"} />
                    </div>
                    {t.taskType === "multi_task" && t.subtaskProgress && t.subtaskProgress.total > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]/70 font-medium leading-none">
                          {t.subtaskProgress.completed}/{t.subtaskProgress.total}
                        </span>
                        <div className="h-1 flex-1 max-w-[48px] rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              subPct === 100 ? "bg-green-500" :
                              subPct >= 66 ? "bg-blue-500" :
                              subPct >= 33 ? "bg-indigo-400" : "bg-slate-400"
                            }`}
                            style={{ width: `${subPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prioridade — only on lg+ */}
                  <div className="hidden lg:flex w-20 shrink-0 items-center">
                    <PriorityBadge priority={t.priority} />
                  </div>

                  {/* Editor — empilhado para multi_task, normal para simples */}
                  <div className="hidden md:flex w-32 shrink-0 items-center gap-1.5">
                    {isUnassigned && t.taskType !== "multi_task" ? (
                      <span className="text-xs text-slate-400">sem editor</span>
                    ) : t.editors && t.editors.length > 0 ? (
                      <>
                        <div className="flex items-center" style={{ gap: 0 }}>
                          {t.editors.slice(0, 4).map((e, i) => (
                            <div key={e.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: t.editors.length - i }}>
                              <ChatAvatarButton
                                userId={e.id}
                                name={e.name}
                                avatarUrl={e.avatarUrl}
                                size={26}
                                taskId={t.id}
                                taskCode={t.taskCode}
                                taskTitle={t.title}
                                onOpenAvailability={() => setAvailEditor({ id: e.id, name: e.name, avatarUrl: e.avatarUrl })}
                              />
                            </div>
                          ))}
                          {t.editors.length > 4 && (
                            <div style={{ marginLeft: -8, zIndex: 0 }}
                              className="h-[26px] w-[26px] rounded-full bg-[hsl(var(--muted))] border-2 border-[hsl(var(--background))] flex items-center justify-center text-[10px] font-bold text-[hsl(var(--muted-foreground))]">
                              +{t.editors.length - 4}
                            </div>
                          )}
                        </div>
                        {t.editors.length === 1 && (
                          <span className="text-[11px] font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">
                        {t.taskType === "multi_task" ? "sem subtarefas" : "—"}
                      </span>
                    )}
                  </div>

                  {/* Período / Prazo — desktop lg+ */}
                  {viewTab === "scheduled" ? (
                    <div className="hidden lg:flex w-44 shrink-0 items-center gap-1 tabular-nums text-xs font-semibold">
                      {(() => {
                        const fmtD = (d: string) => d.split("T")[0].split("-").slice(1).reverse().join("/");
                        const s = t.startDate ? fmtD(t.startDate) : null;
                        const e = t.dueDate   ? fmtD(t.dueDate)   : null;
                        return (
                          <>
                            {s && <span className="text-sky-500">{s}</span>}
                            {s && e && s !== e && <span className="text-[hsl(var(--muted-foreground))]/40 font-normal">→</span>}
                            {e && <span className={overdue ? "text-red-500" : "text-[hsl(var(--foreground))]/80"}>{e}</span>}
                            {!s && !e && <span className="text-[hsl(var(--muted-foreground))]/30">—</span>}
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="hidden lg:flex w-28 shrink-0 items-center">
                      <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} />
                    </div>
                  )}

                  {/* Coordenador — only on xl+ */}
                  <div className="hidden xl:flex w-24 shrink-0 items-center gap-1.5">
                    {t.isOwn ? (
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]/55 font-semibold truncate">Você</span>
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

                  {/* Ações — desktop (largura fixa w-52 para não desalinhar) */}
                  <div className="hidden md:flex w-52 shrink-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                    {t.status === "rascunho" && canActNow && (
                      <Button size="icon"
                        className={`h-7 w-7 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                        disabled={!t.editors || t.editors.length === 0}
                        title={!t.editors || t.editors.length === 0 ? "Atribua um editor antes de publicar" : "Publicar"}
                        onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {t.status === "review" && canActNow && (
                      <>
                        <Button size="sm"
                          className="h-7 gap-1 text-xs bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
                          onClick={e => { e.stopPropagation(); setApproveTarget({ taskId: t.id, title: t.title }); }}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Aprovar
                        </Button>
                        <Button size="sm" variant="outline"
                          className="h-7 gap-1 text-xs text-amber-600 border-amber-400 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700/60 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                          onClick={e => { e.stopPropagation(); setRevisionTask(t); setRevisionComment(""); }}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Revisar
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

                {/* ── Subtask expansion rows ─────────────────────────────── */}
                {t.taskType === "multi_task" && isExpanded && (
                  <div className="divide-y divide-[hsl(var(--muted))]">
                    {isLoadingSubs ? (
                      <div className="flex items-center gap-2 px-10 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                        Carregando subtarefas…
                      </div>
                    ) : subList.length === 0 ? (
                      <div className="px-10 py-2.5 text-xs text-[hsl(var(--muted-foreground))]/60 italic">
                        Nenhuma subtarefa encontrada.
                      </div>
                    ) : subList.map(sub => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-3 pl-10 pr-4 py-2.5 bg-[hsl(var(--muted))]/10 hover:bg-[hsl(var(--muted))]/25 transition-colors cursor-pointer border-l-4"
                        style={{ borderLeftColor: `${group.color}55` }}
                        onClick={() => openTask(sub.id)}
                      >
                        {/* Subtask info */}
                        <div className="flex-1 min-w-0 flex items-baseline gap-2">
                          {sub.taskCode && (
                            <span className="shrink-0 font-mono text-xs text-[hsl(var(--primary))]/70">{sub.taskCode}</span>
                          )}
                          <span className="text-sm truncate">{sub.title}</span>
                          {sub.revisionCount > 0 && (
                            <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                              {sub.revisionCount} {sub.revisionCount === 1 ? "alteração" : "alterações"}
                            </span>
                          )}
                        </div>
                        {/* Subtask status */}
                        <Badge className={`text-[11px] px-2 py-0.5 shrink-0 hidden md:inline-flex ${STATUS_CLASS[sub.status] ?? ""}`}>
                          {STATUS_LABEL[sub.status] ?? sub.status}
                        </Badge>
                        {/* Subtask editor avatar */}
                        <div className="hidden md:flex items-center shrink-0">
                          {(sub.assignedTo ?? sub.editors?.[0]) && (() => {
                            const person = sub.assignedTo ?? sub.editors[0];
                            return (
                              <ChatAvatarButton
                                userId={person.id}
                                name={person.name}
                                avatarUrl={person.avatarUrl}
                                size={24}
                                taskId={sub.id}
                                taskCode={sub.taskCode}
                                taskTitle={sub.title}
                                onOpenAvailability={() => setAvailEditor({ id: person.id, name: person.name, avatarUrl: person.avatarUrl })}
                              />
                            );
                          })()}
                        </div>
                        {/* Subtask action buttons */}
                        {sub.status === "review" && canActNow && (
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            <Button
                              size="sm"
                              className="h-6 px-2 gap-1 text-[11px] bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
                              onClick={e => { e.stopPropagation(); setApproveTarget({ taskId: sub.id, title: sub.title, parentId: t.id }); }}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 gap-1 text-[11px] text-amber-600 border-amber-400 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700/60 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                              onClick={e => { e.stopPropagation(); setRevisionSubtask({ id: sub.id, title: sub.title, parentId: t.id }); setRevisionSubtaskComment(""); }}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Revisar
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </Fragment>
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

      {/* ── Cancel / Pause / Resume confirm dialog ───────────────────────── */}
      <Dialog open={!!confirmTask} onOpenChange={open => { if (!open && !sendingConfirm) { setConfirmTask(null); setConfirmComment(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmTask?.action === "cancel" ? "Cancelar tarefa" : confirmTask?.action === "pause" ? "Pausar tarefa" : confirmTask?.action === "reactivate" ? "Reativar tarefa" : "Retomar tarefa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {confirmTask?.action === "cancel"
                ? <>Tem certeza que deseja <strong>cancelar</strong> <em>"{confirmTask?.title}"</em>? Os editores serão notificados.</>
                : confirmTask?.action === "pause"
                  ? <>Tem certeza que deseja <strong>pausar</strong> <em>"{confirmTask?.title}"</em>? Os editores serão notificados.</>
                  : confirmTask?.action === "reactivate"
                    ? <>A tarefa <em>"{confirmTask?.title}"</em> voltará para <strong>Pendente</strong> e os editores serão notificados.</>
                    : <>A tarefa <em>"{confirmTask?.title}"</em> voltará para <strong>Pendente</strong> e os editores serão notificados.</>}
            </p>
            {confirmTask?.action !== "resume" && confirmTask?.action !== "reactivate" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Motivo <span className="text-destructive">*</span>
                </label>
                <Textarea
                  placeholder={confirmTask?.action === "cancel" ? "Motivo do cancelamento…" : "Motivo da pausa…"}
                  value={confirmComment}
                  onChange={e => setConfirmComment(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                  disabled={sendingConfirm}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmTask(null); setConfirmComment(""); }} disabled={sendingConfirm}>Voltar</Button>
            <Button
              className={confirmTask?.action === "cancel" ? "bg-red-600 hover:bg-red-700" : confirmTask?.action === "pause" ? "bg-purple-600 hover:bg-purple-700" : ""}
              onClick={() => confirmTask && doTaskAction(confirmTask.id, confirmTask.action)}
              disabled={sendingConfirm || (confirmTask?.action !== "resume" && confirmTask?.action !== "reactivate" && !confirmComment.trim())}
            >
              {sendingConfirm ? "Aguarde…" : confirmTask?.action === "cancel" ? "Confirmar cancelamento" : confirmTask?.action === "pause" ? "Confirmar pausa" : confirmTask?.action === "reactivate" ? "Reativar" : "Retomar"}
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

      {/* ── Change due date dialog ───────────────────────────────────────── */}
      <Dialog open={!!changeDueDateTask} onOpenChange={open => { if (!open) setChangeDueDateTask(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar prazo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {changeDueDateTask?.dueDate && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-[hsl(var(--muted))]/40 text-sm">
                <span className="text-[hsl(var(--muted-foreground))]">Prazo atual:</span>
                <span className="font-semibold">{fmtDate(changeDueDateTask.dueDate)}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Novo prazo</Label>
              <DateRangePicker
                startDate=""
                endDate={changeDueDateValue}
                onChangeStart={() => {}}
                onChangeEnd={setChangeDueDateValue}
                withEndTime
                placeholder="Selecionar novo prazo…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeDueDateTask(null)}>Cancelar</Button>
            <Button onClick={submitChangeDueDate} disabled={sendingDueDate || !changeDueDateValue}>
              {sendingDueDate ? "Salvando…" : "Salvar prazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!reopenTask} onOpenChange={open => { if (!open) { setReopenTask(null); setReopenDueDate(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reabrir tarefa aprovada</DialogTitle>
          </DialogHeader>
          {(() => {
            const t = reopenTask;
            if (!t) return null;
            const primaryEditor  = t.assignee ?? t.editors?.[0] ?? null;
            const editorWl      = primaryEditor ? reopenWorkload.find(w => w.id === primaryEditor.id) : null;
            const currentScore  = editorWl?.score ?? 0;
            const addedWeight   = COMPLEXITY_WEIGHT[reopenComplexity] ?? 6;
            const projectedScore = currentScore + addedWeight;
            const currentColor  = scoreColor(currentScore);
            const currentLbl    = scoreLabel(currentScore);
            const projColor     = scoreColor(projectedScore);
            const projLbl       = scoreLabel(projectedScore);
            return (
              <div className="space-y-3 py-1">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  A tarefa voltará ao status <strong>Reaberta</strong> e o editor será notificado.
                </p>

                {/* Editor + carga atual + projeção */}
                {primaryEditor && (
                  <div className="rounded-xl border px-3 py-2.5 space-y-2 bg-[hsl(var(--muted))]/30">
                    <div className="flex items-center gap-2.5">
                      <AvatarDisplay name={primaryEditor.name} avatarUrl={primaryEditor.avatarUrl} size={28} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{primaryEditor.name}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">editor atribuído</p>
                      </div>
                      {loadingWorkload
                        ? <span className="text-[10px] text-[hsl(var(--muted-foreground))]">verificando…</span>
                        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ background: `${currentColor}22`, color: currentColor }}>
                            {currentLbl}
                          </span>
                      }
                    </div>
                    {/* Projeção com a complexidade escolhida */}
                    {!loadingWorkload && (
                      <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]/50 pt-2">
                        <span>Após reabertura ({reopenComplexity === "low" ? "Baixa" : reopenComplexity === "medium" ? "Média" : "Alta"}):</span>
                        <span className="font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${projColor}22`, color: projColor }}>
                          {projLbl}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {projectedBlocked && !loadingWorkload && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-700 dark:text-red-300">
                      Com esta complexidade, <strong>{primaryEditor?.name.split(" ")[0]}</strong> ficaria no limite. Reduza a complexidade ou reatribua a tarefa.
                    </p>
                  </div>
                )}

                {/* Prazo anterior */}
                {t.dueDate && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-[hsl(var(--muted))]/40 text-sm">
                    <span className="text-[hsl(var(--muted-foreground))]">Prazo anterior:</span>
                    <span className="font-semibold">{fmtDate(t.dueDate)}</span>
                  </div>
                )}

                {/* Complexidade + Prioridade */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Complexidade</Label>
                    <Select value={reopenComplexity} onValueChange={setReopenComplexity}>
                      <SelectTrigger className="h-9 text-sm rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Prioridade</Label>
                    <Select value={reopenPriority} onValueChange={setReopenPriority}>
                      <SelectTrigger className="h-9 text-sm rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Novo prazo */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Novo prazo <span className="font-normal normal-case">(opcional)</span>
                  </Label>
                  <DateRangePicker
                    startDate=""
                    endDate={reopenDueDate}
                    onChangeStart={() => {}}
                    onChangeEnd={setReopenDueDate}
                    withEndTime
                    placeholder="Selecionar novo prazo…"
                  />
                </div>

                {/* Motivo */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Motivo da reabertura *
                  </Label>
                  <Textarea
                    value={reopenComment}
                    onChange={e => setReopenComment(e.target.value)}
                    rows={3}
                    placeholder="Descreva o que o cliente solicitou alterar…"
                    autoFocus
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTask(null)}>Cancelar</Button>
            <Button
              onClick={submitReopen}
              disabled={sendingReopen || !reopenComment.trim() || loadingWorkload}
              className="bg-rose-600 hover:bg-rose-700">
              {sendingReopen ? "Reabrindo…" : "↩ Reabrir tarefa"}
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

      <EditorAvailabilityModal
        open={availEditor !== null}
        onOpenChange={v => { if (!v) setAvailEditor(null); }}
        editor={availEditor}
      />


      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => load(true)}
        editTaskId={editTaskId}
      />

      {/* ── Approve confirm dialog ───────────────────────────────────────── */}
      <Dialog open={!!approveTarget} onOpenChange={open => { if (!open && !approvingTarget) setApproveTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500" />
              {approveTarget?.parentId ? "Aprovar subtarefa" : "Aprovar tarefa"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-1 space-y-2">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Tem certeza que deseja <strong className="text-[hsl(var(--foreground))]">aprovar</strong>{" "}
              {approveTarget?.parentId ? "a subtarefa" : "a tarefa"}{" "}
              <em>"{approveTarget?.title}"</em>?
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]/70">
              {approveTarget?.parentId
                ? "A subtarefa será marcada como concluída."
                : "A tarefa será marcada como concluída e o editor será notificado."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approvingTarget}>
              Cancelar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
              onClick={doApprove}
              disabled={approvingTarget}
            >
              {approvingTarget ? "Aprovando…" : "Confirmar aprovação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* ── Revision dialog — subtarefa ───────────────────────────────────── */}
      <Dialog open={!!revisionSubtask} onOpenChange={open => !open && setRevisionSubtask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar alteração — subtarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {revisionSubtask && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                <span className="font-medium text-[hsl(var(--foreground))]">{revisionSubtask.title}</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Comentário do cliente *</Label>
              <Textarea
                value={revisionSubtaskComment}
                onChange={e => setRevisionSubtaskComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar…"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionSubtask(null)}>Cancelar</Button>
            <Button
              onClick={submitRevisionSubtask}
              disabled={sendingRevisionSubtask || !revisionSubtaskComment.trim()}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {sendingRevisionSubtask ? "Enviando…" : "↩ Solicitar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

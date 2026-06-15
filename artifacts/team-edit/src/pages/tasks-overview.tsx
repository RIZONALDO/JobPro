import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from "@tanstack/react-table";
import React, { useMemo as reactUseMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useSearch, useLocation } from "wouter";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ClipboardList, MoreVertical, Calendar, Info, Undo2,
  ArrowUpRight, X, PauseCircle, XCircle, Check,
  Pencil, Trash2, Plus, ChevronUp, ChevronDown, ChevronsUpDown, Send,
  SlidersHorizontal, Search, CalendarClock, ChevronRight, ExternalLink,
  CheckCircle2, RotateCcw, AlertTriangle, Clock, FileVideo,
  Clapperboard, AudioLines, MessageSquare,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS, STATUS_DOT, STATUS_CHIP, isTerminal } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { TaskFormModal } from "@/components/task-form-modal";
import { EscalaModal } from "@/components/EscalaModal";
import { RescheduleModal } from "@/components/reschedule-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { EditorAvailabilityModal } from "@/components/editor-availability-modal";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { RefreshCw, UserPlus, ShieldAlert } from "lucide-react";
import { fmtClosedCycle, fmtPrazoWeek, fmtDate } from "@/lib/utils";
import { PrazoCell } from "@/components/prazo-cell";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DatePicker } from "@/components/ui/date-picker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; login: string; avatarUrl?: string | null; }


function loadColor(hours: number, cap: number): string {
  if (cap === 0 || hours === 0) return "#94a3b8";
  const pct = hours / cap;
  if (pct <= 0.5) return "#eab308";
  if (pct < 1.0)  return "#f97316";
  return "#ef4444";
}
function loadLabel(hours: number, cap: number): string {
  if (cap === 0 || hours === 0) return "Disponível";
  const pct = hours / cap;
  if (pct <= 0.5) return "Ocupado";
  if (pct < 1.0)  return "Muito ocupado";
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
  coCoordinators: { id: number; name: string; avatarUrl?: string | null }[];
  isOwn: boolean;
  isCoCoord: boolean;
  updatedAt: string;
  reviewedAt?: string | null;
  effortHours?: number | null;
  hasAllocToday?: boolean;
  todaySlotIndex?: number | null;
  totalSlots?: number | null;
  fileCount?: number;
  fileKind?: "video" | "audio" | "mixed" | "other" | null;
  unreadCommentCount?: number;
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

// ─── TransferTaskModal ────────────────────────────────────────────────────────

function TransferTaskModal({ task, onClose, onDone }: {
  task: OverviewTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const [coords, setCoords]   = useState<CoordEntry[]>([]);
  const [search, setSearch]   = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const ROLE_LABEL: Record<string, string> = { admin: "Admin", supervisor: "Superv.", coordinator: "Coord." };

  useEffect(() => {
    apiFetch<CoordEntry[]>("/api/coordinators").then(setCoords).catch(() => {});
  }, []);

  const filtered = coords.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleTransfer = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: selected }),
      });
      toast.success("Tarefa transferida com sucesso");
      onDone();
    } catch { toast.error("Erro ao transferir tarefa"); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-3xl border border-[hsl(var(--border))] shadow-2xl flex flex-col overflow-hidden bg-[hsl(var(--card))]" style={{ maxHeight: "82vh" }}>

        <div className="px-6 pt-7 pb-4 space-y-1 shrink-0">
          <p className="text-xl font-black tracking-tight">Transferir tarefa</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))] truncate">{task.title}</p>
        </div>

        <div className="mx-6 mb-4 px-3.5 py-2.5 rounded-2xl bg-amber-500/8 border border-amber-500/20 shrink-0">
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
            O novo coordenador assume a titularidade completa. Você perderá o acesso de gestão desta tarefa.
          </p>
        </div>

        <div className="px-6 pb-2 shrink-0">
          <div className="flex items-center gap-2 h-9 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar coordenador…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]/35" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2">
          <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
            {filtered.length === 0
              ? <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-6">Nenhum coordenador encontrado</p>
              : filtered.map(c => {
                const on = selected === c.id;
                return (
                  <button key={c.id} onClick={() => setSelected(on ? null : c.id)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${on ? "bg-[hsl(var(--primary))]/8" : "hover:bg-[hsl(var(--muted))]/40"}`}>
                    <AvatarDisplay name={c.name} avatarUrl={c.avatarUrl} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{ROLE_LABEL[c.role] ?? c.role}</p>
                    </div>
                    <div className={`h-4 w-4 rounded-full border flex items-center justify-center transition-all shrink-0
                      ${on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
                      {on && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>}
                    </div>
                  </button>
                );
              })
            }
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
          <button onClick={onClose}
            className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            Cancelar
          </button>
          <button onClick={handleTransfer} disabled={!selected || sending}
            className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors"
            style={{ background: "hsl(var(--primary))" }}>
            {sending ? "Transferindo…" : "Transferir"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ManageCoordsModal ────────────────────────────────────────────────────────

interface CoordEntry { id: number; name: string; role: string; avatarUrl: string | null; }

function ManageCoordsModal({ task, currentUserId, onClose }: {
  task: OverviewTask;
  currentUserId: number;
  onClose: () => void;
}) {
  const [coCoords, setCoCoords]   = useState<CoordEntry[]>([]);
  const [available, setAvailable] = useState<CoordEntry[]>([]);
  const [search, setSearch]       = useState("");
  const [adding, setAdding]       = useState(false);
  const [removing, setRemoving]   = useState<number | null>(null);

  const ROLE_LABEL: Record<string, string> = { admin: "Admin", supervisor: "Superv.", coordinator: "Coord." };

  const load = useCallback(async () => {
    const [current, all] = await Promise.all([
      apiFetch<CoordEntry[]>(`/api/tasks/${task.id}/coordinators`),
      apiFetch<CoordEntry[]>("/api/coordinators"),
    ]);
    setCoCoords(current);
    const currentIds = new Set(current.map(c => c.id));
    setAvailable(all.filter(c => !currentIds.has(c.id) && c.id !== currentUserId));
  }, [task.id, currentUserId]);

  useEffect(() => { load(); }, [load]);

  const addCoord = async (targetId: number) => {
    setAdding(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/coordinators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: targetId }),
      });
      toast.success("Co-coordenador adicionado");
      load();
    } catch { toast.error("Erro ao adicionar co-coordenador"); }
    finally { setAdding(false); }
  };

  const removeCoord = async (targetId: number) => {
    setRemoving(targetId);
    try {
      await apiFetch(`/api/tasks/${task.id}/coordinators/${targetId}`, { method: "DELETE" });
      toast.success("Co-coordenador removido");
      load();
    } catch { toast.error("Erro ao remover"); }
    finally { setRemoving(null); }
  };

  const filteredAvail = available.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-3xl border border-[hsl(var(--border))] shadow-2xl flex flex-col overflow-hidden bg-[hsl(var(--card))]" style={{ maxHeight: "82vh" }}>

        <div className="px-6 pt-7 pb-4 space-y-1 shrink-0">
          <p className="text-xl font-black tracking-tight">Co-coordenadores</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))] truncate">{task.title}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {coCoords.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Atuais</p>
              <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
                {coCoords.map(c => (
                  <div key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <AvatarDisplay name={c.name} avatarUrl={c.avatarUrl} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{ROLE_LABEL[c.role] ?? c.role}</p>
                    </div>
                    <button onClick={() => removeCoord(c.id)} disabled={removing === c.id}
                      className="h-6 w-6 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Adicionar</p>
            <div className="flex items-center gap-2 h-9 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3">
              <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/40 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar coordenador…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]/35" />
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
              {filteredAvail.length === 0
                ? <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-6">Nenhum disponível</p>
                : filteredAvail.map(c => (
                  <button key={c.id} disabled={adding} onClick={() => addCoord(c.id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-[hsl(var(--muted))]/40 transition-colors text-left disabled:opacity-50">
                    <AvatarDisplay name={c.name} avatarUrl={c.avatarUrl} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{ROLE_LABEL[c.role] ?? c.role}</p>
                    </div>
                    <Plus className="h-3.5 w-3.5 text-[hsl(var(--primary))]/70 shrink-0" />
                  </button>
                ))
              }
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex justify-end shrink-0">
          <button onClick={onClose}
            className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors"
            style={{ background: "hsl(var(--primary))" }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────


const STATUS_OPTIONS = [
  { value: "active",      label: "Ativas" },
  { value: "all",         label: "Todas" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Em revisão" },
  { value: "reopened",    label: "Reaberta" },
  { value: "paused",      label: "Pausada" },
  { value: "completed",   label: "Concluída" },
  { value: "cancelled",   label: "Cancelada" },
];

const TASK_GROUPS = [
  { key: "pending",  label: "Pendentes",    statuses: ["pending"],               color: "#64748b" },
  { key: "editing",  label: "Em edição",    statuses: ["in_progress"],           color: "#3b82f6" },
  { key: "approval",  label: "Em aprovação", statuses: ["review"],               color: "#f59e0b" },
  { key: "reopened", label: "Reabertas",    statuses: ["reopened"],              color: "#e11d48" },
  { key: "paused",   label: "Pausadas",     statuses: ["paused"],                color: "#a855f7" },
  { key: "done",     label: "Concluídas",   statuses: ["completed"],             color: "#22c55e" },
  { key: "cancelled",label: "Canceladas",   statuses: ["cancelled"],             color: "#ef4444" },
];

const TODAY_SECTIONS_COORD = [
  { key: "approve",  label: "Para aprovar",   statuses: ["review"],              color: "#f59e0b", defaultCollapsed: false, canReview: true  },
  { key: "working",  label: "Em produção",    statuses: ["in_progress"],         color: "#3b82f6", defaultCollapsed: false, canReview: false },
  { key: "start",    label: "Sem início",     statuses: ["pending", "reopened"], color: "#64748b", defaultCollapsed: false, canReview: false },
  { key: "done",     label: "Entregues hoje", statuses: ["completed"],           color: "#22c55e", defaultCollapsed: true,  canReview: false },
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
  interface EditorWorkload { id: number; hoursToday: number; dailyCap: number; taskCount: number; }
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

  // Reagendar via ESCALA (tarefas com effortHours)
  const [rescheduleTask, setRescheduleTask] = useState<OverviewTask | null>(null);

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

  // Slots de alocação para tab Agendadas do coordenador
  interface CoordScheduleSlot {
    workDate: string; startTime: string | null; endTime: string | null; hours: number | null;
    taskId: number; taskCode: string; taskTitle: string; client: string | null;
    color: string | null; status: string; priority: string | null; revisionCount: number;
    editor: { id: number; name: string; avatarUrl?: string | null } | null;
  }
  const [coordSlots, setCoordSlots] = useState<CoordScheduleSlot[]>([]);
  const [coordSlotsLoading, setCoordSlotsLoading] = useState(false);
  const [, navigate] = useLocation();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(TODAY_SECTIONS_COORD.filter(s => s.defaultCollapsed).map(s => s.key))
  );
  const toggleSection = (key: string) =>
    setCollapsedSections(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ── MONITOR ──────────────────────────────────────────────────────────────────
  interface MonitorRisk {
    taskId: number; taskCode: string; taskTitle: string;
    editorName: string | null; riskLevel: "at_risk"|"critical"|"overdue"|"recovering"|"not_started";
    riskScore: number; missedSlots: number; hoursLost: number;
    remainingEffort: number; remainingCapacity: number;
    daysUntilDeadline: number; dueDate: string | null; status: string; nextSlot: string | null;
  }
  interface MonitorDashboard { slotsToday: number; pendingToday: number; overdue: number; missedTotal: number; }
  const [monitorRisks,     setMonitorRisks]     = useState<MonitorRisk[]>([]);
  const [monitorDashboard, setMonitorDashboard] = useState<MonitorDashboard | null>(null);
  const [monitorOpen,      setMonitorOpen]      = useState(false);
  const [monitorLoading,   setMonitorLoading]   = useState(false);

  const loadMonitor = useCallback(async () => {
    setMonitorLoading(true);
    try {
      const [risks, dash] = await Promise.all([
        apiFetch<MonitorRisk[]>("/api/monitor/risks"),
        apiFetch<MonitorDashboard>("/api/monitor/dashboard"),
      ]);
      setMonitorRisks(risks);
      setMonitorDashboard(dash);
    } catch { toast.error("Erro ao carregar MONITOR"); }
    finally { setMonitorLoading(false); }
  }, []);

  useEffect(() => { loadMonitor(); }, [loadMonitor]);

  // ── REPLANO ───────────────────────────────────────────────────────────────────
  interface ReplanSlot { date: string; hours: number; startTime: string; endTime: string; }
  interface ReplanContext {
    taskId: number; taskTitle: string; taskStatus: string;
    currentEditorId: number; currentEditorName: string | null; currentEditorAvatar: string | null;
    effortHours: number; confirmedHours: number; remainingEffort: number;
    missedSlots: number; hoursLost: number;
    originalDueDate: string | null; daysUntilDeadline: number;
  }
  interface ReplanEditorOption {
    id: number; name: string; avatarUrl: string | null;
    isCurrent: boolean; feasible: boolean;
    completionDate: string | null; daysToFinish: number | null;
  }
  interface ReplanPreview {
    newSlots: ReplanSlot[]; feasible: boolean;
    deadlineExtended: boolean; originalDueDate: string | null; suggestedDueDate: string | null;
    message?: string;
  }

  const [replanoTaskId,    setReplanoTaskId]    = useState<number | null>(null);
  const [replanoStep,      setReplanoStep]      = useState(0);
  const [replanoCtx,       setReplanoCtx]       = useState<ReplanContext | null>(null);
  const [replanoEditors,   setReplanoEditors]   = useState<ReplanEditorOption[]>([]);
  const [replanoPreview,   setReplanoPreview]   = useState<ReplanPreview | null>(null);
  const [replanoEditorId,  setReplanoEditorId]  = useState<number | null>(null);
  const [replanoMode,      setReplanoMode]      = useState<"consecutive"|"alternating">("consecutive");
  const [replanoLoading,   setReplanoLoading]   = useState(false);
  const [replanoPreviewLoading, setReplanoPreviewLoading] = useState(false);
  const [replanoApplying,  setReplanoApplying]  = useState(false);
  const [replanoNewDate,   setReplanoNewDate]   = useState<string>("");

  // Carrega slots na montagem — garante contador correto em qualquer aba
  const loadCoordSlots = useCallback(() => {
    setCoordSlotsLoading(viewTab === "scheduled");
    apiFetch<CoordScheduleSlot[]>("/api/coordinator-schedule")
      .then(setCoordSlots)
      .catch(() => {})
      .finally(() => setCoordSlotsLoading(false));
  }, [viewTab]);

  const refreshEditors = useCallback(async (taskId: number, mode: "consecutive"|"alternating") => {
    setReplanoPreviewLoading(true);
    try {
      const editors = await apiFetch<ReplanEditorOption[]>(`/api/replano/editors/${taskId}?mode=${mode}`);
      setReplanoEditors(editors);
      // Se o editor selecionado sumiu do ranking, mantém mas a data de conclusão atualiza
    } catch {}
    finally { setReplanoPreviewLoading(false); }
  }, []);

  const refreshPreview = useCallback(async (taskId: number, editorId: number, mode: "consecutive"|"alternating") => {
    setReplanoPreviewLoading(true);
    try {
      const preview = await apiFetch<ReplanPreview>(
        `/api/replano/preview/${taskId}?editorId=${editorId}&mode=${mode}`
      );
      setReplanoPreview(preview);
      setReplanoNewDate(prev => prev || (preview.suggestedDueDate ?? preview.originalDueDate ?? ""));
    } catch {}
    finally { setReplanoPreviewLoading(false); }
  }, []);

  const openReplano = useCallback(async (taskId: number) => {
    setReplanoTaskId(taskId);
    setReplanoStep(0);
    setReplanoCtx(null);
    setReplanoEditors([]);
    setReplanoPreview(null);
    setReplanoNewDate("");
    setReplanoMode("consecutive");
    setReplanoLoading(true);
    try {
      const [ctx, editors] = await Promise.all([
        apiFetch<ReplanContext>(`/api/replano/context/${taskId}`),
        apiFetch<ReplanEditorOption[]>(`/api/replano/editors/${taskId}?mode=consecutive`),
      ]);
      setReplanoCtx(ctx);
      setReplanoEditors(editors);
      setReplanoEditorId(ctx.currentEditorId);
      await refreshPreview(taskId, ctx.currentEditorId, "consecutive");
    } catch { toast.error("Erro ao carregar dados do replano"); setReplanoTaskId(null); }
    finally { setReplanoLoading(false); }
  }, [refreshPreview]);

  const applyReplano = useCallback(async () => {
    if (!replanoTaskId || !replanoPreview || !replanoEditorId) return;
    setReplanoApplying(true);
    try {
      await apiPost(`/api/replano/apply/${replanoTaskId}`, {
        editorId:   replanoEditorId,
        mode:       replanoMode,
        newDueDate: replanoNewDate || undefined,
      });
      toast.success("Nova agenda confirmada!");
      setReplanoTaskId(null);
      loadMonitor();
      loadCoordSlots();
    } catch { toast.error("Erro ao confirmar agenda"); }
    finally { setReplanoApplying(false); }
  }, [replanoTaskId, replanoPreview, replanoEditorId, replanoMode, replanoNewDate, loadMonitor, loadCoordSlots]);

  // EscalaModal (criação de nova tarefa)
  const [escalaOpen, setEscalaOpen] = useState(false);

  // TaskFormModal (edição de tarefa existente)
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
  const [manageCoordsTask, setManageCoordsTask] = useState<OverviewTask | null>(null);
  const [transferTask, setTransferTask] = useState<OverviewTask | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ taskId: number; title: string; parentId?: number } | null>(null);
  const [approvingTarget,    setApprovingTarget]    = useState(false);
  const [approveFiles,       setApproveFiles]       = useState<{ id: number; fileName: string; mimeType: string | null; revisionNumber: number; createdAt: string; uploaderName: string | null }[]>([]);
  const [approveFilesLoading,setApproveFilesLoading]= useState(false);
  const [approvedFileIds,    setApprovedFileIds]    = useState<Set<number>>(new Set());

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

  useEffect(() => { loadCoordSlots(); }, []);

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
  const filtered = useMemo(() => tasks.filter(t => {
    if (t.status === "rascunho") return false;
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor &&
        !t.editors.some(e => String(e.id) === filterEditor)) return false;
    if (filterCoord !== "all" && String(t.coordinator?.id ?? "") !== filterCoord && !(t.isCoCoord && filterCoord === String(user?.id ?? ""))) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [tasks, filterEditor, filterCoord, search, user]);

  const hasFilter = search || filterStatus !== "all" || filterEditor !== "all" || filterCoord !== defaultCoord;
  const clearFilters = () => { setSearch(""); setFilterStatus("all"); setFilterEditor("all"); setFilterCoord(defaultCoord); };

  // ── Client-side sort ──────────────────────────────────────────────────────

  const STATUS_ORDER_SORT = ["pending","in_progress","review","reopened","paused","cancelled","completed"];
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

  // Uma tarefa é "agendada" se: status pré-execução E sem trabalho hoje.
  const SCHEDULED_STATUSES = new Set(["pending", "in_progress", "paused"]);
  const isTaskScheduled = (t: OverviewTask) => {
    if (!SCHEDULED_STATUSES.has(t.status)) return false;
    // v2 ESCALA (tem effortHours): tarefa pendente só aparece hoje se tem alocação hoje
    if (t.effortHours != null && t.status === "pending") return !t.hasAllocToday;
    // in_progress / paused: usa startDate
    const ref = t.startDate ?? (t.status === "pending" ? t.dueDate : null);
    if (!ref) return false;
    return ref.split("T")[0] > TAB_TODAY_STR;
  };

  const ACTIVE_STATUSES = new Set(["pending", "in_progress", "review"]);

  const tabFiltered = useMemo(() => {
    if (viewTab === "today")
      return sorted.filter(t => {
        if (t.status === "completed") return t.dueDate?.split("T")[0] === TAB_TODAY_STR;
        return !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status);
      });
    if (viewTab === "scheduled")
      return sorted.filter(t => isTaskScheduled(t));
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, viewTab]);

  // ── Summary stats ─────────────────────────────────────────────────────────

  const now = new Date(); now.setHours(0, 0, 0, 0);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAct = (t: OverviewTask) => t.isOwn || t.isCoCoord || isSuper;
  const isOverdue = (t: OverviewTask) => {
    if (!t.dueDate || isTerminal(t.status)) return false;
    const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
    return due < now;
  };

  // Carrega arquivos da tarefa ao abrir o dialog de aprovação
  useEffect(() => {
    if (!approveTarget) { setApproveFiles([]); setApprovedFileIds(new Set()); return; }
    setApproveFilesLoading(true);
    apiFetch<{ id: number; fileName: string; mimeType: string | null; revisionNumber: number; createdAt: string; uploaderName: string | null }[]>(
      `/api/tasks/${approveTarget.taskId}/files`
    ).then(files => {
      setApproveFiles(files);
      if (files.length > 0) {
        const latestRev = Math.max(...files.map(f => f.revisionNumber));
        setApprovedFileIds(new Set(files.filter(f => f.revisionNumber === latestRev).map(f => f.id)));
      }
    }).catch(() => {}).finally(() => setApproveFilesLoading(false));
  }, [approveTarget?.taskId]);

  const doApprove = async () => {
    if (!approveTarget) return;
    setApprovingTarget(true);
    try {
      // Marca arquivos selecionados como aprovados
      if (approvedFileIds.size > 0) {
        await apiPatch(`/api/tasks/${approveTarget.taskId}/files/approve`, { fileIds: [...approvedFileIds] });
      }
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

  // ── TanStack Table ────────────────────────────────────────────────────────

  const [tanSorting, setTanSorting] = useState<SortingState>([]);

  const overviewColumns = reactUseMemo<ColumnDef<OverviewTask, unknown>[]>(() => [
    // 1 — Tarefa: identidade + badges inline + ícone de mídia
    {
      id: "tarefa",
      accessorKey: "title",
      header: "Tarefa",
      cell: ({ row }) => {
        const t = row.original;
        const isExpanded = expandedIds.has(t.id);
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {t.taskType === "multi_task" && (
                <button className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
                  onClick={e => { e.stopPropagation(); toggleExpand(t.id); }}>
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                </button>
              )}
              {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
              <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
              <MultiTaskBadge taskType={t.taskType ?? "task"} />
              {t.totalSlots && t.totalSlots > 1 && (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]/70 border border-[hsl(var(--primary))]/20 whitespace-nowrap">
                  {t.todaySlotIndex ? (t.todaySlotIndex === t.totalSlots ? "Etapa final" : `Etapa ${t.todaySlotIndex}/${t.totalSlots}`) : `${t.totalSlots} sessões`}
                </span>
              )}
              {t.revisionCount > 0 && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">
                  {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
                </span>
              )}
            </div>
            {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5">{t.client}</p>}
          </div>
        );
      },
    },
    // 2 — Status: alpha chip (Vercel/Stripe style) + barra de progresso (multi_task)
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      size: 160,
      cell: ({ row }) => {
        const t = row.original;
        const subPct = t.subtaskProgress
          ? (t.subtaskProgress.percentage ?? (t.subtaskProgress.total > 0 ? Math.round((t.subtaskProgress.completed / t.subtaskProgress.total) * 100) : 0))
          : 0;
        return (
          <div className="flex flex-col gap-1.5">
            <span className={`inline-flex w-fit items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none tracking-[0.01em] ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
            {(t.unreadCommentCount ?? 0) > 0 && (
              <button
                title={`${t.unreadCommentCount} comentário${t.unreadCommentCount !== 1 ? "s" : ""} não lido${t.unreadCommentCount !== 1 ? "s" : ""}`}
                onClick={e => { e.stopPropagation(); openTask(t.id, "entrega"); }}
                className="inline-flex items-center gap-1 w-fit px-1.5 py-[3px] rounded-[4px] text-[10px] font-semibold transition-colors hover:bg-red-500/15"
                style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.20)" }}
              >
                <MessageSquare className="h-2.5 w-2.5 shrink-0" style={{ fill: "currentColor", stroke: "none" }} />
                <span>ajustes</span>
              </button>
            )}
            {(t.fileCount ?? 0) > 0 && t.status !== "review" && (
              <button
                title={`Ver mídia entregue · ${t.fileCount} arquivo${t.fileCount !== 1 ? "s" : ""}`}
                onClick={e => { e.stopPropagation(); openTask(t.id, "entrega"); }}
                className={`inline-flex items-center gap-1 w-fit px-1.5 py-[3px] rounded-[4px] text-[10px] font-medium transition-colors
                  ${t.fileKind === "audio"
                    ? "bg-sky-500/8 text-sky-600 dark:text-sky-400 hover:bg-sky-500/15"
                    : "bg-violet-500/8 text-violet-600 dark:text-violet-400 hover:bg-violet-500/15"}`}
              >
                {t.fileKind === "audio" ? (
                  <AudioLines className="h-3 w-3 shrink-0" />
                ) : t.fileKind === "mixed" ? (
                  <><Clapperboard className="h-3 w-3 shrink-0" /><AudioLines className="h-3 w-3 shrink-0 opacity-70" /></>
                ) : (
                  <Clapperboard className="h-3 w-3 shrink-0" />
                )}
                <span>{t.fileCount} {t.fileKind === "audio" ? "áudio" : t.fileKind === "mixed" ? "arquivos" : t.fileCount === 1 ? "vídeo" : "vídeos"}</span>
              </button>
            )}
            {t.taskType === "multi_task" && t.subtaskProgress && t.subtaskProgress.total > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]/70">{t.subtaskProgress.completed}/{t.subtaskProgress.total}</span>
                <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${subPct === 100 ? "bg-green-500" : subPct >= 66 ? "bg-blue-500" : subPct >= 33 ? "bg-indigo-400" : "bg-slate-400"}`} style={{ width: `${subPct}%` }} />
                </div>
              </div>
            )}
          </div>
        );
      },
    },
    // 3 — Entrega: junto do Status para leitura de "saúde" da tarefa
    {
      id: "entrega",
      header: () => viewTab === "scheduled"
        ? <span>Data agendada</span>
        : <span className="flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />Entrega</span>,
      size: viewTab === "scheduled" ? 176 : 112,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        const overdue = isOverdue(t);
        if (viewTab === "scheduled") {
          const fmtDT = (d: string) => {
            const dt  = new Date(d);
            const day = dt.getDate();
            const mon = dt.getMonth() + 1;
            const h   = dt.getHours();
            const m   = dt.getMinutes();
            const time = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
            return `${day}/${mon} ${time}`;
          };
          const s = t.startDate ? fmtDT(t.startDate) : null;
          const e = t.dueDate   ? fmtDT(t.dueDate)   : null;
          return (
            <span className="flex items-center gap-1 tabular-nums text-xs font-semibold">
              {s && <span className="text-sky-500">{s}</span>}
              {s && e && <><span className="text-[hsl(var(--muted-foreground))]/40 font-normal">→</span><span className={overdue ? "text-red-500" : ""}>{e}</span></>}
              {!s && e && <span className={overdue ? "text-red-500" : ""}>{e}</span>}
              {!s && !e && <span className="text-[hsl(var(--muted-foreground))]/30">—</span>}
            </span>
          );
        }
        return <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} reviewedAt={t.reviewedAt} />;
      },
    },
    // 4 — Prioridade
    {
      id: "prioridade",
      accessorKey: "priority",
      header: "Prior.",
      size: 80,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    },
    // 5 — Editor
    {
      id: "editor",
      header: "Editor",
      size: 128,
      cell: ({ row }) => {
        const t = row.original;
        const isUnassigned = !t.assignee && (!t.editors || t.editors.length === 0);
        if (isUnassigned && t.taskType !== "multi_task") return <span className="text-xs text-slate-400">sem editor</span>;
        if (!t.editors || t.editors.length === 0) return <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">{t.taskType === "multi_task" ? "sem subtarefas" : "—"}</span>;
        return (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center">
              {t.editors.slice(0, 4).map((e, i) => (
                <div key={e.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: t.editors.length - i }}>
                  <ChatAvatarButton userId={e.id} name={e.name} avatarUrl={e.avatarUrl} size={26}
                    taskId={t.id} taskCode={t.taskCode} taskTitle={t.title}
                    onOpenAvailability={() => setAvailEditor({ id: e.id, name: e.name, avatarUrl: e.avatarUrl })} />
                </div>
              ))}
              {t.editors.length > 4 && (
                <div style={{ marginLeft: -8 }} className="h-[26px] w-[26px] rounded-full bg-[hsl(var(--muted))] border-2 border-[hsl(var(--background))] flex items-center justify-center text-[10px] font-bold text-[hsl(var(--muted-foreground))]">+{t.editors.length - 4}</div>
              )}
            </div>
            {t.editors.length === 1 && <span className="text-[11px] font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>}
          </div>
        );
      },
    },
    // 6 — Coordenador: adjacente ao Editor (bloco de pessoas)
    {
      id: "coordenador",
      header: "Coord.",
      size: 96,
      meta: { className: "hidden xl:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        const hasCoCoords = t.coCoordinators?.length > 0;
        if (t.isOwn && !hasCoCoords) return <span className="text-[11px] text-[hsl(var(--muted-foreground))]/55 font-semibold">Você</span>;
        if (!t.coordinator) return <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">—</span>;

        // Stack: titular + co-coords
        const allCoords = [
          t.coordinator,
          ...(t.coCoordinators ?? []),
        ];
        if (allCoords.length === 1) {
          return (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <ChatAvatarButton userId={allCoords[0].id} name={allCoords[0].name} avatarUrl={allCoords[0].avatarUrl}
                size={28} taskId={t.id} taskCode={t.taskCode} taskTitle={t.title} />
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">
                {t.isOwn ? "Você" : allCoords[0].name.split(" ")[0]}
              </span>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <StackedAvatars
              people={allCoords.map(c => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl ?? null }))}
              size={22} max={3}
            />
          </div>
        );
      },
    },
    // 7 — Ações
    {
      id: "acoes",
      header: "Ações",
      size: 208,
      cell: ({ row }) => {
        const t = row.original;
        const canActNow = canAct(t);

        const isNotTerminal = !isTerminal(t.status);

        return (
          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
            {t.status === "rascunho" && canActNow && (
              <Button size="icon" className={`h-7 w-7 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                disabled={!t.editors || t.editors.length === 0}
                onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={e => { e.stopPropagation(); setEditTaskId(t.id); setFormOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" />Editar tarefa
                </DropdownMenuItem>
                {t.isOwn && t.taskType === "task" && (
                  <>
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); setManageCoordsTask(t); }}>
                      <UserPlus className="h-3.5 w-3.5" />Coordenadores
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); setTransferTask(t); }}>
                      <ArrowUpRight className="h-3.5 w-3.5" />Transferir tarefa
                    </DropdownMenuItem>
                  </>
                )}
                {canActNow && isNotTerminal && (
                  <>
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" }); }}>
                      <ArrowUpRight className="h-3.5 w-3.5" />Reatribuir editor
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "add" }); }}>
                      <Plus className="h-3.5 w-3.5" />Adicionar editor
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); setRescheduleTask(t); }}>
                      <CalendarClock className="h-3.5 w-3.5" />Alterar prazo
                    </DropdownMenuItem>
                  </>
                )}
                {canActNow && t.status === "completed" && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setReopenTask(t); setReopenComment(""); setReopenDueDate(""); setReopenComplexity("medium"); setReopenPriority("medium"); }}>
                    <RotateCcw className="h-3.5 w-3.5" />Reabrir tarefa
                  </DropdownMenuItem>
                )}
                {canActNow && t.status === "cancelled" && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setConfirmTask({ id: t.id, title: t.title, action: "reactivate" }); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />Reativar tarefa
                  </DropdownMenuItem>
                )}
                {canActNow && isNotTerminal && <DropdownMenuSeparator />}
                {canActNow && t.status !== "paused" && isNotTerminal && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setConfirmTask({ id: t.id, title: t.title, action: "pause" }); }}>
                    <PauseCircle className="h-3.5 w-3.5" />Pausar tarefa
                  </DropdownMenuItem>
                )}
                {canActNow && t.status === "paused" && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setConfirmTask({ id: t.id, title: t.title, action: "resume" }); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />Retomar tarefa
                  </DropdownMenuItem>
                )}
                {canActNow && isNotTerminal && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setConfirmTask({ id: t.id, title: t.title, action: "cancel" }); }} className="text-red-600 focus:text-red-600">
                    <XCircle className="h-3.5 w-3.5" />Cancelar tarefa
                  </DropdownMenuItem>
                )}
                {canActNow && isTerminal(t.status) && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setDeleteTarget({ id: t.id, title: t.title }); }} className="text-red-600 focus:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />Excluir tarefa
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [viewTab, expandedIds, setAvailEditor, setEditTaskId, setFormOpen, setApproveTarget, setRevisionTask, setRevisionComment, setReopenTask, setConfirmTask, setDeleteTarget, setReassignTarget, setRescheduleTask, setManageCoordsTask, setTransferTask, load]);

  const overviewTable = useReactTable({
    data: tabFiltered,
    columns: overviewColumns,
    state: { sorting: tanSorting },
    onSortingChange: setTanSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
            <Button size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => setEscalaOpen(true)}>
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
          <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={() => setEscalaOpen(true)}>
            <Plus className="h-3.5 w-3.5" />Nova tarefa
          </Button>
        )}
        {/* MONITOR — botão de alerta */}
        {monitorRisks.length > 0 && (
          <button
            onClick={() => { setMonitorOpen(o => !o); }}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-semibold transition-colors border"
            style={{
              background: monitorRisks.some(r => r.riskLevel === "overdue") ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
              borderColor: monitorRisks.some(r => r.riskLevel === "overdue") ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)",
              color: monitorRisks.some(r => r.riskLevel === "overdue") ? "#ef4444" : "#f59e0b",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {monitorRisks.length} alerta{monitorRisks.length !== 1 ? "s" : ""}
          </button>
        )}
        <span className={`text-xs text-[hsl(var(--muted-foreground))] shrink-0 ${!canCreate ? "ml-auto" : ""}`}>
          {tabFiltered.length} tarefa{tabFiltered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Painel MONITOR ───────────────────────────────────────────────── */}
      {monitorOpen && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-xs font-black uppercase tracking-widest text-[hsl(var(--foreground))]/70">Monitor de execução</span>
            {monitorRisks.length > 0 && (
              <div className="flex items-center gap-3 ml-2">
                {(() => {
                  const nOverdue     = monitorRisks.filter(r => r.riskLevel === "overdue").length;
                  const nNotStarted  = monitorRisks.filter(r => r.riskLevel === "not_started").length;
                  const nCritical    = monitorRisks.filter(r => r.riskLevel === "critical").length;
                  const nAtRisk      = monitorRisks.filter(r => r.riskLevel === "at_risk").length;
                  const nRecovering  = monitorRisks.filter(r => r.riskLevel === "recovering").length;
                  return (<>
                    {nOverdue > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                        {nOverdue} prazo vencido{nOverdue !== 1 ? "s" : ""}
                      </span>
                    )}
                    {nCritical > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20">
                        {nCritical} crítica{nCritical !== 1 ? "s" : ""}
                      </span>
                    )}
                    {nNotStarted > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 border border-violet-500/20">
                        {nNotStarted} não iniciada{nNotStarted !== 1 ? "s" : ""}
                      </span>
                    )}
                    {nAtRisk > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        {nAtRisk} em risco
                      </span>
                    )}
                    {nRecovering > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                        {nRecovering} em recuperação
                      </span>
                    )}
                    {monitorDashboard && monitorDashboard.pendingToday > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        {monitorDashboard.pendingToday} {monitorDashboard.pendingToday !== 1 ? "sessões" : "sessão"} hoje sem confirmação
                      </span>
                    )}
                  </>);
                })()}
              </div>
            )}
            <button onClick={loadMonitor} className="ml-auto opacity-40 hover:opacity-80 transition-opacity">
              <RefreshCw className={`h-3.5 w-3.5 ${monitorLoading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={() => setMonitorOpen(false)} className="opacity-40 hover:opacity-80 transition-opacity">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Lista de riscos */}
          {monitorLoading ? (
            <div className="py-8 flex items-center justify-center gap-2">
              <div className="h-4 w-4 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Analisando…</span>
            </div>
          ) : monitorRisks.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum alerta no momento.</p>
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]/30">
              {monitorRisks.map(r => {
                const RISK_COLOR: Record<string, string> = {
                  overdue: "#ef4444", critical: "#f97316", not_started: "#8b5cf6",
                  at_risk: "#f59e0b", recovering: "#06b6d4",
                };
                const RISK_LABEL: Record<string, string> = {
                  overdue: "Prazo vencido", critical: "Crítico", not_started: "Não iniciada",
                  at_risk: "Em risco", recovering: "Em recuperação",
                };
                const color = RISK_COLOR[r.riskLevel] ?? "#94a3b8";
                const canReplan = ["critical","at_risk","not_started","overdue","recovering"].includes(r.riskLevel);
                return (
                  <div key={r.taskId} className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors group">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => { setEditTaskId(r.taskId); setFormOpen(true); setMonitorOpen(false); }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-mono font-semibold text-[hsl(var(--primary))]/60">{r.taskCode}</span>
                        <span className="text-sm font-semibold truncate text-[hsl(var(--foreground))]/85">{r.taskTitle}</span>
                        {r.editorName && <span className="text-xs text-[hsl(var(--muted-foreground))]/45 truncate shrink-0">{r.editorName.split(" ")[0]}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color, borderColor: `${color}40`, background: `${color}10` }}>
                          {RISK_LABEL[r.riskLevel]}
                        </span>
                        {r.missedSlots > 0 && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/55">
                            {r.missedSlots} {r.missedSlots !== 1 ? "sessões" : "sessão"} não executada{r.missedSlots !== 1 ? "s" : ""} · {r.hoursLost}h
                          </span>
                        )}
                        {r.remainingEffort > 0 && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/55">
                            {r.remainingEffort}h restantes
                            {r.remainingCapacity > 0 ? ` / ${r.remainingCapacity}h disponíveis` : " · sem sessões futuras"}
                          </span>
                        )}
                        {r.dueDate && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/55">
                            entrega {r.daysUntilDeadline < 0 ? `atrasada ${Math.abs(r.daysUntilDeadline)}d` : r.daysUntilDeadline === 0 ? "hoje" : `em ${r.daysUntilDeadline}d`}
                          </span>
                        )}
                        {r.nextSlot && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]/55">
                            próxima sessão {new Date(r.nextSlot + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </div>
                    {canReplan && (
                      <button
                        onClick={e => { e.stopPropagation(); openReplano(r.taskId); }}
                        className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all
                          opacity-0 group-hover:opacity-100
                          bg-[hsl(var(--primary))]/5 border-[hsl(var(--primary))]/20 text-[hsl(var(--primary))]
                          hover:bg-[hsl(var(--primary))]/15"
                      >
                        Replaneja
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal REPLANO (wizard 5 steps) ──────────────────────────────── */}
      {(() => {
        const STEPS = ["O que aconteceu", "Como e quem?", "Prazo do cliente", "Confirmar"];
        const closeReplano = () => { setReplanoTaskId(null); setReplanoCtx(null); setReplanoPreview(null); setReplanoStep(0); };
        const selectedEditor = replanoEditors.find(e => e.id === replanoEditorId);
        const canNext =
          replanoStep === 0 ? true :
          replanoStep === 1 ? !!replanoEditorId :
          replanoStep === 2 ? !!replanoNewDate :
          false;

        return (
          <Dialog open={!!replanoTaskId} onOpenChange={open => { if (!open) closeReplano(); }}>
            <DialogContent className="w-[calc(100vw-16px)] sm:max-w-md p-0 gap-0 overflow-hidden rounded-3xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[88vh]">
              <DialogTitle className="sr-only">Recuperar atraso</DialogTitle>

              {/* ── Step indicator ─────────────────────────────────────── */}
              <div className="px-6 pt-5 pb-4 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
                    {replanoLoading ? "Carregando…" : `Passo ${replanoStep + 1} de ${STEPS.length}`}
                  </span>
                  <span className="text-[11px] font-semibold text-[hsl(var(--primary))]">{STEPS[replanoStep]}</span>
                </div>
                <div className="flex gap-1.5">
                  {STEPS.map((_, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      i < replanoStep ? "bg-[hsl(var(--primary))]" :
                      i === replanoStep ? "bg-[hsl(var(--primary))]/60" :
                      "bg-[hsl(var(--border))]"
                    }`} />
                  ))}
                </div>
              </div>

              {/* ── Body ───────────────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {replanoLoading ? (
                  <div className="px-6 py-12 flex items-center justify-center gap-3">
                    <div className="h-5 w-5 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">Analisando a situação…</span>
                  </div>
                ) : replanoCtx && (
                  <div className="px-6 pb-5">

                    {/* Título da tarefa (sempre visível) */}
                    <p className="text-xl font-black border-b-2 pb-1 mb-5"
                      style={{ borderBottomColor: "hsl(var(--primary))", opacity: 0.8 }}>
                      {replanoCtx.taskTitle}
                    </p>

                    {/* ── STEP 1: O que aconteceu ─────────────────────── */}
                    {replanoStep === 0 && (
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-[hsl(var(--muted))]/30 divide-y divide-[hsl(var(--border))]/30">
                          {replanoCtx.missedSlots > 0 && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <span className="text-sm text-[hsl(var(--foreground))]/70">{replanoCtx.currentEditorName?.split(" ")[0]} não foi em</span>
                              <span className="text-sm font-bold text-red-500">{replanoCtx.missedSlots} {replanoCtx.missedSlots !== 1 ? "sessões" : "sessão"} · {replanoCtx.hoursLost}h</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-[hsl(var(--foreground))]/70">Já foi feito</span>
                            <span className="text-sm font-bold text-emerald-500">{replanoCtx.confirmedHours}h</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-[hsl(var(--foreground))]/70">Ainda falta</span>
                            <span className="text-sm font-bold text-[hsl(var(--foreground))]">{replanoCtx.remainingEffort}h</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-[hsl(var(--foreground))]/70">Prazo do cliente</span>
                            <span className={`text-sm font-bold ${replanoCtx.daysUntilDeadline < 0 ? "text-red-500" : replanoCtx.daysUntilDeadline <= 3 ? "text-amber-500" : "text-[hsl(var(--foreground))]"}`}>
                              {replanoCtx.daysUntilDeadline < 0
                                ? `atrasou ${Math.abs(replanoCtx.daysUntilDeadline)}d`
                                : replanoCtx.daysUntilDeadline === 0 ? "hoje"
                                : `daqui ${replanoCtx.daysUntilDeadline}d`}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── STEP 2: Como distribuir + quem recupera (juntos) ── */}
                    {replanoStep === 1 && (
                      <div className="space-y-4">
                        {/* Toggle modo — afeta o ranking abaixo */}
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Como distribuir os dias?</p>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { value: "consecutive" as const, label: "Dias seguidos", desc: "Termina mais rápido" },
                              { value: "alternating" as const, label: "Dias alternados", desc: "Folga entre sessões" },
                            ]).map(opt => (
                              <button key={opt.value} onClick={() => {
                                setReplanoMode(opt.value);
                                if (replanoTaskId) {
                                  refreshEditors(replanoTaskId, opt.value);
                                  if (replanoEditorId) refreshPreview(replanoTaskId, replanoEditorId, opt.value);
                                }
                              }}
                                className={`flex flex-col items-start px-4 py-3 rounded-2xl border transition-all ${
                                  replanoMode === opt.value
                                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5"
                                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30"
                                }`}>
                                <span className={`text-sm font-bold ${replanoMode === opt.value ? "text-[hsl(var(--primary))]" : ""}`}>{opt.label}</span>
                                <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 mt-0.5">{opt.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Ranking de editores (atualiza quando modo muda) */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Quem vai recuperar?</p>
                            {replanoPreviewLoading && <div className="h-3 w-3 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />}
                          </div>
                          {replanoEditors.map((e, i) => (
                            <button key={e.id} onClick={() => {
                              setReplanoEditorId(e.id);
                              if (replanoTaskId) refreshPreview(replanoTaskId, e.id, replanoMode);
                            }}
                              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                                replanoEditorId === e.id
                                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5"
                                  : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30"
                              }`}>
                              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${replanoEditorId === e.id ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--muted-foreground))]/30"}`}>
                                {replanoEditorId === e.id && <div className="w-2 h-2 rounded-full bg-[hsl(var(--primary))]" />}
                              </div>
                              <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={28} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-semibold">{e.name}</span>
                                  {e.isCurrent && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">mesmo editor</span>}
                                  {i === 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">mais rápido</span>}
                                </div>
                                <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                                  {e.feasible && e.completionDate
                                    ? `termina em ${new Date(e.completionDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
                                    : "sem disponibilidade"}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── STEP 3: Prazo do cliente ────────────────────── */}
                    {replanoStep === 2 && (
                      <div className="space-y-3">
                        {replanoPreview?.deadlineExtended ? (
                          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-500/8 border border-amber-500/20">
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-bold text-amber-600 dark:text-amber-400">O prazo atual não dá mais tempo</p>
                              <p className="text-xs text-amber-500/80 mt-0.5">A nova agenda termina depois do prazo combinado com o cliente. Defina uma nova data abaixo.</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-emerald-500/8 border border-emerald-500/20">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">A nova agenda termina antes do prazo combinado com o cliente.</p>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Quando o cliente precisa receber?</p>
                          <input
                            type="date"
                            value={replanoNewDate}
                            onChange={e => setReplanoNewDate(e.target.value)}
                            className="w-full h-10 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                          />
                          {replanoCtx.originalDueDate && replanoNewDate !== replanoCtx.originalDueDate && (
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                              Prazo original: {new Date(replanoCtx.originalDueDate + "T12:00:00").toLocaleDateString("pt-BR")}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── STEP 4: Resumo e confirmação ────────────────── */}
                    {replanoStep === 3 && replanoPreview && (
                      <div className="space-y-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Isso é o que vai acontecer</p>

                        {/* Quem */}
                        <div className="rounded-2xl bg-[hsl(var(--muted))]/30 px-4 py-3 flex items-center gap-3">
                          {selectedEditor && <AvatarDisplay name={selectedEditor.name} avatarUrl={selectedEditor.avatarUrl} size={32} />}
                          <div>
                            <p className="text-sm font-bold">{selectedEditor?.name ?? "—"}</p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                              {replanoMode === "consecutive" ? "dias seguidos" : "dias alternados"} · {replanoCtx.remainingEffort}h restantes
                            </p>
                          </div>
                        </div>

                        {/* Sessões */}
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                            {replanoPreview.newSlots.length} {replanoPreview.newSlots.length !== 1 ? "novas sessões" : "nova sessão"} agendada{replanoPreview.newSlots.length !== 1 ? "s" : ""}
                          </p>
                          {replanoPreview.newSlots.map((s, i) => (
                            <div key={i} className="flex items-center justify-between rounded-2xl bg-[hsl(var(--muted))]/30 px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))]/60 shrink-0" />
                                <span className="text-sm font-semibold capitalize">
                                  {new Date(s.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
                                </span>
                              </div>
                              <span className="text-xs text-[hsl(var(--muted-foreground))]/60 tabular-nums">
                                {s.startTime} – {s.endTime} · <span className="font-bold text-[hsl(var(--foreground))]/70">{s.hours}h</span>
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Prazo */}
                        <div className="rounded-2xl bg-[hsl(var(--muted))]/30 px-4 py-3 flex items-center justify-between">
                          <span className="text-sm text-[hsl(var(--foreground))]/70">Prazo do cliente</span>
                          <span className="text-sm font-bold">
                            {replanoNewDate
                              ? new Date(replanoNewDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" })
                              : "—"}
                            {replanoPreview.deadlineExtended && replanoCtx.originalDueDate && replanoNewDate !== replanoCtx.originalDueDate && (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">ajustado</span>
                            )}
                          </span>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>

              {/* ── Footer (navegação) ──────────────────────────────────── */}
              <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 shrink-0 bg-[hsl(var(--card))]">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => replanoStep === 0 ? closeReplano() : setReplanoStep(s => s - 1)}
                    className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors"
                  >
                    {replanoStep === 0 ? "Cancelar" : "Voltar"}
                  </button>

                  {replanoStep < 3 ? (
                    <button
                      onClick={() => setReplanoStep(s => s + 1)}
                      disabled={!canNext || replanoLoading}
                      className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors"
                      style={{ background: "hsl(var(--primary))" }}
                    >
                      Próximo
                    </button>
                  ) : (
                    <button
                      onClick={applyReplano}
                      disabled={replanoApplying || !replanoPreview?.feasible || !replanoEditorId}
                      className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
                      style={{ background: "hsl(var(--primary))" }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {replanoApplying ? "Confirmando…" : "Confirmar nova agenda"}
                    </button>
                  )}
                </div>
              </div>

            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* ── Tab bar (underline) ─── */}
        <div className="flex shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2">
          {([
            { key: "today",     label: "Tarefas do dia", count: sorted.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status)).length },
            { key: "scheduled", label: "Agendadas",      count: coordSlots.length || sorted.filter(t => isTaskScheduled(t)).length },
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

        ) : viewTab === "scheduled" ? (
          /* ── Agendadas — um card por slot de alocação real ───── */
          (() => {
            const DAY_NAMES = ["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
            const MON_NAMES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
            const fmtSlotTime = (t: string) => {
              const [h, m] = t.split(":").map(Number);
              return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
            };

            if (coordSlotsLoading) return (
              <div className="py-12 flex items-center justify-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
                <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando agenda…</span>
              </div>
            );

            if (coordSlots.length === 0) return (
              <div className="py-16 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma sessão agendada.</p>
              </div>
            );

            return (
              <div className="divide-y divide-[hsl(var(--border))]/25">
                {coordSlots.map((s, idx) => {
                  const d = new Date(s.workDate + "T12:00:00");
                  return (
                    <div
                      key={`${s.taskId}-${s.workDate}-${idx}`}
                      onClick={() => { setEditTaskId(s.taskId); setFormOpen(true); }}
                      className="flex items-stretch cursor-pointer hover:bg-[hsl(var(--muted))]/20 transition-colors"
                      style={{ borderLeft: `3px solid ${s.color ?? "#6366f1"}` }}
                    >
                      {/* Date column */}
                      <div className="w-16 shrink-0 flex flex-col items-center justify-center gap-0 py-4 border-r border-[hsl(var(--border))]/25">
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/35">{DAY_NAMES[d.getDay()]}</span>
                        <span className="text-[22px] font-black tabular-nums leading-none text-[hsl(var(--foreground))]/50">{d.getDate()}</span>
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/35">{MON_NAMES[d.getMonth()]}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 min-w-0">
                            {s.taskCode && <span className="shrink-0 text-xs font-mono font-semibold text-[hsl(var(--primary))]/70">{s.taskCode}</span>}
                            <p className="text-sm font-semibold truncate text-[hsl(var(--foreground))]/90">{s.taskTitle}</p>
                            {s.client && <span className="shrink-0 text-xs font-medium text-[hsl(var(--muted-foreground))]/40 truncate max-w-[120px]">{s.client}</span>}
                            {s.revisionCount > 0 && (
                              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600/70 border border-amber-200/60 dark:border-amber-800/30">
                                {s.revisionCount} alt.
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5">
                            <span className="flex items-center gap-2 w-fit">
                              {s.startTime && <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[hsl(var(--muted-foreground))]/70">{fmtSlotTime(s.startTime)}</span>}
                              {s.startTime && s.endTime && <span className="text-[hsl(var(--muted-foreground))]/20 text-xs font-normal leading-none">→</span>}
                              {s.endTime && <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[hsl(var(--muted-foreground))]/70">{fmtSlotTime(s.endTime)}</span>}
                              <Calendar className="h-3 w-3 text-[hsl(var(--primary))]/60 shrink-0" />
                            </span>
                          </div>
                        </div>

                        {/* Editor + menu */}
                        <div className="shrink-0 flex items-center gap-1.5 opacity-50 hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                          {s.editor && (
                            <ChatAvatarButton userId={s.editor.id} name={s.editor.name} avatarUrl={s.editor.avatarUrl} size={24}
                              taskId={s.taskId} taskCode={s.taskCode} taskTitle={s.taskTitle} />
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-3.5 w-3.5" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditTaskId(s.taskId); setFormOpen(true); }}><Info className="h-3.5 w-3.5 mr-2" />Editar tarefa</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (
          <>
            {/* ── Mobile (< md) ─────────────────────────────────── */}
            <div className="md:hidden">
            {(viewTab === "today" ? TODAY_SECTIONS_COORD : TASK_GROUPS).map(group => {
              const groupTasks = tabFiltered.filter(t => group.statuses.includes(t.status));
              if (!groupTasks.length) return null;
              const collapsed = viewTab === "today" && collapsedSections.has(group.key);
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-3 px-4 py-2 mt-4 bg-[hsl(var(--card))]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                    <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupTasks.length}</span>
                    {viewTab === "today" && (
                      <button onClick={() => toggleSection(group.key)} className="opacity-40 hover:opacity-80 transition-opacity">
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: group.color }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: group.color }} />}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-[hsl(var(--muted))]">
                    {!collapsed && groupTasks.map(t => {
                      const overdue      = isOverdue(t);
                      const canActNow    = canAct(t);
                      const isHighlighted = highlighted === t.id;
                      const isUnassigned = t.status === "pending" && (!t.editors || t.editors.length === 0) && !t.assignee;
                      const sectionCanReview = viewTab === "today" && (group as typeof TODAY_SECTIONS_COORD[0]).canReview;


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
                  onClick={() => t.status === 'rascunho' && canActNow ? (setEditTaskId(t.id), setFormOpen(true)) : openTask(t.id)}
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
                        <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap shrink-0 ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </span>
                        {isUnassigned && <span className="text-[11px] text-slate-400 shrink-0">sem editor</span>}
                        <PriorityBadge priority={t.priority} />
                        {(() => {
                          const closed = fmtClosedCycle(t.status, t.dueDate, t.updatedAt, t.reviewedAt);
                          if (closed) {
                            const badgeCls: Record<string, string> = {
                              success:   "bg-emerald-50 border-emerald-200/80 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-400",
                              late:      "bg-amber-50 border-amber-200/80 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-400",
                              cancelled: "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/60",
                              neutral:   "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/60",
                            };
                            return (
                              <span className="flex flex-col gap-1 shrink-0">
                                <span className="text-xs text-[hsl(var(--muted-foreground))]/60 tabular-nums leading-tight">{closed.date}</span>
                                {closed.badge && (
                                  <span className={`inline-flex w-fit items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-none ${badgeCls[closed.variant]}`}>
                                    {closed.badge}
                                  </span>
                                )}
                              </span>
                            );
                          }
                          if (!t.dueDate) return null;
                          const { label } = fmtPrazoWeek(t.dueDate);
                          const AMBER_CHIP = "inline-flex w-fit items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-none bg-amber-50 border-amber-200/80 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-400";
                          if ((t.status === "review" ) && overdue) return (
                            <span className="flex flex-col gap-1 shrink-0">
                              <span className="text-xs text-[hsl(var(--muted-foreground))]/60 tabular-nums leading-tight">{label}</span>
                              <span className={AMBER_CHIP}>
                                {t.status === "review" ? "Aguarda aprovação" : "Em alteração"}
                              </span>
                            </span>
                          );
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
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
                                <DropdownMenuItem onClick={() => { if (!t.dueDate) { toast.error("Defina o prazo antes de publicar"); setEditTaskId(t.id); setFormOpen(true); return; } apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }} className="text-zinc-700 focus:text-zinc-700 font-medium">
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
                              <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "reactivate" })}><ArrowUpRight className="h-3.5 w-3.5" />Reativar tarefa</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget({ id: t.id, title: t.title })}><Trash2 className="h-3.5 w-3.5" />Excluir tarefa</DropdownMenuItem>
                            </>
                          )}
                          {t.status === "completed" && canActNow && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => { setReopenTask(t); setReopenComment(""); setReopenDueDate(""); setReopenComplexity(t.complexity ?? "medium"); setReopenPriority(t.priority ?? "medium"); }}><RotateCcw className="h-3.5 w-3.5" />Reabrir tarefa</DropdownMenuItem>
                            </>
                          )}
                          {t.status === "paused" && canActNow && (
                            <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "resume" })}><ArrowUpRight className="h-3.5 w-3.5" />Retomar tarefa</DropdownMenuItem></>
                          )}
                          {!["completed","cancelled","rascunho"].includes(t.status) && canActNow && (
                            <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setRescheduleTask(t)}><CalendarClock className="h-3.5 w-3.5" />Alterar prazo</DropdownMenuItem></>
                          )}
                          {!["completed","cancelled"].includes(t.status) && canActNow && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" })}><RefreshCw className="h-3.5 w-3.5" />Reatribuir tarefa</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "add" })}><UserPlus className="h-3.5 w-3.5" />Adicionar editor</DropdownMenuItem>
                            </>
                          )}
                          {!["completed","cancelled"].includes(t.status) && (
                            <>
                              <DropdownMenuSeparator />
                              {t.status !== "paused" && <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}><PauseCircle className="h-3.5 w-3.5" />Pausar tarefa</DropdownMenuItem>}
                              <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}><XCircle className="h-3.5 w-3.5" />Cancelar tarefa</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
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
                      <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
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

                  {/* Prazo — desktop lg+ */}
                  <div className="hidden lg:flex w-28 shrink-0 items-center">
                    <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} reviewedAt={t.reviewedAt} />
                  </div>

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

                  {/* Coluna Mídia */}
                  <div className="hidden md:flex w-10 shrink-0 items-center justify-center" onClick={e => e.stopPropagation()}>
                    {(t.fileCount ?? 0) > 0 ? (
                      <button
                        title="Ver mídia entregue"
                        onClick={() => openTask(t.id, "entrega")}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-violet-500 hover:bg-violet-500/10 transition-colors"
                      >
                        <FileVideo className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]/30 text-sm">—</span>
                    )}
                  </div>

                  {/* Ações — desktop (largura fixa w-52 para não desalinhar) */}
                  <div className="hidden md:flex w-52 shrink-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                    {sectionCanReview && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1 whitespace-nowrap"
                        onClick={e => { e.stopPropagation(); navigate(`/review/${t.id}`); }}>
                        <ExternalLink className="h-3 w-3" />Revisar
                      </Button>
                    )}
                    {t.status === "rascunho" && canActNow && (
                      <Button size="icon"
                        className={`h-7 w-7 ${t.editors?.length > 0 ? "bg-zinc-700 hover:bg-zinc-800" : "bg-zinc-300 cursor-not-allowed"}`}
                        disabled={!t.editors || t.editors.length === 0}
                        title={!t.editors || t.editors.length === 0 ? "Atribua um editor antes de publicar" : "Publicar"}
                        onClick={e => { e.stopPropagation(); apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {t.status !== "rascunho" && <DropdownMenuItem onClick={() => openTask(t.id)}><ArrowUpRight className="h-3.5 w-3.5" />Ver detalhes</DropdownMenuItem>}
                        {(t.status === "pending" || t.status === "rascunho") && canActNow && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5" />Editar tarefa</DropdownMenuItem>
                            {t.status === "rascunho" && <DropdownMenuItem onClick={() => { if (!t.dueDate) { toast.error("Defina o prazo antes de publicar"); setEditTaskId(t.id); setFormOpen(true); return; } apiPut(`/api/tasks/${t.id}`, { status: "pending" }).then(() => load(true)); }} className="text-zinc-700 focus:text-zinc-700 font-medium"><Send className="h-3.5 w-3.5" />Publicar</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => setDeleteTarget({ id: t.id, title: t.title })}><Trash2 className="h-3.5 w-3.5" />Excluir tarefa</DropdownMenuItem>
                          </>
                        )}
                        {t.status === "cancelled" && canActNow && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "reactivate" })}><ArrowUpRight className="h-3.5 w-3.5" />Reativar tarefa</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget({ id: t.id, title: t.title })}><Trash2 className="h-3.5 w-3.5" />Excluir tarefa</DropdownMenuItem></>)}
                        {t.status === "completed" && canActNow && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => { setReopenTask(t); setReopenComment(""); setReopenDueDate(""); setReopenComplexity(t.complexity ?? "medium"); setReopenPriority(t.priority ?? "medium"); }}><RotateCcw className="h-3.5 w-3.5" />Reabrir tarefa</DropdownMenuItem></>)}
                        {t.status === "paused" && canActNow && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "resume" })}><ArrowUpRight className="h-3.5 w-3.5" />Retomar tarefa</DropdownMenuItem></>)}
                        {!["completed","cancelled","rascunho"].includes(t.status) && canActNow && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setRescheduleTask(t)}><CalendarClock className="h-3.5 w-3.5" />Alterar prazo</DropdownMenuItem></>)}
                        {!["completed","cancelled"].includes(t.status) && canActNow && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" })}><RefreshCw className="h-3.5 w-3.5" />Reatribuir tarefa</DropdownMenuItem><DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "add" })}><UserPlus className="h-3.5 w-3.5" />Adicionar editor</DropdownMenuItem></>)}
                        {!["completed","cancelled"].includes(t.status) && (<><DropdownMenuSeparator />{t.status !== "paused" && <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}><PauseCircle className="h-3.5 w-3.5" />Pausar tarefa</DropdownMenuItem>}<DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}><XCircle className="h-3.5 w-3.5" />Cancelar tarefa</DropdownMenuItem></>)}
                      </DropdownMenuContent>
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
                        <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none shrink-0 hidden md:inline-flex ${STATUS_CHIP[sub.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                          {STATUS_LABEL[sub.status] ?? sub.status}
                        </span>
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

            {/* ── Desktop (md+): TanStack table ─────────────────── */}
            <table className="hidden md:table w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))]">
                {overviewTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(h => (
                      <th key={h.id}
                        style={{ width: h.getSize() !== 150 && h.getSize() > 0 ? h.getSize() : undefined }}
                        className={`h-10 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 whitespace-nowrap cursor-pointer select-none${(h.column.columnDef.meta as any)?.className ? ` ${(h.column.columnDef.meta as any).className}` : ""}`}
                        onClick={() => h.column.getCanSort() && h.column.toggleSorting()}
                      >
                        <span className="flex items-center gap-1">
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === "asc" && <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]/70 shrink-0" />}
                          {h.column.getIsSorted() === "desc" && <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]/70 shrink-0" />}
                          {h.column.getCanSort() && !h.column.getIsSorted() && <ChevronsUpDown className="h-3 w-3 opacity-30 shrink-0" />}
                        </span>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {(viewTab === "today" ? TODAY_SECTIONS_COORD : TASK_GROUPS).map(group => {
                  const groupRows = overviewTable.getRowModel().rows.filter(r => group.statuses.includes(r.original.status));
                  if (!groupRows.length) return null;
                  const collapsed = viewTab === "today" && collapsedSections.has(group.key);
                  const sectionCanReview = viewTab === "today" && (group as typeof TODAY_SECTIONS_COORD[0]).canReview;
                  return (
                    <React.Fragment key={group.key}>
                      <tr>
                        <td colSpan={overviewColumns.length} className="bg-[hsl(var(--card))] px-4 py-2 border-b border-[hsl(var(--border))]/30">
                          <div className="flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                            <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                            <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupRows.length}</span>
                            {viewTab === "today" && (
                              <button onClick={() => toggleSection(group.key)} className="opacity-40 hover:opacity-80 transition-opacity">
                                {collapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: group.color }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: group.color }} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {!collapsed && groupRows.map(row => {
                        const t = row.original;
                        const isExpanded = expandedIds.has(t.id);
                        const isHighlighted = highlighted === t.id;
                        const subList = subtasksMap.get(t.id) ?? [];
                        const isLoadingSubs = loadingSubtasks.has(t.id);
                        const canActNow = canAct(t);
                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              ref={isHighlighted ? (highlightRef as React.RefObject<HTMLTableRowElement>) : null}
                              className="h-14 border-b border-[hsl(var(--border))]/40 hover:bg-[hsl(var(--muted))]/40 cursor-pointer transition-colors"
                              style={{
                                borderLeft: `3px ${t.status === "rascunho" ? "dashed" : "solid"} ${group.color}`,
                                opacity: t.status === "rascunho" ? 0.75 : 1,
                                backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined,
                                boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined,
                              }}
                              onClick={() => (t.status === "pending" || t.status === "rascunho") && canActNow ? (setEditTaskId(t.id), setFormOpen(true)) : openTask(t.id)}
                            >
                              {row.getVisibleCells().map(cell => (
                                <td key={cell.id}
                                  className={`px-3 py-1.5 align-middle${(cell.column.columnDef.meta as any)?.className ? ` ${(cell.column.columnDef.meta as any).className}` : ""}`}
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                            {t.taskType === "multi_task" && isExpanded && (
                              <tr>
                                <td colSpan={overviewColumns.length} className="p-0 border-b border-[hsl(var(--border))]/40">
                                  {isLoadingSubs ? (
                                    <div className="flex items-center gap-2 px-10 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                                      <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                                      Carregando subtarefas…
                                    </div>
                                  ) : subList.length === 0 ? (
                                    <div className="px-10 py-2.5 text-xs text-[hsl(var(--muted-foreground))]/60 italic">
                                      Nenhuma subtarefa encontrada.
                                    </div>
                                  ) : (
                                    <div className="divide-y divide-[hsl(var(--muted))]">
                                      {subList.map(sub => {
                                        const person = sub.assignedTo ?? sub.editors?.[0] ?? null;
                                        return (
                                          <div key={sub.id}
                                            className="flex items-center gap-3 pl-10 pr-4 py-2.5 bg-[hsl(var(--muted))]/10 hover:bg-[hsl(var(--muted))]/25 transition-colors cursor-pointer border-l-4"
                                            style={{ borderLeftColor: `${group.color}55` }}
                                            onClick={e => { e.stopPropagation(); openTask(sub.id); }}
                                          >
                                            <div className="flex-1 min-w-0 flex items-baseline gap-2">
                                              {sub.taskCode && <span className="shrink-0 font-mono text-xs text-[hsl(var(--primary))]/70">{sub.taskCode}</span>}
                                              <span className="text-sm truncate">{sub.title}</span>
                                              {sub.revisionCount > 0 && (
                                                <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                                                  {sub.revisionCount} {sub.revisionCount === 1 ? "alteração" : "alterações"}
                                                </span>
                                              )}
                                            </div>
                                            <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none shrink-0 ${STATUS_CHIP[sub.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                                              {STATUS_LABEL[sub.status] ?? sub.status}
                                            </span>
                                            <div className="flex items-center shrink-0">
                                              {person && (
                                                <ChatAvatarButton
                                                  userId={person.id} name={person.name} avatarUrl={person.avatarUrl}
                                                  size={24} taskId={sub.id} taskCode={sub.taskCode} taskTitle={sub.title}
                                                  onOpenAvailability={() => setAvailEditor({ id: person.id, name: person.name, avatarUrl: person.avatarUrl })}
                                                />
                                              )}
                                            </div>
                                            {sub.status === "review" && canActNow && (
                                              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                                <Button size="sm" className="h-6 px-2 gap-1 text-[11px] bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
                                                  onClick={e => { e.stopPropagation(); setApproveTarget({ taskId: sub.id, title: sub.title, parentId: t.id }); }}>
                                                  <CheckCircle2 className="h-3 w-3" />Aprovar
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-6 px-2 gap-1 text-[11px] text-amber-600 border-amber-400 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700/60 dark:hover:bg-amber-950/40"
                                                  onClick={e => { e.stopPropagation(); setRevisionSubtask({ id: sub.id, title: sub.title, parentId: t.id }); setRevisionSubtaskComment(""); }}>
                                                  <RotateCcw className="h-3 w-3" />Revisar
                                                </Button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        </div>{/* fim body scrollável */}
      </div>

      {/* ── Cancel / Pause / Resume / Reactivate ─────────────────────────── */}
      <Dialog open={!!confirmTask} onOpenChange={open => { if (!open && !sendingConfirm) { setConfirmTask(null); setConfirmComment(""); } }}>
        <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden">
          <DialogTitle className="sr-only">{confirmTask?.action}</DialogTitle>
          <div className="px-6 pt-7 pb-5 space-y-4">
            <p className="text-xl font-black tracking-tight">
              {confirmTask?.action === "cancel" ? "Cancelar tarefa" :
               confirmTask?.action === "pause"  ? "Pausar tarefa"  :
               confirmTask?.action === "reactivate" ? "Reativar tarefa" : "Retomar tarefa"}
            </p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              {confirmTask?.action === "cancel"
                ? <>Tem certeza que deseja cancelar <strong className="text-[hsl(var(--foreground))]">"{confirmTask?.title}"</strong>? Os editores serão notificados.</>
                : confirmTask?.action === "pause"
                  ? <>Tem certeza que deseja pausar <strong className="text-[hsl(var(--foreground))]">"{confirmTask?.title}"</strong>? Os editores serão notificados.</>
                  : <>A tarefa <strong className="text-[hsl(var(--foreground))]">"{confirmTask?.title}"</strong> voltará para <strong>Pendente</strong> e os editores serão notificados.</>}
            </p>
            {confirmTask?.action !== "resume" && confirmTask?.action !== "reactivate" && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Motivo <span className="text-destructive">*</span>
                </p>
                <Textarea
                  placeholder={confirmTask?.action === "cancel" ? "Motivo do cancelamento…" : "Motivo da pausa…"}
                  value={confirmComment}
                  onChange={e => setConfirmComment(e.target.value)}
                  rows={3}
                  className="resize-none text-sm rounded-2xl"
                  disabled={sendingConfirm}
                />
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between">
            <button onClick={() => { setConfirmTask(null); setConfirmComment(""); }} disabled={sendingConfirm}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors disabled:opacity-40">
              Voltar
            </button>
            <button
              onClick={() => confirmTask && doTaskAction(confirmTask.id, confirmTask.action)}
              disabled={sendingConfirm || (confirmTask?.action !== "resume" && confirmTask?.action !== "reactivate" && !confirmComment.trim())}
              className={`h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors
                ${confirmTask?.action === "cancel" ? "bg-red-600 hover:bg-red-700" :
                  confirmTask?.action === "pause"  ? "bg-purple-600 hover:bg-purple-700" :
                  "bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"}`}>
              {sendingConfirm ? "Aguarde…" :
               confirmTask?.action === "cancel"     ? "Cancelar" :
               confirmTask?.action === "pause"      ? "Pausar" :
               confirmTask?.action === "reactivate" ? "Reativar" : "Retomar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Solicitar alteração ───────────────────────────────────────────── */}
      <Dialog open={!!revisionTask} onOpenChange={open => !open && setRevisionTask(null)}>
        <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden">
          <DialogTitle className="sr-only">Solicitar alteração</DialogTitle>
          <div className="px-6 pt-7 pb-5 space-y-4">
            <div>
              <p className="text-xl font-black tracking-tight">Solicitar alteração</p>
              {revisionTask && revisionTask.revisionCount > 0 && (
                <p className="text-[11px] font-bold text-amber-500 mt-1">
                  Alteração #{revisionTask.revisionCount + 1}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                Comentário do cliente <span className="text-destructive">*</span>
              </p>
              <Textarea
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar…"
                className="resize-none text-sm rounded-2xl"
                autoFocus
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between">
            <button onClick={() => setRevisionTask(null)}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              Cancelar
            </button>
            <button onClick={submitRevision} disabled={sendingRevision || !revisionComment.trim()}
              className="h-9 px-6 rounded-full text-sm font-black text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors">
              {sendingRevision ? "Enviando…" : "↩ Solicitar alteração"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reabrir tarefa ───────────────────────────────────────────────── */}
      <Dialog open={!!reopenTask} onOpenChange={open => { if (!open) { setReopenTask(null); setReopenDueDate(""); } }}>
        <DialogContent className="max-w-md p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[90vh]">
          <DialogTitle className="sr-only">Reabrir tarefa</DialogTitle>
          <div className="flex-1 overflow-y-auto px-6 pt-7 pb-5 space-y-5">
            <p className="text-xl font-black tracking-tight">Reabrir tarefa</p>
            {reopenTask && (() => {
              const t = reopenTask;
              const primaryEditor = t.assignee ?? t.editors?.[0] ?? null;
              const editorWl = primaryEditor ? reopenWorkload.find(w => w.id === primaryEditor.id) : null;
              const wlColor = loadColor(editorWl?.hoursToday ?? 0, editorWl?.dailyCap ?? 8);
              const wlLabel = loadLabel(editorWl?.hoursToday ?? 0, editorWl?.dailyCap ?? 8);
              return (<>
                {primaryEditor && (
                  <div className="rounded-2xl border px-3.5 py-3 bg-[hsl(var(--muted))]/30 flex items-center gap-2.5">
                    <AvatarDisplay name={primaryEditor.name} avatarUrl={primaryEditor.avatarUrl} size={28} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{primaryEditor.name}</p>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60">editor atribuído</p>
                    </div>
                    {loadingWorkload
                      ? <span className="text-[10px] text-[hsl(var(--muted-foreground))]">verificando…</span>
                      : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ background: `${wlColor}22`, color: wlColor }}>{wlLabel}</span>
                    }
                  </div>
                )}
                {t.dueDate && (
                  <div className="rounded-2xl px-3.5 py-3 bg-[hsl(var(--muted))]/30 flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Prazo anterior</span>
                    <span className="font-semibold text-sm ml-auto">{fmtDate(t.dueDate)}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Complexidade</p>
                    <Select value={reopenComplexity} onValueChange={setReopenComplexity}>
                      <SelectTrigger className="h-9 text-sm rounded-2xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Simples</SelectItem>
                        <SelectItem value="medium">Moderada</SelectItem>
                        <SelectItem value="high">Complexa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Prioridade</p>
                    <Select value={reopenPriority} onValueChange={setReopenPriority}>
                      <SelectTrigger className="h-9 text-sm rounded-2xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Novo prazo <span className="font-normal normal-case">(opcional)</span>
                  </p>
                  <DatePicker
                    value={reopenDueDate} onChange={setReopenDueDate} withTime
                    defaultTime={d => new Date(d + "T12:00:00").getDay() === 6 ? "13:00" : "18:00"}
                    placeholder="Selecionar novo prazo…"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Motivo <span className="text-destructive">*</span>
                  </p>
                  <Textarea
                    value={reopenComment} onChange={e => setReopenComment(e.target.value)}
                    rows={3} placeholder="Descreva o que o cliente solicitou alterar…"
                    className="resize-none text-sm rounded-2xl" autoFocus
                  />
                </div>
              </>);
            })()}
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
            <button onClick={() => setReopenTask(null)}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              Cancelar
            </button>
            <button onClick={submitReopen} disabled={sendingReopen || !reopenComment.trim() || loadingWorkload}
              className="h-9 px-6 rounded-full text-sm font-black text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 transition-colors">
              {sendingReopen ? "Reabrindo…" : "↩ Reabrir"}
            </button>
          </div>
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


      <EscalaModal
        open={escalaOpen}
        onClose={() => setEscalaOpen(false)}
        onCreated={({ taskId }) => { setEscalaOpen(false); load(true); setHighlighted(taskId); }}
      />

      {rescheduleTask && (
        <RescheduleModal
          open={!!rescheduleTask}
          onOpenChange={v => { if (!v) setRescheduleTask(null); }}
          onSaved={() => { setRescheduleTask(null); load(true); }}
          task={{
            id:          rescheduleTask.id,
            title:       rescheduleTask.title,
            effortHours: rescheduleTask.effortHours!,
            editor:      rescheduleTask.assignee ?? rescheduleTask.editors?.[0] ?? null,
            dueDate:     rescheduleTask.dueDate,
          }}
        />
      )}

      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => load(true)}
        editTaskId={editTaskId}
      />

      {/* ── Aprovar tarefa ───────────────────────────────────────────────── */}
      <Dialog open={!!approveTarget} onOpenChange={open => { if (!open && !approvingTarget) setApproveTarget(null); }}>
        <DialogContent className="max-w-md p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[90vh]">
          <DialogTitle className="sr-only">Aprovar tarefa</DialogTitle>
          <div className="flex-1 overflow-y-auto px-6 pt-7 pb-5 space-y-5">
            <div>
              <p className="text-xl font-black tracking-tight">
                {approveTarget?.parentId ? "Aprovar subtarefa" : "Aprovar tarefa"}
              </p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                <strong className="text-[hsl(var(--foreground))]">"{approveTarget?.title}"</strong> será marcada como concluída.
              </p>
            </div>
            {approveFilesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                <div className="h-4 w-4 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin shrink-0" />
                Carregando arquivos…
              </div>
            ) : approveFiles.length > 0 && (() => {
              const revMap = new Map<number, typeof approveFiles>();
              approveFiles.forEach(f => {
                if (!revMap.has(f.revisionNumber)) revMap.set(f.revisionNumber, []);
                revMap.get(f.revisionNumber)!.push(f);
              });
              const groups = [...revMap.entries()].sort((a, b) => a[0] - b[0]);
              return (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Versões aprovadas</p>
                  <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))] overflow-hidden">
                    {groups.map(([revNum, revFiles]) => (
                      <div key={revNum} className="px-3.5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-2">
                          {revNum === 0 ? "Original" : `${revNum}ª alteração`}
                        </p>
                        <div className="space-y-1">
                          {revFiles.map(f => {
                            const checked = approvedFileIds.has(f.id);
                            const isVid = f.mimeType?.startsWith("video/");
                            return (
                              <label key={f.id}
                                className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl cursor-pointer transition-colors select-none
                                  ${checked ? "bg-green-500/10" : "hover:bg-[hsl(var(--muted))]/40"}`}>
                                <input type="checkbox" checked={checked}
                                  onChange={e => setApprovedFileIds(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(f.id) : next.delete(f.id);
                                    return next;
                                  })}
                                  className="h-3.5 w-3.5 rounded accent-green-600 shrink-0" />
                                {isVid
                                  ? <Clapperboard className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                  : <AudioLines className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
                                <span className="text-xs font-medium truncate flex-1">{f.fileName}</span>
                                <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50 shrink-0 tabular-nums">
                                  {new Date(f.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">
                    {approvedFileIds.size} arquivo{approvedFileIds.size !== 1 ? "s" : ""} selecionado{approvedFileIds.size !== 1 ? "s" : ""}
                  </p>
                </div>
              );
            })()}
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
            <button onClick={() => setApproveTarget(null)} disabled={approvingTarget}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={doApprove} disabled={approvingTarget}
              className="h-9 px-6 rounded-full text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors">
              {approvingTarget ? "Aprovando…" : "Confirmar aprovação"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Excluir tarefa ───────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden">
          <DialogTitle className="sr-only">Excluir tarefa</DialogTitle>
          <div className="px-6 pt-7 pb-5 space-y-3">
            <p className="text-xl font-black tracking-tight">Excluir tarefa</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              Tem certeza que deseja excluir <strong className="text-[hsl(var(--foreground))]">"{deleteTarget?.title}"</strong>? Esta ação não pode ser desfeita.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between">
            <button onClick={() => setDeleteTarget(null)} disabled={deleting}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={deleteTask} disabled={deleting}
              className="h-9 px-6 rounded-full text-sm font-black text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-colors">
              {deleting ? "Excluindo…" : "Excluir"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revisão subtarefa ────────────────────────────────────────────── */}
      <Dialog open={!!revisionSubtask} onOpenChange={open => !open && setRevisionSubtask(null)}>
        <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden">
          <DialogTitle className="sr-only">Solicitar alteração</DialogTitle>
          <div className="px-6 pt-7 pb-5 space-y-4">
            <div>
              <p className="text-xl font-black tracking-tight">Solicitar alteração</p>
              {revisionSubtask && (
                <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 truncate">{revisionSubtask.title}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                Comentário do cliente <span className="text-destructive">*</span>
              </p>
              <Textarea
                value={revisionSubtaskComment}
                onChange={e => setRevisionSubtaskComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar…"
                className="resize-none text-sm rounded-2xl"
                autoFocus
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between">
            <button onClick={() => setRevisionSubtask(null)}
              className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
              Cancelar
            </button>
            <button onClick={submitRevisionSubtask} disabled={sendingRevisionSubtask || !revisionSubtaskComment.trim()}
              className="h-9 px-6 rounded-full text-sm font-black text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors">
              {sendingRevisionSubtask ? "Enviando…" : "↩ Solicitar alteração"}
            </button>
          </div>
        </DialogContent>
      </Dialog>


      {manageCoordsTask && (
        <ManageCoordsModal
          task={manageCoordsTask}
          currentUserId={user?.id ?? 0}
          onClose={() => { setManageCoordsTask(null); load(true); }}
        />
      )}
      {transferTask && (
        <TransferTaskModal
          task={transferTask}
          onClose={() => setTransferTask(null)}
          onDone={() => { setTransferTask(null); load(true); }}
        />
      )}
    </div>
  );
}

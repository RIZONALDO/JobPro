import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { TaskFileUploadModal } from "@/components/TaskFileUploadModal";
import { TaskFormModal } from "@/components/task-form-modal";
import { TaskDetailsModal } from "@/components/TaskDetailsModal";
import { motion } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtClosedCycle, fmtPrazoWeek } from "@/lib/utils";
import { PrazoCell } from "@/components/prazo-cell";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useRealtime } from "@/hooks/use-realtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle, MoreVertical, Calendar,
  Info, Undo2, Search, X, Clock, MessageSquare,
  ChevronDown, ChevronRight as ChevronRightIcon, ExternalLink,
} from "lucide-react";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { STATUS_LABEL, STATUS_CHIP, isTerminal } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";

interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  startDate?: string | null;
  revisionCount: number;
  client: string | null;
  color: string;
  number?: number;
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  coCoordinators?: { id: number; name: string; avatarUrl?: string | null }[];
  revisions: Revision[];
  updatedAt: string;
  reviewedAt?: string | null;
  effortHours?: number | null;
  hasAllocToday?: boolean;
  todaySlotIndex?: number | null;
  totalSlots?: number | null;
  confirmedSlots?: number;
  nextSlotDate?: string | null;
  fileCount?: number;
  fileKind?: "video" | "audio" | "mixed" | "other" | null;
  unreadCommentCount?: number;
  // multi-task
  taskType?: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

// ── SessionDots — progresso visual de sessões ESCALA ─────────────────────────
function SessionDots({ confirmed, total }: { confirmed: number; total: number }) {
  const MAX_DOTS = 6;
  if (total > MAX_DOTS) {
    return (
      <span className="text-[10px] font-semibold tabular-nums text-[hsl(var(--muted-foreground))]/50">
        {confirmed}/{total} ✓
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-[6px] w-[6px] rounded-full transition-colors ${
          i < confirmed ? "bg-emerald-500" : "bg-[hsl(var(--muted-foreground))]/20"
        }`} />
      ))}
    </span>
  );
}

// ── Helpers de agendamento ────────────────────────────────────────────────────
const TAB_TODAY_STR = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const ACTIVE_STATUSES = new Set(["pending", "in_progress", "review"]);
const SCHEDULED_STATUSES = new Set(["pending", "in_progress", "paused"]);
function isTaskScheduled(t: Task): boolean {
  if (!SCHEDULED_STATUSES.has(t.status)) return false;
  // ESCALA: presença em "Tarefas do dia" depende de ter slot hoje, não da startDate
  if (t.effortHours != null) return !t.hasAllocToday;
  // Tarefa manual: usa startDate
  const ref = t.startDate ?? (t.status === "pending" ? t.dueDate : null);
  if (!ref) return false;
  return ref.split("T")[0] > TAB_TODAY_STR;
}


const transitions: Record<string, { next: string; label: string; shortLabel: string }> = {
  pending:  { next: "in_progress", label: "Iniciar edição", shortLabel: "Iniciar" },
  reopened: { next: "in_progress", label: "Iniciar edição", shortLabel: "Iniciar" },
};

const STATUS_OPTIONS = [
  { value: "all",         label: "Todas" },
  { value: "active",      label: "Ativas" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em edição" },
  { value: "review",      label: "Em aprovação" },
  { value: "reopened",    label: "Reaberta" },
  { value: "paused",      label: "Pausada" },
  { value: "completed",   label: "Concluída" },
  { value: "cancelled",   label: "Cancelada" },
];

const TASK_GROUPS = [
  { key: "pending",   label: "Pendentes",     statuses: ["pending"],      color: "#64748b" },
  { key: "editing",   label: "Em edição",     statuses: ["in_progress"],  color: "#3b82f6" },
  { key: "approval",  label: "Em aprovação",  statuses: ["review"],       color: "#f59e0b" },
  { key: "reopened",  label: "Reabertas",     statuses: ["reopened"],     color: "#e11d48" },
  { key: "paused",    label: "Pausadas",      statuses: ["paused"],       color: "#a855f7" },
  { key: "done",      label: "Concluídas",    statuses: ["completed"],    color: "#22c55e" },
  { key: "cancelled", label: "Canceladas",    statuses: ["cancelled"],    color: "#ef4444" },
];

const TODAY_SECTIONS_EDITOR = [
  { key: "start",    label: "Para iniciar",       statuses: ["pending", "reopened"], color: "#64748b", defaultCollapsed: false, canReview: false },
  { key: "working",  label: "Trabalhando",         statuses: ["in_progress"],         color: "#3b82f6", defaultCollapsed: false, canReview: false },
  { key: "waiting",  label: "Aguardando retorno",  statuses: ["review"],              color: "#f59e0b", defaultCollapsed: false, canReview: false },
  { key: "done",     label: "Entregues hoje",      statuses: ["completed"],           color: "#22c55e", defaultCollapsed: true,  canReview: false },
];

const TODAY_SECTIONS_COORD = [
  { key: "approve",  label: "Para aprovar",  statuses: ["review"],              color: "#f59e0b", defaultCollapsed: false, canReview: true  },
  { key: "working",  label: "Em produção",   statuses: ["in_progress"],         color: "#3b82f6", defaultCollapsed: false, canReview: false },
  { key: "start",    label: "Sem início",    statuses: ["pending", "reopened"], color: "#64748b", defaultCollapsed: false, canReview: false },
  { key: "done",     label: "Entregues hoje",statuses: ["completed"],           color: "#22c55e", defaultCollapsed: true,  canReview: false },
];

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || isTerminal(status) || status === "review") return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

const STATUS_ORDER = ["pending", "in_progress", "review", "reopened", "paused", "completed", "cancelled"];

export default function EditorTaskList() {
  const { user } = useAuth();
  const { openTask } = useTaskModal();
  const [, navigate] = useLocation();


  const [tasks,        setTasks]        = useState<Task[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewTab,      setViewTab]      = useState<"today" | "scheduled" | "all">("today");
  const [scheduledModalId, setScheduledModalId] = useState<number | null>(null);

  // Slots de alocação para a tab Agendadas (um por dia de trabalho real)
  interface ScheduleSlot {
    workDate: string; startTime: string | null; endTime: string | null; hours: number | null;
    taskId: number; taskCode: string; taskTitle: string; client: string | null;
    color: string | null; status: string; priority: string | null; revisionCount: number;
    coordinator: { id: number; name: string; avatarUrl?: string | null } | null;
    slotIndex?: number; totalSlots?: number | null;
  }
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const isEditor = user?.role === "editor";

  // ── MONITOR: slots de hoje do editor ─────────────────────────────────────
  interface TodaySlot {
    id: number; taskId: number; taskCode: string; taskTitle: string;
    client: string | null; status: string;
    startTime: string | null; endTime: string | null; allocatedHours: number | null;
    execStatus: string; actualHours: number | null; execNote: string | null;
    slotIndex: number; totalSlots: number;
  }
  const [todaySlots, setTodaySlots]   = useState<TodaySlot[]>([]);
  const [confirmingSlot, setConfirmingSlot] = useState<number | null>(null);

  const loadTodaySlots = useCallback(() => {
    if (!isEditor) return;
    apiFetch<TodaySlot[]>("/api/monitor/my-today").then(setTodaySlots).catch(() => {});
  }, [isEditor]);

  const confirmSlot = async (slot: TodaySlot, execStatus: "done" | "missed", actualHours?: number) => {
    setConfirmingSlot(slot.id);
    try {
      if (execStatus === "done") {
        await apiPost(`/api/monitor/slots/${slot.id}/confirm`, { actualHours: actualHours ?? slot.allocatedHours });
        toast.success("Sessão confirmada!");
      } else {
        await apiPost(`/api/monitor/slots/${slot.id}/miss`, {});
        toast.success("Sessão registrada como não executada");
      }
      loadTodaySlots();
      load(); // atualiza task list para refletir nova confirmação
    } catch { toast.error("Erro ao registrar sessão"); }
    finally { setConfirmingSlot(null); }
  };
  const todaySections = isEditor ? TODAY_SECTIONS_EDITOR : TODAY_SECTIONS_COORD;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(todaySections.filter(s => s.defaultCollapsed).map(s => s.key))
  );
  const toggleSection = (key: string) =>
    setCollapsedSections(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [startingSaving, setStartingSaving] = useState(false);

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

  const [uploadTarget,    setUploadTarget]    = useState<Task | null>(null);
  const [returnTarget,  setReturnTarget]  = useState<Task | null>(null);
  const [returnComment, setReturnComment] = useState("");
  const [returning,     setReturning]     = useState(false);

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks")
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTodaySlots(); }, [loadTodaySlots]);
  useRealtime({ onTasksChanged: () => { load(); loadTodaySlots(); } });

  // Carrega slots reais de alocação — na montagem e quando tarefas mudam (só editor)
  const loadScheduleSlots = useCallback(() => {
    if (!isEditor) return;
    setScheduleLoading(viewTab === "scheduled");
    apiFetch<ScheduleSlot[]>("/api/my-schedule")
      .then(setScheduleSlots)
      .catch(() => {})
      .finally(() => setScheduleLoading(false));
  }, [isEditor, viewTab]);

  useEffect(() => { loadScheduleSlots(); }, [loadScheduleSlots]);

  const transition = async (task: Task, to: string, comment?: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: to } : t));
    try {
      await apiPost(`/api/fluxo/task/${task.id}/transition`, { to, ...(comment ? { comment } : {}) });
      load();
    } catch (err: unknown) {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  };

  const updateStatus = (task: Task, status: string) => transition(task, status);

  const handleIniciarDireto = async (task: Task) => {
    setStartingSaving(true);
    try {
      await apiPost(`/api/fluxo/task/${task.id}/transition`, { to: "in_progress" });
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar tarefa");
    } finally { setStartingSaving(false); }
  };

  const confirmReturn = async () => {
    if (!returnTarget) return;
    setReturning(true);
    try {
      await apiPost(`/api/fluxo/task/${returnTarget.id}/transition`, { to: "pending", comment: returnComment.trim() || undefined });
      setReturnTarget(null);
      setReturnComment("");
      load();
      toast.success("Tarefa devolvida.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao devolver");
    } finally { setReturning(false); }
  };

  const filtered = useMemo(() => tasks
    .filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !(t.client ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus === "active") return !isTerminal(t.status);
      if (filterStatus !== "all") return t.status === filterStatus;
      return true;
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
  [tasks, search, filterStatus]);

  const tabFiltered = useMemo(() => {
    if (viewTab === "today") return filtered.filter(t => {
      if (t.status === "completed") return t.dueDate?.split("T")[0] === TAB_TODAY_STR;
      return !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status);
    });
    if (viewTab === "scheduled") return filtered.filter(t => isTaskScheduled(t));
    return filtered;
  }, [filtered, viewTab]);

  const todayCount     = filtered.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status)).length;
  const scheduledCount = isEditor
    ? scheduleSlots.length || filtered.filter(t => isTaskScheduled(t)).length
    : filtered.filter(t => isTaskScheduled(t)).length;

  const tabs = [
    { key: "today"     as const, label: "Tarefas do dia", count: todayCount     },
    { key: "scheduled" as const, label: "Agendadas",       count: scheduledCount },
    { key: "all"       as const, label: "Todas",            count: filtered.length },
  ];

  const hasFilter = search || filterStatus !== "all";

  // ── TanStack Table ─────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<Task, unknown>[]>(() => [
    {
      id: "tarefa",
      accessorKey: "title",
      header: "Tarefa",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
              {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
              <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
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
            {t.taskType === "subtask" && t.parentTask && <ParentTaskBreadcrumb parentTask={t.parentTask} className="mt-0.5" />}
            {t.taskType === "multi_task" && <MultiTaskBadge taskType="multi_task" className="mt-0.5" />}
            {/* Dots de progresso + próxima sessão */}
            {t.totalSlots && t.totalSlots > 1 && (
              <div className="flex items-center gap-2 mt-0.5">
                <SessionDots confirmed={t.confirmedSlots ?? 0} total={t.totalSlots} />
                {!t.hasAllocToday && t.nextSlotDate && (
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]/45">
                    próxima {new Date(t.nextSlotDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                  </span>
                )}
              </div>
            )}
            {t.client && <span className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5 block">{t.client}</span>}
          </div>
        );
      },
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      size: 144,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap shrink-0 ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <MultiTaskBadge taskType={t.taskType ?? "task"} />
            </div>
            {(t.unreadCommentCount ?? 0) > 0 && (
              <button
                onClick={e => { e.stopPropagation(); openTask(t.id, "entrega"); }}
                className="inline-flex items-center gap-1 w-fit px-1.5 py-[3px] rounded-[4px] text-[10px] font-semibold transition-colors hover:opacity-80"
                style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.20)" }}
              >
                <MessageSquare className="h-2.5 w-2.5 shrink-0" style={{ fill: "currentColor", stroke: "none" }} />
                <span>ajustes</span>
              </button>
            )}
          </div>
        );
      },
    },
    {
      id: "prioridade",
      header: "Prioridade",
      size: 112,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    },
    {
      id: "entrega",
      header: () => viewTab === "scheduled"
        ? <span>Data agendada</span>
        : <span className="flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />Entrega</span>,
      size: viewTab === "scheduled" ? 200 : 112,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        const overdue = isOverdue(t.dueDate, t.status);
        if (viewTab === "scheduled") {
          const fmtDT = (d: string) => {
            const dt = new Date(d);
            const day = dt.getDate(); const mon = dt.getMonth() + 1;
            const h = dt.getHours(); const m = dt.getMinutes();
            const time = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
            return `${day}/${mon} ${time}`;
          };
          const s = t.startDate ? fmtDT(t.startDate) : null;
          const e = t.dueDate   ? fmtDT(t.dueDate)   : null;
          return (
            <span className="flex items-center gap-1 tabular-nums text-xs font-semibold">
              {s && <span className="text-sky-500">{s}</span>}
              {s && e && <><span className="text-[hsl(var(--muted-foreground))]/40 font-normal">→</span><span className={overdue ? "text-red-500" : "text-[hsl(var(--foreground))]/80"}>{e}</span></>}
              {!s && e && <span className={overdue ? "text-red-500" : "text-[hsl(var(--foreground))]/80"}>{e}</span>}
              {!s && !e && <span className="text-[hsl(var(--muted-foreground))]/30">—</span>}
            </span>
          );
        }
        const closed = fmtClosedCycle(t.status, t.dueDate, t.updatedAt, t.reviewedAt);
        if (closed) {
          return (
            <span className="flex flex-col gap-0.5">
              <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/60">{closed.date}</span>
              {closed.badge && <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]/60">{closed.badge}</span>}
            </span>
          );
        }
        return <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} reviewedAt={t.reviewedAt} />;
      },
    },
    {
      id: "coordenador",
      header: "Coord.",
      size: 80,
      meta: { className: "hidden xl:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        if (!t.createdBy) return <span className="text-[hsl(var(--muted-foreground))]/30 text-sm">—</span>;
        const allCoords = [t.createdBy, ...(t.coCoordinators ?? [])];
        return (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center" style={{ gap: 0 }}>
              {allCoords.slice(0, 3).map((c, i) => (
                <div key={c.id} style={{ marginLeft: i === 0 ? 0 : -9, zIndex: 3 - i }}>
                  <ChatAvatarButton userId={c.id} name={c.name} avatarUrl={c.avatarUrl} size={26}
                    taskId={t.id} taskCode={t.taskCode} taskTitle={t.title} />
                </div>
              ))}
            </div>
            {allCoords.length === 1 && (
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.createdBy.name.split(" ")[0]}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "acao",
      header: "Ação",
      size: 128,
      cell: ({ row }) => {
        const t    = row.original;
        const slot = todaySlots.find(s => s.taskId === t.id) ?? null;
        const isEscala      = t.effortHours != null;
        const hasSlotToday  = !!slot;
        const slotScheduled = slot?.execStatus === "scheduled";
        const slotDone      = slot && (slot.execStatus === "done" || slot.execStatus === "partial");
        const isMulti       = (slot?.totalSlots ?? 0) > 1;
        const isLast        = slot ? slot.slotIndex === slot.totalSlots : false;
        const etapaLabel    = isMulti
          ? (isLast ? "Etapa final" : `Etapa ${slot!.slotIndex}/${slot!.totalSlots}`)
          : null;

        // ── Tarefa ESCALA com sessão hoje ─────────────────────────────────────
        if (isEscala && hasSlotToday) {
          // pending → ainda não iniciou: "Iniciar [Etapa N/T]"
          if (t.status === "pending" && slotScheduled) {
            const label = etapaLabel ? `Iniciar · ${etapaLabel}` : "Iniciar";
            return (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="default" className="h-7 text-xs px-2.5 w-full whitespace-nowrap"
                  disabled={startingSaving || confirmingSlot === slot!.id}
                  onClick={() => handleIniciarDireto(t)}>
                  {label}
                </Button>
              </div>
            );
          }
          // in_progress, sessão ainda não confirmada: "Concluir [etapa]"
          if (t.status === "in_progress" && slotScheduled) {
            const label = isMulti
              ? (isLast ? "Concluir etapa final" : `Concluir ${etapaLabel}`)
              : "✓ Concluí";
            return (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="default" className="h-7 text-xs px-2.5 w-full whitespace-nowrap"
                  disabled={confirmingSlot === slot!.id}
                  onClick={() => confirmSlot(slot!, "done")}>
                  {label}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-[hsl(var(--muted-foreground))]/40 hover:text-red-500 shrink-0"
                  disabled={confirmingSlot === slot!.id}
                  title="Registrar como não executada"
                  onClick={() => confirmSlot(slot!, "missed")}>
                  ✗
                </Button>
              </div>
            );
          }
          // in_progress, etapa final confirmada hoje → libera envio
          if (t.status === "in_progress" && slotDone && isLast) {
            return (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 w-full whitespace-nowrap"
                  onClick={() => setUploadTarget(t)}>
                  Enviar para aprovação
                </Button>
              </div>
            );
          }
          // in_progress, etapa intermediária confirmada hoje
          if (t.status === "in_progress" && slotDone) {
            return (
              <div className="flex items-center px-1" onClick={e => e.stopPropagation()}>
                <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                  <span>✓</span> {etapaLabel ?? "Sessão"} concluída
                </span>
              </div>
            );
          }
        }

        // ── Tarefa ESCALA agendada (sem slot hoje) ─────────────────────────
        if (isEscala && !hasSlotToday && t.status === "pending") {
          return (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full" disabled>Agendada</Button>
            </div>
          );
        }

        // ── Tarefa não-ESCALA ou fallback ─────────────────────────────────
        const startAllowed = !t.startDate || t.startDate.split("T")[0] <= TAB_TODAY_STR;
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {t.status === "pending" && (
              startAllowed
                ? <Button size="sm" variant="default" className="h-7 text-xs px-3 w-full" onClick={() => handleIniciarDireto(t)}>Iniciar</Button>
                : <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full" disabled>Agendada</Button>
            )}
            {t.status === "in_progress" && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full"
                onClick={() => setUploadTarget(t)}>
                Enviar
              </Button>
            )}
            {t.status === "reopened" && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full"
                onClick={() => updateStatus(t, "in_progress")}>
                Retomar
              </Button>
            )}
            {!["pending","in_progress","reopened"].includes(t.status) && (
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30 pl-1">—</span>
            )}
          </div>
        );
      },
    },
    {
      id: "menu",
      header: "",
      size: 32,
      cell: ({ row }) => {
        const t = row.original;
        const canReturn = ["pending","in_progress","review"].includes(t.status);
        return (
          <div onClick={e => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openTask(t.id)}><Info className="h-3.5 w-3.5 mr-2" />Ver informações</DropdownMenuItem>
                {canReturn && <DropdownMenuItem onClick={() => setReturnTarget(t)}><Undo2 className="h-3.5 w-3.5 mr-2" />Devolver</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ].filter(col => viewTab !== "scheduled" || !["status", "prioridade", "acao"].includes(col.id)), [viewTab, setUploadTarget, setReturnTarget, openTask, todaySlots, confirmingSlot, startingSaving]);

  const table = useReactTable({
    data: tabFiltered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loading) return (
    <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden animate-pulse">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
          <div className="h-5 w-20 rounded bg-[hsl(var(--muted))]/60" />
          <div className="h-4 flex-1 rounded bg-[hsl(var(--muted))]/40" />
          <div className="h-4 w-24 rounded bg-[hsl(var(--muted))]/40 hidden md:block" />
          <div className="h-8 w-28 rounded bg-[hsl(var(--muted))]/40" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">


      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tarefa ou cliente…"
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
        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setFilterStatus("all"); }}
            className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded-md px-2.5 h-8 transition-colors"
          >
            <X className="h-3 w-3" />Limpar
          </button>
        )}
        <span className="text-xs text-[hsl(var(--muted-foreground))] ml-auto shrink-0">
          {tabFiltered.length} tarefa{tabFiltered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float flex flex-col md:max-h-[calc(100vh-160px)] overflow-hidden">

        {/* Tabs strip */}
        <div className="flex shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setViewTab(tab.key)}
              className={[
                "relative flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-colors",
                viewTab === tab.key
                  ? "text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              ].join(" ")}
            >
              {tab.label}
              <span className={[
                "tabular-nums text-[10px] px-1.5 py-px rounded-full font-medium leading-none",
                viewTab === tab.key
                  ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                  : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
              ].join(" ")}>
                {tab.count}
              </span>
              {viewTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--primary))] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Body — mobile cards + desktop TanStack table */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {/* Para editores na tab Agendadas, bypassa o guard de tabFiltered e vai direto aos slots */}
          {(tabFiltered.length === 0 && !(isEditor && viewTab === "scheduled")) ? (
            <div className="py-16 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {viewTab === "today" ? "Nenhuma tarefa para hoje." : viewTab === "scheduled" ? "Nenhuma tarefa agendada." : search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa atribuída."}
              </p>
            </div>
          ) : viewTab === "scheduled" ? (
            /* ── Agendadas — um card por slot de alocação real ──── */
            (() => {
              const DAY_NAMES = ["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
              const MON_NAMES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
              const fmtSlotTime = (t: string) => {
                const [h, m] = t.split(":").map(Number);
                return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
              };

              // Para editores: usa slots reais de alocação (intercalação correta)
              // Para coordenadores: usa o fallback de tarefas (sem escala própria)
              const items = isEditor ? scheduleSlots : tabFiltered.map(t => ({
                workDate:  t.startDate?.slice(0, 10) ?? "",
                startTime: t.startDate ? `${new Date(t.startDate).getHours().toString().padStart(2,"0")}:${new Date(t.startDate).getMinutes().toString().padStart(2,"0")}` : null,
                endTime:   t.dueDate   ? `${new Date(t.dueDate).getHours().toString().padStart(2,"0")}:${new Date(t.dueDate).getMinutes().toString().padStart(2,"0")}` : null,
                hours:     null,
                taskId:    t.id,
                taskCode:  t.taskCode ?? "",
                taskTitle: t.title,
                client:    t.client ?? null,
                color:     t.color ?? null,
                status:    t.status,
                priority:  t.priority,
                revisionCount: t.revisionCount ?? 0,
                coordinator:   t.createdBy ?? null,
                slotIndex:     null,
                totalSlots:    t.totalSlots ?? null,
              }));

              if (scheduleLoading) return (
                <div className="py-12 flex items-center justify-center gap-3">
                  <div className="h-4 w-4 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando agenda…</span>
                </div>
              );

              if (items.length === 0) return (
                <div className="py-16 text-center">
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma sessão agendada.</p>
                </div>
              );

              return (
                <div className="divide-y divide-[hsl(var(--border))]/25">
                  {items.map((s, idx) => {
                    const d = new Date(s.workDate + "T12:00:00");
                    const accent = s.color ?? "#6366f1";
                    return (
                      <div
                        key={`${s.taskId}-${s.workDate}-${idx}`}
                        onClick={() => setScheduledModalId(s.taskId)}
                        className="flex items-stretch cursor-pointer hover:bg-[hsl(var(--muted))]/20 transition-colors"
                        style={{ borderLeft: `3px solid ${accent}` }}
                      >
                        {/* Date column — dia real do slot */}
                        <div className="w-16 shrink-0 flex flex-col items-center justify-center gap-0 py-4 border-r border-[hsl(var(--border))]/25">
                          <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/35">{DAY_NAMES[d.getDay()]}</span>
                          <span className="text-[22px] font-black tabular-nums leading-none text-[hsl(var(--foreground))]/50">{d.getDate()}</span>
                          <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/35">{MON_NAMES[d.getMonth()]}</span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            {/* Linha 1: código + título + etapa + cliente */}
                            <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                              {s.taskCode && (
                                <span className="shrink-0 text-xs font-mono font-semibold text-[hsl(var(--primary))]/70">{s.taskCode}</span>
                              )}
                              <p className="text-sm font-semibold truncate text-[hsl(var(--foreground))]/85">{s.taskTitle}</p>
                              {s.totalSlots && s.totalSlots > 1 && (
                                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]/70 border border-[hsl(var(--primary))]/20 whitespace-nowrap">
                                  {s.slotIndex === s.totalSlots ? "Etapa final" : `Etapa ${s.slotIndex}/${s.totalSlots}`}
                                </span>
                              )}
                              {s.client && <span className="shrink-0 text-xs font-medium text-[hsl(var(--muted-foreground))]/40 truncate max-w-[120px]">{s.client}</span>}
                              {s.revisionCount > 0 && (
                                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600/70 border border-amber-200/60 dark:border-amber-800/30">
                                  {s.revisionCount} alt.
                                </span>
                              )}
                            </div>
                            {/* Linha 2: horário do slot */}
                            <div className="mt-1.5">
                              <span className="flex items-center gap-2 w-fit">
                                {s.startTime && (
                                  <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[hsl(var(--muted-foreground))]/70">
                                    {fmtSlotTime(s.startTime)}
                                  </span>
                                )}
                                {s.startTime && s.endTime && <span className="text-xs font-normal leading-none text-[hsl(var(--muted-foreground))]/30">→</span>}
                                {s.endTime && (
                                  <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[hsl(var(--muted-foreground))]/70">
                                    {fmtSlotTime(s.endTime)}
                                  </span>
                                )}
                                <Calendar className="h-3 w-3 shrink-0 text-[hsl(var(--primary))]/60" />
                              </span>
                            </div>
                          </div>

                          {/* Coord + menu */}
                          <div className="shrink-0 flex items-center gap-1.5 opacity-50 hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                            {s.coordinator && (
                              <ChatAvatarButton userId={s.coordinator.id} name={s.coordinator.name} avatarUrl={s.coordinator.avatarUrl} size={24}
                                taskId={s.taskId} taskCode={s.taskCode} taskTitle={s.taskTitle} />
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-3.5 w-3.5" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setScheduledModalId(s.taskId)}><Info className="h-3.5 w-3.5 mr-2" />Ver detalhes</DropdownMenuItem>
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
              {/* ── Mobile (< md) ────────────────────────────────────── */}
              <div className="md:hidden">
                {(viewTab === "today" ? todaySections : TASK_GROUPS).map(group => {
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
                            {collapsed ? <ChevronRightIcon className="h-3.5 w-3.5" style={{ color: group.color }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: group.color }} />}
                          </button>
                        )}
                      </div>
                      {!collapsed && groupTasks.map(t => {
                        const overdue = isOverdue(t.dueDate, t.status);
                        const accent = t.color ?? "#6366f1";
                        const trans = transitions[t.status];
                        const canReturn = ["pending","in_progress","review"].includes(t.status);
                        const isHighlighted = highlighted === t.id;
                        const sectionCanReview = viewTab === "today" && (group as typeof TODAY_SECTIONS_COORD[0]).canReview;
                        return (
                          <motion.div key={t.id} ref={isHighlighted ? highlightRef : null} variants={staggerRow}
                            className="flex items-stretch border-b last:border-0 hover:bg-[hsl(var(--muted))]/20 transition-all cursor-pointer"
                            style={{ borderLeft: `3px solid ${accent}`, backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined, boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined }}
                            onClick={() => openTask(t.id)}
                          >
                            <div className="flex items-start py-4 px-4 w-full min-w-0 gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 min-w-0">
                                  {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
                                  <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-snug">{t.title}</span>
                                  {t.revisionCount > 0 && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">{t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}</span>}
                                </div>
                                {t.taskType === "subtask" && t.parentTask && <div className="mt-1"><ParentTaskBreadcrumb parentTask={t.parentTask} /></div>}
                                {t.taskType === "multi_task" && <div className="mt-1"><MultiTaskBadge taskType="multi_task" /></div>}
                                {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-1">{t.client}</p>}
                                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                                  <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap shrink-0 ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                                  <PriorityBadge priority={t.priority} />
                                  {!isTerminal(t.status) && t.dueDate && <span className={`text-xs shrink-0 tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]/60"}`}>{overdue && <AlertCircle className="inline h-3 w-3 mr-0.5" />}{fmtPrazoWeek(t.dueDate).label}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                {t.status === "pending" && (() => {
                                  const ok = !t.startDate || t.startDate.split("T")[0] <= TAB_TODAY_STR;
                                  return ok
                                    ? <Button size="sm" variant="default" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); handleIniciarDireto(t); }}>Iniciar</Button>
                                    : <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" disabled>Agendada</Button>;
                                })()}
                                {trans && t.status !== "pending" && <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); trans.next === "review" ? setUploadTarget(t) : updateStatus(t, trans.next); }}>{trans.shortLabel}</Button>}
                                {sectionCanReview && <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); navigate(`/review/${t.id}`); }}><ExternalLink className="h-3 w-3 mr-1" />Revisar</Button>}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openTask(t.id)}><Info className="h-3.5 w-3.5 mr-2" />Ver informações</DropdownMenuItem>
                                    {canReturn && <DropdownMenuItem onClick={() => setReturnTarget(t)}><Undo2 className="h-3.5 w-3.5 mr-2" />Devolver</DropdownMenuItem>}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop (md+): TanStack table ───────────────────── */}
              <table className="hidden md:table w-full border-collapse">
                <thead className="sticky top-0 z-20 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))]">
                  {table.getHeaderGroups().map(hg => (
                    <tr key={hg.id}>
                      {hg.headers.map(h => (
                        <th key={h.id}
                          style={{ width: h.getSize() !== 150 && h.getSize() > 0 ? h.getSize() : undefined }}
                          className={`h-10 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 whitespace-nowrap${(h.column.columnDef.meta as any)?.className ? ` ${(h.column.columnDef.meta as any).className}` : ""}`}
                        >
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {(viewTab === "today" ? todaySections : TASK_GROUPS).map(group => {
                    const groupRows = table.getRowModel().rows.filter(r => group.statuses.includes(r.original.status));
                    if (!groupRows.length) return null;
                    const collapsed = viewTab === "today" && collapsedSections.has(group.key);
                    return (
                      <React.Fragment key={group.key}>
                        <tr>
                          <td colSpan={columns.length} className="bg-[hsl(var(--card))] px-4 py-2 border-b border-[hsl(var(--border))]/30">
                            <div className="flex items-center gap-3">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                              <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                              <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupRows.length}</span>
                              {viewTab === "today" && (
                                <button onClick={() => toggleSection(group.key)} className="ml-1 opacity-40 hover:opacity-80 transition-opacity">
                                  {collapsed ? <ChevronRightIcon className="h-3.5 w-3.5" style={{ color: group.color }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: group.color }} />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {!collapsed && groupRows.map(row => {
                          const t = row.original;
                          const isHighlighted = highlighted === t.id;
                          return (
                            <tr key={row.id}
                              ref={isHighlighted ? (highlightRef as React.RefObject<HTMLTableRowElement>) : null}
                              className="border-b border-[hsl(var(--border))]/40 last:border-0 hover:bg-[hsl(var(--muted))]/20 cursor-pointer transition-colors"
                              style={{ borderLeft: `3px solid ${t.color ?? "#6366f1"}`, backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined, boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined }}
                              onClick={() => openTask(t.id)}
                            >
                              {row.getVisibleCells().map(cell => (
                                <td key={cell.id}
                                  className={`px-3 py-2.5 align-middle${(cell.column.columnDef.meta as any)?.className ? ` ${(cell.column.columnDef.meta as any).className}` : ""}`}
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                              {viewTab === "today" && (group as typeof TODAY_SECTIONS_COORD[0]).canReview && (
                                <td className="px-3 py-2.5 align-middle">
                                  <button
                                    onClick={e => { e.stopPropagation(); navigate(`/review/${t.id}`); }}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--foreground))]/70 whitespace-nowrap">
                                    <ExternalLink className="h-3 w-3" />Revisar
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* Modal detalhes — Agendadas (editor: leitura / coord: edição) */}
      {user?.role === "editor" ? (
        <TaskDetailsModal
          open={scheduledModalId !== null}
          onOpenChange={v => { if (!v) setScheduledModalId(null); }}
          taskId={scheduledModalId}
        />
      ) : (
        <TaskFormModal
          open={scheduledModalId !== null}
          onOpenChange={v => { if (!v) setScheduledModalId(null); }}
          editTaskId={scheduledModalId}
          onSaved={() => { setScheduledModalId(null); load(); }}
        />
      )}

      {/* Devolver dialog */}
      <Dialog open={!!returnTarget} onOpenChange={v => { if (!v && !returning) { setReturnTarget(null); setReturnComment(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Devolver tarefa</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A tarefa <strong>"{returnTarget?.title}"</strong> voltará para pendente e ficará sem editor atribuído.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Motivo da devolução <span className="text-destructive">*</span>
              </label>
              <Textarea
                placeholder="Explique o motivo para o coordenador…"
                value={returnComment}
                onChange={e => setReturnComment(e.target.value)}
                rows={3}
                className="resize-none text-sm"
                disabled={returning}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReturnTarget(null); setReturnComment(""); }} disabled={returning}>Cancelar</Button>
            <Button onClick={confirmReturn} disabled={returning || !returnComment.trim()}>
              {returning ? "Aguarde…" : "Devolver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {uploadTarget && (
        <TaskFileUploadModal
          open={!!uploadTarget}
          taskId={uploadTarget.id}
          taskCode={uploadTarget.taskCode}
          taskTitle={uploadTarget.title}
          onDone={() => { setUploadTarget(null); load(); }}
          onCancel={() => setUploadTarget(null)}
        />
      )}


    </div>
  );
}

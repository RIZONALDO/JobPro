import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { TaskFileUploadModal } from "@/components/TaskFileUploadModal";
import { TaskFilesViewModal } from "@/components/TaskFilesViewModal";
import { motion } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearch } from "wouter";
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
  AlertCircle, MoreVertical,
  Info, Undo2, Search, X, Clock, FileVideo,
} from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { STATUS_LABEL, STATUS_CLASS, isTerminal } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";
import { ComplexityConfirmDialog, COMPLEXITY_MESSAGES } from "@/components/ui/complexity-confirm-dialog";

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
  revisions: Revision[];
  updatedAt: string;
  reviewedAt?: string | null;
  editorComplexitySet?: boolean;
  fileCount?: number;
  // multi-task
  taskType?: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

// ── Helpers de agendamento ────────────────────────────────────────────────────
const TAB_TODAY_STR = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const ACTIVE_STATUSES = new Set(["pending", "in_progress", "in_revision", "review"]);
const SCHEDULED_STATUSES = new Set(["pending", "in_progress", "paused"]);
function isTaskScheduled(t: Task): boolean {
  if (!SCHEDULED_STATUSES.has(t.status)) return false;
  const ref = t.startDate ?? (t.status === "pending" ? t.dueDate : null);
  if (!ref) return false;
  return ref.split("T")[0] > TAB_TODAY_STR;
}


const transitions: Record<string, { next: string; label: string; shortLabel: string }> = {
  pending:     { next: "in_progress", label: "Iniciar edição",         shortLabel: "Iniciar"  },
  in_progress: { next: "review",      label: "Enviar para aprovação",  shortLabel: "Enviar"   },
  in_revision: { next: "review",      label: "Enviar para aprovação",  shortLabel: "Enviar"   },
  reopened:    { next: "in_progress", label: "Iniciar edição",         shortLabel: "Iniciar"  },
};

const STATUS_OPTIONS = [
  { value: "all",         label: "Todas" },
  { value: "active",      label: "Ativas" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em edição" },
  { value: "in_revision", label: "Em alteração" },
  { value: "review",      label: "Em aprovação" },
  { value: "reopened",    label: "Reaberta" },
  { value: "paused",      label: "Pausada" },
  { value: "completed",   label: "Concluída" },
  { value: "cancelled",   label: "Cancelada" },
];

const TASK_GROUPS = [
  { key: "pending",   label: "Pendentes",     statuses: ["pending"],      color: "#64748b" },
  { key: "editing",   label: "Em edição",     statuses: ["in_progress"],  color: "#3b82f6" },
  { key: "revision",  label: "Em alteração",  statuses: ["in_revision"],  color: "#f97316" },
  { key: "approval",  label: "Em aprovação",  statuses: ["review"],       color: "#f59e0b" },
  { key: "reopened",  label: "Reabertas",     statuses: ["reopened"],     color: "#e11d48" },
  { key: "paused",    label: "Pausadas",      statuses: ["paused"],       color: "#a855f7" },
  { key: "done",      label: "Concluídas",    statuses: ["completed"],    color: "#22c55e" },
  { key: "cancelled", label: "Canceladas",    statuses: ["cancelled"],    color: "#ef4444" },
];

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || isTerminal(status) || status === "review") return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

const STATUS_ORDER = ["pending", "in_progress", "in_revision", "review", "reopened", "paused", "completed", "cancelled"];

export default function EditorTaskList() {
  const { user } = useAuth();
  const { openTask } = useTaskModal();

  // ── DEBUG logs — remove when freeze is found ─────────────────────────────
  const _renderCount = useRef(0);
  _renderCount.current++;
  const _prevOpenTask = useRef(openTask);
  const _prevTasks    = useRef<Task[]>([]);
  console.log(`[EditorTaskList] render #${_renderCount.current}`);
  if (_prevOpenTask.current !== openTask) {
    console.warn("[EditorTaskList] openTask reference changed — columns will recompute");
    _prevOpenTask.current = openTask;
  }

  const [tasks,        setTasks]        = useState<Task[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewTab,      setViewTab]      = useState<"today" | "scheduled" | "all">("today");
  const [complexityTarget, setComplexityTarget] = useState<Task | null>(null);
  const [startingSaving,   setStartingSaving]   = useState(false);
  const [definingSaving,   setDefiningSaving]   = useState(false);

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
  const [filesViewTarget, setFilesViewTarget] = useState<Task | null>(null);
  const [returnTarget,  setReturnTarget]  = useState<Task | null>(null);
  const [returnComment, setReturnComment] = useState("");
  const [returning,     setReturning]     = useState(false);

  const load = useCallback(() => {
    console.log("[EditorTaskList] load() called");
    apiFetch<Task[]>("/api/my-tasks")
      .then(data => { console.log("[EditorTaskList] tasks received:", data.length); setTasks(data); })
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  const updateStatus = async (task: Task, status: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    try {
      await apiPut(`/api/tasks/${task.id}`, { status });
      load();
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
      toast.error("Erro ao atualizar status");
    }
  };

  const saveComplexity = async (complexity: string, comment: string) => {
    if (!complexityTarget) return;
    setDefiningSaving(true);
    try {
      await apiPut(`/api/tasks/${complexityTarget.id}`, { complexity, startComment: comment });
      setComplexityTarget(null);
      load();
      toast.success("Complexidade definida");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar complexidade");
    } finally { setDefiningSaving(false); }
  };

  const handleIniciarDireto = async (task: Task) => {
    setStartingSaving(true);
    try {
      const startComment = COMPLEXITY_MESSAGES[task.complexity] ?? COMPLEXITY_MESSAGES.medium;
      await apiPut(`/api/tasks/${task.id}`, { status: "in_progress", startComment });
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar tarefa");
    } finally { setStartingSaving(false); }
  };

  const confirmReturn = async () => {
    if (!returnTarget) return;
    setReturning(true);
    try {
      await apiPost(`/api/tasks/${returnTarget.id}/return`, { returnComment: returnComment.trim() });
      setReturnTarget(null);
      setReturnComment("");
      load();
      toast.success("Tarefa devolvida.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao devolver");
    } finally { setReturning(false); }
  };

  const filtered = tasks
    .filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !(t.client ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus === "active") return !isTerminal(t.status);
      if (filterStatus !== "all") return t.status === filterStatus;
      return true;
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const tabFiltered = (() => {
    if (viewTab === "today")     return filtered.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status));
    if (viewTab === "scheduled") return filtered.filter(t => isTaskScheduled(t));
    return filtered;
  })();

  const todayCount     = filtered.filter(t => !isTaskScheduled(t) && ACTIVE_STATUSES.has(t.status)).length;
  const scheduledCount = filtered.filter(t => isTaskScheduled(t)).length;

  const tabs = [
    { key: "today"     as const, label: "Tarefas do dia", count: todayCount     },
    { key: "scheduled" as const, label: "Agendadas",       count: scheduledCount },
    { key: "all"       as const, label: "Todas",            count: filtered.length },
  ];

  const hasFilter = search || filterStatus !== "all";

  // ── TanStack Table ─────────────────────────────────────────────────────────

  // Log when tabFiltered identity changes
  if (_prevTasks.current !== tabFiltered) {
    console.log(`[EditorTaskList] tabFiltered identity changed — ${tabFiltered.length} rows → TanStack will recompute`);
    _prevTasks.current = tabFiltered;
  }

  const columns = useMemo<ColumnDef<Task, unknown>[]>(() => {
    console.log("[EditorTaskList] columns useMemo recomputing");
    return [
    {
      id: "tarefa",
      accessorKey: "title",
      header: "Tarefa",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
              <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
              {t.revisionCount > 0 && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">
                  {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
                </span>
              )}
            </div>
            {t.taskType === "subtask" && t.parentTask && <ParentTaskBreadcrumb parentTask={t.parentTask} className="mt-0.5" />}
            {t.taskType === "multi_task" && <MultiTaskBadge taskType="multi_task" className="mt-0.5" />}
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={`${STATUS_CLASS[t.status] ?? ""} text-[11px] px-2 py-0.5 font-medium whitespace-nowrap shrink-0`}>
              {STATUS_LABEL[t.status] ?? t.status}
            </Badge>
            <MultiTaskBadge taskType={t.taskType ?? "task"} />
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
        ? <span>Período</span>
        : <span className="flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />Entrega</span>,
      size: viewTab === "scheduled" ? 176 : 112,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        const overdue = isOverdue(t.dueDate, t.status);
        if (viewTab === "scheduled") {
          const fmtD = (d: string) => d.split("T")[0].split("-").slice(1).reverse().join("/");
          const s = t.startDate ? fmtD(t.startDate) : null;
          const e = t.dueDate   ? fmtD(t.dueDate)   : null;
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
        return (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <ChatAvatarButton userId={t.createdBy.id} name={t.createdBy.name} avatarUrl={t.createdBy.avatarUrl}
              size={28} taskId={t.id} taskCode={t.taskCode} taskTitle={t.title} />
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.createdBy.name.split(" ")[0]}</span>
          </div>
        );
      },
    },
    {
      id: "midia",
      header: "Mídia",
      size: 40,
      meta: { className: "text-center" },
      cell: ({ row }) => {
        const t = row.original;
        return (t.fileCount ?? 0) > 0 ? (
          <div className="flex justify-center" onClick={e => e.stopPropagation()}>
            <button title="Ver mídia" onClick={() => setFilesViewTarget(t)}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-violet-500 hover:bg-violet-500/10 transition-colors">
              <FileVideo className="h-4 w-4" />
            </button>
          </div>
        ) : <span className="text-[hsl(var(--muted-foreground))]/30 flex justify-center">—</span>;
      },
    },
    {
      id: "acao",
      header: "Ação",
      size: 128,
      cell: ({ row }) => {
        const t = row.original;
        const trans = transitions[t.status];
        const startAllowed = !t.startDate || t.startDate.split("T")[0] <= TAB_TODAY_STR;
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {t.status === "pending" && !t.editorComplexitySet && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full" onClick={() => setComplexityTarget(t)}>Definir</Button>
            )}
            {t.status === "pending" && t.editorComplexitySet && (
              startAllowed
                ? <Button size="sm" variant="default" className="h-7 text-xs px-3 w-full" onClick={() => handleIniciarDireto(t)}>Iniciar</Button>
                : <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full" disabled>Agendada</Button>
            )}
            {trans && t.status !== "pending" && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full"
                onClick={() => trans.next === "review" ? setUploadTarget(t) : updateStatus(t, trans.next)}>
                {trans.shortLabel}
              </Button>
            )}
            {!trans && t.status !== "pending" && (
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
        const canReturn = ["pending","in_progress","in_revision"].includes(t.status);
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
  ]; }, [viewTab, setFilesViewTarget, setComplexityTarget, setUploadTarget, setReturnTarget, openTask]);

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
          {tabFiltered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {viewTab === "today" ? "Nenhuma tarefa para hoje." : viewTab === "scheduled" ? "Nenhuma tarefa agendada." : search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa atribuída."}
              </p>
            </div>
          ) : (
            <>
              {/* ── Mobile (< md) ────────────────────────────────────── */}
              <div className="md:hidden">
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
                      {groupTasks.map(t => {
                        const overdue = isOverdue(t.dueDate, t.status);
                        const accent = t.color ?? "#6366f1";
                        const trans = transitions[t.status];
                        const canReturn = ["pending","in_progress","in_revision"].includes(t.status);
                        const isHighlighted = highlighted === t.id;
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
                                  <Badge className={`text-xs px-2 py-0.5 font-medium shrink-0 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                                  <PriorityBadge priority={t.priority} />
                                  {!isTerminal(t.status) && t.dueDate && <span className={`text-xs shrink-0 tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]/60"}`}>{overdue && <AlertCircle className="inline h-3 w-3 mr-0.5" />}{fmtPrazoWeek(t.dueDate).label}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                {t.status === "pending" && !t.editorComplexitySet && <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); setComplexityTarget(t); }}>Definir complexidade</Button>}
                                {t.status === "pending" && t.editorComplexitySet && (() => {
                                  const ok = !t.startDate || t.startDate.split("T")[0] <= TAB_TODAY_STR;
                                  return ok
                                    ? <Button size="sm" variant="default" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); handleIniciarDireto(t); }}>Iniciar</Button>
                                    : <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" disabled>Agendada</Button>;
                                })()}
                                {trans && t.status !== "pending" && <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap" onClick={e => { e.stopPropagation(); trans.next === "review" ? setUploadTarget(t) : updateStatus(t, trans.next); }}>{trans.shortLabel}</Button>}
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
                  {TASK_GROUPS.map(group => {
                    const groupRows = table.getRowModel().rows.filter(r => group.statuses.includes(r.original.status));
                    if (!groupRows.length) return null;
                    return (
                      <React.Fragment key={group.key}>
                        <tr className="sticky top-10 z-10">
                          <td colSpan={columns.length} className="bg-[hsl(var(--card))] px-4 py-2 border-b border-[hsl(var(--border))]/30">
                            <div className="flex items-center gap-3">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                              <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                              <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupRows.length}</span>
                            </div>
                          </td>
                        </tr>
                        {groupRows.map(row => {
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

      {complexityTarget && (
        <ComplexityConfirmDialog
          open={!!complexityTarget}
          task={complexityTarget}
          onSave={saveComplexity}
          onCancel={() => setComplexityTarget(null)}
          saving={definingSaving}
        />
      )}

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

      {filesViewTarget && (
        <TaskFilesViewModal
          open={!!filesViewTarget}
          onClose={() => setFilesViewTarget(null)}
          taskId={filesViewTarget.id}
          taskCode={filesViewTarget.taskCode}
          taskTitle={filesViewTarget.title}
        />
      )}

    </div>
  );
}

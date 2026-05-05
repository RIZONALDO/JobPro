import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Search, Tag, Calendar, AlertTriangle, CheckCircle2,
  Clock, Eye, RotateCcw, ChevronUp, ChevronDown, ChevronsUpDown,
  ExternalLink, Layers, BarChart3, ListFilter, ChevronRight,
} from "lucide-react";
import {
  parseISO, isBefore, isToday, differenceInDays, format,
  min as dateMin, max as dateMax,
  startOfMonth, endOfMonth, addMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  color: string;
  client: string | null;
  revisionCount: number;
  folderUrl: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { id: number; name: string; avatarUrl: string | null } | null;
  coordinator: { id: number; name: string; avatarUrl: string | null } | null;
}

type SortKey = "dueDate" | "title" | "status" | "priority" | "client" | "assignee" | "revisionCount";
type SortDir = "asc" | "desc";

// ── Constants ─────────────────────────────────────────────────────────────────

const COORD_ROLES = ["admin", "supervisor", "coordinator"];
const ALL_STATUSES = ["pending", "in_progress", "review", "in_revision", "completed"];

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
};
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const STATUS_BAR_COLOR: Record<string, string> = {
  pending:     "#94a3b8",
  in_progress: "#3b82f6",
  review:      "#f59e0b",
  in_revision: "#f97316",
  completed:   "#22c55e",
};

const LEFT_W  = 240; // px — sticky left panel
const ROW_H   = 38;  // px — each task row
const HEAD_H  = 28;  // px — month header height
const GROUP_H = 30;  // px — client group header

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOverdue(t: TimelineTask) {
  if (!t.dueDate || t.status === "completed") return false;
  const d = parseISO(t.dueDate);
  return isBefore(d, new Date()) && !isToday(d);
}

function dueDateLabel(dueDate: string | null) {
  if (!dueDate) return { text: "—", cls: "text-[hsl(var(--muted-foreground))]" };
  const d = parseISO(dueDate);
  const diff = differenceInDays(d, new Date());
  const fmt  = format(d, "dd/MM/yy", { locale: ptBR });
  if (isBefore(d, new Date()) && !isToday(d)) return { text: fmt, cls: "text-red-600 font-semibold" };
  if (isToday(d))  return { text: "Hoje",  cls: "text-orange-600 font-semibold" };
  if (diff <= 3)   return { text: fmt,     cls: "text-amber-600 font-medium" };
  return { text: fmt, cls: "text-[hsl(var(--muted-foreground))]" };
}

function Avatar({ p, size = 6 }: { p: { name: string; avatarUrl: string | null } | null; size?: number }) {
  if (!p) return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  const ini = p.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      {p.avatarUrl
        ? <img src={p.avatarUrl} className={`h-${size} w-${size} rounded-full object-cover shrink-0`} />
        : <div className={`h-${size} w-${size} rounded-full bg-[hsl(var(--primary))]/15 flex items-center justify-center shrink-0`}>
            <span className="text-[9px] font-bold text-[hsl(var(--primary))]">{ini}</span>
          </div>
      }
      <span className="text-xs truncate max-w-[90px]">{p.name}</span>
    </div>
  );
}

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sort.dir === "asc" ? <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]" /> : <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]" />;
}

// ── Custom Gantt ──────────────────────────────────────────────────────────────

interface GanttGroup { client: string | null; tasks: TimelineTask[] }

function GanttChart({ tasks, onOpen }: { tasks: TimelineTask[]; onOpen: (id: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ task: TimelineTask; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const withDate = tasks.filter(t => t.dueDate);

  if (withDate.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Nenhuma tarefa com prazo para exibir no Gantt.
      </div>
    );
  }

  // Date range
  const today = new Date();
  const allStarts = withDate.map(t => parseISO(t.createdAt));
  const allEnds   = withDate.map(t => parseISO(t.dueDate!));
  const rangeStart = startOfMonth(dateMin([...allStarts, today]));
  const rangeEnd   = endOfMonth(dateMax([...allEnds, today]));
  const totalDays  = differenceInDays(rangeEnd, rangeStart) + 1;

  const DAY_W = totalDays > 365 ? 8 : totalDays > 180 ? 14 : totalDays > 90 ? 20 : 28;
  const totalW = totalDays * DAY_W;

  // Month headers
  const months: { label: string; left: number; width: number }[] = [];
  let cur = startOfMonth(rangeStart);
  while (isBefore(cur, rangeEnd)) {
    const mStart = cur < rangeStart ? rangeStart : cur;
    const mEnd   = endOfMonth(cur) > rangeEnd ? rangeEnd : endOfMonth(cur);
    months.push({
      label: format(cur, "MMM yyyy", { locale: ptBR }),
      left:  differenceInDays(mStart, rangeStart) * DAY_W,
      width: (differenceInDays(mEnd, mStart) + 1) * DAY_W,
    });
    cur = addMonths(cur, 1);
  }

  // Week grid lines (every 7 days)
  const weekLines: number[] = [];
  for (let d = 0; d < totalDays; d += 7) weekLines.push(d * DAY_W);

  // Today line
  const todayLeft = differenceInDays(today, rangeStart) * DAY_W;

  // Groups
  const groups: GanttGroup[] = [];
  const clientMap = new Map<string, TimelineTask[]>();
  withDate.forEach(t => {
    const key = t.client ?? "__none__";
    if (!clientMap.has(key)) clientMap.set(key, []);
    clientMap.get(key)!.push(t);
  });
  clientMap.forEach((ts, key) =>
    groups.push({ client: key === "__none__" ? null : key, tasks: ts })
  );
  groups.sort((a, b) => (a.client ?? "zzz").localeCompare(b.client ?? "zzz"));

  const barFor = (t: TimelineTask) => {
    const s    = parseISO(t.createdAt);
    const e    = parseISO(t.dueDate!);
    const left = Math.max(0, differenceInDays(s, rangeStart)) * DAY_W;
    const end  = Math.min(totalW, (differenceInDays(e, rangeStart) + 1) * DAY_W);
    return { left, width: Math.max(end - left, DAY_W) };
  };

  const barColor = (t: TimelineTask) =>
    isOverdue(t) ? "#ef4444" : STATUS_BAR_COLOR[t.status] ?? t.color;

  const toggleGroup = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="relative select-none" onMouseLeave={() => setTooltip(null)}>
      <div className="overflow-auto rounded-lg border" style={{ maxHeight: 520 }}>
        <div style={{ width: LEFT_W + totalW, minWidth: "100%" }}>

          {/* ── Header row ── */}
          <div className="flex sticky top-0 z-20" style={{ height: HEAD_H }}>
            {/* Left corner */}
            <div
              className="sticky left-0 shrink-0 bg-[hsl(var(--muted))]/60 border-r border-b flex items-center px-3 z-30"
              style={{ width: LEFT_W }}
            >
              <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Tarefa</span>
            </div>
            {/* Month labels */}
            <div className="relative bg-[hsl(var(--muted))]/40 border-b" style={{ width: totalW }}>
              {months.map(m => (
                <div
                  key={m.label}
                  className="absolute inset-y-0 flex items-center border-r border-[hsl(var(--border))]/60 px-2"
                  style={{ left: m.left, width: m.width }}
                >
                  <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] capitalize">{m.label}</span>
                </div>
              ))}
              {/* Today label in header */}
              {todayLeft >= 0 && todayLeft <= totalW && (
                <div
                  className="absolute top-0 flex flex-col items-center"
                  style={{ left: todayLeft, transform: "translateX(-50%)", zIndex: 5 }}
                >
                  <div className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                    Hoje
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Groups + Rows ── */}
          {groups.map(g => {
            const key = g.client ?? "__none__";
            const isCollapsed = collapsed.has(key);
            return (
              <div key={key}>
                {/* Group header */}
                <div className="flex sticky z-10" style={{ top: HEAD_H, height: GROUP_H }}>
                  <button
                    onClick={() => toggleGroup(key)}
                    className="sticky left-0 shrink-0 flex items-center gap-1.5 px-3 bg-[hsl(var(--muted))]/50 border-r border-b hover:bg-[hsl(var(--muted))]/70 transition-colors z-20 text-left"
                    style={{ width: LEFT_W }}
                  >
                    <ChevronRight className={`h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                    <Tag className="h-3 w-3 text-[hsl(var(--primary))] shrink-0" />
                    <span className="text-[11px] font-semibold truncate">{g.client ?? "Sem cliente"}</span>
                    <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">{g.tasks.length}</span>
                  </button>
                  {/* Group row background */}
                  <div className="relative bg-[hsl(var(--muted))]/20 border-b flex-1" style={{ width: totalW }}>
                    {weekLines.map(x => (
                      <div key={x} className="absolute inset-y-0 w-px bg-[hsl(var(--border))]/30" style={{ left: x }} />
                    ))}
                    {todayLeft >= 0 && todayLeft <= totalW && (
                      <div className="absolute inset-y-0 w-0.5 bg-indigo-500/40" style={{ left: todayLeft }} />
                    )}
                  </div>
                </div>

                {/* Task rows */}
                {!isCollapsed && g.tasks.map(t => {
                  const { left, width } = barFor(t);
                  const color = barColor(t);
                  const overdue = isOverdue(t);
                  return (
                    <div key={t.id} className="flex group" style={{ height: ROW_H }}>
                      {/* Left cell */}
                      <div
                        className="sticky left-0 shrink-0 flex items-center gap-2 px-3 bg-[hsl(var(--card))] border-r border-b hover:bg-[hsl(var(--muted))]/20 cursor-pointer z-10 transition-colors"
                        style={{ width: LEFT_W }}
                        onClick={() => onOpen(t.id)}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: color }}
                        />
                        <span className="text-[11px] truncate flex-1">{t.title}</span>
                        {overdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                      </div>

                      {/* Timeline cell */}
                      <div
                        className="relative border-b flex items-center bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]/10 transition-colors cursor-pointer"
                        style={{ width: totalW }}
                        onClick={() => onOpen(t.id)}
                        onMouseMove={e => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setTooltip({ task: t, x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {/* Grid */}
                        {weekLines.map(x => (
                          <div key={x} className="absolute inset-y-0 w-px bg-[hsl(var(--border))]/20" style={{ left: x }} />
                        ))}
                        {/* Today line */}
                        {todayLeft >= 0 && todayLeft <= totalW && (
                          <div className="absolute inset-y-0 w-0.5 bg-indigo-500/50 z-[1]" style={{ left: todayLeft }} />
                        )}
                        {/* Task bar */}
                        <div
                          className="absolute rounded z-[2] flex items-center px-1.5 overflow-hidden"
                          style={{
                            left,
                            width,
                            height: 22,
                            background: color,
                            opacity: t.status === "completed" ? 0.55 : overdue ? 1 : 0.85,
                            boxShadow: overdue ? `0 0 0 1.5px ${color}` : undefined,
                          }}
                        >
                          {width > 60 && (
                            <span className="text-white text-[9px] font-medium truncate drop-shadow">
                              {t.title}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltip.x + 16, top: tooltip.y - 8 }}
        >
          <div className="rounded-lg border bg-[hsl(var(--card))] shadow-xl p-3 text-xs space-y-1 min-w-[200px] max-w-[260px]">
            <p className="font-semibold text-sm leading-snug">{tooltip.task.title}</p>
            {tooltip.task.client && (
              <p className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                <Tag className="h-3 w-3" />{tooltip.task.client}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[tooltip.task.status] ?? ""}`}>
                {STATUS_LABEL[tooltip.task.status] ?? tooltip.task.status}
              </Badge>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_CLS[tooltip.task.priority] ?? ""}`}>
                {PRIORITY_LABEL[tooltip.task.priority]}
              </span>
            </div>
            {tooltip.task.assignee && (
              <p className="text-[hsl(var(--muted-foreground))]">Editor: <span className="text-[hsl(var(--foreground))] font-medium">{tooltip.task.assignee.name}</span></p>
            )}
            <p className="text-[hsl(var(--muted-foreground))]">
              Criada: <span className="text-[hsl(var(--foreground))]">{format(parseISO(tooltip.task.createdAt), "dd/MM/yy", { locale: ptBR })}</span>
            </p>
            {tooltip.task.dueDate && (
              <p className={isOverdue(tooltip.task) ? "text-red-600 font-semibold" : "text-[hsl(var(--muted-foreground))]"}>
                Prazo: <span>{format(parseISO(tooltip.task.dueDate), "dd/MM/yy", { locale: ptBR })}</span>
                {isOverdue(tooltip.task) && " ⚠ atrasada"}
              </p>
            )}
            {tooltip.task.revisionCount > 0 && (
              <p className="text-orange-600">{tooltip.task.revisionCount} revisão{tooltip.task.revisionCount !== 1 ? "ões" : ""}</p>
            )}
            <p className="text-[hsl(var(--muted-foreground))]/60 text-[10px] mt-1">Clique para abrir</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 px-1">
        {Object.entries(STATUS_BAR_COLOR).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: c, opacity: 0.85 }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span className="inline-block h-2 w-4 rounded-sm bg-red-500" />
          Atrasada
        </span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  usePageTitle("Linha do tempo");
  const { toast }    = useToast();
  const { openTask } = useTaskModal();
  const { user }     = useAuth();
  const [tasks, setTasks]   = useState<TimelineTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [search,         setSearch]         = useState("");
  const [statusFilter,   setStatusFilter]   = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<number | "">("");
  const [hideCompleted,  setHideCompleted]  = useState(false);
  const [onlyOverdue,    setOnlyOverdue]    = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "dueDate", dir: "asc" });

  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(d => { setTasks(d); setLoading(false); })
      .catch(() => { toast({ title: "Erro ao carregar", variant: "destructive" }); setLoading(false); });
  }, [toast, isCoord]);

  useEffect(() => { if (!isCoord) { setLoading(false); return; } load(); }, [load, isCoord]);
  useRealtime({ onTasksChanged: load });

  const assignees = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach(t => { if (t.assignee) m.set(t.assignee.id, t.assignee.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const kpi = useMemo(() => {
    const overdue = tasks.filter(isOverdue).length;
    const byStatus: Record<string, number> = {};
    ALL_STATUSES.forEach(s => { byStatus[s] = tasks.filter(t => t.status === s).length; });
    return { total: tasks.length, overdue, byStatus };
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks.filter(t => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !(t.client?.toLowerCase().includes(q)) && !(t.assignee?.name.toLowerCase().includes(q))) return false;
      }
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== "" && t.assignee?.id !== assigneeFilter) return false;
      if (hideCompleted && t.status === "completed") return false;
      if (onlyOverdue && !isOverdue(t)) return false;
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "dueDate":
          if (!a.dueDate && !b.dueDate) cmp = 0;
          else if (!a.dueDate) cmp = 1;
          else if (!b.dueDate) cmp = -1;
          else cmp = a.dueDate.localeCompare(b.dueDate);
          break;
        case "title": cmp = a.title.localeCompare(b.title); break;
        case "status": cmp = ALL_STATUSES.indexOf(a.status) - ALL_STATUSES.indexOf(b.status); break;
        case "priority": {
          const o: Record<string, number> = { high: 0, medium: 1, low: 2 };
          cmp = (o[a.priority] ?? 1) - (o[b.priority] ?? 1);
          break;
        }
        case "client": cmp = (a.client ?? "").localeCompare(b.client ?? ""); break;
        case "assignee": cmp = (a.assignee?.name ?? "").localeCompare(b.assignee?.name ?? ""); break;
        case "revisionCount": cmp = a.revisionCount - b.revisionCount; break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [tasks, search, statusFilter, priorityFilter, assigneeFilter, hideCompleted, onlyOverdue, sort]);

  const toggleStatus = (s: string) =>
    setStatusFilter(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const toggleSort = (key: SortKey) =>
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });

  if (!isCoord) return <div className="text-sm text-[hsl(var(--muted-foreground))] py-8 text-center">Acesso restrito a coordenadores.</div>;

  return (
    <div className="space-y-4">

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">

        <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]"><Layers className="h-3.5 w-3.5" /><span className="text-[11px]">Total</span></div>
          <p className="text-2xl font-bold tracking-tight">{kpi.total}</p>
        </div>

        <button onClick={() => setOnlyOverdue(v => !v)}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${onlyOverdue ? "bg-red-50 border-red-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-red-500"><AlertTriangle className="h-3.5 w-3.5" /><span className="text-[11px]">Atrasadas</span></div>
          <p className={`text-2xl font-bold tracking-tight ${kpi.overdue > 0 ? "text-red-600" : "text-[hsl(var(--muted-foreground))]"}`}>{kpi.overdue}</p>
        </button>

        <button onClick={() => toggleStatus("pending")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("pending") ? "bg-slate-100 border-slate-300" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-slate-500"><Clock className="h-3.5 w-3.5" /><span className="text-[11px]">Pendentes</span></div>
          <p className="text-2xl font-bold tracking-tight text-slate-600">{kpi.byStatus.pending ?? 0}</p>
        </button>

        <button onClick={() => toggleStatus("in_progress")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("in_progress") ? "bg-blue-50 border-blue-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-blue-500"><BarChart3 className="h-3.5 w-3.5" /><span className="text-[11px]">Em edição</span></div>
          <p className="text-2xl font-bold tracking-tight text-blue-600">{kpi.byStatus.in_progress ?? 0}</p>
        </button>

        <button onClick={() => { toggleStatus("review"); toggleStatus("in_revision"); }}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("review") ? "bg-amber-50 border-amber-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-amber-500"><Eye className="h-3.5 w-3.5" /><span className="text-[11px]">Aguardando</span></div>
          <p className="text-2xl font-bold tracking-tight text-amber-600">{(kpi.byStatus.review ?? 0) + (kpi.byStatus.in_revision ?? 0)}</p>
        </button>

        <button onClick={() => toggleStatus("completed")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("completed") ? "bg-green-50 border-green-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-green-500"><CheckCircle2 className="h-3.5 w-3.5" /><span className="text-[11px]">Aprovadas</span></div>
          <p className="text-2xl font-bold tracking-tight text-green-600">{kpi.byStatus.completed ?? 0}</p>
        </button>
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-3 flex flex-wrap items-center gap-2">
        <ListFilter className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />

        <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-56">
          <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tarefa, cliente, editor…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
        </div>

        {ALL_STATUSES.map(s => (
          <button key={s} onClick={() => toggleStatus(s)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${statusFilter.has(s) ? STATUS_CLASS[s] : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40"}`}>
            {STATUS_LABEL[s]}
          </button>
        ))}

        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
          <option value="">Prioridade</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>

        {assignees.length > 0 && (
          <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Editor</option>
            {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}

        <button onClick={() => setHideCompleted(v => !v)}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${hideCompleted ? "bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40"}`}>
          Ocultar aprovadas
        </button>

        <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Gantt ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold">Gantt</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
            {filtered.filter(t => t.dueDate).length} com prazo
          </span>
        </div>
        {loading
          ? <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
          : <GanttChart tasks={filtered} onOpen={openTask} />
        }
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
          <span className="font-semibold text-sm">Todas as tarefas</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{filtered.length}</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b bg-[hsl(var(--muted))]/10">
                  {([
                    { key: "title",         label: "Tarefa" },
                    { key: "client",        label: "Cliente" },
                    { key: "status",        label: "Status" },
                    { key: "priority",      label: "Prioridade" },
                    { key: null,            label: "Complexidade" },
                    { key: "dueDate",       label: "Prazo" },
                    { key: "assignee",      label: "Editor" },
                    { key: null,            label: "Coordenador" },
                    { key: "revisionCount", label: "Rev." },
                    { key: null,            label: "Pasta" },
                  ] as { key: SortKey | null; label: string }[]).map(({ key, label }) => (
                    <th key={label} onClick={() => key && toggleSort(key)}
                      className={`text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap select-none ${key ? "cursor-pointer hover:text-[hsl(var(--foreground))]" : ""}`}>
                      <span className="flex items-center gap-1">
                        {label}
                        {key && <SortIcon col={key} sort={sort} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(t => {
                  const dd = dueDateLabel(t.dueDate);
                  const overdue = isOverdue(t);
                  return (
                    <tr key={t.id} role="button" onClick={() => openTask(t.id)}
                      className={`cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/20 ${overdue ? "bg-red-50/40" : ""}`}>

                      <td className="px-4 py-3" style={{ borderLeft: `3px solid ${t.color}` }}>
                        <div className="flex items-start gap-2 max-w-[220px]">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm leading-snug line-clamp-2">{t.title}</p>
                            {t.description && <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 line-clamp-1">{t.description}</p>}
                          </div>
                          {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {t.client
                          ? <div className="flex items-center gap-1 text-xs max-w-[120px]"><Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" /><span className="truncate">{t.client}</span></div>
                          : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}
                      </td>

                      <td className="px-4 py-3">
                        <Badge className={`text-[10px] px-1.5 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_CLS[t.priority] ?? ""}`}>
                          {PRIORITY_LABEL[t.priority] ?? t.priority}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                        {COMPLEXITY_LABEL[t.complexity] ?? t.complexity}
                      </td>

                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${dd.cls}`}>
                        <span className="flex items-center gap-1">
                          {t.dueDate && <Calendar className="h-3 w-3 shrink-0" />}
                          {dd.text}
                        </span>
                      </td>

                      <td className="px-4 py-3"><Avatar p={t.assignee} /></td>
                      <td className="px-4 py-3"><Avatar p={t.coordinator} /></td>

                      <td className="px-4 py-3">
                        {t.revisionCount > 0
                          ? <div className="flex items-center gap-1 text-orange-600"><RotateCcw className="h-3 w-3" /><span className="text-xs font-semibold">{t.revisionCount}</span></div>
                          : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}
                      </td>

                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {t.folderUrl
                          ? <a href={t.folderUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[hsl(var(--primary))] hover:underline text-[11px]"><ExternalLink className="h-3 w-3" />Abrir</a>
                          : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

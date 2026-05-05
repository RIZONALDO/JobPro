import { useEffect, useState, useMemo, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Search, Tag, Calendar, AlertTriangle, CheckCircle2,
  Clock, Eye, RotateCcw, ChevronUp, ChevronDown, ChevronsUpDown,
  ExternalLink, User, Users, Layers, BarChart3, ListFilter,
} from "lucide-react";
import {
  parseISO, isAfter, isBefore, isToday, differenceInDays, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";

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

const COORD_ROLES = ["admin", "supervisor", "coordinator"];

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
};
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const ALL_STATUSES = ["pending", "in_progress", "review", "in_revision", "completed"];

type SortKey = "dueDate" | "title" | "status" | "priority" | "client" | "assignee" | "revisionCount";
type SortDir = "asc" | "desc";

function isOverdue(t: TimelineTask): boolean {
  if (!t.dueDate || t.status === "completed") return false;
  return isBefore(parseISO(t.dueDate), new Date()) && !isToday(parseISO(t.dueDate));
}

function dueDateLabel(dueDate: string | null): { text: string; cls: string } {
  if (!dueDate) return { text: "—", cls: "text-[hsl(var(--muted-foreground))]" };
  const d = parseISO(dueDate);
  const diff = differenceInDays(d, new Date());
  const fmt = format(d, "dd/MM/yy", { locale: ptBR });
  if (isBefore(d, new Date()) && !isToday(d))
    return { text: fmt, cls: "text-red-600 font-semibold" };
  if (isToday(d))
    return { text: "Hoje", cls: "text-orange-600 font-semibold" };
  if (diff <= 3)
    return { text: fmt, cls: "text-amber-600 font-medium" };
  return { text: fmt, cls: "text-[hsl(var(--muted-foreground))]" };
};

function Avatar({ person, size = 6 }: { person: { name: string; avatarUrl: string | null } | null; size?: number }) {
  if (!person) return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  const initials = person.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      {person.avatarUrl ? (
        <img src={person.avatarUrl} className={`h-${size} w-${size} rounded-full object-cover shrink-0`} />
      ) : (
        <div className={`h-${size} w-${size} rounded-full bg-[hsl(var(--primary))]/15 flex items-center justify-center shrink-0`}>
          <span className="text-[9px] font-bold text-[hsl(var(--primary))]">{initials}</span>
        </div>
      )}
      <span className="text-xs text-[hsl(var(--foreground))] truncate max-w-[90px]">{person.name}</span>
    </div>
  );
}

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sort.dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-[hsl(var(--primary))]" />
    : <ChevronDown className="h-3 w-3 text-[hsl(var(--primary))]" />;
}

export default function TimelinePage() {
  usePageTitle("Linha do tempo");
  const { toast } = useToast();
  const { openTask } = useTaskModal();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [assigneeFilter, setAssigneeFilter] = useState<number | "">("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  // Sort
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "dueDate", dir: "asc" });

  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(data => { setTasks(data); setLoading(false); })
      .catch(() => { toast({ title: "Erro ao carregar", variant: "destructive" }); setLoading(false); });
  }, [toast, isCoord]);

  useEffect(() => {
    if (!isCoord) { setLoading(false); return; }
    load();
  }, [load, isCoord]);

  useRealtime({ onTasksChanged: load });

  // Derived: all assignees for filter dropdown
  const assignees = useMemo(() => {
    const map = new Map<number, string>();
    tasks.forEach(t => { if (t.assignee) map.set(t.assignee.id, t.assignee.name); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  // KPI counts
  const kpi = useMemo(() => {
    const overdue = tasks.filter(isOverdue).length;
    const byStatus: Record<string, number> = {};
    ALL_STATUSES.forEach(s => { byStatus[s] = tasks.filter(t => t.status === s).length; });
    return { total: tasks.length, overdue, byStatus };
  }, [tasks]);

  // Filtered + sorted tasks
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
        case "dueDate": {
          if (!a.dueDate && !b.dueDate) cmp = 0;
          else if (!a.dueDate) cmp = 1;
          else if (!b.dueDate) cmp = -1;
          else cmp = a.dueDate.localeCompare(b.dueDate);
          break;
        }
        case "title": cmp = a.title.localeCompare(b.title); break;
        case "status": cmp = ALL_STATUSES.indexOf(a.status) - ALL_STATUSES.indexOf(b.status); break;
        case "priority": {
          const order = { high: 0, medium: 1, low: 2 };
          cmp = (order[a.priority as keyof typeof order] ?? 1) - (order[b.priority as keyof typeof order] ?? 1);
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

  // Gantt data: only tasks with dueDate from filtered list
  const { ganttSeries, ganttOptions } = useMemo(() => {
    const withDate = filtered.filter(t => t.dueDate);
    if (withDate.length === 0) return { ganttSeries: [], ganttOptions: {} as ApexOptions };

    const today = Date.now();

    const series = withDate.map(t => ({
      name: t.title,
      data: [{
        x: t.title,
        y: [new Date(t.createdAt).getTime(), new Date(t.dueDate!).getTime()],
        fillColor: t.status === "completed" ? "#22c55e66"
          : isOverdue(t) ? "#ef4444"
          : t.color,
        strokeColor: "transparent",
        meta: { taskId: t.id, client: t.client, assignee: t.assignee?.name, status: t.status, priority: t.priority },
      }],
    }));

    const opts: ApexOptions = {
      chart: {
        type: "rangeBar",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: false },
        events: {
          dataPointSelection: (_e: unknown, _chart: unknown, o: { seriesIndex: number; dataPointIndex: number; w: { config: { series: { data: { meta?: { taskId: number } }[] }[] } } }) => {
            const d = o.w.config.series[o.seriesIndex].data[o.dataPointIndex] as { meta?: { taskId: number } };
            if (d?.meta?.taskId) openTask(d.meta.taskId);
          },
        },
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: "end", barHeight: "60%" },
      },
      xaxis: {
        type: "datetime",
        labels: {
          datetimeUTC: false,
          style: { fontSize: "10px", colors: Array(30).fill("#94a3b8") },
          datetimeFormatter: { month: "MMM/yy", day: "dd/MM" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { fontSize: "10px", colors: Array(100).fill("#64748b") },
          maxWidth: 200,
        },
      },
      grid: {
        borderColor: "#f1f5f9",
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
      },
      annotations: {
        xaxis: [{
          x: today,
          borderColor: "#6366f1",
          strokeDashArray: 4,
          label: {
            text: "Hoje",
            style: { color: "#fff", background: "#6366f1", fontSize: "10px", padding: { left: 6, right: 6, top: 2, bottom: 2 } },
          },
        }],
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex, w }: { seriesIndex: number; dataPointIndex: number; w: { config: { series: { data: { x: string; y: number[]; meta?: { client?: string; assignee?: string; status?: string; priority?: string } }[] }[] } } }) => {
          const d = w.config.series[seriesIndex].data[dataPointIndex];
          const s = new Date(d.y[0]).toLocaleDateString("pt-BR");
          const e = new Date(d.y[1]).toLocaleDateString("pt-BR");
          const st = STATUS_LABEL[d.meta?.status ?? ""] ?? d.meta?.status ?? "";
          const pr = PRIORITY_LABEL[d.meta?.priority ?? ""] ?? "";
          return `<div style="padding:10px 14px;font-size:11px;line-height:1.8;min-width:180px">
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#1e293b">${d.x}</div>
            ${d.meta?.client ? `<div style="color:#64748b">Cliente: <b style="color:#1e293b">${d.meta.client}</b></div>` : ""}
            ${d.meta?.assignee ? `<div style="color:#64748b">Editor: <b style="color:#1e293b">${d.meta.assignee}</b></div>` : ""}
            <div style="color:#64748b">Status: <b style="color:#1e293b">${st}</b></div>
            <div style="color:#64748b">Prioridade: <b style="color:#1e293b">${pr}</b></div>
            <div style="color:#64748b">Início: <b style="color:#1e293b">${s}</b></div>
            <div style="color:#64748b">Prazo: <b style="color:#1e293b">${e}</b></div>
          </div>`;
        },
      },
    };

    return { ganttSeries: series, ganttOptions: opts };
  }, [filtered, openTask]);

  const toggleSort = (key: SortKey) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  const toggleStatus = (s: string) => {
    setStatusFilter(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  if (!isCoord) return <div className="text-[hsl(var(--muted-foreground))] text-sm py-8 text-center">Acesso restrito a coordenadores.</div>;

  const ganttHeight = Math.max(200, filtered.filter(t => t.dueDate).length * 36 + 60);

  return (
    <div className="space-y-4">

      {/* ── KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">

        {/* Total */}
        <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Layers className="h-3.5 w-3.5" />
            <span className="text-[11px]">Total</span>
          </div>
          <p className="text-2xl font-bold tracking-tight">{kpi.total}</p>
        </div>

        {/* Atrasadas */}
        <button
          onClick={() => setOnlyOverdue(v => !v)}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${onlyOverdue ? "bg-red-50 border-red-200" : "bg-[hsl(var(--card))]"}`}
        >
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-[11px]">Atrasadas</span>
          </div>
          <p className={`text-2xl font-bold tracking-tight ${kpi.overdue > 0 ? "text-red-600" : "text-[hsl(var(--muted-foreground))]"}`}>{kpi.overdue}</p>
        </button>

        {/* Pending */}
        <button onClick={() => toggleStatus("pending")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("pending") ? "bg-slate-100 border-slate-300" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[11px]">Pendentes</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-slate-600">{kpi.byStatus.pending ?? 0}</p>
        </button>

        {/* In progress */}
        <button onClick={() => toggleStatus("in_progress")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("in_progress") ? "bg-blue-50 border-blue-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-blue-500">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="text-[11px]">Em edição</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-blue-600">{kpi.byStatus.in_progress ?? 0}</p>
        </button>

        {/* Review */}
        <button onClick={() => toggleStatus("review")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("review") ? "bg-amber-50 border-amber-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-amber-500">
            <Eye className="h-3.5 w-3.5" />
            <span className="text-[11px]">Aguardando</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-amber-600">{(kpi.byStatus.review ?? 0) + (kpi.byStatus.in_revision ?? 0)}</p>
        </button>

        {/* Completed */}
        <button onClick={() => toggleStatus("completed")}
          className={`rounded-xl border card-float p-4 flex flex-col gap-1 text-left transition-colors ${statusFilter.has("completed") ? "bg-green-50 border-green-200" : "bg-[hsl(var(--card))]"}`}>
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-[11px]">Aprovadas</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-green-600">{kpi.byStatus.completed ?? 0}</p>
        </button>
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-3 flex flex-wrap items-center gap-2">
        <ListFilter className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />

        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-56">
          <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tarefa, cliente, editor..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
        </div>

        {/* Status chips */}
        {ALL_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${statusFilter.has(s) ? STATUS_CLASS[s] : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40"}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 text-[hsl(var(--foreground))] outline-none cursor-pointer"
        >
          <option value="">Prioridade</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>

        {/* Assignee filter */}
        {assignees.length > 0 && (
          <select
            value={assigneeFilter}
            onChange={e => setAssigneeFilter(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 text-[hsl(var(--foreground))] outline-none cursor-pointer"
          >
            <option value="">Editor</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}

        {/* Hide completed */}
        <button
          onClick={() => setHideCompleted(v => !v)}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${hideCompleted ? "bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40"}`}
        >
          Ocultar aprovadas
        </button>

        {/* Results count */}
        <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">{filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Gantt ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold">Gantt — tarefas com prazo</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5 ml-1">
            {filtered.filter(t => t.dueDate).length}
          </span>
          <div className="ml-auto flex items-center gap-3 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded bg-red-400" /> Atrasada</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded bg-green-400" /> Aprovada</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded bg-[#6366f1]" /> Em andamento</span>
          </div>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando...</div>
        ) : ganttSeries.length === 0 ? (
          <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa com prazo para exibir.</div>
        ) : (
          <ReactApexChart
            type="rangeBar"
            series={ganttSeries as never}
            options={ganttOptions}
            height={ganttHeight}
          />
        )}
      </div>

      {/* ── Tasks Table ───────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
          <span className="font-semibold text-sm">Todas as tarefas</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{filtered.length}</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b bg-[hsl(var(--muted))]/10">
                  {([
                    { key: "title",          label: "Tarefa" },
                    { key: "client",         label: "Cliente" },
                    { key: "status",         label: "Status" },
                    { key: "priority",       label: "Prioridade" },
                    { key: null,             label: "Complexidade" },
                    { key: "dueDate",        label: "Prazo" },
                    { key: "assignee",       label: "Editor" },
                    { key: null,             label: "Coordenador" },
                    { key: "revisionCount",  label: "Rev." },
                    { key: null,             label: "Pasta" },
                  ] as { key: SortKey | null; label: string }[]).map(({ key, label }) => (
                    <th
                      key={label}
                      onClick={() => key && toggleSort(key)}
                      className={`text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap select-none ${key ? "cursor-pointer hover:text-[hsl(var(--foreground))]" : ""}`}
                    >
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
                    <tr
                      key={t.id}
                      role="button"
                      onClick={() => openTask(t.id)}
                      className={`cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/20 ${overdue ? "bg-red-50/40" : ""}`}
                    >
                      {/* Tarefa */}
                      <td className="px-4 py-3" style={{ borderLeft: `3px solid ${t.color}` }}>
                        <div className="flex items-start gap-2 max-w-[220px]">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm leading-snug line-clamp-2">{t.title}</p>
                            {t.description && (
                              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 line-clamp-1">{t.description}</p>
                            )}
                          </div>
                          {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="px-4 py-3">
                        {t.client ? (
                          <div className="flex items-center gap-1 text-xs max-w-[120px]">
                            <Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" />
                            <span className="truncate">{t.client}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge className={`text-[10px] px-1.5 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </td>

                      {/* Prioridade */}
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_CLS[t.priority] ?? ""}`}>
                          {PRIORITY_LABEL[t.priority] ?? t.priority}
                        </span>
                      </td>

                      {/* Complexidade */}
                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                        {COMPLEXITY_LABEL[t.complexity] ?? t.complexity}
                      </td>

                      {/* Prazo */}
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${dd.cls}`}>
                        <span className="flex items-center gap-1">
                          {t.dueDate && <Calendar className="h-3 w-3 shrink-0" />}
                          {dd.text}
                        </span>
                      </td>

                      {/* Editor */}
                      <td className="px-4 py-3">
                        <Avatar person={t.assignee} />
                      </td>

                      {/* Coordenador */}
                      <td className="px-4 py-3">
                        <Avatar person={t.coordinator} />
                      </td>

                      {/* Revisões */}
                      <td className="px-4 py-3">
                        {t.revisionCount > 0 ? (
                          <div className="flex items-center gap-1 text-orange-600">
                            <RotateCcw className="h-3 w-3" />
                            <span className="text-xs font-semibold">{t.revisionCount}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>

                      {/* Pasta */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {t.folderUrl ? (
                          <a href={t.folderUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[hsl(var(--primary))] hover:underline text-[11px]">
                            <ExternalLink className="h-3 w-3" />
                            <span>Abrir</span>
                          </a>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                        )}
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

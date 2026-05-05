import { useEffect, useState, useMemo, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Search, Tag, AlertTriangle, Eye,
  RotateCcw, ExternalLink, ChevronRight, X,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  parseISO, isBefore, isToday, differenceInDays, format,
  min as dateMin, max as dateMax, startOfMonth, endOfMonth, addMonths, addDays, getISOWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { LifecycleFlow } from "@/components/LifecycleFlow";
import "@xyflow/react/dist/style.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; role: string; avatarUrl: string | null }

interface TimelineTask {
  id: number; title: string; description: string | null;
  status: string; priority: string; complexity: string;
  dueDate: string | null; color: string; client: string | null;
  revisionCount: number; folderUrl: string | null;
  createdAt: string; updatedAt: string;
  assignee: Person | null; coordinator: Person | null;
}

interface LifecycleStep {
  type: "created" | "status_change";
  at: string;
  by: Person | null;
  meta: {
    fromStatus?: string; toStatus?: string;
    title?: string; client?: string; priority?: string; color?: string;
    revisionComment?: string; revisionNumber?: number;
  };
}

interface LifecycleData {
  task: TimelineTask & { assignee: Person | null; coordinator: Person | null };
  steps: LifecycleStep[];
}


// ── Constants ─────────────────────────────────────────────────────────────────

const COORD_ROLES = ["admin", "supervisor", "coordinator"];
const ALL_STATUSES = ["pending", "in_progress", "review", "in_revision", "completed"];

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLS: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-red-100 text-red-700 border-red-200",
};
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const STATUS_BAR: Record<string, string> = {
  pending: "#94a3b8", in_progress: "#3b82f6",
  review: "#f59e0b", in_revision: "#f97316", completed: "#22c55e",
};



const LEFT_W = 210;
const ROW_H  = 30;
const HEAD_H = 24;
const GRP_H  = 26;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOverdue(t: { dueDate: string | null; status: string }) {
  if (!t.dueDate || t.status === "completed") return false;
  const d = parseISO(t.dueDate);
  return isBefore(d, new Date()) && !isToday(d);
}

function fmt(iso: string) { return format(parseISO(iso), "dd/MM/yy HH:mm", { locale: ptBR }); }
function fmtShort(iso: string) { return format(parseISO(iso), "dd/MM/yy", { locale: ptBR }); }

function Avatar({ p, size = 5 }: { p: Person | null; size?: number }) {
  if (!p) return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  const ini = p.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {p.avatarUrl
        ? <img src={p.avatarUrl} className={`h-${size} w-${size} rounded-full object-cover shrink-0`} />
        : <div className={`h-${size} w-${size} rounded-full bg-[hsl(var(--primary))]/15 flex items-center justify-center shrink-0`}>
            <span className="text-[8px] font-bold text-[hsl(var(--primary))]">{ini}</span>
          </div>
      }
      <span className="text-xs truncate">{p.name}</span>
    </div>
  );
}


// ── Compact Gantt ─────────────────────────────────────────────────────────────

function GanttChart({
  tasks, onOpen, selectedId, onSelect, zoom,
}: {
  tasks: TimelineTask[];
  onOpen: (id: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  zoom: GanttZoom;
}) {
  const [tooltip, setTooltip] = useState<{ task: TimelineTask; x: number; y: number } | null>(null);

  const withDate = tasks.filter(t => t.dueDate);
  if (withDate.length === 0)
    return <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa com prazo cadastrado.</div>;

  const today = new Date();
  const allStarts = withDate.map(t => parseISO(t.createdAt));
  const allEnds   = withDate.map(t => parseISO(t.dueDate!));

  // Zoom-based pixel density
  const DAY_W = zoom === "week" ? 38 : zoom === "year" ? 4 : 14;

  // Date range: always covers all tasks + padding
  const rangeStart = startOfMonth(dateMin([...allStarts, today]));
  const rangeEnd   = endOfMonth(dateMax([...allEnds, today]));
  const totalDays  = differenceInDays(rangeEnd, rangeStart) + 1;
  const totalW     = totalDays * DAY_W;

  // Month header segments
  const months: { label: string; left: number; width: number }[] = [];
  let cur = startOfMonth(rangeStart);
  while (isBefore(cur, rangeEnd)) {
    const mS = cur < rangeStart ? rangeStart : cur;
    const mE = endOfMonth(cur) > rangeEnd ? rangeEnd : endOfMonth(cur);
    months.push({
      label: zoom === "year"
        ? format(cur, "MMM yy", { locale: ptBR })
        : format(cur, "MMMM yyyy", { locale: ptBR }),
      left: differenceInDays(mS, rangeStart) * DAY_W,
      width: (differenceInDays(mE, mS) + 1) * DAY_W,
    });
    cur = addMonths(cur, 1);
  }

  // Week markers (used in week/month zoom)
  const weekMarkers: { label: string; left: number }[] = [];
  if (zoom !== "year") {
    let wd = rangeStart;
    while (isBefore(wd, rangeEnd)) {
      weekMarkers.push({
        label: zoom === "week" ? format(wd, "dd/MM", { locale: ptBR }) : `Sem ${getISOWeek(wd)}`,
        left: differenceInDays(wd, rangeStart) * DAY_W,
      });
      wd = addDays(wd, 7);
    }
  }

  const todayLeft = Math.max(0, differenceInDays(today, rangeStart)) * DAY_W;
  const HEADER_H = zoom !== "year" ? HEAD_H * 2 : HEAD_H;

  // Flat list sorted by dueDate
  const sortedTasks = [...withDate].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const barFor = (t: TimelineTask) => {
    const left = Math.max(0, differenceInDays(parseISO(t.createdAt), rangeStart)) * DAY_W;
    const right = Math.min(totalW, (differenceInDays(parseISO(t.dueDate!), rangeStart) + 1) * DAY_W);
    return { left, width: Math.max(right - left, DAY_W) };
  };

  const barColor = (t: TimelineTask) =>
    isOverdue(t) ? "#ef4444" : STATUS_BAR[t.status] ?? t.color;


  return (
    <div className="relative" onMouseLeave={() => setTooltip(null)}>
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 170px)" }}>
        <div style={{ width: LEFT_W + totalW, minWidth: "100%" }}>

          {/* Header */}
          <div className="flex sticky top-0 z-20 flex-col" style={{ height: HEADER_H }}>
            {/* Month row */}
            <div className="flex" style={{ height: HEAD_H }}>
              <div className="sticky left-0 shrink-0 bg-[hsl(var(--muted))]/70 border-r border-b flex items-center px-3 z-30 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide" style={{ width: LEFT_W }}>
                Tarefa
              </div>
              <div className="relative bg-[hsl(var(--muted))]/50 border-b flex-1" style={{ minWidth: totalW }}>
                {months.map(m => (
                  <div key={m.label} className="absolute inset-y-0 border-r border-[hsl(var(--border))]/60 flex items-center px-2" style={{ left: m.left, width: m.width }}>
                    <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] capitalize truncate">{m.label}</span>
                  </div>
                ))}
                {todayLeft <= totalW && (
                  <div className="absolute top-0 flex flex-col items-center z-10" style={{ left: todayLeft, transform: "translateX(-50%)" }}>
                    <div className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 rounded whitespace-nowrap leading-5">Hoje</div>
                  </div>
                )}
              </div>
            </div>
            {/* Week/day sub-row */}
            {zoom !== "year" && (
              <div className="flex" style={{ height: HEAD_H }}>
                <div className="sticky left-0 shrink-0 bg-[hsl(var(--muted))]/40 border-r border-b z-30" style={{ width: LEFT_W }} />
                <div className="relative bg-[hsl(var(--muted))]/20 border-b flex-1" style={{ minWidth: totalW }}>
                  {weekMarkers.map(wk => (
                    <div key={wk.left} className="absolute inset-y-0 border-r border-[hsl(var(--border))]/30 flex items-center px-1" style={{ left: wk.left }}>
                      <span className="text-[9px] text-[hsl(var(--muted-foreground))]/70 whitespace-nowrap">{wk.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {sortedTasks.map(t => {
                  const { left, width } = barFor(t);
                  const color = barColor(t);
                  const overdue = isOverdue(t);
                  const isSel = selectedId === t.id;
                  return (
                    <div key={t.id} className="flex group" style={{ height: ROW_H + 10 }}>
                      <div
                        onClick={() => onSelect(t.id)}
                        className={`sticky left-0 shrink-0 flex flex-col justify-center gap-0 px-2.5 border-r border-b cursor-pointer transition-colors z-10
                          ${isSel ? "bg-[hsl(var(--primary))]/10" : "bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]/20"}`}
                        style={{ width: LEFT_W, borderLeft: `3px solid ${color}` }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] font-medium truncate flex-1">{t.title}</span>
                          {overdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                        </div>
                        {t.client && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate flex items-center gap-0.5">
                            <Tag className="h-2.5 w-2.5 shrink-0" />{t.client}
                          </span>
                        )}
                      </div>
                      <div
                        className={`relative border-b transition-colors cursor-pointer ${isSel ? "bg-[hsl(var(--primary))]/5" : "hover:bg-[hsl(var(--muted))]/10"}`}
                        style={{ width: totalW }}
                        onClick={() => onSelect(t.id)}
                        onMouseMove={e => setTooltip({ task: t, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {todayLeft <= totalW && <div className="absolute inset-y-0 w-0.5 bg-indigo-400/40 z-[1]" style={{ left: todayLeft }} />}
                        <div
                          className="absolute rounded z-[2] flex items-center px-1.5 overflow-hidden"
                          style={{ left, width, height: 20, top: 10, background: color, opacity: t.status === "completed" ? 0.45 : 0.8 }}
                        >
                          {width > 60 && <span className="text-white text-[9px] font-semibold truncate drop-shadow">{t.title}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 pointer-events-none" style={{ left: tooltip.x + 14, top: tooltip.y - 6 }}>
          <div className="rounded-lg border bg-[hsl(var(--card))] shadow-xl p-2.5 text-xs space-y-1 min-w-[180px]">
            <p className="font-semibold text-sm">{tooltip.task.title}</p>
            {tooltip.task.client && <p className="text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Tag className="h-3 w-3" />{tooltip.task.client}</p>}
            <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[tooltip.task.status] ?? ""}`}>{STATUS_LABEL[tooltip.task.status]}</Badge>
            {tooltip.task.assignee && <p className="text-[hsl(var(--muted-foreground))]">Editor: <b className="text-[hsl(var(--foreground))]">{tooltip.task.assignee.name}</b></p>}
            {tooltip.task.dueDate && <p className={isOverdue(tooltip.task) ? "text-red-600 font-semibold" : "text-[hsl(var(--muted-foreground))]"}>Prazo: {fmtShort(tooltip.task.dueDate)}</p>}
            <p className="text-[9px] text-[hsl(var(--muted-foreground))]/60 pt-0.5">Clique para ver ciclo de vida</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 px-0.5">
        {Object.entries(STATUS_BAR).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: c, opacity: 0.85 }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span className="inline-block h-2 w-4 rounded-sm bg-red-500" />Atrasada
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

  const [tasks, setTasks]           = useState<TimelineTask[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lifecycle, setLifecycle]   = useState<LifecycleData | null>(null);
  const [lifLoading, setLifLoading] = useState(false);
  const [zoom, setZoom]             = useState<GanttZoom>("month");

  // Filters
  const [search,      setSearch]      = useState("");
  const [statusF,     setStatusF]     = useState("");
  const [clientF,     setClientF]     = useState("");
  const [editorF,     setEditorF]     = useState<number | "">("");
  const [coordF,      setCoordF]      = useState<number | "">("");


  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(d => { setTasks(d); setLoading(false); })
      .catch(() => { toast({ title: "Erro ao carregar", variant: "destructive" }); setLoading(false); });
  }, [toast, isCoord]);

  useEffect(() => { if (!isCoord) { setLoading(false); return; } load(); }, [load, isCoord]);
  useRealtime({ onTasksChanged: load });

  // Fetch lifecycle when task selected
  const handleSelect = useCallback(async (id: number) => {
    if (selectedId === id) { setSelectedId(null); setLifecycle(null); return; }
    setSelectedId(id);
    setLifecycle(null);
    setLifLoading(true);
    try {
      const data = await apiFetch<LifecycleData>(`/api/tasks/${id}/lifecycle`);
      setLifecycle(data);
    } catch {
      toast({ title: "Erro ao carregar ciclo de vida", variant: "destructive" });
    } finally {
      setLifLoading(false);
    }
  }, [selectedId, toast]);

  // Derived filter options
  const clients = useMemo(() => {
    const s = new Set(tasks.map(t => t.client).filter(Boolean) as string[]);
    return [...s].sort();
  }, [tasks]);

  const editors = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach(t => { if (t.assignee) m.set(t.assignee.id, t.assignee.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const coords = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach(t => { if (t.coordinator) m.set(t.coordinator.id, t.coordinator.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  // Filtered tasks
  const filtered = useMemo(() => {
    let list = tasks.filter(t => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !(t.client?.toLowerCase().includes(q)) && !(t.assignee?.name.toLowerCase().includes(q))) return false;
      }
      if (statusF && t.status !== statusF) return false;
      if (clientF && t.client !== clientF) return false;
      if (editorF !== "" && t.assignee?.id !== editorF) return false;
      if (coordF  !== "" && t.coordinator?.id !== coordF) return false;
      return true;
    });

    list.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    return list;
  }, [tasks, search, statusF, clientF, editorF, coordF]);


  if (!isCoord) return <div className="text-sm text-[hsl(var(--muted-foreground))] py-8 text-center">Acesso restrito a coordenadores.</div>;

  return (
    <div className="space-y-4">

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-3 flex flex-wrap items-center gap-2">
        <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />

        <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-52">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tarefa ou cliente…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
          {search && <button onClick={() => setSearch("")}><X className="h-3 w-3 text-[hsl(var(--muted-foreground))]" /></button>}
        </div>

        <select value={statusF} onChange={e => setStatusF(e.target.value)}
          className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
          <option value="">Todos os status</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>

        {clients.length > 0 && (
          <select value={clientF} onChange={e => setClientF(e.target.value)}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os clientes</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {editors.length > 0 && (
          <select value={editorF} onChange={e => setEditorF(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os editores</option>
            {editors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}

        {coords.length > 0 && (
          <select value={coordF} onChange={e => setCoordF(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os coordenadores</option>
            {coords.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}

        {(search || statusF || clientF || editorF !== "" || coordF !== "") && (
          <button onClick={() => { setSearch(""); setStatusF(""); setClientF(""); setEditorF(""); setCoordF(""); }}
            className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <X className="h-3 w-3" /> Limpar
          </button>
        )}

        <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Gantt ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarIcon className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold">Gantt</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
            {filtered.filter(t => t.dueDate).length} com prazo
          </span>
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border bg-[hsl(var(--muted))]/30 p-0.5">
            {(["week", "month", "year"] as GanttZoom[]).map(z => (
              <button key={z} onClick={() => setZoom(z)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${zoom === z ? "bg-[hsl(var(--primary))] text-white shadow-sm" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
                {z === "week" ? "Semana" : z === "month" ? "Mês" : "Ano"}
              </button>
            ))}
          </div>
        </div>
        {loading
          ? <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
          : <GanttChart tasks={filtered} onOpen={openTask} selectedId={selectedId} onSelect={handleSelect} zoom={zoom} />
        }
      </div>

      {/* ── Lifecycle Modal ───────────────────────────────────────── */}
      {lifLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-[hsl(var(--card))] border px-8 py-6 text-sm text-[hsl(var(--muted-foreground))]">
            Carregando ciclo de vida…
          </div>
        </div>
      )}
      {lifecycle && !lifLoading && (
        <LifecycleFlow data={lifecycle} onClose={() => { setLifecycle(null); setSelectedId(null); }} onOpen={openTask} />
      )}
    </div>
  );
}

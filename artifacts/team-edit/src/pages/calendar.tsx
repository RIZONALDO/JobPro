import { useEffect, useState, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarDays, Calendar as CalIcon, Plus, X, ChevronDown } from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { toLocalDate } from "@/lib/utils";
import { TaskFormModal } from "@/components/task-form-modal";

interface CalendarTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  color: string;
  client: string | null;
  assignedToId: number | null;
  assigneeName: string | null;
  coordinatorId: number | null;
  coordinatorName: string | null;
}

type View = "week" | "month";

const DAYS_PT    = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS_PT  = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
                    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const PRIORITY_OPTS = [
  { value: "high",   label: "Alta"  },
  { value: "medium", label: "Média" },
  { value: "low",    label: "Baixa" },
];

const STATUS_OPTS = [
  { value: "pending",     label: "Pendente"     },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Aprovação"    },
  { value: "in_revision", label: "Em alteração" },
  { value: "completed",   label: "Aprovadas"    },
  { value: "paused",      label: "Pausadas"     },
  { value: "cancelled",   label: "Canceladas"   },
];

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 pl-3 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
          bg-[hsl(var(--background))] text-[hsl(var(--foreground))]
          appearance-none cursor-pointer focus:outline-none
          focus:ring-1 focus:ring-[hsl(var(--primary)/0.4)]
          hover:border-[hsl(var(--primary)/0.5)] transition-colors"
        style={{ minWidth: 120 }}
      >
        <option value="all">{label}: Todos</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d: Date, n: number): Date {
  const date = new Date(d); date.setDate(date.getDate() + n); return date;
}
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }
function fmtDay(d: Date): string { return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }

function getMonthGridStart(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const day = first.getDay();
  first.setDate(first.getDate() - (day === 0 ? 6 : day - 1));
  return first;
}

export default function Calendar() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isCoord = user?.role !== "editor";

  const [view,      setView]      = useState<View>("week");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [monthDate, setMonthDate] = useState<Date>(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [tasks,     setTasks]     = useState<CalendarTask[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [dialogOpen,     setDialogOpen]     = useState(false);
  const [editTaskId,     setEditTaskId]     = useState<number | null>(null);
  const [initialDueDate, setInitialDueDate] = useState("");

  // Filters
  const [fPriority, setFPriority] = useState("all");
  const [fStatus,   setFStatus]   = useState("all");
  const [fClient,   setFClient]   = useState("all");
  const [fEditor,   setFEditor]   = useState("all");
  const [fCoord,    setFCoord]    = useState("all");

  const monthGridStart = useMemo(() => getMonthGridStart(monthDate), [monthDate]);
  const monthGridCells = useMemo(() =>
    Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)),
    [monthGridStart]
  );

  const loadCalendar = useCallback(() => {
    setLoading(true);
    const url = view === "week"
      ? `/api/calendar?week=${fmt(weekStart)}`
      : `/api/calendar?from=${fmt(monthGridStart)}&to=${fmt(addDays(monthGridStart, 41))}`;
    apiFetch<CalendarTask[]>(url)
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar calendário", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [view, weekStart, monthGridStart, toast]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const openCreate = (dateStr: string) => { setEditTaskId(null); setInitialDueDate(dateStr); setDialogOpen(true); };
  const openEdit   = (t: CalendarTask)  => { setEditTaskId(t.id); setInitialDueDate(""); setDialogOpen(true); };

  // Filter options derived from loaded tasks
  const clientOpts = useMemo(() =>
    Array.from(new Set(tasks.map(t => t.client).filter(Boolean) as string[])).sort()
      .map(c => ({ value: c, label: c })), [tasks]);

  const editorOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => { if (t.assignedToId && t.assigneeName) seen.set(String(t.assignedToId), t.assigneeName); });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks]);

  const coordOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => { if (t.coordinatorId && t.coordinatorName) seen.set(String(t.coordinatorId), t.coordinatorName); });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks]);

  // Filtered tasks for display
  const filteredTasks = useMemo(() => tasks.filter(t => {
    if (fPriority !== "all" && t.priority   !== fPriority) return false;
    if (fStatus   !== "all" && t.status     !== fStatus)   return false;
    if (fClient   !== "all" && t.client     !== fClient)   return false;
    if (fEditor   !== "all" && String(t.assignedToId  ?? "") !== fEditor) return false;
    if (fCoord    !== "all" && String(t.coordinatorId ?? "") !== fCoord)  return false;
    return true;
  }), [tasks, fPriority, fStatus, fClient, fEditor, fCoord]);

  const hasFilters = fPriority !== "all" || fStatus !== "all" || fClient !== "all" || fEditor !== "all" || fCoord !== "all";
  const clearAll = () => { setFPriority("all"); setFStatus("all"); setFClient("all"); setFEditor("all"); setFCoord("all"); };

  const today    = toLocalDate(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd  = addDays(weekStart, 6);
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS_SHORT[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;
  const monthLabel = `${MONTHS_PT[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

  const tasksByDay = (day: Date) =>
    filteredTasks.filter(t => t.dueDate && toLocalDate(new Date(t.dueDate)) === toLocalDate(day));

  const prev = () => {
    if (view === "week") setWeekStart(d => addDays(d, -7));
    else setMonthDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; });
  };
  const next = () => {
    if (view === "week") setWeekStart(d => addDays(d, 7));
    else setMonthDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; });
  };
  const goToToday = () => {
    const now = new Date();
    setWeekStart(getMonday(now));
    const m = new Date(now); m.setDate(1); m.setHours(0,0,0,0);
    setMonthDate(m);
  };

  const navBtn = "h-8 w-8 flex items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)] transition-colors";

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-[hsl(var(--background))]">

      {/* ── Toolbar card ─────────────────────────────────────────────────── */}
      <div className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="flex items-center gap-2.5 flex-wrap">

          {/* ── Filtros (esquerda) ── */}
          <FilterSelect label="Status"       value={fStatus}   onChange={setFStatus}   options={STATUS_OPTS}   />
          <FilterSelect label="Prioridade"   value={fPriority} onChange={setFPriority} options={PRIORITY_OPTS} />
          <FilterSelect label="Cliente"      value={fClient}   onChange={setFClient}   options={clientOpts}   />
          {isCoord && <FilterSelect label="Editor"      value={fEditor}   onChange={setFEditor}   options={editorOpts}   />}
          {isCoord && <FilterSelect label="Coordenador" value={fCoord}    onChange={setFCoord}    options={coordOpts}    />}

          {hasFilters && (
            <button onClick={clearAll} className="flex items-center gap-1 h-8 px-2.5 text-xs rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)] transition-colors">
              <X className="h-3 w-3" /> Limpar
            </button>
          )}

          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
            {filteredTasks.length} tarefa{filteredTasks.length !== 1 ? "s" : ""}
          </span>

          {/* ── Separador ── */}
          <div className="flex-1" />
          <div className="w-px h-5 bg-[hsl(var(--border))] shrink-0" />

          {/* ── Controles de navegação (direita) ── */}
          <button onClick={prev} className={navBtn}><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm font-medium min-w-[160px] text-center">
            {view === "week" ? weekLabel : monthLabel}
          </span>
          <button onClick={next} className={navBtn}><ChevronRight className="h-4 w-4" /></button>
          <button
            onClick={goToToday}
            className="flex items-center gap-1 h-8 px-2.5 text-xs rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)] transition-colors"
          >
            Hoje
          </button>

          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-0.5 shrink-0">
            {(["week", "month"] as View[]).map(v => {
              const Icon = v === "week" ? CalendarDays : CalIcon;
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    view === v
                      ? "bg-[hsl(var(--primary))] text-white shadow-sm"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v === "week" ? "Semana" : "Mês"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Calendar card ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* ── WEEK VIEW ── */}
        {view === "week" && (
          <>
            <div className="grid grid-cols-7 border-b shrink-0">
              {weekDays.map((day, i) => {
                const isToday = fmt(day) === today;
                return (
                  <div key={i} className={`px-2 py-3 text-center border-r last:border-r-0 ${isToday ? "bg-[hsl(var(--primary))]/5" : "bg-[hsl(var(--muted))]/30"}`}>
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{DAYS_PT[i]}</p>
                    <p className={`text-base font-bold mt-0.5 leading-none ${isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>{day.getDate()}</p>
                    {isToday && <div className="h-1 w-1 rounded-full bg-[hsl(var(--primary))] mx-auto mt-1" />}
                  </div>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-7 min-h-full">
                {weekDays.map((day, i) => {
                  const isToday  = fmt(day) === today;
                  const dayTasks = tasksByDay(day);
                  return (
                    <div key={i} className={`group border-r last:border-r-0 p-2 space-y-1.5 align-top ${isToday ? "bg-[hsl(var(--primary))]/5" : ""}`}>
                      {loading ? (
                        <div className="h-8 rounded bg-[hsl(var(--muted))]/50 animate-pulse" />
                      ) : (
                        <>
                          {dayTasks.map(t => (
                            <TaskChip key={t.id} t={t} isCoord={isCoord} onClick={() => isCoord && openEdit(t)} />
                          ))}
                          {isCoord && (
                            <button type="button" onClick={() => openCreate(fmt(day))} title="Nova tarefa"
                              className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] px-2 py-4 flex items-center justify-center text-[hsl(var(--muted-foreground))]/40 hover:border-[hsl(var(--primary))]/50 hover:text-[hsl(var(--primary))]/70 hover:bg-[hsl(var(--primary))]/5 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── MONTH VIEW ── */}
        {view === "month" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="grid grid-cols-7 border-b shrink-0 bg-[hsl(var(--muted))]/30">
              {DAYS_PT.map(d => (
                <div key={d} className="px-2 py-2 text-center border-r last:border-r-0">
                  <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{d}</p>
                </div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7" style={{ gridTemplateRows: "repeat(6, 1fr)" }}>
              {monthGridCells.map((day, i) => {
                const isToday     = fmt(day) === today;
                const isThisMonth = day.getMonth() === monthDate.getMonth();
                const dayTasks    = tasksByDay(day);
                return (
                  <div
                    key={i}
                    className={`group border-r border-b p-1.5 flex flex-col gap-1
                      ${(i % 7) === 6 ? "border-r-0" : ""}
                      ${i >= 35 ? "border-b-0" : ""}
                      ${isToday ? "bg-[hsl(var(--primary))]/5" : !isThisMonth ? "bg-[hsl(var(--muted))]/20" : ""}
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full
                        ${isToday
                          ? "bg-[hsl(var(--primary))] text-white"
                          : isThisMonth
                            ? "text-[hsl(var(--foreground))]"
                            : "text-[hsl(var(--muted-foreground))]/40"
                        }`}>
                        {day.getDate()}
                      </span>
                      {isCoord && isThisMonth && (
                        <button type="button" onClick={() => openCreate(fmt(day))} title="Nova tarefa"
                          className="h-5 w-5 rounded flex items-center justify-center text-[hsl(var(--muted-foreground))]/30 hover:text-[hsl(var(--primary))]/70 hover:bg-[hsl(var(--primary))]/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {loading ? (
                      dayTasks.length === 0 && i < 7 && <div className="h-4 rounded bg-[hsl(var(--muted))]/50 animate-pulse" />
                    ) : (
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        {dayTasks.slice(0, 3).map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => isCoord && openEdit(t)}
                            className={`text-left w-full rounded px-1.5 py-0.5 text-xs leading-tight truncate border-l-2 ${isCoord ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                            style={{ borderLeftColor: t.color, backgroundColor: t.color + "18", color: "hsl(var(--foreground))" }}
                            title={t.title}
                          >
                            {t.title}
                          </button>
                        ))}
                        {dayTasks.length > 3 && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))] pl-1">+{dayTasks.length - 3} mais</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isCoord && (
        <TaskFormModal
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={loadCalendar}
          editTaskId={editTaskId}
          initialDueDate={initialDueDate}
        />
      )}
    </div>
  );
}

function TaskChip({ t, isCoord, onClick }: { t: CalendarTask; isCoord: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border bg-[hsl(var(--card))] dark:bg-[hsl(217,33%,14%)] px-2 py-1.5 border-l-2 shadow-sm dark:shadow-[0_1px_6px_rgba(0,0,0,0.5)] dark:border-white/10 ${isCoord ? "cursor-pointer hover:shadow-md hover:border-[hsl(var(--primary))]/40 transition-all" : ""}`}
      style={{ borderLeftColor: t.color }}
    >
      <p className="text-xs font-medium leading-tight line-clamp-2">{t.title}</p>
      {t.client && (
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{t.client}</p>
      )}
      <div className="flex items-center justify-between mt-1 gap-1 flex-wrap">
        <Badge className={`text-xs px-1 py-0 leading-4 ${STATUS_CLASS[t.status] ?? ""}`}>
          {STATUS_LABEL[t.status] ?? t.status}
        </Badge>
        {isCoord && t.assigneeName && (
          <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
            {t.assigneeName.split(" ")[0]}
          </span>
        )}
      </div>
    </div>
  );
}

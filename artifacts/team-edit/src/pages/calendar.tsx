import { useEffect, useState, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarDays, Calendar as CalIcon, Plus, X, ChevronDown } from "lucide-react";
import { toLocalDate } from "@/lib/utils";
import { TaskFormModal } from "@/components/task-form-modal";

interface CalendarTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  startDate: string | null;
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
  const defaultCoord = isCoord && user ? String(user.id) : "all";
  const [fPriority, setFPriority] = useState("all");
  const [fStatus,   setFStatus]   = useState("all");
  const [fClient,   setFClient]   = useState("all");
  const [fEditor,   setFEditor]   = useState("all");
  const [fCoord,    setFCoord]    = useState(defaultCoord);

  const monthGridStart = useMemo(() => getMonthGridStart(monthDate), [monthDate]);

  const loadCalendar = useCallback(() => {
    setLoading(true);
    const url = view === "week"
      ? `/api/calendar?week=${fmt(weekStart)}`
      : `/api/calendar?from=${fmt(monthGridStart)}&to=${fmt(addDays(monthGridStart, 41))}`;
    apiFetch<CalendarTask[]>(url)
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar calendário"))
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

  const hasFilters = fPriority !== "all" || fStatus !== "all" || fClient !== "all" || fEditor !== "all" || fCoord !== defaultCoord;
  const clearAll = () => { setFPriority("all"); setFStatus("all"); setFClient("all"); setFEditor("all"); setFCoord(defaultCoord); };

  const today    = toLocalDate(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd  = addDays(weekStart, 6);
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS_SHORT[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;
  const monthLabel = `${MONTHS_PT[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

  // Tarefas que "pousam" em um dia específico (apenas prazo, sem duração visível na view)
  const tasksByDay = (day: Date) => {
    const dayStr = fmt(day);
    return filteredTasks.filter(t => {
      const due  = t.dueDate ? t.dueDate.slice(0, 10) : null;
      const start = t.startDate ? t.startDate.slice(0, 10) : null;
      // Tarefa de duração (startDate diferente de dueDate) → não mostra no dia, vai para barra
      if (start && due && start !== due) return false;
      return due === dayStr || start === dayStr;
    });
  };

  // Tarefas com duração para a view de semana
  const spanningTasksForWeek = useMemo(() => {
    const weekDayStrs = Array.from({ length: 7 }, (_, i) => fmt(addDays(weekStart, i)));
    const wStart = weekDayStrs[0];
    const wEnd   = weekDayStrs[6];
    return filteredTasks.filter(t => {
      if (!t.startDate || !t.dueDate) return false;
      const start = t.startDate.slice(0, 10);
      const due   = t.dueDate.slice(0, 10);
      if (start === due) return false; // mesmo dia → chip normal
      // Sobrepõe com a semana
      return start <= wEnd && due >= wStart;
    }).map(t => {
      const start  = t.startDate!.slice(0, 10);
      const due    = t.dueDate.slice(0, 10);
      const wStart = weekDayStrs[0];
      const wEnd   = weekDayStrs[6];
      const cs = start < wStart ? wStart : start;
      const ce = due   > wEnd   ? wEnd   : due;
      const si = weekDayStrs.findIndex(d => d === cs);
      const ei = weekDayStrs.findIndex(d => d === ce);
      return {
        task: t,
        startIdx: si < 0 ? 0 : si,
        endIdx:   ei < 0 ? 6 : ei,
        cutLeft:  start < wStart,
        cutRight: due   > wEnd,
      };
    });
  }, [filteredTasks, weekStart]);


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
          {isCoord && (
            <div className="relative flex items-center">
              <select
                value={fCoord}
                onChange={e => setFCoord(e.target.value)}
                className="h-8 pl-3 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
                  bg-[hsl(var(--background))] text-[hsl(var(--foreground))]
                  appearance-none cursor-pointer focus:outline-none
                  focus:ring-1 focus:ring-[hsl(var(--primary)/0.4)]
                  hover:border-[hsl(var(--primary)/0.5)] transition-colors"
                style={{ minWidth: 120 }}
              >
                <option value="all">Geral</option>
                {user && <option value={String(user.id)}>Minhas</option>}
                {coordOpts.filter(o => o.value !== String(user?.id)).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
            </div>
          )}

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
            {/* Day headers */}
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

            {/* Spanning tasks (duration bars) */}
            {spanningTasksForWeek.length > 0 && (
              <div className="relative border-b bg-[hsl(var(--muted))]/10 shrink-0" style={{ minHeight: spanningTasksForWeek.length * 24 + 8 }}>
                {/* Background columns */}
                <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                  {weekDays.map((day, i) => (
                    <div key={i} className={`border-r last:border-r-0 ${fmt(day) === today ? "bg-[hsl(var(--primary))]/5" : ""}`} />
                  ))}
                </div>
                {/* Duration bars */}
                {spanningTasksForWeek.map((s, idx) => {
                  const { task: t, startIdx, endIdx, cutLeft, cutRight } = s;
                  const span = endIdx - startIdx + 1;
                  return (
                    <div
                      key={t.id}
                      onClick={() => isCoord && openEdit(t)}
                      title={`${t.title}${t.startDate ? ` · Início: ${t.startDate.slice(0,10)}` : ""} · Prazo: ${t.dueDate.slice(0,10)}`}
                      className={`absolute flex items-center px-2 text-xs font-medium leading-none truncate border bg-[hsl(var(--card))] dark:bg-[hsl(217,33%,14%)] shadow-sm ${isCoord ? "cursor-pointer hover:opacity-80" : ""}`}
                      style={{
                        top: 4 + idx * 24,
                        height: 24,
                        left:  `calc(${startIdx / 7 * 100}% + ${cutLeft ? 0 : 2}px)`,
                        width: `calc(${span / 7 * 100}% - ${cutLeft ? 0 : 2}px - ${cutRight ? 0 : 2}px)`,
                        borderLeft: cutLeft ? undefined : `3px solid ${t.color}`,
                        backgroundColor: t.color + "18",
                        borderRadius: `${cutLeft ? 0 : 4}px ${cutRight ? 0 : 4}px ${cutRight ? 0 : 4}px ${cutLeft ? 0 : 4}px`,
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      {!cutLeft && <span className="truncate">{t.title}</span>}
                      {cutLeft && <span className="truncate opacity-70">···{t.title}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Day task chips */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-7 min-h-full w-full">
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
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b shrink-0 bg-[hsl(var(--muted))]/30">
              {DAYS_PT.map(d => (
                <div key={d} className="px-2 py-2 text-center border-r last:border-r-0">
                  <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{d}</p>
                </div>
              ))}
            </div>

            {/* 6 week rows — each with its own spanning bars + day cells */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {Array.from({ length: 6 }, (_, weekIdx) => {
                const wDays = Array.from({ length: 7 }, (_, i) => addDays(monthGridStart, weekIdx * 7 + i));
                const wStrs = wDays.map(d => fmt(d));
                const wS = wStrs[0], wE = wStrs[6];

                // Spanning tasks that overlap this week (startDate !== dueDate)
                const wSpanning = filteredTasks
                  .filter(t => {
                    if (!t.startDate) return false;
                    const s = t.startDate.slice(0, 10), e = t.dueDate.slice(0, 10);
                    return s !== e && s <= wE && e >= wS;
                  })
                  .sort((a, b) => a.startDate!.localeCompare(b.startDate!));

                // Greedy lane assignment: pack tasks into rows without overlap
                const laneEnds: string[] = [];
                const taskLane = new Map<number, number>();
                wSpanning.forEach(t => {
                  const ts = t.startDate!.slice(0, 10) < wS ? wS : t.startDate!.slice(0, 10);
                  let lane = laneEnds.findIndex(end => end < ts);
                  if (lane < 0) { lane = laneEnds.length; laneEnds.push(""); }
                  laneEnds[lane] = t.dueDate.slice(0, 10) > wE ? wE : t.dueDate.slice(0, 10);
                  taskLane.set(t.id, lane);
                });
                const nLanes = laneEnds.length;

                return (
                  <div key={weekIdx} className="flex-1 border-b last:border-b-0 flex flex-col" style={{ minHeight: 90 }}>

                    {/* Spanning bars — rendered as absolute bars within a fixed-height band */}
                    {nLanes > 0 && (
                      <div className="relative shrink-0 border-b border-[hsl(var(--border))]/30" style={{ height: nLanes * 26 + 6 }}>
                        {/* Column ticks */}
                        <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                          {wDays.map((d, i) => (
                            <div key={i} className={`border-r last:border-r-0 ${fmt(d) === today ? "bg-[hsl(var(--primary))]/5" : ""}`} />
                          ))}
                        </div>
                        {/* Bars */}
                        {wSpanning.map(t => {
                          const s = t.startDate!.slice(0, 10);
                          const e = t.dueDate.slice(0, 10);
                          const cs = s < wS ? wS : s;
                          const ce = e > wE ? wE : e;
                          const si = wStrs.indexOf(cs);
                          const ei = wStrs.indexOf(ce);
                          if (si < 0 || ei < 0) return null;
                          const span = ei - si + 1;
                          const lane = taskLane.get(t.id) ?? 0;
                          const cutL = s < wS, cutR = e > wE;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => isCoord && openEdit(t)}
                              title={`${t.title} · ${s} → ${e}`}
                              className={`absolute flex items-center px-2 text-[11px] font-medium leading-none truncate border bg-[hsl(var(--card))] dark:bg-[hsl(217,33%,14%)] shadow-sm ${isCoord ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                              style={{
                                top: 3 + lane * 22,
                                height: 22,
                                left:  `calc(${si / 7 * 100}% + ${cutL ? 0 : 2}px)`,
                                width: `calc(${span / 7 * 100}% - ${cutL ? 0 : 2}px - ${cutR ? 0 : 2}px)`,
                                borderLeft: cutL ? undefined : `3px solid ${t.color}`,
                                backgroundColor: t.color + "18",
                                borderRadius: `${cutL ? 0 : 4}px ${cutR ? 0 : 4}px ${cutR ? 0 : 4}px ${cutL ? 0 : 4}px`,
                                color: "hsl(var(--foreground))",
                              }}
                            >
                              {cutL
                                ? <span className="truncate opacity-80">···{t.title}</span>
                                : <span className="truncate">{t.title}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Day cells — only point tasks (no periods) */}
                    <div className="grid grid-cols-7 flex-1">
                      {wDays.map((day, i) => {
                        const dayStr      = fmt(day);
                        const isToday     = dayStr === today;
                        const isThisMonth = day.getMonth() === monthDate.getMonth();
                        const pts         = tasksByDay(day);
                        return (
                          <div key={i} className={`group border-r last:border-r-0 p-1.5 flex flex-col gap-0.5
                            ${isToday ? "bg-[hsl(var(--primary))]/5" : !isThisMonth ? "bg-[hsl(var(--muted))]/20" : ""}`}>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full
                                ${isToday ? "bg-[hsl(var(--primary))] text-white" : isThisMonth ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]/40"}`}>
                                {day.getDate()}
                              </span>
                              {isCoord && isThisMonth && (
                                <button type="button" onClick={() => openCreate(dayStr)} title="Nova tarefa"
                                  className="h-5 w-5 rounded flex items-center justify-center text-[hsl(var(--muted-foreground))]/30 hover:text-[hsl(var(--primary))]/70 hover:bg-[hsl(var(--primary))]/10 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {loading ? (
                              weekIdx === 0 && i === 0 && <div className="h-4 rounded bg-[hsl(var(--muted))]/50 animate-pulse" />
                            ) : (
                              <>
                                {pts.slice(0, 2).map(t => (
                                  <button key={t.id} type="button"
                                    onClick={() => isCoord && openEdit(t)}
                                    className={`w-full text-left text-[11px] leading-tight truncate rounded border bg-[hsl(var(--card))] dark:bg-[hsl(217,33%,14%)] shadow-sm ${isCoord ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                                    style={{ padding: "3px 6px", borderLeft: `3px solid ${t.color}`, backgroundColor: t.color + "18", color: "hsl(var(--foreground))" }}
                                    title={t.title}
                                  >
                                    {t.title}
                                  </button>
                                ))}
                                {pts.length > 2 && (
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] pl-1">+{pts.length - 2} mais</span>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
      className={`flex items-center gap-1.5 rounded border px-2 shadow-sm overflow-hidden ${isCoord ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      style={{ borderLeft: `3px solid ${t.color}`, backgroundColor: t.color + "18", minHeight: 26, paddingTop: 3, paddingBottom: 3 }}
    >
      <span className="text-[11px] font-medium leading-tight truncate flex-1">{t.title}</span>
      {t.assigneeName && isCoord && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]/60 truncate shrink-0 hidden xl:block">
          {t.assigneeName.split(" ")[0]}
        </span>
      )}
    </div>
  );
}

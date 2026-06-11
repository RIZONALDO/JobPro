import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { apiFetch, apiPut } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, ChevronDown, Lock, CalendarDays, Plus, X, Trash2, Sparkles } from "lucide-react";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { EscalaModal } from "@/components/EscalaModal";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgendaTask {
  id: number;
  taskCode: string;
  title: string;
  status: string;
  priority: string;
  complexity: string;
  color: string;
  client: string | null;
  startDate: string | null;
  dueDate: string | null;
  effortHours?: number | null;
  creator: { id: number; name: string; avatarUrl: string | null } | null;
}

interface AllocRow {
  taskId:         number;
  workDate:       string;       // "YYYY-MM-DD"
  allocatedHours: number | null;
  startTime:      string | null; // "HH:MM"
  endTime:        string | null; // "HH:MM"
}

interface EditorRow {
  editor: { id: number; name: string; avatarUrl: string | null };
  tasks: AgendaTask[];
  allocations: AllocRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEEK_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MON_PT    = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
// Capacidade de trabalho por dia da semana (espelha o backend)
function dailyCap(dow: number): number {
  if (dow === 0) return 0; // domingo
  if (dow === 6) return 5; // sábado
  return 8;                // seg-sex
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}
function d0(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function diffDays(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }
function toMonday(d: Date): Date { const w = d.getDay(); return addDays(d0(d), w === 0 ? -6 : 1 - w); }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function dayHours(_tasks: AgendaTask[], allocs: AllocRow[], day: Date): number {
  const dayStr = toDateStr(day);
  const hours  = allocs
    .filter(a => a.workDate === dayStr && a.allocatedHours != null)
    .reduce((s, a) => s + (a.allocatedHours ?? 0), 0);
  return Math.round(hours * 100) / 100;
}

function dayReviewCount(tasks: AgendaTask[], day: Date): number {
  const dayStr = toDateStr(day);
  return tasks.filter(t => {
    if (t.status !== "review") return false;
    const startStr = t.startDate?.split("T")[0];
    const endStr   = t.dueDate?.split("T")[0];
    if (startStr && startStr > dayStr) return false;
    if (endStr   && endStr   < dayStr) return false;
    return true;
  }).length;
}

function dayTasks(tasks: AgendaTask[], allocs: AllocRow[], day: Date): AgendaTask[] {
  const dayStr      = toDateStr(day);
  const allocatedIds = new Set(
    allocs.filter(a => a.workDate === dayStr && (a.allocatedHours ?? 0) > 0).map(a => a.taskId)
  );
  return tasks.filter(t => allocatedIds.has(t.id));
}

/** Intervalo de horários de trabalho num dia (e.g. "08:00–16:00"), baseado nos slots v2. */
function dayTimeRange(allocs: AllocRow[], day: Date): { start: string; end: string } | null {
  const dayStr = toDateStr(day);
  const hits = allocs.filter(a => a.workDate === dayStr && a.startTime && a.endTime);
  if (hits.length === 0) return null;
  const start = hits.reduce((min, a) => a.startTime! < min ? a.startTime! : min, "99:99");
  const end   = hits.reduce((max, a) => a.endTime!   > max ? a.endTime!   : max, "00:00");
  return { start, end };
}

function slotConfig(hours: number, cap: number, reviewCount = 0) {
  const pct = cap > 0 ? Math.min(100, Math.round((hours / cap) * 100)) : 0;
  if (hours <= 0 && reviewCount > 0) return {
    pct, label: "Em aprovação",
    bg: "rgba(96,165,250,0.14)", border: "rgba(96,165,250,0.36)",
    shadow: "0 0 18px rgba(96,165,250,0.18)", color: "#60a5fa",
  };
  if (hours <= 0) return {
    pct, label: "Disponível",
    bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.28)",
    shadow: "none", color: "#94a3b8",
  };
  if (hours <= cap * 0.5) return {
    pct, label: "Ocupado",
    bg: "rgba(250,204,21,0.15)", border: "rgba(250,204,21,0.38)",
    shadow: "0 0 20px rgba(250,204,21,0.20)", color: "#facc15",
  };
  if (hours < cap) return {
    pct, label: "M. ocupado",
    bg: "rgba(251,146,60,0.16)", border: "rgba(251,146,60,0.38)",
    shadow: "0 0 24px rgba(251,146,60,0.24)", color: "#fb923c",
  };
  return {
    pct, label: "No limite",
    bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.42)",
    shadow: "0 0 28px rgba(239,68,68,0.30)", color: "#ef4444",
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgendaGeral() {
  usePageTitle("Agenda Geral");
  const { openTask } = useTaskModal();
  const { user } = useAuth();
  const isSupervisor  = user?.role === "admin" || user?.role === "supervisor";
  const isCoordinator = user?.role === "admin" || user?.role === "coordinator";

  const [rows,    setRows]    = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [escalaOpen, setEscalaOpen] = useState(false);

  // ── Feriados ──────────────────────────────────────────────────────────────
  const [holidays,    setHolidays]    = useState<string[]>([]);
  const [newHoliday,  setNewHoliday]  = useState("");
  const [savingHols,  setSavingHols]  = useState(false);

  useEffect(() => {
    apiFetch<{ holidays: string[] }>("/api/calendar-config")
      .then(r => setHolidays(r.holidays))
      .catch(() => {});
  }, []);

  const saveHolidays = async (next: string[]) => {
    setSavingHols(true);
    try {
      const r = await apiPut<{ holidays: string[] }>("/api/calendar-config", { holidays: next });
      setHolidays(r.holidays);
    } catch { toast.error("Erro ao salvar feriados"); }
    finally { setSavingHols(false); }
  };

  const addHoliday = () => {
    if (!newHoliday) return;
    if (holidays.includes(newHoliday)) { toast("Data já cadastrada"); return; }
    saveHolidays([...holidays, newHoliday]);
    setNewHoliday("");
  };

  const removeHoliday = (date: string) => saveHolidays(holidays.filter(h => h !== date));

  // ── Drag-to-create ────────────────────────────────────────────────────────
  const dragRef    = useRef<{ editorId: number; startIdx: number; endIdx: number; moved: boolean } | null>(null);
  const weekDaysRef = useRef<Date[]>([]);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRange, setDragRange] = useState<{ editorId: number; min: number; max: number } | null>(null);
  const [formOpen,   setFormOpen]   = useState(false);
  const [formInitial, setFormInitial] = useState<{ editorId: number; startDate: string; dueDate: string } | null>(null);

  // ── Expanded editor row ───────────────────────────────────────────────────
  const [expandedEditorId, setExpandedEditorId] = useState<number | null>(null);

  // Horários do algoritmo ESCALA: início 08:00, fim 18:00 seg-sex / 13:00 sáb
  const escalaStart = (d: Date) => `${toDateStr(d)}T08:00`;
  const escalaEnd   = (d: Date) => `${toDateStr(d)}T${d.getDay() === 6 ? "13:00" : "18:00"}`;

  // Listener global de mouseup — registrado uma vez
  useEffect(() => {
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const wd  = weekDaysRef.current;
      const min = Math.min(d.startIdx, d.endIdx);
      const max = Math.max(d.startIdx, d.endIdx);
      setFormInitial({ editorId: d.editorId, startDate: escalaStart(wd[min]), dueDate: escalaEnd(wd[max]) });
      setFormOpen(true);
      dragRef.current = null;
      setDragRange(null);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const handleCellMouseDown = (editorId: number, di: number, disabled: boolean) => {
    if (disabled) return;
    dragRef.current = { editorId, startIdx: di, endIdx: di, moved: false };
    setDragRange({ editorId, min: di, max: di });
  };

  const handleCellMouseEnter = (editorId: number, di: number, disabled: boolean) => {
    if (!dragRef.current || dragRef.current.editorId !== editorId) return;
    if (disabled) return; // não estende o range para células bloqueadas
    dragRef.current.endIdx = di;
    dragRef.current.moved  = dragRef.current.startIdx !== di;
    setDragRange({ editorId, min: Math.min(dragRef.current.startIdx, di), max: Math.max(dragRef.current.startIdx, di) });
  };

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<EditorRow[]>("/api/agenda")
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  const today     = useMemo(() => d0(new Date()), []);
  const weekStart = useMemo(() => addDays(toMonday(today), weekOffset * 7), [today, weekOffset]);
  const weekDays  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  useEffect(() => { weekDaysRef.current = weekDays; }, [weekDays]);

  const monthLabel = useMemo(() => {
    const months = new Set(weekDays.map(d => d.getMonth()));
    if (months.size === 1) return `${MON_PT[weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`;
    return weekDays.map(d => MON_PT[d.getMonth()]).filter((v, i, a) => a.indexOf(v) === i).join(" / ")
      + ` ${weekDays[0].getFullYear()}`;
  }, [weekDays]);

  const editorData = useMemo(() => {
    const weekStartStr = toDateStr(weekDays[0]);
    const weekEndStr   = toDateStr(weekDays[6]);
    return rows.map(row => {
      const allocs = row.allocations ?? [];
      // IDs de tarefas v2 com alocação em algum dia desta semana
      const weekAllocIds = new Set(
        allocs
          .filter(a => a.workDate >= weekStartStr && a.workDate <= weekEndStr && (a.allocatedHours ?? 0) > 0)
          .map(a => a.taskId)
      );
      // Tarefas visíveis nesta semana: identificadas pelas alocações
      const weekTasks = row.tasks.filter(t => {
        if (t.effortHours != null) return weekAllocIds.has(t.id);
        const s = t.startDate?.split("T")[0];
        const e = t.dueDate?.split("T")[0];
        if (s && s > weekEndStr)   return false;
        if (e && e < weekStartStr) return false;
        return true;
      });
      return {
        ...row,
        weekTasks,
        scores:       weekDays.map(d => dayHours(row.tasks, allocs, d)),
        caps:         weekDays.map(d => dailyCap(d.getDay())),
        reviewCounts: weekDays.map(d => dayReviewCount(row.tasks, d)),
        timeRanges:   weekDays.map(d => dayTimeRange(allocs, d)),
      };
    });
  }, [rows, weekDays]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 shrink-0">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">Agenda Geral</h1>
          <p className="text-xs sm:text-sm text-[hsl(var(--muted-foreground))]">
            Planejamento semanal da equipe de edição
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} className="text-xs h-8">
            Hoje
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold min-w-[110px] sm:min-w-[130px] text-center">{monthLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Planejar com ESCALA — somente coordinator/admin */}
          {isCoordinator && (
            <button
              onClick={() => setEscalaOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border transition-all shrink-0"
              style={{ background: "hsl(var(--primary)/0.08)", borderColor: "hsl(var(--primary)/0.3)", color: "hsl(var(--primary))" }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Planejar com ESCALA
            </button>
          )}

          {/* Configuração de feriados — somente supervisor/admin */}
          {isSupervisor && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 ml-2 text-xs">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Feriados
                  {holidays.length > 0 && (
                    <span className="ml-0.5 h-4 w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {holidays.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
                  Dias não úteis / Feriados
                </p>

                {/* Lista de feriados */}
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {holidays.length === 0 && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] py-1">Nenhum feriado cadastrado.</p>
                  )}
                  {holidays.map(h => {
                    const [y, m, d] = h.split("-");
                    return (
                      <div key={h} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[hsl(var(--muted))]/40">
                        <span className="text-sm font-medium tabular-nums">{d}/{m}/{y}</span>
                        <button onClick={() => removeHoliday(h)} disabled={savingHols}
                          className="text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Adicionar feriado */}
                <div className="flex gap-2 pt-1 border-t border-[hsl(var(--border))]">
                  <input
                    type="date"
                    value={newHoliday}
                    onChange={e => setNewHoliday(e.target.value)}
                    className="flex-1 h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-sm"
                  />
                  <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={addHoliday} disabled={!newHoliday || savingHols}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Heatmap panel */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 sm:px-6 pb-6">
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.02)",
          }}
        >

          {/* Column headers */}
          <div
            className="grid sticky top-0 z-20"
            style={{
              gridTemplateColumns: "clamp(44px, 14vw, 200px) repeat(7, minmax(0, 1fr))",
              background: "hsl(var(--muted) / 0.25)",
              borderBottom: "1px solid hsl(var(--border))",
            }}
          >
            <div className="px-1.5 sm:px-4 py-3 flex items-end">
              <span className="hidden sm:block text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">
                Editor
              </span>
            </div>
            {weekDays.map((d, i) => {
              const isToday     = diffDays(today, d) === 0;
              const isSundayH   = d.getDay() === 0;
              const isSaturdayH = d.getDay() === 6;
              const isHolidayH  = holidays.includes(toDateStr(d));
              const isDimH      = isSundayH || isHolidayH;
              return (
                <div
                  key={i}
                  className="py-3 text-center"
                  style={isDimH ? { background: "hsl(var(--muted) / 0.18)" } : isSaturdayH ? { background: "hsl(var(--muted) / 0.06)" } : {}}
                >
                  <div
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: isDimH ? "hsl(var(--muted-foreground) / 0.3)" : "hsl(var(--muted-foreground) / 0.5)" }}
                  >
                    {WEEK_DAYS[i]}{isSaturdayH ? " ½" : ""}{isHolidayH ? " F" : ""}
                  </div>
                  <div
                    className="text-[13px] font-bold mt-1"
                    style={{ color: isToday ? "hsl(var(--primary))" : isDimH ? "hsl(var(--muted-foreground) / 0.3)" : "hsl(var(--muted-foreground) / 0.55)" }}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Loading */}
          {loading && (
            <div className="py-20 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Carregando...
            </div>
          )}

          {/* Editor rows */}
          {!loading && editorData.map(({ editor, tasks, weekTasks, allocations, scores, caps, reviewCounts, timeRanges }) => (
            <div
              key={editor.id}
              className="grid"
              style={{
                gridTemplateColumns: "clamp(44px, 14vw, 200px) repeat(7, minmax(0, 1fr))",
                borderTop: "1px solid hsl(var(--border) / 0.4)",
              }}
            >
              {/* Editor sidebar — clique expande lista de tarefas */}
              <div
                className="flex items-center gap-1 sm:gap-2.5 px-1.5 sm:px-3 py-[5px] cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/35 select-none min-w-0"
                onClick={() => setExpandedEditorId(id => id === editor.id ? null : editor.id)}
              >
                <ChevronDown
                  className="shrink-0 transition-transform duration-200"
                  style={{
                    width: 11, height: 11,
                    color: "hsl(var(--muted-foreground) / 0.5)",
                    transform: expandedEditorId === editor.id ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                />
                <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={24} className="shrink-0" />
                <span className="hidden sm:block text-[12px] font-semibold truncate leading-snug min-w-0">
                  {editor.name.split(" ")[0]}
                </span>
              </div>

              {/* Day heat slots */}
              {scores.map((sc, di) => {
                const cap        = caps[di];
                const cfg        = slotConfig(sc, cap, reviewCounts[di]);
                const dow        = weekDays[di].getDay(); // 0=Dom, 6=Sáb
                const isSunday   = dow === 0;
                const isSaturday = dow === 6;
                const isHoliday  = holidays.includes(toDateStr(weekDays[di]));
                const tasksOnDay = dayTasks(tasks, allocations ?? [], weekDays[di]);
                const timeRange  = timeRanges[di];
                const popKey     = `${editor.id}-${di}`;
                const isInDrag   = dragRange?.editorId === editor.id && di >= dragRange.min && di <= dragRange.max;
                const isPast     = weekDays[di] < today;
                const isAtLimit  = cap > 0 && sc >= cap;
                const disabled   = isPast || isAtLimit || isSunday || isHoliday;
                return (
                  <div
                    key={di}
                    className="p-[2px] sm:p-[4px]"
                    style={(isSunday || isHoliday) ? { background: "hsl(var(--muted) / 0.12)" } : isSaturday ? { background: "hsl(var(--muted) / 0.04)" } : {}}
                  >
                    <div
                      className={`group relative w-full select-none transition-all duration-150 ${disabled ? "" : "hover:scale-[0.97]"}`}
                      style={{
                        height: "clamp(52px, 8vw, 72px)",
                        borderRadius: 7,
                        background: isInDrag
                          ? "rgba(96,165,250,0.25)"
                          : (isSunday || isHoliday)
                            ? "rgba(100,116,139,0.07)"
                            : cfg.bg,
                        border: isInDrag
                          ? "2px solid rgba(96,165,250,0.7)"
                          : (isSunday || isHoliday)
                            ? "1px solid rgba(100,116,139,0.14)"
                            : `1px solid ${cfg.border}`,
                        boxShadow: (isSunday || isHoliday) ? "none" : isInDrag ? "0 0 0 2px rgba(96,165,250,0.15)" : cfg.shadow,
                        cursor: dragRef.current ? "crosshair" : disabled ? "default" : "pointer",
                        opacity: isPast ? 0.38 : 1,
                      }}
                      onMouseDown={e => { e.preventDefault(); handleCellMouseDown(editor.id, di, disabled); }}
                      onMouseEnter={() => handleCellMouseEnter(editor.id, di, disabled)}
                      onTouchStart={e => { touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                      onTouchEnd={e => {
                        if (!touchStartRef.current || disabled) return;
                        const dx = Math.abs(e.changedTouches[0].clientX - touchStartRef.current.x);
                        const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);
                        if (dx < 10 && dy < 10) {
                          e.preventDefault();
                          setFormInitial({ editorId: editor.id, startDate: escalaStart(weekDays[di]), dueDate: escalaEnd(weekDays[di]) });
                          setFormOpen(true);
                        }
                        touchStartRef.current = null;
                      }}
                    >
                      {/* Hover overlay — mais visível em células vazias/cinzas */}
                      {!disabled && !isInDrag && (
                        <div
                          className="absolute inset-0 rounded-[6px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                          style={{
                            background: sc === 0
                              ? "rgba(148,163,184,0.22)"
                              : "rgba(255,255,255,0.06)",
                            boxShadow: sc === 0
                              ? "inset 0 0 0 1.5px rgba(148,163,184,0.45)"
                              : "inset 0 0 0 1px rgba(255,255,255,0.10)",
                          }}
                        />
                      )}
                      {isPast && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            borderRadius: 6,
                            background: "repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 5px)",
                          }}
                        />
                      )}
                      {isHoliday && !isInDrag && (
                        <div className="absolute top-1.5 right-2 pointer-events-none">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/35">Fer.</span>
                        </div>
                      )}
                      {isAtLimit && !isPast && !isSunday && !isHoliday && !isInDrag && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Lock style={{ width: 18, height: 18, color: "#ef4444", opacity: 0.30 }} strokeWidth={2.5} />
                        </div>
                      )}
                      {!disabled && !isInDrag && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Plus
                            className="opacity-[0.18] group-hover:opacity-50 transition-opacity duration-150"
                            style={{ width: 15, height: 15, color: cfg.color }}
                            strokeWidth={2.5}
                          />
                        </div>
                      )}
                      {/* Horário exato do slot v2 — aparece quando há alocações com startTime/endTime */}
                      {timeRange && sc > 0 && !isSunday && !isHoliday && !isInDrag && (
                        <div className="absolute inset-x-0 top-1.5 flex justify-center pointer-events-none">
                          <span
                            className="hidden sm:block text-[8px] font-semibold tabular-nums leading-none tracking-tight"
                            style={{ color: cfg.color, opacity: 0.85 }}
                          >
                            {timeRange.start}–{timeRange.end}
                          </span>
                        </div>
                      )}
                      {reviewCounts[di] > 0 && sc > 0 && !isSunday && !isHoliday && !isInDrag && (
                        <div
                          className="absolute bottom-0 left-0 right-0 pointer-events-none"
                          style={{ height: 3, borderRadius: "0 0 6px 6px", background: "rgba(96,165,250,0.7)" }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Linha expandida com lista de tarefas */}
              <AnimatePresence initial={false}>
              {expandedEditorId === editor.id && (
                <motion.div
                  key="expanded"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  style={{ gridColumn: "1 / -1", overflow: "hidden", borderTop: "1px solid hsl(var(--border) / 0.35)" }}
                >
                <div className="px-2 sm:px-4 py-3 overflow-x-auto">
                  {weekTasks.length === 0 ? (
                    <p className="text-[12px] py-1" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                      Sem tarefas ativas nesta semana.
                    </p>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr style={{ borderBottom: "1px solid hsl(var(--border) / 0.4)" }}>
                          <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-1.5 w-8 pr-3"
                            style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>#</th>
                          <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-1.5"
                            style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>Tarefa</th>
                          <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-1.5 pl-4 w-44 hidden md:table-cell"
                            style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>Horários esta semana</th>
                          <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-1.5 pl-4 w-28 hidden lg:table-cell"
                            style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>Coordenador</th>
                          <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-1.5 pl-4 w-20"
                            style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekTasks.map((t, idx) => {
                          // Slots desta tarefa na semana atual (apenas v2 com startTime/endTime)
                          const taskSlots = (allocations ?? []).filter(a =>
                            a.taskId === t.id &&
                            a.startTime && a.endTime &&
                            weekDays.some(d => toDateStr(d) === a.workDate)
                          ).sort((a, b) => a.workDate.localeCompare(b.workDate));
                          return (
                          <tr
                            key={t.id}
                            className="cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/30"
                            style={{ borderBottom: "1px solid hsl(var(--border) / 0.18)" }}
                            onClick={() => openTask(t.id)}
                          >
                            <td className="py-1.5 pr-3 text-[11px] tabular-nums"
                              style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                              {idx + 1}
                            </td>
                            <td className="py-1.5 max-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-[10px] font-mono font-bold shrink-0 tabular-nums px-1 py-0.5 rounded"
                                  style={{
                                    color: t.color || "hsl(var(--muted-foreground) / 0.6)",
                                    background: t.color ? `${t.color}1a` : "hsl(var(--muted) / 0.5)",
                                  }}
                                >
                                  {t.taskCode}
                                </span>
                                <span className="text-[12px] font-medium truncate">{t.title}</span>
                                {t.client && (
                                  <span className="text-[11px] shrink-0"
                                    style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                                    · {t.client}
                                  </span>
                                )}
                              </div>
                            </td>
                            {/* Horários da semana para esta tarefa */}
                            <td className="py-1.5 pl-4 hidden md:table-cell">
                              {taskSlots.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {taskSlots.map(s => {
                                    const wd = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][new Date(s.workDate + "T12:00:00").getDay()];
                                    return (
                                      <span key={s.workDate}
                                        className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded tabular-nums"
                                        style={{ background: "hsl(var(--primary)/0.08)", color: "hsl(var(--primary)/0.85)" }}>
                                        <span className="opacity-60">{wd}</span>
                                        {s.startTime}–{s.endTime}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>—</span>
                              )}
                            </td>
                            <td className="py-1.5 pl-4 hidden lg:table-cell">
                              {t.creator ? (
                                <div className="flex items-center gap-1.5">
                                  <AvatarDisplay
                                    name={t.creator.name}
                                    avatarUrl={t.creator.avatarUrl}
                                    size={20}
                                    className="shrink-0"
                                  />
                                  <span className="text-[11px] truncate"
                                    style={{ color: "hsl(var(--muted-foreground) / 0.75)" }}>
                                    {t.creator.name.split(" ")[0]}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px]"
                                  style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>—</span>
                              )}
                            </td>
                            <td className="py-1.5 pl-4">
                              <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                                {STATUS_LABEL[t.status] ?? t.status}
                              </span>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                </motion.div>
              )}
              </AnimatePresence>
            </div>
          ))}

          {/* Empty */}
          {!loading && editorData.length === 0 && (
            <div className="py-20 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Nenhum editor com tarefas ativas.
            </div>
          )}

          {/* Legend */}
          <div
            className="flex flex-wrap items-center gap-5 px-5 py-4"
            style={{ borderTop: "1px solid hsl(var(--border))" }}
          >
            {[
              { color: "#94a3b8", label: "Disponível",    type: "dot" },
              { color: "#60a5fa", label: "Em aprovação",  type: "dot" },
              { color: "#facc15", label: "Ocupado",                  type: "dot" },
              { color: "#fb923c", label: "Muito ocupado (bloq.)", type: "dot" },
              { color: "#ef4444", label: "No limite (bloq.)",     type: "dot" },
              { color: "#60a5fa", label: "Aprovação pendente (+ carga)", type: "bar" },
            ].map(({ color, label, type }) => (
              <div key={label} className="flex items-center gap-2">
                {type === "bar" ? (
                  <div className="w-6 h-1 rounded-full shrink-0" style={{ background: color }} />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                )}
                <span className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Criação via drag — abre ESCALA com editor e data pré-selecionados */}
      <EscalaModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => { setFormOpen(false); load(); }}
        initialEditorId={formInitial?.editorId}
        initialDate={formInitial?.startDate}
      />

      {/* ESCALA — planejamento por slots */}
      <EscalaModal
        open={escalaOpen}
        onClose={() => setEscalaOpen(false)}
        onCreated={load}
      />

    </div>
  );
}

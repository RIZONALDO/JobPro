import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { apiFetch, apiPut } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Lock, CalendarDays, Plus, X, Trash2 } from "lucide-react";
import { TaskFormModal } from "@/components/task-form-modal";
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
  creator: { id: number; name: string; avatarUrl: string | null } | null;
}

interface EditorRow {
  editor: { id: number; name: string; avatarUrl: string | null };
  tasks: AgendaTask[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEEK_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MON_PT    = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const COMPLEXITY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}
function d0(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function diffDays(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }
function toMonday(d: Date): Date { const w = d.getDay(); return addDays(d0(d), w === 0 ? -6 : 1 - w); }

function dayScore(tasks: AgendaTask[], day: Date): number {
  const dayEnd = new Date(day.getTime() + 86_400_000 - 1);
  return tasks.reduce((sum, t) => {
    if (t.status === "review") return sum;
    const startStr = t.startDate?.split("T")[0];
    const endStr   = t.dueDate?.split("T")[0];
    const start = startStr ? d0(parseLocal(startStr)) : null;
    const end   = endStr   ? d0(parseLocal(endStr))   : null;
    const started = !start || start <= dayEnd;
    const notDone = !end   || end   >= day;
    if (started && notDone) return sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6);
    return sum;
  }, 0);
}

function dayReviewCount(tasks: AgendaTask[], day: Date): number {
  const dayEnd = new Date(day.getTime() + 86_400_000 - 1);
  return tasks.filter(t => {
    if (t.status !== "review") return false;
    const startStr = t.startDate?.split("T")[0];
    const endStr   = t.dueDate?.split("T")[0];
    const start = startStr ? d0(parseLocal(startStr)) : null;
    const end   = endStr   ? d0(parseLocal(endStr))   : null;
    return (!start || start <= dayEnd) && (!end || end >= day);
  }).length;
}

function dayTasks(tasks: AgendaTask[], day: Date): AgendaTask[] {
  const dayEnd = new Date(day.getTime() + 86_400_000 - 1);
  return tasks.filter(t => {
    const startStr = t.startDate?.split("T")[0];
    const endStr   = t.dueDate?.split("T")[0];
    const start = startStr ? d0(parseLocal(startStr)) : null;
    const end   = endStr   ? d0(parseLocal(endStr))   : null;
    const started = !start || start <= dayEnd;
    const notDone = !end   || end   >= day;
    return started && notDone;
  });
}

function slotConfig(score: number, reviewCount = 0) {
  const pct = Math.min(100, Math.round((score / 12) * 100));
  if (score === 0 && reviewCount > 0) return {
    pct, label: "Em aprovação",
    bg: "rgba(96,165,250,0.14)", border: "rgba(96,165,250,0.36)",
    shadow: "0 0 18px rgba(96,165,250,0.18)", color: "#60a5fa",
  };
  if (score === 0) return {
    pct, label: "Disponível",
    bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.28)",
    shadow: "none", color: "#94a3b8",
  };
  if (score <= 6) return {
    pct, label: "Ocupado",
    bg: "rgba(250,204,21,0.15)", border: "rgba(250,204,21,0.38)",
    shadow: "0 0 20px rgba(250,204,21,0.20)", color: "#facc15",
  };
  if (score <= 11) return {
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
  const isSupervisor = user?.role === "admin" || user?.role === "supervisor";

  const [rows,    setRows]    = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

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
  const [dragRange, setDragRange] = useState<{ editorId: number; min: number; max: number } | null>(null);
  const [formOpen,   setFormOpen]   = useState(false);
  const [formInitial, setFormInitial] = useState<{ editorId: number; startDate: string; dueDate: string } | null>(null);

  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Início sempre às 08:30; entrega às 13:00 no sábado, 17:30 nos demais dias
  const toStartDT = (d: Date) => `${toDateStr(d)}T08:30`;
  const toDueDT   = (d: Date) => `${toDateStr(d)}T${d.getDay() === 6 ? "13:00" : "17:30"}`;

  // Listener global de mouseup — registrado uma vez
  useEffect(() => {
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const wd  = weekDaysRef.current;
      const min = Math.min(d.startIdx, d.endIdx);
      const max = Math.max(d.startIdx, d.endIdx);
      setFormInitial({ editorId: d.editorId, startDate: toStartDT(wd[min]), dueDate: toDueDT(wd[max]) });
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

  const editorData = useMemo(() =>
    rows.map(row => ({
      ...row,
      scores:       weekDays.map(d => dayScore(row.tasks, d)),
      reviewCounts: weekDays.map(d => dayReviewCount(row.tasks, d)),
    })),
    [rows, weekDays]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Agenda Geral</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Planejamento semanal da equipe de edição
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} className="text-xs">
            Hoje
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[130px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>

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
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
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
              gridTemplateColumns: "200px repeat(7, 1fr)",
              background: "hsl(var(--muted) / 0.25)",
              borderBottom: "1px solid hsl(var(--border))",
            }}
          >
            <div className="px-4 py-3 flex items-end">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">
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
          {!loading && editorData.map(({ editor, tasks, scores, reviewCounts }) => (
            <div
              key={editor.id}
              className="grid"
              style={{
                gridTemplateColumns: "200px repeat(7, 1fr)",
                borderTop: "1px solid hsl(var(--border) / 0.4)",
              }}
            >
              {/* Editor sidebar */}
              <div className="flex items-center gap-3 px-4 py-[5px]">
                <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={30} className="shrink-0" />
                <span className="text-[12px] font-semibold truncate leading-snug">
                  {editor.name.split(" ")[0]}
                </span>
              </div>

              {/* Day heat slots */}
              {scores.map((sc, di) => {
                const cfg        = slotConfig(sc, reviewCounts[di]);
                const dow        = weekDays[di].getDay(); // 0=Dom, 6=Sáb
                const isSunday   = dow === 0;
                const isSaturday = dow === 6;
                const isHoliday  = holidays.includes(toDateStr(weekDays[di]));
                const tasksOnDay = dayTasks(tasks, weekDays[di]);
                const popKey     = `${editor.id}-${di}`;
                const isInDrag   = dragRange?.editorId === editor.id && di >= dragRange.min && di <= dragRange.max;
                const isPast     = weekDays[di] < today;
                const isAtLimit  = sc >= 12;
                const disabled   = isPast || isAtLimit || isSunday || isHoliday;
                return (
                  <div
                    key={di}
                    className="p-[4px]"
                    style={(isSunday || isHoliday) ? { background: "hsl(var(--muted) / 0.12)" } : isSaturday ? { background: "hsl(var(--muted) / 0.04)" } : {}}
                  >
                    <div
                      className={`relative w-full select-none transition-all duration-200 ${disabled ? "" : "hover:brightness-110"}`}
                      style={{
                        height: 72,
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
                    >
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
              { color: "#facc15", label: "Ocupado",       type: "dot" },
              { color: "#fb923c", label: "Muito ocupado", type: "dot" },
              { color: "#ef4444", label: "No limite",     type: "dot" },
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

      {/* Modal de criação via drag */}
      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => { setFormOpen(false); load(); }}
        initialEditorId={formInitial?.editorId}
        initialStartDate={formInitial?.startDate}
        initialDueDate={formInitial?.dueDate}
      />
    </div>
  );
}

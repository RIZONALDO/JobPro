import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, Lock, Plus } from "lucide-react";
import { TaskFormModal } from "@/components/task-form-modal";

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

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

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

  const [rows,    setRows]    = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<EditorRow[]>("/api/agenda")
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  // ── Drag-to-create ─────────────────────────────────────────────────────────
  type DragState = { editorId: number; start: number; end: number };
  const dragRef    = useRef<DragState | null>(null);
  const weekDaysRef = useRef<Date[]>([]);
  const [drag,      setDrag]      = useState<DragState | null>(null);
  const [formOpen,  setFormOpen]  = useState(false);
  const [formPreset, setFormPreset] = useState<{ editorId: number; startDate: string; dueDate: string } | null>(null);

  // Global mouseup — finaliza o drag onde quer que o mouse solte
  useEffect(() => {
    const endDrag = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDrag(null);
      const s = Math.min(d.start, d.end);
      const e = Math.max(d.start, d.end);
      const days = weekDaysRef.current;
      setFormPreset({ editorId: d.editorId, startDate: toISO(days[s]), dueDate: toISO(days[e]) });
      setFormOpen(true);
    };
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
  }, []);

  const startDrag = useCallback((editorId: number, dayIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const d: DragState = { editorId, start: dayIdx, end: dayIdx };
    dragRef.current = d;
    setDrag(d);
  }, []);

  const moveDrag = useCallback((editorId: number, dayIdx: number) => {
    if (!dragRef.current || dragRef.current.editorId !== editorId) return;
    const d: DragState = { ...dragRef.current, end: dayIdx };
    dragRef.current = d;
    setDrag(d);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────

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

  const [expandedEditors, setExpandedEditors] = useState<Set<number>>(new Set());
  const toggleEditor = (id: number) =>
    setExpandedEditors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const STATUS_LABEL: Record<string, string> = {
    pending: "Na fila", in_progress: "Em edição", captacao: "Falta captação",
    in_revision: "Em alteração", review: "Em aprovação", completed: "Aprovada",
    paused: "Pausada", cancelled: "Cancelada",
  };
  const STATUS_COLOR: Record<string, string> = {
    pending: "text-slate-400", in_progress: "text-blue-400", captacao: "text-violet-400",
    in_revision: "text-orange-400", review: "text-amber-400", completed: "text-emerald-400",
    paused: "text-violet-400", cancelled: "text-red-400",
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
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
              const isToday = diffDays(today, d) === 0;
              const isWkend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={i}
                  className="py-3 text-center"
                  style={isWkend ? { background: "hsl(var(--muted) / 0.15)" } : {}}
                >
                  <div
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
                  >
                    {WEEK_DAYS[i]}
                  </div>
                  <div
                    className="text-[13px] font-bold mt-1"
                    style={{ color: isToday ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.55)" }}
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
          {!loading && editorData.map(({ editor, tasks, scores, reviewCounts }) => {
            const isExpanded = expandedEditors.has(editor.id);
            const activeTasks = tasks.filter(t => !["completed","cancelled"].includes(t.status));
            return (
            <div key={editor.id} style={{ borderTop: "1px solid hsl(var(--border) / 0.4)" }}>
              <div
                className="grid"
                style={{ gridTemplateColumns: "200px repeat(7, 1fr)" }}
              >
              {/* Editor sidebar */}
              <div className="flex items-center gap-2 px-3 py-[5px]">
                <button
                  onClick={() => toggleEditor(editor.id)}
                  className="shrink-0 flex items-center justify-center w-5 h-5 rounded hover:bg-[hsl(var(--muted))]/40 transition-colors"
                >
                  <ChevronDown className={`h-3 w-3 text-[hsl(var(--muted-foreground))]/50 transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`} />
                </button>
                <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={28} className="shrink-0" />
                <span className="text-[12px] font-semibold truncate leading-snug">
                  {editor.name.split(" ")[0]}
                </span>
                {activeTasks.length > 0 && (
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-[hsl(var(--muted-foreground))]/40">
                    {activeTasks.length}
                  </span>
                )}
              </div>

              {/* Day heat slots */}
              {scores.map((sc, di) => {
                const cfg     = slotConfig(sc, reviewCounts[di]);
                const isWkend = weekDays[di].getDay() === 0 || weekDays[di].getDay() === 6;
                const tasksOnDay = dayTasks(tasks, weekDays[di]);
                const isDragSelected = drag !== null && drag.editorId === editor.id &&
                  di >= Math.min(drag.start, drag.end) && di <= Math.max(drag.start, drag.end);
                const isDraggingRow = drag !== null && drag.editorId === editor.id;
                return (
                  <div
                    key={di}
                    className="p-[4px]"
                    style={isWkend ? { background: "hsl(var(--muted) / 0.07)" } : {}}
                    onMouseDown={e => { if (sc < 12) startDrag(editor.id, di, e); }}
                    onMouseEnter={() => moveDrag(editor.id, di)}
                  >
                    <div
                      className={`relative w-full select-none transition-all duration-200 ${sc < 12 && !drag ? "hover:scale-[1.03] hover:brightness-110" : ""}`}
                      style={{
                        height: 72,
                        borderRadius: 7,
                        background: isDragSelected ? "rgba(255,255,255,0.09)" : cfg.bg,
                        border: isDragSelected ? "1.5px solid rgba(255,255,255,0.28)" : `1px solid ${cfg.border}`,
                        boxShadow: isDragSelected ? "0 0 12px rgba(255,255,255,0.06)" : cfg.shadow,
                        cursor: isDraggingRow ? "col-resize" : "default",
                        transform: isDragSelected ? "scaleY(1.04)" : undefined,
                      }}
                    >
                      {sc >= 12 && !isDragSelected && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Lock style={{ width: 18, height: 18, color: "#ef4444", opacity: 0.30 }} strokeWidth={2.5} />
                        </div>
                      )}
                      {sc < 12 && !isDragSelected && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Plus style={{ width: 15, height: 15, color: cfg.color, opacity: 0.30 }} strokeWidth={2} />
                        </div>
                      )}
                      {isDragSelected && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Plus style={{ width: 16, height: 16, color: "rgba(255,255,255,0.55)" }} strokeWidth={2} />
                        </div>
                      )}

                    </div>
                  </div>
                );
              })}
              </div>{/* fim grid */}

              {/* Lista colapsável de tarefas */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid hsl(var(--border) / 0.3)", background: "hsl(var(--muted) / 0.06)" }}>
                  {activeTasks.length === 0 ? (
                    <p className="px-6 py-3 text-[12px] text-[hsl(var(--muted-foreground))]/40 italic">Nenhuma tarefa ativa</p>
                  ) : (
                    <div className="divide-y divide-[hsl(var(--border))]/20">
                      {activeTasks.map(t => (
                        <div key={t.id} className="flex items-center gap-3 px-6 py-2.5">
                          <span className="font-mono text-[11px] font-bold shrink-0" style={{ color: t.color || "hsl(var(--muted-foreground))" }}>
                            {t.taskCode}
                          </span>
                          <span className="text-[12px] truncate flex-1 min-w-0 text-[hsl(var(--foreground))]/80">
                            {t.title}
                          </span>
                          {t.client && (
                            <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 shrink-0 hidden sm:block">
                              {t.client}
                            </span>
                          )}
                          <span className={`text-[11px] font-medium shrink-0 ${STATUS_COLOR[t.status] ?? "text-[hsl(var(--muted-foreground))]"}`}>
                            {STATUS_LABEL[t.status] ?? t.status}
                          </span>
                          {t.dueDate && (
                            <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]/40 shrink-0">
                              {t.dueDate.split("T")[0].split("-").reverse().slice(0,2).join("/")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}

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
              { color: "#94a3b8", label: "Disponível" },
              { color: "#60a5fa", label: "Em aprovação" },
              { color: "#facc15", label: "Ocupado" },
              { color: "#fb923c", label: "Muito ocupado" },
              { color: "#ef4444", label: "No limite" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>

    {formOpen && formPreset && (
      <TaskFormModal
        open={formOpen}
        onOpenChange={v => { if (!v) { setFormOpen(false); setFormPreset(null); } }}
        editTaskId={null}
        initialStartDate={formPreset.startDate}
        initialDueDate={formPreset.dueDate}
        initialEditorId={formPreset.editorId}
        readOnlyDates
        onSaved={() => { setFormOpen(false); setFormPreset(null); load(); }}
      />
    )}
    </>
  );
}

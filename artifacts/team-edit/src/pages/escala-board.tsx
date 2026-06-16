import { useEffect, useState, useMemo, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, apiPut } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, CalendarDays, Plus, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AgendaTask {
  id:          number;
  taskCode:    string;
  title:       string;
  status:      string;
  color:       string;
  client:      string | null;
  dueDate:     string | null;
  effortHours: number | null;
}

interface AllocRow {
  taskId:         number;
  workDate:       string;
  allocatedHours: number | null;
  startTime:      string | null;
  endTime:        string | null;
}

interface EditorRow {
  editor:      { id: number; name: string; avatarUrl: string | null };
  tasks:       AgendaTask[];
  allocations: AllocRow[];
}

type WhoFilter    = "all" | number | null;
type PeriodFilter = "today" | "week" | "8days";

// ── Utilitários ───────────────────────────────────────────────────────────────

const WEEK_PT  = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const MON_PT   = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const MON_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function d0(d: Date): Date { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDate(s: string): Date {
  const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d);
}
function isSat(d: Date | string): boolean {
  return (typeof d === "string" ? parseDate(d) : d).getDay() === 6;
}
function dayCapacity(ds: string): number { return isSat(ds) ? 5 : 8; }
function fmtTime(t: string): string {
  const [h,m] = t.split(":").map(Number);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2,"0")}`;
}
function fmtRange(s: string, e: string) { return `${fmtTime(s)}–${fmtTime(e)}`; }
function fmtHours(h: number): string {
  if (h <= 0) return "0h";
  if (h < 1) return `${Math.round(h * 60)}min`;
  const full = Math.floor(h);
  const mins = Math.round((h - full) * 60);
  return mins > 0 ? `${full}h${String(mins).padStart(2,"0")}` : `${full}h`;
}

const TODAY_OBJ = d0(new Date());
const TODAY_STR = toDateStr(TODAY_OBJ);
const TOMORROW  = toDateStr(addDays(TODAY_OBJ, 1));

function humanDate(dateStr: string): string {
  if (dateStr === TODAY_STR) return "hoje";
  if (dateStr === TOMORROW)  return "amanhã";
  const d = parseDate(dateStr);
  return `${WEEK_PT[d.getDay()]} ${d.getDate()} ${MON_PT[d.getMonth()]}`;
}

function lastAllocation(allocs: AllocRow[]): { dateStr: string; endTime: string | null } | null {
  const future = allocs
    .filter(a => a.workDate >= TODAY_STR && a.allocatedHours)
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
  if (!future.length) return null;
  const lastDate = future[0].workDate;
  const onLast   = future.filter(a => a.workDate === lastDate && a.endTime);
  const lastEnd  = onLast.length
    ? onLast.reduce((mx, a) => a.endTime! > mx ? a.endTime! : mx, onLast[0].endTime!)
    : null;
  return { dateStr: lastDate, endTime: lastEnd };
}

function buildDays(period: PeriodFilter, holidays: string[]): Date[] {
  const days: Date[] = [];
  if (period === "today") {
    return [new Date(TODAY_OBJ)];
  }
  if (period === "week") {
    const dow = TODAY_OBJ.getDay();
    const diffToMon = dow === 0 ? 0 : 1 - dow;
    let d = addDays(TODAY_OBJ, diffToMon < 0 ? 0 : diffToMon);
    const weekStart = new Date(d);
    while (d <= addDays(weekStart, 6)) {
      if (d.getDay() !== 0 && !holidays.includes(toDateStr(d))) days.push(new Date(d));
      d = addDays(d, 1);
    }
    // garante que hoje aparece mesmo que a semana seja no meio
    if (!days.find(x => toDateStr(x) === TODAY_STR)) {
      let d2 = new Date(TODAY_OBJ);
      while (days.length < 5) {
        if (d2.getDay() !== 0 && !holidays.includes(toDateStr(d2))) days.push(new Date(d2));
        d2 = addDays(d2, 1);
      }
      days.sort((a, b) => toDateStr(a).localeCompare(toDateStr(b)));
    }
    return days;
  }
  // 8 days
  let d = new Date(TODAY_OBJ);
  while (days.length < 8) {
    if (d.getDay() !== 0 && !holidays.includes(toDateStr(d))) days.push(new Date(d));
    d = addDays(d, 1);
  }
  return days;
}

// ── Timeline diária ───────────────────────────────────────────────────────────

const PX_PER_HOUR = 38;

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function DayTimeline({
  dateStr,
  allocs,
  tasks,
  overdueTasks,
  onTaskOpen,
}: {
  dateStr:      string;
  allocs:       AllocRow[];
  tasks:        AgendaTask[];
  overdueTasks: AgendaTask[];
  onTaskOpen:   (id: number) => void;
}) {
  const sat       = isSat(dateStr);
  const START_H   = 8;
  const END_H     = sat ? 13 : 18;
  const totalMins = (END_H - START_H) * 60;
  const totalH    = (END_H - START_H) * PX_PER_HOUR;
  const hours     = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

  const blocks = useMemo(() => {
    return allocs
      .filter(a => a.workDate === dateStr && a.allocatedHours && a.startTime && a.endTime)
      .map(a => {
        const startMin = timeToMin(a.startTime!) - START_H * 60;
        const endMin   = timeToMin(a.endTime!)   - START_H * 60;
        const top      = Math.max(0, (startMin / totalMins) * totalH);
        const height   = Math.max(14, ((endMin - startMin) / totalMins) * totalH);
        const task     = tasks.find(t => t.id === a.taskId);
        return { a, task, top, height, durationMin: endMin - startMin };
      })
      .filter(b => b.task != null) as {
        a: AllocRow; task: AgendaTask;
        top: number; height: number; durationMin: number;
      }[];
  }, [allocs, dateStr, tasks, totalH, totalMins]);

  // tarefas sem horário definido
  const unscheduled = useMemo(() =>
    allocs
      .filter(a => a.workDate === dateStr && a.allocatedHours && (!a.startTime || !a.endTime))
      .map(a => tasks.find(t => t.id === a.taskId))
      .filter(Boolean) as AgendaTask[],
  [allocs, dateStr, tasks]);

  const showOverdue = dateStr === TODAY_STR && overdueTasks.length > 0;

  return (
    <div className="px-3 py-2">

      {/* ── Atrasadas (só em "Hoje") ── */}
      {showOverdue && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mb-3 rounded-xl overflow-hidden"
          style={{ border: "1px dashed #fca5a5", background: "#fef2f2" }}
        >
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-widest text-red-400">
              {overdueTasks.length === 1 ? "1 tarefa atrasada" : `${overdueTasks.length} tarefas atrasadas`}
            </span>
          </div>
          <div className="pb-2">
            {overdueTasks.map((t, i) => (
              <motion.button
                key={t.id}
                onClick={() => onTaskOpen(t.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                whileHover={{ background: "#fee2e2" }}
                whileTap={{ scale: 0.98 }}
                style={{ borderTop: i > 0 ? "1px solid #fecaca" : "none" }}
              >
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
                <span className="text-[10px] font-bold shrink-0" style={{ color: t.color }}>{t.taskCode}</span>
                <span className="text-[11px] font-medium truncate flex-1" style={{ color: "#dc2626" }}>{t.title}</span>
                <span className="text-[9px] shrink-0 font-bold text-red-400">atrasada</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      <div className="flex gap-0">
        {/* Coluna de horas */}
        <div className="shrink-0 select-none" style={{ width: 26 }}>
          {hours.map(h => (
            <div key={h} style={{ height: h === END_H ? 0 : PX_PER_HOUR, position: "relative" }}>
              <span className="absolute top-0 right-1 text-[8px] tabular-nums leading-none"
                style={{ color: "hsl(var(--muted-foreground)/0.35)", transform: "translateY(-50%)" }}>
                {h}h
              </span>
            </div>
          ))}
        </div>

        {/* Área de timeline */}
        <div className="relative flex-1" style={{ height: totalH }}>
          {/* Gridlines por hora */}
          {hours.map(h => (
            <div key={h} style={{
              position: "absolute",
              top:   ((h - START_H) / (END_H - START_H)) * totalH,
              left:  0, right: 0, height: 1,
              background: "hsl(var(--border)/0.25)",
            }} />
          ))}

          {/* Gridlines meia-hora (mais sutis) */}
          {hours.slice(0, -1).map(h => (
            <div key={`${h}.5`} style={{
              position: "absolute",
              top:   ((h - START_H + 0.5) / (END_H - START_H)) * totalH,
              left:  0, right: 0, height: 1,
              background: "hsl(var(--border)/0.10)",
              borderTop: "1px dashed hsl(var(--border)/0.15)",
            }} />
          ))}

          {/* Blocos de tarefas */}
          {blocks.map((b, i) => {
            const small = b.durationMin < 45;
            return (
              <motion.button
                key={i}
                data-task-id={b.task.id}
                onClick={() => onTaskOpen(b.task.id)}
                title={`${b.task.taskCode} — ${b.task.title}`}
                initial={{ opacity: 0, scaleY: 0.85 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: 0.22, delay: i * 0.04, ease: "easeOut" }}
                whileHover={{ scale: 1.015, filter: "brightness(1.1)" }}
                whileTap={{ scale: 0.98 }}
                style={{
                  position:    "absolute",
                  top:         b.top + 1,
                  height:      b.height - 2,
                  left:        2, right: 2,
                  borderRadius: 5,
                  borderLeft:  `3px solid ${b.task.color}`,
                  background:  `${b.task.color}1A`,
                  display:     "flex",
                  alignItems:  small ? "center" : "flex-start",
                  gap:         4,
                  padding:     small ? "0 6px" : "3px 6px",
                  overflow:    "hidden",
                  textAlign:   "left",
                  cursor:      "pointer",
                  transformOrigin: "top",
                }}
              >
                <span className="text-[9px] font-black shrink-0 tabular-nums"
                  style={{ color: b.task.color }}>
                  {b.task.taskCode}
                </span>
                {!small && (
                  <span className="text-[10px] font-medium truncate leading-snug"
                    style={{ color: "hsl(var(--foreground)/0.75)" }}>
                    {b.task.title}
                  </span>
                )}
              </motion.button>
            );
          })}

        </div>
      </div>

      {/* Tarefas sem horário */}
      {unscheduled.length > 0 && (
        <div className="mt-2 pt-2 flex flex-wrap gap-1.5"
          style={{ borderTop: "1px dashed hsl(var(--border)/0.25)" }}>
          {unscheduled.map(t => (
            <button key={t.id}
              onClick={() => onTaskOpen(t.id)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
              style={{ background: `${t.color}15`, color: t.color }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              {t.taskCode}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card do editor ────────────────────────────────────────────────────────────

function EditorCard({
  row,
  days,
  onTaskOpen,
  initialTab,
}: {
  row:         EditorRow;
  days:        Date[];
  onTaskOpen:  (id: number) => void;
  initialTab?: string;
}) {
  const [activeTab, setActiveTab] = useState<"info" | string>(initialTab ?? "info");

  const last = useMemo(() => lastAllocation(row.allocations), [row.allocations]);

  const freeColor = !last ? "#10b981"
    : last.dateStr <= TOMORROW ? "#f59e0b"
    : "hsl(var(--muted-foreground)/0.60)";

  const queueCount = useMemo(() => {
    const ids = new Set(
      row.allocations
        .filter(a => a.workDate >= TODAY_STR && a.allocatedHours)
        .map(a => a.taskId)
    );
    return ids.size;
  }, [row.allocations]);

  const stats = useMemo(() => {
    const horasHoje = row.allocations
      .filter(a => a.workDate === TODAY_STR && a.allocatedHours)
      .reduce((s, a) => s + Number(a.allocatedHours), 0);

    const futureDates = [...new Set(
      row.allocations
        .filter(a => a.workDate >= TODAY_STR && a.allocatedHours)
        .map(a => a.workDate)
    )].sort();
    const proxLivre = futureDates.find(ds => {
      const used = row.allocations
        .filter(a => a.workDate === ds && a.allocatedHours)
        .reduce((s, a) => s + Number(a.allocatedHours), 0);
      return used < dayCapacity(ds);
    }) ?? null;

    return { horasHoje, proxLivre, capHoje: dayCapacity(TODAY_STR) };
  }, [row.allocations]);

  const overdueTasks = useMemo(() => {
    const ids = new Set<number>();
    const result: AgendaTask[] = [];
    row.allocations
      .filter(a => a.workDate < TODAY_STR && a.allocatedHours)
      .forEach(a => {
        if (ids.has(a.taskId)) return;
        const task = row.tasks.find(t => t.id === a.taskId);
        if (task && !["completed", "cancelled"].includes(task.status)) {
          ids.add(a.taskId);
          result.push(task);
        }
      });
    return result;
  }, [row.allocations, row.tasks]);

  const overdueCount = overdueTasks.length;

  function dotColors(ds: string): string[] {
    if (ds === TODAY_STR && overdueCount > 0) {
      return ["#ef4444", ...row.allocations
        .filter(a => a.workDate === ds && a.allocatedHours)
        .slice(0, 2)
        .map(a => row.tasks.find(t => t.id === a.taskId)?.color ?? "hsl(var(--primary))")];
    }
    return row.allocations
      .filter(a => a.workDate === ds && a.allocatedHours)
      .slice(0, 3)
      .map(a => row.tasks.find(t => t.id === a.taskId)?.color ?? "hsl(var(--primary))");
  }

  // se só tem 1 dia (hoje), abre direto nele
  useEffect(() => {
    if (days.length === 1) setActiveTab(toDateStr(days[0]));
  }, [days]);

  const tabIndId = `tab-ind-${row.editor.id}`;

  return (
    <motion.div
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {/* ── Barra de abas ── */}
      <div
        className="flex w-full items-stretch"
        style={{ background: "hsl(var(--muted)/0.30)", borderBottom: "1px solid hsl(var(--border)/0.50)" }}
      >
        {/* Tab 1 — resumo (escondida quando período = hoje) */}
        {days.length > 1 && (
          <>
            <motion.button
              onClick={() => setActiveTab("info")}
              className="flex items-center gap-2 px-3 shrink-0 relative"
              style={{ borderBottom: "2px solid transparent" }}
              whileTap={{ scale: 0.94 }}
            >
              <motion.div whileHover={{ scale: 1.08 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                <AvatarDisplay name={row.editor.name} avatarUrl={row.editor.avatarUrl} size={26} className="shrink-0" />
              </motion.div>
              <div className="text-left">
                <p className="text-[12px] font-black leading-none">{row.editor.name.split(" ")[0]}</p>
                {queueCount > 0 && (
                  <p className="text-[9px] leading-none mt-0.5 tabular-nums" style={{ color: freeColor }}>
                    {queueCount} {queueCount === 1 ? "tarefa" : "tarefas"}
                  </p>
                )}
              </div>
            </motion.button>
            <div className="w-px self-stretch my-1.5 shrink-0" style={{ background: "hsl(var(--border)/0.50)" }} />
          </>
        )}

        {/* Abas de dia */}
        {days.map(d => {
          const ds      = toDateStr(d);
          const isToday = ds === TODAY_STR;
          const active  = activeTab === ds;
          const dots    = dotColors(ds);

          return (
            <motion.button
              key={ds}
              data-date={ds}
              onClick={() => setActiveTab(ds)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative"
              style={{
                minWidth:   0,
                background: active ? "hsl(var(--card))" : isToday ? "hsl(var(--primary)/0.07)" : "transparent",
              }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
            >
              <span className="text-[8px] font-black uppercase tracking-wide leading-none"
                style={{
                  color: active ? "hsl(var(--primary))"
                    : isToday ? "hsl(var(--primary)/0.65)"
                    : "hsl(var(--muted-foreground)/0.45)",
                }}>
                {isToday ? "HOJE" : WEEK_PT[d.getDay()]}
              </span>
              <span className="text-[13px] font-black tabular-nums leading-none"
                style={{
                  color: active ? "hsl(var(--primary))"
                    : isToday ? "hsl(var(--foreground))"
                    : "hsl(var(--foreground)/0.55)",
                }}>
                {d.getDate()}
              </span>
              <div className="flex gap-[3px] items-center" style={{ minHeight: 5 }}>
                {dots.map((c, i) => (
                  <div key={i} style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: c, opacity: active ? 1 : 0.45,
                  }} />
                ))}
              </div>
              {/* indicador deslizante */}
              {active && (
                <motion.div
                  layoutId={tabIndId}
                  className="absolute bottom-0 left-0 right-0"
                  style={{ height: 2, background: "hsl(var(--primary))", borderRadius: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
            </motion.button>
          );
        })}

        {/* Nome do editor quando período = hoje */}
        {days.length === 1 && (
          <div className="flex items-center gap-2 px-3 ml-auto">
            <AvatarDisplay name={row.editor.name} avatarUrl={row.editor.avatarUrl} size={22} className="shrink-0" />
            <span className="text-[12px] font-black">{row.editor.name.split(" ")[0]}</span>
          </div>
        )}
      </div>

      {/* ── Conteúdo com AnimatePresence ── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{ minHeight: 44 }}
        >
          {activeTab === "info" ? (
            <div className="px-4 py-3">
              {(() => {
                const livreAgora = !last;
                const livreHoje  = stats.horasHoje < stats.capHoje;
                const proxLabel  = stats.proxLivre ? humanDate(stats.proxLivre) : null;

                let frase: string;
                let cor: string;

                if (livreAgora || (livreHoje && queueCount === 0)) {
                  frase = "Disponível — sem tarefas agendadas";
                  cor   = "#16a34a";
                } else if (livreHoje && queueCount > 0) {
                  frase = `Disponível hoje · ${queueCount} ${queueCount === 1 ? "tarefa" : "tarefas"} na fila`;
                  cor   = "#ca8a04";
                } else if (proxLabel) {
                  frase = queueCount > 0
                    ? `Ocupado — próximo espaço ${proxLabel} · ${queueCount} ${queueCount === 1 ? "tarefa" : "tarefas"} na fila`
                    : `Ocupado — próximo espaço ${proxLabel}`;
                  cor   = "#f97316";
                } else {
                  frase = queueCount > 0
                    ? `${queueCount} ${queueCount === 1 ? "tarefa" : "tarefas"} na fila`
                    : "Sem atividade agendada";
                  cor   = "hsl(var(--muted-foreground))";
                }

                return (
                <div className="flex flex-col gap-1">
                  {overdueCount > 0 && (
                    <span className="text-[11px] font-bold" style={{ color: "#ef4444" }}>
                      ⚠ {overdueCount} {overdueCount === 1 ? "tarefa atrasada" : "tarefas atrasadas"}
                    </span>
                  )}
                  <span className="text-[12px] font-semibold" style={{ color: cor }}>
                    {frase}
                  </span>
                </div>
              );
              })()}
            </div>
          ) : (
            <DayTimeline
              dateStr={activeTab}
              allocs={row.allocations}
              tasks={row.tasks}
              overdueTasks={overdueTasks}
              onTaskOpen={onTaskOpen}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function EscalaBoard() {
  usePageTitle("Grade");
  const [, navigate]  = useLocation();
  const search        = useSearch();
  const { openTask }  = useTaskModal();
  const { user }      = useAuth();
  const isCoordinator = user?.role === "admin" || user?.role === "coordinator";
  const isSupervisor  = user?.role === "admin" || user?.role === "supervisor";

  const [rows,       setRows]       = useState<EditorRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [holidays,   setHolidays]   = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [savingHols, setSavingHols] = useState(false);

  // Params vindos do Planejar após criação: ?editor=X&date=YYYY-MM-DD&task=ID
  const urlParams    = new URLSearchParams(search);
  const urlEditor    = urlParams.get("editor");
  const urlDate      = urlParams.get("date");
  const urlTask      = urlParams.get("task");

  const [whoFilter, setWhoFilter] = useState<WhoFilter>(() => {
    if (urlEditor) return Number(urlEditor) as WhoFilter;
    const v = localStorage.getItem("escala:who");
    if (!v || v === "null") return null;
    if (v === "all") return "all";
    return Number(v) as WhoFilter;
  });
  const [period, setPeriod] = useState<PeriodFilter>(() => {
    if (urlEditor) return "8days";
    const v = localStorage.getItem("escala:period");
    return (v === "today" || v === "week" || v === "8days" ? v : "8days") as PeriodFilter;
  });

  // Limpa os params da URL sem recarregar (evita que refresh reaplique)
  useEffect(() => {
    if (urlEditor) navigate("/agenda", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { localStorage.setItem("escala:who",    String(whoFilter)); }, [whoFilter]);
  useEffect(() => { localStorage.setItem("escala:period", period);            }, [period]);

  const load = useCallback(() => {
    apiFetch<EditorRow[]>("/api/agenda")
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  // Revela a tarefa recém-criada: scroll até o bloco e pisca
  useEffect(() => {
    if (!urlTask || loading) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${urlTask}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      // Pisca 3x com brilho
      let count = 0;
      const interval = setInterval(() => {
        el.style.filter = count % 2 === 0 ? "brightness(1.6)" : "brightness(1)";
        count++;
        if (count >= 6) { clearInterval(interval); el.style.filter = ""; }
      }, 200);
    }, 500);
  }, [urlTask, loading]);

  useEffect(() => {
    apiFetch<{ holidays: string[] }>("/api/calendar-config")
      .then(r => setHolidays(r.holidays ?? [])).catch(() => {});
  }, []);

  const saveHolidays = async (next: string[]) => {
    setSavingHols(true);
    try {
      const r = await apiPut<{ holidays: string[] }>("/api/calendar-config", { holidays: next });
      setHolidays(r.holidays);
    } catch { toast.error("Erro ao salvar feriados"); }
    finally { setSavingHols(false); }
  };

  const days        = useMemo(() => buildDays(period, holidays), [period, holidays]);
  const editors     = useMemo(() => rows.map(r => r.editor), [rows]);
  const visibleRows = useMemo(() => {
    if (whoFilter === null)  return [];
    if (whoFilter === "all") return rows;
    return rows.filter(r => r.editor.id === whoFilter);
  }, [rows, whoFilter]);

  const PERIODS: { value: PeriodFilter; label: string }[] = [
    { value: "today", label: "Hoje"     },
    { value: "week",  label: "Semana"   },
    { value: "8days", label: "8 dias"   },
  ];

  return (
    <div className="flex flex-col min-h-0 h-full">

      {/* ── Header ── */}
      <div className="shrink-0 px-4 sm:px-6 pt-5 pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-black tracking-tight">
            Grade
          </h1>

          <div className="flex items-center gap-2">
            {isCoordinator && (
              <button
                onClick={() => navigate("/planejar")}
                className="flex items-center gap-2 h-9 px-4 text-[13px] font-bold rounded-xl border transition-all"
                style={{
                  background:  "hsl(var(--primary)/0.10)",
                  borderColor: "hsl(var(--primary)/0.35)",
                  color:       "hsl(var(--primary))",
                }}
              >
                Planejar
              </button>
            )}

            {isSupervisor && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Feriados
                    {holidays.length > 0 && (
                      <span className="h-4 min-w-[16px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {holidays.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-4 space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest"
                    style={{ color: "hsl(var(--muted-foreground)/0.50)" }}>
                    Feriados / Dias não úteis
                  </p>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {holidays.length === 0 && (
                      <p className="text-xs py-2 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Nenhum feriado cadastrado
                      </p>
                    )}
                    {[...holidays].sort().map(h => {
                      const [y, m, dd] = h.split("-");
                      return (
                        <div key={h} className="flex items-center justify-between px-2 py-1.5 rounded-lg"
                          style={{ background: "hsl(var(--muted)/0.40)" }}>
                          <span className="text-sm font-semibold tabular-nums">{dd}/{m}/{y}</span>
                          <button onClick={() => saveHolidays(holidays.filter(x => x !== h))}
                            disabled={savingHols}
                            className="hover:text-red-500 transition-colors"
                            style={{ color: "hsl(var(--muted-foreground))" }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <input type="date" value={newHoliday} onChange={e => setNewHoliday(e.target.value)}
                      className="flex-1 h-8 rounded-md border px-2 text-sm"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }} />
                    <Button size="sm" className="h-8 w-8 p-0 shrink-0"
                      disabled={!newHoliday || savingHols}
                      onClick={() => {
                        if (!newHoliday || holidays.includes(newHoliday)) return;
                        saveHolidays([...holidays, newHoliday]);
                        setNewHoliday("");
                      }}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {/* ── Filtros estilo stories ── */}
      <div className="shrink-0 px-4 sm:px-6 pb-4">

        {/* Avatares — scroll horizontal */}
        <div className="flex gap-4 overflow-x-auto" style={{ scrollbarWidth: "none", padding: "6px 4px 8px" }}>

          {/* Todos */}
          <motion.button
            onClick={() => setWhoFilter("all")}
            className="shrink-0 flex flex-col items-center gap-1.5"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.90 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 52, height: 52, background: "hsl(var(--muted)/0.55)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold leading-none"
              style={{ color: "hsl(var(--muted-foreground)/0.60)" }}>
              Todos
            </span>
          </motion.button>

          {/* Um editor */}
          {editors.map(e => {
            const active = whoFilter === e.id;
            return (
              <motion.button
                key={e.id}
                onClick={() => setWhoFilter(active ? null : e.id)}
                className="shrink-0 flex flex-col items-center gap-1.5"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.88 }}
                transition={{ type: "spring", stiffness: 420, damping: 20 }}
              >
                <motion.div
                  animate={{
                    padding: active ? 2 : 2,
                    background: active
                      ? "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary)/0.55))"
                      : "transparent",
                    outline: active ? "none" : "2px solid hsl(var(--border)/0.50)",
                  }}
                  transition={{ duration: 0.2 }}
                  style={{ borderRadius: "50%", outlineOffset: 1 }}
                >
                  <AvatarDisplay
                    name={e.name}
                    avatarUrl={e.avatarUrl}
                    size={44}
                    style={{ display: "block" }}
                  />
                </motion.div>
                <motion.span
                  className="text-[10px] font-bold leading-none"
                  animate={{ color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground)/0.60)" }}
                  transition={{ duration: 0.18 }}
                >
                  {e.name.split(" ")[0]}
                </motion.span>
              </motion.button>
            );
          })}
        </div>

        {/* Período — pills pequenas, alinhadas à esquerda */}
        <div className="flex gap-1.5 mt-3">
          {PERIODS.map(p => (
            <motion.button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className="h-7 px-3 rounded-full text-[11px] font-bold"
              animate={{
                background: period === p.value ? "hsl(var(--primary))"            : "hsl(var(--muted)/0.45)",
                color:      period === p.value ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
              }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
            >
              {p.label}
            </motion.button>
          ))}
        </div>

      </div>

      {/* ── Cards ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-10">
        {whoFilter === null ? (
          <div className="py-24 text-center flex flex-col items-center gap-3"
            style={{ color: "hsl(var(--muted-foreground)/0.40)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span className="text-[13px] font-medium">Selecione um editor acima</span>
          </div>
        ) : loading ? (
          <div className="py-20 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Carregando…
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center gap-2"
            style={{ color: "hsl(var(--muted-foreground))" }}>
            <Inbox className="h-8 w-8 opacity-30" />
            <span className="text-sm">Nenhum editor encontrado</span>
          </div>
        ) : (
          <motion.div
            className="flex flex-col gap-3"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
          >
            {visibleRows.map(row => (
              <EditorCard
                key={`${row.editor.id}-${whoFilter}-${period}`}
                row={row}
                days={days}
                onTaskOpen={id => openTask(id)}
                initialTab={urlDate ?? undefined}
              />
            ))}
          </motion.div>
        )}
      </div>

    </div>
  );
}

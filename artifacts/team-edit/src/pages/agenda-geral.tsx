import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTaskModal } from "@/contexts/TaskModalContext";

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
}

interface EditorRow {
  editor: { id: number; name: string; avatarUrl: string | null };
  tasks: AgendaTask[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEEK_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MON_PT    = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const COMPLEXITY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };
const LANE_H    = 24;
const LANE_GAP  = 3;
const DAY_ROW_H = 36;
const BOT_PAD   = 8;

function parseLocal(s: string): Date {
  const [y,m,d] = s.split("T")[0].split("-").map(Number);
  return new Date(y, m-1, d);
}
function d0(d: Date): Date { const r=new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number): Date { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function diffDays(a: Date, b: Date): number { return Math.round((b.getTime()-a.getTime())/86_400_000); }
function toMonday(d: Date): Date { const w=d.getDay(); return addDays(d0(d), w===0?-6:1-w); }

function scoreColor(s: number): string {
  if (s===0) return "#94a3b8";
  if (s<=6)  return "#eab308";
  if (s<=11) return "#f97316";
  return "#ef4444";
}
function scoreLabel(s: number): string {
  if (s===0) return "Livre";
  if (s<=6)  return "Ocupado";
  if (s<=11) return "Muito ocupado";
  return "No limite";
}

// Retorna segmentos de tarefa para uma semana (para renderizar com gridColumn)
interface Seg { task: AgendaTask; colStart: number; colEnd: number; isStart: boolean; isEnd: boolean; lane: number }

function buildSegments(tasks: AgendaTask[], wStart: Date, wEnd: Date, today: Date): Seg[] {
  const segs = tasks
    .map(t => {
      const startStr = t.startDate?.split("T")[0] ?? t.dueDate?.split("T")[0];
      const endStr   = t.dueDate?.split("T")[0]   ?? startStr;
      if (!startStr && !endStr) return null;
      const start = startStr ? d0(parseLocal(startStr)) : d0(today);
      const end   = endStr   ? d0(parseLocal(endStr))   : start;
      if (start > wEnd || end < wStart) return null;
      return {
        task: t,
        colStart: Math.max(0, diffDays(wStart, start)),
        colEnd:   Math.min(6, diffDays(wStart, end)),
        isStart:  start >= wStart,
        isEnd:    end   <= wEnd,
        lane: 0,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a,b) => a.colStart - b.colStart);

  const laneEnd: number[] = [];
  for (const seg of segs) {
    let lane = 0;
    while (laneEnd[lane] !== undefined && laneEnd[lane] >= seg.colStart) lane++;
    seg.lane = lane;
    laneEnd[lane] = seg.colEnd;
  }
  return segs;
}

// Score de um editor num dia específico
function dayScore(tasks: AgendaTask[], day: Date): number {
  const dayEnd = new Date(day.getTime() + 86_400_000 - 1);
  return tasks.reduce((sum, t) => {
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

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgendaGeral() {
  usePageTitle("Agenda Geral");
  const { openTask } = useTaskModal();

  const [rows,    setRows]    = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = semana atual

  useEffect(() => {
    setLoading(true);
    apiFetch<EditorRow[]>("/api/agenda")
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const today = useMemo(() => d0(new Date()), []);

  // Semana exibida
  const weekStart = useMemo(() => addDays(toMonday(today), weekOffset * 7), [today, weekOffset]);
  const weekDays  = useMemo(() => Array.from({length:7}, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd   = weekDays[6];

  const monthLabel = useMemo(() => {
    const months = new Set(weekDays.map(d => d.getMonth()));
    if (months.size === 1) return `${MON_PT[weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`;
    return weekDays.map(d => MON_PT[d.getMonth()]).filter((v,i,a) => a.indexOf(v)===i).join(" / ") + ` ${weekDays[0].getFullYear()}`;
  }, [weekDays]);

  // Por editor, constrói segmentos + score por dia
  const editorData = useMemo(() =>
    rows.map(row => {
      const segs = buildSegments(row.tasks, weekStart, weekEnd, today);
      const numLanes = segs.length ? Math.max(...segs.map(s => s.lane)) + 1 : 0;
      const rowH = DAY_ROW_H + numLanes * (LANE_H + LANE_GAP) + BOT_PAD;
      const scores = weekDays.map(d => dayScore(row.tasks, d));
      return { ...row, segs, numLanes, rowH, scores };
    }), [rows, weekStart, weekEnd, today, weekDays]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Agenda Geral</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Visão consolidada de todos os editores — use para atribuir sem gerar conflitos
          </p>
        </div>
        {/* Navegação de semana */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} className="text-xs">Hoje</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[130px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(w => w+1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">

          {/* Header de dias */}
          <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 sticky top-0 z-20">
            {/* Coluna de editor */}
            <div className="w-40 shrink-0 border-r border-[hsl(var(--border))]/40 px-3 py-2.5 flex items-end">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">Editor</span>
            </div>
            {/* Dias da semana */}
            {weekDays.map((d, i) => {
              const isToday = diffDays(today, d) === 0;
              const isWkend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={i} className={`flex-1 border-l border-[hsl(var(--border))]/20 py-2 text-center ${isWkend ? "bg-[hsl(var(--muted))]/20" : ""}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40">{WEEK_DAYS[i]}</div>
                  <div className={`text-[11px] font-bold mt-0.5 ${isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/60"}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Loading */}
          {loading && (
            <div className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando...</div>
          )}

          {/* Linhas de editores */}
          {!loading && editorData.map(({ editor, segs, numLanes, rowH, scores }) => (
            <div key={editor.id} className="flex border-t border-[hsl(var(--border))]/20">

              {/* Sidebar do editor */}
              <div className="w-40 shrink-0 border-r border-[hsl(var(--border))]/30 px-3 py-2 flex flex-col gap-1 justify-start"
                style={{ minHeight: rowH }}>
                <div className="flex items-center gap-2">
                  <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={26} className="shrink-0" />
                  <span className="text-[11px] font-semibold truncate leading-snug">{editor.name.split(" ")[0]}</span>
                </div>
                {/* Score da semana (maior score da semana) */}
                {(() => {
                  const peak = Math.max(...scores);
                  const color = scoreColor(peak);
                  if (peak === 0) return null;
                  return (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full w-fit"
                      style={{ background: `${color}22`, color }}>
                      {scoreLabel(peak)}
                    </span>
                  );
                })()}
              </div>

              {/* Grid de tarefa (2 camadas: fundo + conteúdo) */}
              <div className="flex-1 relative" style={{ height: rowH }}>

                {/* Camada 1: fundo — bordas de coluna + fim de semana + score por dia */}
                <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                  {weekDays.map((d, di) => {
                    const isWkend = d.getDay() === 0 || d.getDay() === 6;
                    const sc      = scores[di];
                    const bgOpacity = sc >= 12 ? 0.12 : sc >= 7 ? 0.07 : sc >= 1 ? 0.04 : 0;
                    const bgColor   = scoreColor(sc);
                    return (
                      <div key={di} className={`h-full ${di > 0 ? "border-l border-[hsl(var(--border))]/15" : ""} ${isWkend ? "bg-[hsl(var(--muted))]/10" : ""}`}
                        style={bgOpacity > 0 ? { background: `${bgColor}${Math.round(bgOpacity*255).toString(16).padStart(2,"0")}` } : {}}
                      />
                    );
                  })}
                </div>

                {/* Camada 2: conteúdo (CSS Grid com gridColumn span) */}
                <div className="relative grid grid-cols-7"
                  style={{
                    height: rowH,
                    gridTemplateRows: `${DAY_ROW_H}px repeat(${numLanes}, ${LANE_H + LANE_GAP}px) ${BOT_PAD}px`,
                  }}
                >
                  {/* Score visual por dia (linha 1) */}
                  {weekDays.map((d, di) => {
                    const isToday = diffDays(today, d) === 0;
                    const sc = scores[di];
                    const color = scoreColor(sc);
                    return (
                      <div key={di} className="flex items-center justify-center pt-1.5"
                        style={{ gridRow: 1, gridColumn: di+1 }}>
                        <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-bold leading-none ${isToday ? "ring-2 ring-[hsl(var(--primary))] ring-offset-1" : ""}`}
                          style={sc > 0 ? { background: `${color}22`, color } : { color: "hsl(var(--muted-foreground))", opacity: 0.3 }}>
                          {sc > 0 ? sc : "·"}
                        </div>
                      </div>
                    );
                  })}

                  {/* Mini-cards das tarefas */}
                  {segs.map(({ task, colStart, colEnd, isStart, isEnd, lane }) => (
                    <div key={task.id}
                      style={{
                        gridRow:       lane + 2,
                        gridColumn:    `${colStart+1} / ${colEnd+2}`,
                        paddingTop:    2,
                        paddingBottom: 2,
                        paddingLeft:   isStart ? 3 : 0,
                        paddingRight:  isEnd   ? 3 : 0,
                      }}
                    >
                      <div
                        className="h-full flex items-center overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                        style={{
                          background:   "hsl(var(--primary) / 0.10)",
                          border:       "1px solid hsl(var(--primary) / 0.20)",
                          borderRadius: `${isStart?5:0}px ${isEnd?5:0}px ${isEnd?5:0}px ${isStart?5:0}px`,
                        }}
                        onClick={() => openTask(task.id)}
                      >
                        {isStart && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-sm" style={{ background: task.color }} />
                            <span className="pl-2 pr-1 text-[9px] font-medium truncate leading-none w-full block text-[hsl(var(--foreground))/80]">
                              {task.taskCode && <span className="font-mono font-bold mr-1" style={{ color: task.color }}>{task.taskCode}</span>}
                              {task.title}
                            </span>
                          </>
                        )}
                        {!isStart && (
                          <div className="absolute inset-0 opacity-10"
                            style={{ background: "repeating-linear-gradient(90deg,transparent,transparent 5px,hsl(var(--primary)) 5px,hsl(var(--primary)) 6px)" }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* Empty */}
          {!loading && editorData.length === 0 && (
            <div className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Nenhum editor com tarefas ativas.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

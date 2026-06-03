import { useEffect, useState, useMemo, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

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

function slotConfig(score: number) {
  const pct = Math.min(100, Math.round((score / 12) * 100));
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

  const today     = useMemo(() => d0(new Date()), []);
  const weekStart = useMemo(() => addDays(toMonday(today), weekOffset * 7), [today, weekOffset]);
  const weekDays  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const monthLabel = useMemo(() => {
    const months = new Set(weekDays.map(d => d.getMonth()));
    if (months.size === 1) return `${MON_PT[weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`;
    return weekDays.map(d => MON_PT[d.getMonth()]).filter((v, i, a) => a.indexOf(v) === i).join(" / ")
      + ` ${weekDays[0].getFullYear()}`;
  }, [weekDays]);

  const editorData = useMemo(() =>
    rows.map(row => ({
      ...row,
      scores: weekDays.map(d => dayScore(row.tasks, d)),
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
          {!loading && editorData.map(({ editor, scores }) => (
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
                const cfg    = slotConfig(sc);
                const isToday  = diffDays(today, weekDays[di]) === 0;
                const isWkend  = weekDays[di].getDay() === 0 || weekDays[di].getDay() === 6;
                return (
                  <div
                    key={di}
                    className="p-[4px]"
                    style={isWkend ? { background: "hsl(var(--muted) / 0.07)" } : {}}
                  >
                    <div
                      className="flex flex-col items-center justify-center select-none transition-all duration-200 hover:scale-[1.03] cursor-default w-full"
                      style={{
                        height: 72,
                        borderRadius: 7,
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`,
                        boxShadow: cfg.shadow,
                      }}
                    >
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
              { color: "#94a3b8", label: "Disponível" },
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
  );
}

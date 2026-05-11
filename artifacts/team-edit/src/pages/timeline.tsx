import { useEffect, useState, useCallback, useMemo } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL } from "@/lib/status";
import { Search, X, CalendarDays, Calendar, CalendarRange, SlidersHorizontal, ChevronDown } from "lucide-react";
import { LifecycleFlow, LifecycleData } from "@/components/LifecycleFlow";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; avatarUrl: string | null; }

interface TimelineTask {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  client: string | null;
  color: string;
  dueDate: string | null;
  createdAt: string;
  assignee: Person | null;
  coordinator: Person | null;
}

type ZoomMode = "week" | "month" | "year";

// ── Constants ─────────────────────────────────────────────────────────────────

const BAR_COLOR: Record<string, string> = {
  pending:     "#94a3b8",
  in_progress: "#3b82f6",
  in_revision: "#f97316",
  review:      "#f59e0b",
  completed:   "#22c55e",
  paused:      "#a855f7",
  cancelled:   "#ef4444",
};

const ZOOM_CONFIG: Record<ZoomMode, { days: number; pxPerDay: number }> = {
  week:  { days: 7,  pxPerDay: 90 },
  month: { days: 30, pxPerDay: 46 },
  year:  { days: 90, pxPerDay: 14 },
};

const LEFT_W = 268;
const ROW_H  = 52;
const DAY_PT = ["dom","seg","ter","qua","qui","sex","sáb"];
const MON_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function today0() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function windowStart(zoom: ZoomMode) {
  const t = today0();
  const back = zoom === "week" ? 1 : zoom === "month" ? 5 : 7;
  t.setDate(t.getDate() - back);
  return t;
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function isoToDay(iso: string) {
  const d = new Date(iso);
  d.setHours(0,0,0,0);
  return d;
}

// ── Select dropdown ───────────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ p, size = 22 }: { p: Person | null; size?: number }) {
  if (!p) return null;
  const ini = p.name.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase();
  return p.avatarUrl
    ? <img src={p.avatarUrl} title={p.name} style={{
        width: size, height: size, borderRadius: "50%",
        objectFit: "cover", flexShrink: 0,
        border: "1.5px solid hsl(var(--border))",
      }} />
    : (
      <div title={p.name} style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: "hsl(var(--primary)/0.12)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: "hsl(var(--primary))" }}>{ini}</span>
      </div>
    );
}

// ── Month stripe ──────────────────────────────────────────────────────────────

function MonthStripe({ days, px }: { days: Date[]; px: number }) {
  const stripes: { label: string; count: number }[] = [];
  for (const d of days) {
    const label = `${MON_PT[d.getMonth()]} ${d.getFullYear()}`;
    if (stripes.length && stripes[stripes.length-1].label === label)
      stripes[stripes.length-1].count++;
    else
      stripes.push({ label, count: 1 });
  }
  return (
    <div style={{ display: "flex" }}>
      {stripes.map((s,i) => (
        <div key={i} style={{
          width: s.count * px,
          padding: "3px 10px",
          fontSize: 13, fontWeight: 700,
          color: "hsl(var(--muted-foreground))",
          textTransform: "capitalize",
          borderRight: "1px solid hsl(var(--border))",
          whiteSpace: "nowrap", overflow: "hidden",
          letterSpacing: ".04em",
        }}>
          {s.label}
        </div>
      ))}
    </div>
  );
}

// ── Gantt Grid ────────────────────────────────────────────────────────────────

function GanttGrid({ tasks, zoom, onOpen }: {
  tasks: TimelineTask[];
  zoom: ZoomMode;
  onOpen: (id: number) => void;
}) {
  const { days: DAYS, pxPerDay: PX } = ZOOM_CONFIG[zoom];
  const today  = today0();
  const wStart = windowStart(zoom);
  const totalW = DAYS * PX;

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(wStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const todayIdx = daysBetween(wStart, today);
  const list = tasks.filter(t => t.dueDate);

  if (list.length === 0)
    return (
      <div style={{
        padding: "64px 0", textAlign: "center",
        fontSize: 13, color: "hsl(var(--muted-foreground))",
      }}>
        Nenhuma tarefa com prazo cadastrado.
      </div>
    );

  return (
    <div style={{ overflowX: "auto", overflowY: "visible" }}>
      <div style={{ minWidth: LEFT_W + totalW }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 3,
          background: "hsl(var(--card))",
          borderBottom: "2px solid hsl(var(--border))",
        }}>
          {/* Month stripe row */}
          <div style={{ display: "grid", gridTemplateColumns: `${LEFT_W}px 1fr` }}>
            <div style={{
              padding: "0 16px", height: 28,
              display: "flex", alignItems: "center",
              borderRight: "1px solid hsl(var(--border))",
              fontSize: 13, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
            }}>
              Tarefa
            </div>
            <div style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <MonthStripe days={days} px={PX} />
            </div>
          </div>

          {/* Day row */}
          <div style={{ display: "grid", gridTemplateColumns: `${LEFT_W}px ${totalW}px` }}>
            <div style={{ borderRight: "1px solid hsl(var(--border))", height: 36 }} />
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${DAYS}, ${PX}px)`,
              height: 36,
            }}>
              {days.map((d, i) => {
                const isToday = i === todayIdx;
                const isWknd  = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={i} style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    borderRight: "1px solid hsl(var(--border))",
                    background: isToday
                      ? "hsl(var(--primary)/0.12)"
                      : isWknd ? "hsl(var(--muted)/0.45)" : "transparent",
                    fontFamily: "ui-monospace, monospace",
                    gap: 1,
                  }}>
                    {PX >= 30 && (
                      <span style={{
                        fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".04em",
                        color: isToday ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                        lineHeight: 1,
                      }}>
                        {DAY_PT[d.getDay()]}
                      </span>
                    )}
                    <span style={{
                      fontSize: PX < 30 ? 8.5 : 11,
                      fontWeight: 700,
                      color: isToday ? "hsl(var(--primary))" : "hsl(var(--foreground)/0.7)",
                      lineHeight: 1,
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Rows ────────────────────────────────────────────────────── */}
        {list.map((t, rowIdx) => {
          const rawStart    = daysBetween(wStart, isoToDay(t.createdAt));
          const rawEnd      = daysBetween(wStart, isoToDay(t.dueDate!));
          const cStart      = Math.max(0, rawStart);
          const cEnd        = Math.min(DAYS - 1, rawEnd);
          const barVisible  = cEnd >= cStart && rawEnd >= 0 && rawStart < DAYS;
          const barSpan     = Math.max(1, cEnd - cStart + 1);
          const barColor    = BAR_COLOR[t.status] ?? t.color ?? "#94a3b8";
          const isDone      = t.status === "completed";
          const isCancel    = t.status === "cancelled";
          const isPaused    = t.status === "paused";
          const overdue     = !isDone && !isCancel && !isPaused
            && t.dueDate && isoToDay(t.dueDate) < today;
          const rowBg       = rowIdx % 2 === 0 ? "transparent" : "hsl(var(--muted)/0.12)";

          return (
            <div
              key={t.id}
              onClick={() => onOpen(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: `${LEFT_W}px ${totalW}px`,
                borderBottom: "1px solid hsl(var(--border))",
                height: ROW_H,
                cursor: "pointer",
                background: rowBg,
                transition: "background .1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--primary)/0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
            >
              {/* Left label */}
              <div style={{
                padding: "0 12px",
                display: "flex", alignItems: "center", gap: 8,
                borderRight: "1px solid hsl(var(--border))",
                minWidth: 0, overflow: "hidden",
              }}>
                <div style={{
                  width: 3, height: 22, borderRadius: 99, flexShrink: 0,
                  background: barColor,
                }} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
                    {t.taskCode && (
                      <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "hsl(var(--muted-foreground))", opacity: 0.6, flexShrink: 0 }}>
                        {t.taskCode}
                      </span>
                    )}
                    <span style={{
                      fontSize: 14, fontWeight: 500, lineHeight: 1.2,
                      color: isDone || isCancel ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                      textDecoration: isDone || isCancel ? "line-through" : "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {t.title}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    {t.client && (
                      <span style={{
                        fontSize: 14, fontWeight: 500,
                        color: "hsl(var(--muted-foreground))",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        maxWidth: 130,
                      }}>
                        {t.client}
                      </span>
                    )}
                    {overdue && (
                      <span style={{
                        fontSize: 8.5, fontWeight: 700, flexShrink: 0,
                        color: "#dc2626", background: "#fee2e2",
                        padding: "0 5px", borderRadius: 99,
                      }}>
                        atrasada
                      </span>
                    )}
                  </div>
                </div>
                <Avatar p={t.assignee} />
              </div>

              {/* Gantt area */}
              <div style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: `repeat(${DAYS}, ${PX}px)`,
              }}>
                {days.map((d, di) => (
                  <div key={di} style={{
                    borderRight: "1px solid hsl(var(--border))",
                    background: di === todayIdx
                      ? "hsl(var(--primary)/0.06)"
                      : (d.getDay() === 0 || d.getDay() === 6) ? "hsl(var(--muted)/0.22)" : "transparent",
                  }} />
                ))}

                {barVisible && (
                  <div style={{
                    position: "absolute",
                    left: cStart * PX + 4,
                    top: 10,
                    height: ROW_H - 20,
                    width: barSpan * PX - 8,
                    borderRadius: 6,
                    background: `color-mix(in oklab, ${barColor} 18%, transparent)`,
                    border: `1.5px solid color-mix(in oklab, ${barColor} 42%, transparent)`,
                    display: "flex", alignItems: "center",
                    padding: "0 8px", gap: 5, overflow: "hidden",
                  }}>
                    <div style={{
                      width: 3, height: "62%",
                      background: barColor, borderRadius: 99, flexShrink: 0,
                    }} />
                    {PX >= 30 && (
                      <span style={{
                        fontSize: 13, color: "hsl(var(--foreground)/0.6)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {t.title}
                      </span>
                    )}
                  </div>
                )}

                {todayIdx >= 0 && todayIdx < DAYS && (
                  <div style={{
                    position: "absolute",
                    left: todayIdx * PX + PX / 2 - 1,
                    top: 0, bottom: 0, width: 2,
                    background: "hsl(var(--primary)/0.4)",
                    pointerEvents: "none", zIndex: 1,
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Timeline() {
  usePageTitle("Timeline");
  const { openTask } = useTaskModal();
  const { toast }    = useToast();

  const [tasks,   setTasks]   = useState<TimelineTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom,    setZoom]    = useState<ZoomMode>("month");

  // Filters
  const [search,  setSearch]  = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fClient, setFClient] = useState("all");
  const [fEditor, setFEditor] = useState("all");
  const [fCoord,  setFCoord]  = useState("all");

  const [lifecycle, setLifecycle] = useState<LifecycleData | null>(null);
  const [lcLoading, setLcLoading] = useState(false);

  const openLifecycle = useCallback(async (id: number) => {
    setLcLoading(true);
    try {
      const data = await apiFetch<LifecycleData>(`/api/tasks/${id}/lifecycle`);
      setLifecycle(data);
    } catch {
      toast({ title: "Erro ao carregar ciclo de vida", variant: "destructive" });
    } finally {
      setLcLoading(false);
    }
  }, [toast]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar timeline", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime(load);

  // Build dropdown options from data
  const statusOpts = useMemo(() =>
    Array.from(new Set(tasks.map(t => t.status))).map(s => ({
      value: s, label: STATUS_LABEL[s] ?? s,
    })), [tasks]);

  const clientOpts = useMemo(() =>
    Array.from(new Set(tasks.map(t => t.client).filter(Boolean) as string[]))
      .sort()
      .map(c => ({ value: c, label: c })),
    [tasks]);

  const editorOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => {
      if (t.assignee) seen.set(String(t.assignee.id), t.assignee.name);
    });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks]);

  const coordOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => {
      if (t.coordinator) seen.set(String(t.coordinator.id), t.coordinator.name);
    });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks]);

  const hasFilters = search || fStatus !== "all" || fClient !== "all" || fEditor !== "all" || fCoord !== "all";

  const clearAll = () => {
    setSearch(""); setFStatus("all"); setFClient("all");
    setFEditor("all"); setFCoord("all");
  };

  const filtered = useMemo(() => tasks.filter(t => {
    if (fStatus !== "all" && t.status !== fStatus) return false;
    if (fClient !== "all" && t.client !== fClient) return false;
    if (fEditor !== "all" && String(t.assignee?.id ?? "") !== fEditor) return false;
    if (fCoord  !== "all" && String(t.coordinator?.id ?? "") !== fCoord) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [tasks, fStatus, fClient, fEditor, fCoord, search]);

  const ZOOM_LABELS: Record<ZoomMode, string> = { week: "Semana", month: "Mês", year: "Ano" };

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-[hsl(var(--background))]">

      {/* ── Filter card ─────────────────────────────────────────────────── */}
      <div className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar tarefa…"
              className="pl-8 h-8 text-sm bg-[hsl(var(--background))]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Dropdowns */}
          <FilterSelect
            label="Status" value={fStatus} onChange={setFStatus}
            options={statusOpts}
          />
          <FilterSelect
            label="Cliente" value={fClient} onChange={setFClient}
            options={clientOpts}
          />
          <FilterSelect
            label="Editor" value={fEditor} onChange={setFEditor}
            options={editorOpts}
          />
          <FilterSelect
            label="Coordenador" value={fCoord} onChange={setFCoord}
            options={coordOpts}
          />

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded-md px-2.5 h-8 transition-colors"
            >
              <X className="h-3 w-3" /> Limpar
            </button>
          )}

          <div className="flex-1" />

          {/* Count */}
          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
            {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
          </span>

          {/* Zoom switcher */}
          <div className="flex items-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-0.5 shrink-0">
            {(["week","month","year"] as ZoomMode[]).map(z => {
              const Icon = z === "week" ? CalendarDays : z === "month" ? Calendar : CalendarRange;
              return (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  title={ZOOM_LABELS[z]}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    zoom === z
                      ? "bg-[hsl(var(--primary))] text-white shadow-sm"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {ZOOM_LABELS[z]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Gantt card ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
            Carregando…
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <GanttGrid tasks={filtered} zoom={zoom} onOpen={openLifecycle} />
          </div>
        )}
      </div>

      {lcLoading && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "hsl(var(--background)/0.6)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            border: "3px solid hsl(var(--border))",
            borderTopColor: "hsl(var(--primary))",
            animation: "spin 0.7s linear infinite",
          }} />
        </div>
      )}

      {lifecycle && (
        <LifecycleFlow
          data={lifecycle}
          onClose={() => setLifecycle(null)}
          onOpen={id => { setLifecycle(null); openTask(id); }}
        />
      )}
    </div>
  );
}

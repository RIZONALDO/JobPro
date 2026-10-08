import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/lib/use-page-title";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskFormModal } from "@/components/task-form-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { ChevronLeft, ChevronRight, Lock, Plus, Search, X } from "lucide-react";
import type { Absence } from "@/lib/availability";

// ── Tipos ─────────────────────────────────────────────────────────────────────

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
  editor: { id: number; name: string; avatarUrl: string | null; inactive?: boolean };
  absences?: Absence[];
  currentAbsence?: Absence | null;
  tasks: AgendaTask[];
}

// ── Datas (sempre locais, comparadas por dia) ────────────────────────────────

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY_MS = 86_400_000;
const COMPLEXITY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const d0 = (d: Date) => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const diffDays = (a: Date, b: Date) => Math.round((d0(b).getTime() - d0(a).getTime()) / DAY_MS);
const toMonday = (d: Date) => { const w = d.getDay(); return addDays(d0(d), w === 0 ? -6 : 1 - w); };
const parseLocal = (s: string) => { const [y, m, dd] = s.split("T")[0].split("-").map(Number); return new Date(y, m - 1, dd); };
const fmtDay = (d: Date) => `${DOW[d.getDay()].toLowerCase()} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

// ── Carga (mesma regra da agenda clássica: "em aprovação" não pesa) ──────────

function dayScore(tasks: AgendaTask[], day: Date): number {
  return tasks.reduce((sum, t) => {
    if (t.status === "review") return sum;
    const start = t.startDate ? parseLocal(t.startDate) : null;
    const end = t.dueDate ? parseLocal(t.dueDate) : null;
    if ((!start || start <= day) && (!end || end >= day)) return sum + (COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6);
    return sum;
  }, 0);
}

function loadTint(score: number): string {
  if (score === 0) return "bg-slate-500/[0.07]";
  if (score <= 6) return "bg-yellow-400/[0.13]";
  if (score <= 11) return "bg-orange-400/[0.15]";
  return "bg-red-500/[0.16]";
}
function loadLabel(score: number): string {
  if (score === 0) return "livre";
  if (score <= 6) return "ocupado";
  if (score <= 11) return "muito ocupado";
  return "no limite";
}

const absenceOn = (abs: Absence[] | undefined, day: Date) => {
  const iso = toISO(day);
  return abs?.find(a => a.startDate <= iso && a.endDate >= iso) ?? null;
};

// ── Barras ────────────────────────────────────────────────────────────────────

interface Bar {
  task: AgendaTask;
  s: number;      // coluna inicial (0-based, já recortada ao período)
  e: number;      // coluna final
  lane: number;
  late: boolean;
}

/** Posição da tarefa no período. Sem início → começa hoje; prazo vencido → fica fixada em hoje
 *  (vermelha só se estiver de fato atrasada — em aprovação e pausada não contam). */
function placeTask(t: AgendaTask, periodStart: Date, n: number, today: Date): Omit<Bar, "lane"> | null {
  if (!t.dueDate) return null;
  const due = parseLocal(t.dueDate);
  const overdue = due < today;
  const late = overdue && t.status !== "review" && t.status !== "paused";
  let start = t.startDate ? parseLocal(t.startDate) : (overdue ? due : today);
  let end = due;
  if (overdue) { start = today; end = today; }
  const s = Math.max(0, diffDays(periodStart, start));
  const e = Math.min(n - 1, diffDays(periodStart, end));
  if (e < 0 || s > n - 1 || e < s) return null;
  return { task: t, s, e, late };
}

function assignLanes(bars: Omit<Bar, "lane">[]): { bars: Bar[]; lanes: number } {
  const laneEnd: number[] = [];
  const out = [...bars].sort((a, b) => a.s - b.s || b.e - a.e).map(b => {
    let l = 0;
    while (laneEnd[l] !== undefined && laneEnd[l] >= b.s) l++;
    laneEnd[l] = b.e;
    return { ...b, lane: l };
  });
  return { bars: out, lanes: Math.max(1, laneEnd.length) };
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function AgendaGeral() {
  usePageTitle("Agenda Geral");
  const { openTask } = useTaskModal();

  const [rows, setRows] = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [span, setSpan] = useState<7 | 14>(7);
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch<EditorRow[]>("/api/agenda")
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  const today = useMemo(() => d0(new Date()), []);
  const periodStart = useMemo(() => addDays(toMonday(today), weekOffset * 7), [today, weekOffset]);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(periodStart, i)), [periodStart, span]);
  const daysRef = useRef<Date[]>(days);
  useEffect(() => { daysRef.current = days; }, [days]);

  const periodLabel = useMemo(() => {
    const a = days[0], b = days[days.length - 1];
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} ${MON[a.getMonth()]} ${a.getFullYear()}`
      : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
  }, [days]);

  const q = query.trim().toLowerCase();

  // Ativos primeiro; inativos (só aparecem se tiverem tarefa) no fim
  const data = useMemo(() => {
    const sorted = [...rows].sort((a, b) => Number(!!a.editor.inactive) - Number(!!b.editor.inactive));
    return sorted.map(row => {
      const placed = row.tasks
        .filter(t => !q || `${t.title} ${t.client ?? ""} ${t.taskCode}`.toLowerCase().includes(q))
        .map(t => placeTask(t, periodStart, span, today))
        .filter((b): b is Omit<Bar, "lane"> => b !== null);
      const { bars, lanes } = assignLanes(placed);
      return {
        ...row,
        bars, lanes,
        scores: days.map(d => dayScore(row.tasks, d)),
        away: days.map(d => absenceOn(row.absences, d)),
      };
    });
  }, [rows, q, periodStart, span, today, days]);

  const freeByDay = days.map((_, i) =>
    data.filter(r => !r.editor.inactive && !r.away[i] && r.scores[i] < 12).length);
  const activeCount = data.filter(r => !r.editor.inactive).length;

  const selected = useMemo(() => {
    for (const r of rows) {
      const t = r.tasks.find(x => x.id === selId);
      if (t) return { task: t, editor: r.editor };
    }
    return null;
  }, [rows, selId]);

  // ── Arrastar para criar (dias livres) ──────────────────────────────────────
  type CreateDrag = { editorId: number; start: number; end: number };
  const createRef = useRef<CreateDrag | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const [formPreset, setFormPreset] = useState<{ editorId: number; startDate: string; dueDate: string } | null>(null);

  // ── Arrastar tarefa para mover ─────────────────────────────────────────────
  type MoveDrag = { taskId: number; fromEditor: number; grab: number; s: number; e: number; toEditor: number; toDay: number };
  const moveRef = useRef<MoveDrag | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const applyMove = useCallback(async (m: MoveDrag) => {
    const delta = m.toDay - m.grab;
    const target = dataRef.current.find(r => r.editor.id === m.toEditor);
    const origin = dataRef.current.find(r => r.editor.id === m.fromEditor);
    const bar = origin?.bars.find(b => b.task.id === m.taskId);
    if (!target || !bar) return;
    const t = bar.task;
    if (target.editor.inactive) { toast.error(`${target.editor.name} está inativo`); return; }
    const ns = Math.max(0, m.s + delta), ne = Math.min(span - 1, m.e + delta);
    for (let i = ns; i <= ne; i++) {
      if (target.away[i]) { toast.error(`${target.editor.name} está ausente (${target.away[i]!.label.toLowerCase()}) em ${fmtDay(daysRef.current[i])}`); return; }
    }
    try {
      if (m.toEditor !== m.fromEditor) {
        await apiPost(`/api/tasks/${t.id}/reassign`, { editorId: m.toEditor });
      }
      if (delta !== 0) {
        const shift = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + delta * DAY_MS).toISOString() : undefined;
        await apiPut(`/api/tasks/${t.id}`, {
          dueDate: shift(t.dueDate),
          ...(t.startDate ? { startDate: shift(t.startDate) } : {}),
        });
      }
      // Aviso (não bloqueia) se o destino passar do limite em algum dia
      const w = COMPLEXITY_WEIGHT[t.complexity ?? "medium"] ?? 6;
      const limitDays: string[] = [];
      for (let i = ns; i <= ne; i++) {
        const base = target.scores[i] - (m.toEditor === m.fromEditor && i >= m.s && i <= m.e ? w : 0);
        if (base + w >= 12) limitDays.push(fmtDay(daysRef.current[i]));
      }
      const where = `${m.toEditor !== m.fromEditor ? `${target.editor.name} · ` : ""}${fmtDay(daysRef.current[ns])}${ne > ns ? ` → ${fmtDay(daysRef.current[ne])}` : ""}`;
      if (limitDays.length) toast.warning(`${t.taskCode} movida (${where}). ${target.editor.name.split(" ")[0]} fica no limite em ${limitDays.join(", ")}.`, { duration: 7000 });
      else toast.success(`${t.taskCode} movida — ${where}`);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Não foi possível mover a tarefa");
      load();
    }
  }, [span, load]);

  useEffect(() => {
    const up = () => {
      const c = createRef.current;
      if (c) {
        createRef.current = null; setCreateDrag(null);
        const s = Math.min(c.start, c.end), e = Math.max(c.start, c.end);
        setFormPreset({ editorId: c.editorId, startDate: toISO(daysRef.current[s]), dueDate: toISO(daysRef.current[e]) });
      }
      const m = moveRef.current;
      if (m) {
        moveRef.current = null; setMoveDrag(null);
        if (m.toEditor === m.fromEditor && m.toDay === m.grab) setSelId(m.taskId); // foi só um clique
        else void applyMove(m);
      }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [applyMove]);

  const dragging = !!createDrag || !!moveDrag;

  const onCellDown = (row: (typeof data)[number], i: number, e: React.MouseEvent) => {
    if (row.editor.inactive || row.away[i] || row.scores[i] >= 12) return;
    e.preventDefault();
    const c = { editorId: row.editor.id, start: i, end: i };
    createRef.current = c; setCreateDrag(c);
  };
  const onCellEnter = (row: (typeof data)[number], i: number) => {
    const c = createRef.current;
    if (c && c.editorId === row.editor.id) {
      // não atravessa dias de ausência
      const step = i >= c.start ? 1 : -1;
      for (let k = c.start + step; k !== i + step; k += step) if (row.away[k]) return;
      const n = { ...c, end: i }; createRef.current = n; setCreateDrag(n);
    }
    const m = moveRef.current;
    if (m && (m.toEditor !== row.editor.id || m.toDay !== i)) {
      const n = { ...m, toEditor: row.editor.id, toDay: i }; moveRef.current = n; setMoveDrag(n);
    }
  };
  const onBarDown = (row: (typeof data)[number], b: Bar, e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // dia sob o ponteiro dentro da barra
    const rect = e.currentTarget.getBoundingClientRect();
    const cols = b.e - b.s + 1;
    const grab = b.s + Math.min(cols - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * cols)));
    const m = { taskId: b.task.id, fromEditor: row.editor.id, grab, s: b.s, e: b.e, toEditor: row.editor.id, toDay: grab };
    moveRef.current = m; setMoveDrag(m);
  };

  const gridCols = { gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` };

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Agenda Geral</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Quem faz o quê, em cada dia. Arraste em dias livres para criar; arraste uma tarefa para mover.{" "}
              <Link href="/agenda/classica" className="text-[hsl(var(--primary))] hover:underline">Ver agenda clássica</Link>
            </p>
          </div>
          <Button onClick={() => setFormPreset({ editorId: 0, startDate: "", dueDate: "" })}>
            <Plus className="h-4 w-4 mr-2" />Nova tarefa
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>Hoje</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Período anterior" onClick={() => setWeekOffset(w => w - (span / 7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Próximo período" onClick={() => setWeekOffset(w => w + (span / 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-1 font-semibold">{periodLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar tarefa ou cliente"
                aria-label="Buscar tarefa ou cliente" className="h-9 w-[230px] pl-9" />
            </div>
            <div role="tablist" aria-label="Período" className="flex rounded-lg border bg-[hsl(var(--card))] p-0.5">
              {([7, 14] as const).map(n => (
                <button key={n} role="tab" aria-selected={span === n} onClick={() => setSpan(n)}
                  className={cn("h-8 rounded-md px-3 text-sm font-semibold transition-colors",
                    span === n ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
                  {n === 7 ? "Semana" : "2 semanas"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {/* Grade */}
          <section aria-label="Agenda da equipe" className={cn("flex-[999_1_720px] min-w-0 overflow-x-auto rounded-2xl border bg-[hsl(var(--card))] select-none", moveDrag && "cursor-grabbing")}>
            <div className={span === 14 ? "min-w-[1100px]" : "min-w-[780px]"}>
              {/* Cabeçalho dos dias */}
              <div className="sticky top-0 z-20 grid border-b bg-[hsl(var(--muted))]/30" style={{ gridTemplateColumns: "190px minmax(0,1fr)" }}>
                <div className="flex items-end px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Operacional</div>
                <div className="grid" style={gridCols}>
                  {days.map((d, i) => {
                    const isToday = diffDays(today, d) === 0;
                    const wk = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <div key={i} className={cn("flex flex-col items-center gap-0.5 border-l py-2",
                        isToday ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : wk ? "bg-[hsl(var(--muted))]/20 text-[hsl(var(--muted-foreground))]" : "text-[hsl(var(--muted-foreground))]",
                        i === 7 && "border-l-2")}>
                        <span className="text-[9px] font-bold uppercase tracking-widest">{DOW[d.getDay()]}</span>
                        <span className="text-[15px] font-bold">{d.getDate()}</span>
                        <span className={cn("text-[10px] font-semibold",
                          freeByDay[i] === 0 ? "text-red-500" : freeByDay[i] < Math.ceil(activeCount / 2) ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                          {freeByDay[i]} {freeByDay[i] === 1 ? "livre" : "livres"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {loading && <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando...</p>}

              {!loading && data.map((row, ri) => {
                const showSection = row.editor.inactive && (ri === 0 || !data[ri - 1].editor.inactive);
                const awayNow = row.currentAbsence;
                const moveHere = moveDrag && moveDrag.toEditor === row.editor.id;
                const ghost = moveHere ? { s: moveDrag!.s + (moveDrag!.toDay - moveDrag!.grab), e: moveDrag!.e + (moveDrag!.toDay - moveDrag!.grab) } : null;
                return (
                  <div key={row.editor.id}>
                    {showSection && (
                      <div className="border-t-2 bg-[hsl(var(--muted))]/30 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                        Precisam de reatribuição
                      </div>
                    )}
                    <div className="grid border-b" style={{ gridTemplateColumns: "190px minmax(0,1fr)" }}>
                      <div className="flex min-w-0 items-center gap-2.5 px-4 py-2">
                        <AvatarDisplay name={row.editor.name} avatarUrl={row.editor.avatarUrl} size={30}
                          className={cn("shrink-0", row.editor.inactive && "grayscale opacity-60",
                            awayNow && "ring-2 ring-amber-500 ring-offset-2 ring-offset-[hsl(var(--card))]")} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold">{row.editor.name}</span>
                          <span className={cn("block truncate text-[11px]",
                            row.editor.inactive ? "text-[hsl(var(--muted-foreground))]" : awayNow ? "text-amber-600 dark:text-amber-400" : "text-[hsl(var(--muted-foreground))]")}>
                            {row.editor.inactive ? "Inativo — reatribua" : awayNow ? `${awayNow.label} até ${awayNow.endDate.split("-").reverse().slice(0, 2).join("/")}` : `${row.tasks.length} ${row.tasks.length === 1 ? "tarefa" : "tarefas"}`}
                          </span>
                        </span>
                      </div>

                      <div className={cn("grid py-1.5", row.editor.inactive && "opacity-70")}
                        style={{ ...gridCols, gridTemplateRows: `repeat(${row.lanes}, 30px)`, minHeight: 46 }}>
                        {/* Fundo: carga / ausência / hoje */}
                        {days.map((d, i) => {
                          const abs = row.away[i];
                          const sc = row.scores[i];
                          const wk = d.getDay() === 0 || d.getDay() === 6;
                          const isToday = diffDays(today, d) === 0;
                          const inCreate = createDrag && createDrag.editorId === row.editor.id &&
                            i >= Math.min(createDrag.start, createDrag.end) && i <= Math.max(createDrag.start, createDrag.end);
                          const inGhost = ghost && i >= ghost.s && i <= ghost.e;
                          const locked = row.editor.inactive || !!abs;
                          return (
                            <div key={i}
                              title={`${fmtDay(d)} — ${row.editor.inactive ? "inativo" : abs ? `${abs.label} (travado)` : loadLabel(sc)}`}
                              onMouseDown={e => onCellDown(row, i, e)}
                              onMouseEnter={() => onCellEnter(row, i)}
                              className={cn("mx-[2px] rounded-lg transition-colors",
                                row.editor.inactive ? "bg-[hsl(var(--muted))]/30" : abs ? "" : wk && sc === 0 ? "bg-[hsl(var(--muted))]/20" : loadTint(sc),
                                isToday && !abs && !row.editor.inactive && "shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.45)]",
                                inCreate && "bg-[hsl(var(--primary))]/25 ring-2 ring-inset ring-[hsl(var(--primary))]",
                                inGhost && (abs || row.editor.inactive ? "ring-2 ring-inset ring-red-500" : "outline outline-2 outline-dashed -outline-offset-2 bg-[hsl(var(--primary))]/10"),
                                locked ? "cursor-not-allowed" : sc >= 12 ? "cursor-default" : "cursor-cell")}
                              style={{
                                gridRow: "1 / -1", gridColumn: i + 1,
                                ...(inGhost ? { outlineColor: "hsl(var(--primary))" } : {}),
                                ...(abs && !row.editor.inactive ? { background: "repeating-linear-gradient(135deg, rgba(245,158,11,0.16) 0 6px, rgba(245,158,11,0.05) 6px 12px)" } : {}),
                              }}
                            />
                          );
                        })}

                        {/* Rótulos de ausência */}
                        {row.away.map((abs, i) => abs && (i === 0 || row.away[i - 1]?.id !== abs.id) ? (
                          <div key={`abs-${i}`} className="pointer-events-none z-[1] ml-2 flex items-center gap-1.5 self-center text-[11px] font-semibold text-amber-600 dark:text-amber-400"
                            style={{ gridRow: "1 / -1", gridColumn: i + 1 }}>
                            <Lock className="h-3 w-3" />{abs.label}
                          </div>
                        ) : null)}

                        {/* Tarefas */}
                        {row.bars.map(b => {
                          const isSel = selId === b.task.id;
                          const review = b.task.status === "review";
                          const paused = b.task.status === "paused";
                          const isMoving = moveDrag?.taskId === b.task.id;
                          return (
                            <button key={b.task.id} type="button"
                              onMouseDown={e => onBarDown(row, b, e)}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelId(b.task.id); } }}
                              title={`${b.task.taskCode} · ${b.task.title} — ${STATUS_LABEL[b.task.status] ?? b.task.status}${b.late ? " (atrasada)" : ""}`}
                              className={cn("z-[2] mx-1 flex h-[26px] min-w-0 items-center gap-1.5 self-center rounded-md border px-2 text-left text-[12px] font-medium",
                                "cursor-grab hover:brightness-110",
                                (review || paused) && "border-dashed",
                                paused && "opacity-70",
                                b.late && "border-2 border-red-500",
                                isSel && "outline outline-2 outline-offset-1 outline-[hsl(var(--foreground))]",
                                isMoving && "opacity-40",
                                dragging && "pointer-events-none")}
                              style={{
                                gridRow: b.lane + 1, gridColumn: `${b.s + 1} / ${b.e + 2}`,
                                background: review || paused ? "transparent" : `${b.task.color || "#6366f1"}2e`,
                                borderColor: b.late ? undefined : review ? "#f59e0b" : paused ? "#94a3b8" : `${b.task.color || "#6366f1"}80`,
                              }}>
                              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: b.task.color || "#6366f1" }} />
                              <span className="font-mono text-[10px] font-semibold opacity-75">{b.task.taskCode}</span>
                              <span className="truncate">{b.task.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {!loading && data.length === 0 && (
                <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhum editor com tarefas.</p>
              )}

              {/* Legenda */}
              <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                {[["bg-slate-500/20", "Livre"], ["bg-yellow-400/40", "Ocupado"], ["bg-orange-400/45", "Muito ocupado"], ["bg-red-500/45", "No limite"]].map(([c, l]) => (
                  <span key={l} className="inline-flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded", c)} />{l}</span>
                ))}
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: "repeating-linear-gradient(135deg, rgba(245,158,11,0.5) 0 3px, rgba(245,158,11,0.1) 3px 6px)" }} />Ausente (travado)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded border border-dashed border-amber-500" />Em aprovação</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded border-2 border-red-500" />Atrasada</span>
              </div>
            </div>
          </section>

          {/* Detalhe */}
          <aside aria-label="Detalhe da tarefa" className="flex-[1_1_280px] max-w-[340px] min-w-0 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] lg:sticky lg:top-4">
            {!selected ? (
              <div className="space-y-3 p-5 text-sm text-[hsl(var(--muted-foreground))]">
                <p className="font-semibold text-[hsl(var(--foreground))]">Como usar</p>
                <p>Clique numa tarefa para ver o detalhe aqui.</p>
                <p>Arraste sobre dias livres de um editor para criar uma tarefa já com as datas.</p>
                <p>Arraste uma tarefa para outro dia ou outro editor para remarcar.</p>
                <p>Dias com cadeado (férias, folga) não aceitam tarefa nova.</p>
              </div>
            ) : (() => {
              const t = selected.task;
              const due = t.dueDate ? parseLocal(t.dueDate) : null;
              const late = !!due && due < today && t.status !== "review" && t.status !== "paused";
              return (
                <>
                  <div className="space-y-3 border-b p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold" style={{ color: t.color || undefined }}>{t.taskCode}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Fechar detalhe" onClick={() => setSelId(null)}><X className="h-4 w-4" /></Button>
                    </div>
                    <p className="text-lg font-bold leading-snug">{t.title}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold", STATUS_CHIP[t.status] ?? "")}>{STATUS_LABEL[t.status] ?? t.status}</span>
                      {late && <span className="rounded-[4px] bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">Atrasada</span>}
                    </div>
                  </div>
                  <dl className="grid gap-x-3 gap-y-2 border-b px-5 py-4 text-sm" style={{ gridTemplateColumns: "100px minmax(0,1fr)" }}>
                    <dt className="text-[hsl(var(--muted-foreground))]">Editor</dt><dd>{selected.editor.name}</dd>
                    <dt className="text-[hsl(var(--muted-foreground))]">Período</dt>
                    <dd>{t.startDate ? `${fmtDay(parseLocal(t.startDate))} → ` : "até "}{due ? fmtDay(due) : "—"}</dd>
                    <dt className="text-[hsl(var(--muted-foreground))]">Cliente</dt><dd className="truncate">{t.client || "—"}</dd>
                    <dt className="text-[hsl(var(--muted-foreground))]">Coordenação</dt><dd className="truncate">{t.creator?.name ?? "—"}</dd>
                  </dl>
                  <div className="space-y-2 p-5">
                    <Button className="w-full" onClick={() => openTask(t.id)}>Abrir tarefa</Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => setEditTaskId(t.id)}>Mudar datas</Button>
                      <Button variant="outline" onClick={() => setReassignOpen(true)}>Reatribuir</Button>
                    </div>
                  </div>
                </>
              );
            })()}
          </aside>
        </div>
      </div>

      {formPreset && (
        <TaskFormModal
          open
          onOpenChange={v => { if (!v) setFormPreset(null); }}
          editTaskId={null}
          initialStartDate={formPreset.startDate || undefined}
          initialDueDate={formPreset.dueDate || undefined}
          initialEditorId={formPreset.editorId || undefined}
          readOnlyDates={!!formPreset.startDate}
          onSaved={() => { setFormPreset(null); load(); }}
        />
      )}
      {editTaskId !== null && (
        <TaskFormModal open onOpenChange={v => { if (!v) setEditTaskId(null); }} editTaskId={editTaskId}
          onSaved={() => { setEditTaskId(null); load(); }} />
      )}
      {selected && (
        <ReassignEditorModal open={reassignOpen} onOpenChange={setReassignOpen} mode="reassign"
          taskId={selected.task.id} taskTitle={selected.task.title}
          currentAssignedTo={{ id: selected.editor.id, name: selected.editor.name, avatarUrl: selected.editor.avatarUrl }}
          onSaved={load} />
      )}
    </>
  );
}

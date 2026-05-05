import { useEffect, useState, useMemo, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Search, Tag, AlertTriangle, CheckCircle2, Clock, Eye,
  RotateCcw, ExternalLink, ChevronRight, X,
  ArrowRight, Pencil, MessageSquare, Play, Send,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  parseISO, isBefore, isToday, differenceInDays, format,
  min as dateMin, max as dateMax, startOfMonth, endOfMonth, addMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; role: string; avatarUrl: string | null }

interface TimelineTask {
  id: number; title: string; description: string | null;
  status: string; priority: string; complexity: string;
  dueDate: string | null; color: string; client: string | null;
  revisionCount: number; folderUrl: string | null;
  createdAt: string; updatedAt: string;
  assignee: Person | null; coordinator: Person | null;
}

interface LifecycleStep {
  type: "created" | "status_change";
  at: string;
  by: Person | null;
  meta: {
    fromStatus?: string; toStatus?: string;
    title?: string; client?: string; priority?: string; color?: string;
    revisionComment?: string; revisionNumber?: number;
  };
}

interface LifecycleData {
  task: TimelineTask & { assignee: Person | null; coordinator: Person | null };
  steps: LifecycleStep[];
}


// ── Constants ─────────────────────────────────────────────────────────────────

const COORD_ROLES = ["admin", "supervisor", "coordinator"];
const ALL_STATUSES = ["pending", "in_progress", "review", "in_revision", "completed"];

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLS: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-red-100 text-red-700 border-red-200",
};
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const STATUS_BAR: Record<string, string> = {
  pending: "#94a3b8", in_progress: "#3b82f6",
  review: "#f59e0b", in_revision: "#f97316", completed: "#22c55e",
};

// Node styles for lifecycle flowchart
const STEP_STYLE: Record<string, { bg: string; border: string; text: string; icon: JSX.Element; label: string }> = {
  created:      { bg: "bg-indigo-50",  border: "border-indigo-300",  text: "text-indigo-700",  icon: <Play className="h-3.5 w-3.5" />,        label: "Criação" },
  pending:      { bg: "bg-slate-50",   border: "border-slate-300",   text: "text-slate-600",   icon: <Clock className="h-3.5 w-3.5" />,        label: "Pendente" },
  in_progress:  { bg: "bg-blue-50",    border: "border-blue-300",    text: "text-blue-700",    icon: <Pencil className="h-3.5 w-3.5" />,       label: "Em edição" },
  review:       { bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-700",   icon: <Send className="h-3.5 w-3.5" />,         label: "Enviado p/ aprovação" },
  in_revision:  { bg: "bg-orange-50",  border: "border-orange-400",  text: "text-orange-700",  icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Alteração solicitada" },
  completed:    { bg: "bg-green-50",   border: "border-green-400",   text: "text-green-700",   icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Aprovada" },
};

const LEFT_W = 210;
const ROW_H  = 30;
const HEAD_H = 24;
const GRP_H  = 26;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOverdue(t: { dueDate: string | null; status: string }) {
  if (!t.dueDate || t.status === "completed") return false;
  const d = parseISO(t.dueDate);
  return isBefore(d, new Date()) && !isToday(d);
}

function fmt(iso: string) { return format(parseISO(iso), "dd/MM/yy HH:mm", { locale: ptBR }); }
function fmtShort(iso: string) { return format(parseISO(iso), "dd/MM/yy", { locale: ptBR }); }

function Avatar({ p, size = 5 }: { p: Person | null; size?: number }) {
  if (!p) return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  const ini = p.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {p.avatarUrl
        ? <img src={p.avatarUrl} className={`h-${size} w-${size} rounded-full object-cover shrink-0`} />
        : <div className={`h-${size} w-${size} rounded-full bg-[hsl(var(--primary))]/15 flex items-center justify-center shrink-0`}>
            <span className="text-[8px] font-bold text-[hsl(var(--primary))]">{ini}</span>
          </div>
      }
      <span className="text-xs truncate">{p.name}</span>
    </div>
  );
}


// ── Lifecycle Flowchart ───────────────────────────────────────────────────────

function LifecycleFlow({ data, onClose, onOpen }: { data: LifecycleData; onClose: () => void; onOpen: (id: number) => void }) {
  const { task, steps } = data;

  const nodeKey = (step: LifecycleStep, i: number) => {
    if (step.type === "created") return "created";
    return step.meta.toStatus ?? `step-${i}`;
  };

  const styleFor = (step: LifecycleStep) => {
    if (step.type === "created") return STEP_STYLE.created;
    const key = step.meta.toStatus ?? "pending";
    return STEP_STYLE[key] ?? STEP_STYLE.pending;
  };

  const roleLabel: Record<string, string> = {
    admin: "Admin", coordinator: "Coordenador", supervisor: "Supervisor", editor: "Editor",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-h-[94vh] flex flex-col rounded-2xl border bg-[hsl(var(--card))] shadow-2xl overflow-hidden" style={{ maxWidth: "min(96vw, 1600px)" }} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-[hsl(var(--muted))]/20 shrink-0">
        <div className="h-3 w-3 rounded-full shrink-0" style={{ background: task.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{task.title}</p>
          {task.client && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
              <Tag className="h-3 w-3" />{task.client}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[task.status] ?? ""}`}>
            {STATUS_LABEL[task.status] ?? task.status}
          </Badge>
          <button
            onClick={() => onOpen(task.id)}
            className="text-[11px] text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5"
          >
            Abrir <ExternalLink className="h-3 w-3" />
          </button>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sub-header info */}
      <div className="flex items-center gap-6 px-5 py-2 border-b bg-[hsl(var(--muted))]/10 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span>Coordenador: <strong className="text-[hsl(var(--foreground))]">{task.coordinator?.name ?? "—"}</strong></span>
        <span>Editor: <strong className="text-[hsl(var(--foreground))]">{task.assignee?.name ?? "—"}</strong></span>
        {task.dueDate && <span>Prazo: <strong className={isOverdue(task) ? "text-red-600" : "text-[hsl(var(--foreground))]"}>{fmtShort(task.dueDate)}</strong></span>}
        <span>{task.revisionCount} revisão{task.revisionCount !== 1 ? "ões" : ""}</span>
      </div>

      {/* Flowchart */}
      <div className="overflow-x-auto overflow-y-auto flex-1 px-5 py-5">
        <div className="flex items-start gap-0 min-w-max">
          {steps.map((step, i) => {
            const style = styleFor(step);
            const isLast = i === steps.length - 1;

            return (
              <div key={i} className="flex items-start">
                {/* Node */}
                <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-3 w-[200px] flex flex-col gap-1.5 shadow-sm`}>
                  {/* Icon + label */}
                  <div className={`flex items-center gap-1.5 ${style.text} font-semibold text-[11px]`}>
                    {style.icon}
                    <span>{style.label}</span>
                  </div>

                  {/* From → To badge (for status changes) */}
                  {step.type === "status_change" && step.meta.fromStatus && (
                    <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                      <span className="opacity-60 line-through">{STATUS_LABEL[step.meta.fromStatus] ?? step.meta.fromStatus}</span>
                      <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                      <span className={style.text + " font-medium"}>{STATUS_LABEL[step.meta.toStatus!] ?? step.meta.toStatus}</span>
                    </div>
                  )}

                  {/* Actor */}
                  {step.by && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {step.by.avatarUrl
                        ? <img src={step.by.avatarUrl} className="h-5 w-5 rounded-full object-cover shrink-0" />
                        : <div className="h-5 w-5 rounded-full bg-[hsl(var(--primary))]/20 flex items-center justify-center shrink-0">
                            <span className="text-[8px] font-bold text-[hsl(var(--primary))]">
                              {step.by.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                      }
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium truncate">{step.by.name}</p>
                        <p className="text-[9px] text-[hsl(var(--muted-foreground))]">{roleLabel[step.by.role] ?? step.by.role}</p>
                      </div>
                    </div>
                  )}

                  {/* Revision comment */}
                  {step.meta.revisionComment && (
                    <div className="mt-1 rounded-lg bg-orange-100/80 border border-orange-200 px-2 py-1.5 text-[10px] text-orange-800 leading-snug">
                      <span className="font-semibold block mb-0.5">Revisão #{step.meta.revisionNumber}</span>
                      {step.meta.revisionComment}
                    </div>
                  )}

                  {/* Creation meta */}
                  {step.type === "created" && step.meta.client && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5" />{step.meta.client}
                    </p>
                  )}

                  {/* Timestamp */}
                  <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-auto pt-1 border-t border-[hsl(var(--border))]/40">
                    {fmt(step.at)}
                  </p>
                </div>

                {/* Arrow connector */}
                {!isLast && (
                  <div className="flex items-center self-center mx-1 shrink-0">
                    <div className="w-10 h-px bg-[hsl(var(--border))]" />
                    <ArrowRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] -ml-1" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}

// ── Compact Gantt ─────────────────────────────────────────────────────────────

function GanttChart({
  tasks, onOpen, selectedId, onSelect,
}: {
  tasks: TimelineTask[];
  onOpen: (id: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [tooltip, setTooltip] = useState<{ task: TimelineTask; x: number; y: number } | null>(null);

  const withDate = tasks.filter(t => t.dueDate);
  if (withDate.length === 0)
    return <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa com prazo cadastrado.</div>;

  const today = new Date();
  const allStarts = withDate.map(t => parseISO(t.createdAt));
  const allEnds   = withDate.map(t => parseISO(t.dueDate!));
  const rangeStart = startOfMonth(dateMin([...allStarts, today]));
  const rangeEnd   = endOfMonth(dateMax([...allEnds, today]));
  const totalDays  = differenceInDays(rangeEnd, rangeStart) + 1;
  const DAY_W      = totalDays > 365 ? 7 : totalDays > 180 ? 12 : totalDays > 90 ? 18 : 24;
  const totalW     = totalDays * DAY_W;

  const months: { label: string; left: number; width: number }[] = [];
  let cur = startOfMonth(rangeStart);
  while (isBefore(cur, rangeEnd)) {
    const mS = cur < rangeStart ? rangeStart : cur;
    const mE = endOfMonth(cur) > rangeEnd ? rangeEnd : endOfMonth(cur);
    months.push({
      label: format(cur, "MMM/yy", { locale: ptBR }),
      left: differenceInDays(mS, rangeStart) * DAY_W,
      width: (differenceInDays(mE, mS) + 1) * DAY_W,
    });
    cur = addMonths(cur, 1);
  }

  const todayLeft = Math.max(0, differenceInDays(today, rangeStart)) * DAY_W;

  // Flat list sorted by dueDate
  const sortedTasks = [...withDate].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const barFor = (t: TimelineTask) => {
    const left = Math.max(0, differenceInDays(parseISO(t.createdAt), rangeStart)) * DAY_W;
    const right = Math.min(totalW, (differenceInDays(parseISO(t.dueDate!), rangeStart) + 1) * DAY_W);
    return { left, width: Math.max(right - left, DAY_W) };
  };

  const barColor = (t: TimelineTask) =>
    isOverdue(t) ? "#ef4444" : STATUS_BAR[t.status] ?? t.color;


  return (
    <div className="relative" onMouseLeave={() => setTooltip(null)}>
      <div className="overflow-auto rounded-lg border" style={{ maxHeight: 460 }}>
        <div style={{ width: LEFT_W + totalW, minWidth: "100%" }}>

          {/* Header */}
          <div className="flex sticky top-0 z-20" style={{ height: HEAD_H }}>
            <div className="sticky left-0 shrink-0 bg-[hsl(var(--muted))]/60 border-r border-b flex items-center px-3 z-30 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide" style={{ width: LEFT_W }}>
              Tarefa
            </div>
            <div className="relative bg-[hsl(var(--muted))]/40 border-b" style={{ width: totalW }}>
              {months.map(m => (
                <div key={m.label} className="absolute inset-y-0 border-r border-[hsl(var(--border))]/50 flex items-center px-1.5" style={{ left: m.left, width: m.width }}>
                  <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] capitalize">{m.label}</span>
                </div>
              ))}
              {todayLeft <= totalW && (
                <div className="absolute top-0 flex flex-col items-center z-10" style={{ left: todayLeft, transform: "translateX(-50%)" }}>
                  <div className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 rounded whitespace-nowrap leading-5">Hoje</div>
                </div>
              )}
            </div>
          </div>

          {sortedTasks.map(t => {
                  const { left, width } = barFor(t);
                  const color = barColor(t);
                  const overdue = isOverdue(t);
                  const isSel = selectedId === t.id;
                  return (
                    <div key={t.id} className="flex group" style={{ height: ROW_H + 10 }}>
                      <div
                        onClick={() => onSelect(t.id)}
                        className={`sticky left-0 shrink-0 flex flex-col justify-center gap-0 px-2.5 border-r border-b cursor-pointer transition-colors z-10
                          ${isSel ? "bg-[hsl(var(--primary))]/10" : "bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]/20"}`}
                        style={{ width: LEFT_W, borderLeft: `3px solid ${color}` }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] font-medium truncate flex-1">{t.title}</span>
                          {overdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                        </div>
                        {t.client && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate flex items-center gap-0.5">
                            <Tag className="h-2.5 w-2.5 shrink-0" />{t.client}
                          </span>
                        )}
                      </div>
                      <div
                        className={`relative border-b transition-colors cursor-pointer ${isSel ? "bg-[hsl(var(--primary))]/5" : "hover:bg-[hsl(var(--muted))]/10"}`}
                        style={{ width: totalW }}
                        onClick={() => onSelect(t.id)}
                        onMouseMove={e => setTooltip({ task: t, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {todayLeft <= totalW && <div className="absolute inset-y-0 w-0.5 bg-indigo-400/40 z-[1]" style={{ left: todayLeft }} />}
                        <div
                          className="absolute rounded z-[2] flex items-center px-1.5 overflow-hidden"
                          style={{ left, width, height: 20, top: 10, background: color, opacity: t.status === "completed" ? 0.45 : 0.8 }}
                        >
                          {width > 60 && <span className="text-white text-[9px] font-semibold truncate drop-shadow">{t.title}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 pointer-events-none" style={{ left: tooltip.x + 14, top: tooltip.y - 6 }}>
          <div className="rounded-lg border bg-[hsl(var(--card))] shadow-xl p-2.5 text-xs space-y-1 min-w-[180px]">
            <p className="font-semibold text-sm">{tooltip.task.title}</p>
            {tooltip.task.client && <p className="text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Tag className="h-3 w-3" />{tooltip.task.client}</p>}
            <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[tooltip.task.status] ?? ""}`}>{STATUS_LABEL[tooltip.task.status]}</Badge>
            {tooltip.task.assignee && <p className="text-[hsl(var(--muted-foreground))]">Editor: <b className="text-[hsl(var(--foreground))]">{tooltip.task.assignee.name}</b></p>}
            {tooltip.task.dueDate && <p className={isOverdue(tooltip.task) ? "text-red-600 font-semibold" : "text-[hsl(var(--muted-foreground))]"}>Prazo: {fmtShort(tooltip.task.dueDate)}</p>}
            <p className="text-[9px] text-[hsl(var(--muted-foreground))]/60 pt-0.5">Clique para ver ciclo de vida</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 px-0.5">
        {Object.entries(STATUS_BAR).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: c, opacity: 0.85 }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span className="inline-block h-2 w-4 rounded-sm bg-red-500" />Atrasada
        </span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  usePageTitle("Linha do tempo");
  const { toast }    = useToast();
  const { openTask } = useTaskModal();
  const { user }     = useAuth();

  const [tasks, setTasks]           = useState<TimelineTask[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lifecycle, setLifecycle]   = useState<LifecycleData | null>(null);
  const [lifLoading, setLifLoading] = useState(false);

  // Filters
  const [search,      setSearch]      = useState("");
  const [statusF,     setStatusF]     = useState("");
  const [clientF,     setClientF]     = useState("");
  const [editorF,     setEditorF]     = useState<number | "">("");
  const [coordF,      setCoordF]      = useState<number | "">("");


  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(d => { setTasks(d); setLoading(false); })
      .catch(() => { toast({ title: "Erro ao carregar", variant: "destructive" }); setLoading(false); });
  }, [toast, isCoord]);

  useEffect(() => { if (!isCoord) { setLoading(false); return; } load(); }, [load, isCoord]);
  useRealtime({ onTasksChanged: load });

  // Fetch lifecycle when task selected
  const handleSelect = useCallback(async (id: number) => {
    if (selectedId === id) { setSelectedId(null); setLifecycle(null); return; }
    setSelectedId(id);
    setLifecycle(null);
    setLifLoading(true);
    try {
      const data = await apiFetch<LifecycleData>(`/api/tasks/${id}/lifecycle`);
      setLifecycle(data);
    } catch {
      toast({ title: "Erro ao carregar ciclo de vida", variant: "destructive" });
    } finally {
      setLifLoading(false);
    }
  }, [selectedId, toast]);

  // Derived filter options
  const clients = useMemo(() => {
    const s = new Set(tasks.map(t => t.client).filter(Boolean) as string[]);
    return [...s].sort();
  }, [tasks]);

  const editors = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach(t => { if (t.assignee) m.set(t.assignee.id, t.assignee.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const coords = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach(t => { if (t.coordinator) m.set(t.coordinator.id, t.coordinator.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  // Filtered tasks
  const filtered = useMemo(() => {
    let list = tasks.filter(t => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !(t.client?.toLowerCase().includes(q)) && !(t.assignee?.name.toLowerCase().includes(q))) return false;
      }
      if (statusF && t.status !== statusF) return false;
      if (clientF && t.client !== clientF) return false;
      if (editorF !== "" && t.assignee?.id !== editorF) return false;
      if (coordF  !== "" && t.coordinator?.id !== coordF) return false;
      return true;
    });

    list.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    return list;
  }, [tasks, search, statusF, clientF, editorF, coordF]);


  if (!isCoord) return <div className="text-sm text-[hsl(var(--muted-foreground))] py-8 text-center">Acesso restrito a coordenadores.</div>;

  return (
    <div className="space-y-4">

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-3 flex flex-wrap items-center gap-2">
        <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />

        <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-52">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tarefa ou cliente…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
          {search && <button onClick={() => setSearch("")}><X className="h-3 w-3 text-[hsl(var(--muted-foreground))]" /></button>}
        </div>

        <select value={statusF} onChange={e => setStatusF(e.target.value)}
          className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
          <option value="">Todos os status</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>

        {clients.length > 0 && (
          <select value={clientF} onChange={e => setClientF(e.target.value)}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os clientes</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {editors.length > 0 && (
          <select value={editorF} onChange={e => setEditorF(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os editores</option>
            {editors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}

        {coords.length > 0 && (
          <select value={coordF} onChange={e => setCoordF(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-8 text-xs rounded-lg border bg-[hsl(var(--background))] px-2 outline-none cursor-pointer">
            <option value="">Todos os coordenadores</option>
            {coords.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}

        {(search || statusF || clientF || editorF !== "" || coordF !== "") && (
          <button onClick={() => { setSearch(""); setStatusF(""); setClientF(""); setEditorF(""); setCoordF(""); }}
            className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <X className="h-3 w-3" /> Limpar
          </button>
        )}

        <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Gantt ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarIcon className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold">Gantt</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
            {filtered.filter(t => t.dueDate).length} com prazo
          </span>

        </div>
        {loading
          ? <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
          : <GanttChart tasks={filtered} onOpen={openTask} selectedId={selectedId} onSelect={handleSelect} />
        }
      </div>

      {/* ── Lifecycle Modal ───────────────────────────────────────── */}
      {lifLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-[hsl(var(--card))] border px-8 py-6 text-sm text-[hsl(var(--muted-foreground))]">
            Carregando ciclo de vida…
          </div>
        </div>
      )}
      {lifecycle && !lifLoading && (
        <LifecycleFlow data={lifecycle} onClose={() => { setLifecycle(null); setSelectedId(null); }} onOpen={openTask} />
      )}
    </div>
  );
}

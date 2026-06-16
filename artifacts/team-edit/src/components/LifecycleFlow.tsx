import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { STATUS_LABEL, STATUS_CLASS, STATUS_CHIP, isTerminal } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import {
  Play, Pencil, Send, MessageSquare, CheckCircle2, Clock,
  ArrowRight, Tag, X, ExternalLink, PauseCircle, XCircle, RotateCcw, Layers,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; role: string; avatarUrl: string | null; }

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

interface LifecycleTask {
  id: number; title: string; status: string; priority: string;
  complexity: string; dueDate: string | null; color: string;
  client: string | null; revisionCount: number;
  taskType?: string;
  subtaskProgress?: { total: number; completed: number; percentage: number } | null;
  assignee: Person | null; coordinator: Person | null;
}

export interface LifecycleData {
  task: LifecycleTask;
  steps: LifecycleStep[];
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEP_CFG: Record<string, { dot: string; icon: React.ReactNode; label: string }> = {
  created:     { dot: "#818cf8", icon: <Play          className="h-3 w-3" />, label: "Criação"              },
  pending:     { dot: "#94a3b8", icon: <Clock         className="h-3 w-3" />, label: "Pendente"             },
  in_progress: { dot: "#3b82f6", icon: <Pencil        className="h-3 w-3" />, label: "Em edição"            },
  review:      { dot: "#f59e0b", icon: <Send          className="h-3 w-3" />, label: "Envio p/ aprovação"   },
  in_revision: { dot: "#f97316", icon: <MessageSquare className="h-3 w-3" />, label: "Alteração solicitada" },
  completed:   { dot: "#22c55e", icon: <CheckCircle2  className="h-3 w-3" />, label: "Aprovada"             },
  reopened:    { dot: "#e11d48", icon: <RotateCcw     className="h-3 w-3" />, label: "Reaberta"             },
  paused:      { dot: "#a855f7", icon: <PauseCircle   className="h-3 w-3" />, label: "Pausada"              },
  cancelled:   { dot: "#ef4444", icon: <XCircle       className="h-3 w-3" />, label: "Cancelada"            },
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", coordinator: "Coord.", supervisor: "Superv.", editor: "Editor",
};

const PRIORITY_LABEL: Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa" };
const COMPLEXITY_LABEL: Record<string, string> = { high: "Complexa", medium: "Moderada", low: "Simples" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAt(iso: string) {
  return format(parseISO(iso), "dd MMM yyyy · HH:mm", { locale: ptBR });
}

function getCfg(step: LifecycleStep) {
  const key = step.type === "created" ? "created" : (step.meta.toStatus ?? "pending");
  return STEP_CFG[key] ?? STEP_CFG.pending;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function MetaItem({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 font-medium">{label}</span>
      <span className="text-xs font-semibold" style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}

function StepRow({ step, index, total }: { step: LifecycleStep; index: number; total: number }) {
  const cfg = getCfg(step);
  const isLast = index === total - 1;

  return (
    <div className="flex gap-4 min-w-0">
      {/* Left: dot + line */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
        <div
          className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 ring-2 ring-[hsl(var(--background))] z-10"
          style={{ backgroundColor: cfg.dot }}
        >
          <span className="text-white">{cfg.icon}</span>
        </div>
        {!isLast && (
          <div className="flex-1 w-px mt-1" style={{ backgroundColor: `${cfg.dot}40`, minHeight: 24 }} />
        )}
      </div>

      {/* Right: content */}
      <div className={`flex-1 min-w-0 pb-5 ${isLast ? "" : ""}`}>
        {/* Top row: label + timestamp */}
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: cfg.dot }}>
              {cfg.label}
            </span>
            {/* from → to */}
            {step.type === "status_change" && step.meta.fromStatus && (
              <span className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="line-through opacity-60">{STATUS_LABEL[step.meta.fromStatus] ?? step.meta.fromStatus}</span>
                <ArrowRight className="h-2.5 w-2.5 opacity-40 shrink-0" />
                <span className="font-medium" style={{ color: cfg.dot }}>{STATUS_LABEL[step.meta.toStatus!] ?? step.meta.toStatus}</span>
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/60 shrink-0 tabular-nums">
            {fmtAt(step.at)}
          </span>
        </div>

        {/* Actor */}
        <div className="flex items-center gap-1.5 mb-1">
          {step.by ? (
            <>
              {step.by.avatarUrl
                ? <img src={step.by.avatarUrl} className="h-4 w-4 rounded-full object-cover shrink-0 ring-1 ring-[hsl(var(--border))]" width={16} height={16} />
                : (
                  <div className="h-4 w-4 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                    <span className="text-[7px] font-bold text-[hsl(var(--muted-foreground))]">
                      {step.by.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )
              }
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-medium text-[hsl(var(--foreground))]">{step.by.name}</span>
                {" · "}
                <span className="opacity-60">{ROLE_LABEL[step.by.role] ?? step.by.role}</span>
              </span>
            </>
          ) : (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50">Sistema</span>
          )}
        </div>

        {/* Creation client */}
        {step.type === "created" && step.meta.client && (
          <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
            <Tag className="h-3 w-3 shrink-0 opacity-50" />
            {step.meta.client}
          </div>
        )}

        {/* Revision comment */}
        {step.meta.revisionComment && (
          <div className="mt-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]/60 mb-1">
              Revisão #{step.meta.revisionNumber}
            </p>
            <p className="text-xs text-[hsl(var(--foreground))] leading-relaxed">
              {step.meta.revisionComment}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LifecycleFlow({
  data, onClose, onOpen,
}: {
  data: LifecycleData;
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const { task, steps } = data;

  const isOverdue = (() => {
    if (!task.dueDate || isTerminal(task.status)) return false;
    const due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return due < today;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative flex flex-col z-10 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl overflow-hidden max-h-[92vh] sm:max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 shrink-0">
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: task.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {task.taskType === "multi_task" && (
                <span title="Multi-tarefa" className="inline-flex shrink-0">
                  <Layers className="h-3.5 w-3.5 text-indigo-500" />
                </span>
              )}
              <p className="text-sm font-semibold truncate leading-tight">{task.title}</p>
            </div>
            {task.client && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]/70 flex items-center gap-1 mt-0.5">
                <Tag className="h-2.5 w-2.5 shrink-0" />{task.client}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATUS_CHIP[task.status] ?? ""}`}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
            <button
              onClick={() => { onClose(); onOpen(task.id); }}
              className="h-7 w-7 rounded-md flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
              title="Abrir tarefa"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-md flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Meta grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-3 px-5 py-3 border-b border-[hsl(var(--border))] shrink-0">
          <MetaItem label="Coordenador" value={task.coordinator?.name?.split(" ")[0] ?? "—"} />
          {task.taskType === "multi_task" && task.subtaskProgress ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 font-medium">Subtarefas</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold tabular-nums">
                  {task.subtaskProgress.completed}/{task.subtaskProgress.total}
                </span>
                <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      task.subtaskProgress.percentage === 100 ? "bg-green-500" :
                      task.subtaskProgress.percentage >= 66 ? "bg-blue-500" :
                      task.subtaskProgress.percentage >= 33 ? "bg-indigo-400" : "bg-slate-400"
                    }`}
                    style={{ width: `${task.subtaskProgress.percentage}%` }}
                  />
                </div>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]/60 tabular-nums">
                  {task.subtaskProgress.percentage}%
                </span>
              </div>
            </div>
          ) : (
            <MetaItem label="Editor" value={task.assignee?.name?.split(" ")[0] ?? "—"} />
          )}
          <MetaItem label="Prioridade" value={PRIORITY_LABEL[task.priority] ?? task.priority} />
          <MetaItem label="Complexidade" value={COMPLEXITY_LABEL[task.complexity] ?? task.complexity} />
          <MetaItem
            label="Prazo"
            value={task.dueDate ? format(parseISO(task.dueDate), "dd/MM/yy", { locale: ptBR }) : "—"}
            accent={isOverdue ? "#ef4444" : undefined}
          />
          <MetaItem
            label="Revisões"
            value={String(task.revisionCount)}
            accent={task.revisionCount > 0 ? "#f97316" : undefined}
          />
        </div>

        {/* ── Timeline ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 pt-5 pb-6">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-[hsl(var(--muted-foreground))]">
              <Clock className="h-8 w-8 opacity-20" />
              <p className="text-sm">Nenhum evento registrado.</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-4">
                Histórico · {steps.length} evento{steps.length !== 1 ? "s" : ""}
              </p>
              <div>
                {steps.map((step, i) => (
                  <StepRow key={i} step={step} index={i} total={steps.length} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

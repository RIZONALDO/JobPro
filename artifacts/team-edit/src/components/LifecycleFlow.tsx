import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import {
  Play, Pencil, Send, MessageSquare, CheckCircle2, Clock,
  ArrowRight, Tag, X, ExternalLink, PauseCircle, XCircle,
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
  assignee: Person | null; coordinator: Person | null;
}

export interface LifecycleData {
  task: LifecycleTask;
  steps: LifecycleStep[];
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEP_CFG: Record<string, {
  bg: string; border: string; text: string; dot: string;
  icon: React.ReactNode; label: string;
}> = {
  created:     { bg: "bg-indigo-50",  border: "border-indigo-300", text: "text-indigo-700",  dot: "#818cf8", icon: <Play         className="h-3.5 w-3.5" />, label: "Criação"              },
  pending:     { bg: "bg-slate-50",   border: "border-slate-300",  text: "text-slate-600",   dot: "#94a3b8", icon: <Clock        className="h-3.5 w-3.5" />, label: "Pendente"             },
  in_progress: { bg: "bg-blue-50",    border: "border-blue-300",   text: "text-blue-700",    dot: "#3b82f6", icon: <Pencil       className="h-3.5 w-3.5" />, label: "Em edição"            },
  review:      { bg: "bg-amber-50",   border: "border-amber-300",  text: "text-amber-700",   dot: "#f59e0b", icon: <Send         className="h-3.5 w-3.5" />, label: "Envio p/ aprovação"   },
  in_revision: { bg: "bg-orange-50",  border: "border-orange-300", text: "text-orange-700",  dot: "#f97316", icon: <MessageSquare className="h-3.5 w-3.5"/>, label: "Alteração solicitada" },
  completed:   { bg: "bg-green-50",   border: "border-green-300",  text: "text-green-700",   dot: "#22c55e", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Aprovada"             },
  paused:      { bg: "bg-purple-50",  border: "border-purple-300", text: "text-purple-700",  dot: "#a855f7", icon: <PauseCircle  className="h-3.5 w-3.5" />, label: "Pausada"              },
  cancelled:   { bg: "bg-red-50",     border: "border-red-300",    text: "text-red-700",     dot: "#ef4444", icon: <XCircle      className="h-3.5 w-3.5" />, label: "Cancelada"            },
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", coordinator: "Coordenador", supervisor: "Supervisor", editor: "Editor",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAt(iso: string) {
  return format(parseISO(iso), "dd MMM yyyy · HH:mm", { locale: ptBR });
}

function getCfg(step: LifecycleStep) {
  const key = step.type === "created" ? "created" : (step.meta.toStatus ?? "pending");
  return STEP_CFG[key] ?? STEP_CFG.pending;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ p }: { p: Person }) {
  const ini = p.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2 min-w-0">
      {p.avatarUrl
        ? <img src={p.avatarUrl} className="h-6 w-6 rounded-full object-cover shrink-0 ring-1 ring-white" />
        : (
          <div className="h-6 w-6 rounded-full bg-[hsl(var(--primary)/0.12)] flex items-center justify-center shrink-0 ring-1 ring-white">
            <span className="text-[8px] font-bold text-[hsl(var(--primary))]">{ini}</span>
          </div>
        )
      }
      <div className="min-w-0">
        <p className="text-xs font-semibold truncate leading-tight">{p.name}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight">{ROLE_LABEL[p.role] ?? p.role}</p>
      </div>
    </div>
  );
}

// ── Arrow connector ───────────────────────────────────────────────────────────

function Arrow({ color, animated }: { color: string; animated?: boolean }) {
  return (
    <div className="flex-shrink-0 flex items-center self-center px-0.5" aria-hidden>
      <svg width="40" height="24" viewBox="0 0 40 24" fill="none">
        <line
          x1="2" y1="12" x2="30" y2="12"
          stroke={color} strokeWidth="1.8"
          strokeDasharray={animated ? "4 3" : undefined}
          className={animated ? "animate-[dash_1s_linear_infinite]" : undefined}
        />
        <path d="M27 6 L36 12 L27 18" stroke={color} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({ step, index, total }: { step: LifecycleStep; index: number; total: number }) {
  const cfg = getCfg(step);
  const isLast = index === total - 1;

  return (
    <div className={`
      flex flex-col rounded-2xl border-2 overflow-hidden shadow-sm
      bg-[hsl(var(--card))] w-[185px] shrink-0 transition-shadow hover:shadow-md
      ${cfg.border}
    `}>
      {/* ── Header strip ── */}
      <div className={`flex items-center gap-2 px-3 py-2.5 ${cfg.bg} border-b ${cfg.border}`}>
        <span className={cfg.text}>{cfg.icon}</span>
        <span className={`flex-1 text-xs font-bold uppercase tracking-wider truncate ${cfg.text}`}>
          {cfg.label}
        </span>
        <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 ${cfg.bg} border ${cfg.border} ${cfg.text}`}>
          #{index + 1}
        </span>
      </div>

      <div className="flex flex-col gap-0 flex-1">
        {/* ── Status transition ── */}
        {step.type === "status_change" && step.meta.fromStatus && (
          <div className="px-3 py-2 flex items-center gap-1.5 border-b border-[hsl(var(--border))]">
            <span className="text-xs text-[hsl(var(--muted-foreground))] line-through leading-tight truncate max-w-[56px]">
              {STATUS_LABEL[step.meta.fromStatus] ?? step.meta.fromStatus}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <span className={`text-xs font-semibold leading-tight truncate ${cfg.text}`}>
              {STATUS_LABEL[step.meta.toStatus!] ?? step.meta.toStatus}
            </span>
          </div>
        )}

        {/* ── Created meta ── */}
        {step.type === "created" && step.meta.client && (
          <div className="px-3 py-2 flex items-center gap-1.5 border-b border-[hsl(var(--border))]">
            <Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" />
            <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{step.meta.client}</span>
          </div>
        )}

        {/* ── Actor ── */}
        <div className="px-3 py-2.5">
          {step.by
            ? <Avatar p={step.by} />
            : <span className="text-xs text-[hsl(var(--muted-foreground))]">Sistema</span>
          }
        </div>

        {/* ── Revision comment ── */}
        {step.meta.revisionComment && (
          <div className="mx-2 mb-2 rounded-xl p-2.5 text-xs leading-snug
            bg-orange-50 border border-orange-200 dark:bg-orange-950/20 dark:border-orange-800">
            <span className="font-bold text-orange-700 block mb-1">
              Revisão #{step.meta.revisionNumber}
            </span>
            <span className="text-orange-800 dark:text-orange-300 leading-relaxed">
              {step.meta.revisionComment}
            </span>
          </div>
        )}
      </div>

      {/* ── Timestamp ── */}
      <div className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] font-mono">
        {fmtAt(step.at)}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyFlow() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
      <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center">
        <Clock className="h-6 w-6 opacity-40" />
      </div>
      <p className="text-sm">Nenhum evento registrado ainda.</p>
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

  const isOverdue = task.dueDate
    && task.status !== "completed"
    && task.status !== "cancelled"
    && new Date(task.dueDate) < new Date();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="
          relative flex flex-col z-10
          w-full sm:max-w-5xl lg:max-w-6xl
          rounded-t-3xl sm:rounded-3xl
          border border-[hsl(var(--border))]
          bg-[hsl(var(--card))]
          shadow-2xl overflow-hidden
          max-h-[92vh] sm:max-h-[88vh]
        "
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[hsl(var(--border))] shrink-0">
          {/* Color dot */}
          <div className="h-3 w-3 rounded-full shrink-0 mt-0.5" style={{ background: task.color }} />

          {/* Title + client */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug truncate">{task.title}</h2>
            {task.client && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1 mt-0.5">
                <Tag className="h-3 w-3 shrink-0" />
                {task.client}
              </p>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Badge className={`text-xs px-2 ${STATUS_CLASS[task.status] ?? ""}`}>
              {STATUS_LABEL[task.status] ?? task.status}
            </Badge>
            {task.dueDate && (
              <span className={`text-xs font-medium hidden sm:inline ${isOverdue ? "text-red-500" : "text-[hsl(var(--muted-foreground))]"}`}>
                Prazo: {format(parseISO(task.dueDate), "dd/MM/yy", { locale: ptBR })}
              </span>
            )}
            <button
              onClick={() => { onClose(); onOpen(task.id); }}
              className="hidden sm:flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
            >
              Abrir <ExternalLink className="h-3 w-3" />
            </button>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-full flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Meta bar ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] shrink-0 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[hsl(var(--muted-foreground))]">Coordenador</span>
            <span className="font-semibold">{task.coordinator?.name ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[hsl(var(--muted-foreground))]">Editor</span>
            <span className="font-semibold">{task.assignee?.name ?? "—"}</span>
          </div>
          {task.revisionCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[hsl(var(--muted-foreground))]">Revisões</span>
              <span className="font-semibold text-orange-600">{task.revisionCount}</span>
            </div>
          )}
          <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))/0.5] hidden md:block">
            {steps.length} evento{steps.length !== 1 ? "s" : ""} no histórico
          </span>
        </div>

        {/* ── Flow area ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto min-h-0 p-5 sm:p-6">
          {steps.length === 0 ? (
            <EmptyFlow />
          ) : (
            <>
              {/* Timeline label */}
              <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-5">
                Ciclo de vida
              </p>

              {/* Horizontal flow */}
              <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <StepCard step={step} index={i} total={steps.length} />
                    {i < steps.length - 1 && (
                      <Arrow
                        color={getCfg(steps[i + 1]).dot}
                        animated={i === steps.length - 2}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Progress bar below */}
              <div className="mt-6 pt-4 border-t border-[hsl(var(--border))]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Progresso
                  </span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))] ml-auto">
                    {steps.length} de {steps.length} etapas
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                    style={{
                      width: "100%",
                      background: `linear-gradient(to right, ${
                        steps.map(s => getCfg(s).dot).join(", ")
                      })`,
                    }}
                  />
                </div>
                {/* Step dots */}
                <div className="relative flex justify-between mt-1.5">
                  {steps.map((step, i) => {
                    const cfg = getCfg(step);
                    return (
                      <div key={i} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
                        <div
                          className="h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm"
                          style={{ background: cfg.dot }}
                        />
                        {steps.length <= 8 && (
                          <span className="text-[8px] text-[hsl(var(--muted-foreground))] truncate max-w-[48px] text-center leading-tight hidden sm:block">
                            {cfg.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

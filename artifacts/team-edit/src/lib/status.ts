// Statuses where the task lifecycle is closed — overdue logic must NOT apply.
// `reopened` is intentionally NOT here: it is an active state that allows overdue tracking.
export const TERMINAL_STATUSES = ["completed", "cancelled", "paused"] as const;
export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const STATUS_LABEL: Record<string, string> = {
  rascunho:    "Rascunho",
  pending:     "Pendente",
  in_progress: "Em edição",
  review:      "Em revisão",
  completed:   "Aprovada",
  reopened:    "Reaberta",
  paused:      "Pausada",
  cancelled:   "Cancelada",
};

export const STATUS_CHIP: Record<string, string> = {
  rascunho:    "bg-zinc-500/10 text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-600",
  pending:     "bg-slate-500/10 text-slate-500 dark:text-slate-400",
  in_progress: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  review:      "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed:   "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  reopened:    "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  paused:      "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  cancelled:   "bg-red-500/10 text-red-500 dark:text-red-400",
};

export const STATUS_DOT: Record<string, string> = {
  rascunho:    "bg-zinc-300",
  pending:     "bg-slate-400",
  in_progress: "bg-blue-500",
  review:      "bg-amber-500",
  completed:   "bg-emerald-500",
  reopened:    "bg-rose-600",
  paused:      "bg-violet-400",
  cancelled:   "bg-red-300",
};

export const STATUS_CLASS: Record<string, string> = {
  rascunho:    "bg-zinc-100 text-zinc-400 border border-dashed border-zinc-300",
  pending:     "bg-slate-100 text-slate-500 border-transparent",
  completed:   "bg-emerald-100 text-emerald-700 border-transparent",
  paused:      "bg-violet-100 text-violet-600 border-transparent",
  cancelled:   "bg-red-50 text-red-400 border-transparent",
  in_progress: "badge-in-progress border-transparent",
  review:      "badge-review border-transparent",
  reopened:    "bg-rose-600 text-white border-transparent",
};

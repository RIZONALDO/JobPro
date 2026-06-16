export const TERMINAL_STATUSES = ["completed", "cancelled", "paused"] as const;
export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const STATUS_LABEL: Record<string, string> = {
  pending:     "Pendente",
  in_progress: "Em edição",
  in_revision: "Em alteração",
  review:      "Em aprovação",
  completed:   "Aprovada",
  paused:      "Pausada",
  cancelled:   "Cancelada",
};

// Chips retangulares — rounded-[4px], fundo alpha, sem animação
export const STATUS_CHIP: Record<string, string> = {
  pending:     "bg-slate-400 text-white",
  in_progress: "bg-blue-500 text-white",
  in_revision: "bg-orange-500 text-white",
  review:      "bg-amber-500 text-white",
  completed:   "bg-emerald-500 text-white",
  paused:      "bg-violet-500 text-white",
  cancelled:   "bg-red-400 text-white",
};

export const STATUS_DOT: Record<string, string> = {
  pending:     "bg-slate-400",
  in_progress: "bg-blue-500",
  in_revision: "bg-orange-500",
  review:      "bg-amber-500",
  completed:   "bg-emerald-500",
  paused:      "bg-violet-400",
  cancelled:   "bg-red-400",
};

// Mantido para compatibilidade com componentes que ainda usam Badge
export const STATUS_CLASS: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-500 border-transparent",
  in_progress: "bg-blue-100 text-blue-700 border-transparent",
  in_revision: "bg-orange-100 text-orange-700 border-transparent",
  review:      "bg-amber-100 text-amber-700 border-transparent",
  completed:   "bg-emerald-100 text-emerald-700 border-transparent",
  paused:      "bg-violet-100 text-violet-600 border-transparent",
  cancelled:   "bg-red-50 text-red-400 border-transparent",
};

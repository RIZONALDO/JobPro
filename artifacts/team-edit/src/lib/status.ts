export const STATUS_LABEL: Record<string, string> = {
  rascunho:    "Rascunho",
  pending:     "Pendente",
  in_progress: "Em edição",
  in_revision: "Em alteração",
  review:      "Aguard. aprovação",
  completed:   "Aprovada",
  paused:      "Pausada",
  cancelled:   "Cancelada",
};

// Three visual tiers based on urgency / coordinator action required:
//   Tier 1 – ACTIVE  (solid fill, high contrast): tasks needing attention NOW
//   Tier 2 – PASSIVE (soft fill, muted):          tasks waiting or settled
//   Tier 3 – DRAFT   (dashed border only):        not yet published
export const STATUS_CLASS: Record<string, string> = {
  // Tier 3 — draft, not real yet
  rascunho:    "bg-zinc-100 text-zinc-400 border border-dashed border-zinc-300",

  // Tier 2 — passive / settled
  pending:     "bg-slate-100 text-slate-500 border-transparent",
  completed:   "bg-emerald-100 text-emerald-700 border-transparent",
  paused:      "bg-violet-100 text-violet-600 border-transparent",
  cancelled:   "bg-red-50 text-red-400 border-transparent",

  // Tier 1 — active, demand attention (solid fills)
  in_progress: "bg-blue-600 text-white border-transparent",
  in_revision: "bg-orange-500 text-white border-transparent",
  review:      "bg-amber-500 text-white border-transparent",
};

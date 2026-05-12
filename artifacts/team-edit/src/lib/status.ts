export const STATUS_LABEL: Record<string, string> = {
  rascunho:    "Rascunho",
  pending:     "Pendente",
  in_progress: "Em edição",
  in_revision: "Em alteração",
  review:      "Aguardando aprovação",
  completed:   "Aprovada",
  paused:      "Pausada",
  cancelled:   "Cancelada",
};

export const STATUS_CLASS: Record<string, string> = {
  rascunho:    "bg-zinc-100 text-zinc-500 border border-zinc-300 border-dashed",
  pending:     "bg-slate-100 text-slate-600 border border-slate-300",
  in_progress: "bg-blue-100 text-blue-700 border border-blue-300",
  in_revision: "bg-orange-100 text-orange-700 border border-orange-300",
  review:      "bg-amber-100 text-amber-700 border border-amber-300",
  completed:   "bg-green-100 text-green-700 border border-green-300",
  paused:      "bg-purple-100 text-purple-700 border border-purple-300",
  cancelled:   "bg-red-100 text-red-600 border border-red-300",
};

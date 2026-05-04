export const STATUS_LABEL: Record<string, string> = {
  pending:     "Pendente",
  in_progress: "Em edição",
  in_revision: "Em alteração",
  review:      "Aguardando aprovação",
  completed:   "Aprovada",
};

export const STATUS_CLASS: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-600 border border-slate-300",
  in_progress: "bg-blue-100 text-blue-700 border border-blue-300",
  in_revision: "bg-orange-100 text-orange-700 border border-orange-300",
  review:      "bg-amber-100 text-amber-700 border border-amber-300",
  completed:   "bg-green-100 text-green-700 border border-green-300",
};

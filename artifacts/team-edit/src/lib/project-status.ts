export const PROJ_STATUS_LABEL: Record<string, string> = {
  ativo:     "Ativo",
  pausado:   "Pausado",
  concluido: "Concluído",
  arquivado: "Arquivado",
};

export const PROJ_STATUS_CLASS: Record<string, string> = {
  ativo:     "bg-blue-100 text-blue-700 border border-blue-200",
  pausado:   "bg-amber-100 text-amber-700 border border-amber-200",
  concluido: "bg-green-100 text-green-700 border border-green-200",
  arquivado: "bg-slate-100 text-slate-500 border border-slate-200",
};

export const PROJ_STATUS_OPTIONS = [
  { value: "ativo",     label: "Ativo" },
  { value: "pausado",   label: "Pausado" },
  { value: "concluido", label: "Concluído" },
  { value: "arquivado", label: "Arquivado" },
];

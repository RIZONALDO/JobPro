export const JOB_STATUS_LABEL: Record<string, string> = {
  aberto:            "Aberto",
  producao:          "Em produção",
  aprovacao_interna: "Aprovação interna",
  com_cliente:       "Com cliente",
  em_revisao:        "Em revisão",
  aprovado:          "Aprovado",
  entregue:          "Entregue",
};

export const JOB_STATUS_CLASS: Record<string, string> = {
  aberto:            "bg-slate-100 text-slate-600 border border-slate-200",
  producao:          "bg-blue-100 text-blue-700 border border-blue-200",
  aprovacao_interna: "bg-purple-100 text-purple-700 border border-purple-200",
  com_cliente:       "bg-amber-100 text-amber-700 border border-amber-200",
  em_revisao:        "bg-orange-100 text-orange-700 border border-orange-200",
  aprovado:          "bg-teal-100 text-teal-700 border border-teal-200",
  entregue:          "bg-green-100 text-green-700 border border-green-200",
};

export const JOB_STATUS_OPTIONS = [
  { value: "aberto",            label: "Aberto" },
  { value: "producao",          label: "Em produção" },
  { value: "aprovacao_interna", label: "Aprovação interna" },
  { value: "com_cliente",       label: "Com cliente" },
  { value: "em_revisao",        label: "Em revisão" },
  { value: "aprovado",          label: "Aprovado" },
  { value: "entregue",          label: "Entregue" },
];

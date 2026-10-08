// Disponibilidade da equipe — espelha api-server/src/lib/availability.ts
// - status "inactive": saiu da equipe (some de seletores, carga, agenda, plantões novos)
// - ausência: férias/afastamento temporário (só sinaliza, nunca bloqueia)

export interface Absence {
  id: number;
  userId: number;
  type: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  notes: string | null;
}

export const ABSENCE_TYPE_OPTIONS = [
  { value: "vacation", label: "Férias" },
  { value: "leave",    label: "Afastamento" },
  { value: "medical",  label: "Licença médica" },
  { value: "day_off",  label: "Folga" },
  { value: "other",    label: "Outro" },
];

/** "2026-10-20" → "20/10" */
export function fmtShortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** "Férias até 20/10" */
export function absenceShort(a: Pick<Absence, "label" | "endDate">): string {
  return `${a.label} até ${fmtShortDate(a.endDate)}`;
}

export function isActiveUser(u: { status?: string | null }): boolean {
  return (u.status ?? "active") === "active";
}

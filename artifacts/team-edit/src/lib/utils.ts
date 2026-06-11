import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  fmtDate,
  fmtDateFull,
  fmtShort,
  fmtDateParts,
  daysFromToday,
  fmtDaysLeft,
  toLocalDateStr,
  todayStr,
  localTzOffset,
  localISOString,
  parseDate,
  nextHalfHour,
} from "./date";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-exporta utilitários canônicos de data
export {
  fmtDate,
  fmtDateFull,
  fmtShort,
  fmtDateParts,
  daysFromToday,
  fmtDaysLeft,
  toLocalDateStr as toLocalDate,
  todayStr,
  localTzOffset,
  localISOString,
  parseDate,
  nextHalfHour,
};

/**
 * Para tarefas concluídas/canceladas, retorna dados para a coluna de prazo.
 * Retorna null para tarefas ativas/pausadas (caller exibe dueDate normalmente).
 */
export function fmtClosedCycle(
  status: string,
  dueDate: string | null,
  updatedAt: string,
  _reviewedAt?: string | null,
): { date: string; badge: string | null; variant: "success" | "late" | "cancelled" | "neutral" } | null {
  if (status !== "completed" && status !== "cancelled") return null;

  const date = fmtDate(updatedAt) ?? "";

  if (status === "cancelled") {
    return { date, badge: "Cancelada", variant: "cancelled" };
  }
  if (!dueDate) {
    return { date, badge: null, variant: "neutral" };
  }

  // Compara apenas partes de data (string YYYY-MM-DD) — sem conversão UTC
  const approvalDay = updatedAt.slice(0, 10);
  const dueDay      = dueDate.slice(0, 10);

  if (approvalDay <= dueDay) {
    return { date, badge: "no prazo", variant: "success" };
  }

  const diff = Math.round(
    (new Date(approvalDay + "T12:00:00").getTime() -
     new Date(dueDay      + "T12:00:00").getTime()) / 86_400_000
  );
  return { date, badge: `${diff}d após o prazo`, variant: "late" };
}

export function fmtDateHuman(date: string | null | undefined): string | null {
  return fmtDate(date);
}

export function fmtPrazoWeek(date: string | null | undefined): {
  label: string; sublabel: string | null; isHuman: boolean;
} {
  if (!date) return { label: "—", sublabel: null, isHuman: false };
  return { label: fmtDate(date) ?? "—", sublabel: null, isHuman: false };
}

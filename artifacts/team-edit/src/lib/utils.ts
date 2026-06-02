import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns the browser-local YYYY-MM-DD string for a Date (avoids UTC/local day boundary issues). */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const hasTime = date.includes("T");
  const dt = hasTime ? new Date(date) : (() => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d); })();
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  const base = `${day}/${mon}`;
  if (!hasTime) return base;
  const h = dt.getHours();
  const min = dt.getMinutes();
  if (h === 0 && min === 0) return base;
  return min === 0 ? `${base} às ${h}h` : `${base} às ${h}h${String(min).padStart(2, "0")}`;
}

/** "05/05 às 12:30" — para timestamps curtos (criação de revisões etc.) */
export function fmtShort(date: string | null | undefined): string | null {
  if (!date) return null;
  const dt = new Date(date);
  const d   = String(dt.getDate()).padStart(2, "0");
  const m   = String(dt.getMonth() + 1).padStart(2, "0");
  const h   = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${d}/${m} às ${h}:${min}`;
}

export function fmtDaysLeft(date: string | null | undefined): { text: string; cls: string } | null {
  if (!date) return null;
  const dt = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dtDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((dtDay.getTime() - today.getTime()) / 86_400_000);
  const abs = Math.abs(diff);

  const fmt = (n: number) => {
    const months = Math.floor(n / 30);
    const days = n % 30;
    if (months === 0) return `${days} ${days === 1 ? "dia" : "dias"}`;
    if (days === 0) return `${months} ${months === 1 ? "mês" : "meses"}`;
    return `${months} ${months === 1 ? "mês" : "meses"} e ${days} ${days === 1 ? "dia" : "dias"}`;
  };

  if (diff < 0)   return { text: `${abs}d em atraso`, cls: "text-red-500" };
  if (diff === 0) return { text: "entrega hoje", cls: "text-amber-500 font-semibold" };
  if (diff === 1) return { text: "entrega amanhã", cls: "text-amber-500" };
  if (diff <= 7)  return { text: `${diff} dias`, cls: "text-amber-400" };
  return { text: `${diff} dias`, cls: "text-[hsl(var(--muted-foreground))]" };
}

/** Returns { date: "12/05", time: "14:30" | null } for compact two-line display */
export function fmtDateParts(date: string | null | undefined): { date: string; time: string | null } | null {
  if (!date) return null;
  const dt = new Date(date);
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const h = dt.getHours();
  const min = dt.getMinutes();
  const hasTime = date.includes("T") && (h !== 0 || min !== 0);
  return {
    date: `${d}/${m}`,
    time: hasTime ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null,
  };
}

/**
 * For tasks whose lifecycle is closed (completed / cancelled), returns display
 * data for the due-date column instead of the raw dueDate.
 *
 * Returns null for active / paused tasks (caller renders dueDate normally).
 */
export function fmtClosedCycle(
  status: string,
  dueDate: string | null,
  updatedAt: string,
  _reviewedAt?: string | null,
): { line1: string; line2: string | null; cls: string } | null {
  if (status !== "completed" && status !== "cancelled") return null;

  const closedLabel = fmtDate(updatedAt) ?? "";

  if (status === "cancelled") {
    return { line1: `Cancelada ${closedLabel}`, line2: null, cls: "text-[hsl(var(--muted-foreground))]/60" };
  }

  const line1 = `Aprovado ${closedLabel}`;

  if (!dueDate) {
    return { line1, line2: null, cls: "text-emerald-600" };
  }

  // Normaliza ambos para meia-noite para evitar bug de arredondamento com horários
  const a = new Date(updatedAt.includes("T") ? updatedAt : updatedAt + "T00:00");
  const approvalDay = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d = new Date(dueDate.includes("T") ? dueDate : dueDate + "T00:00");
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const lateDays = Math.round((approvalDay.getTime() - dueDay.getTime()) / 86_400_000);

  if (lateDays <= 0) {
    return { line1, line2: "no prazo", cls: "text-emerald-600" };
  }

  return { line1, line2: `${lateDays}d após o prazo`, cls: "text-amber-600" };
}

export function fmtDateHuman(date: string | null | undefined): string | null {
  return fmtDate(date);
}

export function fmtPrazoWeek(date: string | null | undefined): {
  label: string;
  sublabel: string | null;
  isHuman: boolean;
} {
  if (!date) return { label: "—", sublabel: null, isHuman: false };
  return { label: fmtDate(date) ?? "—", sublabel: null, isHuman: false };
}

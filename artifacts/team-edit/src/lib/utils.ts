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
  if (date.includes("T")) {
    const dt = new Date(date);
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const h = String(dt.getHours()).padStart(2, "0");
    const min = String(dt.getMinutes()).padStart(2, "0");
    return `${d}/${m}/${dt.getFullYear()} às ${h}:${min}`;
  }
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
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

  if (diff < 0)   return { text: `atrasado ${fmt(abs)}`, cls: "text-red-500" };
  if (diff === 0) return { text: "vence hoje", cls: "text-amber-500 font-semibold" };
  if (diff === 1) return { text: "falta 1 dia", cls: "text-amber-500" };
  if (diff <= 3)  return { text: `faltam ${fmt(diff)}`, cls: "text-amber-400" };
  return { text: `faltam ${fmt(diff)}`, cls: "text-[hsl(var(--muted-foreground))]" };
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
): { line1: string; line2: string | null; cls: string } | null {
  if (status !== "completed" && status !== "cancelled") return null;

  // Humanise the closure date (updatedAt)
  const closed   = new Date(updatedAt);
  const closedDay = new Date(closed.getFullYear(), closed.getMonth(), closed.getDate());
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const diffClose = Math.round((closedDay.getTime() - today.getTime()) / 86_400_000);

  const fmtDay = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  };

  const closedLabel =
    diffClose === 0  ? "hoje" :
    diffClose === -1 ? "ontem" :
    fmtDay(closed);

  if (status === "cancelled") {
    return { line1: `Cancelada ${closedLabel}`, line2: null, cls: "text-[hsl(var(--muted-foreground))]/60" };
  }

  // status === "completed"
  const line1 = `Entregue ${closedLabel}`;

  if (!dueDate) {
    return { line1, line2: null, cls: "text-emerald-600" };
  }

  const dueDay  = new Date(dueDate.includes("T") ? dueDate : dueDate + "T00:00");
  const lateDays = Math.round((closedDay.getTime() - dueDay.getTime()) / 86_400_000);

  if (lateDays <= 0) {
    return { line1, line2: "No prazo ✓", cls: "text-emerald-600" };
  }

  const d = lateDays;
  const plural = d === 1 ? "dia" : "dias";
  return { line1, line2: `${d} ${plural} de atraso`, cls: "text-amber-600" };
}

export function fmtDateHuman(date: string | null | undefined): string | null {
  if (!date) return null;
  const hasTime = date.includes("T");
  const dt = hasTime
    ? new Date(date)
    : (() => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d); })();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dtDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((dtDay.getTime() - today.getTime()) / 86_400_000);
  const h = hasTime ? dt.getHours() : -1;
  const period = h >= 5 && h < 12 ? " pela manhã"
    : h >= 12 && h < 18 ? " à tarde"
    : h >= 18 ? " à noite"
    : "";
  if (diff === 0)  return `Hoje${period}`;
  if (diff === -1) return `Ontem${period}`;
  if (diff === 1)  return `Amanhã${period}`;
  if (diff > 1 && diff <= 7) {
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    return `${days[dt.getDay()]}${period}`;
  }
  return fmtDate(date);
}

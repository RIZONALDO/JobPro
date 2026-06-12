/**
 * JobPro — Utilitários canônicos de data/hora
 *
 * CONTRATO:
 *  - Frontend → Backend : ISO com offset local, ex: "2026-06-10T08:00:00-03:00"
 *  - Backend  → Frontend : UTC com Z,         ex: "2026-06-10T11:00:00.000Z"
 *  - Date-only strings   : tratadas como LOCAL (não UTC midnight)
 *
 * PROIBIDO em qualquer outro arquivo:
 *  - new Date("YYYY-MM-DD")           → UTC midnight, quebra em UTC- na virada do dia
 *  - new Date().toISOString().slice(0,10) → UTC date, pode ser ontem no Brasil
 *  - timestamp + "Z"                  → força UTC, ignora fuso do usuário
 */

// ── Primitivos ────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" da data em fuso LOCAL */
export function toLocalDateStr(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

/** "YYYY-MM-DD" de hoje no fuso LOCAL */
export function todayStr(): string {
  return toLocalDateStr(new Date());
}

/** Offset do fuso local, ex: "-03:00" para BRT */
export function localTzOffset(): string {
  const off  = new Date().getTimezoneOffset(); // minutos atrás do UTC
  const sign = off <= 0 ? "+" : "-";
  const abs  = Math.abs(off);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Converte qualquer string ISO para Date de forma segura:
 *  - "YYYY-MM-DD"          → local noon (evita virada UTC midnight)
 *  - "YYYY-MM-DDTHH:MM..." → new Date() normal (preserva TZ se presente)
 */
export function parseDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0); // local noon
  }
  return new Date(s);
}

// ── Para envio ao backend ─────────────────────────────────────────────────────

/**
 * Monta ISO com offset do fuso LOCAL do browser para enviar ao backend.
 * O offset é dinâmico — funciona para qualquer fuso, não só Brasil.
 * ex (UTC-3): localISOString("2026-06-10", "08:00") → "2026-06-10T08:00:00-03:00"
 * ex (UTC+1): localISOString("2026-06-10", "08:00") → "2026-06-10T08:00:00+01:00"
 */
export function localISOString(date: string, time = "00:00"): string {
  return `${date}T${time}:00${localTzOffset()}`;
}

// ── Formatação para exibição ──────────────────────────────────────────────────

/**
 * "10/06" ou "10/06 às 8h"
 *
 * A parte do DIA é sempre extraída da string ("YYYY-MM-DD" antes do "T"),
 * nunca via getDate() sobre UTC — evita o shift de -1 dia em UTC-.
 * A parte da HORA usa getHours() local (correto para exibição).
 * UTC midnight (00:00Z) é tratado como "data sem hora intencional" → omite hora.
 */
export function fmtDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [, m, d] = date.slice(0, 10).split("-").map(Number);
  const base = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  if (!date.includes("T")) return base;
  const dt = new Date(date);
  if (isNaN(dt.getTime())) return base;
  // UTC midnight = armazenado sem hora intencional → só data
  if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0) return base;
  const h   = dt.getHours();
  const min = dt.getMinutes();
  if (h === 0 && min === 0) return base;
  return min === 0
    ? `${base} às ${h}h`
    : `${base} às ${h}h${String(min).padStart(2, "0")}`;
}

/** "10/06/2026" — data completa com ano */
export function fmtDateFull(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "10/06 às 08:30" — para timestamps curtos (histórico, revisões) */
export function fmtShort(date: string | null | undefined): string | null {
  if (!date) return null;
  const dt = new Date(date);
  if (isNaN(dt.getTime())) return null;
  const [, m, d] = date.slice(0, 10).split("-").map(Number);
  const h   = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} às ${h}:${min}`;
}

/**
 * { date: "10/06", time: "14:30" | null }
 * Para exibição compacta em duas linhas.
 */
export function fmtDateParts(
  date: string | null | undefined,
): { date: string; time: string | null } | null {
  if (!date) return null;
  const [, m, d] = date.slice(0, 10).split("-").map(Number);
  const dateStr = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  if (!date.includes("T")) return { date: dateStr, time: null };
  const dt = new Date(date);
  if (isNaN(dt.getTime())) return { date: dateStr, time: null };
  if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0) return { date: dateStr, time: null };
  const h   = dt.getHours();
  const min = dt.getMinutes();
  if (h === 0 && min === 0) return { date: dateStr, time: null };
  return {
    date: dateStr,
    time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
  };
}

// ── Aritmética de dias ────────────────────────────────────────────────────────

/**
 * Diferença em dias entre uma data e hoje (positivo = futuro, negativo = passado).
 * Usa a parte YYYY-MM-DD da string diretamente, nunca UTC Date.
 */
export function daysFromToday(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now    = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/** Badge de prazo: texto + classe de cor */
export function fmtDaysLeft(
  date: string | null | undefined,
): { text: string; cls: string } | null {
  if (!date) return null;
  const diff = daysFromToday(date);
  const abs  = Math.abs(diff);

  const fmt = (n: number) => {
    const months = Math.floor(n / 30);
    const days   = n % 30;
    if (months === 0) return `${days} ${days === 1 ? "dia" : "dias"}`;
    if (days === 0)   return `${months} ${months === 1 ? "mês" : "meses"}`;
    return `${months} ${months === 1 ? "mês" : "meses"} e ${days} ${days === 1 ? "dia" : "dias"}`;
  };

  if (diff < 0)   return { text: `${abs}d em atraso`,   cls: "text-red-500" };
  if (diff === 0) return { text: "entrega hoje",         cls: "text-amber-500 font-semibold" };
  if (diff === 1) return { text: "entrega amanhã",       cls: "text-amber-500" };
  if (diff <= 7)  return { text: fmt(diff),              cls: "text-amber-400" };
  return           { text: fmt(diff),                    cls: "text-[hsl(var(--muted-foreground))]" };
}

/** True se o expediente de hoje (08–18h) já encerrou */
export function workdayOver(): boolean {
  const h = new Date().getHours();
  return h >= 18 || h < 8; // antes das 08:00 ou depois das 18:00 → expediente encerrado
}

/** Data de amanhã como "YYYY-MM-DD" */
export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalDateStr(d);
}

/**
 * Data mínima selecionável para início de tarefa.
 * Se o expediente de hoje já encerrou, retorna amanhã.
 */
export function earliestStartDate(): string {
  return workdayOver() ? tomorrowStr() : todayStr();
}

// ── Próxima meia hora (para bloquear horários passados) ───────────────────────

/** "HH:MM" da próxima meia hora a partir de agora */
export function nextHalfHour(): string {
  const now = new Date();
  const h   = now.getHours();
  const m   = now.getMinutes();
  const nh  = m < 30 ? h : (h + 1) % 24;
  const nm  = m < 30 ? 30 : 0;
  if (h >= 23 && m >= 30) return "23:30";
  return `${String(nh).padStart(2, "0")}:${nm === 0 ? "00" : "30"}`;
}

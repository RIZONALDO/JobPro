/**
 * Datas da fila em "minutos locais": minutos desde 1970-01-01 00:00 no horário de Brasília
 * (UTC−3, sem horário de verão desde 2019). Assim um dia é sempre 1440 minutos e
 * `Math.floor(t / 1440)` é o dia local, sem depender do fuso do servidor.
 *
 * Expediente: seg–sex 08:30–12:00 e 14:00–18:30 (8h); sábado 08:30–13:00 (4h30); domingo, feriado
 * e ausência do editor (férias, folga, afastamento) não têm expediente. As horas de trabalho de cada job
 * são consumidas só dentro dele (`consume`), e o cron só avisa dentro dele.
 */

export const TZ_OFFSET = -180;
export const DAY = 1440;

export const SHIFTS: Record<"weekday" | "saturday", [number, number][]> = {
  weekday: [[510, 720], [840, 1110]],
  saturday: [[510, 780]],
};

export interface Absence { start: string; end: string; label: string }
export interface Calendar {
  holidays: Map<string, string>;          // "YYYY-MM-DD" → nome
  absences: Map<number, Absence[]>;       // editorId → ausências
}

export const toLm = (d: Date | number): number => Math.floor((typeof d === "number" ? d : d.getTime()) / 60000) + TZ_OFFSET;
export const fromLm = (lm: number): Date => new Date((lm - TZ_OFFSET) * 60000);
export const isoLm = (lm: number | null | undefined): string | null => lm == null ? null : fromLm(lm).toISOString();
export const dayKey = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);
export const weekday = (day: number): number => new Date(day * 86_400_000).getUTCDay();

/** Motivo de o dia não ter expediente (para mostrar na tela), ou null. */
export function dayOff(cal: Calendar, day: number, editorId?: number | null): string | null {
  const key = dayKey(day);
  const h = cal.holidays.get(key);
  if (h) return h;
  if (weekday(day) === 0) return "Domingo";
  if (editorId != null) {
    const a = cal.absences.get(editorId)?.find(x => x.start <= key && x.end >= key);
    if (a) return a.label;
  }
  return null;
}

export function periods(cal: Calendar, day: number, editorId?: number | null): [number, number][] {
  if (dayOff(cal, day, editorId)) return [];
  return weekday(day) === 6 ? SHIFTS.saturday : SHIFTS.weekday;
}

/** Consome `m` minutos de expediente a partir de `t`. Devolve o início real (1º minuto de expediente) e o fim. */
export function consume(cal: Calendar, t: number, m: number, editorId?: number | null): { start: number; end: number } {
  let cur = t, start: number | null = null;
  for (let d = Math.floor(t / DAY), g = 0; g < 1500; d++, g++) {
    for (const [a, b] of periods(cal, d, editorId)) {
      const A = d * DAY + a, B = d * DAY + b;
      if (B <= cur) continue;
      const s = Math.max(A, cur);
      if (start === null) start = s;
      if (m <= 0) return { start, end: start };
      const take = Math.min(B - s, m);
      m -= take; cur = s + take;
      if (m <= 0) return { start, end: cur };
    }
  }
  return { start: start ?? t, end: cur };
}

/** Minutos de expediente entre `a` e `b` (0 se b ≤ a). */
export function workBetween(cal: Calendar, a: number, b: number, editorId?: number | null): number {
  let m = 0;
  for (let d = Math.floor(a / DAY); d * DAY < b; d++) {
    for (const [x, y] of periods(cal, d, editorId)) m += Math.max(0, Math.min(b, d * DAY + y) - Math.max(a, d * DAY + x));
  }
  return m;
}

/** Volta `m` minutos de expediente a partir de `t` (o contrário de `consume`). */
export function consumeBack(cal: Calendar, t: number, m: number, editorId?: number | null): number {
  let cur = t;
  for (let d = Math.floor(t / DAY), g = 0; g < 1500 && m > 0; d--, g++) {
    for (const [a, b] of [...periods(cal, d, editorId)].reverse()) {
      const A = d * DAY + a, B = d * DAY + b;
      if (A >= cur) continue;
      const e = Math.min(B, cur), take = Math.min(e - A, m);
      m -= take; cur = e - take;
      if (m <= 0) return cur;
    }
  }
  return cur;
}

/** Minutos de expediente de `a` até `b`, com sinal (negativo se `b` vem antes). */
export const workDelta = (cal: Calendar, a: number, b: number, editorId?: number | null): number =>
  b >= a ? workBetween(cal, a, b, editorId) : -workBetween(cal, b, a, editorId);

/** Anda `d` minutos de expediente a partir de `t` (para trás se negativo). */
export const shiftWork = (cal: Calendar, t: number, d: number, editorId?: number | null): number =>
  d > 0 ? consume(cal, t, d, editorId).end : d < 0 ? consumeBack(cal, t, -d, editorId) : t;

/** Está dentro do expediente agora? */
export function isWorking(cal: Calendar, t: number, editorId?: number | null): boolean {
  const d = Math.floor(t / DAY), m = t - d * DAY;
  return periods(cal, d, editorId).some(([a, b]) => m >= a && m < b);
}

const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const p2 = (n: number) => String(n).padStart(2, "0");
export function fmtLm(lm: number): string {
  const d = Math.floor(lm / DAY), mi = lm - d * DAY, dt = new Date(d * 86_400_000);
  return `${WD[dt.getUTCDay()]} ${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)} ${p2(Math.floor(mi / 60))}:${p2(mi % 60)}`;
}
export function fmtH(m: number): string {
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  return !h ? `${r}min` : r ? `${h}h${p2(r)}` : `${h}h`;
}

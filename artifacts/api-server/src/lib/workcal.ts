/**
 * Calendário de trabalho (CLT) da fila em horas.
 *
 * Todo o cálculo usa "minutos locais": minutos desde 1970-01-01 00:00 no horário de Brasília
 * (UTC−3, sem horário de verão desde 2019). Assim um dia é sempre 1440 minutos e
 * `Math.floor(t / 1440)` é o dia local, sem depender do fuso do servidor.
 *
 * Expediente: seg–sex 08:30–12:00 e 14:00–18:30 (8h); sábado 08:30–13:00 (4h30); domingo, feriado
 * e ausência do editor (férias, folga, afastamento) não têm expediente.
 */

export const TZ_OFFSET = -180;
export const DAY = 1440;
/** Reserva quando as horas estimadas acabam e o editor ainda não disse quanto falta. */
export const RESERVA = 60;

export const SHIFTS: Record<"weekday" | "saturday", [number, number][]> = {
  weekday: [[510, 720], [840, 1110]],
  saturday: [[510, 780]],
};
/** Expediente de uma semana cheia: 5 × 8h + 4h30 = 44h30. */
export const WEEK_MINUTES = 5 * 480 + 270;

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

export const dayCap = (cal: Calendar, day: number, editorId?: number | null): number =>
  periods(cal, day, editorId).reduce((s, [a, b]) => s + b - a, 0);

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const turnos = (ps: [number, number][]) => ps.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(" e ");
export const DUE_OFF_SHIFT = `O prazo precisa cair no expediente: seg a sex ${turnos(SHIFTS.weekday)}, sáb ${turnos(SHIFTS.saturday)}. Almoço, noite, domingo e feriado não valem.`;

/** O prazo cai dentro do expediente? O fim do turno conta; almoço, noite, domingo e feriado não. */
export function inShift(cal: Calendar, t: number): boolean {
  const d = Math.floor(t / DAY), m = t - d * DAY;
  return periods(cal, d).some(([a, b]) => m > a && m <= b);
}

/** Consome `m` minutos de expediente a partir de `t`. Devolve início real, fim e os trechos usados. */
export function consume(cal: Calendar, t: number, m: number, editorId?: number | null): { start: number; end: number; segs: [number, number][] } {
  const segs: [number, number][] = [];
  let cur = t, start: number | null = null;
  for (let d = Math.floor(t / DAY), g = 0; g < 1500; d++, g++) {
    for (const [a, b] of periods(cal, d, editorId)) {
      const A = d * DAY + a, B = d * DAY + b;
      if (B <= cur) continue;
      const s = Math.max(A, cur);
      if (start === null) start = s;
      if (m <= 0) return { start, end: start, segs };
      const take = Math.min(B - s, m);
      segs.push([s, s + take]); m -= take; cur = s + take;
      if (m <= 0) return { start, end: cur, segs };
    }
  }
  return { start: start ?? t, end: cur, segs };
}

/** Minutos de expediente entre a e b. */
export function workBetween(cal: Calendar, a: number, b: number, editorId?: number | null): number {
  if (b <= a) return 0;
  let s = 0;
  for (let d = Math.floor(a / DAY); d <= Math.floor(b / DAY); d++) {
    for (const [p, q] of periods(cal, d, editorId)) s += Math.max(0, Math.min(d * DAY + q, b) - Math.max(d * DAY + p, a));
  }
  return s;
}

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

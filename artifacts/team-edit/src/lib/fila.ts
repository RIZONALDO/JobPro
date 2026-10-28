/**
 * Fila — tipos e utilitários do front. Uma lista em ordem por editor; cada job tem horas de trabalho e o prazo
 * de entrega é calculado pelo servidor (horas na ordem da fila, no expediente, + 1h). Mover recalcula os prazos.
 * Os horários chegam da API em "minutos locais" (minutos desde 1970 no horário de Brasília),
 * o mesmo formato do servidor (api-server/src/lib/workcal.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useRealtime } from "@/hooks/use-realtime";

export const DAY = 1440;

export interface QTask {
  id: number; code: string; title: string; client: string | null; color: string; folderUrl: string | null; description: string | null;
  status: string; editorId: number | null; coordId: number | null; followerIds: number[];
  /** em edição agora (o editor tocou em "Começar"); não sai mais da frente da fila */
  playing: boolean; order: number; hold: boolean;
  /** posição na fila do editor (0 = o próximo / o atual), null fora da fila */
  pos: number | null;
  /** prazo de entrega (calculado); atrasado = passou do prazo e não foi entregue */
  promised: number | null; late: boolean;
  /** horas de trabalho (minutos) */
  est: number;
  revisionCount: number; sentAt: number | null; blockReason: string | null;
  /** só em job travado: desde quando e se o prazo está em risco (vencido ou vence em menos de 24h) */
  blocked: { since: number | null; critical: boolean } | null;
}
export interface QEditor {
  id: number; name: string; avatarUrl: string | null; inactive: boolean;
  /** jobs na fila, quantos atrasados e quantos de cada gestor */
  count: number; late: number; byCoord: Record<number, number>;
  offToday: string | null;
  /** esteira: jobs colados em minutos de expediente a partir de agora (a→b), pela conta ao vivo; ausências; quando fica livre */
  track?: QTrack;
}
export interface QTrackItem { id: number; a: number; b: number; start: number; end: number; due: number; done: number; over: number }
export interface QTrack { items: QTrackItem[]; freeAt: number; free: number; off: { a: number; b: number; label: string }[]; offDays: { day: number; off: string }[] }
/** régua da esteira: trecho de expediente de cada dia (largura 0 = sem expediente) */
export interface QAxisDay { day: number; a: number; b: number; off: string | null }
export interface Person { id: number; name: string; role: string; avatarUrl: string | null }
export interface Board {
  now: number; me: number; role: string;
  editors: QEditor[]; people: Person[]; tasks: QTask[];
  /** últimos 30 dias: jobs que a pessoa moveu na fila e alterações do cliente nos jobs dela */
  stats?: Record<number, { moves: number; changes: number }>;
  holidays?: Record<string, string>;
  axis?: QAxisDay[];
}
/** "YYYY-MM-DD" do dia local (número de dias desde 1970). */
export const dayKeyOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
export const fmtDayKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return fmtDay(Math.round(Date.UTC(y, m - 1, d) / 86_400_000)); };

export const QUEUE_STATUSES = ["pending", "in_progress", "in_revision", "reopened"];
export const inQueue = (t: QTask) => t.editorId != null && !t.hold && QUEUE_STATUSES.includes(t.status);

/* ── formatação ── */
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const p2 = (n: number) => String(n).padStart(2, "0");
const dt = (day: number) => new Date(day * 86_400_000);
export function fmt(lm: number | null | undefined): string {
  if (lm == null) return "—";
  const d = Math.floor(lm / DAY), mi = lm - d * DAY, x = dt(d);
  return `${WD[x.getUTCDay()]} ${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)} ${p2(Math.floor(mi / 60))}:${p2(mi % 60)}`;
}
export function fmtDay(day: number): string { const x = dt(day); return `${WD[x.getUTCDay()]} ${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}`; }
export function fmtH(m: number | null | undefined): string {
  if (m == null) return "—";
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  return !h ? `${r}min` : r ? `${h}h${p2(r)}` : `${h}h`;
}
/** minutos locais → ISO (para enviar à API) */
export const lmToIso = (lm: number) => new Date((lm + 180) * 60000).toISOString();
/** Date/ISO → minutos locais */
export const toLm = (d: Date | string) => Math.floor(new Date(d).getTime() / 60000) - 180;

/* ── cores por coordenador (estáveis) ── */
// Paleta análoga e fria (azul → ciano → verde-água → verde → lima), tons 300–600 do Tailwind sobre o fundo escuro:
// harmônica, com cara de tecnologia; as vizinhas na ordem variam de matiz e claridade para não se confundirem.
// Sem vermelho (na fila lê como alerta) e sem roxo (cor do sistema, marca "seus jobs" na agenda).
// As gestoras ativas ganham as primeiras cores, pela ordem de cadastro; supervisão, admin e inativos vêm depois.
const PALETTE = ["#0ea5e9", "#a3e635", "#22d3ee", "#10b981", "#2563eb", "#4d7c0f", "#93c5fd", "#2dd4bf",
  "#65a30d", "#0e7490", "#86efac", "#1e40af", "#5eead4", "#bef264"];
let coordRank = new Map<number, number>();
/** Chamado ao carregar o quadro: fixa a ordem dos gestores (ativas primeiro, por id). */
export function registerCoords(people: Person[]) {
  const others = people.filter(p => p.role !== "editor");
  const first = others.filter(p => p.role === "coordinator").map(p => p.id).sort((a, b) => a - b);
  const rest = others.filter(p => p.role !== "coordinator").map(p => p.id).sort((a, b) => a - b);
  coordRank = new Map([...first, ...rest].map((id, i) => [id, i]));
}
export function coordColor(id: number | null | undefined): string {
  if (!id) return "#71717a";
  return PALETTE[(coordRank.get(id) ?? id * 7) % PALETTE.length];
}
/** Texto legível sobre a cor cheia (preto nas claras, branco nas escuras). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "rgb(0 0 0 / 0.85)" : "#fff";
}

/* ── chips de prazo ── */
export function deadlineState(t: Pick<QTask, "promised" | "status">, now: number): { label: string; tone: "ok" | "warn" | "bad" | "neu" } {
  if (t.promised == null) return { label: "sem prazo", tone: "neu" };
  if (["review", "completed", "cancelled"].includes(t.status)) return { label: `prazo ${fmt(t.promised)}`, tone: "neu" };
  if (t.promised <= now) return { label: "atrasado", tone: "bad" };
  const today = Math.floor(now / DAY), d = Math.floor(t.promised / DAY);
  if (d === today) return { label: `vence hoje ${fmt(t.promised).slice(-5)}`, tone: "warn" };
  if (d === today + 1) return { label: `vence amanhã ${fmt(t.promised).slice(-5)}`, tone: "neu" };
  return { label: `prazo ${fmt(t.promised)}`, tone: "neu" };
}
/** Frase do prazo de um job travado (espelho de blockRisk na API). */
export function blockedLine(t: QTask, now: number): string {
  if (t.promised == null) return "sem prazo";
  if (t.promised <= now) return `prazo vencido (${fmt(t.promised)})`;
  return `prazo ${fmt(t.promised)}${t.blocked?.critical ? " · vence em menos de 24h" : ""}`;
}

export const TONE: Record<string, string> = {
  ok: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  bad: "bg-rose-500/14 text-rose-600 dark:text-rose-400",
  neu: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  acc: "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]",
};

/** Carrega o quadro da fila e mantém atualizado (realtime + relógio a cada 30s). */
export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<Board>("/api/queue/board").then(b => { registerCoords(b.people); setBoard(b); setError(null); }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useRealtime({ onTasksChanged: load });
  return { board, error, reload: load };
}

export const personName = (b: Board, id: number | null | undefined) => (id ? b.people.find(p => p.id === id)?.name ?? "—" : "—");
export const firstName = (n: string) => n.split(" ")[0];

/* ── leitura da fila de um editor (colunas e linhas usam a mesma) ── */
/** "hoje 14:00", "amanhã 08:30" ou "qui 16/10 14:00" (minutos locais) */
export function relDay(lm: number, now: number) {
  const d = Math.floor(lm / DAY) - Math.floor(now / DAY), hh = fmt(lm).slice(-5);
  return d === 0 ? `hoje ${hh}` : d === 1 ? `amanhã ${hh}` : fmt(lm);
}
/** Duração curta: "2d 3h", "5h", "40min". */
export function dur(m: number) {
  m = Math.max(0, Math.round(m));
  const d = Math.floor(m / DAY), h = Math.floor((m % DAY) / 60), mi = m % 60;
  return d ? `${d}d${h ? ` ${h}h` : ""}` : h ? `${h}h${mi ? p2(mi) : ""}` : `${mi}min`;
}
/** Feriado ou domingo (sem expediente para todos), ou null. */
export function teamOffDay(board: Pick<Board, "holidays">, day: number): string | null {
  return board.holidays?.[dayKeyOf(day)] ?? (dt(day).getUTCDay() === 0 ? "domingo" : null);
}
export const RISK_MIN = 24 * 60;
export interface QLineItem {
  t: QTask;
  late: boolean;          // prazo vencido
  risk: boolean;          // tem job atrasado na frente e o prazo dele vence em menos de 24h
  gap: number | null;     // minutos desde o prazo do job anterior (null no 1º)
  off: string[];          // dias sem expediente no meio desse intervalo
}
/** Fila do editor na ordem, com folga entre prazos, atraso e risco; e quando ele fica livre. */
export function queueLine(board: Board, editorId: number): { items: QLineItem[]; freeFrom: number } {
  const now = board.now;
  const q = board.tasks.filter(t => inQueue(t) && t.editorId === editorId).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  let lateAhead = false, prev: number | null = null, freeFrom = now;
  const items = q.map(t => {
    const p = t.promised;
    const late = p != null && p <= now;
    const risk = !late && lateAhead && p != null && p - now < RISK_MIN;
    if (late) lateAhead = true;
    const off: string[] = [];
    if (prev != null && p != null)
      for (let d = Math.floor(prev / DAY) + 1; d < Math.floor(p / DAY); d++) { const w = teamOffDay(board, d); if (w && !off.includes(w)) off.push(w); }
    const gap = prev != null && p != null ? p - prev : null;
    if (p != null) { prev = p; freeFrom = Math.max(freeFrom, p); }
    return { t, late, risk, gap, off };
  });
  return { items, freeFrom };
}

/* ── simulação da fila no navegador (mesma conta da API: lib/queue.ts `schedule`), para a prévia ao arrastar ── */
/** margem entre o fim das horas e o prazo de entrega (minutos de expediente), igual à API */
export const BUFFER = 60;
/** expediente do editor num dia (minutos do dia): feriado, domingo e ausência dele não têm */
export function workPeriods(board: Board, day: number, editorId: number): [number, number][] {
  if (teamOffDay(board, day)) return [];
  if (board.editors.find(e => e.id === editorId)?.track?.offDays.some(o => o.day === day)) return [];
  return dt(day).getUTCDay() === 6 ? [[510, 780]] : [[510, 720], [840, 1110]];
}
/** consome `m` minutos de expediente do editor a partir de `t` */
export function consumeWork(board: Board, editorId: number, t: number, m: number): { start: number; end: number } {
  let cur = t, start: number | null = null;
  for (let d = Math.floor(t / DAY), g = 0; g < 400; d++, g++) {
    for (const [a, b] of workPeriods(board, d, editorId)) {
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
export interface PlanItem { id: number; start: number; end: number; due: number }
/** fila de um editor na ordem `ids`: cada job começa quando o anterior termina; o em edição fica onde está */
export function simulateQueue(board: Board, editorId: number, ids: number[]): PlanItem[] {
  const out: PlanItem[] = [];
  let cur = board.now;
  for (const id of ids) {
    const t = board.tasks.find(x => x.id === id);
    if (!t) continue;
    const cur0 = t.playing ? board.editors.flatMap(e => e.track?.items ?? []).find(i => i.id === id) : undefined;
    const w = cur0 ? { start: cur0.start, end: cur0.end } : consumeWork(board, editorId, cur, Math.max(0, t.est));
    out.push({ id, start: w.start, end: w.end, due: consumeWork(board, editorId, w.end, BUFFER).end });
    cur = Math.max(cur, w.end);
  }
  return out;
}
/** filas como ficariam movendo `id` para a posição `index` da fila de `toEd` (só as filas que mudam) */
export function planMove(board: Board, id: number, fromEd: number, toEd: number, index: number): Map<number, PlanItem[]> {
  const order = (ed: number) => board.tasks.filter(t => inQueue(t) && t.editorId === ed).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)).map(t => t.id);
  const plan = new Map<number, PlanItem[]>();
  const from = order(fromEd).filter(x => x !== id);
  const to = fromEd === toEd ? from : order(toEd);
  const min = board.tasks.find(t => t.id === to[0])?.playing ? 1 : 0;
  to.splice(Math.max(min, Math.min(index, to.length)), 0, id);
  plan.set(toEd, simulateQueue(board, toEd, to));
  if (fromEd !== toEd) plan.set(fromEd, simulateQueue(board, fromEd, from));
  return plan;
}

/* ── ocupação do editor: horas de trabalho somadas na fila (dia de expediente = 8h) ── */
export type OccLevel = "livre" | "leve" | "cheia" | "alta";
export const OCC = {
  livre: { label: "Livre", color: "#71717a", hint: "sem jobs na fila" },
  leve: { label: "Leve", color: "#10b981", hint: "até 2 dias de trabalho" },
  cheia: { label: "Cheia", color: "#f59e0b", hint: "de 2 a 4 dias de trabalho" },
  alta: { label: "Alta", color: "#f43f5e", hint: "mais de 4 dias de trabalho" },
} as const;
/** escala da barrinha: 5 dias de trabalho enchem a barra */
export const OCC_FULL = 5 * 480;
export function occupancy(board: Board, editorId: number): { min: number; days: number; level: OccLevel } {
  const items = board.editors.find(e => e.id === editorId)?.track?.items ?? [];
  // tamanho da fila: soma das horas de todos os jobs (o mesmo número de "na fila" da agenda); fila maior = mais carregado
  const min = items.reduce((s, it) => {
    const t = board.tasks.find(x => x.id === it.id);
    return t && inQueue(t) ? s + t.est : s;
  }, 0);
  const days = min / 480;
  return { min, days, level: min <= 0 ? "livre" : days <= 2 ? "leve" : days <= 4 ? "cheia" : "alta" };
}
/** cor da ocupação pelas 3 faixas: verde até 2 dias, âmbar de 2 a 4, vermelho acima de 4 (cinza quando vazia) */
export function occColor(min: number): string {
  const d = min / 480;
  return OCC[min <= 0 ? "livre" : d <= 2 ? "leve" : d <= 4 ? "cheia" : "alta"].color;
}
/** "3 dias e 2h", "5h30", "—" */
export function workDays(min: number): string {
  if (min <= 0) return "—";
  const d = Math.floor(min / 480), r = min - d * 480;
  return d ? `${d} dia${d > 1 ? "s" : ""}${r >= 30 ? ` e ${fmtH(r)}` : ""}` : fmtH(min);
}

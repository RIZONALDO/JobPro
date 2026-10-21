/**
 * Fila em horas — tipos e utilitários do front.
 * Os horários chegam da API em "minutos locais" (minutos desde 1970 no horário de Brasília),
 * o mesmo formato do motor no servidor (api-server/src/lib/workcal.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useRealtime } from "@/hooks/use-realtime";

export const DAY = 1440;

export interface Slot {
  start: number; end: number; segs: [number, number][];
  late: boolean; lateBy: number | null; pos: number; filled: number | null; gapBefore: number;
}
export interface QTask {
  id: number; code: string; title: string; client: string | null; color: string; folderUrl: string | null; description: string | null;
  status: string; editorId: number | null; coordId: number | null; followerIds: number[];
  est: number; worked: number; playing: boolean; order: number; hold: boolean;
  notBefore: number | null; lockReason: string | null; promised: number | null; promisedOriginal: number | null;
  estConfirmed: boolean; estCoord: number | null; estEditor: number | null; estDisputeOpen: boolean; estOwnerId: number | null;
  waitingEst: boolean; revisionCount: number; sentAt: number | null; blockReason: string | null;
  slot: Slot | null;
  /** só em job travado: desde quando, expediente parado e a entrega se destravar agora */
  blocked: { since: number | null; stopped: number | null; ifNow: { end: number; late: boolean; lateBy: number | null } | null; critical: boolean } | null;
}
export interface QEditor {
  id: number; name: string; avatarUrl: string | null; inactive: boolean;
  queueMinutes: number; byCoord: Record<number, number>; freeFrom: number; idleMinutes: number;
  offToday: string | null; offDays: { day: number; off: string }[]; todayCap: number; todayDone: number;
}
export interface QRequest {
  id: number; kind: "first" | "swap" | "insert" | "reassign"; taskId: number; swapWithId: number | null; editorId: number;
  requestedById: number; approverId: number | null; status: string; impacts: string[]; passed: number; escalated: boolean; createdAt: number;
}
export interface QDay { day: number; key: string; periods: [number, number][]; off: string | null }
export interface Person { id: number; name: string; role: string; avatarUrl: string | null }
export interface Board {
  now: number; limit: number; weekMinutes: number; me: number; role: string;
  editors: QEditor[]; people: Person[]; tasks: QTask[]; requests: QRequest[]; days: QDay[];
  stats?: Record<number, { furou: number; contest: number; reneg: number; changes: number }>;
}
export const fmtDayKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return fmtDay(Math.round(Date.UTC(y, m - 1, d) / 86_400_000)); };

export const QUEUE_STATUSES = ["pending", "in_progress", "in_revision", "reopened"];
export const inQueue = (t: QTask) => t.editorId != null && !t.hold && QUEUE_STATUSES.includes(t.status);
export const rem = (t: QTask) => (t.est - t.worked > 0 ? t.est - t.worked : 60);

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
const PALETTE = ["#2dd4bf", "#f5a524", "#f472b6", "#60a5fa", "#a3e635", "#c084fc", "#fb7185", "#34d399", "#fbbf24", "#38bdf8"];
export function coordColor(id: number | null | undefined): string {
  if (!id) return "#71717a";
  return PALETTE[(id * 7) % PALETTE.length];
}

/* ── chips de prazo ── */
export function deadlineState(t: QTask, now: number): { label: string; tone: "ok" | "warn" | "bad" | "neu" } {
  if (t.promised == null) return { label: "sem prazo", tone: "neu" };
  if (t.promised <= now && !["review", "completed"].includes(t.status)) return { label: "prazo vencido", tone: "bad" };
  const s = t.slot;
  if (!s) return { label: `prazo ${fmt(t.promised)}`, tone: "neu" };
  if (s.late) return { label: `vai atrasar ${fmtH(s.lateBy)}`, tone: "bad" };
  if (s.lateBy != null && -s.lateBy < 120) return { label: "prazo justo", tone: "warn" };
  return { label: "no prazo", tone: "ok" };
}
/** Frase do prazo de um job travado (espelho de blockRisk na API). */
export function blockedLine(t: QTask, now: number): string {
  const b = t.blocked;
  if (t.promised == null) return "sem prazo";
  if (t.promised <= now) return `prazo vencido (${fmt(t.promised)})`;
  if (!b?.ifNow) return `prazo ${fmt(t.promised)}`;
  if (b.ifNow.late) return `prazo ${fmt(t.promised)} · mesmo destravando agora, atrasa ${fmtH(b.ifNow.lateBy)}`;
  return `prazo ${fmt(t.promised)} · destravando agora, pronto ${fmt(b.ifNow.end)}${b.ifNow.lateBy != null ? ` (folga ${fmtH(-b.ifNow.lateBy)})` : ""}`;
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
    apiFetch<Board>("/api/queue/board").then(b => { setBoard(b); setError(null); }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useRealtime({ onTasksChanged: load });
  return { board, error, reload: load };
}

export const personName = (b: Board, id: number | null | undefined) => (id ? b.people.find(p => p.id === id)?.name ?? "—" : "—");
export const firstName = (n: string) => n.split(" ")[0];

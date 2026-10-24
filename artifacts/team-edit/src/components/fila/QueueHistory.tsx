/**
 * Fila de um editor, contada por job: a ordem de agora e, em cada job, a história do prazo dele
 * ("era X, ficou Y, porque fulano moveu tal job"). Fechada por padrão; abre só o job que interessa.
 * Embaixo, "Tudo o que mudou", com movimentos seguidos da mesma pessoa no mesmo job juntados numa frase.
 * Dados: GET /api/queue/editors/:id/history (ordem atual + eventos agrupados por ação, com os `due_auto`).
 */
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { History, ChevronRight } from "@/lib/icons";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DAY, fmt, fmtH } from "@/lib/fila";

interface Change { taskId: number | null; title: string; from: number | null; to: number | null; fromText: string | null; toText: string | null }
interface Cause { kind: string; text: string | null; taskId: number | null; title: string | null; data: Record<string, unknown> | null; left: boolean }
interface Episode { at: number; actorId: number | null; actor: string | null; cause: Cause | null; changes: Change[] }
interface QueueItem { pos: number; id: number; title: string; est: number; due: number | null; playing: boolean; late: boolean; client: string | null }
interface HistoryData { editorId: number; days: number; now: number; queue: QueueItem[]; episodes: Episode[] }

const muted = "text-[hsl(var(--muted-foreground))]";
const MIN_SHOWN = 15;     // mudança de prazo menor que isso não conta
const MERGE_WINDOW = 5;   // minutos: movimentos seguidos da mesma pessoa no mesmo job viram um só

/** Título curto: a parte antes de " - " (o resto fica no title). */
const short = (t: string | null | undefined) => { const s = (t ?? "job").split(" - ")[0].trim(); return s.length > 34 ? `${s.slice(0, 32)}…` : s; };
/** "2 dias", "1 dia e 3h", "5h", "40 min" */
function words(m: number) {
  m = Math.round(Math.abs(m));
  const d = Math.floor(m / DAY), h = Math.floor((m % DAY) / 60), mi = m % 60;
  const dd = d ? `${d} dia${d > 1 ? "s" : ""}` : "", hh = h ? `${h}h${!d && mi ? String(mi).padStart(2, "0") : ""}` : "";
  return d ? (hh ? `${dd} e ${hh}` : dd) : hh || `${mi} min`;
}
/** "agora", "há 5 min", "há 2h", "ontem 16:20", "qui 22/10 16:20" */
function when(at: number, now: number) {
  const diff = now - at;
  if (diff < 1) return "agora";
  if (diff < 60) return `há ${diff} min`;
  if (Math.floor(at / DAY) === Math.floor(now / DAY)) return diff < 180 ? `há ${Math.floor(diff / 60)}h` : `hoje ${fmt(at).slice(-5)}`;
  if (Math.floor(at / DAY) === Math.floor(now / DAY) - 1) return `ontem ${fmt(at).slice(-5)}`;
  return fmt(at);
}
const due = (lm: number | null, txt?: string | null) => (lm != null ? fmt(lm) : txt ?? "sem prazo");

/** O que a pessoa fez, numa frase. `self` = o job da linha (vira "este job"). */
function what(c: Cause | null, actor: string | null, self?: number): string {
  const who = actor?.split(" ")[0] ?? "O sistema";
  if (!c) return actor ? `${who} mexeu na fila` : "Prazos recalculados pelas horas de trabalho";
  const job = c.taskId != null && c.taskId === self ? "este job" : `“${short(c.title)}”`, d = c.data ?? {};
  switch (c.kind) {
    case "moved":
      if (c.left) return `${who} passou ${job} para outro editor`;
      if (typeof d.fromPos === "number" && typeof d.toPos === "number")
        return d.fromEditor !== d.toEditor ? `${who} trouxe ${job} de outra fila, em ${d.toPos}º` : `${who} moveu ${job} do ${d.fromPos}º para o ${d.toPos}º`;
      return `${who} moveu ${job}`;
    case "reassign": return `${who} passou ${job} de editor`;
    case "est_changed": return typeof d.from === "number" && typeof d.to === "number" ? `${who} mudou as horas de ${job}: ${fmtH(d.from)} → ${fmtH(d.to)}` : `${who} mudou as horas de ${job}`;
    case "client_change": return `${who} registrou alteração do cliente em ${job}`;
    case "sent": return `${who} entregou ${job}`;
    case "play": return `${who} começou ${job}`;
    case "blocked": return `${who} travou ${job}`;
    case "unblocked": return `${who} destravou ${job}`;
    case "cancelled": return `${who} cancelou ${job}`;
    case "archived": return `${who} encerrou ${job}`;
    case "client_ok": return `${who} fechou ${job} (cliente aprovou)`;
    case "assign": return `${who} colocou ${job} na fila`;
    default: return `${who} mexeu em ${job}`;
  }
}

/** Uma mudança no prazo de um job (já juntando as seguidas). */
interface JobStep { at: number; actor: string | null; cause: Cause | null; from: number | null; to: number | null; fromText: string | null; toText: string | null; times: number }
const sameRun = (a: { actor: string | null; at: number; cause: Cause | null }, b: Episode) =>
  a.actor === b.actor && b.at - a.at <= MERGE_WINDOW && a.cause?.kind === b.cause?.kind && a.cause?.taskId === b.cause?.taskId;

export function QueueHistoryButton({ editorId, name, className }: { editorId: number; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Histórico da fila de ${name}`} title="Fila e histórico de prazos"
        className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[hsl(var(--accent))]", muted, "hover:text-[hsl(var(--foreground))]", className)}>
        <History className="h-4 w-4" />
      </button>
      {open && <QueueHistoryDialog editorId={editorId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function QueueHistoryDialog({ editorId, name, onClose }: { editorId: number; name: string; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<HistoryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setData(null); setErr(null);
    apiFetch<HistoryData>(`/api/queue/editors/${editorId}/history?days=${days}`).then(setData).catch(e => setErr((e as Error).message));
  }, [editorId, days]);

  // história do prazo de cada job (mais nova primeiro), juntando mudanças seguidas da mesma pessoa pelo mesmo motivo
  const perJob = useMemo(() => {
    const m = new Map<number, JobStep[]>();
    for (const ep of [...(data?.episodes ?? [])].reverse()) {
      for (const c of ep.changes) {
        if (c.taskId == null) continue;
        const l = m.get(c.taskId) ?? [], last = l[l.length - 1];
        if (last && sameRun(last, ep)) { last.to = c.to; last.toText = c.toText; last.at = ep.at; last.times++; last.cause = ep.cause; }
        else l.push({ at: ep.at, actor: ep.actor, cause: ep.cause, from: c.from, to: c.to, fromText: c.fromText, toText: c.toText, times: 1 });
        m.set(c.taskId, l);
      }
    }
    for (const [k, l] of m) m.set(k, l.filter(s => s.from == null || s.to == null || Math.abs(s.to - s.from) >= MIN_SHOWN).reverse());
    return m;
  }, [data]);

  // tudo o que mudou: uma frase por ação, juntando as seguidas da mesma pessoa no mesmo job
  const feed = useMemo(() => {
    const out: { at: number; actor: string | null; cause: Cause | null; times: number; firstPos?: unknown; n: number }[] = [];
    for (const ep of [...(data?.episodes ?? [])].reverse()) {
      const n = ep.changes.filter(c => c.from == null || c.to == null || Math.abs(c.to - c.from) >= MIN_SHOWN).length;
      if (!ep.cause && !n) continue;
      const last = out[out.length - 1];
      if (last && sameRun(last, ep)) {
        last.at = ep.at; last.times++; last.n = Math.max(last.n, n);
        // "do 3º para o 2º" fica do primeiro lugar ao último
        if (ep.cause) last.cause = { ...ep.cause, data: { ...ep.cause.data, fromPos: last.firstPos ?? ep.cause.data?.fromPos } };
      } else out.push({ at: ep.at, actor: ep.actor, cause: ep.cause, times: 1, n, firstPos: ep.cause?.data?.fromPos });
    }
    return out.reverse();
  }, [data]);

  const first = name.split(" ")[0];
  const now = data?.now ?? 0;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[86dvh] w-[min(620px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="text-lg font-bold">Fila de {first}</DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px]">A ordem de agora. Toque num job para ver por que o prazo dele mudou.</DialogDescription>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 text-[14px] leading-relaxed">
          {err ? <p className="pt-4 text-rose-500">{err}</p>
            : !data ? <p className={cn("pt-4", muted)}>Carregando…</p>
            : <>
              {!data.queue.length && <p className={cn("pt-4", muted)}>Fila vazia.</p>}
              <ol className="pt-1">
                {data.queue.map(t => {
                  const steps = perJob.get(t.id) ?? [], isOpen = openJob === t.id;
                  const oldest = steps[steps.length - 1];
                  return (
                    <li key={t.id} className="border-b last:border-b-0">
                      <button type="button" onClick={() => setOpenJob(isOpen ? null : t.id)} disabled={!steps.length} aria-expanded={isOpen}
                        className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-3 text-left enabled:hover:bg-[hsl(var(--accent)/0.5)] disabled:cursor-default">
                        <span className="text-[16px] font-bold tabular-nums">{t.pos}º</span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold" title={t.title}>{short(t.title)}</span>
                          <span className={cn("block text-[12.5px]", muted)}>
                            {t.playing ? <span className="text-emerald-600 dark:text-emerald-400">em edição</span> : "na fila"}
                            {" · "}{t.est > 0 ? `${fmtH(t.est)} de trabalho` : "sem horas"}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className={cn("block whitespace-nowrap text-[13.5px] font-medium tabular-nums", t.late && "text-rose-500")}>{t.due != null ? fmt(t.due) : "—"}</span>
                          <span className={cn("flex items-center justify-end gap-0.5 text-[12px]", t.late ? "text-rose-500" : muted)}>
                            {t.late ? "atrasado" : steps.length ? <>prazo mudou {steps.length}×<ChevronRight className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")} /></> : "prazo não mudou"}
                          </span>
                        </span>
                      </button>
                      {isOpen && oldest && (
                        <div className="mb-3 ml-[42px] rounded-lg bg-[hsl(var(--foreground)/0.04)] px-3.5 py-3 text-[13px]">
                          <p className="pb-2.5">
                            Era <b className="font-semibold">{due(oldest.from, oldest.fromText)}</b>, agora é <b className="font-semibold">{t.due != null ? fmt(t.due) : "—"}</b>
                            {oldest.from != null && t.due != null && Math.abs(t.due - oldest.from) >= MIN_SHOWN && <span className={muted}> ({words(t.due - oldest.from)} {t.due > oldest.from ? "depois" : "antes"})</span>}.
                          </p>
                          <ol className="flex flex-col gap-2.5 border-l-2 pl-3">
                            {steps.map((s, i) => {
                              const m = s.from != null && s.to != null ? s.to - s.from : null;
                              return (
                                <li key={i}>
                                  <span className={cn("block text-[11.5px]", muted)}>{when(s.at, now)}</span>
                                  <span className="block">{what(s.cause, s.actor, t.id)}{s.times > 1 ? ` (${s.times} vezes seguidas)` : ""}.</span>
                                  <span className={cn("block", muted)}>
                                    {due(s.from, s.fromText)} → <span className="text-[hsl(var(--foreground))]">{due(s.to, s.toText)}</span>
                                    {m != null && <> · {words(m)} {m > 0 ? "depois" : "antes"}</>}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="pt-5">
                <button type="button" onClick={() => setShowAll(v => !v)} aria-expanded={showAll} className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-90")} />
                  Tudo o que mudou na fila
                  <span className={cn("font-normal", muted)}>({feed.length} nos últimos {days} dias)</span>
                </button>
                {showAll && (
                  <div className="pt-2">
                    <p className={cn("pb-2 text-[12.5px]", muted)}>
                      Período: {[7, 14, 30].map((n, i) => (
                        <span key={n}>{i > 0 && " · "}<button type="button" onClick={() => setDays(n)} className={cn("underline-offset-2 hover:underline", days === n && "font-semibold text-[hsl(var(--foreground))] underline")}>{n} dias</button></span>
                      ))}
                    </p>
                    {!feed.length ? <p className={muted}>Nada mudou nesse período.</p> : (
                      <ul className="flex flex-col">
                        {feed.map((f, i) => (
                          <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 border-t py-2 first:border-t-0">
                            <span className={cn("text-[12.5px] tabular-nums", muted)}>{when(f.at, now)}</span>
                            <span>
                              {what(f.cause, f.actor)}{f.times > 1 ? ` (${f.times} vezes seguidas)` : ""}.
                              {f.n > 0 && <span className={muted}> {f.n === 1 ? "1 prazo mudou." : `${f.n} prazos mudaram.`}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

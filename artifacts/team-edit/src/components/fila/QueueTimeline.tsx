import { LiveDot } from "@/components/fila/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Moon } from "@/lib/icons";
import { DAY, coordColor, fmt, fmtDay, fmtH, personName, inQueue, rem, shiftState, type Board, type QTask } from "@/lib/fila";

const LW = 128;
const fmtClock = (t: number) => { const m = ((t % DAY) + DAY) % DAY; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/** Visões da régua: quantos dias mostra e a largura mínima de um dia de expediente (8h); estica para ocupar o quadro. */
const VIEWS = {
  dia: { label: "Dia", n: 1, col: 600, narrow: 0 },
  semana: { label: "Semana", n: 7, col: 130, narrow: 34 },
  quinzena: { label: "2 semanas", n: 14, col: 90, narrow: 26 },
} as const;
type View = keyof typeof VIEWS;
const VIEW_KEY = "fila:timeline-view";

/**
 * Régua de todos os editores: cada job ocupa as horas de expediente previstas.
 * `me` = gestor logado (os jobs dele em cor cheia, os dos outros na cor de cada um, mais clara). null = todos em cor cheia.
 * Visões: dia (com as horas), semana e 2 semanas; as setas andam pelos 14 dias que o quadro calcula.
 */
export function QueueTimeline({ board, me, onOpen }: { board: Board; me: number | null; onOpen?: (t: QTask) => void }) {
  const [view, setViewState] = useState<View>(() => { try { const v = localStorage.getItem(VIEW_KEY); return v && v in VIEWS ? v as View : "semana"; } catch { return "semana"; } });
  const [offset, setOffset] = useState(0);
  const setView = (v: View) => { setViewState(v); setOffset(0); try { localStorage.setItem(VIEW_KEY, v); } catch { /* sem armazenamento: só não lembra */ } };
  const { n, col: minCol, narrow } = VIEWS[view];
  const maxOffset = Math.max(0, board.days.length - n);
  const off = Math.min(offset, maxOffset);
  const days = board.days.slice(off, off + n);
  // largura disponível: os dias de expediente dividem o que sobra
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el); setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // na visão de dia, o dia sem expediente também ocupa a largura toda
  const work = view === "dia" ? days.length : days.filter(d => !d.off).length || 1, offs = days.length - work;
  const COL = Math.max(minCol, Math.floor((avail - LW - 2 - offs * narrow) / work));
  const NARROW = view === "dia" ? COL : narrow;

  const colX = useMemo(() => {
    const x = [0];
    for (const d of days) x.push(x[x.length - 1] + (d.off ? NARROW : COL));
    return x;
  }, [days, COL, NARROW]);
  const W = colX[colX.length - 1];
  const first = days[0]?.day ?? 0, today = Math.floor(board.now / DAY);

  const xOf = (t: number) => {
    const d = Math.floor(t / DAY), i = d - first;
    if (i < 0) return 0;
    if (i >= days.length) return W;
    const dd = days[i];
    if (dd.off) return colX[i];
    const m = t - d * DAY;
    let w = 0;
    for (const [a, b] of dd.periods) w += Math.max(0, Math.min(m, b) - a);
    return colX[i] + (w / 480) * COL;
  };
  const ranges = (segs: [number, number][]) => {
    const r = segs.map(([a, b]) => [xOf(a), xOf(b)] as [number, number]).filter(([a, b]) => b - a > 0.2).sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const s of r) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + 0.6) l[1] = Math.max(l[1], s[1]); else out.push([...s]); }
    return out;
  };
  // visão de dia: uma marca por hora cheia dentro do expediente
  const hourTicks = view === "dia" ? days.flatMap(d => d.off ? [] : d.periods.flatMap(([a, b]) => {
    const out: { x: number; label: string }[] = [];
    for (let h = Math.ceil(a / 60) * 60; h <= b; h += 60) out.push({ x: xOf(d.day * DAY + h), label: `${h / 60}h` });
    return out;
  })).reduce<{ x: number; label: string }[]>((acc, h) => {
    // fim de um turno e começo do outro caem no mesmo ponto (almoço): um rótulo só
    const l = acc[acc.length - 1];
    if (l && Math.abs(l.x - h.x) < 6) l.label = `${l.label} · ${h.label}`; else acc.push({ ...h });
    return acc;
  }, []) : [];
  const nowIn = board.now >= first * DAY && board.now < (first + days.length) * DAY;
  // depois do último turno de hoje (ou dia sem expediente): o relógio diz que o dia de trabalho acabou
  const todayP = board.days.find(d => d.day === today)?.periods ?? [];
  const afterHours = !todayP.length || board.now - today * DAY >= todayP[todayP.length - 1][1] || board.now - today * DAY < todayP[0][0];
  const rangeLabel = days.length === 1 ? (days[0].day === today ? `Hoje, ${fmtDay(days[0].day)}` : fmtDay(days[0].day)) : `${fmtDay(days[0].day)} – ${fmtDay(days[days.length - 1].day)}`;
  const seg = "h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors";
  const nav = "grid h-7 w-7 place-items-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))] disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" className={nav} disabled={off === 0} onClick={() => setOffset(Math.max(0, off - (view === "dia" ? 1 : n)))} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={nav} disabled={off >= maxOffset} onClick={() => setOffset(Math.min(maxOffset, off + (view === "dia" ? 1 : n)))} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></button>
          <b className="ml-1 text-[13px] font-semibold">{rangeLabel}</b>
          {off > 0 && <button type="button" onClick={() => setOffset(0)} className="ml-2 rounded-md px-2 py-0.5 text-[12px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)]">Hoje</button>}
        </div>
        <div role="tablist" aria-label="Visão da agenda" className="flex items-center gap-0.5 rounded-lg border bg-[hsl(var(--background))] p-0.5">
          {(Object.keys(VIEWS) as View[]).map(v => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn(seg, view === v ? "bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm ring-1 ring-[hsl(var(--border))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
              {VIEWS[v].label}
            </button>
          ))}
        </div>
      </div>

      <div ref={box} className="overflow-x-auto">
        <div className="relative" style={{ width: W + LW }}>
          <div className="flex">
            <div className="sticky left-0 z-[4] shrink-0 border-r bg-[hsl(var(--card))]" style={{ width: LW }} />
            <div className="relative h-10" style={{ width: W }}>
              {days.map((d, i) => {
                const [wd, dm] = fmtDay(d.day).split(" "), isToday = d.day === today, thin = d.off && view !== "dia";
                return (
                  <div key={d.day} className={cn("absolute inset-y-0 flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap border-l px-2.5 pt-2 text-xs", thin && "fila-stripes justify-center px-0 pt-0", isToday && "bg-[hsl(var(--primary)/0.06)]")}
                    style={{ left: colX[i], width: colX[i + 1] - colX[i] }} title={d.off ?? undefined}>
                    {thin ? <b className="self-center text-[10px] font-semibold text-[hsl(var(--muted-foreground))] [writing-mode:vertical-rl] rotate-180">{d.off}</b> : <>
                      <span className={cn("text-[10.5px] font-semibold uppercase tracking-wider", isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]")}>{isToday ? "hoje" : wd}</span>
                      <b className={cn("font-mono text-[11.5px] font-semibold", isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]")}>{dm}</b>
                      {d.off && <span className="text-[hsl(var(--muted-foreground))]">· {d.off}</span>}
                    </>}
                  </div>
                );
              })}
              {hourTicks.filter(h => !nowIn || Math.abs(h.x - xOf(board.now)) > 24).map(h => <span key={h.x} className="absolute bottom-0.5 -translate-x-1/2 font-mono text-[9.5px] text-[hsl(var(--muted-foreground))]" style={{ left: h.x }}>{h.label}</span>)}
            </div>
          </div>
          {board.editors.map(ed => {
            const q = board.tasks.filter(t => inQueue(t) && t.editorId === ed.id && t.slot);
            const mineH = me ? q.filter(t => t.coordId === me).reduce((s, t) => s + rem(t), 0) : 0;
            // fim do expediente: quem já encerrou o dia (o ▶ pausa sozinho)
            const sh = shiftState(ed, board.now);
            const status = sh.state === "off" || sh.state === "before" ? <span className="inline-flex items-center gap-1 font-mono text-[9.5px] leading-[15px] text-[hsl(var(--muted-foreground))]" title={`Retoma ${fmt(sh.resumes)}`}><Moon className="h-2.5 w-2.5" />encerrado</span> : null;
            return (
              <div key={ed.id} className="group/row flex">
                <div className="sticky left-0 z-[4] flex shrink-0 flex-col justify-center border-r border-t bg-[hsl(var(--card))] px-3 py-2" style={{ width: LW }}>
                  <b className="truncate text-[13px]">{ed.name}</b>
                  <small className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{me ? `${fmtH(mineH)} seus/${fmtH(ed.queueMinutes)}` : `${fmtH(ed.queueMinutes)} na fila`}</small>
                  {status && <div className="mt-0.5 flex">{status}</div>}
                </div>
                <div className="relative h-[60px] border-t transition-colors group-hover/row:bg-[hsl(var(--foreground)/0.015)]" style={{ width: W }}>
                  {days.map((d, i) => {
                    const cap = d.periods.reduce((s, [a, b]) => s + b - a, 0);
                    const absent = ed.offDays.find(o => o.day === d.day);
                    return (
                      <div key={d.day}>
                        <div className={cn("absolute inset-y-0 border-l", (d.off || absent) && "fila-stripes")} style={{ left: colX[i], width: d.off || absent ? colX[i + 1] - colX[i] : 0 }} title={absent?.off} />
                        {d.day === today && !d.off && <div className="pointer-events-none absolute inset-y-0 bg-[hsl(var(--primary)/0.035)]" style={{ left: colX[i], width: colX[i + 1] - colX[i] }} />}
                        {!d.off && !absent && d.periods.length > 1 && <div className="pointer-events-none absolute inset-y-2 border-l border-dashed border-[hsl(var(--foreground)/0.08)]" style={{ left: colX[i] + ((d.periods[0][1] - d.periods[0][0]) / 480) * COL }} title="almoço" />}
                        {!d.off && !absent && cap < 480 && <div className="fila-stripes absolute inset-y-0" style={{ left: colX[i] + (cap / 480) * COL, width: COL - (cap / 480) * COL }} />}
                      </div>
                    );
                  })}
                  {hourTicks.map(h => <div key={h.x} className="pointer-events-none absolute inset-y-0 border-l border-[hsl(var(--foreground)/0.04)]" style={{ left: h.x }} />)}
                  <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/[0.035] dark:bg-white/[0.035]" style={{ width: xOf(board.now) }} />
                  {q.map(t => {
                    const s = t.slot!, mine = !me || t.coordId === me, rs = ranges(s.segs);
                    if (!rs.length) return null;
                    const wide = rs.reduce((m, r, i) => (r[1] - r[0] > rs[m][1] - rs[m][0] ? i : m), 0);
                    const c = coordColor(t.coordId);
                    const gap = s.gapBefore > 0 && s.pos > 0 ? (() => { const b = xOf(s.start), a = b - (s.gapBefore / 480) * COL; return b - a > 10 ? [Math.max(0, a), b] : null; })() : null;
                    // visual sóbrio: superfície neutra com fio fino; o gestor aparece só no marcador de cor.
                    // Seus jobs ganham o roxo do sistema (na Supervisão, sem dono, todos ficam neutros).
                    const mineHi = !!me && t.coordId === me;
                    // um leve tom da cor do gestor + fio e brilho no topo: vivo, sem virar um arco-íris
                    const look = mineHi
                      ? { background: "linear-gradient(180deg, hsl(var(--primary) / 0.26), hsl(var(--primary) / 0.16))", boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.7), inset 0 1px 0 rgb(255 255 255 / 0.08)", color: "hsl(var(--foreground))" }
                      : { background: `linear-gradient(180deg, color-mix(in srgb, ${c} 13%, hsl(var(--card))), color-mix(in srgb, ${c} 8%, hsl(var(--card))))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 38%, hsl(var(--border))), inset 0 1px 0 rgb(255 255 255 / 0.05)`, color: "hsl(var(--foreground))" };
                    return (
                      <div key={t.id}>
                        {gap && <div className="absolute top-[11px] flex h-[38px] items-center justify-center overflow-hidden whitespace-nowrap rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400" style={{ left: gap[0], width: gap[1] - gap[0] }} title={`Livre ${fmtH(s.gapBefore)}`}>{gap[1] - gap[0] > 56 && `livre ${fmtH(s.gapBefore)}`}</div>}
                        {rs.map(([a, b], i) => (
                          <button key={i} type="button" onClick={() => onOpen?.(t)}
                            className="absolute top-[11px] flex h-[38px] flex-col justify-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-left leading-tight transition-[left,width,filter] duration-300 hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                            style={{ left: a, width: Math.max(3, b - a), ...look }}
                            title={`${t.title} · ${personName(board, t.coordId)} · ${fmtH(rem(t))} · pronto ${fmt(s.end)} · prazo ${fmt(t.promised)}`}>
                            {i === wide && b - a > 40 && <>
                              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold">
                                {t.playing ? <LiveDot className="h-1.5 w-1.5 text-emerald-500" /> : <i className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ background: c }} />}
                                <span className="truncate">{mine ? t.title : personName(board, t.coordId).split(" ")[0]}</span>
                              </span>
                              {b - a > 70 && <span className="truncate pl-3 font-mono text-[9.5px] tracking-tight text-[hsl(var(--foreground)/0.6)]">{fmtH(rem(t))}{mine ? "" : ` · ${t.title}`}{view === "dia" ? ` · pronto ${fmt(s.end)}` : ""}</span>}
                            </>}
                            {t.playing && i === wide && b - a <= 40 && <LiveDot className="absolute right-1 top-1 h-1.5 w-1.5 text-emerald-500" />}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {nowIn && (
            <div className="pointer-events-none absolute bottom-0 top-10 z-[3] w-px bg-rose-500/80" style={{ left: LW + xOf(board.now) }}>
              <i className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-rose-500 ring-2 ring-[hsl(var(--card))]" />
              <span className="absolute -top-[17px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-rose-500 px-1 font-mono text-[9.5px] font-semibold leading-[14px] text-white">{fmtClock(board.now)}{afterHours ? " · encerrado" : ""}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        {me && <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] align-[-1px]" style={{ background: "hsl(var(--primary) / 0.22)", boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.7)" }} />seus jobs</span>}
        {/* marcador de cor de cada gestor; o seu primeiro, como "Você" */}
        {[...new Set(board.tasks.filter(t => inQueue(t) && t.slot).map(t => t.coordId))].filter((c): c is number => !!c && c !== me)
          .sort((x, y) => Number(y === me) - Number(x === me) || personName(board, x).localeCompare(personName(board, y)))
          .map(c => {
            return <span key={c} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-[2px]" style={{ background: coordColor(c) }} />
              {personName(board, c).split(" ")[0]}</span>;
          })}
        <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-sm border border-dashed border-emerald-500/60 align-[-1px]" />livre</span>
        <span><i className="fila-stripes mr-1.5 inline-block h-[11px] w-[18px] rounded-sm align-[-1px]" />sem expediente</span>
        <span className="inline-flex items-center gap-1.5"><LiveDot className="h-1.5 w-1.5 text-emerald-500" />em edição agora</span>
      </div>
    </div>
  );
}

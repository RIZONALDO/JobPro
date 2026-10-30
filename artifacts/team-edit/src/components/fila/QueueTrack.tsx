/**
 * Agenda dos editores (mesmo visual da que estava em produção, agora com a fila por horas): cada editor numa linha,
 * cada dia numa coluna do tamanho do expediente (8h; sábado 4h30 com o resto listrado; domingo e feriado estreitos e
 * listrados). Cada job ocupa as horas de trabalho dele, colado no anterior (`track` do board). O 1º não estica com o
 * relógio: passou das horas e não saiu, ganha a etiqueta "+X das horas" e o próximo começa de agora.
 * `me` = gestor logado: os jobs dele em roxo; os dos outros num tom da cor de cada gestor, com o nome dele.
 * Visões: dia (com as horas), semana e 2 semanas; as setas andam pelos 14 dias do board.
 * `focus` = job sendo arrastado na fila de baixo: fica em destaque ("arrastando") e os outros apagam.
 * `plan` = prévia ao arrastar (filas simuladas no navegador): a agenda redesenha e o rodapé lista os prazos que mudam.
 * Cada card vai normal até o prazo (o gravado; na prévia, o novo); o trabalho que passa do prazo continua no mesmo card,
 * preenchido em âmbar (só muda com as horas, não com o relógio). Contorno vermelho = atrasado.
 * O 1º da fila conta de quando virou o 1º (API, `head_since`): tocar ou não em "Começar" não move os cards.
 * Com `onMove`, os blocos também se arrastam aqui (menos o em edição): soltar na linha de um editor põe o job na
 * posição sob o mouse (pelos blocos de antes do arrasto), com a mesma prévia ao vivo da fila.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "@/lib/icons";
import { LiveDot } from "@/components/fila/ui";
import { QueueHistoryButton } from "@/components/fila/QueueHistory";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DAY, coordColor, dur, fmt, fmtDay, fmtH, inQueue, personName, planMove, workDelta, type Board, type PlanItem, type QTask } from "@/lib/fila";

const LW = 184;
/** diferença de prazo que conta como mudança (minutos) */
const SLIP = 15;
const shortTitle = (s: string) => { const t = s.split(" - ")[0].trim(); return t.length > 28 ? `${t.slice(0, 27)}…` : t; };
const fmtClock = (t: number) => { const m = ((t % DAY) + DAY) % DAY; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/** Visões da régua: quantos dias mostra e a largura mínima de um dia de expediente (8h); estica para ocupar o quadro. */
const VIEWS = {
  dia: { label: "Dia", n: 1, col: 600, narrow: 0 },
  semana: { label: "Semana", n: 7, col: 130, narrow: 34 },
  quinzena: { label: "2 semanas", n: 14, col: 90, narrow: 26 },
} as const;
type View = keyof typeof VIEWS;
const VIEW_KEY = "fila:timeline-view";

/** Expediente do dia (minutos do dia), igual ao da API: seg–sex 08:30–12:00 e 14:00–18:30, sáb 08:30–13:00. */
function periodsOf(day: number, off: string | null): [number, number][] {
  if (off) return [];
  const wd = new Date(day * 86_400_000).getUTCDay();
  return wd === 0 ? [] : wd === 6 ? [[510, 780]] : [[510, 720], [840, 1110]];
}

export function QueueTrack({ board, me, focus: focusProp = null, plan: planProp = null, onOpen, onMove }: {
  board: Board; me: number | null; focus?: number | null; plan?: Map<number, PlanItem[]> | null; onOpen?: (t: QTask) => void;
  /** mover um job (mesmo endpoint da fila); sem isso os blocos não se arrastam */
  onMove?: (id: number, editorId: number, index: number) => Promise<void> | void;
}) {
  const [view, setViewState] = useState<View>(() => { try { const v = localStorage.getItem(VIEW_KEY); return v && v in VIEWS ? v as View : "semana"; } catch { return "semana"; } });
  const [offset, setOffset] = useState(0);
  const setView = (v: View) => { setViewState(v); setOffset(0); try { localStorage.setItem(VIEW_KEY, v); } catch { /* sem armazenamento: só não lembra */ } };
  const { n, col: minCol, narrow } = VIEWS[view];
  const today = Math.floor(board.now / DAY);
  const allDays = useMemo(() => (board.axis ?? []).map(d => {
    const off = d.off ?? (new Date(d.day * 86_400_000).getUTCDay() === 0 ? "Domingo" : null);
    return { day: d.day, off, periods: periodsOf(d.day, off) };
  }), [board.axis]);
  const maxOffset = Math.max(0, allDays.length - n);
  const off = Math.min(offset, maxOffset);
  const days = allDays.slice(off, off + n);
  const byId = new Map(board.tasks.map(t => [t.id, t]));
  // arrastar na agenda: posição de cada job antes do arrasto (para achar o lugar sob o mouse sem "pular")
  const base = (edId: number) => (board.editors.find(e => e.id === edId)?.track?.items ?? []).filter(i => { const t = byId.get(i.id); return t && inQueue(t); });
  const [drag, setDrag] = useState<{ id: number; ed: number; k: number } | null>(null);
  const [over, setOver] = useState<{ ed: number; index: number } | null>(null);
  const live = useMemo(() => !drag || !over || (drag.ed === over.ed && over.index === drag.k) ? null : planMove(board, drag.id, drag.ed, over.ed, over.index),
    [drag?.id, over?.ed, over?.index, board]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = live ?? planProp, focus = drag?.id ?? focusProp;
  const endDrag = () => { setDrag(null); setOver(null); };
  // a prévia redesenha os blocos e o arrastado pode sair da tela: o fim do arrasto também é ouvido na página
  useEffect(() => {
    if (!drag) return;
    const end = () => setTimeout(endDrag, 0);
    document.addEventListener("dragend", end); document.addEventListener("drop", end);
    return () => { document.removeEventListener("dragend", end); document.removeEventListener("drop", end); };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const first = days[0]?.day ?? 0;

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
  /** trechos visíveis de um intervalo do relógio: um por dia de expediente, colados quando os dias encostam */
  const ranges = (a0: number, b0: number) => {
    const r: [number, number][] = [];
    for (let d = Math.floor(a0 / DAY); d * DAY < b0; d++) {
      const xa = xOf(Math.max(a0, d * DAY)), xb = xOf(Math.min(b0, d * DAY + DAY - 1));
      if (xb - xa > 0.2) r.push([xa, xb]);
    }
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
  const todayP = allDays.find(d => d.day === today)?.periods ?? [];
  const afterHours = !todayP.length || board.now - today * DAY >= todayP[todayP.length - 1][1] || board.now - today * DAY < todayP[0][0];
  const rangeLabel = !days.length ? "" : days.length === 1 ? (days[0].day === today ? `Hoje, ${fmtDay(days[0].day)}` : fmtDay(days[0].day)) : `${fmtDay(days[0].day)} – ${fmtDay(days[days.length - 1].day)}`;
  const seg = "h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors";
  const nav = "grid h-7 w-7 place-items-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))] disabled:pointer-events-none disabled:opacity-35";
  const eds = board.editors.filter(e => !e.inactive || e.count > 0);

  return (
    <div data-tour="agenda" className="rounded-2xl border bg-[hsl(var(--card))]">
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
          {eds.map(ed => {
            const items: PlanItem[] = plan?.get(ed.id) ?? (ed.track?.items ?? []).filter(i => { const t = byId.get(i.id); return t && inQueue(t); });
            const total = items.reduce((s, i) => s + (byId.get(i.id)?.est ?? 0), 0);
            const mineH = me ? items.filter(i => byId.get(i.id)?.coordId === me).reduce((s, i) => s + (byId.get(i.id)?.est ?? 0), 0) : 0;
            return (
              <div key={ed.id} className="group/row flex">
                <div className="sticky left-0 z-[4] flex shrink-0 items-center gap-2.5 border-r border-t bg-[hsl(var(--card))] py-2 pl-3 pr-1.5" style={{ width: LW }}>
                  <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={34} className={cn("shrink-0", ed.inactive && "opacity-50 grayscale")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <b className="truncate text-[13px] font-semibold leading-tight">{ed.name}</b>
                    <small className={cn("truncate text-[11px] leading-tight", ed.offToday ? "text-amber-600 dark:text-amber-400" : "text-[hsl(var(--muted-foreground))]")}>
                      {ed.inactive ? "inativo" : ed.offToday ?? (total ? `${fmtH(total)} na fila${me && mineH ? ` · ${fmtH(mineH)} seus` : ""}` : "fila vazia")}
                    </small>
                  </span>
                  <QueueHistoryButton editorId={ed.id} name={ed.name} className="h-7 w-7 shrink-0" tour="historico" />
                </div>
                <div className={cn("relative h-[88px] border-t transition-colors group-hover/row:bg-[hsl(var(--foreground)/0.015)]", drag && over?.ed === ed.id && "bg-[hsl(var(--primary)/0.05)]")} style={{ width: W }}
                  onDragOver={e => {
                    if (!drag || ed.inactive) return;
                    e.preventDefault(); e.dataTransfer.dropEffect = "move";
                    // lugar = quantos blocos (sem o arrastado) têm o meio antes do mouse; nunca antes do em edição
                    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
                    const rest = base(ed.id).filter(i => i.id !== drag.id);
                    const min = byId.get(rest[0]?.id ?? -1)?.playing ? 1 : 0;
                    const index = Math.max(min, rest.filter(i => xOf((Math.max(i.start, board.now) + i.end) / 2) < px).length);
                    if (over?.ed !== ed.id || over.index !== index) setOver({ ed: ed.id, index });
                  }}
                  onDrop={e => { e.preventDefault(); const d = drag, o = over; endDrag(); if (d && o && !(d.ed === o.ed && o.index === d.k)) onMove?.(d.id, o.ed, o.index); }}>
                  {days.map((d, i) => {
                    const cap = d.periods.reduce((s, [a, b]) => s + b - a, 0);
                    const absent = ed.track?.offDays.find(o => o.day === d.day);
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
                  {items.map(it => {
                    const t = byId.get(it.id)!;
                    const mine = !me || t.coordId === me;
                    // o card vai normal até o prazo (o gravado; na prévia, o novo); o que passa do prazo continua em âmbar
                    const dl = plan ? it.due : t.promised;
                    const pieces = [
                      ...ranges(it.start, dl == null ? it.end : Math.min(it.end, dl)).map(r => ({ r, over: false })),
                      ...(dl != null && it.end > dl ? ranges(Math.max(it.start, dl), it.end).map(r => ({ r, over: true })) : []),
                    ];
                    // passou das horas e ainda não saiu (só fora da prévia: vem da esteira da API): etiqueta no fim do card,
                    // que não estica; com o card fora da tela (acabou antes de hoje), a etiqueta fica no começo, com o nome
                    const overH = (it as { over?: number }).over ?? 0, open = overH > 0;
                    const tagX = pieces.length ? pieces[pieces.length - 1].r[1] : 0, tagIn = tagX > 90;
                    const tag = open ? [
                      <span key={`${t.id}-open`} title={`${t.title} · passou das horas ${fmtH(overH)} e ainda não saiu`}
                        className={cn("pointer-events-none absolute z-[2] whitespace-nowrap rounded-[4px] bg-rose-500 px-1 font-mono text-[9.5px] font-semibold leading-[14px] text-white", tagIn ? "top-[12px] -translate-x-full -translate-y-1/2" : "top-[5px]")}
                        style={{ left: tagIn ? tagX : tagX + 2 }}>+{fmtH(overH)} das horas{pieces.length && tagX > 40 ? "" : ` · ${shortTitle(t.title)}`}</span>,
                    ] : [];
                    if (!pieces.length) return tag.length ? tag : null;
                    const overMin = dl != null && it.end > dl ? workDelta(board, ed.id, dl, it.end) : 0;
                    const widest = (over: boolean) => pieces.reduce((m, p, i) => p.over === over && (m < 0 || p.r[1] - p.r[0] > pieces[m].r[1] - pieces[m].r[0]) ? i : m, -1);
                    // o título vai no trecho mais largo (de preferência o normal); o "+X além do prazo", no âmbar mais largo
                    const wn = widest(false), wa = widest(true), w = (i: number) => i < 0 ? 0 : pieces[i].r[1] - pieces[i].r[0];
                    const wide = w(wn) >= 70 || w(wn) >= w(wa) ? wn : wa;
                    const c = coordColor(t.coordId);
                    // seus jobs no roxo do sistema; os dos outros num leve tom da cor do gestor, com fio e brilho no topo
                    const mineHi = !!me && t.coordId === me;
                    const look = mineHi
                      ? { background: "linear-gradient(180deg, hsl(var(--primary) / 0.26), hsl(var(--primary) / 0.16))", boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.7), inset 0 1px 0 rgb(255 255 255 / 0.08)", color: "hsl(var(--foreground))" }
                      : { background: `linear-gradient(180deg, color-mix(in srgb, ${c} 18%, hsl(var(--card))), color-mix(in srgb, ${c} 9%, hsl(var(--card))))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 55%, hsl(var(--border))), inset 0 1px 0 rgb(255 255 255 / 0.06)`, color: "hsl(var(--foreground))" };
                    const amber = { background: "linear-gradient(180deg, rgb(245 158 11 / 0.8), rgb(232 140 8 / 0.72))", boxShadow: "inset 0 0 0 1px rgb(251 191 36 / 0.7)", color: "#1f1405" };
                    const lit = focus === t.id;
                    const moved = !!plan && t.promised != null && Math.abs(it.due - t.promised) >= SLIP;
                    const ring = lit ? "0 0 0 2px hsl(var(--foreground) / 0.9), 0 4px 14px rgb(0 0 0 / 0.35)"
                      : moved ? `inset 0 0 0 1.5px rgb(${it.due > t.promised! ? "245 158 11" : "16 185 129"} / 0.9)`
                      : !plan && t.late ? "inset 0 0 0 1.5px rgb(244 63 94 / 0.85)" : null;
                    const extra = `${overMin ? ` · passou do prazo ${fmtH(overMin)}` : ""}${open ? ` · passou das horas ${fmtH(overH)} e ainda não saiu` : ""}`;
                    return pieces.map(({ r: [a, b], over }, i) => {
                      const joinL = i > 0 && Math.abs(pieces[i - 1].r[1] - a) < 0.8, joinR = i < pieces.length - 1 && Math.abs(pieces[i + 1].r[0] - b) < 0.8;
                      return (
                        <button key={`${t.id}-${i}`} type="button" onClick={() => onOpen?.(t)}
                          draggable={!!onMove && !t.playing} data-tour={onMove && !t.playing && i === wide ? "agenda-block" : undefined}
                          onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); setDrag({ id: t.id, ed: ed.id, k: base(ed.id).findIndex(x => x.id === t.id) }); }}
                          onDragEnd={endDrag}
                          className={cn(onMove && !t.playing && "cursor-move", "absolute top-[12px] flex h-[64px] flex-col justify-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-left leading-tight transition-[left,width,filter,opacity] duration-300 hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                            joinL && "rounded-l-none", joinR && "rounded-r-none", focus != null && !lit && !moved && "opacity-35", lit && "z-[2] brightness-150")}
                          style={{ left: a, width: Math.max(3, b - a), ...(over ? amber : look), ...(ring ? { boxShadow: ring } : {}) }}
                          title={`${t.title} · ${personName(board, t.coordId)} · ${fmtH(t.est)} · prazo ${fmt(dl)} · ${open ? "horas acabaram" : "pronto"} ${fmt(it.end)}${extra}`}>
                          {i === wide && b - a > 40 && <>
                            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold">
                              {t.playing ? <LiveDot className="h-1.5 w-1.5 text-emerald-500" /> : <i className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ background: over ? "#1f1405" : c }} />}
                              <span className="truncate">{mine ? t.title : personName(board, t.coordId).split(" ")[0]}</span>
                            </span>
                            {b - a > 70 && <span className={cn("truncate pl-3 font-mono text-[9.5px] tracking-tight", over ? "font-semibold text-[#1f1405]/85" : "text-[hsl(var(--foreground)/0.6)]")}>{over ? `+${fmtH(overMin)} além do prazo` : `${fmtH(t.est)}${mine ? "" : ` · ${t.title}`} · prazo ${fmt(dl).slice(4)}`}</span>}
                          </>}
                          {over && i === wa && i !== wide && b - a > 46 && <span className="truncate font-mono text-[9.5px] font-semibold">+{fmtH(overMin)} além do prazo</span>}
                          {t.playing && i === wide && b - a <= 40 && <LiveDot className="absolute right-1 top-1 h-1.5 w-1.5 text-emerald-500" />}
                        </button>
                      );
                    }).concat(tag).concat(lit ? [
                      <span key={`${t.id}-drag`} className="pointer-events-none absolute top-0 z-[3] -translate-y-1/2 animate-pulse whitespace-nowrap rounded-[4px] bg-[hsl(var(--foreground))] px-1.5 font-mono text-[9.5px] font-semibold leading-[15px] text-[hsl(var(--background))]"
                        style={{ left: pieces[0].r[0] }}>arrastando</span>,
                    ] : []);
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
      {plan ? (() => {
        // prévia: os prazos que mudam se soltar aqui
        const ch = [...plan.values()].flat().flatMap(it => {
          const t = byId.get(it.id);
          return t && t.promised != null && Math.abs(it.due - t.promised) >= SLIP ? [{ t, due: it.due, d: it.due - t.promised }] : [];
        });
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-[hsl(var(--primary)/0.05)] px-3 py-2 text-xs">
            <b className="font-semibold">Se soltar aqui:</b>
            {ch.length ? ch.map(({ t, due, d }) => (
              <span key={t.id} className="inline-flex items-center gap-1">
                <span>{shortTitle(t.title)}</span>
                <span className="text-[hsl(var(--muted-foreground))]">→ {fmt(due)}</span>
                <b className={cn("font-semibold tabular-nums", d > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>({d > 0 ? "+" : "−"}{dur(Math.abs(d))})</b>
              </span>
            )) : <span className="text-[hsl(var(--muted-foreground))]">nenhum prazo muda.</span>}
          </div>
        );
      })() : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        {me && <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] align-[-1px]" style={{ background: "hsl(var(--primary) / 0.22)", boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.7)" }} />seus jobs</span>}
        {/* marcador de cor de cada gestor */}
        {[...new Set(board.tasks.filter(inQueue).map(t => t.coordId))].filter((c): c is number => !!c && c !== me)
          .sort((x, y) => personName(board, x).localeCompare(personName(board, y)))
          .map(c => <span key={c} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-[2px]" style={{ background: coordColor(c) }} />{personName(board, c).split(" ")[0]}</span>)}
        <span><i className="fila-stripes mr-1.5 inline-block h-[11px] w-[18px] rounded-sm align-[-1px]" />sem expediente</span>
        <span className="inline-flex items-center gap-1.5"><LiveDot className="h-1.5 w-1.5 text-emerald-500" />em edição agora</span>
        <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] align-[-1px]" style={{ background: "rgb(245 158 11 / 0.8)" }} />além do prazo</span>
        <span className="inline-flex items-center gap-1.5"><i className="rounded-[4px] bg-rose-500 px-1 font-mono text-[9.5px] font-semibold not-italic leading-[14px] text-white">+1h</i>passou das horas e não saiu</span>
        <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] align-[-1px]" style={{ boxShadow: "inset 0 0 0 1.5px rgb(244 63 94 / 0.85)" }} />atrasado</span>
        </div>
      )}
    </div>
  );
}

import { LiveDot } from "@/components/fila/ui";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { DAY, coordColor, fmt, fmtDay, fmtH, personName, inQueue, rem, type Board, type QTask } from "@/lib/fila";

const COL = 132, NARROW = 30, LW = 120;

/**
 * Régua de todos os editores: cada job ocupa as horas de expediente previstas.
 * `me` = coordenador logado (os jobs dele ficam coloridos, os dos outros em cinza). null = todos coloridos.
 */
export function QueueTimeline({ board, me, ndays = 10, onOpen }: { board: Board; me: number | null; ndays?: number; onOpen?: (t: QTask) => void }) {
  const days = board.days.slice(0, ndays);
  const colX = useMemo(() => {
    const x = [0];
    for (const d of days) x.push(x[x.length - 1] + (d.off ? NARROW : COL));
    return x;
  }, [days]);
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
  const ranges = (segs: [number, number][]) => {
    const r = segs.map(([a, b]) => [xOf(a), xOf(b)] as [number, number]).filter(([a, b]) => b - a > 0.2).sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const s of r) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + 0.6) l[1] = Math.max(l[1], s[1]); else out.push([...s]); }
    return out;
  };

  return (
    <div className="overflow-x-auto rounded-2xl border bg-[hsl(var(--card))]">
      <div className="relative" style={{ width: W + LW }}>
        <div className="flex">
          <div className="sticky left-0 z-[4] shrink-0 border-r bg-[hsl(var(--card))]" style={{ width: LW }} />
          <div className="relative h-9" style={{ width: W }}>
            {days.map((d, i) => (
              <div key={d.day} className={cn("absolute inset-y-0 overflow-hidden whitespace-nowrap border-l px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]", d.off && "fila-stripes px-0 text-center")}
                style={{ left: colX[i], width: colX[i + 1] - colX[i] }} title={d.off ?? undefined}>
                {d.off ? <b className="text-[10px] font-semibold [writing-mode:vertical-rl] rotate-180">{d.off}</b> : <b className="font-semibold text-[hsl(var(--foreground))]">{fmtDay(d.day)}</b>}
              </div>
            ))}
          </div>
        </div>
        {board.editors.map(ed => {
          const q = board.tasks.filter(t => inQueue(t) && t.editorId === ed.id && t.slot);
          const mineH = me ? q.filter(t => t.coordId === me).reduce((s, t) => s + rem(t), 0) : 0;
          return (
            <div key={ed.id} className="flex">
              <div className="sticky left-0 z-[4] flex shrink-0 flex-col justify-center border-r border-t bg-[hsl(var(--card))] px-2.5 py-2" style={{ width: LW }}>
                <b className="truncate text-[13px]">{ed.name}</b>
                <small className="text-[11px] text-[hsl(var(--muted-foreground))]">{me ? `${fmtH(mineH)} seus · ${fmtH(ed.queueMinutes)}` : `${fmtH(ed.queueMinutes)} na fila`}</small>
              </div>
              <div className="relative h-[60px] border-t" style={{ width: W }}>
                {days.map((d, i) => {
                  const cap = d.periods.reduce((s, [a, b]) => s + b - a, 0);
                  const absent = ed.offDays.find(o => o.day === d.day);
                  return (
                    <div key={d.day}>
                      <div className={cn("absolute inset-y-0 border-l", (d.off || absent) && "fila-stripes")} style={{ left: colX[i], width: d.off || absent ? colX[i + 1] - colX[i] : 0 }} title={absent?.off} />
                      {!d.off && !absent && cap < 480 && <div className="fila-stripes absolute inset-y-0" style={{ left: colX[i] + (cap / 480) * COL, width: COL - (cap / 480) * COL }} />}
                    </div>
                  );
                })}
                <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/[0.035] dark:bg-white/[0.035]" style={{ width: xOf(board.now) }} />
                {q.map(t => {
                  const s = t.slot!, mine = !me || t.coordId === me, rs = ranges(s.segs);
                  const wide = rs.reduce((m, r, i) => (r[1] - r[0] > rs[m][1] - rs[m][0] ? i : m), 0);
                  const c = coordColor(t.coordId);
                  const gap = s.gapBefore > 0 && s.pos > 0 ? (() => { const b = xOf(s.start), a = b - (s.gapBefore / 480) * COL; return b - a > 10 ? [Math.max(0, a), b] : null; })() : null;
                  return (
                    <div key={t.id}>
                      {gap && <div className="absolute top-[11px] flex h-[38px] items-center justify-center overflow-hidden whitespace-nowrap rounded-lg border border-dashed border-emerald-500/60 text-[11px] font-semibold text-emerald-500" style={{ left: gap[0], width: gap[1] - gap[0] }} title={`Livre ${fmtH(s.gapBefore)}`}>livre {fmtH(s.gapBefore)}</div>}
                      {rs.map(([a, b], i) => (
                        <button key={i} type="button" onClick={() => onOpen?.(t)}
                          className={cn("absolute top-[11px] flex h-[38px] items-center overflow-hidden whitespace-nowrap rounded-lg px-1.5 text-left text-[11.5px] font-semibold transition-[left,width] duration-300",
                            mine ? "border-[1.5px] text-[hsl(var(--foreground))]" : "border bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]",
                            s.late && "fila-late")}
                          style={{ left: a, width: Math.max(2, b - a), ...(mine ? { borderColor: c, background: `color-mix(in srgb, ${c} 24%, hsl(var(--card)))` } : {}) }}
                          title={`${t.title} · ${personName(board, t.coordId)} · pronto ${fmt(s.end)} · prazo ${fmt(t.promised)}`}>
                          {i === wide && b - a > 40 && <span className="truncate">{mine ? t.title : personName(board, t.coordId).split(" ")[0]}</span>}
                          {t.playing && i === 0 && <i className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-emerald-500" />}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="pointer-events-none absolute bottom-0 top-0 z-[3] w-0.5 bg-rose-500" style={{ left: LW + xOf(board.now) }}>
          <span className="absolute left-1 top-10 rounded bg-[hsl(var(--card))] px-1 text-[10px] font-bold text-rose-500">agora</span>
        </div>
      </div>
      <div className="sticky left-0 flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        {me ? <>
          <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-sm border-[1.5px] align-[-1px]" style={{ borderColor: coordColor(me), background: `color-mix(in srgb, ${coordColor(me)} 24%, transparent)` }} />seus jobs</span>
          <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-sm border bg-[hsl(var(--secondary))] align-[-1px]" />de outro coordenador</span>
        </> : [...new Set(board.tasks.map(t => t.coordId))].filter(Boolean).map(c => (
          <span key={c}><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-sm border-[1.5px] align-[-1px]" style={{ borderColor: coordColor(c), background: `color-mix(in srgb, ${coordColor(c)} 24%, transparent)` }} />{personName(board, c)}</span>
        ))}
        <span><i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-sm border border-dashed border-emerald-500 align-[-1px]" />livre</span>
        <span><i className="fila-late mr-1.5 inline-block h-[11px] w-[18px] rounded-sm align-[-1px]" />passa do prazo</span>
        <span><i className="fila-stripes mr-1.5 inline-block h-[11px] w-[18px] rounded-sm align-[-1px]" />sem expediente</span>
        <span className="inline-flex items-center gap-1"><LiveDot className="text-emerald-500" />verde = em execução</span>
      </div>
    </div>
  );
}

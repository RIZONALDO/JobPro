/**
 * Sinalizador de ocupação do editor, pelo tamanho da fila em horas de trabalho (`occupancy` em lib/fila.ts):
 * anel colorido no avatar e uma barrinha. A cor esquenta com o tamanho da fila: verde (pouco) → âmbar → vermelho (5 dias ou mais).
 */
import { cn } from "@/lib/utils";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { OCC, OCC_FULL, fmtH, occColor, occupancy, workDays, type Board } from "@/lib/fila";

const tip = (b: Board, id: number) => {
  const o = occupancy(b, id), l = OCC[o.level];
  return `Ocupação ${l.label.toLowerCase()}: ${o.min ? `${fmtH(o.min)} de trabalho na fila (${workDays(o.min)})` : "sem jobs na fila"}.\nQuanto maior a fila, mais quente a cor: verde → âmbar → vermelho (5 dias).`;
};

/** avatar com anel na cor da ocupação */
export function OccAvatar({ board, editorId, name, avatarUrl, size = 36 }: { board: Board; editorId: number; name: string; avatarUrl: string | null; size?: number }) {
  const o = occupancy(board, editorId);
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full p-[2px]" title={tip(board, editorId)}
      style={{ background: `conic-gradient(${occColor(o.min)} ${Math.min(100, (o.min / OCC_FULL) * 100)}%, hsl(var(--foreground) / 0.12) 0)` }}>
      <span className="rounded-full bg-[hsl(var(--card))] p-[2px]"><AvatarDisplay name={name} avatarUrl={avatarUrl} size={size} /></span>
    </span>
  );
}

/** só a barrinha colorida; o detalhe fica no tooltip */
export function OccMeter({ board, editorId, className }: { board: Board; editorId: number; className?: string }) {
  const o = occupancy(board, editorId);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={tip(board, editorId)}>
      <i className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--foreground)/0.1)]">
        <b className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (o.min / OCC_FULL) * 100)}%`, background: occColor(o.min) }} />
      </i>
    </span>
  );
}

/**
 * Sinalizador de ocupação do editor, pelas horas de trabalho que faltam na fila (`occupancy` em lib/fila.ts):
 * anel colorido no avatar e uma barrinha. Verde = leve (até 2 dias), âmbar = cheia (2 a 4), vermelho = alta (mais de 4).
 */
import { cn } from "@/lib/utils";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { OCC, OCC_FULL, fmtH, occupancy, workDays, type Board } from "@/lib/fila";

const tip = (b: Board, id: number) => {
  const o = occupancy(b, id), l = OCC[o.level];
  return `Ocupação ${l.label.toLowerCase()}: ${o.min ? `${fmtH(o.min)} de trabalho na fila (${workDays(o.min)})` : "sem jobs na fila"}.\nVerde até 2 dias · âmbar 2 a 4 dias · vermelho mais de 4 dias.`;
};

/** avatar com anel na cor da ocupação */
export function OccAvatar({ board, editorId, name, avatarUrl, size = 36 }: { board: Board; editorId: number; name: string; avatarUrl: string | null; size?: number }) {
  const o = occupancy(board, editorId);
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full p-[2px]" title={tip(board, editorId)}
      style={{ background: `conic-gradient(${OCC[o.level].color} ${Math.min(100, (o.min / OCC_FULL) * 100)}%, hsl(var(--foreground) / 0.12) 0)` }}>
      <span className="rounded-full bg-[hsl(var(--card))] p-[2px]"><AvatarDisplay name={name} avatarUrl={avatarUrl} size={size} /></span>
    </span>
  );
}

/** só a barrinha colorida; o detalhe fica no tooltip */
export function OccMeter({ board, editorId, className }: { board: Board; editorId: number; className?: string }) {
  const o = occupancy(board, editorId), l = OCC[o.level];
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={tip(board, editorId)}>
      <i className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--foreground)/0.1)]">
        <b className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (o.min / OCC_FULL) * 100)}%`, background: l.color }} />
      </i>
    </span>
  );
}

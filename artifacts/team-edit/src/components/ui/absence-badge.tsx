import { Palmtree, UserX } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { absenceShort, type Absence } from "@/lib/availability";

/** Selo âmbar de ausência temporária (férias, afastamento…). */
export function AbsenceBadge({ absence, short = false, className }: {
  absence: Pick<Absence, "label" | "endDate"> | null | undefined;
  short?: boolean;
  className?: string;
}) {
  if (!absence) return null;
  return (
    <span
      title={absenceShort(absence)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0",
        "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300",
        className,
      )}
    >
      <Palmtree className="h-2.5 w-2.5 shrink-0" />
      {short ? absence.label : absenceShort(absence)}
    </span>
  );
}

/** Selo cinza de usuário inativo (saiu da equipe). */
export function InactiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0",
        "bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300",
        className,
      )}
    >
      <UserX className="h-2.5 w-2.5 shrink-0" />
      Inativo
    </span>
  );
}

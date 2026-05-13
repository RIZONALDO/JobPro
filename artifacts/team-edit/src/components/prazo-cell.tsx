import { useState } from "react";
import { cn, fmtDate, fmtClosedCycle, fmtPrazoWeek, fmtDaysLeft } from "@/lib/utils";

interface Props {
  dueDate: string | null;
  status: string;
  updatedAt: string;
  overdue: boolean;
  className?: string;
}

export function PrazoCell({ dueDate, status, updatedAt, overdue, className }: Props) {
  const [revealed, setRevealed] = useState(false);

  const closed = fmtClosedCycle(status, dueDate, updatedAt);
  if (closed) return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className={`text-xs font-semibold leading-tight ${closed.cls}`}>{closed.line1}</span>
      {closed.line2 && (
        <span className={`leading-tight ${closed.cls} opacity-80`} style={{ fontSize: "9px" }}>{closed.line2}</span>
      )}
    </div>
  );

  if (!dueDate) return (
    <span className={cn("text-[11px] text-[hsl(var(--muted-foreground))]/30", className)}>—</span>
  );

  const { label, isHuman } = fmtPrazoWeek(dueDate);
  const days   = fmtDaysLeft(dueDate);
  const color  = overdue ? "text-red-500" : "text-[hsl(var(--muted-foreground))]";
  const weight = overdue ? "font-semibold" : "font-normal";

  const DaysLine = () => days ? (
    <span className={`leading-tight ${days.cls}`} style={{ fontSize: "9px" }}>{days.text}</span>
  ) : null;

  if (!isHuman) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className={`text-xs ${weight} leading-tight ${color}`}>{label}</span>
        <DaysLine />
      </div>
    );
  }

  if (revealed) {
    return (
      <div
        className={cn("flex flex-col gap-0.5 cursor-pointer select-none", className)}
        onClick={() => setRevealed(false)}
        title="Clique para voltar"
      >
        <span className={`text-xs ${weight} leading-tight ${color}`}>{fmtDate(dueDate)}</span>
        <DaysLine />
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-0.5 cursor-pointer select-none", className)}
      onClick={() => setRevealed(true)}
      title={fmtDate(dueDate) ?? undefined}
    >
      <span className={`text-xs ${weight} leading-tight ${color}`}>{label}</span>
      <DaysLine />
    </div>
  );
}

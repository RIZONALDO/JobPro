import { cn, fmtDate, fmtClosedCycle, fmtPrazoWeek, fmtDaysLeft } from "@/lib/utils";

interface Props {
  dueDate: string | null;
  status: string;
  updatedAt: string;
  overdue: boolean;
  className?: string;
}

export function PrazoCell({ dueDate, status, updatedAt, overdue, className }: Props) {
  const closed = fmtClosedCycle(status, dueDate, updatedAt);
  if (closed) return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className={`text-xs font-semibold leading-tight ${closed.cls}`}>{closed.line1}</span>
      {closed.line2 && (
        <span className={`leading-tight ${closed.cls} opacity-70`} style={{ fontSize: "9px" }}>{closed.line2}</span>
      )}
    </div>
  );

  if (!dueDate) return (
    <span className={cn("text-[11px] text-[hsl(var(--muted-foreground))]/30", className)}>—</span>
  );

  const { label } = fmtPrazoWeek(dueDate);
  const days = fmtDaysLeft(dueDate);

  const dt    = new Date(dueDate.includes("T") ? dueDate : dueDate + "T00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - today.getTime()) / 86_400_000);
  const daysCls = diff < 0 ? "text-red-400" : diff === 0 ? "text-amber-600" : "text-[hsl(var(--muted-foreground))]/55";

  const lineColor  = overdue ? "text-red-500" : "text-[hsl(var(--muted-foreground))]";
  const lineWeight = overdue ? "font-semibold" : "font-normal";

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className={`text-xs ${lineWeight} leading-tight ${lineColor}`}>{label}</span>
      {days && <span className={`leading-tight ${daysCls}`} style={{ fontSize: "9px" }}>{days.text}</span>}
    </div>
  );
}

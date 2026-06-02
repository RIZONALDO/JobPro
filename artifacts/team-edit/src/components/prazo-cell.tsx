import { cn, fmtClosedCycle, fmtPrazoWeek, fmtDaysLeft } from "@/lib/utils";

interface Props {
  dueDate: string | null;
  status: string;
  updatedAt: string;
  overdue: boolean;
  reviewedAt?: string | null;
  className?: string;
}

const BADGE_CLS: Record<string, string> = {
  success:   "bg-emerald-50 border-emerald-200/80 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-400",
  late:      "bg-amber-50 border-amber-200/80 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-400",
  cancelled: "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/60",
  neutral:   "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/60",
};

export function PrazoCell({ dueDate, status, updatedAt, overdue, reviewedAt, className }: Props) {
  const closed = fmtClosedCycle(status, dueDate, updatedAt, reviewedAt);
  if (closed) return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs text-[hsl(var(--muted-foreground))]/60 tabular-nums leading-tight">
        {closed.date}
      </span>
      {closed.badge && (
        <span className={`inline-flex w-fit items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-none ${BADGE_CLS[closed.variant]}`}>
          {closed.badge}
        </span>
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

  const inReview = status === "review";
  const editorWasLate = inReview && diff < 0 && reviewedAt
    ? new Date(reviewedAt) > dt
    : false;
  const daysCls = (!inReview && diff < 0) ? "text-red-400" : diff === 0 ? "text-amber-600" : "text-[hsl(var(--muted-foreground))]/55";

  const lineColor  = overdue ? "text-red-500" : "text-[hsl(var(--muted-foreground))]";
  const lineWeight = overdue ? "font-semibold" : "font-normal";

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className={`text-xs ${lineWeight} leading-tight ${lineColor}`}>{label}</span>
      {inReview && diff < 0 && !editorWasLate
        ? <span className="leading-tight text-amber-500" style={{ fontSize: "9px" }}>Em aprovação</span>
        : days && <span className={`leading-tight ${daysCls}`} style={{ fontSize: "9px" }}>{days.text}</span>
      }
    </div>
  );
}

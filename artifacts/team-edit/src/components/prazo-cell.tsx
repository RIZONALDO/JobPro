import { cn } from "@/lib/utils";
import { fmtDate, daysFromToday } from "@/lib/date";

interface Props {
  dueDate: string | null;
  status: string;
  updatedAt: string;
  overdue: boolean;
  reviewedAt?: string | null;
  className?: string;
}

const TERMINAL = new Set(["completed", "cancelled", "paused"]);

function diffDays(dueDate: string): number {
  return daysFromToday(dueDate);
}

export function PrazoCell({ dueDate, status, className }: Props) {
  if (!dueDate) {
    return <span className={cn("text-[11px] text-[hsl(var(--muted-foreground))]/30", className)}>—</span>;
  }

  const date = fmtDate(dueDate) ?? "—";

  if (TERMINAL.has(status)) {
    return (
      <span className={cn("text-xs text-[hsl(var(--muted-foreground))]/50 tabular-nums", className)}>
        {date}
      </span>
    );
  }

  const diff = diffDays(dueDate);

  let countdown: string;
  let countdownCls: string;

  if (diff < 0) {
    countdown = `há ${Math.abs(diff)}d`;
    countdownCls = "text-red-500 font-semibold";
  } else if (diff === 0) {
    countdown = "hoje";
    countdownCls = "text-amber-500 font-semibold";
  } else if (diff === 1) {
    countdown = "amanhã";
    countdownCls = "text-amber-400";
  } else if (diff <= 7) {
    countdown = `em ${diff}d`;
    countdownCls = "text-amber-400";
  } else {
    countdown = `em ${diff}d`;
    countdownCls = "text-[hsl(var(--muted-foreground))]/50";
  }

  const dateCls = diff < 0
    ? "text-red-500 font-semibold"
    : "text-[hsl(var(--muted-foreground))]";

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className={`text-xs tabular-nums leading-tight ${dateCls}`}>{date}</span>
      <span className={`leading-tight tabular-nums ${countdownCls}`} style={{ fontSize: "9px" }}>{countdown}</span>
    </div>
  );
}

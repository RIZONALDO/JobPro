import { cn } from "@/lib/utils";

interface Props {
  dueDate: string | null;
  className?: string;
}

export function PrazoCell({ dueDate, className }: Props) {
  if (!dueDate) return (
    <span className={cn("text-[11px] text-[hsl(var(--muted-foreground))]/30", className)}>—</span>
  );

  const [y, m, d] = dueDate.split("T")[0].split("-");
  const label = `${d}/${m}/${y.slice(2)}`;

  return (
    <span className={cn("text-xs tabular-nums text-[hsl(var(--muted-foreground))]/70", className)}>
      {label}
    </span>
  );
}

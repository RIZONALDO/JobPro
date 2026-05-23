import { cn } from "@/lib/utils";

interface SubtaskProgressBarProps {
  total: number;
  completed: number;
  percentage: number;
  showLabel?: boolean;
  className?: string;
}

export function SubtaskProgressBar({ total, completed, percentage, showLabel = true, className }: SubtaskProgressBarProps) {
  const pct = Math.min(100, Math.max(0, percentage));

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{completed}/{total} subtarefas concluídas</span>
          <span className="font-medium">{pct}%</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-blue-500" : "bg-indigo-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

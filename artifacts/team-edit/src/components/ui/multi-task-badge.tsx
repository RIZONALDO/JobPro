import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiTaskBadgeProps {
  taskType: "task" | "multi_task" | "subtask" | string;
  parentTitle?: string;
  className?: string;
}

export function MultiTaskBadge({ taskType, parentTitle, className }: MultiTaskBadgeProps) {
  if (taskType === "multi_task") {
    return (
      <span title="Multi-tarefa" className={cn("inline-flex shrink-0", className)}>
        <Layers className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
      </span>
    );
  }

  if (taskType === "subtask") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300",
          className
        )}
        title={parentTitle ? `Subtarefa de: ${parentTitle}` : undefined}
      >
        Subtarefa
      </span>
    );
  }

  return null;
}

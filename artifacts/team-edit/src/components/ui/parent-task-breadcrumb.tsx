import { ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParentTaskBreadcrumbProps {
  parentTask: {
    id: number;
    title: string;
    taskCode?: string;
  };
  onClickParent?: (parentId: number) => void;
  className?: string;
}

export function ParentTaskBreadcrumb({ parentTask, onClickParent, className }: ParentTaskBreadcrumbProps) {
  return (
    <div className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Layers className="h-3 w-3 flex-shrink-0 text-indigo-500" />
      <button
        type="button"
        onClick={() => onClickParent?.(parentTask.id)}
        className={cn(
          "truncate max-w-[200px] text-left",
          onClickParent ? "text-indigo-600 hover:underline cursor-pointer dark:text-indigo-400" : "cursor-default"
        )}
      >
        {parentTask.taskCode ? `[${parentTask.taskCode}] ` : ""}{parentTask.title}
      </button>
      <ChevronRight className="h-3 w-3 flex-shrink-0" />
      <span className="text-foreground/70">esta subtarefa</span>
    </div>
  );
}

import { ArrowUp, Minus, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const PRIORITY_LABEL: Record<string, string> = {
  high: "Alta", medium: "Média", low: "Baixa",
};

const CONFIG = {
  high:   { Icon: ArrowUp,   cls: "text-red-500",   label: "Alta"  },
  medium: { Icon: Minus,     cls: "text-amber-500",  label: "Média" },
  low:    { Icon: ArrowDown, cls: "text-slate-400",  label: "Baixa" },
} as const;

interface Props {
  priority: string;
  showLabel?: boolean;
  className?: string;
}

export function PriorityBadge({ priority, showLabel = true, className }: Props) {
  const cfg = CONFIG[priority as keyof typeof CONFIG];
  if (!cfg) return null;
  const { Icon, cls, label } = cfg;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold shrink-0", cls, className)}>
      <Icon className="h-3 w-3 shrink-0" />
      {showLabel && label}
    </span>
  );
}

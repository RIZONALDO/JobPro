import { ArrowUp, Minus, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const PRIORITY_LABEL: Record<string, string> = {
  high: "Alta", medium: "Média", low: "Baixa",
};

const CONFIG = {
  high:   { Icon: ArrowUp,   cls: "text-rose-400/75",  label: "Alta"  },
  medium: { Icon: Minus,     cls: "text-amber-400/70", label: "Média" },
  low:    { Icon: ArrowDown, cls: "text-slate-400/50", label: "Baixa" },
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
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium shrink-0", cls, className)}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {showLabel && label}
    </span>
  );
}

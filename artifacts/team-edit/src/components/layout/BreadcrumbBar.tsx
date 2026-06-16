import { useLocation } from "wouter";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { useBreadcrumb } from "@/contexts/BreadcrumbContext";

export function BreadcrumbBar() {
  const { items, suffix, backHref, actions } = useBreadcrumb();
  const [, navigate] = useLocation();

  if (items.length === 0) return null;

  return (
    <div className="shrink-0 px-4 md:px-6 pt-4 pb-0">
      <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">

        {backHref && (
          <>
            <button
              onClick={() => navigate(backHref)}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-[hsl(var(--border))] shrink-0" />
          </>
        )}

        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--border))] shrink-0" />}
            {item.href ? (
              <button
                onClick={() => navigate(item.href!)}
                className="text-[11px] text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))]/80 transition-colors shrink-0"
                style={item.mono ? { fontFamily: "monospace" } : undefined}
              >
                {item.label}
              </button>
            ) : (
              <span
                className="text-sm font-semibold text-[hsl(var(--foreground))]/85 truncate"
                style={item.mono ? { fontFamily: "monospace", fontSize: "11px", fontWeight: 400, color: "hsl(var(--muted-foreground)/0.5)" } : undefined}
              >
                {item.label}
              </span>
            )}
          </div>
        ))}

        {suffix && <div className="shrink-0 ml-0.5">{suffix}</div>}
        {actions && <div className="shrink-0 ml-auto">{actions}</div>}
      </div>
    </div>
  );
}

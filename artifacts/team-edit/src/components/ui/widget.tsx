/** Moldura dos blocos do Dashboard e dos Relatórios: cabeçalho com ícone e divisória, corpo com respiro, altura cheia (alinha na grade). */
import { cn } from "@/lib/utils";
import type { Icon } from "@/lib/icons";

const muted = "text-[hsl(var(--muted-foreground))]";

export function Widget({ title, sub, right, icon: I, children, className, bodyClass }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; icon?: Icon; children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]", className)}>
      <header className="flex items-center gap-3 border-b px-4 py-3">
        {I && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-[hsl(var(--background))]"><I className="h-4 w-4" /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14.5px] font-semibold leading-tight">{title}</h2>
          {sub && <p className={cn("mt-0.5 truncate text-xs", muted)}>{sub}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col p-4", bodyClass)}>{children}</div>
    </section>
  );
}

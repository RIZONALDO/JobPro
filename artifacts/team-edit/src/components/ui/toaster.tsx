import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts } = useToast();
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-lg border p-4 shadow-lg text-sm animate-in slide-in-from-right-full",
            t.variant === "destructive"
              ? "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] border-[hsl(var(--destructive))]"
              : "bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border-[hsl(var(--border))]"
          )}
        >
          {t.title && <p className="font-semibold">{t.title}</p>}
          {t.description && <p className="text-xs mt-1 opacity-80">{t.description}</p>}
        </div>
      ))}
    </div>
  );
}

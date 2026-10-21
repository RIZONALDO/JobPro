import { cn } from "@/lib/utils";
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Info } from "@/lib/icons";
import { TONE, coordColor, deadlineState, type QTask } from "@/lib/fila";

export function Chip({ tone = "neu", children, className }: { tone?: keyof typeof TONE | string; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold", TONE[tone] ?? TONE.neu, className)}>{children}</span>;
}

export function DeadlineChip({ t, now }: { t: QTask; now: number }) {
  const d = deadlineState(t, now);
  return <Chip tone={d.tone}>{d.label}</Chip>;
}

export function Who({ id, name, className }: { id: number | null | undefined; name: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]", className)}>
      <i className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: coordColor(id) }} />{name}
    </span>
  );
}

type Tone = "bad" | "warn" | "info" | "ok";
const ALERT: Record<Tone, string> = {
  bad: "border-rose-500/40 bg-rose-500/[0.07]",
  warn: "border-amber-500/40 bg-amber-500/[0.07]",
  info: "border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.06)]",
  ok: "border-emerald-500/40 bg-emerald-500/[0.07]",
};
const ICON_TONE: Record<Tone, string> = { bad: "text-rose-500", warn: "text-amber-500", info: "text-[hsl(var(--primary))]", ok: "text-emerald-500" };

const TONE_ICON = { bad: AlertOctagon, warn: AlertTriangle, info: Info, ok: CheckCircle2 };

export function Alert({ tone = "info", icon, title, children }: { tone?: Tone; icon?: React.ReactNode; title?: React.ReactNode; children?: React.ReactNode }) {
  const Def = TONE_ICON[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-xl border px-3 py-2.5 text-[13px]", ALERT[tone])}>
      <span className={cn("mt-px grid h-4 w-4 shrink-0 place-items-center [&>svg]:h-4 [&>svg]:w-4", ICON_TONE[tone])}>{icon ?? <Def weight="regular" />}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {title && <b className="font-semibold leading-snug">{title}</b>}
        {children}
      </div>
    </div>
  );
}

export function Section({ title, sub, right, children, className }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2.5 rounded-2xl border bg-[hsl(var(--card))] p-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h2 className="text-sm font-bold">{title}</h2>{sub && <p className="text-xs text-[hsl(var(--muted-foreground))]">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Free({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed px-3 py-2 text-[13px] text-[hsl(var(--muted-foreground))]">{children}</div>;
}

export function Kv({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return <div className="flex justify-between gap-2 text-[13px]"><span className="text-[hsl(var(--muted-foreground))]">{k}</span><b className="text-right font-semibold">{v}</b></div>;
}

export const btn = {
  base: "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
  def: "bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--accent))]",
  pri: "border-transparent bg-[hsl(var(--primary))] text-white hover:opacity-90",
  go: "border-transparent bg-emerald-500 text-emerald-950 hover:bg-emerald-400",
  ghost: "border-transparent bg-transparent hover:bg-[hsl(var(--accent))]",
  danger: "border-rose-500/40 bg-transparent text-rose-500 hover:bg-rose-500/10",
  sm: "h-7 px-2.5 text-xs",
  lg: "h-10 px-4 text-sm",
  /** ação principal no cabeçalho da página (Novo job, Novo membro…): mesma altura dos controles do topo */
  head: "h-9 px-3.5 text-[13px]",
};
export function Btn({ v = "def", size, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { v?: "def" | "pri" | "go" | "ghost" | "danger"; size?: "sm" | "lg" | "head" }) {
  return <button type="button" {...p} className={cn(btn.base, btn[v], size && btn[size], className)} />;
}

/**
 * Ação principal do cabeçalho da página (Novo job, Novo membro…). Mesmo desenho em todas as páginas:
 * roxo sólido e chapado, com um fio de luz no contorno e o "+" separado por uma linha fina; sem brilho nem animação.
 * 36px como os controles do topo; a tecla de atalho, quando a página tem, aparece discreta ao lado.
 */
export function HeadAction({ icon: I, label, short, kbd, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ComponentType<{ className?: string; weight?: "bold" }>; label: string; short?: string; kbd?: string;
}) {
  return (
    <button type="button" title={kbd ? `${label} (${kbd})` : label} {...p}
      className={cn(
        "inline-flex h-9 shrink-0 items-stretch whitespace-nowrap rounded-lg text-[13px] font-semibold text-white",
        "bg-[hsl(var(--primary))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
        "transition-colors hover:bg-[color-mix(in_srgb,hsl(var(--primary))_88%,white)] active:bg-[color-mix(in_srgb,hsl(var(--primary))_90%,black)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]",
        "disabled:pointer-events-none disabled:opacity-50",
        className)}>
      <span className="grid w-9 place-items-center border-r border-white/15"><I className="h-4 w-4" weight="bold" /></span>
      <span className="flex items-center gap-2 px-3">
        {short ? <><span className="max-sm:hidden">{label}</span><span className="sm:hidden">{short}</span></> : label}
        {kbd && <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded bg-black/20 px-1 font-sans text-[10.5px] font-medium text-white/75 max-md:hidden">{kbd}</kbd>}
      </span>
    </button>
  );
}

export const inputCls = "h-8 min-w-0 rounded-lg border bg-[hsl(var(--background))] px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";

/** Bolinha de "ao vivo" (editando agora, online). Ícone Circle do Phosphor, preenchido. */
export function LiveDot({ pulse = true, className }: { pulse?: boolean; className?: string }) {
  return <Circle weight="fill" className={cn("h-2 w-2 shrink-0", pulse && "animate-pulse", className)} />;
}

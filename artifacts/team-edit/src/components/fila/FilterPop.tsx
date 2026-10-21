/** Filtro de múltipla escolha em popover (com busca e contagem). Usado em Jobs e Relatórios. */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Check, ChevronDown, Plus, X } from "@/lib/icons";

const muted = "text-[hsl(var(--muted-foreground))]";
export interface Opt { value: string | number; label: string; n: number; color?: string; avatar?: { name: string; avatarUrl?: string | null } }

export function FilterPop<T extends string | number>({ label, plural, options, value, onChange }: { label: string; plural: string; options: Opt[]; value: T[]; onChange: (v: T[]) => void }) {
  const [term, setTerm] = useState("");
  const list = options.filter(o => !term || o.label.toLowerCase().includes(term.toLowerCase()));
  const chosen = options.filter(o => value.includes(o.value as T));
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const on = value.length > 0;
  return (
    <Popover onOpenChange={o => !o && setTerm("")}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
          on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : "border-dashed text-[hsl(var(--muted-foreground))] hover:border-solid hover:text-[hsl(var(--foreground))]")}>
          {!on && <Plus className="h-3.5 w-3.5" />}
          <span className="truncate">{on ? (chosen.length === 1 ? chosen[0].label : `${chosen[0]?.label ?? label} +${value.length - 1}`) : label}</span>
          {on ? <span role="button" tabIndex={-1} aria-label={`Tirar filtro de ${label}`} onClick={e => { e.stopPropagation(); onChange([]); }} className="-mr-1 rounded-full p-0.5 hover:bg-[hsl(var(--primary)/0.2)]"><X className="h-3 w-3" /></span> : <ChevronDown className="h-3 w-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(280px,calc(100vw-32px))] p-0">
        <div className="border-b p-2">
          <input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder={`Buscar ${plural}`}
            className="h-8 w-full rounded-lg bg-[hsl(var(--muted)/0.6)] px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable>
          {list.map(o => {
            const sel = value.includes(o.value as T);
            return (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={sel} onClick={() => toggle(o.value as T)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))]", !o.n && !sel && "opacity-55")}>
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", sel && "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]")}>{sel && <Check className="h-3 w-3" weight="bold" />}</span>
                  {o.avatar ? <AvatarDisplay name={o.avatar.name} avatarUrl={o.avatar.avatarUrl ?? null} size={20} /> : <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className={cn("text-[11.5px] tabular-nums", muted)}>{o.n}</span>
                </button>
              </li>
            );
          })}
          {!list.length && <li className={cn("px-2 py-3 text-center text-[13px]", muted)}>Nada encontrado.</li>}
        </ul>
        {value.length > 0 && <div className="border-t p-1.5"><button type="button" onClick={() => onChange([])} className={cn("w-full rounded-lg py-1.5 text-xs font-semibold hover:bg-[hsl(var(--accent))]", muted)}>Limpar {label.toLowerCase()}</button></div>}
      </PopoverContent>
    </Popover>
  );
}

import { Eye, Plus, X } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { roleName } from "@/lib/roles";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Acompanhantes do job: gestores que seguem o job sem ser o dono (recebem os avisos e veem em "Meus jobs"). */

export interface FollowerUser { id: number; name: string; role: string; jobTitle?: string | null; avatarUrl?: string | null; status?: string }
export const FOLLOWER_ROLES = ["coordinator", "supervisor", "admin"];

/** Escolhe um ou mais gestores. `ownerId` (o dono) nunca aparece como opção. */
export function FollowersPicker({ users, value, onChange, ownerId, disabled, canRemove = () => true }: {
  users: FollowerUser[]; value: number[]; onChange: (ids: number[]) => void; ownerId?: number | null; disabled?: boolean;
  /** quem esta pessoa pode tirar da lista (os outros aparecem sem o ×) */
  canRemove?: (id: number) => boolean;
}) {
  const options = users.filter(u => FOLLOWER_ROLES.includes(u.role) && (u.status ?? "active") === "active" && u.id !== ownerId && !value.includes(u.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosen = value.map(id => users.find(u => u.id === id)).filter(Boolean) as FollowerUser[];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map(u => (
        <span key={u.id} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-[hsl(var(--secondary))] pl-1 pr-1.5 text-[13px]">
          <AvatarDisplay name={u.name} avatarUrl={u.avatarUrl ?? null} size={22} />
          <span className="font-semibold">{u.name.split(" ").slice(0, 2).join(" ")}</span>{roleName(u) && <span className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{roleName(u)}</span>}
          {!disabled && canRemove(u.id) && <button type="button" onClick={() => onChange(value.filter(x => x !== u.id))} aria-label={`Tirar ${u.name}`} className="rounded-full p-0.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"><X className="h-3.5 w-3.5" /></button>}
        </span>
      ))}
      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={!options.length} className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-[13px] font-semibold text-[hsl(var(--muted-foreground))] hover:border-solid hover:text-[hsl(var(--foreground))] disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" />{chosen.length ? "Adicionar" : "Adicionar gestor"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 min-w-[240px] overflow-y-auto">
            {options.map(u => (
              <DropdownMenuItem key={u.id} onSelect={() => onChange([...value, u.id])}>
                <AvatarDisplay name={u.name} avatarUrl={u.avatarUrl ?? null} size={22} />
                <span className="flex-1">{u.name}</span><span className="text-[11px] text-[hsl(var(--muted-foreground))]">{roleName(u)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {disabled && !chosen.length && <span className="text-[13px] text-[hsl(var(--muted-foreground))]">Ninguém além do gestor.</span>}
    </div>
  );
}

/** Pilha pequena de avatares de quem acompanha (para listas). */
export function FollowersStack({ people, className }: { people: { id: number; name: string; avatarUrl?: string | null }[]; className?: string }) {
  if (!people.length) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={`Acompanhando: ${people.map(p => p.name).join(", ")}`}>
      <Eye className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
      <span className="flex -space-x-1.5">{people.slice(0, 3).map(p => <AvatarDisplay key={p.id} name={p.name} avatarUrl={p.avatarUrl ?? null} size={18} className="ring-2 ring-[hsl(var(--card))]" />)}</span>
      {people.length > 3 && <span className="text-[11px] text-[hsl(var(--muted-foreground))]">+{people.length - 3}</span>}
    </span>
  );
}

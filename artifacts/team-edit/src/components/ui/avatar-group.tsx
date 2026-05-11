import { AvatarDisplay } from "./avatar-display";

interface Person { id: number; name: string; avatarUrl?: string | null; }

export function CoordinatorAvatar({ person }: { person: Person }) {
  return (
    <AvatarDisplay
      name={person.name}
      avatarUrl={person.avatarUrl}
      title={`Coordenador: ${person.name}`}
      className="h-10 w-10 text-sm bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border border-[hsl(var(--primary))]/30"
    />
  );
}

export function EditorAvatars({ people, max = 3 }: { people: Person[]; max?: number }) {
  if (!people.length) return null;
  const visible = people.slice(0, max);
  const rest = people.length - max;
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map(p => (
        <AvatarDisplay
          key={p.id}
          name={p.name}
          avatarUrl={p.avatarUrl}
          className="h-6 w-6 text-xs bg-slate-100 text-slate-600 border border-white"
        />
      ))}
      {rest > 0 && (
        <div className="h-6 w-6 rounded-full bg-slate-200 text-slate-500 border border-white flex items-center justify-center text-xs font-semibold shrink-0">
          +{rest}
        </div>
      )}
    </div>
  );
}

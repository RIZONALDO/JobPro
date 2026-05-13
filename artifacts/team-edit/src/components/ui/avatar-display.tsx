import { cn } from "@/lib/utils";

interface Person { id: number; name: string; avatarUrl?: string | null; }

interface AvatarDisplayProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  size?: number;
  fallbackColor?: string;
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function nameToColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 42%)`;
}

export function AvatarDisplay({ name, avatarUrl, className, style, title, size = 28, fallbackColor }: AvatarDisplayProps) {
  const sz = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.35)) };
  const merged = { ...sz, ...style };
  const bgColor = fallbackColor ?? nameToColor(name);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        title={title ?? name}
        className={cn("rounded-full object-cover shrink-0 ring-2 ring-[hsl(var(--border))]", className)}
        style={merged}
      />
    );
  }
  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-bold shrink-0 ring-2 ring-[hsl(var(--border))] select-none", className)}
      style={{ ...merged, backgroundColor: bgColor, color: "#fff" }}
      title={title ?? name}
    >
      {initials(name)}
    </div>
  );
}

interface StackedAvatarsProps {
  people: Person[];
  size?: number;
  max?: number;
  className?: string;
}

export function StackedAvatars({ people, size = 28, max = 3, className }: StackedAvatarsProps) {
  if (!people || people.length === 0) return null;

  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  const overlap = Math.round(size * 0.35);
  const fontSize = Math.max(9, Math.round(size * 0.35));

  return (
    <div className={cn("flex items-center", className)} style={{ gap: 0 }}>
      {visible.map((p, i) => (
        <div
          key={p.id}
          style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: visible.length - i }}
          className="relative"
        >
          <AvatarDisplay
            name={p.name}
            avatarUrl={p.avatarUrl}
            size={size}
            title={p.name}
          />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="rounded-full flex items-center justify-center font-bold shrink-0 ring-2 ring-[hsl(var(--border))] select-none bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          style={{ width: size, height: size, fontSize, marginLeft: -overlap, zIndex: 0 }}
          title={people.slice(max).map(p => p.name).join(", ")}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

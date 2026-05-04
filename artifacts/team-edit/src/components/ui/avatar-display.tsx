import { cn } from "@/lib/utils";

interface AvatarDisplayProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export function AvatarDisplay({ name, avatarUrl, className, style, title }: AvatarDisplayProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        title={title ?? name}
        className={cn("rounded-full object-cover shrink-0", className)}
        style={style}
      />
    );
  }
  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-bold shrink-0", className)}
      style={style}
      title={title ?? name}
    >
      {initials(name)}
    </div>
  );
}

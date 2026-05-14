import { useState, useRef, useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { AvatarDisplay } from "./avatar-display";
import { useChatContext } from "@/contexts/ChatContext";

interface Props {
  userId: number;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  taskCode?: string;
  taskTitle?: string;
}

export function ChatAvatarButton({ userId, name, avatarUrl, size = 30, taskCode, taskTitle }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { openDmWith } = useChatContext();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleConverse = () => {
    setOpen(false);
    const prefill = [taskCode, taskTitle].filter(Boolean).join(" — ");
    openDmWith(userId, prefill);
  };

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title={name}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="rounded-full hover:ring-2 hover:ring-[hsl(var(--primary))]/50 transition-all block"
      >
        <AvatarDisplay name={name} avatarUrl={avatarUrl} size={size} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-[200] min-w-[160px] rounded-xl border bg-[hsl(var(--card))] shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b bg-[hsl(var(--muted))]/50">
            <p className="text-xs font-semibold truncate max-w-[140px]">{name}</p>
          </div>
          <button
            type="button"
            onClick={handleConverse}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left"
          >
            <MessageCircle className="h-3.5 w-3.5 text-[hsl(var(--primary))] shrink-0" />
            Conversar
          </button>
        </div>
      )}
    </div>
  );
}

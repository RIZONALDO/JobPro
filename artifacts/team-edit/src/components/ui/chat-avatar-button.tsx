import { useState, useRef } from "react";
import { MessageCircle } from "lucide-react";
import { AvatarDisplay } from "./avatar-display";
import { useChatContext } from "@/contexts/ChatContext";

interface Props {
  userId: number;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  taskId?: number;
  taskCode?: string;
  taskTitle?: string;
}

export function ChatAvatarButton({ userId, name, avatarUrl, size = 30, taskId, taskCode, taskTitle }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { openDmWith } = useChatContext();

  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  const handleConverse = () => {
    setOpen(false);
    const codeRef = taskCode && taskId ? `[${taskCode}|id:${taskId}]` : taskCode ?? "";
    const prefill = [codeRef, taskTitle].filter(Boolean).join(" — ");
    openDmWith(userId, prefill);
  };

  return (
    <div
      className="relative"
      onClick={e => e.stopPropagation()}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        title={name}
        className={[
          "rounded-full block transition-all duration-200",
          open
            ? "ring-2 ring-[hsl(var(--primary))]/70 scale-110 shadow-md shadow-[hsl(var(--primary))]/20"
            : "hover:ring-2 hover:ring-[hsl(var(--primary))]/50 hover:scale-110",
        ].join(" ")}
      >
        <AvatarDisplay name={name} avatarUrl={avatarUrl} size={size} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-[200] min-w-[170px] rounded-xl border bg-[hsl(var(--card))] shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="px-3 py-2 border-b bg-[hsl(var(--muted))]/50">
            <p className="text-xs font-semibold truncate max-w-[150px]">{name}</p>
          </div>
          <button
            type="button"
            onClick={handleConverse}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left"
          >
            <MessageCircle className="h-3.5 w-3.5 text-[hsl(var(--primary))] shrink-0" />
            Conversar
          </button>
        </div>
      )}
    </div>
  );
}

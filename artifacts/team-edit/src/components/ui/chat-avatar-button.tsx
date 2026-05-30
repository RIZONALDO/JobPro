import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Zap, CalendarDays } from "lucide-react";
import { AvatarDisplay } from "./avatar-display";
import { useChatContext } from "@/contexts/ChatContext";
import { apiPost } from "@/lib/api";

interface Props {
  userId: number;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  taskId?: number;
  taskCode?: string;
  taskTitle?: string;
  onOpenAvailability?: () => void;
}

export function ChatAvatarButton({ userId, name, avatarUrl, size = 30, taskId, taskCode, taskTitle, onOpenAvailability }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { openDmWith } = useChatContext();

  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  const handleOpen = () => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    cancelClose();
    setOpen(true);
  };

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (anchorRef.current) {
        const r = anchorRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 6, left: r.left });
      }
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open]);

  const handleConverse = () => {
    setOpen(false);
    const codeRef = taskCode && taskId ? `[${taskCode}|id:${taskId}]` : taskCode ?? "";
    const prefill = [codeRef, taskTitle].filter(Boolean).join(" — ");
    openDmWith(userId, prefill);
  };

  const handlePoke = () => {
    setOpen(false);
    apiPost(`/api/poke/${userId}`, {}).catch(() => {});
  };

  return (
    <div
      ref={anchorRef}
      className="relative shrink-0"
      onClick={e => e.stopPropagation()}
      onMouseEnter={handleOpen}
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

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.7, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: -4 }}
              transition={{ type: "spring", stiffness: 420, damping: 18, mass: 0.6 }}
              style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
              className="min-w-[170px] rounded-xl border bg-[hsl(var(--card))] shadow-xl overflow-hidden origin-top-left"
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
              <button
                type="button"
                onClick={handlePoke}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left border-t"
              >
                <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                Cutucar
              </button>
              {onOpenAvailability && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); onOpenAvailability(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left border-t"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  Mapa de disponibilidade
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

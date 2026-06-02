import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Send, MessageCircle, X, ExternalLink, Check, CheckCheck, ChevronLeft, SmilePlus } from "lucide-react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatContext } from "@/contexts/ChatContext";
import { useLocation } from "wouter";
import { useSettings } from "@/contexts/SettingsContext";
import { playSound } from "@/lib/sounds";

// ── Types ────────────────────────────────────────────────────────

interface MentionUser { id: number; name: string; avatarUrl: string | null; }
interface ChatMessage {
  id: number; userId: number; content: string; createdAt: string;
  userName: string | null; userAvatar: string | null;
}
interface DmMessage {
  id: number; fromUserId: number; toUserId: number; content: string;
  createdAt: string; readAt: string | null;
  fromName: string | null; fromAvatar: string | null;
}
interface Conversation {
  userId: number; userName: string | null; userAvatar: string | null;
  lastMessage: string | null; lastAt: string | null; lastFromId: number | null;
  unread: number;
}
interface OnlineUser {
  userId: number; name: string | null; avatarUrl: string | null; isOnline: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtPreview(text: string) {
  return text.replace(/\[([^\]|]+)\|id:\d+\]/g, "[$1]");
}

function Avatar({
  name, url, size = "sm",
}: {
  name: string | null; url: string | null; size?: "xs" | "sm" | "md";
}) {
  const sizeClass =
    size === "xs" ? "h-6 w-6 text-[10px]" :
    size === "md" ? "h-9 w-9 text-sm" :
    "h-8 w-8 text-xs";
  const initials = (name ?? "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name ?? ""} className={cn(sizeClass, "rounded-full object-cover shrink-0")} />;
  return (
    <div className={cn(sizeClass, "rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center font-bold shrink-0")}>
      {initials}
    </div>
  );
}

function ChatTextarea({ value, onChange, onSend, users, placeholder }: {
  value: string; onChange: (v: string) => void; onSend?: () => void;
  users: MentionUser[]; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [showDrop, setShowDrop] = useState(false);
  const [query, setQuery] = useState("");
  const [atIndex, setAtIndex] = useState(-1);
  const [selIdx, setSelIdx] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState({ bottom: 0, right: 0 });
  const { theme } = useTheme();

  const filtered = users.filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 96)}px`;
  }, [value]);

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const insertEmoji = (emoji: { native: string }) => {
    const ta = ref.current;
    if (!ta) { onChange(value + emoji.native); setShowPicker(false); return; }
    const start = ta.selectionStart ?? value.length;
    const end   = ta.selectionEnd   ?? value.length;
    onChange(value.slice(0, start) + emoji.native + value.slice(end));
    setShowPicker(false);
    setTimeout(() => {
      ta.focus();
      const pos = start + emoji.native.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const checkAt = (val: string, cursor: number) => {
    const before = val.slice(0, cursor);
    const m = before.match(/@([\w\s]{0,30})$/);
    if (m && !m[1].startsWith(" ")) {
      setQuery(m[1]); setAtIndex(before.length - m[0].length); setShowDrop(true); setSelIdx(0);
    } else { setShowDrop(false); }
  };

  const selectUser = (u: MentionUser) => {
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, atIndex);
    const after = value.slice(cursor);
    onChange(`${before}@${u.name} ${after}`);
    setShowDrop(false);
    setTimeout(() => {
      if (!ref.current) return;
      const pos = before.length + u.name.length + 2;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDrop && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[selIdx]) selectUser(filtered[selIdx]); return; }
      if (e.key === "Escape")    { setShowDrop(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && onSend) { e.preventDefault(); onSend(); }
  };

  return (
    <div className="relative flex-1 min-w-0 flex items-end gap-1">
      <Textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); checkAt(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder={placeholder}
        rows={1}
        className="resize-none overflow-hidden border-none shadow-none focus-visible:ring-0 bg-transparent p-0 text-[15px] placeholder:text-[hsl(var(--muted-foreground))] flex-1 leading-relaxed"
      />
      <button
        ref={emojiButtonRef}
        type="button"
        onMouseDown={e => {
          e.preventDefault();
          if (!showPicker && emojiButtonRef.current) {
            const r = emojiButtonRef.current.getBoundingClientRect();
            setPickerPos({ bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right });
          }
          setShowPicker(v => !v);
        }}
        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted-foreground))]/10 transition-colors"
        title="Emoji"
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {showPicker && createPortal(
        <div
          ref={pickerRef}
          style={{ position: "fixed", bottom: pickerPos.bottom, right: pickerPos.right, zIndex: 9999 }}
        >
          <Picker
            data={data}
            onEmojiSelect={insertEmoji}
            locale="pt"
            theme={theme}
            previewPosition="none"
            skinTonePosition="none"
            maxFrequentRows={2}
            perLine={8}
          />
        </div>,
        document.body
      )}
      {showDrop && filtered.length > 0 && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 w-52 rounded-2xl border bg-[hsl(var(--card))] shadow-xl z-[300] overflow-hidden">
          <div className="px-3 py-2 border-b bg-[hsl(var(--muted))]">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Mencionar</span>
          </div>
          {filtered.map((u, i) => (
            <button key={u.id} onMouseDown={() => selectUser(u)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--muted))] transition-colors text-left",
                i === selIdx && "bg-[hsl(var(--muted))]")}>
              <Avatar name={u.name} url={u.avatarUrl} size="xs" />
              <span className="text-sm font-medium truncate">{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task link renderer ───────────────────────────────────────────

const TASK_REF = /\[([^\]|]+)\|id:(\d+)\]/g;

function MsgContent({ text, mine, onClose }: {
  text: string;
  mine: boolean;
  onClose: () => void;
}) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TASK_REF.lastIndex = 0;
  while ((m = TASK_REF.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={last}>{text.slice(last, m.index)}</span>);
    const code = m[1], id = m[2];
    nodes.push(
      <button
        key={m.index}
        type="button"
        onClick={() => { onClose(); window.location.href = `/tasks?tab=lista&highlight=${id}`; }}
        className={cn(
          "font-mono font-bold underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer",
          mine ? "text-white" : "text-[hsl(var(--primary))]"
        )}
        title="Abrir tarefa"
      >
        [{code}]
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={last}>{text.slice(last)}</span>);
  return <>{nodes}</>;
}

// ── Slide variants ───────────────────────────────────────────────
const SLIDE = {
  enter: (d: number) => ({ x: d * 36, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d * -36, opacity: 0 }),
};
const SLIDE_T = { type: "spring", stiffness: 420, damping: 34 } as const;

// ── ChatWidget ───────────────────────────────────────────────────

export function ChatWidget() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { _register } = useChatContext();
  const [, navigate] = useLocation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [generalUnread, setGeneralUnread] = useState(0);
  const [hasMention, setHasMention] = useState(false);

  const [dmMessages, setDmMessages] = useState<Record<number, DmMessage[]>>({});
  const [dmHasMore, setDmHasMore] = useState<Record<number, boolean>>({});
  const [dmLoadingMore, setDmLoadingMore] = useState<Set<number>>(new Set());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [dmUnread, setDmUnread] = useState<Record<number, number>>({});
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmTaskRef, setDmTaskRef] = useState<{ code: string; id: string; title: string } | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [activeView, setActiveView] = useState<"list" | "general" | number>("list");
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [allUsers, setAllUsers] = useState<MentionUser[]>([]);

  const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set());

  // Snapshot do número de não lidas no momento de abrir a conversa (para o divisor)
  const [unreadSnapshot, setUnreadSnapshot] = useState<Record<number, number>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const dmEndRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const dmScrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeViewRef = useRef<"list" | "general" | number>("list");
  const chatOpenRef = useRef(false);
  const typingTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const lastTypingEmitRef = useRef<number>(0);
  const lastSoundRef = useRef<number>(0);
  const scrollAttemptRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  // ── Auto-clear DM unread + scroll ao foco quando chat abre numa conversa ──
  useEffect(() => {
    if (!chatOpen || typeof activeView !== "number") return;
    setDmUnread(prev => {
      if ((prev[activeView] ?? 0) === 0) return prev;
      return { ...prev, [activeView]: 0 };
    });
    apiPost(`/api/dm/${activeView}/read`, {}).catch(() => {});
    // Garante scroll ao reabrir chat (FAB) com conversa já ativa
    scrollDmToTarget(80);
  }, [chatOpen, activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Limpa snapshot ao fechar o chat (próxima abertura começa limpa) ──
  useEffect(() => {
    if (chatOpen) return;
    const t = setTimeout(() => setUnreadSnapshot({}), 400);
    return () => clearTimeout(t);
  }, [chatOpen]);

  const totalUnread = generalUnread + Object.values(dmUnread).reduce((a, b) => a + b, 0);
  const hasAlert = hasMention || Object.values(dmUnread).some(n => n > 0);

  // Número de mensagens da conversa DM atualmente aberta (usado no efeito de scroll)
  const activeDmLength = typeof activeView === "number"
    ? (dmMessages[activeView as number]?.length ?? 0)
    : 0;

  // Som de notificação — dispara no máximo 1x a cada 3s, só com chat fechado
  const playNotificationSound = useCallback(() => {
    if (chatOpenRef.current) return;
    const now = Date.now();
    if (now - lastSoundRef.current < 3000) return;
    lastSoundRef.current = now;
    playSound(settings.sound_chat);
  }, [settings.sound_chat]);

  // Click outside to close
  useEffect(() => {
    if (!chatOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        fabRef.current && !fabRef.current.contains(e.target as Node)
      ) setChatOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [chatOpen]);

  const loadConversations = useCallback(() => {
    apiFetch<Conversation[]>("/api/dm/conversations").then(setConversations).catch(() => {});
  }, []);

  const openDm = useCallback((userId: number, prefill?: string) => {
    setSlideDir(1);
    setActiveView(userId);

    // Captura quantas msgs não lidas existem agora para posicionar o divisor
    setDmUnread(cur => {
      const serverUnread = conversations.find(c => c.userId === userId)?.unread ?? 0;
      const localUnread = cur[userId] ?? serverUnread;
      if (localUnread > 0) {
        setUnreadSnapshot(snap => ({ ...snap, [userId]: localUnread }));
      }
      return cur; // não altera dmUnread — o useEffect cuida disso
    });

    if (prefill) {
      const m = prefill.match(/^\[([^\]|]+)\|id:(\d+)\](?:\s*[-—]\s*(.+))?/);
      if (m) {
        setDmTaskRef({ code: m[1], id: m[2], title: m[3]?.trim() ?? "" });
        setDmText("");
      } else {
        setDmTaskRef(null);
        setDmText(prefill);
      }
    } else {
      setDmTaskRef(null);
    }
    if (!dmMessages[userId]) {
      apiFetch<{ messages: DmMessage[]; hasMore: boolean }>(`/api/dm/${userId}`)
        .then(({ messages: msgs, hasMore }) => {
          setDmMessages(prev => ({ ...prev, [userId]: msgs }));
          setDmHasMore(prev => ({ ...prev, [userId]: hasMore }));
          setDmUnread(prev => ({ ...prev, [userId]: 0 }));
          loadConversations();
          // Mensagens chegaram — aguarda React renderizar e rola para o alvo
          scrollDmToTarget(60);
        }).catch(() => {});
    } else {
      apiPost(`/api/dm/${userId}/read`, {}).catch(() => {});
      setDmUnread(prev => ({ ...prev, [userId]: 0 }));
      // Cache: mensagens já no DOM, rola imediatamente
      scrollDmToTarget(60);
    }
  }, [dmMessages, loadConversations]);

  const ping = useCallback(() => { apiPost("/api/presence/ping", {}).catch(() => {}); }, []);

  // Rola o container DM para o divisor de não lidas (se existir) ou para o fim.
  // Usa retry porque o AnimatePresence mode="wait" pode manter o DM desmontado
  // enquanto a list-view termina sua animação de saída — os timers curtos disparariam
  // com dmScrollRef.current === null. O retry aguarda até a ref estar pronta e
  // o conteúdo renderizado (scrollHeight > clientHeight).
  const scrollDmToTarget = useCallback((delay = 50) => {
    if (scrollAttemptRef.current) clearTimeout(scrollAttemptRef.current);
    let retries = 0;
    const MAX_RETRIES = 14; // 14 × 50 ms = 700 ms máximo
    const attempt = () => {
      scrollAttemptRef.current = setTimeout(() => {
        const scrollEl = dmScrollRef.current;
        if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 5) {
          if (retries < MAX_RETRIES) { retries++; attempt(); }
          return;
        }
        if (firstUnreadRef.current) {
          scrollEl.scrollTop = Math.max(0, firstUnreadRef.current.offsetTop - 16);
        } else {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      }, delay);
    };
    attempt();
  }, []);

  // Carrega mensagens mais antigas (scroll para cima)
  const loadMoreDm = useCallback(async (userId: number) => {
    setDmLoadingMore(prev => {
      if (prev.has(userId)) return prev; // já carregando
      return new Set(prev).add(userId);
    });
    const msgs = dmMessages[userId];
    if (!msgs?.length) { setDmLoadingMore(prev => { const s = new Set(prev); s.delete(userId); return s; }); return; }

    const firstId = msgs[0]!.id;
    const scrollEl = dmScrollRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight ?? 0;

    try {
      const { messages: older, hasMore } = await apiFetch<{ messages: DmMessage[]; hasMore: boolean }>(
        `/api/dm/${userId}?before=${firstId}`
      );
      setDmMessages(prev => ({ ...prev, [userId]: [...older, ...(prev[userId] ?? [])] }));
      setDmHasMore(prev => ({ ...prev, [userId]: hasMore }));
      // Restaura posição do scroll para não pular para o topo
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
      });
    } catch { /* silencioso */ } finally {
      setDmLoadingMore(prev => { const s = new Set(prev); s.delete(userId); return s; });
    }
  }, [dmMessages]);

  useEffect(() => {
    apiFetch<ChatMessage[]>("/api/chat/messages").then(setMessages).catch(() => {}).finally(() => setLoadingChat(false));
    apiFetch<OnlineUser[]>("/api/presence").then(setOnlineUsers).catch(() => {});
    apiFetch<MentionUser[]>("/api/users").then(setAllUsers).catch(() => {});
    loadConversations();
    ping();
    pingRef.current = setInterval(ping, 30_000);
    return () => { if (pingRef.current) clearInterval(pingRef.current); };
  }, []);

  // Scroll canal geral — suave em novas mensagens, instantâneo ao abrir a view
  useEffect(() => {
    if (activeView !== "general") return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  useEffect(() => {
    if (activeView !== "general") return;
    const t = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "instant" }), 120);
    return () => clearTimeout(t);
  }, [activeView]);

  // Detecta scroll no topo para carregar mensagens anteriores
  useEffect(() => {
    const el = dmScrollRef.current;
    if (!el || typeof activeView !== "number") return;
    const onScroll = () => {
      if (el.scrollTop < 80 && dmHasMore[activeView as number] && !dmLoadingMore.has(activeView as number)) {
        loadMoreDm(activeView as number);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeView, dmHasMore, dmLoadingMore, loadMoreDm]);
  // Scroll suave para o fim quando chega mensagem nova — só se o usuário já estava perto do fim
  useEffect(() => {
    const scrollEl = dmScrollRef.current;
    if (typeof activeView !== "number" || activeDmLength === 0 || !scrollEl) return;
    const distFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distFromBottom < 120) scrollEl.scrollTop = scrollEl.scrollHeight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDmLength]);

  useEffect(() => _register((userId, prefill) => {
    setChatOpen(true);
    openDm(userId, prefill);
  }), [_register, openDm]);

  useEffect(() => {
    const socket = getSocket();
    const onChatMessage = (msg: ChatMessage) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        // Remove optimistic placeholders (negative id) when the real message arrives from the same user
        const base = msg.userId === user?.id ? prev.filter(m => m.id > 0) : prev;
        return [...base, msg];
      });
      if (!chatOpenRef.current || activeViewRef.current !== "general") {
        setGeneralUnread(prev => {
          if (prev === 0) playNotificationSound(); // só toca na 1ª msg não lida
          return prev + 1;
        });
        if (user && msg.content.toLowerCase().includes(`@${(user.name ?? "").toLowerCase()}`)) setHasMention(true);
      }
    };
    const onDmMessage = (msg: DmMessage) => {
      const otherId = msg.fromUserId === user?.id ? msg.toUserId : msg.fromUserId;
      setDmMessages(prev => {
        const existing = prev[otherId] ?? [];
        if (existing.some(m => m.id === msg.id)) return prev;
        // Remove optimistic placeholder (negative id) quando mensagem real do próprio usuário chega
        const base = msg.fromUserId === user?.id ? existing.filter(m => m.id > 0) : existing;
        return { ...prev, [otherId]: [...base, msg] };
      });
      loadConversations();
      if (!chatOpenRef.current || activeViewRef.current !== otherId) {
        if (msg.fromUserId !== user?.id) {
          setDmUnread(prev => {
            const current = prev[otherId] ?? 0;
            if (current === 0) playNotificationSound(); // só toca na 1ª msg não lida
            return { ...prev, [otherId]: current + 1 };
          });
        }
      } else {
        apiPost(`/api/dm/${otherId}/read`, {}).catch(() => {});
      }
    };
    const onPresence = ({ userId, isOnline, user: u }: { userId: number; isOnline: boolean; user: OnlineUser }) =>
      setOnlineUsers(prev => isOnline
        ? prev.some(p => p.userId === userId) ? prev : [...prev, { ...u, userId, isOnline: true }]
        : prev.filter(p => p.userId !== userId));

    const onDmTyping = ({ fromUserId }: { fromUserId: number }) => {
      setTypingUsers(prev => new Set(prev).add(fromUserId));
      if (typingTimeoutsRef.current[fromUserId]) clearTimeout(typingTimeoutsRef.current[fromUserId]);
      typingTimeoutsRef.current[fromUserId] = setTimeout(() => {
        setTypingUsers(prev => { const s = new Set(prev); s.delete(fromUserId); return s; });
      }, 3000);
    };

    const onDmRead = ({ byUserId }: { byUserId: number }) => {
      const readAt = new Date().toISOString();
      setDmMessages(prev => {
        const msgs = prev[byUserId];
        if (!msgs) return prev;
        return {
          ...prev,
          [byUserId]: msgs.map(m =>
            m.fromUserId === user?.id && !m.readAt ? { ...m, readAt } : m
          ),
        };
      });
    };

    socket.on("chat:message", onChatMessage);
    socket.on("dm:message", onDmMessage);
    socket.on("presence:update", onPresence);
    socket.on("dm:read", onDmRead);
    socket.on("dm:typing", onDmTyping);
    return () => {
      socket.off("chat:message", onChatMessage);
      socket.off("dm:message", onDmMessage);
      socket.off("presence:update", onPresence);
      socket.off("dm:read", onDmRead);
      socket.off("dm:typing", onDmTyping);
    };
  }, [user]);

  const sendMsg = async () => {
    if (!msgText.trim() || !user) return;
    const text = msgText.trim();
    const optimisticId = -Date.now();
    setMessages(prev => [...prev, {
      id: optimisticId,
      userId: user.id,
      content: text,
      createdAt: new Date().toISOString(),
      userName: user.name ?? null,
      userAvatar: user.avatarUrl ?? null,
    }]);
    setMsgText("");
    try {
      await apiPost("/api/chat/messages", { content: text });
      // Socket handler already replaced the optimistic msg with the real one;
      // ensure cleanup in case socket is delayed
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setMsgText(text);
    }
  };

  const sendDm = async () => {
    if (typeof activeView !== "number" || !user) return;
    const taskPart = dmTaskRef
      ? `[${dmTaskRef.code}|id:${dmTaskRef.id}]${dmTaskRef.title ? ` — ${dmTaskRef.title}` : ""}`
      : "";
    const content = [taskPart, dmText.trim()].filter(Boolean).join("\n").trim();
    if (!content) return;

    // Optimistic update — mostra a mensagem imediatamente
    const toUserId = activeView;
    const optimisticId = -Date.now();
    setDmMessages(prev => ({
      ...prev,
      [toUserId]: [...(prev[toUserId] ?? []), {
        id: optimisticId,
        fromUserId: user.id,
        toUserId,
        content,
        createdAt: new Date().toISOString(),
        readAt: null,
        fromName: user.name ?? null,
        fromAvatar: user.avatarUrl ?? null,
      }],
    }));
    setDmText("");
    setDmTaskRef(null);

    setDmSending(true);
    try {
      await apiPost(`/api/dm/${toUserId}`, { content });
      // O socket (onDmMessage) já limpa o placeholder ao chegar; este filter é fallback
      setDmMessages(prev => ({
        ...prev,
        [toUserId]: (prev[toUserId] ?? []).filter(m => m.id !== optimisticId),
      }));
      loadConversations();
    } catch {
      // Rollback
      setDmMessages(prev => ({
        ...prev,
        [toUserId]: (prev[toUserId] ?? []).filter(m => m.id !== optimisticId),
      }));
      setDmText(content);
    } finally { setDmSending(false); }
  };

  const openChat = () => {
    setChatOpen(true);
    if (activeView === "general") { setGeneralUnread(0); setHasMention(false); }
    if (activeView === "list") { /* keep list */ }
  };

  const navUsers: { id: number; name: string | null; avatarUrl: string | null }[] = [
    ...conversations.map(c => ({ id: c.userId, name: c.userName, avatarUrl: c.userAvatar })),
    ...allUsers.filter(u => u.id !== user?.id && !conversations.some(c => c.userId === u.id)),
  ];

  const currentDmUser: { id: number; name: string | null; avatarUrl: string | null } | null =
    typeof activeView === "number"
      ? (allUsers.find(u => u.id === activeView) ??
          (() => {
            const c = conversations.find(c => c.userId === (activeView as number));
            return c ? { id: c.userId, name: c.userName, avatarUrl: c.userAvatar } : null;
          })())
      : null;

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-40 sm:hidden"
            onClick={() => setChatOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* FAB */}
      <div className="fixed bottom-5 right-5 z-[52]">
        <motion.button
          ref={fabRef}
          onClick={() => chatOpen ? setChatOpen(false) : openChat()}
          whileTap={{ scale: 0.88 }}
          whileHover={{ scale: 1.08 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className={cn(
            "relative h-12 w-12 rounded-full flex items-center justify-center shadow-lg transition-colors duration-200",
            chatOpen || totalUnread > 0 || hasAlert
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "bg-[hsl(var(--card))] border-2 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {chatOpen ? (
              <motion.span key="x"
                initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.14 }}>
                <X className="h-5 w-5" />
              </motion.span>
            ) : (
              <motion.span key="chat"
                initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.14 }}>
                <MessageCircle className="h-5 w-5" />
              </motion.span>
            )}
          </AnimatePresence>
          {!chatOpen && (totalUnread > 0 || hasMention) && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">
              {totalUnread > 99 ? "99+" : totalUnread > 0 ? totalUnread : ""}
            </span>
          )}
        </motion.button>
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            ref={panelRef}
            key="panel"
            initial={{ opacity: 0, y: 40, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.16, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.9 }}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden shadow-2xl",
              "bottom-0 left-0 right-0 h-[85dvh] rounded-t-3xl border-t border-x",
              "sm:bottom-20 sm:right-5 sm:left-auto sm:w-[420px] sm:h-[580px] sm:rounded-3xl sm:border"
            )}
            style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            {/* Mobile drag handle */}
            <div className="sm:hidden absolute top-2.5 left-0 right-0 flex justify-center pointer-events-none z-10">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: "hsl(var(--muted-foreground))" }} />
            </div>

            {/* ── Unified header ── */}
            <div
              className="shrink-0 flex items-center gap-1 px-2 pt-8 pb-2.5 sm:pt-2.5 border-b"
              style={{ backgroundColor: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}
            >
              {/* Back button — slides in when leaving list */}
              <AnimatePresence initial={false}>
                {activeView !== "list" && (
                  <motion.button
                    key="back"
                    initial={{ opacity: 0, x: -10, width: 0 }}
                    animate={{ opacity: 1, x: 0, width: 32 }}
                    exit={{ opacity: 0, x: -10, width: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => { setSlideDir(-1); setActiveView("list"); }}
                    className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 hover:bg-[hsl(var(--accent))] transition-colors overflow-hidden"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Title / info */}
              <div className="flex-1 min-w-0 flex items-center gap-2.5 px-1">
                {activeView === "list" && (
                  <>
                    <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--primary))" }}>
                      <MessageCircle className="h-4 w-4" style={{ color: "hsl(var(--primary-foreground))" }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">Conversas</p>
                      {onlineUsers.length > 0 && (
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{onlineUsers.length} online</p>
                      )}
                    </div>
                  </>
                )}
                {activeView === "general" && (
                  <>
                    <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--primary))" }}>
                      <MessageCircle className="h-4 w-4" style={{ color: "hsl(var(--primary-foreground))" }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">Canal Geral</p>
                      {onlineUsers.length > 0 && (
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{onlineUsers.length} online</p>
                      )}
                    </div>
                  </>
                )}
                {typeof activeView === "number" && (
                  <>
                    <div className="relative shrink-0">
                      <Avatar name={currentDmUser?.name ?? null} url={currentDmUser?.avatarUrl ?? null} size="sm" />
                      <span
                        className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2"
                        style={{
                          backgroundColor: onlineUsers.some(u => u.userId === (activeView as number)) ? "rgb(16 185 129)" : "hsl(var(--muted-foreground))",
                          borderColor: "hsl(var(--muted))",
                        }}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight truncate">{currentDmUser?.name ?? "?"}</p>
                      <p className="text-xs" style={{ color: onlineUsers.some(u => u.userId === (activeView as number)) ? "rgb(5 150 105)" : "hsl(var(--muted-foreground))" }}>
                        {onlineUsers.some(u => u.userId === (activeView as number)) ? "● online" : "offline"}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* X close — always right */}
              <button
                onClick={() => setChatOpen(false)}
                className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 hover:bg-[hsl(var(--accent))] transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Animated views ── */}
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <AnimatePresence custom={slideDir} mode="wait">

                {/* LIST VIEW */}
                {activeView === "list" && (
                  <motion.div
                    key="list"
                    custom={slideDir}
                    variants={SLIDE}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={SLIDE_T}
                    className="absolute inset-0 flex flex-col overflow-y-auto"
                    style={{ backgroundColor: "hsl(var(--card))" }}
                  >
                    {/* Canal Geral row */}
                    <button
                      onClick={() => { setSlideDir(1); setActiveView("general"); setGeneralUnread(0); setHasMention(false); }}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-[hsl(var(--muted))] transition-colors border-b text-left shrink-0"
                      style={{ borderColor: "hsl(var(--border))" }}
                    >
                      <div className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--primary))" }}>
                        <MessageCircle className="h-5 w-5" style={{ color: "hsl(var(--primary-foreground))" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">Canal Geral</p>
                        <p className="text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {messages.length > 0 ? fmtPreview(messages[messages.length - 1].content) : "Canal público da equipe"}
                        </p>
                      </div>
                      {(generalUnread > 0 || hasMention) && (
                        <span className="min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                          {generalUnread > 9 ? "9+" : generalUnread || "•"}
                        </span>
                      )}
                    </button>

                    {/* DM list */}
                    {navUsers.map(u => {
                      const conv = conversations.find(c => c.userId === u.id);
                      const unread = dmUnread[u.id] ?? conv?.unread ?? 0;
                      const isOnline = onlineUsers.some(o => o.userId === u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => openDm(u.id)}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))] transition-colors border-b text-left shrink-0"
                          style={{ borderColor: "hsl(var(--border))" }}
                        >
                          <div className="relative shrink-0">
                            <Avatar name={u.name} url={u.avatarUrl} size="sm" />
                            {isOnline && (
                              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2" style={{ borderColor: "hsl(var(--card))" }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{u.name ?? "?"}</p>
                            {conv?.lastMessage && (
                              <p className="text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {conv.lastFromId === user?.id ? "Você: " : ""}{fmtPreview(conv.lastMessage)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {conv?.lastAt && (
                              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{timeAgo(conv.lastAt)}</span>
                            )}
                            {unread > 0 && (
                              <span className="min-w-[20px] h-5 px-1 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-bold flex items-center justify-center">
                                {unread > 9 ? "9+" : unread}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}

                    {navUsers.length === 0 && (
                      <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Nenhuma conversa ainda.</p>
                    )}
                  </motion.div>
                )}

                {/* GENERAL VIEW */}
                {activeView === "general" && (
                  <motion.div
                    key="general"
                    custom={slideDir}
                    variants={SLIDE}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={SLIDE_T}
                    className="absolute inset-0 flex flex-col"
                    style={{ backgroundColor: "hsl(var(--card))" }}
                  >
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {loadingChat ? (
                        <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Carregando...</p>
                      ) : messages.length === 0 ? (
                        <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Sem mensagens. Diga olá! 👋</p>
                      ) : messages.map(msg => {
                        const mine = msg.userId === user?.id;
                        return (
                          <div key={msg.id} className={cn("flex gap-2 items-end", mine && "flex-row-reverse")}>
                            {!mine && <Avatar name={msg.userName} url={msg.userAvatar} size="xs" />}
                            <div
                              className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm"
                              style={mine
                                ? { backgroundColor: "hsl(var(--primary) / 0.82)", color: "hsl(var(--primary-foreground))", borderBottomRightRadius: "4px" }
                                : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))", borderBottomLeftRadius: "4px" }
                              }
                            >
                              {!mine && <p className="text-[12px] font-semibold mb-0.5 opacity-60">{msg.userName}</p>}
                              <div className="whitespace-pre-wrap break-words"><MsgContent text={msg.content} mine={mine} onClose={() => setChatOpen(false)} /></div>
                              <p className="text-[11px] mt-1 opacity-40 text-right">{fmtTime(msg.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="shrink-0 p-3 border-t" style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                      <div className="flex gap-2 items-end rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "hsl(var(--muted))" }}>
                        <ChatTextarea value={msgText} onChange={setMsgText} onSend={sendMsg} users={allUsers} placeholder="Mensagem..." />
                        <Button size="sm" onClick={sendMsg} disabled={!msgText.trim()} className="h-8 w-8 p-0 shrink-0 rounded-xl">
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* DM VIEW */}
                {typeof activeView === "number" && (
                  <motion.div
                    key={`dm-${activeView}`}
                    custom={slideDir}
                    variants={SLIDE}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={SLIDE_T}
                    onAnimationComplete={(def) => {
                      // Quando a animação de entrada termina, o ref está garantidamente
                      // apontando para o elemento correto — dispara o scroll.
                      if (def === "center") scrollDmToTarget(0);
                    }}
                    className="absolute inset-0 flex flex-col"
                    style={{ backgroundColor: "hsl(var(--card))" }}
                  >
                    <div ref={dmScrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {/* Indicador de "carregar mais" no topo */}
                      {dmLoadingMore.has(activeView as number) && (
                        <div className="flex justify-center py-2">
                          <span className="text-xs px-3 py-1 rounded-full" style={{ color: "hsl(var(--muted-foreground))", backgroundColor: "hsl(var(--muted))" }}>
                            Carregando mensagens anteriores…
                          </span>
                        </div>
                      )}
                      {dmHasMore[activeView as number] && !dmLoadingMore.has(activeView as number) && (
                        <div className="flex justify-center py-1">
                          <button
                            onClick={() => loadMoreDm(activeView as number)}
                            className="text-xs px-3 py-1 rounded-full transition-colors"
                            style={{ color: "hsl(var(--primary))", backgroundColor: "hsl(var(--primary) / 0.08)" }}
                          >
                            ↑ Ver mensagens anteriores
                          </button>
                        </div>
                      )}
                      {!(dmMessages[activeView as number]) ? (
                        <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Carregando...</p>
                      ) : (dmMessages[activeView as number] ?? []).length === 0 ? (
                        <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Nenhuma mensagem. Diga olá! 👋</p>
                      ) : (dmMessages[activeView as number] ?? []).map((msg, idx) => {
                        const mine = msg.fromUserId === user?.id;
                        const snap = unreadSnapshot[activeView as number] ?? 0;
                        const firstUnreadIdx = snap > 0 ? (dmMessages[activeView as number]?.length ?? 0) - snap : -1;
                        return (
                          <div key={msg.id}>
                            {idx === firstUnreadIdx && (
                              <div
                                ref={firstUnreadRef}
                                className="flex items-center gap-2 my-2 select-none"
                              >
                                <div className="flex-1 h-px" style={{ backgroundColor: "hsl(var(--primary) / 0.3)" }} />
                                <span
                                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                  style={{ color: "hsl(var(--primary))", backgroundColor: "hsl(var(--primary) / 0.1)" }}
                                >
                                  {snap} {snap === 1 ? "mensagem não lida" : "mensagens não lidas"}
                                </span>
                                <div className="flex-1 h-px" style={{ backgroundColor: "hsl(var(--primary) / 0.3)" }} />
                              </div>
                            )}
                            <div className={cn("flex gap-2 items-end", mine && "flex-row-reverse")}>
                              {!mine && <Avatar name={msg.fromName} url={msg.fromAvatar} size="xs" />}
                              <div
                                className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm"
                                style={mine
                                  ? { backgroundColor: "hsl(var(--primary) / 0.82)", color: "hsl(var(--primary-foreground))", borderBottomRightRadius: "4px" }
                                  : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))", borderBottomLeftRadius: "4px" }
                                }
                              >
                                <div className="whitespace-pre-wrap break-words"><MsgContent text={msg.content} mine={mine} onClose={() => setChatOpen(false)} /></div>
                                <div className="flex items-center justify-end gap-1 mt-1">
                                  <span className="text-[11px] opacity-40">{fmtTime(msg.createdAt)}</span>
                                  {mine && (
                                    msg.readAt
                                      ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                                      : <Check className="h-3.5 w-3.5 shrink-0 opacity-40" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={dmEndRef} />
                    </div>

                    {/* Typing indicator — outside scroll to prevent jump */}
                    {typingUsers.has(activeView as number) && (
                      <div className="shrink-0 flex gap-2 items-center px-4 py-1.5">
                        <Avatar name={currentDmUser?.name ?? null} url={currentDmUser?.avatarUrl ?? null} size="xs" />
                        <div className="rounded-2xl px-3 py-2" style={{ backgroundColor: "hsl(var(--muted))", borderBottomLeftRadius: "4px" }}>
                          <div className="flex gap-1 items-center">
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "hsl(var(--muted-foreground))", animationDelay: "0ms" }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "hsl(var(--muted-foreground))", animationDelay: "160ms" }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "hsl(var(--muted-foreground))", animationDelay: "320ms" }} />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* DM input */}
                    <div className="shrink-0 p-3 border-t" style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                      {dmTaskRef && (
                        <div className="mb-2 flex items-stretch rounded-xl overflow-hidden" style={{ backgroundColor: "hsl(220 20% 16%)" }}>
                          <div className="w-[3px] shrink-0" style={{ backgroundColor: "hsl(var(--primary))" }} />
                          <button
                            type="button"
                            onClick={() => navigate(`/tasks?tab=lista&highlight=${dmTaskRef.id}`)}
                            className="flex-1 min-w-0 flex flex-col items-start px-3 py-2 text-left hover:opacity-90 transition-opacity"
                            style={{ color: "#fff" }}
                          >
                            <span className="text-[10px] font-semibold uppercase tracking-wide leading-none mb-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Tarefa</span>
                            <span className="text-[12px] font-semibold leading-snug truncate w-full" style={{ color: "hsl(var(--primary))" }}>
                              {dmTaskRef.code}{dmTaskRef.title ? ` · ${dmTaskRef.title}` : ""}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDmTaskRef(null)}
                            className="px-3 flex items-center justify-center shrink-0 hover:opacity-70 transition-opacity"
                            style={{ color: "rgba(255,255,255,0.7)" }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <div className="flex gap-2 items-end rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "hsl(var(--muted))" }}>
                        <ChatTextarea
                          value={dmText}
                          onChange={v => {
                            setDmText(v);
                            if (typeof activeView === "number" && v.trim()) {
                              const now = Date.now();
                              if (now - lastTypingEmitRef.current > 2000) {
                                getSocket().emit("dm:typing", { toUserId: activeView });
                                lastTypingEmitRef.current = now;
                              }
                            }
                          }}
                          onSend={sendDm}
                          users={allUsers}
                          placeholder="Mensagem privada..."
                        />
                        <Button size="sm" onClick={sendDm} disabled={dmSending || (!dmText.trim() && !dmTaskRef)} className="h-8 w-8 p-0 shrink-0 rounded-xl">
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatContext } from "@/contexts/ChatContext";

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
  const [showDrop, setShowDrop] = useState(false);
  const [query, setQuery] = useState("");
  const [atIndex, setAtIndex] = useState(-1);
  const [selIdx, setSelIdx] = useState(0);

  const filtered = users.filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 96)}px`;
  }, [value]);

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
    <div className="relative flex-1 min-w-0">
      <Textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); checkAt(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder={placeholder}
        rows={1}
        className="resize-none overflow-hidden border-none shadow-none focus-visible:ring-0 bg-transparent p-0 text-sm placeholder:text-[hsl(var(--muted-foreground))] w-full leading-relaxed"
      />
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

// ── ChatWidget ───────────────────────────────────────────────────

export function ChatWidget() {
  const { user } = useAuth();
  const { _register } = useChatContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [generalUnread, setGeneralUnread] = useState(0);
  const [hasMention, setHasMention] = useState(false);

  const [dmMessages, setDmMessages] = useState<Record<number, DmMessage[]>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [dmUnread, setDmUnread] = useState<Record<number, number>>({});
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [activeView, setActiveView] = useState<"general" | number>("general");
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [allUsers, setAllUsers] = useState<MentionUser[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const dmEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeViewRef = useRef<"general" | number>("general");
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  const totalUnread = generalUnread + Object.values(dmUnread).reduce((a, b) => a + b, 0);
  const hasAlert = hasMention || Object.values(dmUnread).some(n => n > 0);

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
    setActiveView(userId);
    setDmText(prefill ?? "");
    if (!dmMessages[userId]) {
      apiFetch<DmMessage[]>(`/api/dm/${userId}`)
        .then(msgs => {
          setDmMessages(prev => ({ ...prev, [userId]: msgs }));
          setDmUnread(prev => ({ ...prev, [userId]: 0 }));
          loadConversations();
        }).catch(() => {});
    } else {
      apiPost(`/api/dm/${userId}/read`, {}).catch(() => {});
      setDmUnread(prev => ({ ...prev, [userId]: 0 }));
    }
  }, [dmMessages, loadConversations]);

  const ping = useCallback(() => { apiPost("/api/presence/ping", {}).catch(() => {}); }, []);

  useEffect(() => {
    apiFetch<ChatMessage[]>("/api/chat/messages").then(setMessages).catch(() => {}).finally(() => setLoadingChat(false));
    apiFetch<OnlineUser[]>("/api/presence").then(setOnlineUsers).catch(() => {});
    apiFetch<MentionUser[]>("/api/users").then(setAllUsers).catch(() => {});
    loadConversations();
    ping();
    pingRef.current = setInterval(ping, 30_000);
    return () => { if (pingRef.current) clearInterval(pingRef.current); };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { dmEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [dmMessages, activeView]);

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
        setGeneralUnread(prev => prev + 1);
        if (user && msg.content.toLowerCase().includes(`@${(user.name ?? "").toLowerCase()}`)) setHasMention(true);
      }
    };
    const onDmMessage = (msg: DmMessage) => {
      const otherId = msg.fromUserId === user?.id ? msg.toUserId : msg.fromUserId;
      setDmMessages(prev => {
        const existing = prev[otherId] ?? [];
        if (existing.some(m => m.id === msg.id)) return prev;
        return { ...prev, [otherId]: [...existing, msg] };
      });
      loadConversations();
      if (!chatOpenRef.current || activeViewRef.current !== otherId) {
        if (msg.fromUserId !== user?.id)
          setDmUnread(prev => ({ ...prev, [otherId]: (prev[otherId] ?? 0) + 1 }));
      } else {
        apiPost(`/api/dm/${otherId}/read`, {}).catch(() => {});
      }
    };
    const onPresence = ({ userId, isOnline, user: u }: { userId: number; isOnline: boolean; user: OnlineUser }) =>
      setOnlineUsers(prev => isOnline
        ? prev.some(p => p.userId === userId) ? prev : [...prev, { ...u, userId, isOnline: true }]
        : prev.filter(p => p.userId !== userId));

    socket.on("chat:message", onChatMessage);
    socket.on("dm:message", onDmMessage);
    socket.on("presence:update", onPresence);
    return () => {
      socket.off("chat:message", onChatMessage);
      socket.off("dm:message", onDmMessage);
      socket.off("presence:update", onPresence);
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
    if (typeof activeView !== "number" || !dmText.trim()) return;
    setDmSending(true);
    try { await apiPost(`/api/dm/${activeView}`, { content: dmText.trim() }); setDmText(""); loadConversations(); }
    catch {} finally { setDmSending(false); }
  };

  const openChat = () => {
    setChatOpen(true);
    if (activeView === "general") { setGeneralUnread(0); setHasMention(false); }
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
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 16, mass: 0.9 }}
            className={cn(
              "fixed z-50 flex overflow-hidden shadow-2xl",
              "bottom-0 left-0 right-0 h-[85dvh] rounded-t-3xl border-t border-x",
              "sm:bottom-20 sm:right-5 sm:left-auto sm:w-[440px] sm:h-[560px] sm:rounded-3xl sm:border"
            )}
            style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            {/* Mobile drag handle */}
            <div className="sm:hidden absolute top-2.5 left-0 right-0 flex justify-center pointer-events-none">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: "hsl(var(--muted-foreground))" }} />
            </div>

            {/* ── Icon Nav Strip ── */}
            <div
              className="w-[54px] shrink-0 border-r flex flex-col items-center pt-8 sm:pt-3 pb-3 gap-1.5"
              style={{ backgroundColor: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}
            >
              {/* Close */}
              <button
                onClick={() => setChatOpen(false)}
                title="Fechar"
                className="h-8 w-8 rounded-xl flex items-center justify-center transition-all mb-1 shrink-0"
                style={{ color: "hsl(var(--muted-foreground))" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "hsl(var(--accent))"; (e.currentTarget as HTMLElement).style.color = "hsl(var(--foreground))"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; (e.currentTarget as HTMLElement).style.color = "hsl(var(--muted-foreground))"; }}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <div className="w-7 h-px shrink-0" style={{ backgroundColor: "hsl(var(--border))" }} />

              {/* Geral */}
              <button
                title="Canal Geral"
                onClick={() => { setActiveView("general"); setGeneralUnread(0); setHasMention(false); }}
                className="relative h-10 w-10 rounded-2xl flex items-center justify-center transition-all shrink-0"
                style={activeView === "general"
                  ? { backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                  : { color: "hsl(var(--muted-foreground))" }
                }
                onMouseEnter={e => { if (activeView !== "general") { (e.currentTarget as HTMLElement).style.backgroundColor = "hsl(var(--accent))"; (e.currentTarget as HTMLElement).style.color = "hsl(var(--foreground))"; } }}
                onMouseLeave={e => { if (activeView !== "general") { (e.currentTarget as HTMLElement).style.backgroundColor = ""; (e.currentTarget as HTMLElement).style.color = "hsl(var(--muted-foreground))"; } }}
              >
                <MessageCircle className="h-[18px] w-[18px]" />
                {(generalUnread > 0 || hasMention) && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {generalUnread > 9 ? "9+" : generalUnread || "•"}
                  </span>
                )}
              </button>

              <div className="w-7 h-px shrink-0" style={{ backgroundColor: "hsl(var(--border))" }} />

              {/* DM user avatars */}
              <div className="flex-1 flex flex-col items-center gap-1.5 overflow-y-auto scrollbar-none w-full px-1 py-0.5">
                {navUsers.map(u => {
                  const unread = dmUnread[u.id] ?? conversations.find(c => c.userId === u.id)?.unread ?? 0;
                  const isOnline = onlineUsers.some(o => o.userId === u.id);
                  const isActive = activeView === u.id;
                  return (
                    <button
                      key={u.id}
                      title={u.name ?? "?"}
                      onClick={() => openDm(u.id)}
                      className={cn(
                        "relative h-10 w-10 rounded-2xl flex items-center justify-center transition-all shrink-0",
                        isActive ? "" : "opacity-75 hover:opacity-100"
                      )}
                      style={isActive ? { boxShadow: "0 0 0 2px hsl(var(--primary))" } : {}}
                    >
                      <Avatar name={u.name} url={u.avatarUrl} size="sm" />
                      {isOnline && (
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2" style={{ borderColor: "hsl(var(--muted))" }} />
                      )}
                      {unread > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] font-bold flex items-center justify-center">
                          {unread > 9 ? "9+" : unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Main Content ── */}
            <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "hsl(var(--card))" }}>
              {activeView === "general" ? (
                <>
                  {/* General header */}
                  <div
                    className="shrink-0 px-4 pt-8 pb-3 sm:pt-3 border-b flex items-center gap-3"
                    style={{ backgroundColor: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}
                  >
                    <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--primary))"/*, opacity with /10 */ }}>
                      <MessageCircle className="h-4 w-4" style={{ color: "hsl(var(--primary-foreground))" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">Canal Geral</p>
                      {onlineUsers.length > 0 && (
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{onlineUsers.length} online</p>
                      )}
                    </div>
                    {onlineUsers.length > 0 && (
                      <div className="flex -space-x-1.5 shrink-0">
                        {onlineUsers.slice(0, 3).map(u => (
                          <div key={u.userId} title={u.name ?? "?"} className="rounded-full ring-1" style={{ ringColor: "hsl(var(--card))" }}>
                            <Avatar name={u.name} url={u.avatarUrl} size="xs" />
                          </div>
                        ))}
                        {onlineUsers.length > 3 && (
                          <div className="h-6 w-6 rounded-full ring-1 flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: "hsl(var(--muted))", ringColor: "hsl(var(--card))", color: "hsl(var(--muted-foreground))" }}>
                            +{onlineUsers.length - 3}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* General messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ backgroundColor: "hsl(var(--card))" }}>
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
                            className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm"
                            style={mine
                              ? { backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderBottomRightRadius: "4px" }
                              : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))", borderBottomLeftRadius: "4px" }
                            }
                          >
                            {!mine && <p className="text-xs font-semibold mb-0.5 opacity-60">{msg.userName}</p>}
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            <p className="text-[11px] mt-1 opacity-40 text-right">{timeAgo(msg.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* General input */}
                  <div className="shrink-0 p-3 border-t" style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                    <div className="flex gap-2 items-end rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "hsl(var(--muted))" }}>
                      <ChatTextarea value={msgText} onChange={setMsgText} onSend={sendMsg} users={allUsers} placeholder="Mensagem..." />
                      <Button size="sm" onClick={sendMsg} disabled={!msgText.trim()} className="h-8 w-8 p-0 shrink-0 rounded-xl">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* DM header */}
                  {(() => {
                    const other = currentDmUser;
                    const isOnline = onlineUsers.some(u => u.userId === activeView);
                    return (
                      <div
                        className="shrink-0 px-4 pt-8 pb-3 sm:pt-3 border-b flex items-center gap-3"
                        style={{ backgroundColor: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}
                      >
                        <div className="relative shrink-0">
                          <Avatar name={other?.name ?? null} url={other?.avatarUrl ?? null} size="md" />
                          <span
                            className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2"
                            style={{ backgroundColor: isOnline ? "rgb(16 185 129)" : "hsl(var(--muted-foreground))", borderColor: "hsl(var(--muted))" }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight truncate">{other?.name ?? "?"}</p>
                          <p className="text-xs" style={{ color: isOnline ? "rgb(5 150 105)" : "hsl(var(--muted-foreground))" }}>
                            {isOnline ? "● online" : "offline"}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* DM messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ backgroundColor: "hsl(var(--card))" }}>
                    {!(dmMessages[activeView as number]) ? (
                      <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Carregando...</p>
                    ) : (dmMessages[activeView as number] ?? []).length === 0 ? (
                      <p className="text-sm text-center py-10" style={{ color: "hsl(var(--muted-foreground))" }}>Nenhuma mensagem. Diga olá! 👋</p>
                    ) : (dmMessages[activeView as number] ?? []).map(msg => {
                      const mine = msg.fromUserId === user?.id;
                      return (
                        <div key={msg.id} className={cn("flex gap-2 items-end", mine && "flex-row-reverse")}>
                          {!mine && <Avatar name={msg.fromName} url={msg.fromAvatar} size="xs" />}
                          <div
                            className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm"
                            style={mine
                              ? { backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderBottomRightRadius: "4px" }
                              : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))", borderBottomLeftRadius: "4px" }
                            }
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            <p className="text-[11px] mt-1 opacity-40 text-right">{timeAgo(msg.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={dmEndRef} />
                  </div>

                  {/* DM input */}
                  <div className="shrink-0 p-3 border-t" style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                    <div className="flex gap-2 items-end rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "hsl(var(--muted))" }}>
                      <ChatTextarea value={dmText} onChange={setDmText} onSend={sendDm} users={allUsers} placeholder="Mensagem privada..." />
                      <Button size="sm" onClick={sendDm} disabled={dmSending || !dmText.trim()} className="h-8 w-8 p-0 shrink-0 rounded-xl">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

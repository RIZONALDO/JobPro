import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, MessageCircle, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

function Avatar({ name, url, size = "sm" }: { name: string | null; url: string | null; size?: "xs" | "sm" }) {
  const sizeClass = size === "xs" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  const initials = (name ?? "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name ?? ""} className={cn(sizeClass, "rounded-full object-cover shrink-0")} />;
  return (
    <div className={cn(sizeClass, "rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0")}>
      {initials}
    </div>
  );
}

function ChatTextarea({ value, onChange, onSend, users, placeholder, rows = 1 }: {
  value: string; onChange: (v: string) => void; onSend?: () => void;
  users: MentionUser[]; placeholder?: string; rows?: number;
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
    <div className="relative flex-1">
      <Textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); checkAt(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder={placeholder}
        rows={rows}
        className="resize-none overflow-hidden border-none shadow-none focus-visible:ring-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground/50 w-full leading-relaxed"
      />
      {showDrop && filtered.length > 0 && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 w-52 rounded-xl border bg-card shadow-xl z-[300] overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mencionar</span>
          </div>
          {filtered.map((u, i) => (
            <button key={u.id} onMouseDown={() => selectUser(u)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors text-left",
                i === selIdx && "bg-muted/40")}>
              <Avatar name={u.name} url={u.avatarUrl} size="xs" />
              <span className="text-xs font-medium truncate">{u.name}</span>
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
    const handleMouseDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        fabRef.current && !fabRef.current.contains(e.target as Node)
      ) {
        setChatOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [chatOpen]);

  const loadConversations = useCallback(() => {
    apiFetch<Conversation[]>("/api/dm/conversations").then(setConversations).catch(() => {});
  }, []);

  const openDm = useCallback((userId: number) => {
    setActiveView(userId);
    setDmText("");
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

  useEffect(() => {
    const socket = getSocket();
    const onChatMessage = (msg: ChatMessage) => {
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      if (!chatOpenRef.current || activeViewRef.current !== "general") {
        setGeneralUnread(prev => prev + 1);
        if (user && msg.content.toLowerCase().includes(`@${user.name.toLowerCase()}`)) setHasMention(true);
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
    if (!msgText.trim()) return;
    setSending(true);
    try { await apiPost("/api/chat/messages", { content: msgText }); setMsgText(""); }
    catch {} finally { setSending(false); }
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

  // Detect mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

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
            className="fixed inset-0 bg-black/30 z-40 sm:hidden"
            onClick={() => setChatOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="fixed z-50
        bottom-0 right-0 left-0
        sm:bottom-6 sm:right-6 sm:left-auto
        flex flex-col items-end gap-3
        pointer-events-none">

        {/* Chat panel */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              ref={panelRef}
              key="panel"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
              className="pointer-events-auto flex overflow-hidden
                w-full rounded-t-2xl border-t border-x
                sm:w-[480px] sm:rounded-2xl sm:border
                bg-card shadow-2xl
                h-[80dvh] sm:h-[540px]"
            >
              {/* ── Sidebar ── */}
              <div className="w-[140px] sm:w-[152px] shrink-0 border-r flex flex-col bg-muted/20">
                <div className="shrink-0 px-3 py-3 border-b flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Chat</span>
                  <button
                    onClick={() => setChatOpen(false)}
                    className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* General channel */}
                <button
                  onClick={() => { setActiveView("general"); setGeneralUnread(0); setHasMention(false); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                    activeView === "general" ? "bg-primary/10 text-primary" : "text-foreground"
                  )}>
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    activeView === "general" ? "bg-primary/20" : "bg-muted")}>
                    <MessageCircle className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-medium flex-1 truncate">Geral</span>
                  {(generalUnread > 0 || hasMention) && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {generalUnread > 9 ? "9+" : generalUnread || "•"}
                    </span>
                  )}
                </button>

                <div className="mx-3 my-1 border-t border-border/60" />
                <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Direto</p>

                <div className="flex-1 overflow-y-auto">
                  {conversations.map(conv => {
                    const unread = dmUnread[conv.userId] ?? conv.unread ?? 0;
                    const isOnline = onlineUsers.some(u => u.userId === conv.userId);
                    return (
                      <button key={conv.userId} onClick={() => openDm(conv.userId)}
                        className={cn("w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40",
                          activeView === conv.userId ? "bg-primary/10" : "")}>
                        <div className="relative shrink-0">
                          <Avatar name={conv.userName} url={conv.userAvatar} size="xs" />
                          {isOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-card" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-xs truncate", activeView === conv.userId ? "font-semibold text-primary" : "font-medium")}>
                            {conv.userName ?? "?"}
                          </p>
                          {conv.lastMessage && (
                            <p className="text-[10px] text-muted-foreground truncate leading-tight">{conv.lastMessage}</p>
                          )}
                        </div>
                        {unread > 0 && (
                          <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                            {unread > 9 ? "9+" : unread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {allUsers
                    .filter(u => u.id !== user?.id && !conversations.some(c => c.userId === u.id))
                    .map(u => {
                      const isOnline = onlineUsers.some(o => o.userId === u.id);
                      return (
                        <button key={u.id} onClick={() => openDm(u.id)}
                          className={cn("w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40",
                            activeView === u.id ? "bg-primary/10" : "")}>
                          <div className="relative shrink-0">
                            <Avatar name={u.name} url={u.avatarUrl} size="xs" />
                            {isOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-card" />}
                          </div>
                          <p className={cn("text-xs font-medium truncate flex-1", activeView === u.id ? "text-primary" : "")}>
                            {u.name}
                          </p>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* ── Main area ── */}
              <div className="flex-1 flex flex-col min-w-0">
                {activeView === "general" ? (
                  <>
                    <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2 bg-card">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <MessageCircle className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-sm font-semibold flex-1">Canal Geral</span>
                      {onlineUsers.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          {onlineUsers.slice(0, 4).map(u => (
                            <div key={u.userId} className="relative" title={u.name ?? "?"}>
                              <Avatar name={u.name} url={u.avatarUrl} size="xs" />
                              <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 border border-card" />
                            </div>
                          ))}
                          {onlineUsers.length > 4 && (
                            <span className="text-xs text-muted-foreground ml-1">+{onlineUsers.length - 4}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {loadingChat ? (
                        <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
                      ) : messages.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-8">Sem mensagens. Diga olá! 👋</p>
                      ) : messages.map(msg => {
                        const mine = msg.userId === user?.id;
                        return (
                          <div key={msg.id} className={cn("flex gap-2 items-end", mine && "flex-row-reverse")}>
                            {!mine && <Avatar name={msg.userName} url={msg.userAvatar} size="xs" />}
                            <div className={cn(
                              "max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                              mine
                                ? "bg-primary text-primary-foreground rounded-br-sm"
                                : "bg-muted rounded-bl-sm"
                            )}>
                              {!mine && <p className="font-semibold text-[11px] mb-0.5 opacity-60">{msg.userName}</p>}
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                              <p className="text-[10px] mt-0.5 opacity-40 text-right">{timeAgo(msg.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </div>

                    <div className="shrink-0 border-t p-3 bg-card/80 backdrop-blur-sm">
                      <div className="flex gap-2 items-end bg-muted/40 rounded-xl px-3 py-2 border border-border/50">
                        <ChatTextarea value={msgText} onChange={setMsgText} onSend={sendMsg} users={allUsers} placeholder="Mensagem..." />
                        <Button
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0 rounded-lg"
                          onClick={sendMsg}
                          disabled={sending || !msgText.trim()}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {(() => {
                      const other = allUsers.find(u => u.id === activeView) ??
                        (() => { const c = conversations.find(c => c.userId === activeView); return c ? { id: c.userId, name: c.userName, avatarUrl: c.userAvatar } : null; })();
                      const isOnline = onlineUsers.some(u => u.userId === activeView);
                      return (
                        <div className="shrink-0 px-4 py-3 border-b flex items-center gap-3 bg-card">
                          <div className="relative">
                            <Avatar name={other?.name ?? null} url={other?.avatarUrl ?? null} size="sm" />
                            {isOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-card" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-tight truncate">{other?.name ?? "?"}</p>
                            <p className={cn("text-xs", isOnline ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                              {isOnline ? "● online" : "offline"}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {!(dmMessages[activeView as number]) ? (
                        <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
                      ) : (dmMessages[activeView as number] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-8">Nenhuma mensagem. Diga olá! 👋</p>
                      ) : (dmMessages[activeView as number] ?? []).map(msg => {
                        const mine = msg.fromUserId === user?.id;
                        return (
                          <div key={msg.id} className={cn("flex gap-2 items-end", mine && "flex-row-reverse")}>
                            {!mine && <Avatar name={msg.fromName} url={msg.fromAvatar} size="xs" />}
                            <div className={cn(
                              "max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                              mine
                                ? "bg-primary text-primary-foreground rounded-br-sm"
                                : "bg-muted rounded-bl-sm"
                            )}>
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                              <p className="text-[10px] mt-0.5 opacity-40 text-right">{timeAgo(msg.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={dmEndRef} />
                    </div>

                    <div className="shrink-0 border-t p-3 bg-card/80 backdrop-blur-sm">
                      <div className="flex gap-2 items-end bg-muted/40 rounded-xl px-3 py-2 border border-border/50">
                        <ChatTextarea value={dmText} onChange={setDmText} onSend={sendDm} users={allUsers} placeholder="Mensagem privada..." />
                        <Button
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0 rounded-lg"
                          onClick={sendDm}
                          disabled={dmSending || !dmText.trim()}
                        >
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

        {/* FAB */}
        <div className="pointer-events-auto pr-6 pb-6 sm:pr-0 sm:pb-0">
          <motion.button
            ref={fabRef}
            onClick={() => chatOpen ? setChatOpen(false) : openChat()}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "relative h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-colors",
              chatOpen
                ? "bg-primary text-primary-foreground"
                : (totalUnread > 0 || hasAlert)
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {chatOpen ? (
                <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <X className="h-5 w-5" />
                </motion.span>
              ) : (
                <motion.span key="msg" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <MessageCircle className="h-5 w-5" />
                </motion.span>
              )}
            </AnimatePresence>
            {!chatOpen && (totalUnread > 0 || hasMention) && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center shadow-sm">
                {totalUnread > 99 ? "99+" : totalUnread > 0 ? totalUnread : ""}
              </span>
            )}
          </motion.button>
        </div>
      </div>
    </>
  );
}

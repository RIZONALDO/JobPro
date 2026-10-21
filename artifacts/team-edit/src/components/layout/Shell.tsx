import { Link, useLocation } from "wouter";
import { roleName } from "@/lib/roles";
import {
  LayoutDashboard, FolderOpen, ListTodo, Users, Settings, LogOut, CalendarDays, Menu, Bell, BellRing, ChevronRight, X, UserCircle, CalendarRange, BarChart3, AtSign, ClipboardList, LayoutGrid, Gauge, ListOrdered, CheckCircle2, AlertCircle, UserPlus, Eye, Briefcase, FolderCheck, UserCheck, Undo2, CalendarClock, Shield, Palette, Sun, Moon, ALargeSmall, Volume2, VolumeX, Trash2, CheckCheck, type Icon, Newspaper, PlayCircle,
} from "@/lib/icons";
import * as Collapsible from "@radix-ui/react-collapsible";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { playSound } from "@/lib/sounds";
import {
  isPushSupported, getPushPermission,
  subscribePush, unsubscribePush, autoResubscribeIfGranted,
} from "@/lib/push-subscribe";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandName } from "@/components/brand-name";
import { AnimatePresence, motion } from "framer-motion";
import { panelVariants, drawerVariants, backdropVariants, pageVariants } from "@/lib/motion";
import { getSocket } from "@/lib/socket";
import { ChatWidget } from "@/components/layout/ChatWidget";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { HandoffHost } from "@/components/fila/HandoffDialog";
import { NowChip, QuickCreate } from "@/components/layout/TopBar";

interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  taskId: number | null;
  jobId: number | null;
  taskCode: string | null;
  createdAt: string;
}

const NOTIF_ICON: Record<string, React.ReactNode> = {
  task_assigned:    <UserPlus    className="h-4 w-4 text-blue-500" />,
  task_reassigned:  <UserCheck   className="h-4 w-4 text-blue-400" />,
  task_started:     <PlayCircle  className="h-4 w-4 text-blue-500" />,
  task_review:      <Eye         className="h-4 w-4 text-amber-500" />,
  task_approved:    <CheckCircle2 className="h-4 w-4 text-green-500" />,
  task_revision:    <AlertCircle  className="h-4 w-4 text-orange-500" />,
  task_returned:    <Undo2        className="h-4 w-4 text-rose-500" />,
  job_completed:    <Briefcase    className="h-4 w-4 text-indigo-500" />,
  project_completed:<FolderCheck  className="h-4 w-4 text-green-600" />,
  feed_mention:     <AtSign       className="h-4 w-4 text-violet-500" />,
  due_date_changed: <CalendarClock className="h-4 w-4 text-sky-500" />,
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

type NavChild = { href: string; label: string; icon: Icon; roles: string[] };
type NavItem  = NavChild & { children?: NavChild[] };


const COORD_ROLES  = ["admin", "supervisor", "coordinator"];
const NON_ADMIN    = ["supervisor", "coordinator", "editor"];
const COORD_ACTIVE = ["supervisor", "coordinator"];

/** Seções do menu lateral (a ordem dos itens vem de NAV_ITEMS). */
const SECTIONS: { label: string; hrefs: string[] }[] = [
  { label: "Trabalho", hrefs: ["/", "/fila", "/tasks", "/feed", "/duty"] },
  { label: "Gestão", hrefs: ["/fila/supervisao", "/reports", "/team"] },
  { label: "Sistema", hrefs: ["/settings"] },
];

const NAV_ITEMS: NavItem[] = [
  { href: "/",         label: "Dashboard",      icon: LayoutDashboard, roles: COORD_ACTIVE },
  { href: "/fila",     label: "Fila",             icon: ListOrdered,     roles: NON_ADMIN    },
  { href: "/tasks",    label: "Jobs",            icon: ClipboardList,   roles: COORD_ACTIVE },
  { href: "/feed",     label: "Mural",            icon: Newspaper,       roles: NON_ADMIN    },
  { href: "/fila/supervisao", label: "Supervisão",  icon: Gauge,           roles: ["admin","supervisor"] },
  { href: "/reports",  label: "Relatórios",       icon: BarChart3,       roles: COORD_ACTIVE },
  { href: "/team",     label: "Membros",          icon: Users,           roles: COORD_ROLES  },
  { href: "/duty",     label: "Plantões",         icon: Shield,          roles: ["admin","supervisor","coordinator","editor"] },
  { href: "/settings", label: "Configurações",    icon: Settings,        roles: ["admin"]    },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  // menu lateral recolhido ou aberto: lembrado no navegador
  const [collapsed, setCollapsedState] = useState(() => { try { return localStorage.getItem("sidebar:collapsed") !== "0"; } catch { return true; } });
  const setCollapsed = (v: boolean) => { setCollapsedState(v); try { localStorage.setItem("sidebar:collapsed", v ? "1" : "0"); } catch { /* ok */ } };
  // conexão em tempo real (rodapé)
  const [online, setOnline] = useState(() => getSocket().connected);
  const [clock, setClock] = useState(() => new Date());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("notif_sound") !== "off");
  const soundEnabledRef = useRef(localStorage.getItem("notif_sound") !== "off");
  const [pushEnabled, setPushEnabled] = useState(() => isPushSupported() && getPushPermission() === "granted");
  const [customOpen, setCustomOpen] = useState(false);
  const [pokeFrom, setPokeFrom] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { openTask } = useTaskModal();
  const { scale, setScale } = useTheme();
  useEffect(() => {
    const s = getSocket(), up = () => setOnline(true), down = () => setOnline(false);
    s.on("connect", up); s.on("disconnect", down);
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => { s.off("connect", up); s.off("disconnect", down); clearInterval(t); };
  }, []);

  const fetchNotifications = useCallback(() => {
    apiFetch<AppNotification[]>("/api/notifications").then(data => {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.read).length);
    }).catch(() => {});
  }, []);

  // Carregar lista inicial e ao abrir dropdown
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (notifOpen) fetchNotifications();
  }, [notifOpen, fetchNotifications]);

  // Auto-renovar subscription push (caso browser reinicie ou SW expire)
  useEffect(() => {
    autoResubscribeIfGranted().catch(() => {});
  }, []);

  const playNotifSound = useCallback(() => {
    playSound(settings.sound_notif);
  }, [settings.sound_notif]);

  const toggleSound = () => {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    localStorage.setItem("notif_sound", next ? "on" : "off");
    setSoundEnabled(next);
    if (next) playNotifSound();
  };

  const togglePush = async () => {
    if (pushEnabled) {
      await unsubscribePush();
      setPushEnabled(false);
    } else {
      const result = await subscribePush();
      setPushEnabled(result === "granted");
    }
  };

  const playPokeSound = useCallback(() => {
    playSound(settings.sound_poke);
  }, [settings.sound_poke]);

  // Socket: receber novas notificações em tempo real
  useEffect(() => {
    const socket = getSocket();
    const handle = (notif: AppNotification) => {
      setNotifications(prev => [notif, ...prev].slice(0, 40));
      setUnreadCount(prev => prev + 1);
      if (soundEnabledRef.current) playNotifSound();
    };
    const handlePoke = ({ fromName }: { fromName: string }) => {
      playPokeSound();
      setShaking(true);
      setPokeFrom(fromName);
      setTimeout(() => setShaking(false), 600);
      setTimeout(() => setPokeFrom(null), 3500);
    };
    socket.on("notification:new", handle);
    socket.on("poke:received", handlePoke);
    return () => { socket.off("notification:new", handle); socket.off("poke:received", handlePoke); };
  }, [playNotifSound, playPokeSound]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (customRef.current && !customRef.current.contains(e.target as Node)) setCustomOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (n: AppNotification) => {
    if (!n.read) {
      await apiPut(`/api/notifications/${n.id}/read`, {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const markAllRead = async () => {
    await apiPut("/api/notifications/read-all", {});
    setNotifications(prev => prev.map(x => ({ ...x, read: true })));
    setUnreadCount(0);
  };

  const deleteNotif = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await apiDelete(`/api/notifications/${id}`);
    setNotifications(prev => {
      const removed = prev.find(n => n.id === id);
      if (removed && !removed.read) setUnreadCount(c => Math.max(0, c - 1));
      return prev.filter(n => n.id !== id);
    });
  };

  const deleteAll = async () => {
    await apiDelete("/api/notifications");
    setNotifications([]);
    setUnreadCount(0);
  };


  const navItems = NAV_ITEMS.filter(item => user && item.roles.includes(user.role));
  const initials = user?.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  // Auto-open group when a child route is active
  useEffect(() => {
    navItems.forEach(item => {
      if (item.children) {
        const childActive = item.children.some(c => location.startsWith(c.href));
        if (childActive) setOpenGroups(prev => new Set([...prev, item.href]));
      }
    });
  }, [location]);

  const toggleGroup = (href: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(href) ? next.delete(href) : next.add(href);
      return next;
    });
  };

  const isActiveHref = (href: string) => href === "/" || href === "/fila" ? location === href
    : href === "/tasks" ? location.startsWith("/tasks") || location.startsWith("/jobs") // página do job conta como "Jobs"
    : location.startsWith(href);
  const current = [...navItems].sort((a, b) => b.href.length - a.href.length).find(i => isActiveHref(i.href));

  const NavLinks = ({ onClick, forceExpanded }: { onClick?: () => void; forceExpanded?: boolean }) => {
    const isCollapsed = forceExpanded ? false : collapsed;
    const sections = SECTIONS.map(sec => ({ ...sec, items: navItems.filter(i => sec.hrefs.includes(i.href)) })).filter(sec => sec.items.length);
    return (
      <nav className="flex flex-col gap-4 px-2 py-3">
        {sections.map((sec, si) => (
          <div key={sec.label} className="flex flex-col gap-0.5">
            {isCollapsed
              ? si > 0 && <span className="mx-auto mb-1 h-px w-5 bg-[hsl(var(--border))]" aria-hidden />
              : <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]/70">{sec.label}</p>}
            {sec.items.map(item => {
              const active = isActiveHref(item.href) && current?.href === item.href;
              return (
                <Link key={item.href} href={item.href} onClick={onClick} title={isCollapsed ? item.label : undefined} aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                    isCollapsed && "justify-center px-2",
                    active ? "bg-[hsl(var(--foreground)/0.07)] text-[hsl(var(--foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]",
                  )}>
                  {active && <i className="absolute inset-y-1.5 -left-2 w-[3px] rounded-r-full bg-[hsl(var(--primary))]" aria-hidden />}
                  <item.icon weight={active ? "fill" : "light"} className={cn("shrink-0", active && "text-[hsl(var(--primary))]")} style={{ height: 18, width: 18 }} />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    );
  };

  /** Pessoa logada (rodapé do menu lateral e do menu do celular): abre Meu perfil e Sair. */
  const Me = ({ compact, onClick }: { compact?: boolean; onClick?: () => void }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={compact ? user?.name : undefined}
          className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-[hsl(var(--foreground)/0.05)] data-[state=open]:bg-[hsl(var(--foreground)/0.07)]", compact && "justify-center")}>
          <span className="relative shrink-0">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              : <span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--primary))]/15 text-xs font-semibold text-[hsl(var(--primary))]">{initials}</span>}
            <i className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--card))]", online ? "bg-emerald-500" : "bg-amber-500")} title={online ? "Conectado" : "Reconectando"} />
          </span>
          {!compact && <>
            <span className="min-w-0 flex-1"><b className="block truncate text-[13px] font-semibold">{user?.name}</b><span className="block truncate text-[11.5px] text-[hsl(var(--muted-foreground))]">{roleName(user)}</span></span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 -rotate-90 text-[hsl(var(--muted-foreground))]" />
          </>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/profile" onClick={onClick} className="flex cursor-pointer items-center"><UserCircle className="mr-2 h-4 w-4" />Meu perfil</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { onClick?.(); logout(); }} className="cursor-pointer text-[hsl(var(--destructive))]"><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-[100dvh] bg-[hsl(var(--background))]">

      {/* ── Menu lateral (desktop) ── */}
      <aside className={cn("z-20 hidden shrink-0 flex-col border-r bg-[hsl(var(--card))] transition-[width] duration-200 md:flex", collapsed ? "w-[60px]" : "w-60")}>
        <div className={cn("flex h-[60px] shrink-0 items-center gap-2 overflow-hidden border-b", collapsed ? "justify-center" : "px-2.5")}>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Abrir menu" : "Recolher menu"} aria-expanded={!collapsed} title={collapsed ? "Abrir menu" : "Recolher menu"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]">
            <Menu className="h-5 w-5" />
          </button>
          {!collapsed && <Link href="/" className="min-w-0" title={settings.company_name}>
            <span className="block truncate text-[14px] font-bold leading-tight"><BrandName name={settings.company_name} /></span>
            <span className="block truncate text-[11.5px] leading-tight text-[hsl(var(--muted-foreground))]"><BrandName name={settings.system_name} /></span>
          </Link>}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden"><NavLinks /></div>
        <div className="flex shrink-0 flex-col gap-1 border-t p-2">
          <Me compact={collapsed} />
        </div>
      </aside>

      {/* ── Right column: header + content ───────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top Header */}
        <header className="z-30 flex h-[60px] shrink-0 items-center gap-2.5 border-b bg-[hsl(var(--card)/0.85)] px-4 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card)/0.7)]">

          {/* esquerda: a página em que a pessoa está (no celular, menu + marca) */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button type="button" aria-label="Abrir menu" className="rounded-lg p-1.5 transition-colors hover:bg-[hsl(var(--muted))] md:hidden" onClick={() => setMobileOpen(v => !v)}>
              <Menu className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            </button>
            <Link href="/" className="min-w-0 truncate text-[15px] font-bold md:hidden"><BrandName name={settings.company_name} /></Link>
            {current && (
              <span className="hidden min-w-0 items-center gap-2.5 md:flex">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-[hsl(var(--background))]"><current.icon className="h-4 w-4" /></span>
                <span className="truncate text-[15px] font-semibold">{current.label}</span>
              </span>
            )}
          </div>

          {/* centro: busca */}
          <div className="shrink-0"><GlobalSearch /></div>

          {/* direita: o "agora", criar, avisos e tamanho do texto */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <div className="hidden min-w-0 lg:flex"><NowChip /></div>
            <QuickCreate />
            <span className="mx-1 hidden h-6 w-px bg-[hsl(var(--border))] md:block" aria-hidden />

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(v => !v)}
                className={cn("relative grid h-9 w-9 place-items-center rounded-xl text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]", notifOpen && "bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))]")}
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold leading-none text-[hsl(var(--primary-foreground))] shadow-[0_0_0_2px_hsl(var(--card))]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
              {notifOpen && (
                <motion.div
                  variants={panelVariants} initial="initial" animate="animate" exit="exit"
                  className="absolute right-0 top-full mt-1.5 w-80 rounded-xl border bg-[hsl(var(--card))] shadow-xl z-50 overflow-hidden">

                  {/* Header */}
                  <div className="border-b bg-[hsl(var(--muted))]/30">

                    {/* Row 1: título + ações */}
                    <div className="flex items-center justify-between px-4 pt-3 pb-2">
                      <div className="flex items-center gap-2">
                        <Bell className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                        <span className="text-sm font-semibold">Notificações</span>
                        {unreadCount > 0 && (
                          <span className="text-xs font-bold bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] rounded-full px-1.5 py-0.5 whitespace-nowrap">
                            {unreadCount} nova{unreadCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllRead}
                            title="Marcar todas como lidas"
                            className="h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button
                            onClick={deleteAll}
                            title="Limpar todas"
                            className="h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Row 2: toggles com rótulos + filtro */}
                    <div className="flex items-center justify-between px-4 pb-3 gap-2">

                      {/* Toggles de configuração */}
                      <div className="flex items-center gap-3">

                        {/* Som */}
                        <button
                          onClick={toggleSound}
                          className="flex items-center gap-1.5 group"
                          title={soundEnabled ? "Desligar som" : "Ligar som"}
                        >
                          {soundEnabled
                            ? <Volume2 className="h-3 w-3 text-[hsl(var(--primary))]" />
                            : <VolumeX className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
                          }
                          <span className={cn(
                            "text-[11px] font-medium transition-colors",
                            soundEnabled ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"
                          )}>Som</span>
                          <span className={cn(
                            "relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors shrink-0",
                            soundEnabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted-foreground))]/30"
                          )}>
                            <span className={cn(
                              "absolute h-2.5 w-2.5 rounded-full bg-white shadow transition-transform",
                              soundEnabled ? "translate-x-[11px]" : "translate-x-0.5"
                            )} />
                          </span>
                        </button>

                        {/* Separador */}
                        <span className="h-3 w-px bg-[hsl(var(--border))]" />

                        {/* Push OS */}
                        {isPushSupported() && getPushPermission() !== "denied" && (
                          <button
                            onClick={togglePush}
                            className="flex items-center gap-1.5 group"
                            title={pushEnabled ? "Desativar notificações do sistema operacional" : "Ativar notificações do sistema operacional"}
                          >
                            <BellRing className={cn(
                              "h-3 w-3 transition-colors",
                              pushEnabled ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"
                            )} />
                            <span className={cn(
                              "text-[11px] font-medium transition-colors",
                              pushEnabled ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"
                            )}>Sistema</span>
                            <span className={cn(
                              "relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors shrink-0",
                              pushEnabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted-foreground))]/30"
                            )}>
                              <span className={cn(
                                "absolute h-2.5 w-2.5 rounded-full bg-white shadow transition-transform",
                                pushEnabled ? "translate-x-[11px]" : "translate-x-0.5"
                              )} />
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Filtro não lidas */}
                      <button
                        onClick={() => setOnlyUnread(v => !v)}
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                          onlyUnread
                            ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8"
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        )}
                      >
                        Não lidas
                      </button>
                    </div>
                  </div>

                  {/* List */}
                  {(() => {
                    const visible = onlyUnread ? notifications.filter(n => !n.read) : notifications;
                    if (visible.length === 0) {
                      return (
                        <div className="py-10 text-center">
                          <Bell className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20 mx-auto mb-2" />
                          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                            {onlyUnread ? "Nenhuma não lida" : "Tudo em dia"}
                          </p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                            {onlyUnread ? "Todas as notificações foram lidas." : "Nenhuma notificação ainda."}
                          </p>
                        </div>
                      );
                    }
                    const today = new Date(); today.setHours(0,0,0,0);
                    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                    const groups: { label: string; items: AppNotification[] }[] = [
                      { label: "Hoje",        items: visible.filter(n => new Date(n.createdAt) >= today) },
                      { label: "Ontem",       items: visible.filter(n => new Date(n.createdAt) >= yesterday && new Date(n.createdAt) < today) },
                      { label: "Mais antigas",items: visible.filter(n => new Date(n.createdAt) < yesterday) },
                    ].filter(g => g.items.length > 0);

                    return (
                      <div className="overflow-y-auto max-h-[380px]">
                        {groups.map(group => (
                          <div key={group.label}>
                            <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 bg-[hsl(var(--muted))]/20 border-b">
                              {group.label}
                            </div>
                            <div className="divide-y">
                              {group.items.map(n => (
                                <div
                                  key={n.id}
                                  role="button"
                                  onClick={() => {
                                    markRead(n);
                                    setNotifOpen(false);
                                    if (n.taskId) navigate(user?.role === "editor" ? "/fila" : `/jobs/${n.taskId}`);
                                    else navigate("/");
                                  }}
                                  className={cn(
                                    "group flex items-start gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/40 transition-colors cursor-pointer relative",
                                    !n.read && "bg-[hsl(var(--primary))]/5"
                                  )}
                                >
                                  <div className="mt-0.5 shrink-0">
                                    {NOTIF_ICON[n.type] ?? <Bell className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={cn("text-xs leading-snug", !n.read ? "font-semibold text-[hsl(var(--foreground))]" : "font-medium text-[hsl(var(--foreground))]/80")}>
                                      {n.taskCode && (
                                        <span className="font-mono text-[hsl(var(--primary))]/70 mr-1">{n.taskCode}</span>
                                      )}
                                      {n.title}
                                    </p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">{n.message}</p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))]/60 mt-1">{timeAgo(n.createdAt)}</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    {!n.read && <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))] mt-1" />}
                                    <button
                                      onClick={e => deleteNotif(e, n.id)}
                                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-all"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </motion.div>
              )}
              </AnimatePresence>
            </div>

            {/* Customization panel */}
            <div ref={customRef} className="relative">
              <button
                onClick={() => setCustomOpen(v => !v)}
                title="Tamanho do texto"
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-xl transition-colors",
                  customOpen
                    ? "bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]"
                )}
              >
                <ALargeSmall className="h-[18px] w-[18px]" />
              </button>

              <AnimatePresence>
              {customOpen && (
                <motion.div variants={panelVariants} initial="initial" animate="animate" exit="exit"
                  className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border bg-[hsl(var(--card))] shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-[hsl(var(--muted))]/30">
                    <ALargeSmall className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-sm font-semibold">Tamanho do texto</span>
                  </div>

                  {/* Size */}
                  <div className="px-4 py-3">
                    <p className="mb-2.5 text-xs text-[hsl(var(--muted-foreground))]">Vale só para este navegador.</p>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { key: "sm" as const, label: "Pequeno", px: 10 },
                        { key: "md" as const, label: "Normal",  px: 13 },
                        { key: "lg" as const, label: "Grande",  px: 17 },
                      ]).map(({ key, label, px }) => (
                        <button
                          key={key}
                          onClick={() => setScale(key)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-1 h-14 rounded-lg border text-xs font-medium transition-all",
                            scale === key
                              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8 text-[hsl(var(--primary))]"
                              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--foreground))]/20 hover:text-[hsl(var(--foreground))]"
                          )}
                        >
                          <ALargeSmall style={{ width: px + 2, height: px + 2 }} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
              </AnimatePresence>
            </div>

          </div>
        </header>

        {/* Main content */}
        <motion.main
          className="flex-1 flex flex-col min-w-0 overflow-hidden"
          animate={shaking ? { x: [-3, 6, -8, 8, -6, 4, -2, 0] } : { x: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          <BreadcrumbBar />
          <div data-scroll-root className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex min-h-full flex-col">
              <div className="flex-1 p-4 pb-8 md:p-6">
                {children}
              </div>
              <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t py-3 pl-4 pr-20 text-[11.5px] text-[hsl(var(--muted-foreground))] md:pl-6">
                <span className="min-w-0 truncate">© {clock.getFullYear()} <BrandName name={settings.company_name} /> · <BrandName name={settings.system_name} /></span>
                <span className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5" title={online ? "Atualizações chegam na hora" : "Sem conexão em tempo real; tentando de novo"}>
                    <i className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.15)]" : "animate-pulse bg-amber-500")} />
                    {online ? "Tempo real conectado" : "Reconectando…"}
                  </span>
                  <span className="tabular-nums">{clock.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} · Brasília</span>
                </span>
              </footer>
            </div>
          </div>
        </motion.main>
      </div>

      <ChatWidget />
      {(user?.role === "admin" || user?.role === "supervisor") && <HandoffHost />}

      {/* Poke toast */}
      <AnimatePresence>
        {pokeFrom && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-2xl text-sm font-medium select-none pointer-events-none"
            style={{ backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            <span className="text-lg">👈</span>
            <span><strong>{pokeFrom}</strong> cutucou você!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mobile drawer ────────────────────────────────────────── */}
      <AnimatePresence>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}>
          <motion.div
            variants={backdropVariants} initial="initial" animate="animate" exit="exit"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            variants={drawerVariants} initial="initial" animate="animate" exit="exit"
            className="absolute left-0 top-0 h-full w-72 bg-[hsl(var(--card))] border-r flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Cabeçalho */}
            <div className="h-[60px] flex items-center gap-3 px-4 border-b shrink-0">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-tight truncate"><BrandName name={settings.company_name} /></p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Nav */}
            <div className="flex-1 overflow-y-auto">
              <NavLinks onClick={() => setMobileOpen(false)} forceExpanded />
            </div>

            {/* Rodapé */}
            <div className="flex shrink-0 flex-col gap-1 border-t px-2 py-2">
              <Me onClick={() => setMobileOpen(false)} />
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}

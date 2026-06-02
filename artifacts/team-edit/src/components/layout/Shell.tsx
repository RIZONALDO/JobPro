import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FolderOpen, ListTodo, Users, Settings, LogOut,
  CalendarDays, Menu, Bell, BellRing, ChevronRight, X, UserCircle,
  CalendarRange, BarChart3, Zap, AtSign, ClipboardList, LayoutGrid,
  CheckCircle2, AlertCircle, UserPlus, Eye, Briefcase, FolderCheck, UserCheck, Undo2, CalendarClock, Shield,
  Palette, Sun, Moon, ALargeSmall, Volume2, VolumeX, Trash2, CheckCheck,
} from "lucide-react";
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
  task_started:     <Zap         className="h-4 w-4 text-blue-500" />,
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

type NavChild = { href: string; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; roles: string[] };
type NavItem  = NavChild & { children?: NavChild[] };


const COORD_ROLES  = ["admin", "supervisor", "coordinator"];
const NON_ADMIN    = ["supervisor", "coordinator", "editor"];
const COORD_ACTIVE = ["supervisor", "coordinator"];

const NAV_ITEMS: NavItem[] = [
  { href: "/",         label: "Dashboard",      icon: LayoutDashboard, roles: NON_ADMIN    },
  { href: "/tasks",    label: "Tarefas",         icon: ClipboardList,   roles: NON_ADMIN    },
  { href: "/feed",     label: "Feed",             icon: Zap,             roles: NON_ADMIN    },
  { href: "/agenda",   label: "Agenda Geral",     icon: LayoutGrid,      roles: COORD_ROLES  },
  { href: "/reports",  label: "Relatórios",       icon: BarChart3,       roles: COORD_ACTIVE },
  { href: "/team",     label: "Membros",          icon: Users,           roles: COORD_ROLES  },
  { href: "/duty",     label: "Plantões",         icon: Shield,          roles: ["admin","supervisor","coordinator","editor"] },
  { href: "/settings", label: "Configurações",    icon: Settings,        roles: ["admin"]    },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(true);
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
  const { theme, scale, toggleTheme, setScale } = useTheme();

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

  const NavLinks = ({ onClick, forceExpanded }: { onClick?: () => void; forceExpanded?: boolean }) => {
    const isCollapsed = forceExpanded ? false : collapsed;
    return (
      <nav className="flex flex-col gap-0.5 px-2 py-3">
        {navItems.map(item => {
          const childActive = item.children?.some(c => location.startsWith(c.href)) ?? false;
          const isActive = (item.href === "/" ? location === "/" : location.startsWith(item.href)) || childActive;
          const isOpen = openGroups.has(item.href);

          if (item.children) {
            if (isCollapsed) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "flex justify-center px-2 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                  )}
                >
                  <item.icon className="shrink-0" style={{ height: 18, width: 18 }} />
                </Link>
              );
            }

            return (
              <Collapsible.Root
                key={item.href}
                open={isOpen}
                onOpenChange={() => toggleGroup(item.href)}
              >
                <div className={cn(
                  "flex items-center rounded-lg",
                  isActive
                    ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                    : "text-[hsl(var(--muted-foreground))]"
                )}>
                  <Link
                    href={item.href}
                    onClick={onClick}
                    className="flex flex-1 items-center gap-3 px-2.5 py-2 text-sm font-medium hover:text-[hsl(var(--foreground))] transition-colors rounded-l-lg"
                  >
                    <item.icon className="shrink-0" style={{ height: 18, width: 18 }} />
                    <span>{item.label}</span>
                  </Link>
                  <Collapsible.Trigger asChild>
                    <button className="px-2 py-2 rounded-r-lg hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
                      <ChevronRight className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200",
                        isOpen && "rotate-90"
                      )} />
                    </button>
                  </Collapsible.Trigger>
                </div>

                <Collapsible.Content className="collapsible-content overflow-hidden">
                  <div className="ml-5 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[hsl(var(--border))] pl-2">
                    {item.children.filter(c => user && c.roles.includes(user.role)).map(child => {
                      const cActive = location.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClick}
                          className={cn(
                            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors",
                            cActive
                              ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                          )}
                        >
                          <child.icon className="shrink-0" style={{ height: 14, width: 14 }} />
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClick}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                isCollapsed && "justify-center px-2",
                isActive
                  ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              <item.icon className="shrink-0" style={{ height: 18, width: 18 }} />
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    );
  };

  return (
    <div className="flex h-[100dvh] bg-[hsl(var(--background))]">

      {/* ── Desktop Sidebar — full height ────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r bg-[hsl(var(--card))] shrink-0 transition-all duration-200 z-20",
          collapsed ? "w-14" : "w-56"
        )}
      >

        {/* Logo + toggle — alinhado com o header */}
        <div className={cn(
          "h-14 flex items-center gap-2.5 border-b shrink-0 overflow-hidden",
          collapsed ? "justify-center px-0" : "px-3"
        )}>
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="h-7 w-7 rounded-lg bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0 hover:bg-[hsl(var(--primary))]/20 transition-colors"
              title="Expandir menu"
            >
              <Menu style={{ height: 16, width: 16 }} className="text-[hsl(var(--primary))]" />
            </button>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2.5">
              <button
                onClick={() => setCollapsed(true)}
                className="h-7 w-7 rounded-lg bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0 hover:bg-[hsl(var(--primary))]/20 transition-colors"
                title="Recolher menu"
              >
                <Menu style={{ height: 16, width: 16 }} className="text-[hsl(var(--primary))]" />
              </button>
              <div className="min-w-0 flex-1">
                {settings.logo_url
                  ? <img src={settings.logo_url} alt={settings.company_name} className="h-6 object-contain" />
                  : <>
                      <p className="font-bold text-sm leading-tight text-[hsl(var(--foreground))] truncate"><BrandName name={settings.company_name} /></p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
                    </>
                }
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
      </aside>

      {/* ── Right column: header + content ───────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top Header */}
        <header className="h-14 shrink-0 border-b bg-[hsl(var(--card))] flex items-center px-4 gap-3 z-30">

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
            onClick={() => setMobileOpen(v => !v)}
          >
            <Menu className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          </button>

          {/* Logo mobile */}
          <div className="md:hidden flex items-center gap-2 min-w-0">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt={settings.company_name} className="h-6 object-contain" />
            ) : (
              <>
                <div className="h-7 w-7 rounded-lg bg-[hsl(var(--primary))] flex items-center justify-center shrink-0">
                  <ListTodo className="h-4 w-4 text-white" />
                </div>
                <p className="font-bold text-sm truncate"><BrandName name={settings.company_name} /></p>
              </>
            )}
          </div>

          {/* Logo desktop — aparece no header quando sidebar está colapsado */}
          {collapsed && (
            <div className="hidden md:block min-w-0">
              {settings.logo_url
                ? <img src={settings.logo_url} alt={settings.company_name} className="h-6 object-contain" />
                : <>
                    <p className="font-bold text-sm leading-tight text-[hsl(var(--foreground))] truncate"><BrandName name={settings.company_name} /></p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
                  </>
              }
            </div>
          )}

          <div className="flex-1" />

          {/* Right actions */}
          <div className="flex items-center gap-1">

            {/* Search */}
            <GlobalSearch />

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(v => !v)}
                className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] min-h-[16px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-[0_0_0_1.5px_theme(colors.orange.300)]">
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
                                    if (n.taskId) navigate(`/tasks?tab=lista&highlight=${n.taskId}`);
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
                title="Personalizar"
                className={cn(
                  "h-8 w-8 flex items-center justify-center rounded-lg transition-colors",
                  customOpen
                    ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                    : "hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                )}
              >
                <Palette className="h-4 w-4" />
              </button>

              <AnimatePresence>
              {customOpen && (
                <motion.div variants={panelVariants} initial="initial" animate="animate" exit="exit"
                  className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border bg-[hsl(var(--card))] shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-[hsl(var(--muted))]/30">
                    <Palette className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-sm font-semibold">Personalização</span>
                  </div>

                  {/* Appearance */}
                  <div className="px-4 py-3 border-b">
                    <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-2.5">Aparência</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["light", "dark"] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => t !== theme && toggleTheme()}
                          className={cn(
                            "flex items-center justify-center gap-1.5 h-9 rounded-lg border text-xs font-medium transition-all",
                            theme === t
                              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8 text-[hsl(var(--primary))]"
                              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--foreground))]/20 hover:text-[hsl(var(--foreground))]"
                          )}
                        >
                          {t === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                          {t === "light" ? "Claro" : "Escuro"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Size */}
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-2.5">Tamanho</p>
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

            {/* Avatar + dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center font-semibold text-xs shrink-0">
                      {initials}
                    </div>
                  )}
                  <div className="hidden sm:block text-left">
                    <p className="text-xs font-medium leading-tight text-[hsl(var(--foreground))] max-w-[100px] truncate">{user?.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] leading-tight truncate max-w-[100px]">{user?.jobTitle || ({ admin: "Admin", supervisor: "Supervisor", coordinator: "Gestor", editor: "Operacional" } as Record<string,string>)[user?.role ?? ""] || user?.role}</p>
                  </div>
                  <ChevronRight className="hidden sm:block h-3 w-3 text-[hsl(var(--muted-foreground))] rotate-90" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-3 py-2.5 flex items-center gap-2.5">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center font-semibold text-xs shrink-0">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{user?.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{user?.jobTitle || ({ admin: "Admin", supervisor: "Supervisor", coordinator: "Gestor", editor: "Operacional" } as Record<string,string>)[user?.role ?? ""] || user?.role}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center cursor-pointer">
                    <UserCircle className="h-4 w-4 mr-2" /> Meu perfil
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-[hsl(var(--destructive))] cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main content */}
        <motion.main
          className="flex-1 flex flex-col min-w-0 overflow-hidden"
          animate={shaking ? { x: [-3, 6, -8, 8, -6, 4, -2, 0] } : { x: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          <BreadcrumbBar />
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-4 md:p-6 pb-8">
              {children}
            </div>
          </div>
        </motion.main>
      </div>

      <ChatWidget />

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
            <div className="h-14 flex items-center gap-3 px-4 border-b shrink-0">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt={settings.company_name} className="h-7 object-contain" />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-[hsl(var(--primary))] flex items-center justify-center shrink-0">
                  <ListTodo className="h-4 w-4 text-white" />
                </div>
              )}
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
            <div className="px-3 py-3 border-t shrink-0">
              <button
                onClick={() => { logout(); setMobileOpen(false); }}
                className="flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-sm font-medium text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/10 transition-colors"
              >
                <LogOut className="h-4 w-4 shrink-0" /> Sair
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}

import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FolderOpen, ListTodo, Users, Settings, LogOut,
  CalendarDays, Menu, Bell, Search, ChevronRight, X, UserCircle,
  CalendarRange, BarChart3, Zap, AtSign, ClipboardList,
  CheckCircle2, AlertCircle, UserPlus, Eye, Briefcase, FolderCheck, UserCheck, Undo2,
} from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { apiFetch, apiPut } from "@/lib/api";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandName } from "@/components/brand-name";
import { getSocket } from "@/lib/socket";
import { ChatWidget } from "@/components/layout/ChatWidget";

interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  taskId: number | null;
  jobId: number | null;
  createdAt: string;
}

const NOTIF_ICON: Record<string, React.ReactNode> = {
  task_assigned:    <UserPlus    className="h-4 w-4 text-blue-500" />,
  task_reassigned:  <UserCheck   className="h-4 w-4 text-blue-400" />,
  task_review:      <Eye         className="h-4 w-4 text-amber-500" />,
  task_approved:    <CheckCircle2 className="h-4 w-4 text-green-500" />,
  task_revision:    <AlertCircle  className="h-4 w-4 text-orange-500" />,
  task_returned:    <Undo2        className="h-4 w-4 text-rose-500" />,
  job_completed:    <Briefcase    className="h-4 w-4 text-indigo-500" />,
  project_completed:<FolderCheck  className="h-4 w-4 text-green-600" />,
  feed_mention:     <AtSign       className="h-4 w-4 text-violet-500" />,
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


const COORD_ROLES = ["admin", "supervisor", "coordinator"];
const ALL_ROLES   = ["admin", "supervisor", "coordinator", "editor"];

const NAV_ITEMS: NavItem[] = [
  { href: "/",         label: "Dashboard",      icon: LayoutDashboard, roles: ALL_ROLES },
  { href: "/timeline", label: "Linha do tempo", icon: CalendarRange, roles: COORD_ROLES },
  { href: "/reports",  label: "Relatórios",     icon: BarChart3,    roles: COORD_ROLES },
  { href: "/feed",     label: "Feed",             icon: Zap,             roles: ALL_ROLES },
  { href: "/my-tasks", label: "Meu Quadro",      icon: ListTodo,        roles: ALL_ROLES },
  { href: "/calendar", label: "Meu Calendário",  icon: CalendarDays,    roles: ALL_ROLES },
  { href: "/tasks",    label: "Tarefas",           icon: ClipboardList,   roles: COORD_ROLES },
  { href: "/team",     label: "Membros",          icon: Users,           roles: COORD_ROLES },
  { href: "/settings", label: "Configurações",    icon: Settings,        roles: ["admin"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { openTask } = useTaskModal();

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

  // Socket: receber novas notificações em tempo real
  useEffect(() => {
    const socket = getSocket();
    const handle = (notif: AppNotification) => {
      setNotifications(prev => [notif, ...prev].slice(0, 40));
      setUnreadCount(prev => prev + 1);
    };
    socket.on("notification:new", handle);
    return () => { socket.off("notification:new", handle); };
  }, []);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
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


  const closeSearch = () => setSearchQuery("");
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
      <aside className={cn(
        "hidden md:flex flex-col border-r bg-[hsl(var(--card))] shrink-0 transition-all duration-200 z-20",
        collapsed ? "w-14" : "w-56"
      )}>

        {/* Logo + toggle — alinhado com o header */}
        <div className={cn(
          "h-14 flex items-center gap-2.5 border-b shrink-0",
          collapsed ? "justify-center px-0" : "px-3"
        )}>
          <button
            onClick={() => setCollapsed(v => !v)}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] shrink-0"
          >
            <Menu style={{ height: 18, width: 18 }} />
          </button>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              {settings.logo_url
                ? <img src={settings.logo_url} alt={settings.company_name} className="h-6 object-contain" />
                : <>
                    <p className="font-bold text-sm leading-tight text-[hsl(var(--foreground))] truncate"><BrandName name={settings.company_name} /></p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
                  </>
              }
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
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
                  </>
              }
            </div>
          )}

          <div className="flex-1" />

          {/* Right actions */}
          <div className="flex items-center gap-1">

            {/* Search */}
            <div className="hidden sm:flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-52">
              <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Escape" && closeSearch()}
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))] min-w-0"
              />
              {searchQuery && (
                <button onClick={closeSearch} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(v => !v)}
                className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-[0_0_0_1.5px_theme(colors.orange.300)]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl border bg-[hsl(var(--card))] shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-[hsl(var(--muted))]/30">
                    <div className="flex items-center gap-2">
                      <Bell className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                      <span className="text-sm font-semibold">Notificações</span>
                      {unreadCount > 0 && (
                        <span className="text-[10px] font-bold bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] rounded-full px-1.5 py-0.5">{unreadCount} nova{unreadCount !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-[10px] text-[hsl(var(--primary))] hover:underline shrink-0">
                        Marcar todas
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <div className="overflow-y-auto max-h-[360px] divide-y">
                    {notifications.length === 0 ? (
                      <div className="py-10 text-center">
                        <Bell className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20 mx-auto mb-2" />
                        <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma notificação</p>
                      </div>
                    ) : notifications.map(n => (
                      <div
                        key={n.id}
                        role="button"
                        onClick={() => {
                          markRead(n);
                          setNotifOpen(false);
                          if (n.taskId) {
                            openTask(n.taskId);
                          } else {
                            window.location.href = "/";
                          }
                        }}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/40 transition-colors cursor-pointer",
                          !n.read && "bg-[hsl(var(--primary))]/5"
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {NOTIF_ICON[n.type] ?? <Bell className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-xs leading-snug", !n.read ? "font-semibold text-[hsl(var(--foreground))]" : "font-medium text-[hsl(var(--foreground))]/80")}>
                            {n.title}
                          </p>
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 mt-1">{timeAgo(n.createdAt)}</p>
                        </div>
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-[hsl(var(--primary))] shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight truncate max-w-[100px]">{user?.jobTitle || ({ admin: "Admin", supervisor: "Supervisor", coordinator: "Gestor", editor: "Operacional" } as Record<string,string>)[user?.role ?? ""] || user?.role}</p>
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
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{user?.jobTitle || ({ admin: "Admin", supervisor: "Supervisor", coordinator: "Gestor", editor: "Operacional" } as Record<string,string>)[user?.role ?? ""] || user?.role}</p>
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
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <BreadcrumbBar />
          <div className="flex-1 overflow-auto">
            <div className="p-4 md:p-8 max-w-7xl mx-auto pb-8">
              {children}
            </div>
          </div>
        </main>
      </div>

      <ChatWidget />

      {/* ── Mobile drawer ────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
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
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight truncate"><BrandName name={settings.system_name} /></p>
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
          </div>
        </div>
      )}
    </div>
  );
}

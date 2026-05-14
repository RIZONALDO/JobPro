import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, ClipboardList, Users, FolderOpen, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SearchTask {
  id: number;
  taskCode: string;
  title: string;
  status: string;
  client: string | null;
  assignedName: string | null;
  assignedAvatar: string | null;
}

interface SearchUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: string;
}

interface SearchProject {
  id: number;
  name: string;
  client: string | null;
  status: string;
}

interface SearchResults {
  tasks: SearchTask[];
  users: SearchUser[];
  projects: SearchProject[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  review: "Revisão",
  approved: "Aprovado",
  paused: "Pausado",
  cancelled: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-500",
  in_progress: "text-blue-500",
  review: "text-violet-500",
  approved: "text-green-500",
  paused: "text-orange-400",
  cancelled: "text-red-400",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  coordinator: "Gestor",
  editor: "Operacional",
};

function MiniAvatar({ name, url }: { name: string | null; url: string | null }) {
  const initials = (name ?? "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name ?? ""} className="h-7 w-7 rounded-full object-cover shrink-0" />;
  return (
    <div className="h-7 w-7 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center text-[11px] font-bold shrink-0">
      {initials}
    </div>
  );
}

export function GlobalSearch() {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [cursor, setCursor]   = useState(-1);

  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [, navigate] = useLocation();
  const { openTask } = useTaskModal();

  const taskCount    = results?.tasks.length    ?? 0;
  const userCount    = results?.users.length    ?? 0;
  const projectCount = results?.projects.length ?? 0;
  const totalCount   = taskCount + userCount + projectCount;

  // Map flat cursor index → {type, item}
  const getItem = (idx: number) => {
    if (idx < taskCount)                          return { type: "task"    as const, item: results!.tasks[idx] };
    if (idx < taskCount + userCount)              return { type: "user"    as const, item: results!.users[idx - taskCount] };
    if (idx < taskCount + userCount + projectCount) return { type: "project" as const, item: results!.projects[idx - taskCount - userCount] };
    return null;
  };

  const close = useCallback(() => { setOpen(false); setCursor(-1); }, []);

  const clear = () => {
    setQuery(""); setResults(null); setCursor(-1);
    inputRef.current?.focus();
  };

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [close]);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(data);
        setCursor(-1);
      } catch { /**/ }
      finally { setLoading(false); }
    }, 280);
  }, [query]);

  const goTo = useCallback((type: "task" | "user" | "project", item: SearchTask | SearchUser | SearchProject) => {
    close();
    setQuery(""); setResults(null);
    if      (type === "task")    openTask((item as SearchTask).id);
    else if (type === "user")    navigate("/team");
    else                         navigate("/tasks");
  }, [close, navigate, openTask]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape")    { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, totalCount - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return; }
    if (e.key === "Enter" && cursor >= 0) {
      const hit = getItem(cursor);
      if (hit) goTo(hit.type, hit.item);
    }
  };

  const showDropdown = open && (loading || (results !== null && query.trim().length >= 2));

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      {/* Input pill */}
      <div className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 h-8 transition-all duration-150",
        open
          ? "w-72 border-[hsl(var(--primary))]/50 bg-[hsl(var(--card))] shadow-sm"
          : "w-52 bg-[hsl(var(--muted))]/40 border-transparent hover:border-[hsl(var(--border))]"
      )}>
        {loading
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />
          : <Search  className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        }
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar...  ⌘K"
          className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
        />
        {query && (
          <button onClick={clear} className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.13 }}
            className="absolute top-full right-0 mt-2 w-[460px] rounded-2xl border bg-[hsl(var(--card))] shadow-2xl z-[200] overflow-hidden"
            style={{ borderColor: "hsl(var(--border))" }}
          >

            {/* Loading skeleton */}
            {loading && !results && (
              <div className="py-10 flex flex-col items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                <span>Buscando...</span>
              </div>
            )}

            {/* Empty */}
            {!loading && results && totalCount === 0 && (
              <div className="py-10 text-center space-y-1">
                <Search className="h-8 w-8 mx-auto text-[hsl(var(--muted-foreground))]/30" />
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum resultado para</p>
                <p className="text-sm font-semibold">"{query}"</p>
              </div>
            )}

            {/* Results */}
            {totalCount > 0 && (
              <div className="max-h-[480px] overflow-y-auto">

                {/* ── Tarefas ── */}
                {taskCount > 0 && (
                  <section>
                    <div className="sticky top-0 flex items-center gap-1.5 px-4 py-2 bg-[hsl(var(--muted))]/60 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                      <ClipboardList className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Tarefas</span>
                      <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">{taskCount}</span>
                    </div>
                    {results!.tasks.map((t, i) => {
                      const idx = i;
                      return (
                        <button
                          key={t.id}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => goTo("task", t)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                            cursor === idx ? "bg-[hsl(var(--primary))]/8" : "hover:bg-[hsl(var(--muted))]/50"
                          )}
                        >
                          <span className="font-mono text-xs font-bold text-[hsl(var(--primary))] shrink-0 w-[52px]">{t.taskCode}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">{t.title}</p>
                            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                              {[t.client, t.assignedName].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <span className={cn("text-xs font-medium shrink-0", STATUS_COLOR[t.status] ?? "text-[hsl(var(--muted-foreground))]")}>
                            {STATUS_LABEL[t.status] ?? t.status}
                          </span>
                          {t.assignedAvatar && (
                            <img src={t.assignedAvatar} className="h-5 w-5 rounded-full object-cover shrink-0" alt="" />
                          )}
                        </button>
                      );
                    })}
                  </section>
                )}

                {/* ── Membros ── */}
                {userCount > 0 && (
                  <section>
                    <div className={cn(
                      "sticky top-0 flex items-center gap-1.5 px-4 py-2 bg-[hsl(var(--muted))]/60 border-b",
                      taskCount > 0 && "border-t"
                    )} style={{ borderColor: "hsl(var(--border))" }}>
                      <Users className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Membros</span>
                      <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">{userCount}</span>
                    </div>
                    {results!.users.map((u, i) => {
                      const idx = taskCount + i;
                      return (
                        <button
                          key={u.id}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => goTo("user", u)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                            cursor === idx ? "bg-[hsl(var(--primary))]/8" : "hover:bg-[hsl(var(--muted))]/50"
                          )}
                        >
                          <MiniAvatar name={u.name} url={u.avatarUrl} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight">{u.name}</p>
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{u.jobTitle || ROLE_LABEL[u.role] || u.role}</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                            style={{ backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                            {ROLE_LABEL[u.role] || u.role}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                )}

                {/* ── Projetos ── */}
                {projectCount > 0 && (
                  <section>
                    <div className={cn(
                      "sticky top-0 flex items-center gap-1.5 px-4 py-2 bg-[hsl(var(--muted))]/60 border-b",
                      (taskCount > 0 || userCount > 0) && "border-t"
                    )} style={{ borderColor: "hsl(var(--border))" }}>
                      <FolderOpen className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Projetos</span>
                      <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">{projectCount}</span>
                    </div>
                    {results!.projects.map((p, i) => {
                      const idx = taskCount + userCount + i;
                      return (
                        <button
                          key={p.id}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => goTo("project", p)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                            cursor === idx ? "bg-[hsl(var(--primary))]/8" : "hover:bg-[hsl(var(--muted))]/50"
                          )}
                        >
                          <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-[hsl(var(--primary))]/10">
                            <FolderOpen className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">{p.name}</p>
                            {p.client && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{p.client}</p>}
                          </div>
                          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 capitalize">{p.status}</span>
                        </button>
                      );
                    })}
                  </section>
                )}
              </div>
            )}

            {/* Footer hint */}
            {totalCount > 0 && (
              <div className="border-t px-4 py-2 flex items-center gap-4 bg-[hsl(var(--muted))]/30"
                style={{ borderColor: "hsl(var(--border))" }}>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">↑↓ navegar</span>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">↵ abrir</span>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Esc fechar</span>
                <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">{totalCount} resultado{totalCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

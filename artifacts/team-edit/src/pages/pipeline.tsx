import { useEffect, useState, useCallback, useMemo } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { usePageTitle } from "@/lib/use-page-title";
import { fmtDateParts } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, Tag, AlertTriangle, Search, X, ChevronDown } from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS, isTerminal } from "@/lib/status";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { PriorityBadge } from "@/components/ui/priority-badge";

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 pl-3 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
          bg-[hsl(var(--background))] text-[hsl(var(--foreground))]
          appearance-none cursor-pointer focus:outline-none
          focus:ring-1 focus:ring-[hsl(var(--primary)/0.4)]
          hover:border-[hsl(var(--primary)/0.5)] transition-colors"
        style={{ minWidth: 110 }}
      >
        <option value="all">{label}: Todos</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

interface Person { id: number; name: string; avatarUrl?: string | null; }

interface PipelineTask {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  color: string;
  client: string | null;
  revisionCount: number;
  assignee: Person | null;
  coordinator: Person | null;
  createdAt: string;
}

const COLUMNS: { key: string; label: string; desc: string; accent: string }[] = [
  { key: "pending",     label: "Pendente",      desc: "Aguardando início",        accent: "#94a3b8" },
  { key: "in_progress", label: "Em andamento",  desc: "Editor trabalhando",       accent: "#3b82f6" },
  { key: "review",      label: "Aprovação",     desc: "Aguardando aprovação",     accent: "#f59e0b" },
  { key: "in_revision", label: "Em alteração",  desc: "Pedido de alteração",      accent: "#f97316" },
  { key: "completed",   label: "Aprovadas",     desc: "Tarefa concluída",         accent: "#22c55e" },
  { key: "paused",      label: "Pausadas",      desc: "Temporariamente pausada",  accent: "#a855f7" },
  { key: "cancelled",   label: "Canceladas",    desc: "Tarefa cancelada",         accent: "#ef4444" },
];

const PRIORITY_OPTS = [
  { value: "high",   label: "Alta" },
  { value: "medium", label: "Média" },
  { value: "low",    label: "Baixa" },
];

export default function Pipeline() {
  usePageTitle("Pipeline");
  const { user } = useAuth();
  const { toast } = useToast();
  const { openTask } = useTaskModal();
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [loading, setLoading] = useState(true);

  const isEditor = user?.role === "editor";
  // Filters
  const defaultCoord = (!isEditor && user) ? String(user.id) : "all";
  const [search,    setSearch]    = useState("");
  const [fPriority, setFPriority] = useState("all");
  const [fClient,   setFClient]   = useState("all");
  const [fEditor,   setFEditor]   = useState("all");
  const [fCoord,    setFCoord]    = useState(defaultCoord);

  const load = useCallback(() => {
    apiFetch<PipelineTask[]>("/api/pipeline")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar pipeline", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  const clientOpts = useMemo(() =>
    Array.from(new Set(tasks.map(t => t.client).filter(Boolean) as string[])).sort().map(c => ({ value: c, label: c })),
    [tasks]);

  const editorOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => { if (t.assignee) seen.set(String(t.assignee.id), t.assignee.name); });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks]);

  const coordOpts = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach(t => { if (t.coordinator && t.coordinator.id !== user?.id) seen.set(String(t.coordinator.id), t.coordinator.name); });
    return Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }));
  }, [tasks, user]);

  const hasFilters = search || fPriority !== "all" || fClient !== "all" || fEditor !== "all" || fCoord !== defaultCoord;
  const clearAll = () => { setSearch(""); setFPriority("all"); setFClient("all"); setFEditor("all"); setFCoord(defaultCoord); };

  const filteredTasks = useMemo(() => tasks.filter(t => {
    if (fPriority !== "all" && t.priority !== fPriority) return false;
    if (fClient   !== "all" && t.client   !== fClient)   return false;
    if (fEditor   !== "all" && String(t.assignee?.id ?? "") !== fEditor) return false;
    if (fCoord    !== "all" && String(t.coordinator?.id ?? "") !== fCoord) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [tasks, fPriority, fClient, fEditor, fCoord, search]);

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  const today = new Date().toISOString().split("T")[0];
  const total = filteredTasks.length;

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-[hsl(var(--background))]">
      {/* Filter card */}
      <div className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3 flex items-center gap-2.5 flex-wrap">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-8 pr-7 text-xs w-40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <FilterSelect label="Prioridade" value={fPriority} onChange={setFPriority} options={PRIORITY_OPTS} />
        <FilterSelect label="Cliente"    value={fClient}   onChange={setFClient}   options={clientOpts} />
        {!isEditor && <FilterSelect label="Editor" value={fEditor} onChange={setFEditor} options={editorOpts} />}
        {!isEditor && (
          <div className="relative flex items-center">
            <select
              value={fCoord}
              onChange={e => setFCoord(e.target.value)}
              className="h-8 pl-3 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
                bg-[hsl(var(--background))] text-[hsl(var(--foreground))]
                appearance-none cursor-pointer focus:outline-none
                focus:ring-1 focus:ring-[hsl(var(--primary)/0.4)]
                hover:border-[hsl(var(--primary)/0.5)] transition-colors"
              style={{ minWidth: 110 }}
            >
              <option value="all">Geral</option>
              {user && <option value={String(user.id)}>Minhas</option>}
              {coordOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
          </div>
        )}
        {hasFilters && (
          <button onClick={clearAll} className="flex items-center gap-1 h-8 px-2.5 text-xs rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)] transition-colors">
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
        <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
          {total} {total === 1 ? "tarefa" : "tarefas"}
        </span>
      </div>

      {/* Kanban card */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-x-auto overflow-y-auto">
      <div className="flex gap-4 items-start h-full p-4">
        {COLUMNS.map(col => {
          const colTasks = filteredTasks.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="flex flex-col gap-3 shrink-0" style={{ width: 240 }}>
              {/* Header */}
              <div className="flex items-center gap-2 px-1">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.accent }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">{col.label}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{col.desc}</p>
                </div>
                <span className="ml-auto text-xs font-semibold shrink-0 bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
                  {colTasks.length}
                </span>
              </div>

              {/* Cards */}
              {colTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 flex items-center justify-center bg-[hsl(var(--muted))]/10">
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhuma tarefa</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {colTasks.map(t => {
                    const isOverdue = t.dueDate && t.dueDate < today && !isTerminal(t.status);
                    return (
                      <div
                        key={t.id}
                        onClick={() => openTask(t.id)}
                        className="rounded-lg border bg-[hsl(var(--card))] card-float px-2.5 py-2 flex flex-col gap-1.5 hover:shadow-md transition-shadow cursor-pointer"
                        style={{ borderLeft: `3px solid ${col.accent}`, minHeight: 72 }}
                      >
                        {/* Code + revision */}
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          {t.taskCode && (
                            <span className="text-[10px] font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span>
                          )}
                          {t.revisionCount > 0 && (
                            <span className="text-[9px] font-bold text-orange-500 shrink-0 ml-auto">Alt.{t.revisionCount}</span>
                          )}
                        </div>

                        {/* Title */}
                        <p className="text-[11px] font-medium leading-snug line-clamp-2 overflow-hidden">{t.title}</p>

                        {/* Client */}
                        {t.client && (
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5 overflow-hidden">
                            <Tag className="h-2 w-2 shrink-0" />
                            <span className="truncate">{t.client}</span>
                          </p>
                        )}

                        {/* Priority + due date + assignee — single row, no wrap */}
                        <div className="flex items-center gap-1 min-w-0">
                          <PriorityBadge priority={t.priority} showLabel={false} />
                          {t.dueDate && (() => {
                            const parts = fmtDateParts(t.dueDate);
                            return parts ? (
                              <span className={`flex items-start gap-0.5 text-[9px] shrink-0 ${isOverdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                                {isOverdue && <AlertTriangle className="h-2 w-2 mt-px" />}
                                <Calendar className="h-2 w-2 shrink-0 mt-px" />
                                <span className="flex flex-col leading-tight">
                                  <span>{parts.date}</span>
                                  {parts.time && <span>{parts.time}</span>}
                                </span>
                              </span>
                            ) : null;
                          })()}
                          {t.assignee && (
                            <div className="ml-auto flex items-center gap-1 min-w-0 shrink-0">
                              <AvatarDisplay name={t.assignee.name} avatarUrl={t.assignee.avatarUrl} size={30} />
                              <span className="text-[9px] font-medium truncate max-w-[44px]">{t.assignee.name.split(" ")[0]}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

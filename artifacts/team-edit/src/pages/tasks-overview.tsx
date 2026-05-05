import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ClipboardList, MoreVertical, FolderOpen, AlertTriangle,
  CheckCircle2, Clock, ArrowUpRight, X,
} from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate, fmtDateHuman } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; login: string; avatarUrl?: string | null; }

interface OverviewTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  folderUrl: string | null;
  revisionCount: number;
  client: string | null;
  color: string;
  assignee: Person | null;
  coordinator: Person | null;
  isOwn: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLASS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
};

const STATUS_OPTIONS = [
  { value: "all",         label: "Todos os status" },
  { value: "pending",     label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "review",      label: "Em revisão" },
  { value: "in_revision", label: "Em alteração" },
  { value: "completed",   label: "Concluída" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function TasksOverview() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const { toast } = useToast();
  const { openTask } = useTaskModal();

  const isSuper = user?.role === "admin" || user?.role === "supervisor";

  const [tasks,        setTasks]        = useState<OverviewTask[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [editors,      setEditors]      = useState<(Person & { role: string })[]>([]);
  const [coordinators, setCoordinators] = useState<(Person & { role: string })[]>([]);

  // Filters
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEditor, setFilterEditor] = useState("all");
  const [filterCoord,  setFilterCoord]  = useState("all");

  // Revision dialog
  const [revisionTask,    setRevisionTask]    = useState<OverviewTask | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [sendingRevision, setSendingRevision] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<OverviewTask[]>("/api/tasks/overview")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar tarefas", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiFetch<(Person & { role: string })[]>("/api/users").then(users => {
      setEditors(users.filter(u => u.role === "editor"));
      setCoordinators(users.filter(u => ["coordinator", "supervisor", "admin"].includes(u.role)));
    }).catch(() => {});
  }, []);

  useRealtime({ onTasksChanged: load });

  // ── Client-side filters ───────────────────────────────────────────────────

  const filtered = tasks.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor) return false;
    if (filterCoord  !== "all" && String(t.coordinator?.id ?? "") !== filterCoord) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const hasFilter = search || filterStatus !== "all" || filterEditor !== "all" || filterCoord !== "all";
  const clearFilters = () => { setSearch(""); setFilterStatus("all"); setFilterEditor("all"); setFilterCoord("all"); };

  // ── Summary stats ─────────────────────────────────────────────────────────

  const now = new Date();
  const stats = {
    total:      filtered.length,
    inProgress: filtered.filter(t => t.status === "in_progress").length,
    review:     filtered.filter(t => t.status === "review").length,
    overdue:    filtered.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "completed").length,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAct = (t: OverviewTask) => t.isOwn || isSuper;
  const isOverdue = (t: OverviewTask) => !!(t.dueDate && new Date(t.dueDate) < now && t.status !== "completed");

  const approve = async (t: OverviewTask) => {
    try {
      await apiPut(`/api/tasks/${t.id}`, { status: "completed" });
      toast({ title: "Tarefa aprovada" });
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao aprovar", variant: "destructive" });
    }
  };

  const submitRevision = async () => {
    if (!revisionTask || !revisionComment.trim()) {
      toast({ title: "Informe o comentário", variant: "destructive" });
      return;
    }
    setSendingRevision(true);
    try {
      await apiPut(`/api/tasks/${revisionTask.id}`, { status: "in_progress", revisionComment: revisionComment.trim() });
      toast({ title: "Alteração solicitada" });
      setRevisionTask(null);
      load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSendingRevision(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
          <ClipboardList className="h-5 w-5 text-[hsl(var(--primary))]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tarefas</h1>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Visão consolidada de todas as tarefas atribuídas pelos coordenadores
          </p>
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",               value: stats.total,      icon: ClipboardList, color: "text-slate-600", bg: "bg-slate-50 border-slate-200 dark:bg-slate-900/30 dark:border-slate-700" },
          { label: "Em andamento",        value: stats.inProgress, icon: Clock,         color: "text-blue-600",  bg: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" },
          { label: "Aguardando aprovação",value: stats.review,     icon: CheckCircle2,  color: "text-amber-600", bg: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800" },
          { label: "Atrasadas",           value: stats.overdue,    icon: AlertTriangle, color: "text-red-600",   bg: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`rounded-xl border p-4 flex items-center gap-3 ${bg}`}>
            <Icon className={`h-5 w-5 shrink-0 ${color}`} />
            <div>
              <p className={`text-2xl font-bold leading-none ${color}`}>{value}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tarefa…"
          className="h-9 w-52 text-sm"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterEditor} onValueChange={setFilterEditor}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue placeholder="Todos os editores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os editores</SelectItem>
            {editors.map(e => (
              <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCoord} onValueChange={setFilterCoord}>
          <SelectTrigger className="h-9 w-48 text-sm">
            <SelectValue placeholder="Todos os coordenadores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os coordenadores</SelectItem>
            {coordinators.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-9 text-xs gap-1.5 text-[hsl(var(--muted-foreground))]"
            onClick={clearFilters}>
            <X className="h-3 w-3" />Limpar
          </Button>
        )}
        <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">

        {/* Column headers */}
        <div className="flex items-center px-4 py-2.5 bg-[hsl(var(--muted))]/30 border-b">
          <div className="flex-1 pr-4 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Tarefa</div>
          <div className="w-36 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Status</div>
          <div className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Prioridade</div>
          <div className="w-36 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Editor</div>
          <div className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Prazo</div>
          <div className="w-32 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Coordenador</div>
          <div className="w-52 shrink-0" />
        </div>

        {/* Loading skeleton */}
        {loading ? (
          <div className="divide-y divide-[hsl(var(--muted))]">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center px-4 py-3 gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-48 rounded bg-[hsl(var(--muted))]/60 animate-pulse" />
                  <div className="h-3 w-32 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                </div>
                {[36, 24, 36, 28, 32].map((w, j) => (
                  <div key={j} className={`h-6 w-${w} rounded bg-[hsl(var(--muted))]/40 animate-pulse shrink-0`} />
                ))}
                <div className="w-52 shrink-0" />
              </div>
            ))}
          </div>

        ) : filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {hasFilter ? "Nenhuma tarefa corresponde aos filtros." : "Nenhuma tarefa encontrada."}
            </p>
            {hasFilter && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            )}
          </div>

        ) : (
          /* Task rows */
          <div className="divide-y divide-[hsl(var(--muted))]">
            {filtered.map(t => {
              const overdue   = isOverdue(t);
              const canActNow = canAct(t);

              return (
                <div
                  key={t.id}
                  className="flex items-stretch px-4 hover:bg-[hsl(var(--muted))]/20 transition-colors min-h-[54px]"
                  style={{ borderLeft: `3px solid ${t.projectColor ?? "#6366f1"}` }}
                >
                  {/* Tarefa */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center py-2.5 pr-4">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-medium truncate">{t.title}</span>
                      {t.revisionCount > 0 && (
                        <span className="text-[10px] font-bold text-orange-500 shrink-0">Alt.{t.revisionCount}</span>
                      )}
                    </div>
                    {(t.projectName || t.jobName) && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                        {t.projectName}{t.jobName ? ` · ${t.jobName}` : ""}
                      </p>
                    )}
                    {t.description && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 truncate mt-0.5">{t.description}</p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="w-36 shrink-0 flex items-center">
                    <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>

                  {/* Prioridade */}
                  <div className="w-24 shrink-0 flex items-center">
                    <Badge variant="outline" className={`text-[10px] px-1.5 ${PRIORITY_CLASS[t.priority] ?? ""}`}>
                      {PRIORITY_LABEL[t.priority] ?? t.priority}
                    </Badge>
                  </div>

                  {/* Editor */}
                  <div className="w-36 shrink-0 flex items-center">
                    {t.assignee ? (
                      <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">@{t.assignee.login}</span>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]/40 italic">não atribuído</span>
                    )}
                  </div>

                  {/* Prazo */}
                  <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5">
                    {t.dueDate ? (
                      <>
                        <span className={`text-xs ${overdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                          {fmtDateHuman(t.dueDate)}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{fmtDate(t.dueDate)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>
                    )}
                  </div>

                  {/* Coordenador */}
                  <div className="w-32 shrink-0 flex items-center">
                    <span className={`text-xs truncate ${t.isOwn ? "text-[hsl(var(--primary))] font-medium" : "text-[hsl(var(--muted-foreground))]"}`}>
                      {t.isOwn ? "Você" : (t.coordinator?.name ?? "—")}
                    </span>
                  </div>

                  {/* Ações */}
                  <div className="w-52 shrink-0 flex items-center justify-end gap-1 py-2">
                    {t.folderUrl && (
                      <a href={t.folderUrl} target="_blank" rel="noreferrer" title="Abrir pasta no servidor"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {t.status === "review" && canActNow && (
                      <>
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700"
                          onClick={() => approve(t)}>
                          ✓ Aprovar
                        </Button>
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs px-2.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                          onClick={() => { setRevisionTask(t); setRevisionComment(""); }}>
                          ↩ Alterar
                        </Button>
                      </>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openTask(t.id)}>
                          <ArrowUpRight className="h-3.5 w-3.5" />Ver detalhes
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Revision dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!revisionTask} onOpenChange={open => !open && setRevisionTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar alteração</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {revisionTask && revisionTask.revisionCount > 0 && (
              <p className="text-xs text-orange-600 font-medium">
                Esta será a Alteração #{revisionTask.revisionCount + 1}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Comentário do cliente *</Label>
              <Textarea
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                rows={4}
                placeholder="Descreva o que o cliente solicitou alterar…"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionTask(null)}>Cancelar</Button>
            <Button onClick={submitRevision} disabled={sendingRevision}
              className="bg-orange-600 hover:bg-orange-700">
              {sendingRevision ? "Enviando…" : "↩ Solicitar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

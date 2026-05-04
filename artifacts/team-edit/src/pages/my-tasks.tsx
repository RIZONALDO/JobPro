import React, { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ListTodo, MessageSquare, LayoutGrid, List, Calendar, AlertCircle, Undo2, MoreVertical, FolderOpen, Info, Copy, ExternalLink, ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";

interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  complexity: string;
  folderUrl: string | null;
  jobId: number;
  revisionCount: number;
  revisions: Revision[];
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  assignedToId: number | null;
  assignedTo?: { id: number; name: string; avatarUrl?: string | null } | null;
  number?: number;
  jobNumber?: number;
  projectNumber?: number;
  jobName?: string | null;
  projectName?: string | null;
  projectClient?: string | null;
}

const PRIORITY_COLOR: Record<string, string> = { low: "text-green-600", medium: "text-yellow-600", high: "text-red-600" };
const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

const transitions: Record<string, { next: string; label: string }> = {
  pending:     { next: "in_progress", label: "Iniciar edição" },
  in_progress: { next: "review",      label: "Enviar para aprovação" },
  in_revision: { next: "review",      label: "Enviar para aprovação" },
};

const KANBAN_COLS = [
  { key: "pending",     label: "Pendente",     dot: "bg-slate-400",   colBg: "bg-slate-50/60",      headerBg: "bg-slate-100/80",    border: "border-slate-200",   leftBar: "bg-slate-300"   },
  { key: "in_progress", label: "Em edição",    dot: "bg-blue-500",    colBg: "bg-blue-50/40",       headerBg: "bg-blue-100/60",     border: "border-blue-200",    leftBar: "bg-blue-400"    },
  { key: "in_revision", label: "Em alteração",  dot: "bg-orange-500",  colBg: "bg-orange-50/40",     headerBg: "bg-orange-100/60",   border: "border-orange-200",  leftBar: "bg-orange-400"  },
  { key: "review",      label: "Para aprovar", dot: "bg-amber-500",   colBg: "bg-amber-50/40",      headerBg: "bg-amber-100/60",    border: "border-amber-200",   leftBar: "bg-amber-400"   },
  { key: "completed",   label: "Aprovadas",    dot: "bg-green-500",   colBg: "bg-green-50/40",      headerBg: "bg-green-100/60",    border: "border-green-200",   leftBar: "bg-green-500"   },
];

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export default function MyTasks() {
  usePageTitle("Minhas Tarefas");
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [expandedRevisions, setExpandedRevisions] = useState<Set<number>>(new Set());
  const [revisionTarget, setRevisionTarget] = useState<number | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [returnTarget, setReturnTarget] = useState<Task | null>(null);
  const [returning, setReturning] = useState(false);
  const [infoTarget, setInfoTarget] = useState<Task | null>(null);

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar tarefas", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onTasksChanged: load });

  const updateStatus = async (task: Task, status: string) => {
    try {
      await apiPut(`/api/tasks/${task.id}`, { status });
      load();
    } catch { toast({ title: "Erro ao atualizar status", variant: "destructive" }); }
  };

  const confirmReturn = async () => {
    if (!returnTarget) return;
    setReturning(true);
    try {
      await apiPost(`/api/tasks/${returnTarget.id}/return`, {});
      setReturnTarget(null);
      load();
      toast({ title: "Tarefa devolvida." });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao devolver", variant: "destructive" });
    } finally { setReturning(false); }
  };

  const toggleRevisions = (taskId: number) => {
    setExpandedRevisions(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const isEditor = user?.role === "editor";
  const active = tasks.filter(t => t.status !== "completed");
  const completed = tasks.filter(t => t.status === "completed");

  /* ── Kanban Card ─────────────────────────────────────────────── */
  const KanbanCard = ({ t, col }: { t: Task; col: typeof KANBAN_COLS[0] }) => {
    const overdue = isOverdue(t.dueDate) && t.status !== "completed";
    const person = isEditor ? t.createdBy : t.assignedTo ?? null;
    const firstName = person ? person.name.split(" ")[0] : null;
    const showRevisionForm = revisionTarget === t.id;

    const submitRevision = async () => {
      if (!revisionComment.trim()) return;
      try {
        await apiPut(`/api/tasks/${t.id}`, { status: "in_progress", revisionComment });
        setRevisionTarget(null);
        setRevisionComment("");
        load();
      } catch { toast({ title: "Erro ao solicitar alteração", variant: "destructive" }); }
    };

    return (
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden hover:shadow-md transition-shadow">

        {/* Header colorido por status */}
        <div className={`px-3 py-2.5 border-b space-y-1.5 cursor-pointer ${col.headerBg}`} onClick={() => setInfoTarget(t)}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {(t.projectNumber && t.jobNumber && t.number) ? (
                <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))]/50 block mb-0.5">{t.projectNumber}.{t.jobNumber}.{t.number}</span>
              ) : null}
              <p className="text-xs font-semibold leading-snug line-clamp-2">{t.title}</p>
              {t.projectClient && (
                <p className="text-[9px] text-[hsl(var(--muted-foreground))]/70 truncate mt-0.5">{t.projectClient}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {person && (
                <AvatarDisplay
                  name={person.name}
                  avatarUrl={person.avatarUrl}
                  className="h-6 w-6 text-[9px] bg-white/60 text-[hsl(var(--foreground))]"
                  title={person.name}
                />
              )}
              {isEditor && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={e => e.stopPropagation()}>
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setInfoTarget(t)}>
                      <Info className="h-3.5 w-3.5 mr-2" />Ver informações
                    </DropdownMenuItem>
                    {["pending", "in_progress", "in_revision"].includes(t.status) && (
                      <DropdownMenuItem onClick={() => setReturnTarget(t)}>
                        <Undo2 className="h-3.5 w-3.5 mr-2" />Devolver
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {t.description && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] line-clamp-2 leading-relaxed">
              {t.description}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="px-3 py-2.5 space-y-2">

          {/* Pessoa */}
          {firstName && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {isEditor ? "por " : "editor: "}
              <span className="font-medium text-[hsl(var(--foreground))]">{firstName}</span>
            </p>
          )}

          {/* Metadados: complexidade · prioridade */}
          <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span>{COMPLEXITY_LABEL[t.complexity] ?? t.complexity}</span>
            <span className="opacity-30">·</span>
            <span className={PRIORITY_COLOR[t.priority] ?? ""}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
          </div>


          {/* Rodapé: revisões + data */}
          <div className="flex items-center gap-2 border-t pt-2">
            {t.revisionCount > 0 && (
              <button type="button" onClick={() => toggleRevisions(t.id)}
                className="flex items-center gap-0.5 text-[10px] text-orange-500 hover:text-orange-700 transition-colors">
                <MessageSquare className="h-2.5 w-2.5" />
                {t.revisionCount} alt.
              </button>
            )}
            {t.dueDate && (
              <span className={`flex items-center gap-0.5 text-[10px] ml-auto ${overdue ? "text-red-500 font-medium" : "text-[hsl(var(--muted-foreground))]"}`}>
                {overdue && <AlertCircle className="h-2.5 w-2.5" />}
                <Calendar className="h-2.5 w-2.5" />
                {fmtDateHuman(t.dueDate)}
                {fmtDate(t.dueDate) !== fmtDateHuman(t.dueDate) && (
                  <span className="opacity-50 ml-0.5">· {fmtDate(t.dueDate)}</span>
                )}
              </span>
            )}
          </div>

          {/* Revisões expandidas */}
          {expandedRevisions.has(t.id) && t.revisions.length > 0 && (
            <div className="space-y-1.5 border-t pt-1.5">
              {t.revisions.map(r => (
                <div key={r.id}>
                  <span className="text-[10px] font-semibold text-orange-600 mr-1">Alt. #{r.revisionNumber}</span>
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {fmtShort(r.createdAt)}
                  </span>
                  <p className="text-[11px] mt-0.5">{r.comment}</p>
                </div>
              ))}
            </div>
          )}

          {/* Editor: avançar status */}
          {isEditor && transitions[t.status] && (
            <Button size="sm" variant="outline" className="w-full h-7 text-[10px] px-2"
              onClick={() => updateStatus(t, transitions[t.status].next)}>
              {transitions[t.status].label}
            </Button>
          )}

          {/* Coordenador: aprovar ou pedir alteração (só em review) */}
          {!isEditor && t.status === "review" && !showRevisionForm && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] border-green-300 text-green-700 hover:bg-green-50"
                onClick={() => updateStatus(t, "completed")}>
                Aprovar
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] border-orange-200 text-orange-600 hover:bg-orange-50"
                onClick={() => { setRevisionTarget(t.id); setRevisionComment(""); }}>
                Pedir alt.
              </Button>
            </div>
          )}

          {/* Coordenador: formulário inline de comentário */}
          {!isEditor && showRevisionForm && (
            <div className="space-y-1.5 border-t pt-2">
              <textarea
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                placeholder="Descreva a alteração..."
                rows={2}
                className="w-full text-[11px] rounded-lg border px-2 py-1.5 resize-none bg-[hsl(var(--background))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1 h-7 text-[10px]"
                  onClick={submitRevision} disabled={!revisionComment.trim()}>
                  Enviar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2"
                  onClick={() => { setRevisionTarget(null); setRevisionComment(""); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Table Row ───────────────────────────────────────────────── */
  const TaskRow = ({ t, idx, total }: { t: Task; idx: number; total: number }) => (
    <div className={`group ${idx < total - 1 ? "border-b" : ""}`}>
      <div className="flex">
        <div className={`w-0.5 shrink-0 ${
          t.status === "pending"     ? "bg-slate-200" :
          t.status === "in_progress" ? "bg-blue-400" :
          t.status === "in_revision" ? "bg-orange-400" :
          t.status === "review"      ? "bg-amber-400" :
                                       "bg-green-500"
        }`} />
        <div className="flex flex-1 items-stretch px-5 hover:bg-[hsl(var(--muted))]/40 transition-colors min-h-[44px]">
          <div className="flex-1 min-w-0 flex flex-col justify-center py-2 pr-3">
            <div className="flex items-center gap-1.5">
              {(t.projectNumber && t.jobNumber && t.number) ? (
                <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{t.projectNumber}.{t.jobNumber}.{t.number}</span>
              ) : null}
              <span className="text-sm font-medium truncate">{t.title}</span>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              {isEditor && t.projectClient && (
                <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.projectClient}</span>
              )}
              {!isEditor && t.assignedTo && (
                <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.assignedTo.name}</span>
              )}
              {isEditor && t.folderUrl && (
                <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                  <span className="font-mono truncate max-w-[220px]">{t.folderUrl}</span>
                  <button
                    type="button"
                    title="Copiar URL"
                    onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(t.folderUrl!); toast({ title: "URL copiada!" }); }}
                    className="shrink-0 hover:text-[hsl(var(--primary))] transition-colors">
                    <Copy className="h-2.5 w-2.5" />
                  </button>
                  <a href={t.folderUrl} target="_blank" rel="noreferrer" title="Abrir"
                    className="shrink-0 hover:text-[hsl(var(--primary))] transition-colors">
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="w-52 shrink-0 flex items-center gap-1.5">
            <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
              {STATUS_LABEL[t.status] ?? t.status}
            </Badge>
            {t.revisionCount > 0 && (
              <span className="text-[10px] font-semibold text-orange-500">Alt.{t.revisionCount}</span>
            )}
            {t.revisions.length > 0 && (
              <button type="button" onClick={() => toggleRevisions(t.id)}
                className="text-orange-400 hover:text-orange-600 transition-colors" title="Ver alterações">
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="w-20 shrink-0 flex items-center">
            <span className={`text-xs font-medium ${PRIORITY_COLOR[t.priority] ?? ""}`}>
              {PRIORITY_LABEL[t.priority] ?? t.priority}
            </span>
          </div>
          <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5">
            {t.dueDate && (() => {
              const h = fmtDateHuman(t.dueDate); const n = fmtDate(t.dueDate);
              const overdue = isOverdue(t.dueDate) && t.status !== "completed";
              return <>
                <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>{h}</span>
                {h !== n && <span className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{n}</span>}
              </>;
            })()}
          </div>
          <div className="w-44 shrink-0 flex items-center justify-end gap-1 py-2">
            {isEditor && transitions[t.status] && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5"
                onClick={() => updateStatus(t, transitions[t.status].next)}>
                {transitions[t.status].label}
              </Button>
            )}
            {isEditor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setInfoTarget(t)}>
                    <Info className="h-3.5 w-3.5 mr-2" />Ver informações
                  </DropdownMenuItem>
                  {["pending", "in_progress", "in_revision"].includes(t.status) && (
                    <DropdownMenuItem onClick={() => setReturnTarget(t)}>
                      <Undo2 className="h-3.5 w-3.5 mr-2" />Devolver
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
      {expandedRevisions.has(t.id) && t.revisions.length > 0 && (
        <div className="px-7 pb-3 pt-1 space-y-2 border-l-2 border-orange-200 ml-0.5">
          {t.revisions.map(r => (
            <div key={r.id}>
              <span className="text-[10px] font-semibold text-orange-600 mr-2">Alt. #{r.revisionNumber}</span>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {fmtShort(r.createdAt)}
              </span>
              <p className="text-xs text-[hsl(var(--foreground))] mt-0.5">{r.comment}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm p-4">Carregando...</div>;

  return (
    <div className="space-y-4">
      {/* Context bar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {tasks.length} {tasks.length === 1 ? "tarefa" : "tarefas"} atribuídas a você
        </p>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg border bg-[hsl(var(--muted))]/40 p-1">
          <button
            onClick={() => setView("kanban")}
            title="Kanban"
            className={`p-1.5 rounded-md transition-colors ${
              view === "kanban"
                ? "bg-[hsl(var(--card))] shadow-sm text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}>
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("table")}
            title="Tabela"
            className={`p-1.5 rounded-md transition-colors ${
              view === "table"
                ? "bg-[hsl(var(--card))] shadow-sm text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}>
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── KANBAN VIEW ─────────────────────────────────────────── */}
      {view === "kanban" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-start">
          {KANBAN_COLS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.key);
            return (
              <div key={col.key} className={`flex flex-col gap-2 rounded-xl p-2 ${col.colBg}`}>
                {/* Column header */}
                <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${col.border} ${col.headerBg}`}>
                  <span className="text-xs font-semibold text-[hsl(var(--foreground))]">{col.label}</span>
                  <span className="text-[11px] font-bold text-[hsl(var(--muted-foreground))]">{colTasks.length}</span>
                </div>
                {/* Cards */}
                <div className="flex flex-col gap-2">
                  {colTasks.length === 0 ? (
                    <div className={`rounded-lg border border-dashed ${col.border} px-3 py-5 text-center text-[11px] text-[hsl(var(--muted-foreground))]`}>
                      Vazio
                    </div>
                  ) : colTasks.map(t => <KanbanCard key={t.id} t={t} col={col} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TABLE VIEW ──────────────────────────────────────────── */}
      {view === "table" && (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Em aberto ({active.length})</TabsTrigger>
            <TabsTrigger value="completed">Aprovadas ({completed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            {active.length === 0 ? (
              <div className="rounded-xl bg-[hsl(var(--card))] card-float py-12 text-center text-sm text-[hsl(var(--muted-foreground))] flex flex-col items-center gap-2">
                <ListTodo className="h-8 w-8 opacity-30" />
                Nenhuma tarefa em aberto.
              </div>
            ) : (
              <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
                <div className="flex border-b bg-[hsl(var(--muted))]/30">
                  <div className="w-0.5 shrink-0" />
                  <div className="flex flex-1 items-center px-5 py-3">
                    <div className="flex-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 pr-3">Tarefa</div>
                    <div className="w-52 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Status</div>
                    <div className="w-20 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Prior.</div>
                    <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Entrega</div>
                    <div className="w-44 shrink-0" />
                  </div>
                </div>
                {active.map((t, idx) => <TaskRow key={t.id} t={t} idx={idx} total={active.length} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="mt-4">
            {completed.length === 0 ? (
              <div className="rounded-xl bg-[hsl(var(--card))] card-float py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
                Nenhuma tarefa aprovada.
              </div>
            ) : (
              <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
                <div className="flex border-b bg-[hsl(var(--muted))]/30">
                  <div className="w-0.5 shrink-0" />
                  <div className="flex flex-1 items-center px-5 py-3">
                    <div className="flex-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 pr-3">Tarefa</div>
                    <div className="w-52 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Status</div>
                    <div className="w-20 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Prior.</div>
                    <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">Entrega</div>
                    <div className="w-44 shrink-0" />
                  </div>
                </div>
                {completed.map((t, idx) => <TaskRow key={t.id} t={t} idx={idx} total={completed.length} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
      {/* ── Task info modal ───────────────────────────────────── */}
      <Dialog open={!!infoTarget} onOpenChange={v => { if (!v) setInfoTarget(null); }}>
        <DialogContent
          className="max-w-xl"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{infoTarget?.title ?? "Informações da tarefa"}</DialogTitle>
          {infoTarget && (() => {
            const overdue = isOverdue(infoTarget.dueDate) && infoTarget.status !== "completed";
            const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
              <div className="flex items-baseline gap-3">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 w-24 shrink-0 pt-px">{label}</span>
                <span className="flex-1 min-w-0">{children}</span>
              </div>
            );
            return (
              <div className="space-y-4 pt-1 text-sm">

                {/* Contexto */}
                <div className="flex items-start gap-8">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Projeto</p>
                    <p className="text-sm font-semibold truncate">{infoTarget.projectName ?? "—"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Job</p>
                    <p className="text-sm font-semibold truncate">{infoTarget.jobName ?? "—"}</p>
                  </div>
                  {infoTarget.projectClient && (
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Cliente</p>
                      <p className="text-sm font-semibold truncate">{infoTarget.projectClient}</p>
                    </div>
                  )}
                </div>

                <hr className="border-dashed border-muted-foreground/20" />

                {/* Tarefa */}
                <div className="space-y-2">
                  <Row label="Tarefa">
                    <span className="font-semibold leading-snug">{infoTarget.title}</span>
                  </Row>
                  <Row label="Status">
                    <Badge className={`${STATUS_CLASS[infoTarget.status] ?? ""} text-[10px] px-1.5`}>
                      {STATUS_LABEL[infoTarget.status] ?? infoTarget.status}
                    </Badge>
                    {infoTarget.revisionCount > 0 && (
                      <span className="text-[11px] text-orange-500 font-medium ml-2">{infoTarget.revisionCount} alt.</span>
                    )}
                  </Row>
                  {(infoTarget.projectNumber && infoTarget.jobNumber && infoTarget.number) && (
                    <Row label="Código">
                      <span className="font-mono text-xs text-muted-foreground">
                        {infoTarget.projectNumber}.{infoTarget.jobNumber}.{infoTarget.number}
                      </span>
                    </Row>
                  )}
                </div>

                <hr className="border-dashed border-muted-foreground/20" />

                {/* Destaques */}
                <div className="space-y-2">
                  <Row label="Prioridade">
                    <span className={`font-bold ${PRIORITY_COLOR[infoTarget.priority] ?? ""}`}>
                      {PRIORITY_LABEL[infoTarget.priority] ?? infoTarget.priority}
                    </span>
                  </Row>
                  <Row label="Complexidade">
                    <span className="font-semibold">{COMPLEXITY_LABEL[infoTarget.complexity] ?? infoTarget.complexity}</span>
                  </Row>
                  {infoTarget.dueDate && (
                    <Row label="Entrega">
                      <span className={`font-bold tabular-nums ${overdue ? "text-red-600" : ""}`}>
                        {fmtDate(infoTarget.dueDate)}
                      </span>
                      {fmtDateHuman(infoTarget.dueDate) !== fmtDate(infoTarget.dueDate) && (
                        <span className={`text-xs ml-2 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
                          {fmtDateHuman(infoTarget.dueDate)}
                        </span>
                      )}
                      {overdue && (
                        <span className="text-xs ml-2 text-red-400">· atrasada</span>
                      )}
                    </Row>
                  )}
                </div>

                {/* Descrição */}
                {infoTarget.description && (
                  <>
                    <hr className="border-dashed border-muted-foreground/20" />
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Descrição</p>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{infoTarget.description}</p>
                    </div>
                  </>
                )}

                {/* Pasta */}
                {infoTarget.folderUrl && (
                  <>
                    <hr className="border-dashed border-muted-foreground/20" />
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-xs font-mono text-muted-foreground truncate">{infoTarget.folderUrl}</span>
                      <button type="button" title="Copiar"
                        onClick={() => { navigator.clipboard.writeText(infoTarget!.folderUrl!); toast({ title: "URL copiada!" }); }}
                        className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <a href={infoTarget.folderUrl} target="_blank" rel="noreferrer" title="Abrir"
                        className="shrink-0 text-muted-foreground hover:text-primary p-1 rounded transition-colors">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </>
                )}

              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnTarget} onOpenChange={v => { if (!v && !returning) setReturnTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Devolver tarefa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja devolver a tarefa{" "}
            <strong>"{returnTarget?.title}"</strong>?
            Ela voltará para pendente e ficará disponível para o coordenador.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)} disabled={returning}>Cancelar</Button>
            <Button onClick={confirmReturn} disabled={returning}>
              {returning ? "Aguarde…" : "Devolver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

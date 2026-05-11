import { motion } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useRealtime } from "@/hooks/use-realtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  AlertCircle, Calendar, MessageSquare, MoreVertical,
  Info, Undo2, PauseCircle, XCircle, Search,
} from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";

interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  revisionCount: number;
  client: string | null;
  color: string;
  number?: number;
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  revisions: Revision[];
}

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLS: Record<string, string> = {
  low:    "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high:   "bg-red-100 text-red-700 border-red-200",
};

const transitions: Record<string, { next: string; label: string }> = {
  pending:     { next: "in_progress", label: "Iniciar edição" },
  in_progress: { next: "review",      label: "Enviar para aprovação" },
  in_revision: { next: "review",      label: "Enviar para aprovação" },
};

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

const STATUS_ORDER = ["pending", "in_progress", "in_revision", "review", "paused", "completed", "cancelled"];

export default function EditorTaskList() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { openTask } = useTaskModal();

  const [tasks,   setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  const [returnTarget,  setReturnTarget]  = useState<Task | null>(null);
  const [returning,     setReturning]     = useState(false);
  const [confirmTask,   setConfirmTask]   = useState<{ id: number; title: string; action: "pause" | "cancel" } | null>(null);
  const [confirming,    setConfirming]    = useState(false);

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

  const executeConfirm = async () => {
    if (!confirmTask) return;
    setConfirming(true);
    try {
      await apiPut(`/api/tasks/${confirmTask.id}`, { status: confirmTask.action === "cancel" ? "cancelled" : "paused" });
      setConfirmTask(null);
      load();
      toast({ title: confirmTask.action === "pause" ? "Tarefa pausada." : "Tarefa cancelada." });
    } catch { toast({ title: "Erro ao executar ação", variant: "destructive" }); }
    finally { setConfirming(false); }
  };

  const filtered = tasks
    .filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()) || (t.client ?? "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  if (loading) return (
    <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden animate-pulse">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
          <div className="h-5 w-20 rounded bg-[hsl(var(--muted))]/60" />
          <div className="h-4 flex-1 rounded bg-[hsl(var(--muted))]/40" />
          <div className="h-4 w-24 rounded bg-[hsl(var(--muted))]/40" />
          <div className="h-4 w-16 rounded bg-[hsl(var(--muted))]/40" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-3 h-9 max-w-sm">
        <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tarefa ou cliente…"
          className="border-0 bg-transparent p-0 h-auto text-sm outline-none focus-visible:ring-0 shadow-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-4 px-4 py-2.5 bg-[hsl(var(--muted))]/30 border-b text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
          <div className="w-28 shrink-0">Status</div>
          <div className="flex-1 min-w-0">Tarefa</div>
          <div className="w-24 shrink-0 hidden md:block">Prioridade</div>
          <div className="w-28 shrink-0 hidden lg:block">Prazo</div>
          <div className="w-24 shrink-0 hidden lg:block">Coordenador</div>
          <div className="w-36 shrink-0">Ação</div>
          <div className="w-8 shrink-0" />
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa atribuída."}
            </p>
          </div>
        ) : filtered.map(t => {
          const overdue = isOverdue(t.dueDate) && !["completed", "cancelled", "paused"].includes(t.status);
          const accent  = t.color ?? "#6366f1";
          const trans   = transitions[t.status];
          const canReturn = ["pending", "in_progress", "in_revision"].includes(t.status);
          const canPause  = !["completed", "cancelled", "paused"].includes(t.status);

          return (
            <motion.div
              key={t.id}
              variants={staggerRow}
              className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-[hsl(var(--muted))]/20 transition-colors"
              style={{ borderLeft: `3px solid ${accent}` }}
            >
              {/* Status */}
              <div className="w-28 shrink-0">
                <Badge className={`${STATUS_CLASS[t.status] ?? ""} text-xs px-1.5 font-medium`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              </div>

              {/* Title + client + revision */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  {t.taskCode && (
                    <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/60 shrink-0">{t.taskCode}</span>
                  )}
                  <p className="text-sm font-medium truncate leading-snug">{t.title}</p>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {t.client && (
                    <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.client}</span>
                  )}
                  {t.revisionCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-orange-500 shrink-0">
                      <MessageSquare className="h-2.5 w-2.5" />{t.revisionCount} alt.
                    </span>
                  )}
                </div>
              </div>

              {/* Priority */}
              <div className="w-24 shrink-0 hidden md:block">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${PRIORITY_CLS[t.priority] ?? ""}`}>
                  {PRIORITY_LABEL[t.priority] ?? t.priority}
                </span>
              </div>

              {/* Due date */}
              <div className="w-28 shrink-0 hidden lg:flex items-center gap-1">
                {t.dueDate ? (
                  <span className={`flex items-center gap-1 text-xs ${overdue ? "text-red-600 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                    {overdue && <AlertCircle className="h-3 w-3 shrink-0" />}
                    <Calendar className="h-3 w-3 shrink-0" />
                    {fmtDateHuman(t.dueDate)}
                  </span>
                ) : (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>
                )}
              </div>

              {/* Coordinator */}
              <div className="w-24 shrink-0 hidden lg:flex items-center gap-1.5">
                {t.createdBy ? (
                  <>
                    <AvatarDisplay
                      name={t.createdBy.name}
                      avatarUrl={t.createdBy.avatarUrl}
                      style={{ width: 20, height: 20, fontSize: 7, flexShrink: 0 }}
                    />
                    <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.createdBy.name.split(" ")[0]}</span>
                  </>
                ) : (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>
                )}
              </div>

              {/* Primary action */}
              <div className="w-36 shrink-0">
                {trans ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2.5 w-full"
                    onClick={() => updateStatus(t, trans.next)}
                  >
                    {trans.label}
                  </Button>
                ) : (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/40 pl-1">—</span>
                )}
              </div>

              {/* Dropdown */}
              <div className="w-8 shrink-0 flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openTask(t.id)}>
                      <Info className="h-3.5 w-3.5 mr-2" />Ver informações
                    </DropdownMenuItem>
                    {canReturn && (
                      <DropdownMenuItem onClick={() => setReturnTarget(t)}>
                        <Undo2 className="h-3.5 w-3.5 mr-2" />Devolver
                      </DropdownMenuItem>
                    )}
                    {canPause && (
                      <>
                        <DropdownMenuSeparator />
                        {t.status !== "paused" && (
                          <DropdownMenuItem
                            onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}
                            className="text-purple-700 focus:text-purple-700"
                          >
                            <PauseCircle className="h-3.5 w-3.5 mr-2" />Pausar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}
                          className="text-red-600 focus:text-red-600"
                        >
                          <XCircle className="h-3.5 w-3.5 mr-2" />Cancelar
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Devolver dialog */}
      <Dialog open={!!returnTarget} onOpenChange={v => { if (!v && !returning) setReturnTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Devolver tarefa</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja devolver <strong>"{returnTarget?.title}"</strong>?
            Ela voltará para pendente.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)} disabled={returning}>Cancelar</Button>
            <Button onClick={confirmReturn} disabled={returning}>
              {returning ? "Aguarde…" : "Devolver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pause / Cancel confirm dialog */}
      <Dialog open={!!confirmTask} onOpenChange={v => { if (!v && !confirming) setConfirmTask(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmTask?.action === "pause" ? "Pausar tarefa" : "Cancelar tarefa"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmTask?.action === "pause"
              ? <>Deseja pausar <strong>"{confirmTask.title}"</strong>?</>
              : <>Deseja cancelar <strong>"{confirmTask?.title}"</strong>? Esta ação não pode ser desfeita.</>
            }
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTask(null)} disabled={confirming}>Voltar</Button>
            <Button
              variant={confirmTask?.action === "cancel" ? "destructive" : "default"}
              onClick={executeConfirm}
              disabled={confirming}
            >
              {confirming ? "Aguarde…" : confirmTask?.action === "pause" ? "Pausar" : "Cancelar tarefa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

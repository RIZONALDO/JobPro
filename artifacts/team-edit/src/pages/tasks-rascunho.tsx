import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Archive, Plus, Send, MoreHorizontal, Trash2 } from "lucide-react";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { TaskFormModal } from "@/components/task-form-modal";
import { PrazoCell } from "@/components/prazo-cell";
import { fmtDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; login: string; avatarUrl?: string | null; }

interface OverviewTask {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  client: string | null;
  editors: Person[];
  assignee: Person | null;
  coordinator: Person | null;
  isOwn: boolean;
  updatedAt: string;
  taskType?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TasksRascunho() {
  const { user } = useAuth();
  const isSuper  = user?.role === "admin" || user?.role === "supervisor";
  const canCreate = isSuper || user?.role === "coordinator";

  const [tasks,   setTasks]   = useState<OverviewTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen,   setFormOpen]   = useState(false);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);

  const [publishTarget, setPublishTarget] = useState<OverviewTask | null>(null);
  const [publishing,    setPublishing]    = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<OverviewTask | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<OverviewTask[]>("/api/tasks/overview?status=rascunho")
      .then(setTasks)
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onTasksChanged: () => load(true) });

  const filtered = useMemo(() => tasks
    .filter(t => {
      if (t.status !== "rascunho") return false;
      if (t.taskType === "subtask")  return false;
      if (!isSuper && user?.role === "coordinator" && t.coordinator?.id !== user?.id) return false;
      return true;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  [tasks, isSuper, user]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/tasks/${deleteTarget.id}`);
      toast.success("Rascunho excluído");
      setDeleteTarget(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally { setDeleting(false); }
  };

  const doPublish = async () => {
    if (!publishTarget) return;
    setPublishing(true);
    try {
      await apiPut(`/api/tasks/${publishTarget.id}`, { status: "pending" });
      toast.success("Tarefa publicada com sucesso");
      setPublishTarget(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao publicar");
    } finally { setPublishing(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden p-2 sm:p-4 gap-2 sm:gap-4 bg-[hsl(var(--background))]">

      {/* Header */}
      <div className="flex items-center justify-between shrink-0 px-1">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {loading ? "Carregando…" : `${filtered.length} rascunho${filtered.length !== 1 ? "s" : ""}`}
        </p>
        {canCreate && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />Novo rascunho
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* Column headers — desktop */}
        <div className="hidden md:flex shrink-0 items-center px-4 py-2.5 bg-[hsl(var(--muted))]/30 border-b text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
          <div className="flex-1 pr-3">Tarefa</div>
          <div className="w-32 shrink-0">Editor</div>
          <div className="w-28 shrink-0 hidden lg:block">Prazo</div>
          <div className="w-20 shrink-0 hidden lg:block">Prior.</div>
          <div className="w-10 shrink-0" />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* Loading skeleton */}
          {loading ? (
            <div className="divide-y divide-[hsl(var(--muted))]">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center px-4 py-3 gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-48 rounded bg-[hsl(var(--muted))]/60 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  </div>
                  <div className="hidden md:flex items-center gap-3">
                    <div className="h-6 w-20 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                    <div className="h-6 w-16 rounded bg-[hsl(var(--muted))]/40 animate-pulse hidden lg:block" />
                    <div className="h-7 w-20 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>

          /* Empty state */
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <div className="h-16 w-16 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                <Archive className="h-8 w-8 text-[hsl(var(--muted-foreground))]/30" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Nenhum rascunho</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  Crie uma tarefa como rascunho para ela aparecer aqui.
                </p>
              </div>
              {canCreate && (
                <Button size="sm" variant="outline" className="gap-1.5 mt-1"
                  onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
                  <Plus className="h-3.5 w-3.5" />Criar rascunho
                </Button>
              )}
            </div>

          /* Rows */
          ) : (
            <div className="divide-y divide-[hsl(var(--muted))]">
              {filtered.map(t => {
                const openEdit  = () => { setEditTaskId(t.id); setFormOpen(true); };
                const openPub   = (e: React.MouseEvent) => { e.stopPropagation(); setPublishTarget(t); };
                const openDel   = (e: React.MouseEvent) => { e.stopPropagation(); setDeleteTarget(t); };

                const RowMenu = ({ stopProp }: { stopProp?: boolean }) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => stopProp && e.stopPropagation()}>
                      <button
                        className="h-7 w-7 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={openPub}>
                        <Send className="h-3.5 w-3.5 mr-2" />Publicar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={openDel} className="text-red-600 focus:text-red-600">
                        <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );

                return (
                  <div
                    key={t.id}
                    className="flex items-center px-4 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                    style={{ borderLeft: "3px dashed hsl(var(--border))" }}
                    onClick={openEdit}
                  >
                    {/* ── Mobile ───────────────────────────────────────── */}
                    <div className="md:hidden flex-1 py-3 min-w-0">
                      <div className="flex items-baseline gap-2 min-w-0">
                        {t.taskCode && (
                          <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">
                            {t.taskCode}
                          </span>
                        )}
                        <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-snug">{t.title}</span>
                      </div>
                      {t.client && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-0.5">{t.client}</p>
                      )}
                      {t.editors && t.editors.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <StackedAvatars people={t.editors} size={22} max={3} />
                          <span className="text-xs text-[hsl(var(--muted-foreground))]/70 truncate">
                            {t.editors.map(e => e.name.split(" ")[0]).join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <PriorityBadge priority={t.priority} />
                        {t.dueDate
                          ? <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={false} />
                          : <span className="text-[10px] text-[hsl(var(--muted-foreground))]/40 italic">sem prazo</span>
                        }
                      </div>
                      <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <RowMenu />
                      </div>
                    </div>

                    {/* ── Desktop ──────────────────────────────────────── */}
                    {/* Título + cliente */}
                    <div className="hidden md:flex flex-1 min-w-0 flex-col justify-center py-3 pr-3">
                      <div className="flex items-baseline gap-2 min-w-0">
                        {t.taskCode && (
                          <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">
                            {t.taskCode}
                          </span>
                        )}
                        <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
                      </div>
                      {t.client && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5">{t.client}</p>
                      )}
                    </div>

                    {/* Editor */}
                    <div className="hidden md:flex w-32 shrink-0 items-center gap-1.5">
                      {t.editors && t.editors.length > 0 ? (
                        <>
                          <StackedAvatars people={t.editors} size={26} max={2} />
                          {t.editors.length === 1 && (
                            <span className="text-[11px] font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]/35 italic">sem editor</span>
                      )}
                    </div>

                    {/* Prazo */}
                    <div className="hidden lg:flex w-28 shrink-0 items-center">
                      {t.dueDate
                        ? <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={false} />
                        : <span className="text-[11px] text-[hsl(var(--muted-foreground))]/35 italic">sem prazo</span>
                      }
                    </div>

                    {/* Prioridade */}
                    <div className="hidden lg:flex w-20 shrink-0 items-center">
                      <PriorityBadge priority={t.priority} />
                    </div>

                    {/* Menu ações */}
                    <div className="hidden md:flex w-10 shrink-0 items-center justify-end" onClick={e => e.stopPropagation()}>
                      <RowMenu />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Publicar confirm dialog ────────────────────────────────────── */}
      <Dialog open={!!publishTarget} onOpenChange={open => { if (!open && !publishing) setPublishTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Publicar tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Confirma a publicação de{" "}
              <span className="font-medium text-[hsl(var(--foreground))]">{publishTarget?.title}</span>?
            </p>
            <div className="rounded-xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden text-sm">
              {/* Editor */}
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1">Editor</p>
                {publishTarget?.editors && publishTarget.editors.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <StackedAvatars people={publishTarget.editors} size={22} max={3} />
                    <span className="font-medium truncate">
                      {publishTarget.editors.map(e => e.name.split(" ")[0]).join(", ")}
                    </span>
                  </div>
                ) : (
                  <span className="text-[hsl(var(--muted-foreground))]">Sem editor</span>
                )}
              </div>
              {/* Prazo */}
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1">Prazo</p>
                <span className={publishTarget?.dueDate ? "font-medium" : "text-[hsl(var(--muted-foreground))]"}>
                  {publishTarget?.dueDate ? fmtDate(publishTarget.dueDate) : "Sem prazo"}
                </span>
              </div>
              {/* Prioridade */}
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1">Prioridade</p>
                <PriorityBadge priority={publishTarget?.priority ?? "medium"} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishTarget(null)} disabled={publishing}>Cancelar</Button>
            <Button onClick={doPublish} disabled={publishing}>
              {publishing ? "Publicando…" : <><Send className="h-3.5 w-3.5 mr-1" />Publicar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excluir confirm dialog ────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir rascunho</DialogTitle>
          </DialogHeader>
          <div className="py-1">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Tem certeza que deseja excluir{" "}
              <span className="font-medium text-[hsl(var(--foreground))]">{deleteTarget?.title}</span>?{" "}
              Esta ação não pode ser desfeita.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={doDelete} disabled={deleting}>
              {deleting ? "Excluindo…" : <><Trash2 className="h-3.5 w-3.5 mr-1" />Excluir</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Form modal — sempre em modo rascunho (sem botão Publicar) */}
      <TaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => load(true)}
        editTaskId={editTaskId}
        hidePublish
      />
    </div>
  );
}

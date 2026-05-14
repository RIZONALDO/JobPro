import { motion } from "framer-motion";
import { staggerContainer, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtClosedCycle, fmtPrazoWeek } from "@/lib/utils";
import { PrazoCell } from "@/components/prazo-cell";
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
  AlertCircle, MessageSquare, MoreVertical,
  Info, Undo2, PauseCircle, XCircle, Search,
} from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChatAvatarButton } from "@/components/ui/chat-avatar-button";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";

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
  updatedAt: string;
}


const transitions: Record<string, { next: string; label: string; shortLabel: string }> = {
  pending:     { next: "in_progress", label: "Iniciar edição",         shortLabel: "Iniciar"  },
  in_progress: { next: "review",      label: "Enviar para aprovação",  shortLabel: "Enviar"   },
  in_revision: { next: "review",      label: "Enviar para aprovação",  shortLabel: "Enviar"   },
};

const TASK_GROUPS = [
  { key: "pending",  label: "Pendentes",    statuses: ["pending"],               color: "#64748b" },
  { key: "editing",  label: "Em edição",    statuses: ["in_progress"],           color: "#3b82f6" },
  { key: "revision",  label: "Em alteração", statuses: ["in_revision"],          color: "#f97316" },
  { key: "approval",  label: "Em aprovação", statuses: ["review"],               color: "#f59e0b" },
  { key: "paused",   label: "Pausadas",     statuses: ["paused"],                color: "#a855f7" },
  { key: "done",     label: "Concluídas",   statuses: ["completed"],             color: "#22c55e" },
  { key: "cancelled",label: "Canceladas",   statuses: ["cancelled"],             color: "#ef4444" },
];

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

  const urlSearch = useSearch();
  const [highlighted, setHighlighted] = useState<number | null>(() => {
    const v = new URLSearchParams(window.location.search).get("highlight");
    return v ? parseInt(v, 10) : null;
  });
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(urlSearch).get("highlight");
    if (v) setHighlighted(parseInt(v, 10));
  }, [urlSearch]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 3000);
    return () => clearTimeout(timer);
  }, [highlighted]);
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading]);

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
    // Optimistic: update status locally before waiting for server
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    try {
      await apiPut(`/api/tasks/${task.id}`, { status });
      load();
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    }
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
          <div className="h-4 w-24 rounded bg-[hsl(var(--muted))]/40 hidden md:block" />
          <div className="h-8 w-28 rounded bg-[hsl(var(--muted))]/40" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-3 h-9">
        <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tarefa ou cliente…"
          className="border-0 bg-transparent p-0 h-auto text-sm outline-none focus-visible:ring-0 shadow-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float flex flex-col md:max-h-[calc(100vh-160px)] overflow-hidden">

        {/* Header — desktop fixo */}
        <div className="hidden md:flex shrink-0 items-center py-2.5 pl-[3px] bg-[hsl(var(--muted))]/30 border-b text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
          <div className="flex-1 min-w-0 pl-4 pr-3">Tarefa</div>
          <div className="w-36 shrink-0 px-2">Status</div>
          <div className="w-28 shrink-0 hidden lg:block pl-6">Prioridade</div>
          <div className="w-28 shrink-0 hidden lg:block pl-6">Prazo</div>
          <div className="w-20 shrink-0 hidden xl:block pl-6">Coord.</div>
          <div className="w-28 shrink-0 pl-6">Ação</div>
          <div className="w-8 shrink-0" />
        </div>

        {/* Body scrollável */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa atribuída."}
            </p>
          </div>
        ) : (
          <>
            {TASK_GROUPS.map(group => {
              const groupTasks = filtered.filter(t => group.statuses.includes(t.status));
              if (!groupTasks.length) return null;
              return (
                <div key={group.key}>
                  <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 mt-4 bg-[hsl(var(--card))]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: group.color, opacity: 0.75 }}>{group.label}</span>
                    <span className="flex-1 border-t border-dashed" style={{ borderColor: `${group.color}30` }} />
                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: group.color, opacity: 0.5 }}>{groupTasks.length}</span>
                  </div>
                  {groupTasks.map(t => {
                    const overdue = isOverdue(t.dueDate) && !["completed", "cancelled", "paused"].includes(t.status);
                    const accent  = t.color ?? "#6366f1";
                    const trans   = transitions[t.status];
                    const canReturn = ["pending", "in_progress", "in_revision"].includes(t.status);
                    const canPause  = !["completed", "cancelled", "paused"].includes(t.status);
                    const isHighlighted = highlighted === t.id;

          const dropdownItems = (
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
          );

          return (
            <motion.div
              key={t.id}
              ref={isHighlighted ? highlightRef : null}
              variants={staggerRow}
              className="flex items-stretch border-b last:border-0 hover:bg-[hsl(var(--muted))]/20 transition-all cursor-pointer"
              style={{
                borderLeft: `3px solid ${accent}`,
                backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined,
                boxShadow: isHighlighted ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : undefined,
              }}
              onClick={() => openTask(t.id)}
            >

              {/* ── Mobile card (< md) ─────────────────────────────── */}
              <div className="md:hidden flex items-start py-3 px-4 w-full min-w-0" style={{ gap: "10px" }}>

                {/* Left: all info */}
                <div className="flex-1 min-w-0" style={{ minWidth: 0 }}>

                  {/* code + title */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: "5px", minWidth: 0 }}>
                    {t.taskCode && (
                      <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px", fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap", flexShrink: 0, opacity: 0.55, letterSpacing: "-0.02em" }}>
                        {t.taskCode}
                      </span>
                    )}
                    <span style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      {t.title}
                    </span>
                    {t.revisionCount > 0 && (
                      <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", opacity: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
                        ↩{t.revisionCount}
                      </span>
                    )}
                  </div>

                  {/* client */}
                  {t.client && (
                    <p style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                      {t.client}
                    </p>
                  )}

                  {/* status + priority + due date */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                    <Badge className={`text-xs px-1.5 py-0 h-5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                    <PriorityBadge priority={t.priority} />
                    {(() => {
                      const closed = fmtClosedCycle(t.status, t.dueDate, t.updatedAt);
                      if (closed) return (
                        <span style={{ fontSize: "11px", fontWeight: 600 }} className={closed.cls}>
                          {closed.line1}{closed.line2 ? ` · ${closed.line2}` : ""}
                        </span>
                      );
                      if (!t.dueDate) return null;
                      const { label } = fmtPrazoWeek(t.dueDate);
                      return (
                        <span style={{ fontSize: "11px", color: overdue ? "#ef4444" : "hsl(var(--muted-foreground))", fontWeight: overdue ? 600 : 400, display: "flex", alignItems: "center", gap: "3px" }}>
                          {overdue && <AlertCircle style={{ width: 10, height: 10 }} />}
                          {label}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Right: action + dropdown */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {trans && (
                    <Button size="sm" variant="outline" className="h-8 text-xs px-3 whitespace-nowrap"
                      onClick={e => { e.stopPropagation(); updateStatus(t, trans.next); }}>
                      {trans.shortLabel}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    {dropdownItems}
                  </DropdownMenu>
                </div>
              </div>

              {/* ── Desktop table (md+) ────────────────────────────── */}

              {/* Title + client + revision */}
              <div className="hidden md:flex flex-1 min-w-0 flex-col justify-center py-3 pl-4 pr-3">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  {t.taskCode && (
                    <span className="text-[11px] font-semibold font-mono shrink-0 text-[hsl(var(--muted-foreground))]/55 tracking-tight">{t.taskCode}</span>
                  )}
                  <p className="text-sm font-semibold truncate leading-snug">{t.title}</p>
                  {t.revisionCount > 0 && (
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 shrink-0">↩{t.revisionCount}</span>
                  )}
                </div>
                {t.client && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 truncate mt-0.5">{t.client}</span>
                )}
              </div>

              {/* Status */}
              <div className="hidden md:flex w-36 shrink-0 items-center px-2">
                <Badge className={`${STATUS_CLASS[t.status] ?? ""} text-[11px] px-2 py-0.5 font-medium whitespace-nowrap`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              </div>

              {/* Priority */}
              <div className="hidden lg:flex w-28 shrink-0 items-center pl-6">
                <PriorityBadge priority={t.priority} />
              </div>

              {/* Due date */}
              <div className="hidden lg:flex w-28 shrink-0 items-center pl-6">
                <PrazoCell dueDate={t.dueDate} status={t.status} updatedAt={t.updatedAt} overdue={overdue} />
              </div>

              {/* Coordinator */}
              <div className="hidden xl:flex w-20 shrink-0 items-center gap-1.5 pl-6">
                {t.createdBy ? (
                  <>
                    <ChatAvatarButton
                      userId={t.createdBy.id}
                      name={t.createdBy.name}
                      avatarUrl={t.createdBy.avatarUrl}
                      size={30}
                      taskId={t.id}
                      taskCode={t.taskCode}
                      taskTitle={t.title}
                    />
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.createdBy.name.split(" ")[0]}</span>
                  </>
                ) : (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">—</span>
                )}
              </div>

              {/* Primary action */}
              <div className="hidden md:flex w-28 shrink-0 items-center pl-6" onClick={e => e.stopPropagation()}>
                {trans ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs px-3 w-full"
                    onClick={() => updateStatus(t, trans.next)}>
                    {trans.shortLabel}
                  </Button>
                ) : (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30 pl-1">—</span>
                )}
              </div>

              {/* Dropdown */}
              <div className="hidden md:flex w-8 shrink-0 items-center justify-center" onClick={e => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  {dropdownItems}
                </DropdownMenu>
              </div>

            </motion.div>
          );
          })}
        </div>
      );
    })}
  </>
)}
        </div>{/* fim body scrollável */}
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

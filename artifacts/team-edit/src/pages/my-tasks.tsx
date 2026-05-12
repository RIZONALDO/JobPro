import { motion } from "framer-motion";
import { staggerContainer, staggerFade, staggerItem } from "@/lib/motion";
import React, { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ListTodo, MessageSquare, Calendar, AlertCircle, Undo2, MoreVertical, FolderOpen, Info, Copy, ExternalLink, ChevronRight, PauseCircle, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";

interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  complexity: string;
  folderUrl: string | null;
  revisionCount: number;
  revisions: Revision[];
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  assignedToId: number | null;
  assignedTo?: { id: number; name: string; avatarUrl?: string | null } | null;
  number?: number;
  client?: string | null;
  color?: string;
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
  { key: "pending",     label: "Pendente",     color: "#94a3b8" },
  { key: "in_progress", label: "Em edição",    color: "#3b82f6" },
  { key: "in_revision", label: "Em alteração", color: "#f97316" },
  { key: "review",      label: "Para aprovar", color: "#f59e0b" },
  { key: "completed",   label: "Aprovadas",    color: "#22c55e" },
  { key: "paused",      label: "Pausadas",     color: "#a855f7" },
  { key: "cancelled",   label: "Canceladas",   color: "#ef4444" },
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
  const [expandedRevisions, setExpandedRevisions] = useState<Set<number>>(new Set());
  const [revisionTarget, setRevisionTarget] = useState<Task | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
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

  const submitRevision = async () => {
    if (!revisionTarget || !revisionComment.trim()) return;
    setRevisionSubmitting(true);
    try {
      await apiPut(`/api/tasks/${revisionTarget.id}`, { status: "in_progress", revisionComment });
      setRevisionTarget(null);
      setRevisionComment("");
      load();
      toast({ title: "Alteração solicitada." });
    } catch { toast({ title: "Erro ao solicitar alteração", variant: "destructive" }); }
    finally { setRevisionSubmitting(false); }
  };

  const isEditor = user?.role === "editor";

  /* ── Kanban Card ─────────────────────────────────────────────── */
  const KanbanCard = ({ t, col }: { t: Task; col: typeof KANBAN_COLS[0] }) => {
    const overdue = isOverdue(t.dueDate) && !["completed","cancelled","paused"].includes(t.status);
    const person  = isEditor ? t.createdBy : (t.assignedTo ?? null);

    return (
      <div
        onClick={() => setInfoTarget(t)}
        style={{
          border: "1px solid hsl(var(--border))",
          borderRadius: 8,
          overflow: "hidden",
          cursor: "pointer",
          height: 112,
          display: "flex",
          flexDirection: "column",
          background: "hsl(var(--card))",
          transition: "box-shadow .12s",
          flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 14px ${col.color}30`; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
      >
        {/* Header — cor da coluna, só título */}
        <div style={{
          background: `${col.color}18`,
          borderBottom: `1px solid ${col.color}30`,
          padding: "7px 8px 7px 10px",
          display: "flex", alignItems: "center", gap: 4,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            {t.taskCode && (
              <span style={{ fontSize: 14, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: t.color, lineHeight: 1 }}>
                {t.taskCode}
              </span>
            )}
            <p style={{
              fontSize: 13, fontWeight: 600, lineHeight: 1.3, margin: 0,
              color: "hsl(var(--foreground))",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {t.title}
            </p>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
            {isEditor ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-5 w-5">
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setInfoTarget(t)}>
                    <Info className="h-3.5 w-3.5 mr-2" />Ver informações
                  </DropdownMenuItem>
                  {["pending","in_progress","in_revision"].includes(t.status) && (
                    <DropdownMenuItem onClick={() => setReturnTarget(t)}>
                      <Undo2 className="h-3.5 w-3.5 mr-2" />Devolver
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : !["completed","cancelled"].includes(t.status) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-5 w-5">
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {t.status === "review" && (
                    <>
                      <DropdownMenuItem onClick={e => { e.stopPropagation(); updateStatus(t, "completed"); }}
                        className="text-green-700 focus:text-green-700">
                        Aprovar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={e => { e.stopPropagation(); setRevisionTarget(t); setRevisionComment(""); }}
                        className="text-orange-600 focus:text-orange-600">
                        Pedir alteração
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {t.status !== "paused" && (
                    <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "pause" })}
                      className="text-purple-700 focus:text-purple-700">
                      <PauseCircle className="h-3.5 w-3.5 mr-2" />Pausar
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setConfirmTask({ id: t.id, title: t.title, action: "cancel" })}
                    className="text-red-600 focus:text-red-600">
                    <XCircle className="h-3.5 w-3.5 mr-2" />Cancelar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {/* Corpo — cliente */}
        <div style={{
          flex: 1, minHeight: 0,
          padding: "6px 10px",
          display: "flex", alignItems: "center",
          overflow: "hidden",
        }}>
          {(t as any).client ? (
            <p style={{
              fontSize: 13, color: "hsl(var(--muted-foreground))",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              margin: 0,
            }}>
              {(t as any).client}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", opacity: 0.35, margin: 0, fontStyle: "italic" }}>
              Sem cliente
            </p>
          )}
        </div>

        {/* Rodapé — prioridade · revisões · data · avatar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px",
          borderTop: "1px solid hsl(var(--border))",
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 700, padding: "1px 5px", borderRadius: 99, flexShrink: 0,
            background: t.priority === "high" ? "#fee2e2" : t.priority === "medium" ? "#fef9c3" : "#dcfce7",
            color:      t.priority === "high" ? "#dc2626" : t.priority === "medium" ? "#ca8a04" : "#16a34a",
          }}>
            {PRIORITY_LABEL[t.priority] ?? t.priority}
          </span>
          {t.revisionCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 13, color: "#ea580c", flexShrink: 0 }}>
              <MessageSquare className="h-2.5 w-2.5" />{t.revisionCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {t.dueDate && (
            <span style={{
              display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
              fontSize: 13, fontWeight: overdue ? 600 : 400,
              color: overdue ? "#dc2626" : "hsl(var(--muted-foreground))",
            }}>
              {overdue && <AlertCircle className="h-2.5 w-2.5" />}
              <Calendar className="h-2.5 w-2.5" />
              {fmtDateHuman(t.dueDate)}
            </span>
          )}
          {person && (
            <AvatarDisplay
              name={person.name}
              avatarUrl={person.avatarUrl}
              style={{
                width: 20, height: 20, fontSize: 7, flexShrink: 0,
                background: `${col.color}25`, color: col.color,
                border: `1.5px solid ${col.color}40`,
              }}
              title={person.name}
            />
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm p-4">Carregando...</div>;

  return (
    <div>

      {/* ── Board ─────────────────────────────────────────────────── */}
      <motion.div
        variants={staggerContainer} initial="initial" animate="animate"
        style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        gap: 8,
        alignItems: "start",
        paddingBottom: 16,
      }}>
        {KANBAN_COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          return (
            <motion.div
              key={col.key}
              variants={staggerFade}
              style={{
                borderRadius: 10,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              {/* Column header */}
              <div style={{
                padding: "10px 12px",
                display: "flex", alignItems: "center", gap: 8,
                borderBottom: `1px solid ${col.color}33`,
                borderRadius: "10px 10px 0 0",
                background: `${col.color}15`,
                flexShrink: 0,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", flex: 1 }}>
                  {col.label}
                </span>
                <span style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "hsl(var(--muted-foreground))" }}>
                  {colTasks.length}
                </span>
              </div>

              {/* Scrollable card list */}
              <div style={{
                overflowY: "auto",
                maxHeight: "60vh",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                {colTasks.length === 0 ? (
                  <div style={{
                    padding: "28px 12px", textAlign: "center",
                    fontSize: 13, color: "hsl(var(--muted-foreground))",
                    border: "1px dashed hsl(var(--border))",
                    borderRadius: 8,
                  }}>
                    Vazio
                  </div>
                ) : colTasks.map(t => <KanbanCard key={t.id} t={t} col={col} />)}
              </div>
            </motion.div>
          );
        })}
      </motion.div>

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
                <span className="text-xs uppercase tracking-widest text-muted-foreground/60 w-24 shrink-0 pt-px">{label}</span>
                <span className="flex-1 min-w-0">{children}</span>
              </div>
            );
            return (
              <div className="space-y-4 pt-1 text-sm">

                {/* Contexto */}
                <div className="flex items-start gap-8">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Projeto</p>
                    <p className="text-sm font-semibold truncate">{infoTarget.client ?? "—"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Job</p>
                    <p className="text-sm font-semibold truncate">{infoTarget.jobName ?? "—"}</p>
                  </div>
                </div>

                <hr className="border-dashed border-muted-foreground/20" />

                {/* Tarefa */}
                <div className="space-y-2">
                  <Row label="Tarefa">
                    <span className="font-semibold leading-snug">{infoTarget.title}</span>
                  </Row>
                  <Row label="Status">
                    <Badge className={`${STATUS_CLASS[infoTarget.status] ?? ""} text-xs px-1.5`}>
                      {STATUS_LABEL[infoTarget.status] ?? infoTarget.status}
                    </Badge>
                    {infoTarget.revisionCount > 0 && (
                      <span className="text-xs text-orange-500 font-medium ml-2">{infoTarget.revisionCount} alt.</span>
                    )}
                  </Row>
                  {(infoTarget.projectNumber && infoTarget.jobNumber && infoTarget.number) && (
                    <Row label="Código">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{infoTarget.number}
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
                      <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Descrição</p>
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

      {/* ── Revision dialog ───────────────────────────────────── */}
      <Dialog open={!!revisionTarget} onOpenChange={v => { if (!v && !revisionSubmitting) { setRevisionTarget(null); setRevisionComment(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Solicitar alteração</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {revisionTarget && (
              <p className="text-sm text-muted-foreground">
                Tarefa: <strong className="text-foreground">{revisionTarget.title}</strong>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rev-comment">Descreva a alteração</Label>
              <Textarea
                id="rev-comment"
                value={revisionComment}
                onChange={e => setRevisionComment(e.target.value)}
                placeholder="Descreva detalhadamente o que precisa ser alterado…"
                rows={5}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevisionTarget(null); setRevisionComment(""); }} disabled={revisionSubmitting}>
              Cancelar
            </Button>
            <Button onClick={submitRevision} disabled={!revisionComment.trim() || revisionSubmitting}>
              {revisionSubmitting ? "Enviando…" : "Solicitar alteração"}
            </Button>
          </DialogFooter>
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

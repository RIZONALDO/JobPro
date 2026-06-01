import { motion } from "framer-motion";
import { staggerContainer, staggerFade } from "@/lib/motion";
import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { fmtDateParts } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MessageSquare, Calendar, AlertCircle, Undo2, MoreVertical, Info, PauseCircle, XCircle, Clock, Play } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { StackedAvatars } from "@/components/ui/avatar-display";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";
import { ComplexityConfirmDialog, COMPLEXITY_MESSAGES } from "@/components/ui/complexity-confirm-dialog";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface Task {
  id: number;
  taskCode?: string;
  title: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  complexity: string;
  editorComplexitySet?: boolean;
  folderUrl: string | null;
  revisionCount: number;
  revisions: Revision[];
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
  assignedToId: number | null;
  assignedTo?: { id: number; name: string; avatarUrl?: string | null } | null;
  editors: Person[];
  number?: number;
  client?: string | null;
  color?: string;
  // multi-task
  taskType?: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}

// Pauta do dia — só status ativos (pausada não conta no peso, concluída/cancelada não exige ação)
const KANBAN_COLS = [
  { key: "pending",     label: "Pendente",     color: "#94a3b8" },
  { key: "in_progress", label: "Em edição",    color: "#3b82f6" },
  { key: "in_revision", label: "Em alteração", color: "#f97316" },
  { key: "review",      label: "Para aprovar", color: "#f59e0b" },
];

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

// Data local do dispositivo (não UTC) para evitar bug de fuso horário
function getLocalToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY_STR = getLocalToday();

const SCHEDULED_STATUSES = new Set(["pending", "in_progress", "paused"]);
function isScheduled(task: Task): boolean {
  if (!SCHEDULED_STATUSES.has(task.status)) return false;
  const ref = task.startDate ?? (task.status === "pending" ? task.dueDate : null);
  if (!ref) return false;
  return ref.split("T")[0] > TODAY_STR;
}

export default function MyTasks() {
  usePageTitle("Minhas Tarefas");
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRevisions, setExpandedRevisions] = useState<Set<number>>(new Set());
  const [revisionTarget, setRevisionTarget] = useState<Task | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [returnTarget, setReturnTarget] = useState<Task | null>(null);
  const [returning, setReturning] = useState(false);
  const [complexityTarget, setComplexityTarget] = useState<Task | null>(null);
  const [startingSaving,   setStartingSaving]   = useState(false);
  const [definingSaving,   setDefiningSaving]   = useState(false);
  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks")
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onTasksChanged: load });

  // Define complexidade sem iniciar (tarefa permanece pending)
  const saveComplexity = async (complexity: string, comment: string) => {
    if (!complexityTarget) return;
    setDefiningSaving(true);
    try {
      await apiPut(`/api/tasks/${complexityTarget.id}`, { complexity, startComment: comment });
      setComplexityTarget(null);
      load();
      toast.success("Complexidade definida");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar complexidade");
    } finally { setDefiningSaving(false); }
  };

  // Inicia diretamente (complexidade já foi definida)
  const handleIniciarDireto = async (task: Task) => {
    setStartingSaving(true);
    try {
      const startComment = COMPLEXITY_MESSAGES[task.complexity] ?? COMPLEXITY_MESSAGES.medium;
      await apiPut(`/api/tasks/${task.id}`, { status: "in_progress", startComment });
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar tarefa");
    } finally { setStartingSaving(false); }
  };

  const updateStatus = async (task: Task, status: string) => {
    try {
      await apiPut(`/api/tasks/${task.id}`, { status });
      load();
    } catch { toast.error("Erro ao atualizar status"); }
  };

  const confirmReturn = async () => {
    if (!returnTarget) return;
    setReturning(true);
    try {
      await apiPost(`/api/tasks/${returnTarget.id}/return`, {});
      setReturnTarget(null);
      load();
      toast.success("Tarefa devolvida.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao devolver");
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
      toast.success("Alteração solicitada.");
    } catch { toast.error("Erro ao solicitar alteração"); }
    finally { setRevisionSubmitting(false); }
  };

  const isEditor = user?.role === "editor";
  const { openTask } = useTaskModal();

  // Tabs: pauta do dia (kanban ativo) | agendadas (lista futura)
  const [activeTab, setActiveTab] = useState<"today" | "scheduled">("today");
  const scheduledTasks = tasks
    .filter(t => isScheduled(t))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  /* ── Kanban Card ─────────────────────────────────────────────── */
  const KanbanCard = ({ t, col }: { t: Task; col: typeof KANBAN_COLS[0] }) => {
    const overdue = isOverdue(t.dueDate) && !["completed","cancelled","paused"].includes(t.status);

    return (
      <div
        onClick={() => openTask(t.id)}
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
              <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "hsl(var(--primary) / 0.70)", lineHeight: 1 }}>
                {t.taskCode}
              </span>
            )}
            <p style={{
              fontSize: 11, fontWeight: 600, lineHeight: 1.3, margin: 0,
              color: "hsl(var(--foreground))",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {t.title}
            </p>
            {t.taskType === "subtask" && t.parentTask && (
              <ParentTaskBreadcrumb parentTask={t.parentTask} className="text-[9px]" />
            )}
            {t.taskType === "multi_task" && (
              <MultiTaskBadge taskType="multi_task" className="text-[9px] px-1 py-px" />
            )}
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
                  <DropdownMenuItem onClick={() => openTask(t.id)}>
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
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); updateStatus(t, "paused"); }}
                      className="text-purple-700 focus:text-purple-700">
                      <PauseCircle className="h-3.5 w-3.5 mr-2" />Pausar
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); updateStatus(t, "cancelled"); }}
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
          padding: "4px 10px",
          display: "flex", alignItems: "center",
          overflow: "hidden",
        }}>
          {(t as any).client ? (
            <p style={{
              fontSize: 10, color: "hsl(var(--muted-foreground))",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              margin: 0,
            }}>
              {(t as any).client}
            </p>
          ) : (
            <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", opacity: 0.35, margin: 0, fontStyle: "italic" }}>
              Sem cliente
            </p>
          )}
        </div>

        {/* Rodapé — prioridade · revisões · data · avatar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "4px 8px",
          borderTop: "1px solid hsl(var(--border))",
          flexShrink: 0, overflow: "hidden",
        }}>
          <PriorityBadge priority={t.priority} />
          {t.revisionCount > 0 && (
            <span style={{ fontSize: 9, fontWeight: 400, flexShrink: 0, padding: "2px 6px", borderRadius: 99, border: "1px solid #fde68a", background: "#fffbeb", color: "#d97706", lineHeight: 1, whiteSpace: "nowrap" }}>
              {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {/* Início (startDate) */}
          {isScheduled(t) && t.startDate && (() => {
            const parts = fmtDateParts(t.startDate);
            return parts ? (
              <span style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, color: "#0ea5e9" }} title="Início agendado">
                <Clock style={{ width: 8, height: 8, flexShrink: 0 }} />
                <span style={{ fontSize: 9, lineHeight: 1 }}>{parts.date}</span>
              </span>
            ) : null;
          })()}
          {t.dueDate && (() => {
            const parts = fmtDateParts(t.dueDate);
            return parts ? (
              <span style={{
                display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
                color: overdue ? "#dc2626" : "hsl(var(--muted-foreground))",
                fontWeight: overdue ? 600 : 400,
              }}>
                {overdue && <AlertCircle style={{ width: 8, height: 8, flexShrink: 0 }} />}
                <Calendar style={{ width: 8, height: 8, flexShrink: 0, marginTop: 1 }} />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, fontSize: 9 }}>
                  <span>{parts.date}</span>
                  {parts.time && <span>{parts.time}</span>}
                </span>
              </span>
            ) : null;
          })()}
          {t.createdBy && (
            <StackedAvatars people={[t.createdBy]} size={30} max={1} />
          )}
          {/* Botões pending: Definir complexidade → Iniciar */}
          {isEditor && t.status === "pending" && !t.editorComplexitySet && (
            <button
              onClick={e => { e.stopPropagation(); setComplexityTarget(t); }}
              style={{
                display: "flex", alignItems: "center", gap: 3,
                fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
                background: "hsl(var(--muted))", color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--border))", cursor: "pointer", flexShrink: 0,
              }}
            >
              Definir
            </button>
          )}
          {isEditor && t.status === "pending" && t.editorComplexitySet && (() => {
            const startAllowed = !t.startDate || t.startDate.split("T")[0] <= TODAY_STR;
            return startAllowed ? (
              <button
                onClick={e => { e.stopPropagation(); handleIniciarDireto(t); }}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
                  background: "hsl(var(--primary))", color: "white",
                  border: "none", cursor: "pointer", flexShrink: 0,
                }}
              >
                <Play style={{ width: 7, height: 7 }} />
                Iniciar
              </button>
            ) : (
              <span style={{
                fontSize: 9, fontWeight: 500, padding: "2px 7px", borderRadius: 99,
                background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                border: "1px solid hsl(var(--border))", flexShrink: 0,
              }}>
                Agendada
              </span>
            );
          })()}
        </div>
      </div>
    );
  };

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm p-4">Carregando...</div>;

  return (
    <div className="p-2 sm:p-4 flex flex-col gap-3">

      {/* ── Tabs (underline) ──────────────────────────────────── */}
      <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-xl rounded-b-none shadow-sm px-2">
        {([
          {
            key: "today" as const,
            label: "Pauta do dia",
            count: tasks.filter(t => !isScheduled(t) && ["pending","in_progress","in_revision","review"].includes(t.status)).length,
          },
          {
            key: "scheduled" as const,
            label: "Agendadas",
            count: scheduledTasks.length,
          },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {tab.label}
            <span className={`tabular-nums text-[10px] px-1.5 py-px rounded-full font-bold transition-colors ${
              activeTab === tab.key
                ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
                : "bg-[hsl(var(--muted))]/80 text-[hsl(var(--muted-foreground))]/60"
            }`}>
              {tab.count}
            </span>
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--primary))] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {activeTab === "today" ? (
        /* ── Board — Pauta do dia ──────────────────────────────── */
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
            const colTasks = col.key === "pending"
              ? tasks.filter(t => t.status === "pending" && !isScheduled(t))
              : tasks.filter(t => t.status === col.key);
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
                <div style={{
                  padding: "10px 12px",
                  display: "flex", alignItems: "center", gap: 8,
                  borderBottom: `1px solid ${col.color}33`,
                  borderRadius: "10px 10px 0 0",
                  background: `${col.color}15`,
                  flexShrink: 0,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", flex: 1 }}>{col.label}</span>
                  <span style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "hsl(var(--muted-foreground))" }}>{colTasks.length}</span>
                </div>
                <div style={{ overflowY: "auto", maxHeight: "60vh", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {colTasks.length === 0 ? (
                    <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))", border: "1px dashed hsl(var(--border))", borderRadius: 8 }}>
                      Vazio
                    </div>
                  ) : colTasks.map(t => <KanbanCard key={t.id} t={t} col={col} />)}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        /* ── Lista — Agendadas ─────────────────────────────────── */
        <div className="flex flex-col gap-2">
          {scheduledTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                <Calendar className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa agendada para o futuro.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
              {scheduledTasks.map((t, i) => {
                const startParts = t.startDate ? fmtDateParts(t.startDate) : null;
                const dueParts   = t.dueDate   ? fmtDateParts(t.dueDate)   : null;
                const sameDay    = startParts && dueParts && startParts.date === dueParts.date;
                const schedOverdue = isOverdue(t.dueDate);
                return (
                  <div
                    key={t.id}
                    onClick={() => openTask(t.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[hsl(var(--muted))]/30 transition-colors ${i > 0 ? "border-t border-[hsl(var(--border))]" : ""}`}
                  >
                    {/* Pill de período início → prazo */}
                    <div className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-xl bg-sky-50 border border-sky-200 dark:bg-sky-950/40 dark:border-sky-800">
                      {startParts ? (
                        <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 tabular-nums leading-none whitespace-nowrap">{startParts.date}</span>
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-sky-500 opacity-50" />
                      )}
                      {startParts && dueParts && !sameDay && (
                        <>
                          <span className="text-[10px] text-sky-400/50 leading-none">→</span>
                          <span className={`text-[11px] font-bold tabular-nums leading-none whitespace-nowrap ${schedOverdue ? "text-red-500" : "text-slate-600 dark:text-slate-300"}`}>{dueParts.date}</span>
                        </>
                      )}
                      {!startParts && dueParts && (
                        <span className={`text-[11px] font-bold tabular-nums leading-none whitespace-nowrap ${schedOverdue ? "text-red-500" : "text-sky-600 dark:text-sky-400"}`}>{dueParts.date}</span>
                      )}
                    </div>

                    {/* Título + cliente */}
                    <div className="flex-1 min-w-0">
                      {t.taskCode && (
                        <span className="text-[10px] font-mono font-bold text-[hsl(var(--primary))]/70 block leading-none mb-0.5">{t.taskCode}</span>
                      )}
                      <p className="text-sm font-semibold truncate leading-snug">{t.title}</p>
                      {t.client && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.client}</p>
                      )}
                    </div>

                    {/* Prioridade */}
                    <div className="shrink-0">
                      <PriorityBadge priority={t.priority} />
                    </div>

                    {/* Avatar do coordenador */}
                    {t.createdBy && <StackedAvatars people={[t.createdBy]} size={28} max={1} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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

      {complexityTarget && (
        <ComplexityConfirmDialog
          open={!!complexityTarget}
          task={complexityTarget}
          onSave={saveComplexity}
          onCancel={() => setComplexityTarget(null)}
          saving={definingSaving}
        />
      )}
    </div>
  );
}

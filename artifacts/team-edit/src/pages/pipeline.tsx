import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { usePageTitle } from "@/lib/use-page-title";
import { fmtDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Calendar, Tag, AlertTriangle } from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { AvatarDisplay } from "@/components/ui/avatar-display";

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
  { key: "pending",     label: "Pendente",      desc: "Aguardando início",     accent: "#94a3b8" },
  { key: "in_progress", label: "Em andamento",  desc: "Editor trabalhando",    accent: "#3b82f6" },
  { key: "review",      label: "Aprovação",     desc: "Aguardando aprovação",  accent: "#f59e0b" },
  { key: "in_revision", label: "Em alteração",  desc: "Pedido de alteração",   accent: "#f97316" },
];

const PRIORITY_CLS: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-red-100 text-red-700 border-red-200",
};
const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

export default function Pipeline() {
  usePageTitle("Pipeline");
  const { toast } = useToast();
  const { openTask } = useTaskModal();
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiFetch<PipelineTask[]>("/api/pipeline")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar pipeline", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  const today = new Date().toISOString().split("T")[0];
  const total = tasks.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-6 text-xs text-[hsl(var(--muted-foreground))]">
        <span>{total} {total === 1 ? "tarefa ativa" : "tarefas ativas"}</span>
        {COLUMNS.map(col => {
          const n = tasks.filter(t => t.status === col.key).length;
          return n > 0 ? (
            <span key={col.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.accent }} />
              {n} {col.label}
            </span>
          ) : null;
        })}
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="flex flex-col gap-3">
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
                    const isOverdue = t.dueDate && t.dueDate < today;
                    return (
                      <div
                        key={t.id}
                        onClick={() => openTask(t.id)}
                        className="rounded-lg border bg-[hsl(var(--card))] card-float px-2.5 py-2 flex flex-col gap-1.5 hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
                        style={{ borderLeft: `3px solid ${t.color}` }}
                      >
                        {/* Code + revision */}
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          {t.taskCode && (
                            <span className="text-[10px] font-bold font-mono shrink-0" style={{ color: t.color }}>{t.taskCode}</span>
                          )}
                          {t.revisionCount > 0 && (
                            <span className="text-[9px] font-bold text-orange-500 shrink-0 ml-auto">Alt.{t.revisionCount}</span>
                          )}
                        </div>

                        {/* Title */}
                        <p className="text-[11px] font-medium leading-snug line-clamp-2 break-words">{t.title}</p>

                        {/* Client */}
                        {t.client && (
                          <p className="text-[9px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5 overflow-hidden">
                            <Tag className="h-2 w-2 shrink-0" />
                            <span className="truncate">{t.client}</span>
                          </p>
                        )}

                        {/* Priority + due date + assignee — single row, no wrap */}
                        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 leading-4 shrink-0 ${PRIORITY_CLS[t.priority] ?? ""}`}>
                            {PRIORITY_LABEL[t.priority] ?? t.priority}
                          </Badge>
                          {t.dueDate && (
                            <span className={`flex items-center gap-0.5 text-[9px] shrink-0 ${isOverdue ? "text-red-500 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                              {isOverdue && <AlertTriangle className="h-2 w-2" />}
                              <Calendar className="h-2 w-2 shrink-0" />
                              <span className="truncate max-w-[60px]">{fmtDate(t.dueDate)}</span>
                            </span>
                          )}
                          {t.assignee && (
                            <div className="ml-auto flex items-center gap-1 min-w-0 shrink-0">
                              <AvatarDisplay name={t.assignee.name} avatarUrl={t.assignee.avatarUrl} size={18} />
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
  );
}

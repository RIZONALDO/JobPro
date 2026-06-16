import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from "@tanstack/react-table";
import React, { useMemo as reactUseMemo } from "react";
import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { apiFetch, apiDelete, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ClipboardList, MoreVertical,
  Pencil, Trash2, Plus, ChevronRight,
  Search, X, FileVideo, Clapperboard, AudioLines, RefreshCw, UserPlus, CalendarDays,
} from "lucide-react";
import { TaskFilesViewModal } from "@/components/TaskFilesViewModal";
import { AvatarDisplay, StackedAvatars } from "@/components/ui/avatar-display";
import { TaskFormModal } from "@/components/task-form-modal";
import { ReassignEditorModal } from "@/components/reassign-editor-modal";
import { EditorAvailabilityModal } from "@/components/editor-availability-modal";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { useSearch } from "wouter";

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
  startDate: string | null;
  dueDate: string | null;
  client: string | null;
  revisionCount: number;
  assignee: Person | null;
  editors: Person[];
  coordinator: Person | null;
  isOwn: boolean;
  updatedAt: string;
  fileCount?: number;
  fileKind?: "video" | "audio" | "mixed" | "other" | null;
  taskType?: string;
  subtaskProgress?: { total: number; completed: number; percentage: number };
}

interface SubtaskDetail {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  subtaskOrder: number;
  assignedTo: { id: number; name: string; avatarUrl?: string | null } | null;
  editors: { id: number; name: string; avatarUrl?: string | null }[];
  dueDate: string | null;
  revisionCount: number;
  folderUrl: string | null;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

// ─── Calendar List ────────────────────────────────────────────────────────────

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DAYS_PT   = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function CalendarList({ tasks, onEdit, onDelete }: { tasks: OverviewTask[]; onEdit: (id: number) => void; onDelete: (id: number, title: string) => void }) {
  const grouped = useMemo(() => {
    const byMonth = new Map<string, Map<string, OverviewTask[]>>();
    [...tasks]
      .sort((a, b) => (a.startDate ?? a.dueDate ?? "").localeCompare(b.startDate ?? b.dueDate ?? ""))
      .forEach(t => {
        const dateStr = (t.startDate ?? t.dueDate ?? "").split("T")[0];
        if (!dateStr) return;
        const [y, m] = dateStr.split("-");
        const monthKey = `${y}-${m}`;
        if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
        const byDay = byMonth.get(monthKey)!;
        if (!byDay.has(dateStr)) byDay.set(dateStr, []);
        byDay.get(dateStr)!.push(t);
      });
    return byMonth;
  }, [tasks]);

  return (
    <div className="px-4 py-4 space-y-6">
      {[...grouped.entries()].map(([monthKey, byDay]) => {
        const [y, m] = monthKey.split("-");
        const monthLabel = `${MONTHS_PT[parseInt(m) - 1]} ${y}`;
        return (
          <div key={monthKey}>
            {/* Month header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">{monthLabel}</span>
              <div className="flex-1 h-px bg-[hsl(var(--border))]/50" />
            </div>

            <div className="space-y-1">
              {[...byDay.entries()].map(([dateStr, dayTasks]) => {
                const d = new Date(dateStr + "T12:00:00");
                const dayNum  = String(d.getDate()).padStart(2, "0");
                const dayName = DAYS_PT[d.getDay()];
                return (
                  <div key={dateStr} className="flex gap-4 group border-t border-[hsl(var(--border))]/30 pt-3 first:border-0 first:pt-0">
                    {/* Day label */}
                    <div className="w-14 shrink-0 flex flex-col items-center pt-2.5">
                      <span className="text-2xl font-black leading-none tabular-nums text-[hsl(var(--foreground))]">{dayNum}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mt-0.5">{dayName}</span>
                    </div>

                    {/* Tasks */}
                    <div className="flex-1 min-w-0 space-y-1 py-1">
                      {dayTasks.map(t => (
                        <div key={t.id}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group/row"
                        >
                          <div className="w-1 h-8 rounded-full shrink-0 bg-[hsl(var(--primary))]/30" />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(t.id)}>
                            <div className="flex items-center gap-2">
                              {t.taskCode && <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]/50 shrink-0">{t.taskCode}</span>}
                              <span className="text-sm font-semibold truncate">{t.title}</span>
                            </div>
                            {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/50 truncate mt-0.5">{t.client}</p>}
                          </div>
                          {t.dueDate && (
                            <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/50 shrink-0">
                              até {fmtDate(t.dueDate)}
                            </span>
                          )}
                          {t.editors && t.editors.length > 0 && (
                            <div className="flex items-center shrink-0">
                              {t.editors.slice(0, 3).map((e, i) => (
                                <div key={e.id} style={{ marginLeft: i > 0 ? -6 : 0 }}>
                                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={22} />
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); onDelete(t.id, t.title); }}
                            className="opacity-0 group-hover/row:opacity-100 h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TasksOverview() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const { openTask } = useTaskModal();

  const isSuper  = user?.role === "admin" || user?.role === "supervisor";
  const canCreate = isSuper || user?.role === "coordinator";

  const [tasks,   setTasks]   = useState<OverviewTask[]>([]);
  const [loading, setLoading] = useState(true);

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
    const t = setTimeout(() => setHighlighted(null), 3000);
    return () => clearTimeout(t);
  }, [highlighted]);
  useEffect(() => {
    if (highlightRef.current)
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading]);

  // Filters
  const [search,       setSearch]       = useState("");
  const [filterEditor, setFilterEditor] = useState("all");
  const defaultCoord = (!isSuper && user?.role === "coordinator") ? String(user?.id ?? "all") : "all";
  const [filterCoord,  setFilterCoord]  = useState(defaultCoord);

  // Tabs
  const [viewTab, setViewTab] = useState<"today" | "scheduled" | "all">("today");

  // Sort
  const [tanSorting, setTanSorting] = useState<SortingState>([]);

  // Dialogs
  const [filesViewTarget, setFilesViewTarget] = useState<OverviewTask | null>(null);
  const [formOpen,    setFormOpen]    = useState(false);
  const [editTaskId,  setEditTaskId]  = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [reassignTarget, setReassignTarget] = useState<{ taskId: number; taskTitle: string; assignedTo: Person | null; mode: "reassign" | "add" } | null>(null);
  const [availEditor, setAvailEditor] = useState<{ id: number; name: string; avatarUrl?: string | null } | null>(null);

  // Multi-task expansion
  const [expandedIds,     setExpandedIds]     = useState<Set<number>>(new Set());
  const [subtasksMap,     setSubtasksMap]     = useState<Map<number, SubtaskDetail[]>>(new Map());
  const [loadingSubtasks, setLoadingSubtasks] = useState<Set<number>>(new Set());
  const expandedIdsRef = useRef<Set<number>>(expandedIds);
  useEffect(() => { expandedIdsRef.current = expandedIds; }, [expandedIds]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<OverviewTask[]>("/api/tasks/overview?status=all")
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtime({
    onTasksChanged: () => load(true),
    onSubtaskChanged: () => {
      expandedIdsRef.current.forEach(parentId => {
        apiFetch<SubtaskDetail[]>(`/api/tasks/${parentId}/subtasks`)
          .then(subs => setSubtasksMap(p => new Map(p).set(parentId, subs)))
          .catch(() => {});
      });
    },
  });

  const toggleExpand = (taskId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
        if (!subtasksMap.has(taskId)) {
          setLoadingSubtasks(p => new Set(p).add(taskId));
          apiFetch<SubtaskDetail[]>(`/api/tasks/${taskId}/subtasks`)
            .then(subs => setSubtasksMap(p => new Map(p).set(taskId, subs)))
            .catch(() => toast.error("Erro ao carregar subtarefas"))
            .finally(() => setLoadingSubtasks(p => { const n = new Set(p); n.delete(taskId); return n; }));
        }
      }
      return next;
    });
  };

  const deleteTask = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/tasks/${deleteTarget.id}`);
      toast.success("Tarefa excluída");
      setDeleteTarget(null);
      load(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally { setDeleting(false); }
  };

  // ── People lists for filters ──────────────────────────────────────────────
  const editors = useMemo(() => {
    const map = new Map<number, Person>();
    tasks.forEach(t => {
      if (t.assignee) map.set(t.assignee.id, t.assignee);
      t.editors.forEach(e => map.set(e.id, e));
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const coordinators = useMemo(() => {
    const map = new Map<number, Person>();
    tasks.forEach(t => { if (t.coordinator) map.set(t.coordinator.id, t.coordinator); });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // ── Tab helpers ───────────────────────────────────────────────────────────
  const TODAY_STR = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const isScheduled = (t: OverviewTask) =>
    !!(t.startDate && t.startDate.split("T")[0] > TODAY_STR);

  // ── Client-side filters ───────────────────────────────────────────────────
  const filtered = useMemo(() => tasks.filter(t => {
    if (t.status === "rascunho") return false;
    if (filterEditor !== "all" && String(t.assignee?.id ?? "") !== filterEditor &&
        !t.editors.some(e => String(e.id) === filterEditor)) return false;
    if (filterCoord  !== "all" && String(t.coordinator?.id ?? "") !== filterCoord) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.client ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [tasks, filterEditor, filterCoord, search]);

  const hasFilter = search || filterEditor !== "all" || filterCoord !== defaultCoord;
  const clearFilters = () => { setSearch(""); setFilterEditor("all"); setFilterCoord(defaultCoord); };

  const tabFiltered = useMemo(() => {
    if (viewTab === "today")     return filtered.filter(t => !isScheduled(t) && t.status !== "completed");
    if (viewTab === "scheduled") return filtered.filter(t => isScheduled(t));
    if (viewTab === "all")       return filtered.filter(t => t.status === "completed");
    return filtered;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, viewTab]);

  // ── TanStack Table ────────────────────────────────────────────────────────
  const columns = reactUseMemo<ColumnDef<OverviewTask, unknown>[]>(() => ([
    {
      id: "tarefa",
      accessorKey: "title",
      header: "Tarefa",
      cell: ({ row }) => {
        const t = row.original;
        const isExpanded = expandedIds.has(t.id);
        const subPct = t.subtaskProgress
          ? (t.subtaskProgress.percentage ?? (t.subtaskProgress.total > 0 ? Math.round((t.subtaskProgress.completed / t.subtaskProgress.total) * 100) : 0))
          : 0;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {t.taskType === "multi_task" && (
                <button className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
                  onClick={e => { e.stopPropagation(); toggleExpand(t.id); }}>
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                </button>
              )}
              {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
              <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
              <MultiTaskBadge taskType={t.taskType ?? "task"} />
              {t.revisionCount > 0 && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">
                  {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
                </span>
              )}
            </div>
            {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5">{t.client}</p>}
            {t.taskType === "multi_task" && t.subtaskProgress && t.subtaskProgress.total > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]/70">{t.subtaskProgress.completed}/{t.subtaskProgress.total}</span>
                <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${subPct === 100 ? "bg-green-500" : subPct >= 66 ? "bg-blue-500" : subPct >= 33 ? "bg-indigo-400" : "bg-slate-400"}`} style={{ width: `${subPct}%` }} />
                </div>
              </div>
            )}
            {(t.fileCount ?? 0) > 0 && (
              <button
                title={`Ver mídia · ${t.fileCount} arquivo${t.fileCount !== 1 ? "s" : ""}`}
                onClick={e => { e.stopPropagation(); setFilesViewTarget(t); }}
                className={`inline-flex items-center gap-1 mt-1 w-fit px-1.5 py-[3px] rounded-[4px] text-[10px] font-medium transition-colors
                  ${t.fileKind === "audio"
                    ? "bg-sky-500/8 text-sky-600 dark:text-sky-400 hover:bg-sky-500/15"
                    : "bg-violet-500/8 text-violet-600 dark:text-violet-400 hover:bg-violet-500/15"}`}
              >
                {t.fileKind === "audio" ? <AudioLines className="h-3 w-3" /> : t.fileKind === "mixed" ? <><Clapperboard className="h-3 w-3" /><AudioLines className="h-3 w-3 opacity-70" /></> : <Clapperboard className="h-3 w-3" />}
                <span>{t.fileCount} {t.fileKind === "audio" ? "áudio" : t.fileKind === "mixed" ? "arquivos" : t.fileCount === 1 ? "vídeo" : "vídeos"}</span>
              </button>
            )}
          </div>
        );
      },
    },
    {
      id: "entrega",
      header: "Entrega",
      size: 96,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/70">
          {fmtDate(row.original.dueDate)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 148,
      cell: ({ row }) => {
        const t = row.original;
        const canActNow = t.isOwn || isSuper;

        // Agendadas — sem status
        if (viewTab === "scheduled") return null;

        // Concluídas — chip read-only
        if (viewTab === "all") {
          return <span className="inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50">Aprovada</span>;
        }

        // Tarefas do dia — dropdown com estado atual + opções
        const STATUS_LABEL_MAP: Record<string, string> = {
          pending:     "Na fila",
          in_progress: "Em edição",
          captacao:    "Falta captação",
          in_revision: "Em alteração",
          review:      "Em aprovação",
          completed:   "Aprovada",
          paused:      "Pausada",
          cancelled:   "Cancelada",
        };
        const currentLabel = STATUS_LABEL_MAP[t.status] ?? "Na fila";
        const STATUS_COLOR_MAP: Record<string, string> = {
          pending:     "text-slate-400/80 dark:text-slate-500/80",
          in_progress: "text-blue-500/70 dark:text-blue-400/70",
          captacao:    "text-[hsl(var(--primary))]/70",
          in_revision: "text-orange-500/70 dark:text-orange-400/70",
          review:      "text-amber-500/70 dark:text-amber-400/70",
          completed:   "text-emerald-600/70 dark:text-emerald-400/70",
          paused:      "text-violet-500/70 dark:text-violet-400/70",
          cancelled:   "text-red-400/70 dark:text-red-400/70",
        };
        if (!canActNow) {
          return <span className={`text-xs font-medium ${STATUS_COLOR_MAP[t.status] ?? "text-[hsl(var(--muted-foreground))]/60"}`}>{currentLabel}</span>;
        }
        return (
          <div onClick={e => e.stopPropagation()}>
            <Select
              value={t.status}
              onValueChange={async val => {
                try {
                  const body: Record<string, string> = { status: val };
                  if (val === "paused")    body.revisionComment = "Pausada pelo coordenador";
                  if (val === "cancelled") body.revisionComment = "Cancelada pelo coordenador";
                  await apiPut(`/api/tasks/${t.id}`, body);
                  load(true);
                } catch { toast.error("Erro ao atualizar"); }
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[136px] border-dashed">
                <SelectValue placeholder="Na fila" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending"><span className="text-slate-400/80 dark:text-slate-500/80">Na fila</span></SelectItem>
                <SelectItem value="in_progress"><span className="text-blue-500/70 dark:text-blue-400/70">Em edição</span></SelectItem>
                <SelectItem value="captacao"><span className="text-[hsl(var(--primary))]/70">Falta captação</span></SelectItem>
                <SelectItem value="in_revision"><span className="text-orange-500/70 dark:text-orange-400/70">Em alteração</span></SelectItem>
                <SelectItem value="review"><span className="text-amber-500/70 dark:text-amber-400/70">Em aprovação</span></SelectItem>
                <SelectItem value="completed"><span className="text-emerald-600/70 dark:text-emerald-400/70">Aprovada</span></SelectItem>
                <SelectItem value="paused"><span className="text-violet-500/70 dark:text-violet-400/70">Pausada</span></SelectItem>
                <SelectItem value="cancelled"><span className="text-red-400/70 dark:text-red-400/70">Cancelada</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      },
    },
    {
      id: "editor",
      header: "Editor",
      size: 128,
      cell: ({ row }) => {
        const t = row.original;
        if (!t.editors || t.editors.length === 0)
          return <span className="text-xs text-[hsl(var(--muted-foreground))]/30">{t.taskType === "multi_task" ? "—" : "sem editor"}</span>;
        return (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center">
              {t.editors.slice(0, 4).map((e, i) => (
                <div key={e.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: t.editors.length - i }}
                  onClick={() => setAvailEditor({ id: e.id, name: e.name, avatarUrl: e.avatarUrl })}>
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={26} className="cursor-pointer" />
                </div>
              ))}
              {t.editors.length > 4 && (
                <div style={{ marginLeft: -8 }} className="h-[26px] w-[26px] rounded-full bg-[hsl(var(--muted))] border-2 border-[hsl(var(--background))] flex items-center justify-center text-[10px] font-bold text-[hsl(var(--muted-foreground))]">+{t.editors.length - 4}</div>
              )}
            </div>
            {t.editors.length === 1 && <span className="text-[11px] font-medium truncate">{t.editors[0].name.split(" ")[0]}</span>}
          </div>
        );
      },
    },
    {
      id: "coordenador",
      header: "Atendimento",
      size: 96,
      meta: { className: "hidden xl:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        if (t.isOwn) return <span className="text-[11px] text-[hsl(var(--muted-foreground))]/55 font-semibold">Você</span>;
        if (!t.coordinator) return <span className="text-[11px] text-[hsl(var(--muted-foreground))]/30">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            <AvatarDisplay name={t.coordinator.name} avatarUrl={t.coordinator.avatarUrl} size={28} />
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.coordinator.name.split(" ")[0]}</span>
          </div>
        );
      },
    },
    {
      id: "acoes",
      header: "",
      size: 48,
      cell: ({ row }) => {
        const t = row.original;
        const canActNow = t.isOwn || isSuper;
        return (
          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" />Editar tarefa
                </DropdownMenuItem>
                {canActNow && (
                  <>
                    <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" })}>
                      <RefreshCw className="h-3.5 w-3.5" />Reatribuir editor
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "add" })}>
                      <UserPlus className="h-3.5 w-3.5" />Adicionar editor
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setDeleteTarget({ id: t.id, title: t.title })} className="text-red-600 focus:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />Excluir tarefa
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ] as ColumnDef<OverviewTask, unknown>[]).filter(col => {
    if (viewTab === "scheduled" && (col as { id?: string }).id === "status") return false;
    return true;
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [expandedIds, isSuper, viewTab]);

  const table = useReactTable({
    data: tabFiltered,
    columns,
    state: { sorting: tanSorting },
    onSortingChange: setTanSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden p-2 sm:p-4 gap-2 sm:gap-4 bg-[hsl(var(--background))]">

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tarefa…" className="pl-8 h-8 text-sm bg-[hsl(var(--background))]" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Select value={filterEditor} onValueChange={setFilterEditor}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Todos os editores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os editores</SelectItem>
            {editors.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCoord} onValueChange={setFilterCoord}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Geral</SelectItem>
            {user && <SelectItem value={String(user.id)}>Minhas</SelectItem>}
            {coordinators.filter(c => c.id !== user?.id).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilter && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded-md px-2.5 h-8 transition-colors">
            <X className="h-3 w-3" />Limpar
          </button>
        )}
        {canCreate && (
          <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={() => { setEditTaskId(null); setFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />Nova tarefa
          </Button>
        )}
        <span className={`text-xs text-[hsl(var(--muted-foreground))] shrink-0 ${!canCreate ? "ml-auto" : ""}`}>
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 gap-2">
          {([
            { key: "today"     as const, label: "Tarefas do dia", count: filtered.filter(t => !isScheduled(t) && t.status !== "completed").length, badgeCls: "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]" },
            { key: "scheduled" as const, label: "Agendadas",      count: filtered.filter(t => isScheduled(t)).length,                             badgeCls: "bg-blue-500/15 text-blue-500", icon: true },
            { key: "all"       as const, label: "Concluídas",     count: filtered.filter(t => t.status === "completed").length,                   badgeCls: "bg-emerald-500/15 text-emerald-500" },
          ]).map((tab, i) => (
            <>
              {i > 0 && <span key={`sep-${i}`} className="self-center h-4 w-px bg-[hsl(var(--border))] shrink-0" />}
              <button
                key={tab.key}
                onClick={() => setViewTab(tab.key)}
                className={`relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${
                  viewTab === tab.key ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                }`}
              >
                {tab.label}
                {"icon" in tab && tab.icon
                  ? <CalendarDays className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                  : <span className={`tabular-nums text-[10px] px-1.5 py-px rounded-full font-bold transition-colors ${tab.badgeCls}`}>{tab.count}</span>
                }
                {viewTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--primary))] rounded-full" />}
              </button>
            </>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pt-3">

          {loading ? (
            <div className="divide-y divide-[hsl(var(--muted))]">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center px-4 py-3 gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-48 rounded bg-[hsl(var(--muted))]/60 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  </div>
                  <div className="hidden md:flex items-center gap-3">
                    <div className="h-6 w-16 rounded bg-[hsl(var(--muted))]/40 animate-pulse hidden lg:block" />
                    <div className="h-6 w-16 rounded bg-[hsl(var(--muted))]/40 animate-pulse hidden lg:block" />
                    <div className="h-6 w-20 rounded bg-[hsl(var(--muted))]/40 animate-pulse" />
                  </div>
                  <div className="h-7 w-7 rounded bg-[hsl(var(--muted))]/40 animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                <ClipboardList className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {hasFilter ? "Nenhuma tarefa corresponde aos filtros." : "Nenhuma tarefa encontrada."}
              </p>
              {hasFilter && <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>}
            </div>
          ) : viewTab === "scheduled" ? (
            /* ── Calendar list (Agendadas) ────────────────────────── */
            <CalendarList tasks={tabFiltered} onEdit={(id) => { setEditTaskId(id); setFormOpen(true); }} onDelete={(id, title) => setDeleteTarget({ id, title })} />
          ) : (
            <>
              {/* ── Mobile (< md) ─────────────────────────────────── */}
              <div className="md:hidden divide-y divide-[hsl(var(--muted))]">
                {filtered.map(t => {
                  const isHighlighted = highlighted === t.id;
                  const isExpanded    = expandedIds.has(t.id);
                  const subList       = subtasksMap.get(t.id) ?? [];
                  const isLoadingSubs = loadingSubtasks.has(t.id);
                  return (
                    <Fragment key={t.id}>
                      <div
                        ref={isHighlighted ? highlightRef : null}
                        className="flex items-start px-4 py-4 gap-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                        style={{ backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined }}
                        onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 min-w-0">
                            {t.taskType === "multi_task" && (
                              <button className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
                                onClick={e => { e.stopPropagation(); toggleExpand(t.id); }}>
                                <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                              </button>
                            )}
                            {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
                            <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-snug">{t.title}</span>
                            {t.revisionCount > 0 && (
                              <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap leading-none">
                                {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
                              </span>
                            )}
                          </div>
                          {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-1">{t.client}</p>}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {viewTab === "all" && (
                              <span className="inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50">Aprovada</span>
                            )}
                            <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/60">{fmtDate(t.dueDate)}</span>
                          </div>
                          {t.editors && t.editors.length > 0 && (
                            <div className="flex items-center gap-2 mt-2">
                              <StackedAvatars people={t.editors} size={24} max={3} />
                              <span className="text-xs text-[hsl(var(--muted-foreground))]/70 truncate">
                                {t.editors.map(e => e.name.split(" ")[0]).join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5" />Editar
                              </DropdownMenuItem>
                              {(t.isOwn || isSuper) && (
                                <>
                                  <DropdownMenuItem onClick={() => setReassignTarget({ taskId: t.id, taskTitle: t.title, assignedTo: t.assignee, mode: "reassign" })}>
                                    <RefreshCw className="h-3.5 w-3.5" />Reatribuir
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget({ id: t.id, title: t.title })}>
                                    <Trash2 className="h-3.5 w-3.5" />Excluir
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Subtask rows (mobile) */}
                      {isExpanded && (
                        <div className="pl-6 border-l-2 border-[hsl(var(--primary))]/20 ml-4">
                          {isLoadingSubs ? (
                            <div className="py-3 px-4 text-xs text-[hsl(var(--muted-foreground))]">Carregando…</div>
                          ) : subList.map(s => (
                            <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/20 cursor-pointer border-b border-[hsl(var(--muted))]"
                              onClick={() => openTask(s.id)}>
                              <div className="flex-1 min-w-0">
                                {s.taskCode && <span className="font-mono text-xs text-[hsl(var(--primary))]/70 mr-1.5">{s.taskCode}</span>}
                                <span className="text-sm font-medium">{s.title}</span>
                              </div>
                              <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/60 shrink-0">{fmtDate(s.dueDate)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>

              {/* ── Desktop (md+) ─────────────────────────────────── */}
              <table className="hidden md:table w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                  {table.getHeaderGroups().map(hg => (
                    <tr key={hg.id}>
                      {hg.headers.map(h => (
                        <th
                          key={h.id}
                          className={`px-4 py-2.5 text-left text-[11px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide whitespace-nowrap ${(h.column.columnDef.meta as { className?: string } | undefined)?.className ?? ""}`}
                          style={{ width: h.column.getSize() !== 150 ? h.column.getSize() : undefined }}
                        >
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-[hsl(var(--muted))]">
                  {table.getRowModel().rows.map(row => {
                    const t = row.original;
                    const isHighlighted = highlighted === t.id;
                    const isExpanded    = expandedIds.has(t.id);
                    const subList       = subtasksMap.get(t.id) ?? [];
                    const isLoadingSubs = loadingSubtasks.has(t.id);
                    return (
                      <Fragment key={t.id}>
                        <tr
                          ref={isHighlighted ? (el => { if (el) highlightRef.current = el as unknown as HTMLDivElement; }) : undefined}
                          className="hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer group"
                          style={{ backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined }}
                          onClick={() => { setEditTaskId(t.id); setFormOpen(true); }}
                        >
                          {row.getVisibleCells().map(cell => (
                            <td
                              key={cell.id}
                              className={`px-4 py-3 align-middle ${(cell.column.columnDef.meta as { className?: string } | undefined)?.className ?? ""}`}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                        {/* Subtask rows (desktop) */}
                        {isExpanded && (
                          isLoadingSubs ? (
                            <tr><td colSpan={columns.length} className="px-8 py-3 text-xs text-[hsl(var(--muted-foreground))]">Carregando…</td></tr>
                          ) : subList.map(s => (
                            <tr key={s.id} className="hover:bg-[hsl(var(--muted))]/10 cursor-pointer bg-[hsl(var(--muted))]/5 border-l-2 border-[hsl(var(--primary))]/20"
                              onClick={() => openTask(s.id)}>
                              <td className="pl-10 pr-4 py-2.5 align-middle">
                                <div className="flex items-center gap-2">
                                  {s.taskCode && <span className="font-mono text-xs text-[hsl(var(--primary))]/70">{s.taskCode}</span>}
                                  <span className="text-sm font-medium">{s.title}</span>
                                  {s.revisionCount > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 border border-amber-200 dark:border-amber-800/40">
                                      {s.revisionCount} alt.
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 align-middle hidden lg:table-cell">
                                <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/60">{fmtDate(s.dueDate)}</span>
                              </td>
                              <td className="px-4 py-2.5 align-middle">
                                {s.assignedTo && (
                                  <div className="flex items-center gap-1.5">
                                    <AvatarDisplay name={s.assignedTo.name} avatarUrl={s.assignedTo.avatarUrl} size={22} />
                                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70">{s.assignedTo.name.split(" ")[0]}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 align-middle hidden xl:table-cell" />
                              <td className="px-4 py-2.5 align-middle" />
                            </tr>
                          ))
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* ── Modals & Dialogs ───────────────────────────────────────────── */}
      {formOpen && (
        <TaskFormModal
          open={formOpen}
          onOpenChange={v => { if (!v) { setFormOpen(false); setEditTaskId(null); } }}
          editTaskId={editTaskId}
          onSaved={() => { setFormOpen(false); setEditTaskId(null); load(true); }}
        />
      )}

      {filesViewTarget && (
        <TaskFilesViewModal
          taskId={filesViewTarget.id}
          taskTitle={filesViewTarget.title}
          taskCode={filesViewTarget.taskCode}
          open={!!filesViewTarget}
          onClose={() => setFilesViewTarget(null)}
        />
      )}

      {reassignTarget && (
        <ReassignEditorModal
          open={!!reassignTarget}
          taskId={reassignTarget.taskId}
          taskTitle={reassignTarget.taskTitle}
          currentAssignedTo={reassignTarget.assignedTo}
          mode={reassignTarget.mode}
          onOpenChange={v => { if (!v) setReassignTarget(null); }}
          onSaved={() => { setReassignTarget(null); load(true); }}
        />
      )}

      {availEditor && (
        <EditorAvailabilityModal
          open={!!availEditor}
          editor={availEditor}
          onOpenChange={v => { if (!v) setAvailEditor(null); }}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir tarefa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Tem certeza que deseja excluir <strong>"{deleteTarget?.title}"</strong>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteTask} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

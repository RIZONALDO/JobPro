import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { TaskFilesViewModal } from "@/components/TaskFilesViewModal";
import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useRealtime } from "@/hooks/use-realtime";
import { Input } from "@/components/ui/input";
import { Search, X, ClipboardList, Clapperboard, AudioLines, CalendarDays } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";
import { useSearch } from "wouter";

interface Task {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  startDate?: string | null;
  revisionCount: number;
  client: string | null;
  updatedAt: string;
  fileCount?: number;
  fileKind?: "video" | "audio" | "mixed" | "other" | null;
  taskType?: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
  createdBy: { id: number; name: string; avatarUrl?: string | null } | null;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DAYS_PT   = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function EditorCalendarList({ tasks }: { tasks: Task[] }) {
  const grouped = useMemo(() => {
    const byMonth = new Map<string, Map<string, Task[]>>();
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
        return (
          <div key={monthKey}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">
                {MONTHS_PT[parseInt(m) - 1]} {y}
              </span>
              <div className="flex-1 h-px bg-[hsl(var(--border))]/50" />
            </div>
            <div className="space-y-1">
              {[...byDay.entries()].map(([dateStr, dayTasks]) => {
                const d = new Date(dateStr + "T12:00:00");
                const dayNum  = String(d.getDate()).padStart(2, "0");
                const dayName = DAYS_PT[d.getDay()];
                return (
                  <div key={dateStr} className="flex gap-4 border-t border-[hsl(var(--border))]/30 pt-3 first:border-0 first:pt-0">
                    <div className="w-14 shrink-0 flex flex-col items-center pt-2.5">
                      <span className="text-2xl font-black leading-none tabular-nums text-[hsl(var(--foreground))]">{dayNum}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mt-0.5">{dayName}</span>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1 py-1">
                      {dayTasks.map(t => (
                        <div key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors cursor-default">
                          <div className="w-1 h-8 rounded-full shrink-0 bg-[hsl(var(--primary))]/30" />
                          <div className="flex-1 min-w-0">
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

export default function EditorTaskList() {
  const { user } = useAuth();
  const { openTask } = useTaskModal();

  const [tasks,   setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  const [filesViewTarget, setFilesViewTarget] = useState<Task | null>(null);

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

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks")
      .then(setTasks)
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });

  const [viewTab, setViewTab] = useState<"today" | "scheduled" | "all">("today");

  const TODAY_STR = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const isScheduled = (t: Task) =>
    !!(t.startDate && t.startDate.split("T")[0] > TODAY_STR);

  const filtered = useMemo(() => tasks.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title.toLowerCase().includes(q) || (t.client ?? "").toLowerCase().includes(q);
  }), [tasks, search]);

  const tabFiltered = useMemo(() => {
    if (viewTab === "today")     return filtered.filter(t => !isScheduled(t) && t.status !== "completed");
    if (viewTab === "scheduled") return filtered.filter(t => isScheduled(t));
    if (viewTab === "all")       return filtered.filter(t => t.status === "completed");
    return filtered;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, viewTab]);

  // ── TanStack Table ─────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<Task, unknown>[]>(() => [
    {
      id: "tarefa",
      accessorKey: "title",
      header: "Tarefa",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
              <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
              {t.revisionCount > 0 && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">
                  {t.revisionCount} {t.revisionCount === 1 ? "alt." : "alts."}
                </span>
              )}
            </div>
            {t.taskType === "subtask" && t.parentTask && <ParentTaskBreadcrumb parentTask={t.parentTask} className="mt-0.5" />}
            {t.taskType === "multi_task" && <MultiTaskBadge taskType="multi_task" className="mt-0.5" />}
            {t.client && <span className="text-xs text-[hsl(var(--muted-foreground))]/55 truncate mt-0.5 block">{t.client}</span>}
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
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/70">
          {fmtDate(row.original.dueDate)}
        </span>
      ),
    },
    ...(viewTab !== "scheduled" ? [{
      id: "status",
      header: "Status",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }: { row: { original: Task } }) => {
        const s = row.original.status;

        const CHIPS: Record<string, { label: string; cls: string }> = {
          pending:     { label: "Na fila",        cls: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/40" },
          in_progress: { label: "Em edição",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/40" },
          captacao:    { label: "Falta captação", cls: "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]/80 border-[hsl(var(--primary))]/20" },
          in_revision: { label: "Em alteração",   cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800/40" },
          review:      { label: "Em aprovação",   cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40" },
          completed:   { label: "Aprovada",       cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50" },
          paused:      { label: "Pausada",        cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800/40" },
          cancelled:   { label: "Cancelada",      cls: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-200 dark:border-red-800/40" },
        };

        const chip = CHIPS[s];
        if (!chip) return null;
        return (
          <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap border ${chip.cls}`}>
            {chip.label}
          </span>
        );
      },
    } as ColumnDef<Task, unknown>] : []),
    {
      id: "coordenador",
      header: "Atendimento",
      size: 128,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const t = row.original;
        if (!t.createdBy) return <span className="text-xs text-[hsl(var(--muted-foreground))]/30">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            <AvatarDisplay name={t.createdBy.name} avatarUrl={t.createdBy.avatarUrl} size={24} />
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 truncate">{t.createdBy.name.split(" ")[0]}</span>
          </div>
        );
      },
    },
  ], [user, viewTab]);

  const table = useReactTable({
    data: tabFiltered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden p-2 sm:p-4 gap-2 sm:gap-4 bg-[hsl(var(--background))]">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tarefa…" className="pl-8 h-8 text-sm bg-[hsl(var(--background))]" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
          {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">

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
            </div>
          ))}
        </div>
      ) : tabFiltered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
            <ClipboardList className="h-7 w-7 text-[hsl(var(--muted-foreground))]/30" />
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {search ? "Nenhuma tarefa corresponde à busca." : "Nenhuma tarefa atribuída a você."}
          </p>
        </div>
      ) : viewTab === "scheduled" ? (
        <EditorCalendarList tasks={tabFiltered} />
      ) : (
        <>
          {/* Mobile */}
          <div className="sm:hidden divide-y divide-[hsl(var(--muted))]">
            {tabFiltered.map(t => (
              <div
                key={t.id}
                ref={highlighted === t.id ? (el => { if (el) highlightRef.current = el as unknown as HTMLDivElement; }) : undefined}
                className="flex items-start px-4 py-4 gap-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                style={{ backgroundColor: highlighted === t.id ? "hsl(var(--primary) / 0.08)" : undefined }}
                onClick={() => openTask(t.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0">
                    {t.taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/70">{t.taskCode}</span>}
                    <span className="text-sm font-semibold truncate leading-snug">{t.title}</span>
                    {t.revisionCount > 0 && (
                      <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap">
                        {t.revisionCount} alt.
                      </span>
                    )}
                  </div>
                  {t.client && <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate mt-1">{t.client}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]/60">{fmtDate(t.dueDate)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/10">
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
                  return (
                    <tr
                      key={t.id}
                      ref={isHighlighted ? (el => { if (el) highlightRef.current = el as unknown as HTMLDivElement; }) : undefined}
                      className="hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                      style={{ backgroundColor: isHighlighted ? "hsl(var(--primary) / 0.08)" : undefined }}
                      onClick={() => openTask(t.id)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

        </div>
      </div>

      {filesViewTarget && (
        <TaskFilesViewModal
          taskId={filesViewTarget.id}
          taskTitle={filesViewTarget.title}
          taskCode={filesViewTarget.taskCode}
          open={!!filesViewTarget}
          onClose={() => setFilesViewTarget(null)}
        />
      )}
    </div>
  );
}

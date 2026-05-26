import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { List, LayoutGrid, CalendarRange, CalendarDays, Archive } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useRealtime } from "@/hooks/use-realtime";
import TasksOverview   from "@/pages/tasks-overview";
import TasksRascunho   from "@/pages/tasks-rascunho";
import EditorTaskList  from "@/pages/editor-task-list";
import Pipeline        from "@/pages/pipeline";
import TimelinePage    from "@/pages/timeline";
import CalendarPage    from "@/pages/calendar";

type Tab = "lista" | "rascunho" | "board" | "timeline" | "calendario";

export default function TasksHub() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const isEditor  = user?.role === "editor";
  const isSuper   = user?.role === "admin" || user?.role === "supervisor";
  const showDraft  = isSuper || user?.role === "coordinator";

  const search = useSearch();
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return (["board","lista","rascunho","timeline","calendario"].includes(t ?? "")) ? t as Tab : "lista";
  });
  useEffect(() => {
    const t = new URLSearchParams(search).get("tab");
    if (["board","lista","rascunho","timeline","calendario"].includes(t ?? "")) setTab(t as Tab);
  }, [search]);

  // Badge count para aba Rascunhos
  const [draftCount, setDraftCount] = useState(0);
  const loadDraftCount = useCallback(() => {
    if (!showDraft) return;
    apiFetch<{ id: number; status: string; coordinator?: { id: number } | null; taskType?: string }[]>(
      "/api/tasks/overview?status=rascunho"
    )
      .then(tasks => {
        const filtered = tasks.filter(t => {
          if (t.status !== "rascunho") return false;
          if (t.taskType === "subtask") return false;
          if (!isSuper && user?.role === "coordinator" && t.coordinator?.id !== user?.id) return false;
          return true;
        });
        setDraftCount(filtered.length);
      })
      .catch(() => {});
  }, [showDraft, isSuper, user]);

  useEffect(() => { loadDraftCount(); }, [loadDraftCount]);
  useRealtime({ onTasksChanged: () => loadDraftCount() });

  const TABS: { key: Tab; label: string; Icon: React.ComponentType<{ className?: string }>; show?: boolean }[] = [
    { key: "lista",      label: "Lista",      Icon: List,         show: true        },
    { key: "rascunho",   label: "Rascunhos",  Icon: Archive,      show: showDraft   },
    { key: "board",      label: "Board",      Icon: LayoutGrid,   show: true        },
    { key: "calendario", label: "Calendário", Icon: CalendarDays, show: true        },
    { key: "timeline",   label: "Timeline",   Icon: CalendarRange,show: !isEditor   },
  ];

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-8 flex flex-col"
      style={{ height: "calc(100dvh - 56px)", overflow: "hidden" }}
    >
      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b bg-[hsl(var(--card))] flex items-stretch px-0 md:px-6">
        {TABS.filter(t => t.show).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              "flex-1 md:flex-none",
              "flex items-center justify-center md:justify-start gap-2",
              "py-3.5 md:py-2.5 px-2 md:px-3",
              "text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]",
            ].join(" ")}
          >
            <Icon className="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0" />
            <span className="text-sm">{label}</span>
            {/* Badge circular para rascunhos */}
            {key === "rascunho" && draftCount > 0 && tab !== "rascunho" && (
              <span className={[
                "flex items-center justify-center font-bold shrink-0",
                "bg-[hsl(var(--muted-foreground))]/25 text-[hsl(var(--foreground))]",
                "text-[10px] leading-none rounded-full",
                draftCount > 9 ? "h-4 px-1.5" : "h-4 w-4",
              ].join(" ")}>
                {draftCount > 99 ? "99+" : draftCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Lista ──────────────────────────────────────────────────── */}
      {tab === "lista" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {isEditor ? (
            <div className="h-full overflow-y-auto p-4 md:p-6 pb-10">
              <EditorTaskList />
            </div>
          ) : (
            <TasksOverview />
          )}
        </div>
      )}

      {/* ── Rascunhos ──────────────────────────────────────────────── */}
      {tab === "rascunho" && showDraft && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TasksRascunho />
        </div>
      )}

      {/* ── Board ──────────────────────────────────────────────────── */}
      {tab === "board" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Pipeline />
        </div>
      )}

      {/* ── Calendário ─────────────────────────────────────────────── */}
      {tab === "calendario" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CalendarPage />
        </div>
      )}

      {/* ── Timeline — apenas coordenadores ────────────────────────── */}
      {tab === "timeline" && !isEditor && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TimelinePage />
        </div>
      )}
    </div>
  );
}

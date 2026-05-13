import { useState } from "react";
import { List, LayoutGrid, CalendarRange } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import TasksOverview   from "@/pages/tasks-overview";
import EditorTaskList  from "@/pages/editor-task-list";
import MyTasks         from "@/pages/my-tasks";
import Pipeline        from "@/pages/pipeline";
import TimelinePage    from "@/pages/timeline";

type Tab = "lista" | "board" | "timeline";

export default function TasksHub() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const isEditor = user?.role === "editor";
  const [tab, setTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    return (t === "board" || t === "lista" || t === "timeline") ? t as Tab : "lista";
  });

  const TABS: { key: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "lista",    label: "Lista",    Icon: List          },
    { key: "board",    label: "Board",    Icon: LayoutGrid    },
    ...(!isEditor ? [{ key: "timeline" as Tab, label: "Timeline", Icon: CalendarRange }] : []),
  ];

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-8 flex flex-col"
      style={{ height: "calc(100dvh - 56px)", overflow: "hidden" }}
    >
      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b bg-[hsl(var(--card))] flex items-stretch px-0 md:px-6">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              // Mobile: equal-width, centered, tall touch target
              // Desktop: natural width, left-aligned, standard height
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
          </button>
        ))}
      </div>

      {/* ── Lista ──────────────────────────────────────────────────── */}
      {tab === "lista" && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 md:p-6 pb-10">
            {isEditor ? <EditorTaskList /> : <TasksOverview />}
          </div>
        </div>
      )}

      {/* ── Board ──────────────────────────────────────────────────── */}
      {tab === "board" && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          {isEditor ? <MyTasks /> : <Pipeline />}
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

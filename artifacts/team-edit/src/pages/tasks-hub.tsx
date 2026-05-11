import { useState } from "react";
import { List, LayoutGrid, CalendarRange } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import TasksOverview   from "@/pages/tasks-overview";
import EditorTaskList  from "@/pages/editor-task-list";
import MyTasks         from "@/pages/my-tasks";
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
      {/* Tab bar */}
      <div className="shrink-0 border-b px-4 md:px-6 flex items-end">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {tab === "lista" && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 md:p-6 pb-12">
            {isEditor ? <EditorTaskList /> : <TasksOverview />}
          </div>
        </div>
      )}

      {/* Board */}
      {tab === "board" && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          <MyTasks />
        </div>
      )}

      {/* Timeline — apenas coordenadores */}
      {tab === "timeline" && !isEditor && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TimelinePage />
        </div>
      )}
    </div>
  );
}

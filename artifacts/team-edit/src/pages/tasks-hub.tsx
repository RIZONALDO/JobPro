import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import TasksOverview  from "@/pages/tasks-overview";
import EditorTaskList from "@/pages/editor-task-list";

export default function TasksHub() {
  usePageTitle("Tarefas");
  const { user } = useAuth();
  const isEditor = user?.role === "editor";

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-8 flex flex-col"
      style={{ height: "calc(100dvh - 56px)", overflow: "hidden" }}
    >
      {isEditor ? <EditorTaskList /> : <TasksOverview />}
    </div>
  );
}

import { usePageTitle } from "@/lib/use-page-title";
import TasksOverview from "@/pages/tasks-overview";

export default function TasksHub() {
  usePageTitle("Tarefas");
  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-8 flex flex-col"
      style={{ height: "calc(100dvh - 56px)", overflow: "hidden" }}
    >
      <TasksOverview />
    </div>
  );
}

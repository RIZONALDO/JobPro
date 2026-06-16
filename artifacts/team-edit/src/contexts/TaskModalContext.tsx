import { createContext, useContext, useState, type ReactNode } from "react";
import { TaskModal } from "@/components/TaskModal";

interface TaskModalContextValue {
  openTask: (taskId: number) => void;
}

const TaskModalContext = createContext<TaskModalContextValue>({ openTask: () => {} });

export function useTaskModal() {
  return useContext(TaskModalContext);
}

export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<number | null>(null);

  const openTask = (id: number) => setTaskId(id);

  return (
    <TaskModalContext.Provider value={{ openTask }}>
      {children}
      {taskId !== null && (
        <TaskModal
          taskId={taskId}
          onClose={() => setTaskId(null)}
          onOpenTask={id => setTaskId(id)}
        />
      )}
    </TaskModalContext.Provider>
  );
}

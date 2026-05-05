import { createContext, useContext, useState, ReactNode } from "react";
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

  return (
    <TaskModalContext.Provider value={{ openTask: setTaskId }}>
      {children}
      {taskId !== null && (
        <TaskModal taskId={taskId} onClose={() => setTaskId(null)} />
      )}
    </TaskModalContext.Provider>
  );
}

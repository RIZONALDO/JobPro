import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { TaskModal } from "@/components/TaskModal";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "entrega" | "envio";

interface TaskModalContextValue {
  openTask: (taskId: number, tab?: Tab) => void;
}

const TaskModalContext = createContext<TaskModalContextValue>({ openTask: () => {} });

export function useTaskModal() {
  return useContext(TaskModalContext);
}

export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ id: number; tab: Tab } | null>(null);
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const openTask = (taskId: number, tab: Tab = "entrega") => {
    const isCoord = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";
    if (isCoord) {
      navigate(`/review/${taskId}`);
    } else {
      setState({ id: taskId, tab });
    }
  };

  return (
    <TaskModalContext.Provider value={{ openTask }}>
      {children}
      {state !== null && (
        <TaskModal
          taskId={state.id}
          initialTab={state.tab}
          onClose={() => setState(null)}
          onOpenTask={(id) => setState({ id, tab: "entrega" })}
        />
      )}
    </TaskModalContext.Provider>
  );
}

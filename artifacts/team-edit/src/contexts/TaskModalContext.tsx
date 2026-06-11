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

  const openTask = (taskId: number, _tab?: Tab) => {
    navigate(`/review/${taskId}`);
  };

  return (
    <TaskModalContext.Provider value={{ openTask }}>
      {children}
    </TaskModalContext.Provider>
  );
}

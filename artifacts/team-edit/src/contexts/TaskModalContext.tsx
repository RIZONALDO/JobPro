import { createContext, useContext, useState, type ReactNode } from "react";
import { TaskModal } from "@/components/TaskModal";

type Tab = "entrega" | "revisao" | "envio";

interface TaskModalContextValue {
  openTask: (taskId: number, tab?: Tab) => void;
}

const TaskModalContext = createContext<TaskModalContextValue>({ openTask: () => {} });

export function useTaskModal() {
  return useContext(TaskModalContext);
}

export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ id: number; tab: Tab } | null>(null);

  return (
    <TaskModalContext.Provider value={{ openTask: (id, tab = "entrega") => setState({ id, tab }) }}>
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

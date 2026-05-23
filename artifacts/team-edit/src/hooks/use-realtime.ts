import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";

interface SubtaskProgressEvent {
  parentTaskId: number;
  progress: { total: number; completed: number; percentage: number };
}

interface RealtimeOptions {
  onTasksChanged?: () => void;
  onJobsChanged?:  () => void;
  onProjectsChanged?: () => void;
  /** Chamado quando uma subtarefa muda de status — útil para recarregar o modal de detalhe */
  onSubtaskChanged?: () => void;
  /** Chamado quando o progresso de uma multi-tarefa é atualizado em tempo real */
  onMultitaskProgress?: (event: SubtaskProgressEvent) => void;
}

export function useRealtime(options: RealtimeOptions) {
  const onTasksRef     = useRef(options.onTasksChanged);
  const onJobsRef      = useRef(options.onJobsChanged);
  const onProjectsRef  = useRef(options.onProjectsChanged);
  const onSubtaskRef   = useRef(options.onSubtaskChanged);
  const onProgressRef  = useRef(options.onMultitaskProgress);

  useEffect(() => { onTasksRef.current    = options.onTasksChanged; });
  useEffect(() => { onJobsRef.current     = options.onJobsChanged; });
  useEffect(() => { onProjectsRef.current = options.onProjectsChanged; });
  useEffect(() => { onSubtaskRef.current  = options.onSubtaskChanged; });
  useEffect(() => { onProgressRef.current = options.onMultitaskProgress; });

  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Debounce genérico para tasks:changed e subtask:changed
    const handleTasksChanged = () => {
      if (timer) clearTimeout(timer);
      const delay = 200 + Math.random() * 500; // 200–700ms por cliente
      timer = setTimeout(() => {
        onTasksRef.current?.();
        onJobsRef.current?.();
        onProjectsRef.current?.();
        timer = null;
      }, delay);
    };

    const handleSubtaskChanged = () => {
      // Subtask changed: recarrega tanto as tarefas gerais quanto o callback específico
      handleTasksChanged();
      onSubtaskRef.current?.();
    };

    // Progresso de multi-tarefa: sem debounce, é leve e pontual
    const handleMultitaskProgress = (event: SubtaskProgressEvent) => {
      onProgressRef.current?.(event);
    };

    socket.on("tasks:changed",      handleTasksChanged);
    socket.on("subtask:changed",    handleSubtaskChanged);
    socket.on("multitask:progress", handleMultitaskProgress);

    return () => {
      socket.off("tasks:changed",      handleTasksChanged);
      socket.off("subtask:changed",    handleSubtaskChanged);
      socket.off("multitask:progress", handleMultitaskProgress);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

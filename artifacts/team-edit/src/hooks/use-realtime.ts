import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";

interface RealtimeOptions {
  onTasksChanged?: () => void;
  onJobsChanged?:  () => void;
  onProjectsChanged?: () => void;
}

export function useRealtime(options: RealtimeOptions) {
  const onTasksRef    = useRef(options.onTasksChanged);
  const onJobsRef     = useRef(options.onJobsChanged);
  const onProjectsRef = useRef(options.onProjectsChanged);

  useEffect(() => { onTasksRef.current    = options.onTasksChanged; });
  useEffect(() => { onJobsRef.current     = options.onJobsChanged; });
  useEffect(() => { onProjectsRef.current = options.onProjectsChanged; });

  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handle = () => {
      // Debounce: agrupa rafagas de eventos em um único reload
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onTasksRef.current?.();
        onJobsRef.current?.();
        onProjectsRef.current?.();
        timer = null;
      }, 400);
    };

    socket.on("tasks:changed", handle);
    return () => {
      socket.off("tasks:changed", handle);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

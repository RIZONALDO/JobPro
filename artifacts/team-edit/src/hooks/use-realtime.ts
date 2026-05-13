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
      // Debounce com jitter: evita que todos os clientes recarreguem simultaneamente
      if (timer) clearTimeout(timer);
      const delay = 200 + Math.random() * 500; // 200-700ms por cliente
      timer = setTimeout(() => {
        onTasksRef.current?.();
        onJobsRef.current?.();
        onProjectsRef.current?.();
        timer = null;
      }, delay);
    };

    socket.on("tasks:changed", handle);
    return () => {
      socket.off("tasks:changed", handle);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

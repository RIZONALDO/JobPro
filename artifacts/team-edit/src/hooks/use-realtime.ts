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
    const handle = () => {
      onTasksRef.current?.();
      onJobsRef.current?.();
      onProjectsRef.current?.();
    };
    socket.on("tasks:changed", handle);
    return () => { socket.off("tasks:changed", handle); };
  }, []);
}

import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";

export interface TasksChangedPayload { jobId: number; projectId: number }
export interface JobsChangedPayload {
  projectId: number;
  jobId?: number;
  deleted?: boolean;
  newStatus?: string;
}
export interface ProjectsChangedPayload {
  projectId?: number;
  deleted?: boolean;
  newStatus?: string;
}

interface RealtimeOptions {
  onTasksChanged?:    (data: TasksChangedPayload)    => void;
  onJobsChanged?:     (data: JobsChangedPayload)     => void;
  onProjectsChanged?: (data: ProjectsChangedPayload) => void;
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

    const handleTasks    = (d: TasksChangedPayload)    => onTasksRef.current?.(d);
    const handleJobs     = (d: JobsChangedPayload)     => onJobsRef.current?.(d);
    const handleProjects = (d: ProjectsChangedPayload) => onProjectsRef.current?.(d);

    if (options.onTasksChanged)    socket.on("tasks:changed",    handleTasks);
    if (options.onJobsChanged)     socket.on("jobs:changed",     handleJobs);
    if (options.onProjectsChanged) socket.on("projects:changed", handleProjects);

    return () => {
      socket.off("tasks:changed",    handleTasks);
      socket.off("jobs:changed",     handleJobs);
      socket.off("projects:changed", handleProjects);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount/unmount only — refs keep callbacks current
}

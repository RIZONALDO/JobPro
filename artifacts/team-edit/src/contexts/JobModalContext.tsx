import { createContext, useContext, useState, ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { ProjectModal } from "@/components/ProjectModal";

interface ModalState { projectId: number; initialJobId?: number; }

interface JobModalContextValue {
  openJob: (jobId: number) => Promise<void>;
  openProject: (projectId: number) => void;
}

const JobModalContext = createContext<JobModalContextValue>({
  openJob: async () => {},
  openProject: () => {},
});

export function useJobModal() {
  return useContext(JobModalContext);
}

export function JobModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);

  const openJob = async (jobId: number) => {
    const { projectId } = await apiFetch<{ projectId: number }>(`/api/jobs/${jobId}`);
    setModal({ projectId, initialJobId: jobId });
  };

  const openProject = (projectId: number) => setModal({ projectId });

  return (
    <JobModalContext.Provider value={{ openJob, openProject }}>
      {children}
      {modal && (
        <ProjectModal
          projectId={modal.projectId}
          initialJobId={modal.initialJobId}
          onClose={() => setModal(null)}
        />
      )}
    </JobModalContext.Provider>
  );
}

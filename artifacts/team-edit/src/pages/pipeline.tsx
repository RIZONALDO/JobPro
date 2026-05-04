import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { ProjectModal } from "@/components/ProjectModal";
import { useToast } from "@/hooks/use-toast";
import { Briefcase } from "lucide-react";
import { CoordinatorAvatar } from "@/components/ui/avatar-group";
import { usePageTitle } from "@/lib/use-page-title";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface PipelineProject {
  id: number;
  name: string;
  client: string | null;
  color: string;
  status: string;
  stage: "briefing" | "producao" | "aprovacao" | "entregue";
  jobCount: number;
  completedJobCount: number;
  taskCount: number;
  completedTaskCount: number;
  coordinator: Person | null;
  number: number;
}

const STAGES: {
  key: PipelineProject["stage"];
  label: string;
  desc: string;
  accent: string;
  track: string;
}[] = [
  { key: "briefing",  label: "Briefing",     desc: "Aguardando início",   accent: "#94a3b8", track: "bg-slate-200" },
  { key: "producao",  label: "Em produção",   desc: "Equipe trabalhando",  accent: "#3b82f6", track: "bg-blue-200"  },
  { key: "aprovacao", label: "Aprovação",     desc: "Aguardando ok final", accent: "#f59e0b", track: "bg-amber-200" },
  { key: "entregue",  label: "No ar",         desc: "Concluído",           accent: "#22c55e", track: "bg-green-200" },
];

export default function Pipeline() {
  usePageTitle("Pipeline");
  const { toast } = useToast();
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [openProjectId, setOpenProjectId] = useState<number | null>(null);

  const load = useCallback(() => {
    apiFetch<PipelineProject[]>("/api/pipeline")
      .then(setProjects)
      .catch(() => toast({ title: "Erro ao carregar pipeline", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onProjectsChanged: load, onJobsChanged: load, onTasksChanged: load });

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  const total = projects.length;

  return (
    <div className="space-y-4">
      {/* Resumo rápido */}
      <div className="flex items-center gap-6 text-xs text-[hsl(var(--muted-foreground))]">
        <span>{total} {total === 1 ? "projeto" : "projetos"} ativos</span>
        {STAGES.map(s => {
          const n = projects.filter(p => p.stage === s.key).length;
          return n > 0 ? (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.accent }} />
              {n} {s.label}
            </span>
          ) : null;
        })}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {STAGES.map(stage => {
          const cols = projects.filter(p => p.stage === stage.key);
          return (
            <div key={stage.key} className="flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center gap-2 px-1">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.accent }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">{stage.label}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{stage.desc}</p>
                </div>
                <span className="ml-auto text-[11px] font-semibold shrink-0 bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
                  {cols.length}
                </span>
              </div>

              {/* Cards */}
              {cols.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 flex items-center justify-center bg-[hsl(var(--muted))]/10">
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum projeto</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {cols.map(p => {
                    const pct = p.taskCount > 0 ? Math.round(p.completedTaskCount / p.taskCount * 100) : 0;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setOpenProjectId(p.id)}
                        className="rounded-xl border bg-[hsl(var(--card))] card-float p-4 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer"
                        style={{ borderTop: `3px solid ${p.color}` }}
                      >
                          {/* Topo */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{p.number}</span>
                                <p className="text-sm font-semibold leading-snug truncate">{p.name}</p>
                              </div>
                              {p.client && <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{p.client}</p>}
                            </div>
                            {p.coordinator && <CoordinatorAvatar person={p.coordinator} />}
                          </div>

                          {/* Progresso */}
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                              <span>{p.completedTaskCount}/{p.taskCount} tarefas</span>
                              <span className="font-semibold" style={{ color: p.color }}>{pct}%</span>
                            </div>
                            <div className={`h-1.5 rounded-full ${stage.track}`}>
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: p.color }}
                              />
                            </div>
                          </div>

                          {/* Rodapé */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                              <Briefcase className="h-3 w-3 opacity-60" />
                              <span>{p.completedJobCount}/{p.jobCount} {p.jobCount === 1 ? "job" : "jobs"}</span>
                            </div>
                          </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {openProjectId !== null && (
        <ProjectModal
          projectId={openProjectId}
          onClose={() => setOpenProjectId(null)}
        />
      )}
    </div>
  );
}

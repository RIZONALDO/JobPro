import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { useParams, useLocation, Link } from "wouter";
import { usePageTitle } from "@/lib/use-page-title";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useJobModal } from "@/contexts/JobModalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Briefcase, Pencil, Trash2, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CoordinatorAvatar, EditorAvatars } from "@/components/ui/avatar-group";
import { JOB_STATUS_CLASS, JOB_STATUS_LABEL } from "@/lib/job-status";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Job {
  id: number;
  number: number;
  name: string;
  description: string | null;
  status: string;
  taskCount: number;
  completedCount: number;
  assignees: Person[];
}

interface Project {
  id: number;
  number: number;
  name: string;
  client: string | null;
  description: string | null;
  status: string;
  color: string;
  createdAt: string;
  coordinator: Person | null;
  jobs: Job[];
}


export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { openJob } = useJobModal();
  const [project, setProject] = useState<Project | null>(null);
  usePageTitle(project ? `Projeto #${project.number} · ${project.name}` : "Projetos");
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiFetch<Project>(`/api/projects/${params.id}`)
      .then(setProject)
      .catch(() => toast({ title: "Erro ao carregar projeto", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [params.id, toast]);

  useEffect(() => { load(); }, [load]);

  const projectId = parseInt(params.id ?? "0", 10);
  useRealtime({
    onJobsChanged:  (d) => { if (d.projectId === projectId) load(); },
    onTasksChanged: (d) => { if (d.projectId === projectId) load(); },
    onProjectsChanged: (d) => {
      if (d.deleted && d.projectId === projectId) {
        toast({ title: "Este projeto foi excluído pelo coordenador." });
        navigate("/projects");
        return;
      }
      if (d.projectId === projectId && d.newStatus) {
        const msg: Record<string, string> = {
          pausado:   "Projeto pausado pelo coordenador.",
          concluido: "Projeto concluído pelo coordenador.",
          arquivado: "Projeto arquivado pelo coordenador.",
        };
        if (msg[d.newStatus]) toast({ title: msg[d.newStatus] });
      }
      load();
    },
  });

  const openNew = () => { setEditingJob(null); setForm({ name: "", description: "" }); setShowDialog(true); };
  const openEdit = (j: Job) => {
    setEditingJob(j);
    setForm({ name: j.name, description: j.description ?? "" });
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    const payload = { name: form.name, description: form.description };
    try {
      if (editingJob) { await apiPut(`/api/jobs/${editingJob.id}`, payload); toast({ title: "Job atualizado" }); }
      else { await apiPost(`/api/projects/${params.id}/jobs`, payload); toast({ title: "Job criado" }); }
      setShowDialog(false); load();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm("Excluir este job e todas as suas tarefas?")) return;
    await apiDelete(`/api/jobs/${id}`); load();
  };

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm p-4">Carregando...</div>;
  if (!project) return <div className="p-4">Projeto não encontrado.</div>;

  return (
    <div className="space-y-4">
      {/* Project banner */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="px-5 pt-2.5 pb-3 flex flex-col gap-2">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]/60">
            <Link href="/projects" className="hover:text-[hsl(var(--foreground))] transition-colors">Projetos</Link>
            <span className="select-none mx-0.5">›</span>
            <span className="text-[hsl(var(--primary))] font-medium">Jobs</span>
          </nav>
          {/* Info */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{project.number}</span>
              <span className="font-semibold truncate">{project.name}</span>
              {project.client && <span className="text-xs text-[hsl(var(--muted-foreground))]">· {project.client}</span>}
              <Badge className={`text-xs px-1.5 shrink-0 ${JOB_STATUS_CLASS[project.status] ?? "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                {JOB_STATUS_LABEL[project.status] ?? project.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" />Novo job</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Jobs */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        {project.jobs.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <Briefcase className="h-8 w-8 text-[hsl(var(--muted-foreground))]/30" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum job criado ainda.</p>
          </div>
        ) : (
          <div className="divide-y">
            {project.jobs.map((j, idx) => {
              return (
                <div key={j.id} className="group flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors">
                  <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0 select-none whitespace-nowrap">
                    {project.number}.{j.number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openJob(j.id)} className="text-sm font-medium hover:text-[hsl(var(--primary))] transition-colors truncate text-left">
                        {j.name}
                      </button>
                      <Badge className={`text-xs px-1.5 shrink-0 ${JOB_STATUS_CLASS[j.status] ?? ""}`}>
                        {JOB_STATUS_LABEL[j.status] ?? j.status}
                      </Badge>
                    </div>
                    {/* Barra de progresso */}
                    {j.taskCount > 0 && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 rounded-full bg-[hsl(var(--muted))] max-w-[160px]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round(j.completedCount / j.taskCount * 100)}%`,
                              backgroundColor: j.status === "entregue" ? "#22c55e" : project.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {j.completedCount}/{j.taskCount} entregue{j.completedCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(j)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => del(j.id)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"><Trash2 className="h-3.5 w-3.5" />Excluir</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingJob ? "Editar job" : "Novo job"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome do job" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição do job" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

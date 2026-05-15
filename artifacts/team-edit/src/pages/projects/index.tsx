import React, { useEffect, useState } from "react";
import { usePageTitle } from "@/lib/use-page-title";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { ProjectModal } from "@/components/ProjectModal";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Briefcase, List, LayoutGrid, Pencil, Trash2, MoreVertical, PauseCircle, PlayCircle, CheckCircle2, Archive, FolderOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { PROJ_STATUS_CLASS, PROJ_STATUS_LABEL, PROJ_STATUS_OPTIONS } from "@/lib/project-status";
import { ApiError } from "@/lib/api";
import { ActiveWorkGuardDialog, type GuardLevel } from "@/components/ActiveWorkGuardDialog";

import { CoordinatorAvatar, EditorAvatars } from "@/components/ui/avatar-group";

function RingProgress({ pct, size = 40 }: { pct: number; size?: number }) {
  const r = size / 2 - 4;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
      <circle cx={c} cy={c} r={r} fill="none" stroke="white" strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round" transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: "stroke-dashoffset 0.55s ease" }}
      />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize="7.5" fontWeight="700" fontFamily="inherit">
        {`${pct}%`}
      </text>
    </svg>
  );
}

interface Person { id: number; name: string; avatarUrl?: string | null; }

interface Project {
  id: number;
  number: number;
  name: string;
  client: string | null;
  description: string | null;
  status: string;
  color: string;
  createdAt: string;
  jobCount: number;
  taskCount: number;
  completedCount: number;
  assignees: Person[];
  coordinator: Person | null;
}

const PROJECT_COLORS = [
  // Roxos / violetas
  "#6366f1", "#818cf8", "#4f46e5", "#7c3aed", "#8b5cf6", "#a855f7", "#9333ea",
  // Rosas / vermelhos
  "#ec4899", "#f43f5e", "#e11d48", "#ef4444", "#dc2626", "#be123c",
  // Laranjas / ambarinos
  "#f97316", "#fb923c", "#f59e0b", "#eab308", "#ca8a04", "#d97706",
  // Verdes / teais
  "#22c55e", "#16a34a", "#15803d", "#10b981", "#14b8a6", "#0d9488", "#059669",
  // Azuis / cianos
  "#3b82f6", "#2563eb", "#1d4ed8", "#0ea5e9", "#06b6d4", "#0891b2", "#0284c7",
  // Neutros
  "#64748b", "#475569", "#334155", "#1e293b", "#78716c", "#57534e",
];


export default function ProjectsList() {
  usePageTitle("Projetos");
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "grid">("list");
  const [showDialog, setShowDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ name: "", client: "", description: "", color: "#6366f1", status: "ativo" });
  const [saving, setSaving] = useState(false);

  const isCoord = user?.role !== "editor";
  const [openProjectId, setOpenProjectId] = useState<number | null>(null);

  // Guard dialog state
  const [guard, setGuard] = useState<{
    open: boolean; level: GuardLevel; activeTasks: number;
    action: string; resourceName: string; allTasks?: boolean;
    onConfirm: () => Promise<void>;
  }>({ open: false, level: "critical", activeTasks: 0, action: "", resourceName: "", onConfirm: async () => {} });

  const load = () => {
    apiFetch<Project[]>("/api/projects")
      .then(setProjects)
      .catch(() => toast.error("Erro ao carregar projetos"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openNew = () => {
    setEditingProject(null);
    setForm({ name: "", client: "", description: "", color: "#6366f1", status: "ativo" });
    setShowDialog(true);
  };

  const openEdit = (p: Project) => {
    setEditingProject(p);
    setForm({ name: p.name, client: p.client ?? "", description: p.description ?? "", color: p.color, status: p.status });
    setShowDialog(true);
  };

  const doSave = async (force = false) => {
    if (!form.name.trim()) { toast.error("Nome obrigatório"); return; }
    setSaving(true);
    const payload = {
      name: form.name,
      client: form.client || null,
      description: form.description || null,
      color: form.color,
      ...(editingProject ? { status: form.status } : {}),
    };
    const url = editingProject
      ? `/api/projects/${editingProject.id}${force ? "?force=true" : ""}`
      : "/api/projects";
    try {
      if (editingProject) {
        await apiPut(url, payload);
        toast.success("Projeto atualizado");
      } else {
        await apiPost(url, payload);
        toast.success("Projeto criado");
      }
      setShowDialog(false);
      load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level, newStatus } = err.data as { activeTasks: number; level: GuardLevel; newStatus: string };
        const actionMap: Record<string, string> = { arquivado: "arquivar", concluido: "concluir", pausado: "pausar" };
        setGuard({
          open: true,
          level,
          activeTasks,
          action: actionMap[newStatus] ?? "alterar o status de",
          resourceName: form.name,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doSave(true); },
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    } finally { setSaving(false); }
  };

  const save = () => doSave(false);

  const doDel = async (id: number, name: string, force = false) => {
    try {
      await apiDelete(`/api/projects/${id}${force ? "?force=true" : ""}`);
      load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level } = err.data as { activeTasks: number; level: GuardLevel };
        setGuard({
          open: true,
          level,
          activeTasks,
          action: "excluir",
          resourceName: name,
          allTasks: true,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doDel(id, name, true); },
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao excluir");
      }
    }
  };

  const del = (id: number, name: string) => doDel(id, name);

  const doChangeStatus = async (p: Project, newStatus: string, force = false) => {
    try {
      await apiPut(`/api/projects/${p.id}${force ? "?force=true" : ""}`, { status: newStatus });
      load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const { activeTasks, level } = err.data as { activeTasks: number; level: GuardLevel };
        const actionMap: Record<string, string> = { arquivado: "arquivar", concluido: "concluir", pausado: "pausar" };
        setGuard({
          open: true, level, activeTasks,
          action: actionMap[newStatus] ?? "alterar",
          resourceName: p.name,
          onConfirm: async () => { setGuard(g => ({ ...g, open: false })); await doChangeStatus(p, newStatus, true); },
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar status");
      }
    }
  };

  const STATUS_ACTIONS: Record<string, { value: string; label: string; icon: React.ReactNode; cls?: string }[]> = {
    ativo: [
      { value: "pausado",   label: "Pausar",   icon: <PauseCircle  className="h-3.5 w-3.5" /> },
      { value: "concluido", label: "Concluir", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
      { value: "arquivado", label: "Arquivar", icon: <Archive      className="h-3.5 w-3.5" /> },
    ],
    pausado: [
      { value: "ativo",     label: "Reativar", icon: <PlayCircle className="h-3.5 w-3.5" /> },
      { value: "arquivado", label: "Arquivar", icon: <Archive    className="h-3.5 w-3.5" /> },
    ],
    concluido: [
      { value: "ativo",     label: "Reativar", icon: <PlayCircle  className="h-3.5 w-3.5" /> },
      { value: "arquivado", label: "Arquivar", icon: <Archive     className="h-3.5 w-3.5" /> },
    ],
    arquivado: [
      { value: "ativo", label: "Reativar", icon: <FolderOpen className="h-3.5 w-3.5" /> },
    ],
  };

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-[hsl(var(--muted))]/30">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`rounded-md p-1.5 transition-colors ${view === "list" ? "bg-[hsl(var(--background))] shadow-sm" : "hover:bg-[hsl(var(--muted))]"}`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`rounded-md p-1.5 transition-colors ${view === "grid" ? "bg-[hsl(var(--background))] shadow-sm" : "hover:bg-[hsl(var(--muted))]"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
        {isCoord && (
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" />Novo projeto</Button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border bg-[hsl(var(--card))] card-float py-16 flex flex-col items-center gap-3">
          <Briefcase className="h-10 w-10 text-[hsl(var(--muted-foreground))]/20" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum projeto criado ainda.</p>
          {isCoord && (
            <Button size="sm" variant="outline" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" />Criar projeto</Button>
          )}
        </div>
      ) : view === "list" ? (
        /* LIST VIEW */
        <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
          <div className="divide-y">
            {projects.map(p => {
              const pct = p.taskCount > 0 ? Math.round(p.completedCount / p.taskCount * 100) : 0;
              return (
                <div key={p.id} className="group flex items-center gap-0 hover:bg-[hsl(var(--muted))]/30 transition-colors">
                  {/* Left color bar */}
                  <div className="self-stretch w-[3px] shrink-0" style={{ backgroundColor: `${p.color}88` }} />

                  <div className="flex flex-1 items-center gap-4 px-4 py-3 min-w-0">

                    {/* Col 1 — número + nome + badge + cliente */}
                    <div className="w-[420px] shrink-0 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]/40 shrink-0">{p.number}</span>
                        <button
                          type="button"
                          onClick={() => setOpenProjectId(p.id)}
                          className="text-[15px] font-bold text-left transition-opacity hover:opacity-75 leading-tight"
                          style={{ color: `${p.color}cc` }}
                        >
                          {p.name}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-4">
                        <Badge className={`text-xs px-1.5 shrink-0 ${PROJ_STATUS_CLASS[p.status] ?? ""}`}>
                          {PROJ_STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                        {p.client && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{p.client}</span>
                        )}
                      </div>
                    </div>

                    {/* Col 2 — briefing */}
                    <div className="flex-1 min-w-0 hidden sm:block">
                      {p.description && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]/60 truncate italic">{p.description}</p>
                      )}
                    </div>

                    {/* Col 3 — progresso + avatars */}
                    <div className="hidden sm:flex items-center gap-4 shrink-0">
                      {p.taskCount > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1 rounded-full bg-[hsl(var(--muted))]">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: `${p.color}99` }} />
                          </div>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">{p.completedCount}/{p.taskCount}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        {p.coordinator && <CoordinatorAvatar person={p.coordinator} />}
                        {p.assignees.length > 0 && (
                          <><span className="text-[hsl(var(--muted-foreground))]/30 text-xs">|</span><EditorAvatars people={p.assignees} /></>
                        )}
                      </div>
                    </div>

                  </div>

                  {isCoord && (
                    <div className="pr-2 shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                          {(STATUS_ACTIONS[p.status]?.length ?? 0) > 0 && <DropdownMenuSeparator />}
                          {STATUS_ACTIONS[p.status]?.map(a => (
                            <DropdownMenuItem key={a.value} onClick={() => doChangeStatus(p, a.value)}>
                              {a.icon}{a.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => del(p.id, p.name)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"><Trash2 className="h-3.5 w-3.5" />Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* GRID VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => {
            const pct = p.taskCount > 0 ? Math.round(p.completedCount / p.taskCount * 100) : 0;
            return (
              <div key={p.id} className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">

                {/* Colored header block */}
                <div className="relative px-4 py-3 flex items-start gap-3" style={{ backgroundColor: p.color }}>
                  <div className="flex-1 min-w-0 pr-6">
                    <button
                      type="button"
                      onClick={() => setOpenProjectId(p.id)}
                      className="text-white font-bold text-sm line-clamp-2 leading-snug hover:opacity-80 transition-opacity text-left w-full">
                      {p.name}
                    </button>
                    {p.client && (
                      <p className="text-white/60 text-xs mt-0.5 truncate">{p.client}</p>
                    )}
                    <span className="inline-block mt-2 text-xs px-1.5 py-0.5 rounded-md font-semibold bg-black/20 text-white/90">
                      {PROJ_STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.taskCount > 0 && <RingProgress pct={pct} size={42} />}
                  {isCoord && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"
                          className="absolute top-1.5 right-1 h-6 w-6 text-white/60 hover:text-white hover:bg-white/15">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" />Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => del(p.id, p.name)} className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"><Trash2 className="h-3.5 w-3.5" />Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Card body */}
                <div className="flex-1 p-4 flex flex-col gap-3">
                  {/* Stats */}
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{p.jobCount} job{p.jobCount !== 1 ? "s" : ""}</span>
                    <span className="text-[hsl(var(--border))]">·</span>
                    <span>{p.taskCount} tarefa{p.taskCount !== 1 ? "s" : ""}</span>
                    {p.taskCount > 0 && (
                      <>
                        <span className="text-[hsl(var(--border))]">·</span>
                        <span>{p.completedCount} concluída{p.completedCount !== 1 ? "s" : ""}</span>
                      </>
                    )}
                  </div>

                  {/* Footer: avatars */}
                  <div className="mt-auto pt-1">
                    <div className="flex items-center gap-1.5">
                      {p.coordinator && <CoordinatorAvatar person={p.coordinator} />}
                      {p.assignees.length > 0 && (
                        <><span className="text-[hsl(var(--muted-foreground))]/30 text-xs">|</span><EditorAvatars people={p.assignees} /></>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openProjectId !== null && (
        <ProjectModal
          projectId={openProjectId}
          projectIds={projects.map(p => p.id)}
          onClose={() => setOpenProjectId(null)}
        />
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingProject ? "Editar projeto" : "Novo projeto"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome do projeto" />
            </div>
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <ClientCombobox value={form.client} onChange={v => setForm(f => ({ ...f, client: v }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Briefing</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descreva o briefing do projeto..." />
            </div>
            {editingProject && (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJ_STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="h-6 w-6 rounded-full transition-transform hover:scale-125 shrink-0"
                    style={{
                      backgroundColor: c,
                      outline: form.color === c ? `2.5px solid ${c}` : undefined,
                      outlineOffset: form.color === c ? "2px" : undefined,
                      boxShadow: form.color === c ? `0 0 0 1px white inset` : undefined,
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <label
                  className="h-7 w-7 rounded-full shrink-0 border border-[hsl(var(--border))] cursor-pointer overflow-hidden"
                  style={{ backgroundColor: form.color }}
                  title="Escolher cor personalizada"
                >
                  <input
                    type="color"
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="opacity-0 w-0 h-0 absolute"
                  />
                </label>
                <input
                  type="text"
                  value={form.color}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setForm(f => ({ ...f, color: v }));
                  }}
                  maxLength={7}
                  className="h-7 w-24 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs font-mono"
                  placeholder="#000000"
                />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">cor personalizada</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActiveWorkGuardDialog
        open={guard.open}
        onClose={() => setGuard(g => ({ ...g, open: false }))}
        onConfirm={guard.onConfirm}
        level={guard.level}
        activeTasks={guard.activeTasks}
        action={guard.action}
        resourceType="projeto"
        resourceName={guard.resourceName}
        allTasks={guard.allTasks}
      />
    </div>
  );
}

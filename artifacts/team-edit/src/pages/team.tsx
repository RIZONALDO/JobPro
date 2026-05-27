import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useEffect, useState } from "react";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useJobModal } from "@/contexts/JobModalContext";
import { fmtDate, fmtDateHuman } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users, ChevronDown, ChevronRight } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import { PriorityBadge } from "@/components/ui/priority-badge";

interface AppUser {
  id: number;
  name: string;
  login: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  jobTitle?: string | null;
}

interface EditorWorkload {
  id: number;
  name: string;
  login: string;
  avatarUrl: string | null;
  taskCount: number;
  score: number;
  byComplexity: { low: number; medium: number; high: number };
  byStatus: { pending: number; in_progress: number; in_revision: number; review: number };
}

interface EditorTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  complexity: string;
  dueDate: string | null;
  jobId: number;
  jobName: string | null;
}

import { ROLE_LABEL, ROLE_OPTIONS } from "@/lib/roles";

const STATUS_BAR: Record<string, string> = {
  pending:     "bg-slate-300",
  in_progress: "bg-blue-400",
  in_revision: "bg-orange-400",
  review:      "bg-amber-400",
  completed:   "bg-green-500",
};

// cinza=disponível | verde=ocupado | laranja=muito ocupado | vermelho=no limite
function scoreColor(score: number): string {
  if (score === 0)   return "#94a3b8"; // cinza  — Disponível
  if (score <= 6)    return "#22c55e"; // verde  — Ocupado
  if (score <= 11)   return "#f97316"; // laranja — Muito ocupado
  return "#ef4444";                    // vermelho — No limite
}
function scoreLabel(score: number): string {
  if (score === 0)   return "Disponível";
  if (score <= 6)    return "Ocupado";
  if (score <= 11)   return "Muito ocupado";
  return "No limite";
}

const BATTERY_SEGS = 5;

function Battery({ score, maxScore, color }: { score: number; maxScore: number; color: string }) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  const filled = Math.round(pct * BATTERY_SEGS);
  const bw = 36; const bh = 14;
  const termW = 3; const termH = 7;
  const gap = 2;
  const segW = (bw - gap * (BATTERY_SEGS - 1) - 4) / BATTERY_SEGS;
  return (
    <svg width={bw + termW + 2} height={bh} viewBox={`0 0 ${bw + termW + 2} ${bh}`} style={{ display: "block" }}>
      <rect x={0} y={0} width={bw} height={bh} rx={3} fill="none" stroke={color} strokeWidth={1.5} opacity={0.35} />
      <rect x={bw + 1} y={(bh - termH) / 2} width={termW} height={termH} rx={1.5} fill={color} opacity={0.35} />
      {Array.from({ length: BATTERY_SEGS }).map((_, i) => (
        <rect key={i} x={2 + i * (segW + gap)} y={2} width={segW} height={bh - 4} rx={1.5}
          fill={color} opacity={i < filled ? 0.85 : 0.1} />
      ))}
    </svg>
  );
}

export default function Team() {
  usePageTitle("Time");
  const { user } = useAuth();
  const { openJob } = useJobModal();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEditors, setExpandedEditors] = useState<Set<number>>(new Set());
  const [editorTasks, setEditorTasks] = useState<Record<number, EditorTask[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<Set<number>>(new Set());

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ name: "", login: "", password: "", role: "editor", status: "active", jobTitle: "" });
  const [saving, setSaving] = useState(false);

  const isAdmin      = user?.role === "admin";
  const isSupervisor = user?.role === "supervisor";
  const canManage    = isAdmin || isSupervisor;
  const isCoordinator = ["admin", "supervisor", "coordinator"].includes(user?.role ?? "");
  const manageableRoles = isAdmin ? ROLE_OPTIONS : ROLE_OPTIONS.filter(o => ["coordinator", "editor"].includes(o.value));

  const load = () => {
    apiFetch<AppUser[]>("/api/users")
      .then(setUsers)
      .catch(() => toast.error("Erro ao carregar equipe"))
      .finally(() => setLoading(false));

    if (isCoordinator) {
      apiFetch<EditorWorkload[]>("/api/workload")
        .then(data => setWorkload([...data].sort((a, b) => b.score - a.score)))
        .catch(() => {});
    }
  };

  useEffect(load, []);

  const toggleEditor = async (editorId: number) => {
    const next = new Set(expandedEditors);
    if (next.has(editorId)) {
      next.delete(editorId);
      setExpandedEditors(next);
      return;
    }
    next.add(editorId);
    setExpandedEditors(next);
    if (editorTasks[editorId] !== undefined) return;

    setLoadingTasks(prev => { const s = new Set(prev); s.add(editorId); return s; });
    try {
      const tasks = await apiFetch<EditorTask[]>(`/api/users/${editorId}/tasks`);
      setEditorTasks(prev => ({ ...prev, [editorId]: tasks }));
    } catch {
      toast.error("Erro ao carregar tarefas");
    } finally {
      setLoadingTasks(prev => { const s = new Set(prev); s.delete(editorId); return s; });
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", login: "", password: "", role: "editor", status: "active", jobTitle: "" });
    setShowDialog(true);
  };
  const openEdit = (u: AppUser) => {
    setEditing(u);
    setForm({ name: u.name, login: u.login, password: "", role: u.role, status: u.status, jobTitle: u.jobTitle ?? "" });
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.name.trim() || (!editing && (!form.login.trim() || !form.password.trim()))) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiPut(`/api/users/${editing.id}`, {
          name: form.name, login: form.login, role: form.role, status: form.status,
          jobTitle: form.jobTitle || null,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success("Usuário atualizado");
      } else {
        await apiPost("/api/users", form);
        toast.success("Usuário criado");
      }
      setShowDialog(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm("Remover este usuário?")) return;
    try { await apiDelete(`/api/users/${id}`); load(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao remover"); }
  };

  const maxScore = Math.max(...workload.map(e => e.score), 1);
  const others = users.filter(u => u.role !== "editor" && (isAdmin || u.role !== "admin"));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
            <Users className="h-5 w-5 text-[hsl(var(--primary))]" />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Membros</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{users.length} {users.length === 1 ? "membro" : "membros"}</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />Novo usuário
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>
      ) : (
        <>
          {/* ── Editores com carga ─────────────────────────────────── */}
          {isCoordinator && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
                Editores — {workload.length}
              </p>

              {workload.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  Nenhum editor cadastrado.
                </div>
              ) : (
                <div className="space-y-2">
                  {workload.map(editor => {
                    const color = scoreColor(editor.score);
                    const initials = editor.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    const expanded = expandedEditors.has(editor.id);
                    const tasks = editorTasks[editor.id];
                    const loadingT = loadingTasks.has(editor.id);

                    return (
                      <div key={editor.id} className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
                        {/* Row: click to expand */}
                        <button
                          type="button"
                          onClick={() => toggleEditor(editor.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors text-left"
                        >
                          <AvatarDisplay
                            name={editor.name}
                            avatarUrl={editor.avatarUrl}
                            className="shrink-0"
                          />

                          {/* Name + login */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{editor.name}</p>
                            <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">@{editor.login}</p>
                            {(() => { const u = users.find(x => x.id === editor.id); return u?.jobTitle ? <p className="text-xs text-[hsl(var(--muted-foreground))]/70 truncate">{u.jobTitle}</p> : null; })()}
                          </div>

                          {/* Status label */}
                          <span className="text-[10px] font-medium shrink-0 px-2 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>
                            {scoreLabel(editor.score)}
                          </span>

                          {/* Chevron */}
                          {expanded
                            ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />
                          }

                          {/* Edit/Delete — stop propagation */}
                          {canManage && (
                            <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => openEdit(users.find(u => u.id === editor.id) ?? { id: editor.id, name: editor.name, login: editor.login, role: "editor", status: "active" })}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-[hsl(var(--destructive))]"
                                onClick={() => del(editor.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </button>

                        {/* Expanded task list */}
                        {expanded && (
                          <div className="border-t divide-y bg-[hsl(var(--muted))]/10">
                            {loadingT ? (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] px-5 py-3">Carregando tarefas...</p>
                            ) : !tasks || tasks.length === 0 ? (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] px-5 py-3">Nenhuma tarefa atribuída.</p>
                            ) : tasks.map(task => (
                              <div key={task.id} role="button" onClick={() => openJob(task.jobId)}
                                className="flex items-center gap-3 px-5 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                                <div className={`w-0.5 h-7 rounded-full shrink-0 ${STATUS_BAR[task.status] ?? "bg-slate-300"}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{task.title}</p>
                                  {task.jobName && (
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{task.jobName}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {task.dueDate && (() => {
                                    const h = fmtDateHuman(task.dueDate); const n = fmtDate(task.dueDate);
                                    return <span className="flex flex-col items-end gap-0">
                                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{h}</span>
                                      {h !== n && <span className="text-[9px] text-[hsl(var(--muted-foreground))]/40">{n}</span>}
                                    </span>;
                                  })()}
                                  <PriorityBadge priority={task.priority} />
                                  <Badge className={`text-xs px-1.5 ${STATUS_CLASS[task.status] ?? ""}`}>
                                    {STATUS_LABEL[task.status] ?? task.status}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Coordenação ─────────────────────────────────────── */}
          {isCoordinator && others.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60">
                Coordenação — {others.length}
              </p>
              <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden divide-y">
                {others.map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                    <AvatarDisplay
                      name={u.name}
                      avatarUrl={u.avatarUrl}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{u.name}</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">@{u.login}</span>
                        {u.id === user?.id && <Badge variant="outline" className="text-xs px-1.5">você</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs px-1.5">
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                        {u.jobTitle && <span className="text-xs text-[hsl(var(--muted-foreground))]">{u.jobTitle}</span>}
                        {u.status !== "active" && <Badge variant="destructive" className="text-xs px-1.5">Inativo</Badge>}
                      </div>
                    </div>
                    {canManage && (isAdmin || ["coordinator", "editor"].includes(u.role)) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-[hsl(var(--destructive))]"
                        disabled={u.id === user?.id} onClick={() => del(u.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Dialog: criar/editar usuário */}
      {canManage && (
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome completo" />
              </div>
              <div className="space-y-1.5">
                <Label>Login *</Label>
                <Input value={form.login}
                  onChange={e => setForm(f => ({ ...f, login: e.target.value.toLowerCase().replace(/\s/g, "") }))}
                  placeholder="login.usuario" disabled={!!editing} />
              </div>
              <div className="space-y-1.5">
                <Label>{editing ? "Nova senha (deixe em branco para manter)" : "Senha *"}</Label>
                <Input type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label>Função / Cargo</Label>
                <Input
                  value={form.jobTitle}
                  onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))}
                  placeholder="Ex: Motion Designer, Diretor de Arte…"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Perfil de acesso</Label>
                  <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {manageableRoles.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

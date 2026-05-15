import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { FolderOpen, ExternalLink, AlertTriangle, X, UserPlus } from "lucide-react";

interface Editor { id: number; name: string; login: string; role: string; avatarUrl?: string | null; }
interface EditorWorkload { id: number; score: number; taskCount: number; byComplexity: { low: number; medium: number; high: number }; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  editTaskId?: number | null;
  initialDueDate?: string;
}

const EMPTY_FORM = { title: "", description: "", dueDateTime: "", priority: "medium", complexity: "medium", assignedToId: "", folderUrl: "", client: "", color: "#6366f1" };

function workloadLevel(score: number): "ok" | "moderate" | "high" | "critical" {
  if (score <= 3)  return "ok";
  if (score <= 9)  return "moderate";
  if (score <= 18) return "high";
  return "critical";
}

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId, initialDueDate }: Props) {
  const editMode = !!editTaskId;

  const [form, setForm]               = useState(EMPTY_FORM);
  const [taskStatus, setTaskStatus]   = useState<string>("");
  const [saving, setSaving]           = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editors, setEditors]         = useState<Editor[]>([]);
  const [workload, setWorkload]       = useState<EditorWorkload[]>([]);

  // Multiple editors selection
  const [selectedEditorIds, setSelectedEditorIds] = useState<number[]>([]);
  const [addEditorValue, setAddEditorValue]       = useState("none");

  useEffect(() => {
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => x.role === "editor")))
      .catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editMode && editTaskId) {
      setForm(EMPTY_FORM);
      setSelectedEditorIds([]);
      setLoadingEdit(true);
      apiFetch<{ title: string; description: string | null; dueDate: string | null; priority: string; complexity: string; assignedToId: number | null; folderUrl: string | null; client: string | null; color: string; status: string; editors?: { id: number }[] }>(`/api/tasks/${editTaskId}`)
        .then(t => {
          setTaskStatus(t.status ?? "");
          setForm({
            title:        t.title ?? "",
            description:  t.description ?? "",
            dueDateTime:  t.dueDate ?? "",
            priority:     t.priority ?? "medium",
            complexity:   t.complexity ?? "medium",
            assignedToId: t.assignedToId ? String(t.assignedToId) : "",
            folderUrl:    t.folderUrl ?? "",
            client:       t.client ?? "",
            color:        t.color ?? "#6366f1",
          });
          // Populate multi-editor list from editors array
          const ids = t.editors?.map(e => e.id) ?? (t.assignedToId ? [t.assignedToId] : []);
          setSelectedEditorIds(ids);
        })
        .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
        .finally(() => setLoadingEdit(false));
    } else {
      setForm({ ...EMPTY_FORM, dueDateTime: initialDueDate ?? "" });
      setSelectedEditorIds([]);
      setAddEditorValue("none");
    }
  }, [open, editTaskId]);

  // Keep assignedToId in sync with first editor in list
  useEffect(() => {
    const primary = selectedEditorIds[0] ?? null;
    setForm(prev => ({ ...prev, assignedToId: primary ? String(primary) : "" }));
  }, [selectedEditorIds]);

  const addEditor = (idStr: string) => {
    const id = parseInt(idStr, 10);
    if (!isNaN(id) && !selectedEditorIds.includes(id)) {
      setSelectedEditorIds(prev => [...prev, id]);
    }
    setAddEditorValue("none");
  };

  const removeEditor = (id: number) => {
    setSelectedEditorIds(prev => prev.filter(x => x !== id));
  };

  const save = async (publishStatus?: "rascunho" | "pending") => {
    if (!form.title.trim()) { toast.error("Título obrigatório"); return; }
    if (publishStatus === "pending" && selectedEditorIds.length === 0) {
      toast.error("Atribua ao menos um editor para publicar"); return;
    }
    const payload: Record<string, unknown> = {
      title:        form.title,
      description:  form.description || null,
      dueDate:      form.dueDateTime || null,
      priority:     form.priority,
      complexity:   form.complexity,
      assignedToId: selectedEditorIds[0] ?? null,
      editorIds:    selectedEditorIds,
      folderUrl:    form.folderUrl || null,
      client:       form.client || null,
      color:        form.color || "#6366f1",
    };
    if (!editMode && publishStatus) payload.status = publishStatus;
    if (editMode && publishStatus === "pending") payload.status = "pending";
    setSaving(true);
    try {
      if (editMode && editTaskId) {
        await apiPut(`/api/tasks/${editTaskId}`, payload);
        toast.success(publishStatus === "pending" ? "Tarefa publicada" : "Tarefa atualizada");
      } else {
        await apiPost("/api/tasks", payload);
        toast.success(publishStatus === "rascunho" ? "Rascunho salvo" : "Tarefa publicada");
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const f = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));

  const availableEditors = editors.filter(e => !selectedEditorIds.includes(e.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] flex flex-col max-h-[88vh] p-0 gap-0 overflow-hidden">

        {/* Header fixo */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">{editMode ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>

        {/* Corpo scrollável */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingEdit ? (
            <div className="grid grid-cols-2 gap-4 p-6">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="h-9 rounded-lg bg-[hsl(var(--muted))]/50 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
            <div className="flex min-h-0">

              {/* ── Coluna esquerda ─────────────────────────────────── */}
              <div className="flex-1 min-w-0 space-y-4 p-6">

                {/* Título */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Título *</Label>
                  <Input value={form.title} onChange={e => f({ title: e.target.value })} placeholder="Título da tarefa" className="text-sm" />
                </div>

                {/* Descrição */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Descrição</Label>
                  <Textarea value={form.description} onChange={e => f({ description: e.target.value })} rows={5} className="text-sm resize-none" />
                </div>

                {/* Editores */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />Editores atribuídos
                  </Label>

                  {selectedEditorIds.length > 0 && (
                    <div className="rounded-lg border bg-[hsl(var(--muted))]/20 divide-y">
                      {selectedEditorIds.map((id, idx) => {
                        const editor = editors.find(e => e.id === id);
                        if (!editor) return null;
                        const wl = workload.find(w => w.id === id);
                        const level = workloadLevel(wl?.score ?? 0);
                        const cfg: Record<string, { label: string; cls: string }> = {
                          ok:       { label: wl?.score === 0 ? "Livre" : "Tranquilo", cls: "text-green-500" },
                          moderate: { label: "Ocupado",   cls: "text-amber-400"  },
                          high:     { label: "Apertado",  cls: "text-orange-500" },
                          critical: { label: "No limite", cls: "text-red-500"    },
                        };
                        const { label, cls } = cfg[level];
                        return (
                          <div key={id} className="flex items-center gap-2.5 px-3 py-2">
                            <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} style={{ width: 26, height: 26, fontSize: 9, flexShrink: 0 }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{editor.name}</p>
                              {idx === 0 && <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Principal</p>}
                            </div>
                            <span className={`text-xs font-semibold shrink-0 ${cls}`}>{label}</span>
                            <button onClick={() => removeEditor(id)}
                              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors shrink-0">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Select value={addEditorValue} onValueChange={v => { if (v !== "none") addEditor(v); }}>
                    <SelectTrigger className={`text-sm ${selectedEditorIds.length > 0 ? "border-dashed" : ""}`}>
                      <SelectValue placeholder={selectedEditorIds.length === 0 ? "Selecionar editor…" : "+ Adicionar outro editor"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{selectedEditorIds.length === 0 ? "Ninguém" : "+ Adicionar editor"}</SelectItem>
                      {availableEditors.map(e => {
                        const wl = workload.find(w => w.id === e.id);
                        const score = wl?.score ?? 0;
                        const level = workloadLevel(score);
                        const cfg: Record<string, { label: string; cls: string }> = {
                          ok:       { label: score === 0 ? "Livre" : "Tranquilo", cls: score === 0 ? "text-slate-400" : "text-green-500" },
                          moderate: { label: "Ocupado",   cls: "text-amber-400"  },
                          high:     { label: "Apertado",  cls: "text-orange-500" },
                          critical: { label: "No limite", cls: "text-red-500"    },
                        };
                        const { label, cls } = cfg[level];
                        return (
                          <SelectItem key={e.id} value={String(e.id)}>
                            <span className="flex items-center gap-2">{e.name}<span className={`text-xs font-semibold ${cls}`}>{label}</span></span>
                          </SelectItem>
                        );
                      })}
                      {availableEditors.length === 0 && selectedEditorIds.length > 0 && (
                        <div className="px-3 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">Todos os editores já foram adicionados</div>
                      )}
                    </SelectContent>
                  </Select>

                  {(() => {
                    const id = selectedEditorIds[0] ?? null;
                    const wl = id ? workload.find(w => w.id === id) : null;
                    if (!wl) return null;
                    const level = workloadLevel(wl.score);
                    if (level === "ok") return null;
                    const cfg = {
                      moderate: { bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900", icon: "text-amber-500",  text: "text-amber-800 dark:text-amber-300",  msg: "Este editor está ocupado." },
                      high:     { bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900", icon: "text-orange-500", text: "text-orange-800 dark:text-orange-300", msg: "Este editor está com a agenda apertada." },
                      critical: { bg: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900", icon: "text-red-500", text: "text-red-800 dark:text-red-300", msg: "Atenção: este editor está no limite!" },
                    }[level]!;
                    return (
                      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${cfg.bg}`}>
                        <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.icon}`} />
                        <div className={`text-xs ${cfg.text}`}>
                          <p className="font-semibold">{cfg.msg}</p>
                          <p className="mt-0.5 opacity-80">
                            {wl.taskCount} tarefa(s) ativa(s)
                            {(wl.byComplexity?.high   ?? 0) > 0 && ` · ${wl.byComplexity.high} complexa(s)`}
                            {(wl.byComplexity?.medium ?? 0) > 0 && ` · ${wl.byComplexity.medium} moderada(s)`}.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* ── Coluna direita ──────────────────────────────────── */}
              <div className="w-60 shrink-0 space-y-4 p-6 border-l bg-[hsl(var(--muted))]/30">

                {/* Cor + Cliente */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Cliente</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={form.color} onChange={e => f({ color: e.target.value })}
                      className="h-9 w-9 rounded-md border cursor-pointer p-0.5 shrink-0" title="Cor da tarefa" />
                    <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
                  </div>
                </div>

                {/* Prioridade */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Prioridade</Label>
                  <Select value={form.priority} onValueChange={v => f({ priority: v })}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Complexidade */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Complexidade</Label>
                  <Select value={form.complexity} onValueChange={v => f({ complexity: v })}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Simples</SelectItem>
                      <SelectItem value="medium">Moderada</SelectItem>
                      <SelectItem value="high">Complexa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Previsão de entrega */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Previsão de entrega</Label>
                  <DateTimePicker value={form.dueDateTime} onChange={v => f({ dueDateTime: v })} withTime placeholder="Data e horário" />
                </div>

              </div>
            </div>

            {/* Pasta — largura total */}
            <div className="px-6 pb-6 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                <FolderOpen className="h-3.5 w-3.5" />Pasta no servidor
              </Label>
              <div className="flex gap-1.5">
                <Input value={form.folderUrl} onChange={e => f({ folderUrl: e.target.value })} placeholder="https://…" className="text-sm" />
                {form.folderUrl && (
                  <a href={form.folderUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-md border bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] transition-colors">
                    <ExternalLink className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                  </a>
                )}
              </div>
            </div>
            </>
          )}
        </div>

        {/* Footer fixo */}
        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-[hsl(var(--background))]">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {editMode ? (
            <>
              {taskStatus === "rascunho" && (
                <Button variant="outline" onClick={() => save(undefined)} disabled={saving || loadingEdit}>
                  {saving ? "Salvando…" : "Salvar rascunho"}
                </Button>
              )}
              <Button onClick={() => save(taskStatus === "rascunho" ? "pending" : undefined)} disabled={saving || loadingEdit}>
                {saving ? "Salvando…" : taskStatus === "rascunho" ? "Publicar" : "Salvar"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => save("rascunho")} disabled={saving}>
                {saving ? "Salvando…" : "Salvar rascunho"}
              </Button>
              <Button onClick={() => save("pending")} disabled={saving}>
                {saving ? "Salvando…" : "Publicar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

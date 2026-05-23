import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { SubtaskFormRow, type SubtaskRow } from "@/components/ui/subtask-form-row";
import {
  FolderOpen, ExternalLink, AlertTriangle, X, Layers, FileText, Plus,
  ChevronRight, ArrowRight, Zap, Users, Calendar, Palette, Tag, Link2,
  Send, Save, SquarePen,
} from "lucide-react";

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
const EMPTY_SUBTASK: Omit<SubtaskRow, "id"> = { title: "", editorId: "", dueDate: "" };
let subtaskKeyCounter = 0;
function newSubtaskRow(): SubtaskRow { return { id: String(subtaskKeyCounter++), ...EMPTY_SUBTASK }; }

function workloadLevel(score: number): "ok" | "moderate" | "high" | "critical" {
  if (score <= 3)  return "ok";
  if (score <= 9)  return "moderate";
  if (score <= 18) return "high";
  return "critical";
}

const COLOR_SWATCHES = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#f59e0b", "#10b981", "#06b6d4",
  "#3b82f6", "#64748b", "#78716c", "#1e293b",
];

const PRIORITY_OPTIONS = [
  { value: "low",    label: "Baixa",  dot: "bg-emerald-400", ring: "ring-emerald-400", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  { value: "medium", label: "Média",  dot: "bg-amber-400",   ring: "ring-amber-400",   text: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950/40"   },
  { value: "high",   label: "Alta",   dot: "bg-red-500",     ring: "ring-red-500",     text: "text-red-600 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-950/40"       },
];

const COMPLEXITY_OPTIONS = [
  { value: "low",    label: "Simples",  icon: "·",  ring: "ring-slate-400",  text: "text-slate-600 dark:text-slate-300",  bg: "bg-slate-50 dark:bg-slate-800/60"   },
  { value: "medium", label: "Moderada", icon: "··", ring: "ring-violet-400", text: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40" },
  { value: "high",   label: "Complexa", icon: "···",ring: "ring-orange-400", text: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40" },
];

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId, initialDueDate }: Props) {
  const editMode = !!editTaskId;

  const [form, setForm]               = useState(EMPTY_FORM);
  const [taskStatus, setTaskStatus]   = useState<string>("");
  const [saving, setSaving]           = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editors, setEditors]         = useState<Editor[]>([]);
  const [workload, setWorkload]       = useState<EditorWorkload[]>([]);
  const [selectedEditorIds, setSelectedEditorIds] = useState<number[]>([]);
  const [addEditorValue, setAddEditorValue]       = useState("none");
  const [isMultiTask, setIsMultiTask] = useState(false);
  const [subtasks, setSubtasks]       = useState<SubtaskRow[]>([newSubtaskRow(), newSubtaskRow()]);

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
            title: t.title ?? "", description: t.description ?? "",
            dueDateTime: t.dueDate ?? "", priority: t.priority ?? "medium",
            complexity: t.complexity ?? "medium",
            assignedToId: t.assignedToId ? String(t.assignedToId) : "",
            folderUrl: t.folderUrl ?? "", client: t.client ?? "",
            color: t.color ?? "#6366f1",
          });
          const ids = t.editors?.map(e => e.id) ?? (t.assignedToId ? [t.assignedToId] : []);
          setSelectedEditorIds(ids);
        })
        .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
        .finally(() => setLoadingEdit(false));
    } else {
      setForm({ ...EMPTY_FORM, dueDateTime: initialDueDate ?? "" });
      setSelectedEditorIds([]);
      setAddEditorValue("none");
      setIsMultiTask(false);
      setSubtasks([newSubtaskRow(), newSubtaskRow()]);
    }
  }, [open, editTaskId]);

  useEffect(() => {
    const primary = selectedEditorIds[0] ?? null;
    setForm(prev => ({ ...prev, assignedToId: primary ? String(primary) : "" }));
  }, [selectedEditorIds]);

  const addEditor = (idStr: string) => {
    const id = parseInt(idStr, 10);
    if (!isNaN(id) && !selectedEditorIds.includes(id)) setSelectedEditorIds(prev => [...prev, id]);
    setAddEditorValue("none");
  };
  const removeEditor = (id: number) => setSelectedEditorIds(prev => prev.filter(x => x !== id));

  const save = async (publishStatus?: "rascunho" | "pending") => {
    if (!form.title.trim()) { toast.error("Título obrigatório"); return; }
    const isPublishing = publishStatus === "pending" || (editMode && taskStatus !== "rascunho");

    if (isMultiTask && !editMode) {
      const filledSubtasks = subtasks.filter(s => s.title.trim());
      if (filledSubtasks.length < 1) { toast.error("Adicione ao menos uma subtarefa com título"); return; }
      if (publishStatus === "pending") {
        const missing = filledSubtasks.filter(s => !s.editorId);
        if (missing.length > 0) { toast.error("Atribua um editor a cada subtarefa para publicar"); return; }
      }
      const payload: Record<string, unknown> = {
        taskType: "multi_task", title: form.title, description: form.description || null,
        dueDate: form.dueDateTime || null, priority: form.priority,
        complexity: form.complexity, client: form.client || null,
        color: form.color || "#6366f1", folderUrl: form.folderUrl || null,
        subtasks: filledSubtasks.map((s, i) => ({
          title: s.title, editorId: s.editorId ? parseInt(s.editorId, 10) : null,
          dueDate: s.dueDate || null, subtaskOrder: i,
        })),
      };
      if (publishStatus) payload.status = publishStatus;
      setSaving(true);
      try {
        await apiPost("/api/tasks", payload);
        toast.success(publishStatus === "rascunho" ? "Rascunho salvo" : "Multi-tarefa publicada");
        onOpenChange(false); onSaved();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { setSaving(false); }
      return;
    }

    if (isPublishing && !form.dueDateTime) { toast.error("Informe o prazo antes de salvar"); return; }
    if (publishStatus === "pending" && selectedEditorIds.length === 0) {
      toast.error("Atribua ao menos um editor para publicar"); return;
    }
    const dueDatePayload = form.dueDateTime ? form.dueDateTime
      : (editMode && taskStatus !== "rascunho" ? undefined : null);
    const payload: Record<string, unknown> = {
      title: form.title, description: form.description || null, dueDate: dueDatePayload,
      priority: form.priority, complexity: form.complexity,
      assignedToId: selectedEditorIds[0] ?? null, editorIds: selectedEditorIds,
      folderUrl: form.folderUrl || null, client: form.client || null,
      color: form.color || "#6366f1",
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
      onOpenChange(false); onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const f = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));
  const availableEditors = editors.filter(e => !selectedEditorIds.includes(e.id));
  const updateSubtask = (id: string, patch: Partial<SubtaskRow>) =>
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const removeSubtask = (id: string) => setSubtasks(prev => prev.filter(s => s.id !== id));
  const addSubtask = () => setSubtasks(prev => [...prev, newSubtaskRow()]);

  const primaryWorkload = workload.find(w => w.id === selectedEditorIds[0]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-16px)] sm:max-w-[940px] flex flex-col max-h-[95vh] sm:max-h-[90vh] p-0 gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl">

        {/* ══ ACCENT BAR ══════════════════════════════════════════════════════ */}
        <div className="h-1 w-full shrink-0 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${form.color}, ${form.color}88)` }} />

        {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
        <DialogHeader className="px-6 pt-4 pb-0 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${form.color}20`, border: `1.5px solid ${form.color}40` }}>
                {isMultiTask
                  ? <Layers className="h-4.5 w-4.5" style={{ color: form.color }} />
                  : <SquarePen className="h-4 w-4" style={{ color: form.color }} />
                }
              </div>
              <div>
                <DialogTitle className="text-base font-semibold leading-tight">
                  {editMode ? "Editar tarefa" : isMultiTask ? "Nova multi-tarefa" : "Nova tarefa"}
                </DialogTitle>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  {editMode ? "Atualize os campos e salve" : "Preencha os dados e publique ou salve como rascunho"}
                </p>
              </div>
            </div>
            {/* Fechar */}
            <button
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Tipo de tarefa — só no modo criação ────────────────────────── */}
          {!editMode && (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {/* Card: Simples */}
              <button
                type="button"
                onClick={() => setIsMultiTask(false)}
                className={`
                  relative flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all duration-150
                  ${!isMultiTask
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-sm"
                    : "border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--muted))]/30"
                  }
                `}
              >
                <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${!isMultiTask ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${!isMultiTask ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
                    Tarefa simples
                  </p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">
                    Uma entrega, um ou mais editores
                  </p>
                </div>
                {!isMultiTask && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </button>

              {/* Card: Multi-tarefa */}
              <button
                type="button"
                onClick={() => setIsMultiTask(true)}
                className={`
                  relative flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all duration-150
                  ${isMultiTask
                    ? "border-violet-500 bg-violet-500/5 shadow-sm"
                    : "border-[hsl(var(--border))] hover:border-violet-400/40 hover:bg-[hsl(var(--muted))]/30"
                  }
                `}
              >
                <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isMultiTask ? "bg-violet-500 text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${isMultiTask ? "text-violet-600 dark:text-violet-400" : "text-[hsl(var(--foreground))]"}`}>
                    Multi-tarefa
                  </p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">
                    Divide em subtarefas por editor
                  </p>
                </div>
                {isMultiTask && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-violet-500 flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </button>
            </div>
          )}
        </DialogHeader>

        {/* ══ CORPO SCROLLÁVEL ════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto min-h-0 mt-4">
          {loadingEdit ? (
            <div className="grid grid-cols-2 gap-4 p-6">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-9 rounded-xl bg-[hsl(var(--muted))]/50 animate-pulse" />)}
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row min-h-0">

              {/* ── Coluna principal ──────────────────────────────────────── */}
              <div className="flex-1 min-w-0 space-y-5 px-6 pb-6">

                {/* Título */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Título *</Label>
                  <Input
                    value={form.title}
                    onChange={e => f({ title: e.target.value })}
                    placeholder="Dê um nome claro e objetivo para a tarefa…"
                    className="text-sm h-10 rounded-xl border-[hsl(var(--border))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]/60 bg-[hsl(var(--background))]"
                  />
                </div>

                {/* Descrição */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Briefing / Descrição</Label>
                  <Textarea
                    value={form.description}
                    onChange={e => f({ description: e.target.value })}
                    rows={4}
                    placeholder="Contexto, referências, requisitos do cliente…"
                    className="text-sm resize-none rounded-xl border-[hsl(var(--border))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]/60 bg-[hsl(var(--background))]"
                  />
                </div>

                {/* ── Subtarefas — modo multi-task ──────────────────────── */}
                {isMultiTask && !editMode && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-md bg-violet-500/10 flex items-center justify-center">
                        <Layers className="h-3 w-3 text-violet-500" />
                      </div>
                      <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                        Subtarefas
                      </Label>
                      <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]/70 font-normal normal-case">
                        {subtasks.filter(s => s.title.trim()).length} preenchida(s)
                      </span>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/10 divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
                      {subtasks.map((row, i) => (
                        <div key={row.id} className="px-3 py-2.5 hover:bg-[hsl(var(--muted))]/20 transition-colors">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))]/50 w-4 text-center">{i + 1}</span>
                          </div>
                          <SubtaskFormRow
                            row={row}
                            index={i}
                            editors={editors}
                            onChange={patch => updateSubtask(row.id, patch)}
                            onRemove={() => removeSubtask(row.id)}
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addSubtask}
                      className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border-2 border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:border-violet-400 hover:text-violet-500 hover:bg-violet-500/5 transition-all"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar subtarefa
                    </button>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 flex items-center gap-1.5">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      Prazo geral e editor principal são opcionais — configure por subtarefa.
                    </p>
                  </div>
                )}

                {/* ── Editores — modo simples ───────────────────────────── */}
                {(!isMultiTask || editMode) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-md bg-blue-500/10 flex items-center justify-center">
                        <Users className="h-3 w-3 text-blue-500" />
                      </div>
                      <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                        Editores atribuídos
                      </Label>
                    </div>

                    {/* Lista de editores selecionados */}
                    {selectedEditorIds.length > 0 && (
                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/10 divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
                        {selectedEditorIds.map((id, idx) => {
                          const editor = editors.find(e => e.id === id);
                          if (!editor) return null;
                          const wl = workload.find(w => w.id === id);
                          const level = workloadLevel(wl?.score ?? 0);
                          const cfg: Record<string, { label: string; cls: string; dot: string }> = {
                            ok:       { label: wl?.score === 0 ? "Livre" : "Tranquilo", cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-400" },
                            moderate: { label: "Ocupado",   cls: "text-amber-600 dark:text-amber-400",  dot: "bg-amber-400"  },
                            high:     { label: "Apertado",  cls: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
                            critical: { label: "No limite", cls: "text-red-600 dark:text-red-400",       dot: "bg-red-500"    },
                          };
                          const { label, cls, dot } = cfg[level];
                          return (
                            <div key={id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--muted))]/20 transition-colors">
                              <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} style={{ width: 30, height: 30, fontSize: 10, flexShrink: 0 }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate leading-tight">{editor.name}</p>
                                {idx === 0 && <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 leading-tight">Principal</p>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                                <span className={`text-xs font-semibold ${cls}`}>{label}</span>
                              </div>
                              <button
                                onClick={() => removeEditor(id)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Dropdown adicionar editor */}
                    <Select value={addEditorValue} onValueChange={v => { if (v !== "none") addEditor(v); }}>
                      <SelectTrigger className={`text-sm h-10 rounded-xl ${selectedEditorIds.length > 0 ? "border-dashed" : ""}`}>
                        <SelectValue placeholder={selectedEditorIds.length === 0 ? "Selecionar editor…" : "+ Adicionar outro editor"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{selectedEditorIds.length === 0 ? "Ninguém" : "+ Adicionar editor"}</SelectItem>
                        {availableEditors.map(e => {
                          const wl = workload.find(w => w.id === e.id);
                          const score = wl?.score ?? 0;
                          const level = workloadLevel(score);
                          const cfg: Record<string, { label: string; cls: string }> = {
                            ok:       { label: score === 0 ? "Livre" : "Tranquilo", cls: score === 0 ? "text-slate-400" : "text-emerald-500" },
                            moderate: { label: "Ocupado",   cls: "text-amber-500"  },
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

                    {/* Alerta de carga do editor principal */}
                    {primaryWorkload && workloadLevel(primaryWorkload.score) !== "ok" && (() => {
                      const level = workloadLevel(primaryWorkload.score);
                      const cfg = {
                        moderate: { bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900", icon: "text-amber-500", text: "text-amber-800 dark:text-amber-300", msg: "Este editor está ocupado." },
                        high:     { bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900", icon: "text-orange-500", text: "text-orange-800 dark:text-orange-300", msg: "Agenda apertada." },
                        critical: { bg: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900", icon: "text-red-500", text: "text-red-800 dark:text-red-300", msg: "Atenção: no limite!" },
                      }[level as "moderate" | "high" | "critical"]!;
                      return (
                        <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${cfg.bg}`}>
                          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.icon}`} />
                          <div className={`text-xs ${cfg.text}`}>
                            <p className="font-semibold">{cfg.msg}</p>
                            <p className="mt-0.5 opacity-80">
                              {primaryWorkload.taskCount} tarefa(s) ativa(s)
                              {(primaryWorkload.byComplexity?.high ?? 0) > 0 && ` · ${primaryWorkload.byComplexity.high} complexa(s)`}
                              {(primaryWorkload.byComplexity?.medium ?? 0) > 0 && ` · ${primaryWorkload.byComplexity.medium} moderada(s)`}.
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* ── Sidebar de propriedades ───────────────────────────────── */}
              <div className="w-full lg:w-72 xl:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/15 px-5 py-5 pb-6 space-y-5">

                {/* Cor + Cliente */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-pink-500/10 flex items-center justify-center">
                      <Palette className="h-3 w-3 text-pink-500" />
                    </div>
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Cor & Cliente</Label>
                  </div>
                  {/* Swatches de cor */}
                  <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
                    {COLOR_SWATCHES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => f({ color: c })}
                        className="h-6 w-6 rounded-lg transition-all duration-100 hover:scale-110"
                        style={{
                          backgroundColor: c,
                          boxShadow: form.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                          transform: form.color === c ? "scale(1.15)" : undefined,
                        }}
                        title={c}
                      />
                    ))}
                    {/* Custom color */}
                    <label className="h-6 w-6 rounded-lg border-2 border-dashed border-[hsl(var(--border))] flex items-center justify-center cursor-pointer hover:border-[hsl(var(--muted-foreground))] transition-colors overflow-hidden" title="Cor personalizada">
                      <input type="color" value={form.color} onChange={e => f({ color: e.target.value })} className="absolute opacity-0 w-0 h-0" />
                      <span className="text-[9px] text-[hsl(var(--muted-foreground))]">+</span>
                    </label>
                  </div>
                  <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
                </div>

                {/* Prazo */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-emerald-500/10 flex items-center justify-center">
                      <Calendar className="h-3 w-3 text-emerald-500" />
                    </div>
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      Previsão de entrega
                      {(!isMultiTask || editMode) && <span className="text-destructive ml-0.5">*</span>}
                      {isMultiTask && !editMode && <span className="text-[hsl(var(--muted-foreground))] font-normal normal-case ml-1">(opcional)</span>}
                    </Label>
                  </div>
                  <DateTimePicker
                    value={form.dueDateTime}
                    onChange={v => f({ dueDateTime: v })}
                    withTime
                    min={new Date().toISOString().split("T")[0]}
                    placeholder="Selecionar data e hora…"
                  />
                </div>

                {/* Prioridade — pill buttons */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-red-500/10 flex items-center justify-center">
                      <Zap className="h-3 w-3 text-red-500" />
                    </div>
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Prioridade</Label>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PRIORITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => f({ priority: opt.value })}
                        className={`
                          flex flex-col items-center gap-1 py-2 px-2 rounded-xl border-2 text-xs font-semibold transition-all duration-150
                          ${form.priority === opt.value
                            ? `${opt.bg} ${opt.text} ${opt.ring} ring-2 border-transparent`
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border))]/80 hover:bg-[hsl(var(--muted))]/30"
                          }
                        `}
                      >
                        <span className={`h-2 w-2 rounded-full ${form.priority === opt.value ? opt.dot : "bg-[hsl(var(--muted-foreground))]/30"}`} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Complexidade — pill buttons */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-violet-500/10 flex items-center justify-center">
                      <Tag className="h-3 w-3 text-violet-500" />
                    </div>
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Complexidade</Label>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {COMPLEXITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => f({ complexity: opt.value })}
                        className={`
                          flex flex-col items-center gap-1 py-2 px-2 rounded-xl border-2 text-xs font-semibold transition-all duration-150
                          ${form.complexity === opt.value
                            ? `${opt.bg} ${opt.text} ${opt.ring} ring-2 border-transparent`
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border))]/80 hover:bg-[hsl(var(--muted))]/30"
                          }
                        `}
                      >
                        <span className="font-mono text-[10px] tracking-widest opacity-70">{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pasta no servidor */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-cyan-500/10 flex items-center justify-center">
                      <Link2 className="h-3 w-3 text-cyan-500" />
                    </div>
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Pasta no servidor</Label>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 pointer-events-none" />
                      <Input
                        value={form.folderUrl}
                        onChange={e => f({ folderUrl: e.target.value })}
                        placeholder="https://…"
                        className="text-sm h-9 rounded-xl pl-8 bg-[hsl(var(--background))]"
                      />
                    </div>
                    {form.folderUrl && (
                      <a href={form.folderUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))] transition-colors">
                        <ExternalLink className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                      </a>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* ══ FOOTER ══════════════════════════════════════════════════════════ */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 shrink-0 bg-[hsl(var(--background))] flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-xl border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 transition-colors"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {/* Rascunho */}
            {!editMode && (
              <button
                type="button"
                onClick={() => save("rascunho")}
                disabled={saving}
                className="h-9 px-4 rounded-xl border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Salvando…" : "Salvar rascunho"}
              </button>
            )}
            {editMode && taskStatus === "rascunho" && (
              <button
                type="button"
                onClick={() => save(undefined)}
                disabled={saving || loadingEdit}
                className="h-9 px-4 rounded-xl border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Salvando…" : "Salvar rascunho"}
              </button>
            )}

            {/* Publicar / Salvar — botão primário com cor da tarefa */}
            <button
              type="button"
              onClick={() => save(editMode
                ? (taskStatus === "rascunho" ? "pending" : undefined)
                : "pending"
              )}
              disabled={saving || loadingEdit}
              className="h-9 px-5 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-95 disabled:opacity-50 flex items-center gap-2 shadow-sm"
              style={{ backgroundColor: form.color }}
            >
              {editMode && taskStatus !== "rascunho"
                ? <><ChevronRight className="h-4 w-4" />{saving ? "Salvando…" : "Salvar alterações"}</>
                : <><Send className="h-3.5 w-3.5" />{saving ? "Publicando…" : "Publicar tarefa"}</>
              }
            </button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

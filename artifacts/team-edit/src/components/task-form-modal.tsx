import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { SubtaskFormRow, type SubtaskRow } from "@/components/ui/subtask-form-row";
import {
  FolderOpen, ExternalLink, AlertTriangle, X,
  Layers, FileText, Plus, Users, Calendar, Tag, Link2, Send, Save, SquarePen, CalendarDays, Clock,
} from "lucide-react";
import { EditorAvailabilityModal } from "@/components/editor-availability-modal";

interface Editor { id: number; name: string; login: string; role: string; avatarUrl?: string | null; }
interface EditorWorkload {
  id: number; score: number; taskCount: number;
  scheduledCount?: number; scheduledScore?: number; projectedScore?: number;
  byComplexity: { low: number; medium: number; high: number };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  editTaskId?: number | null;
  initialDueDate?: string;
  hidePublish?: boolean;
}

const EMPTY_FORM = {
  title: "", description: "", startDateTime: "", dueDateTime: "", priority: "medium",
  complexity: "medium", assignedToId: "", folderUrl: "", client: "",
};
const EMPTY_SUBTASK: Omit<SubtaskRow, "id"> = { title: "", editorId: "", dueDate: "" };
let subtaskKeyCounter = 0;
function newSubtaskRow(): SubtaskRow { return { id: String(subtaskKeyCounter++), ...EMPTY_SUBTASK }; }

// cinza=disponível | verde=ocupado | laranja=muito ocupado | vermelho=no limite
function scoreColor(score: number): string {
  if (score === 0)  return "#94a3b8";
  if (score <= 6)    return "#eab308"; // amarelo — Ocupado
  if (score <= 11)  return "#f97316";
  return "#ef4444";
}
function scoreLabel(score: number): string {
  if (score === 0)  return "Disponível";
  if (score <= 6)   return "Ocupado";
  if (score <= 11)  return "Muito ocupado";
  return "No limite";
}

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId, initialDueDate, hidePublish }: Props) {
  const editMode = !!editTaskId;

  const [form, setForm]               = useState(EMPTY_FORM);
  const [taskStatus, setTaskStatus]   = useState<string>("");
  const [taskType,   setTaskType]     = useState<string>("task");
  const [saving, setSaving]           = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editors, setEditors]         = useState<Editor[]>([]);
  const [workload, setWorkload]             = useState<EditorWorkload[]>([]);
  const [projectedWorkload, setProjectedWorkload] = useState<EditorWorkload[]>([]);
  const [selectedEditorIds, setSelectedEditorIds] = useState<number[]>([]);
  const [addEditorValue, setAddEditorValue]       = useState("none");
  const [isMultiTask, setIsMultiTask] = useState(false);
  const [subtasks, setSubtasks]       = useState<SubtaskRow[]>([newSubtaskRow(), newSubtaskRow()]);
  const [availModalEditorId, setAvailModalEditorId] = useState<number | null>(null);
  const [periodCheck,   setPeriodCheck]   = useState<{ blocked: boolean; conflictDays: string[]; maxScore: number } | null>(null);
  const [checkingPeriod, setCheckingPeriod] = useState(false);

  useEffect(() => {
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => x.role === "editor")))
      .catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
  }, []);

  // Quando startDateTime muda, busca carga projetada para aquela data
  useEffect(() => {
    if (!form.startDateTime) { setProjectedWorkload([]); return; }
    const date = form.startDateTime.split("T")[0];
    apiFetch<EditorWorkload[]>(`/api/workload?date=${date}`).then(setProjectedWorkload).catch(() => {});
  }, [form.startDateTime]);

  // Nível 3 — verifica conflito de capacidade no período completo da tarefa
  useEffect(() => {
    const primaryId = selectedEditorIds[0];
    if (!primaryId || !form.startDateTime || !form.dueDateTime || isMultiTask) {
      setPeriodCheck(null); return;
    }
    const startDate = form.startDateTime.split("T")[0];
    const endDate   = form.dueDateTime.split("T")[0];
    if (startDate > endDate) { setPeriodCheck(null); return; }
    setCheckingPeriod(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ editorId: String(primaryId), startDate, endDate, complexity: form.complexity });
      if (editMode && editTaskId) params.set("excludeTaskId", String(editTaskId));
      apiFetch<{ blocked: boolean; conflictDays: string[]; maxScore: number }>(
        `/api/workload/period-check?${params}`
      ).then(r => { setPeriodCheck(r); setCheckingPeriod(false); })
       .catch(() => { setPeriodCheck(null); setCheckingPeriod(false); });
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEditorIds[0], form.startDateTime, form.dueDateTime, form.complexity, isMultiTask, editMode, editTaskId]);

  useEffect(() => {
    if (!open) return;
    if (editMode && editTaskId) {
      setForm(EMPTY_FORM);
      setSelectedEditorIds([]);
      setLoadingEdit(true);
      apiFetch<{
        title: string; description: string | null; startDate: string | null; dueDate: string | null;
        priority: string; complexity: string; assignedToId: number | null;
        folderUrl: string | null; client: string | null; status: string;
        taskType: string; editors?: { id: number }[];
        subtasks?: { id: number; title: string; assignedToId: number | null; editorId?: string }[];
      }>(`/api/tasks/${editTaskId}`)
        .then(t => {
          setTaskStatus(t.status ?? "");
          setTaskType(t.taskType ?? "task");
          setIsMultiTask(t.taskType === "multi_task");
          setForm({
            title: t.title ?? "", description: t.description ?? "",
            startDateTime: t.startDate ?? "",
            dueDateTime: t.dueDate ?? "", priority: t.priority ?? "medium",
            complexity: t.complexity ?? "medium",
            assignedToId: t.assignedToId ? String(t.assignedToId) : "",
            folderUrl: t.folderUrl ?? "", client: t.client ?? "",
          });
          const ids = t.editors?.map(e => e.id) ?? (t.assignedToId ? [t.assignedToId] : []);
          setSelectedEditorIds(ids);
          // Populate subtasks for multi_task edit
          if (t.taskType === "multi_task" && Array.isArray(t.subtasks)) {
            setSubtasks(t.subtasks.map((s, i) => ({
              id: String(subtaskKeyCounter++),
              title: s.title,
              editorId: s.assignedToId ? String(s.assignedToId) : "",
              dueDate: "",
            })));
          }
        })
        .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
        .finally(() => setLoadingEdit(false));
    } else {
      setForm({ ...EMPTY_FORM, dueDateTime: initialDueDate ?? "" });
      setSelectedEditorIds([]);
      setAddEditorValue("none");
      setIsMultiTask(false);
      setTaskType("task");
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
    // ── Validações globais — todos os campos obrigatórios ──────────────────
    if (!form.title.trim())       { toast.error("Título obrigatório");              return; }
    if (!form.description.trim()) { toast.error("Direcionamento obrigatório");      return; }
    if (!form.client?.trim())     { toast.error("Cliente obrigatório");             return; }
    if (!form.dueDateTime)        { toast.error("Entrega obrigatória");             return; }
    if (!form.folderUrl?.trim())  { toast.error("Pasta / Arquivos obrigatório");    return; }
    if (!isMultiTask && selectedEditorIds.length === 0) {
      toast.error("Atribua ao menos um editor"); return;
    }

    // ── Nível 1: bloqueio se editor já está no limite de capacidade ────────
    if (!isMultiTask && !editMode && selectedEditorIds.length > 0) {
      const WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };
      const newWeight     = WEIGHT[form.complexity] ?? 6;
      const wl            = activeWorkload.find(w => w.id === selectedEditorIds[0]);
      const existingScore = isFutureStart ? (wl?.projectedScore ?? wl?.score ?? 0) : (wl?.score ?? 0);
      if (existingScore + newWeight > 12) {
        const editorName = editors.find(e => e.id === selectedEditorIds[0])?.name ?? "Editor";
        toast.error(`${editorName} está no limite de capacidade. Escolha outro editor ou altere a data de início.`);
        return;
      }
    }

    // ── Nível 3: bloqueio por conflito de período ──────────────────────────
    if (!isMultiTask && periodCheck?.blocked) {
      const days = periodCheck.conflictDays.slice(0, 3)
        .map(d => { const [,m,day] = d.split("-"); return `${day}/${m}`; }).join(", ");
      const extra = periodCheck.conflictDays.length > 3 ? ` +${periodCheck.conflictDays.length - 3} dias` : "";
      toast.error(`Conflito de capacidade no período: ${days}${extra}. Ajuste as datas ou escolha outro editor.`);
      return;
    }

    const isPublishing = publishStatus === "pending" || (editMode && taskStatus !== "rascunho");

    // ── Multi-task create ──────────────────────────────────────────────────
    if (isMultiTask && !editMode) {
      const filledSubtasks = subtasks.filter(s => s.title.trim());
      if (filledSubtasks.length < 1) { toast.error("Adicione ao menos uma subtarefa"); return; }
      if (publishStatus === "pending") {
        const missing = filledSubtasks.filter(s => !s.editorId);
        if (missing.length > 0) { toast.error("Atribua um editor a cada subtarefa"); return; }
      }
      const payload: Record<string, unknown> = {
        taskType: "multi_task",
        title: form.title, description: form.description || null,
        startDate: form.startDateTime || null,
        dueDate: form.dueDateTime || null, priority: form.priority,
        complexity: form.complexity, client: form.client || null,
        folderUrl: form.folderUrl || null,
        subtasks: filledSubtasks.map((s, i) => ({
          title: s.title,
          editorId: s.editorId ? parseInt(s.editorId, 10) : null,
          dueDate: form.dueDateTime || null, // prazo da pai aplica a todas
          subtaskOrder: i,
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

    // ── Multi-task edit ────────────────────────────────────────────────────
    if (isMultiTask && editMode) {
      const payload: Record<string, unknown> = {
        title: form.title, description: form.description || null,
        startDate: form.startDateTime || null,
        dueDate: form.dueDateTime || null, priority: form.priority,
        complexity: form.complexity, client: form.client || null,
        folderUrl: form.folderUrl || null,
      };
      if (publishStatus === "pending") payload.status = "pending";
      setSaving(true);
      try {
        await apiPut(`/api/tasks/${editTaskId}`, payload);
        toast.success("Multi-tarefa atualizada");
        onOpenChange(false); onSaved();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { setSaving(false); }
      return;
    }

    // ── Tarefa simples ─────────────────────────────────────────────────────
    const dueDatePayload = form.dueDateTime ? form.dueDateTime
      : (editMode && taskStatus !== "rascunho" ? undefined : null);
    const payload: Record<string, unknown> = {
      title: form.title, description: form.description || null,
      startDate: form.startDateTime || null,
      dueDate: dueDatePayload, priority: form.priority, complexity: form.complexity,
      assignedToId: selectedEditorIds[0] ?? null, editorIds: selectedEditorIds,
      folderUrl: form.folderUrl || null, client: form.client || null,
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
  // Se há startDate futura, usa carga projetada; senão, usa carga atual
  const todayIso = new Date().toISOString().split("T")[0];
  const isFutureStart = !!form.startDateTime && form.startDateTime.split("T")[0] > todayIso;
  const activeWorkload = (isFutureStart && projectedWorkload.length > 0) ? projectedWorkload : workload;
  const primaryWorkload = activeWorkload.find(w => w.id === selectedEditorIds[0]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-16px)] sm:max-w-[900px] flex flex-col max-h-[95vh] sm:max-h-[90vh] p-0 gap-0 overflow-hidden rounded-2xl border shadow-2xl [&>button]:hidden">

        {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${isMultiTask ? "bg-violet-100 dark:bg-violet-950/40" : "bg-[hsl(var(--primary))]/10"}`}>
              {isMultiTask
                ? <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                : <SquarePen className="h-4 w-4 text-[hsl(var(--primary))]" />
              }
            </div>
            <DialogTitle className="text-base font-semibold">
              {editMode
                ? (isMultiTask ? "Editar multi-tarefa" : "Editar tarefa")
                : (isMultiTask ? "Nova multi-tarefa" : "Nova tarefa")
              }
            </DialogTitle>
          </div>

          {/* Tipo — apenas criação */}
          {!editMode && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setIsMultiTask(false)}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-3.5 py-2.5 text-left transition-all ${!isMultiTask ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40"}`}
              >
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${!isMultiTask ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className={`text-sm font-semibold leading-tight ${!isMultiTask ? "text-[hsl(var(--primary))]" : ""}`}>Tarefa simples</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-tight">Um editor, uma entrega</p>
                </div>
                {!isMultiTask && <div className="ml-auto h-4 w-4 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center shrink-0"><svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}
              </button>
              <button type="button" onClick={() => setIsMultiTask(true)}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-3.5 py-2.5 text-left transition-all ${isMultiTask ? "border-violet-500 bg-violet-500/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40"}`}
              >
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${isMultiTask ? "bg-violet-500 text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                  <Layers className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className={`text-sm font-semibold leading-tight ${isMultiTask ? "text-violet-600 dark:text-violet-400" : ""}`}>Multi-tarefa</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-tight">Divide em subtarefas</p>
                </div>
                {isMultiTask && <div className="ml-auto h-4 w-4 rounded-full bg-violet-500 flex items-center justify-center shrink-0"><svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}
              </button>
            </div>
          )}
        </DialogHeader>

        {/* ══ CORPO SCROLLÁVEL ════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingEdit ? (
            <div className="grid grid-cols-2 gap-4 p-6">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-9 rounded-xl bg-[hsl(var(--muted))]/50 animate-pulse" />)}
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row min-h-0">

              {/* ── Coluna principal ──────────────────────────────────── */}
              <div className="flex-1 min-w-0 space-y-4 p-5 pb-6">

                {/* Título */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Título *</Label>
                  <Input value={form.title} onChange={e => f({ title: e.target.value })}
                    placeholder="Nome da tarefa" className="text-sm h-9 rounded-xl" />
                </div>

                {/* Direcionamento */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Direcionamento *</Label>
                  <Textarea value={form.description} onChange={e => f({ description: e.target.value })}
                    rows={4} placeholder="Briefing, referências ou observações…" className="text-sm resize-none rounded-xl" />
                </div>

                {/* Pasta / Link */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Pasta / Arquivos *</Label>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 pointer-events-none" />
                      <Input value={form.folderUrl} onChange={e => f({ folderUrl: e.target.value })}
                        placeholder="https://drive.google.com/… ou caminho da pasta" className="text-sm h-9 rounded-xl pl-8" />
                    </div>
                    {form.folderUrl && (
                      <a href={form.folderUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                        <ExternalLink className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                      </a>
                    )}
                  </div>
                </div>

                {/* ── Subtarefas — criação ───────────────────────────── */}
                {isMultiTask && !editMode && (
                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />Subtarefas *
                    </Label>
                    <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]/60">
                      {subtasks.map((row, i) => (
                        <div key={row.id} className="px-3 py-2.5 bg-[hsl(var(--muted))]/10 hover:bg-[hsl(var(--muted))]/20 transition-colors">
                          <SubtaskFormRow
                            row={row} index={i} editors={editors} workload={workload}
                            onChange={patch => updateSubtask(row.id, patch)}
                            onRemove={() => removeSubtask(row.id)}
                          />
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={addSubtask}
                      className="w-full flex items-center justify-center gap-2 h-8 rounded-xl border-2 border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:border-violet-400 hover:text-violet-500 hover:bg-violet-500/5 transition-all">
                      <Plus className="h-3.5 w-3.5" />Adicionar subtarefa
                    </button>
                  </div>
                )}

                {/* ── Subtarefas — edição multi_task ────────────────── */}
                {isMultiTask && editMode && subtasks.length > 0 && (
                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />Subtarefas *
                    </Label>
                    <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]/60">
                      {subtasks.map((row, i) => (
                        <div key={row.id} className="px-3 py-2.5 bg-[hsl(var(--muted))]/10">
                          <SubtaskFormRow
                            row={row} index={i} editors={editors} workload={workload}
                            onChange={patch => updateSubtask(row.id, patch)}
                            onRemove={() => removeSubtask(row.id)}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                      Para aprovar ou solicitar alteração em subtarefas use a listagem.
                    </p>
                  </div>
                )}

                {/* ── Editores — tarefa simples ─────────────────────── */}
                {(!isMultiTask || editMode && taskType === "task") && (
                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />Editores <span className="text-destructive">*</span>
                    </Label>

                    {selectedEditorIds.length > 0 && (
                      <div className="rounded-xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
                        {selectedEditorIds.map((id, idx) => {
                          const editor = editors.find(e => e.id === id);
                          if (!editor) return null;
                          const wl = activeWorkload.find(w => w.id === id);
                          const score = isFutureStart ? (wl?.projectedScore ?? wl?.score ?? 0) : (wl?.score ?? 0);
                          const color = scoreColor(score);
                          const label = scoreLabel(score);
                          return (
                            <div key={id} className="flex items-center gap-2.5 px-3 py-2 bg-[hsl(var(--muted))]/10 hover:bg-[hsl(var(--muted))]/20 transition-colors">
                              <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={28} className="shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{editor.name}</p>
                                {idx === 0 && <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60">Principal</p>}
                              </div>
                              <div className="flex flex-col items-end shrink-0 gap-0.5">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>{label}</span>
                                {isFutureStart && wl?.scheduledScore != null && wl.scheduledScore > 0 && (
                                  <span className="text-[9px] text-[hsl(var(--muted-foreground))]">+{wl.scheduledCount ?? 0} agendada(s)</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setAvailModalEditorId(id)}
                                title="Ver disponibilidade no calendário"
                                className="h-6 w-6 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors shrink-0">
                                <CalendarDays className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => removeEditor(id)}
                                className="h-6 w-6 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <Select value={addEditorValue} onValueChange={v => { if (v !== "none") addEditor(v); }}>
                      <SelectTrigger className={`text-sm h-9 rounded-xl ${selectedEditorIds.length > 0 ? "border-dashed" : ""}`}>
                        <SelectValue placeholder={selectedEditorIds.length === 0 ? "Selecionar editor…" : "+ Adicionar editor"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{selectedEditorIds.length === 0 ? "Ninguém" : "+ Adicionar editor"}</SelectItem>
                        {availableEditors.map(e => {
                          const wl    = activeWorkload.find(w => w.id === e.id);
                          const score = isFutureStart ? (wl?.projectedScore ?? wl?.score ?? 0) : (wl?.score ?? 0);
                          const color = scoreColor(score);
                          const label = scoreLabel(score);
                          return (
                            <SelectItem key={e.id} value={String(e.id)}>
                              <span className="flex items-center gap-2">
                                {e.name}
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>{label}</span>
                              </span>
                            </SelectItem>
                          );
                        })}
                        {availableEditors.length === 0 && selectedEditorIds.length > 0 && (
                          <div className="px-3 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">Todos os editores adicionados</div>
                        )}
                      </SelectContent>
                    </Select>

                    {primaryWorkload && (() => {
                      const score = isFutureStart ? (primaryWorkload.projectedScore ?? primaryWorkload.score) : primaryWorkload.score;
                      if (score <= 6) return null;
                      const isCritical = score >= 12;
                      const bg   = isCritical ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900" : "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900";
                      const icon = isCritical ? "text-red-500" : "text-orange-500";
                      const text = isCritical ? "text-red-800 dark:text-red-300" : "text-orange-800 dark:text-orange-300";
                      const msg  = isCritical ? "Editor no limite de capacidade!" : "Editor muito ocupado.";
                      return (
                        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${bg}`}>
                          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${icon}`} />
                          <p className={`text-xs ${text}`}>{msg}</p>
                        </div>
                      );
                    })()}

                    {/* Nível 3 — conflito de capacidade no período */}
                    {!isMultiTask && periodCheck?.blocked && (
                      <div className="flex items-start gap-2 rounded-xl border px-3 py-2 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                        <div>
                          <p className="text-xs font-semibold text-red-800 dark:text-red-300">Conflito de capacidade no período</p>
                          <p className="text-[10px] text-red-700 dark:text-red-400 mt-0.5">
                            Dias sobrecarregados:{" "}
                            {periodCheck.conflictDays.slice(0, 3).map(d => { const [,m,day]=d.split("-"); return `${day}/${m}`; }).join(", ")}
                            {periodCheck.conflictDays.length > 3 ? ` +${periodCheck.conflictDays.length - 3}` : ""}
                          </p>
                        </div>
                      </div>
                    )}
                    {!isMultiTask && checkingPeriod && selectedEditorIds.length > 0 && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 animate-pulse">Verificando disponibilidade no período...</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Sidebar propriedades ──────────────────────────────── */}
              <div className="w-full lg:w-64 xl:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/15 px-5 py-5 pb-6 space-y-4">

                {/* Cliente */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Cliente *</Label>
                  <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
                </div>

                {/* Prazo (+ Início opcional) */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      Entrega{(!isMultiTask || editMode) && <span className="text-destructive ml-0.5">*</span>}
                      {isMultiTask && !editMode && <span className="text-[hsl(var(--muted-foreground))] font-normal normal-case ml-1 text-[10px]">(opcional)</span>}
                    </Label>
                  </div>
                  <DateRangePicker
                    startDate={form.startDateTime}
                    endDate={form.dueDateTime}
                    onChangeStart={v => f({ startDateTime: v })}
                    onChangeEnd={v => f({ dueDateTime: v })}
                    withEndTime
                    placeholder="Selecionar início → prazo…"
                  />
                  {isFutureStart && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-snug">
                      Carga projetada para a data de início
                    </p>
                  )}
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 leading-snug">
                    Clique uma vez para só o prazo, ou escolha início → prazo
                  </p>
                </div>

                {/* Prioridade */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Prioridade *</Label>
                  <Select value={form.priority} onValueChange={v => f({ priority: v })}>
                    <SelectTrigger className="h-9 rounded-xl text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Complexidade */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Complexidade *</Label>
                  </div>
                  <Select value={form.complexity} onValueChange={v => f({ complexity: v })}>
                    <SelectTrigger className="h-9 rounded-xl text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Simples</SelectItem>
                      <SelectItem value="medium">Moderada</SelectItem>
                      <SelectItem value="high">Complexa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>


              </div>
            </div>
          )}
        </div>

        {/* ══ FOOTER ══════════════════════════════════════════════════════════ */}
        <div className="px-5 py-3.5 border-t border-[hsl(var(--border))]/60 shrink-0 bg-[hsl(var(--background))] flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="rounded-xl h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            {/* Rascunho */}
            {!editMode && (
              <Button variant="outline" size="sm" className="rounded-xl h-9 gap-1.5"
                onClick={() => save("rascunho")} disabled={saving}>
                <Save className="h-3.5 w-3.5" />{saving ? "Salvando…" : "Rascunho"}
              </Button>
            )}
            {editMode && taskStatus === "rascunho" && (
              <Button variant="outline" size="sm" className="rounded-xl h-9 gap-1.5"
                onClick={() => save(undefined)} disabled={saving || loadingEdit}>
                <Save className="h-3.5 w-3.5" />{saving ? "Salvando…" : "Salvar rascunho"}
              </Button>
            )}
            {/* Publicar / Salvar — oculto ao editar/criar rascunho quando hidePublish=true ou taskStatus=rascunho */}
            {(editMode ? taskStatus !== "rascunho" : !hidePublish) && (
              <Button size="sm" className="rounded-xl h-9 gap-1.5"
                onClick={() => save(editMode ? undefined : "pending")}
                disabled={saving || loadingEdit}>
                {editMode && taskStatus !== "rascunho"
                  ? <>{saving ? "Salvando…" : "Salvar"}</>
                  : <><Send className="h-3.5 w-3.5" />{saving ? "Publicando…" : "Publicar"}</>
                }
              </Button>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>

    <EditorAvailabilityModal
      open={availModalEditorId !== null}
      onOpenChange={v => { if (!v) setAvailModalEditorId(null); }}
      editor={availModalEditorId !== null ? (editors.find(e => e.id === availModalEditorId) ?? null) : null}
    />
  </>
  );
}

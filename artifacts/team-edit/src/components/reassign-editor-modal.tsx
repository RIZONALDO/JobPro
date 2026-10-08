import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { UserPlus, UserMinus, RefreshCw, X, AlertTriangle } from "lucide-react";
import { AbsenceBadge } from "@/components/ui/absence-badge";
import { absenceShort, type Absence } from "@/lib/availability";

interface Editor { id: number; name: string; avatarUrl?: string | null; login?: string; absence?: Absence | null; }
interface EditorWorkload { id: number; score: number; taskCount: number; absence?: Absence | null; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  taskId: number;
  taskTitle: string;
  currentAssignedTo: Editor | null;
  mode: "reassign" | "add";
}

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

export function ReassignEditorModal({ open, onOpenChange, onSaved, taskId, taskTitle, currentAssignedTo, mode }: Props) {
  const [editors,  setEditors]  = useState<Editor[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [taskEditors, setTaskEditors] = useState<Editor[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    apiFetch<Editor[]>("/api/users?active=1").then(u => setEditors(u.filter(x => (x as any).role === "editor"))).catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
    apiFetch<Editor[]>(`/api/tasks/${taskId}/editors`).then(setTaskEditors).catch(() => {});
  }, [open, taskId]);

  const save = async () => {
    if (!selectedId) { toast.error("Selecione um editor"); return; }
    setSaving(true);
    try {
      if (mode === "reassign") {
        await apiPost(`/api/tasks/${taskId}/reassign`, { editorId: parseInt(selectedId) });
        toast.success("Tarefa reatribuída com sucesso");
      } else {
        await apiPost(`/api/tasks/${taskId}/editors`, { editorId: parseInt(selectedId) });
        toast.success("Editor adicionado com sucesso");
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const removeEditor = async (editorId: number, editorName: string) => {
    setRemoving(editorId);
    try {
      await apiDelete(`/api/tasks/${taskId}/editors/${editorId}`);
      setTaskEditors(prev => prev.filter(e => e.id !== editorId));
      toast.success(`${editorName} removido da tarefa`);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    } finally { setRemoving(null); }
  };

  const Icon = mode === "reassign" ? RefreshCw : UserPlus;
  const title = mode === "reassign" ? "Reatribuir tarefa" : "Adicionar editor";

  // Filter already-assigned editors from the selection list
  const assignedIds = new Set(taskEditors.map(e => e.id));
  if (currentAssignedTo && mode === "reassign") assignedIds.delete(currentAssignedTo.id); // can reassign to same? no, filter
  const availableEditors = editors.filter(e => mode === "add" ? !assignedIds.has(e.id) : true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md"
        onInteractOutside={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Task info */}
          <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2.5">
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">Tarefa</p>
            <p className="text-sm font-medium truncate">{taskTitle}</p>
          </div>

          {/* Current assignment (reassign mode) */}
          {mode === "reassign" && currentAssignedTo && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">Editor atual</p>
              <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
                <AvatarDisplay name={currentAssignedTo.name} avatarUrl={currentAssignedTo.avatarUrl} style={{ width: 28, height: 28, fontSize: 10 }} />
                <span className="text-sm font-medium">{currentAssignedTo.name}</span>
                <Badge className="ml-auto text-[10px] px-1.5 bg-orange-100 text-orange-700 border-orange-200">atual</Badge>
              </div>
            </div>
          )}

          {/* Additional editors list (add mode) */}
          {mode === "add" && taskEditors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">Editores na tarefa</p>
              <div className="space-y-1.5">
                {taskEditors.map(e => (
                  <div key={e.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 24, height: 24, fontSize: 9 }} />
                    <span className="text-sm flex-1 truncate">{e.name}</span>
                    {e.id === currentAssignedTo?.id && (
                      <Badge className="text-[10px] px-1.5 shrink-0">principal</Badge>
                    )}
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-[hsl(var(--muted-foreground))] hover:text-red-600"
                      disabled={removing === e.id}
                      onClick={() => removeEditor(e.id, e.name)}
                    >
                      {removing === e.id ? <span className="animate-spin text-xs">○</span> : <X className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Select new editor */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">
              {mode === "reassign" ? "Novo editor" : "Adicionar editor"}
            </p>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar editor…" />
              </SelectTrigger>
              <SelectContent>
                {availableEditors.map(e => {
                  const wl = workload.find(w => w.id === e.id);
                  const score = wl?.score ?? 0;
                  const color = scoreColor(score);
                  const label = scoreLabel(score);
                  return (
                    <SelectItem key={e.id} value={String(e.id)}>
                      <span className="flex items-center gap-2">
                        {e.name}
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>{label}</span>
                        <AbsenceBadge absence={wl?.absence ?? e.absence} />
                      </span>
                    </SelectItem>
                  );
                })}
                {availableEditors.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    Todos os editores já estão atribuídos
                  </div>
                )}
              </SelectContent>
            </Select>
            {(() => {
              const sel = editors.find(e => String(e.id) === selectedId);
              const abs = sel ? (workload.find(w => w.id === sel.id)?.absence ?? sel.absence) : null;
              if (!sel || !abs) return null;
              return (
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">{sel.name}: {absenceShort(abs).toLowerCase()}. Você ainda pode atribuir.</p>
                </div>
              );
            })()}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !selectedId || availableEditors.length === 0}>
            {saving ? "Salvando…" : mode === "reassign" ? "Reatribuir" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { UserPlus, UserMinus, RefreshCw, X } from "lucide-react";

interface Editor { id: number; name: string; avatarUrl?: string | null; login?: string; }
interface EditorWorkload { id: number; score: number; taskCount: number; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  taskId: number;
  taskTitle: string;
  currentAssignedTo: Editor | null;
  mode: "reassign" | "add";
}

function workloadBadge(score: number) {
  if (score === 0) return { label: "Livre", cls: "text-slate-400" };
  if (score <= 3)  return { label: "Tranquilo", cls: "text-green-500" };
  if (score <= 9)  return { label: "Ocupado",   cls: "text-amber-400" };
  if (score <= 18) return { label: "Apertado",  cls: "text-orange-500" };
  return { label: "No limite", cls: "text-red-500" };
}

export function ReassignEditorModal({ open, onOpenChange, onSaved, taskId, taskTitle, currentAssignedTo, mode }: Props) {
  const { toast } = useToast();
  const [editors,  setEditors]  = useState<Editor[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [taskEditors, setTaskEditors] = useState<Editor[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    apiFetch<Editor[]>("/api/users").then(u => setEditors(u.filter(x => (x as any).role === "editor"))).catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
    apiFetch<Editor[]>(`/api/tasks/${taskId}/editors`).then(setTaskEditors).catch(() => {});
  }, [open, taskId]);

  const save = async () => {
    if (!selectedId) { toast({ title: "Selecione um editor", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (mode === "reassign") {
        await apiPost(`/api/tasks/${taskId}/reassign`, { editorId: parseInt(selectedId) });
        toast({ title: "Tarefa reatribuída com sucesso" });
      } else {
        await apiPost(`/api/tasks/${taskId}/editors`, { editorId: parseInt(selectedId) });
        toast({ title: "Editor adicionado com sucesso" });
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao salvar", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const removeEditor = async (editorId: number, editorName: string) => {
    setRemoving(editorId);
    try {
      await apiDelete(`/api/tasks/${taskId}/editors/${editorId}`);
      setTaskEditors(prev => prev.filter(e => e.id !== editorId));
      toast({ title: `${editorName} removido da tarefa` });
      onSaved();
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao remover", variant: "destructive" });
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
      <DialogContent className="max-w-md">
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
                  const { label, cls } = workloadBadge(wl?.score ?? 0);
                  return (
                    <SelectItem key={e.id} value={String(e.id)}>
                      <span className="flex items-center gap-2">
                        {e.name}
                        <span className={`text-xs font-semibold ${cls}`}>{label}</span>
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

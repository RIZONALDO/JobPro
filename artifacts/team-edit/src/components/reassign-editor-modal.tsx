import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { UserPlus, RefreshCw, X } from "lucide-react";

interface Editor { id: number; name: string; avatarUrl?: string | null; login?: string; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  taskId: number;
  taskTitle: string;
  currentAssignedTo: Editor | null;
  mode: "reassign" | "add";
}

export function ReassignEditorModal({ open, onOpenChange, onSaved, taskId, taskTitle, currentAssignedTo, mode }: Props) {
  const [editors,     setEditors]     = useState<Editor[]>([]);
  const [taskEditors, setTaskEditors] = useState<Editor[]>([]);
  const [selectedId,  setSelectedId]  = useState("");
  const [saving,   setSaving]   = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    apiFetch<Editor[]>("/api/users").then(u => setEditors(u.filter(x => (x as any).role === "editor"))).catch(() => {});
    apiFetch<Editor[]>(`/api/tasks/${taskId}/editors`).then(setTaskEditors).catch(() => {});
  }, [open, taskId]);

  const save = async () => {
    if (!selectedId) { toast.error("Selecione um editor"); return; }
    setSaving(true);
    try {
      if (mode === "reassign") {
        await apiPost(`/api/tasks/${taskId}/reassign`, { editorId: parseInt(selectedId) });
        toast.success("Tarefa reatribuída");
      } else {
        await apiPost(`/api/tasks/${taskId}/editors`, { editorId: parseInt(selectedId) });
        toast.success("Editor adicionado");
      }
      onOpenChange(false); onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const removeEditor = async (editorId: number, editorName: string) => {
    setRemoving(editorId);
    try {
      await apiDelete(`/api/tasks/${taskId}/editors/${editorId}`);
      setTaskEditors(prev => prev.filter(e => e.id !== editorId));
      toast.success(`${editorName} removido`);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    } finally { setRemoving(null); }
  };

  const Icon = mode === "reassign" ? RefreshCw : UserPlus;
  const assignedIds = new Set(taskEditors.map(e => e.id));
  const availableEditors = editors.filter(e => mode === "add" ? !assignedIds.has(e.id) : true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
            {mode === "reassign" ? "Reatribuir tarefa" : "Adicionar editor"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2.5">
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">Tarefa</p>
            <p className="text-sm font-medium truncate">{taskTitle}</p>
          </div>

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

          {mode === "add" && taskEditors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">Editores na tarefa</p>
              <div className="space-y-1.5">
                {taskEditors.map(e => (
                  <div key={e.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 24, height: 24, fontSize: 9 }} />
                    <span className="text-sm flex-1 truncate">{e.name}</span>
                    {e.id === currentAssignedTo?.id && <Badge className="text-[10px] px-1.5 shrink-0">principal</Badge>}
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-[hsl(var(--muted-foreground))] hover:text-red-600"
                      disabled={removing === e.id} onClick={() => removeEditor(e.id, e.name)}>
                      {removing === e.id ? <span className="animate-spin text-xs">○</span> : <X className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">
              {mode === "reassign" ? "Novo editor" : "Adicionar editor"}
            </p>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger><SelectValue placeholder="Selecionar editor…" /></SelectTrigger>
              <SelectContent>
                {availableEditors.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    <span className="flex items-center gap-2">
                      <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 20, height: 20, fontSize: 8 }} />
                      {e.name}
                    </span>
                  </SelectItem>
                ))}
                {availableEditors.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">Todos os editores já estão atribuídos</div>
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

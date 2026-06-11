import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { RefreshCw, UserPlus, X, Search } from "lucide-react";

interface Editor { id: number; name: string; avatarUrl?: string | null; login?: string; }
interface EditorWorkload { id: number; hoursToday: number; dailyCap: number; taskCount: number; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  taskId: number;
  taskTitle: string;
  currentAssignedTo: Editor | null;
  mode: "reassign" | "add";
}

function loadColor(h: number, cap: number) {
  if (!cap || !h) return "#94a3b8";
  const p = h / cap;
  if (p <= 0.5) return "#eab308";
  if (p < 1)   return "#f97316";
  return "#ef4444";
}
function loadLabel(h: number, cap: number) {
  if (!cap || !h) return "Disponível";
  const p = h / cap;
  if (p <= 0.5) return "Ocupado";
  if (p < 1)   return "Muito ocupado";
  return "No limite";
}

export function ReassignEditorModal({ open, onOpenChange, onSaved, taskId, taskTitle, currentAssignedTo, mode }: Props) {
  const [editors,     setEditors]     = useState<Editor[]>([]);
  const [workload,    setWorkload]    = useState<EditorWorkload[]>([]);
  const [taskEditors, setTaskEditors] = useState<Editor[]>([]);
  const [selectedId,  setSelectedId] = useState<number | null>(null);
  const [search,      setSearch]     = useState("");
  const [saving,      setSaving]     = useState(false);
  const [removing,    setRemoving]   = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setSearch("");
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => (x as any).role === "editor")))
      .catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
    apiFetch<Editor[]>(`/api/tasks/${taskId}/editors`).then(setTaskEditors).catch(() => {});
  }, [open, taskId]);

  const save = async () => {
    if (!selectedId) { toast.error("Selecione um editor"); return; }
    setSaving(true);
    try {
      if (mode === "reassign") {
        await apiPost(`/api/tasks/${taskId}/reassign`, { editorId: selectedId });
        toast.success("Tarefa reatribuída");
      } else {
        await apiPost(`/api/tasks/${taskId}/editors`, { editorId: selectedId });
        toast.success("Editor adicionado");
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const removeEditor = async (editorId: number, name: string) => {
    setRemoving(editorId);
    try {
      await apiDelete(`/api/tasks/${taskId}/editors/${editorId}`);
      setTaskEditors(prev => prev.filter(e => e.id !== editorId));
      toast.success(`${name} removido da tarefa`);
      onSaved();
    } catch { toast.error("Erro ao remover"); }
    finally { setRemoving(null); }
  };

  const assignedIds = new Set(taskEditors.map(e => e.id));
  const available = editors.filter(e => mode === "add" ? !assignedIds.has(e.id) : true);
  const filtered  = available.filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()));

  const title = mode === "reassign" ? "Reatribuir editor" : "Adicionar editor";
  const Icon  = mode === "reassign" ? RefreshCw : UserPlus;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[85vh]">
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 space-y-1 shrink-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
            <p className="text-xl font-black tracking-tight">{title}</p>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] truncate">{taskTitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-5 space-y-4">

          {/* Editor atual (reassign) */}
          {mode === "reassign" && currentAssignedTo && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Editor atual</p>
              <div className="rounded-2xl border px-3.5 py-3 bg-amber-500/5 border-amber-500/20 flex items-center gap-2.5">
                <AvatarDisplay name={currentAssignedTo.name} avatarUrl={currentAssignedTo.avatarUrl} size={28} />
                <span className="text-sm font-semibold flex-1 truncate">{currentAssignedTo.name}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">atual</span>
              </div>
            </div>
          )}

          {/* Editores na tarefa (add mode) */}
          {mode === "add" && taskEditors.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Na tarefa</p>
              <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
                {taskEditors.map(e => (
                  <div key={e.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={26} />
                    <span className="text-sm flex-1 truncate font-medium">{e.name}</span>
                    {e.id === currentAssignedTo?.id && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">principal</span>
                    )}
                    <button onClick={() => removeEditor(e.id, e.name)} disabled={removing === e.id}
                      className="h-6 w-6 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Seleção de novo editor */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              {mode === "reassign" ? "Novo editor" : "Adicionar"}
            </p>

            {/* Search */}
            <div className="flex items-center gap-2 h-9 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3">
              <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/40 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar editor…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]/35" />
            </div>

            {/* Lista */}
            <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]/60 overflow-hidden">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-[hsl(var(--muted-foreground))]/50 py-6">
                  {available.length === 0 ? "Todos os editores já estão atribuídos" : "Nenhum resultado"}
                </p>
              ) : filtered.map(e => {
                const wl    = workload.find(w => w.id === e.id);
                const color = loadColor(wl?.hoursToday ?? 0, wl?.dailyCap ?? 8);
                const label = loadLabel(wl?.hoursToday ?? 0, wl?.dailyCap ?? 8);
                const on    = selectedId === e.id;
                return (
                  <button key={e.id} onClick={() => setSelectedId(on ? null : e.id)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors
                      ${on ? "bg-[hsl(var(--primary))]/8" : "hover:bg-[hsl(var(--muted))]/40"}`}>
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={28} />
                    <span className="text-sm font-medium flex-1 truncate">{e.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: `${color}22`, color }}>{label}</span>
                    <div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-all
                      ${on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
                      {on && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
          <button onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            Cancelar
          </button>
          <button onClick={save} disabled={saving || !selectedId}
            className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors"
            style={{ background: "hsl(var(--primary))" }}>
            {saving ? "Salvando…" : mode === "reassign" ? "Reatribuir" : "Adicionar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

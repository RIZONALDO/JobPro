import { useState, useEffect } from "react";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { FolderOpen, ExternalLink, X, Send, UserPlus } from "lucide-react";

interface Editor { id: number; name: string; login: string; role: string; avatarUrl?: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  editTaskId?: number | null;
  initialStartDate?: string;
  initialDueDate?: string;
  initialEditorId?: number;
}

const EMPTY_FORM = { title: "", description: "", startDateTime: "", dueDateTime: "", folderUrl: "", client: "" };

const labelCls = "block text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-1.5";
const inputCls = "w-full rounded-2xl border border-zinc-700 bg-zinc-950/40 text-zinc-100 px-3 py-2.5 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]/30 transition-all placeholder:text-zinc-500";

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId, initialStartDate, initialDueDate, initialEditorId }: Props) {
  const editMode = !!editTaskId;

  const [form, setForm]               = useState(EMPTY_FORM);
  const [taskStatus, setTaskStatus]   = useState("");
  const [saving, setSaving]           = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editors, setEditors]         = useState<Editor[]>([]);
  const [selectedEditorIds, setSelectedEditorIds] = useState<number[]>([]);
  const [editorPanelOpen, setEditorPanelOpen]     = useState(false);

  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  useEffect(() => {
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => x.role === "editor")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editMode && editTaskId) {
      setForm(EMPTY_FORM); setSelectedEditorIds([]); setLoadingEdit(true);
      apiFetch<{
        title: string; description: string | null; startDate: string | null; dueDate: string | null;
        folderUrl: string | null; client: string | null; status: string;
        editors?: { id: number }[]; assignedToId: number | null;
      }>(`/api/tasks/${editTaskId}`)
        .then(t => {
          setTaskStatus(t.status ?? "");
          setForm({ title: t.title ?? "", description: t.description ?? "", startDateTime: t.startDate ?? "", dueDateTime: t.dueDate ?? "", folderUrl: t.folderUrl ?? "", client: t.client ?? "" });
          setSelectedEditorIds(t.editors?.map(e => e.id) ?? (t.assignedToId ? [t.assignedToId] : []));
        })
        .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
        .finally(() => setLoadingEdit(false));
    } else {
      setForm({ ...EMPTY_FORM, startDateTime: initialStartDate ?? "", dueDateTime: initialDueDate ?? "" });
      setSelectedEditorIds(initialEditorId ? [initialEditorId] : []);
      setEditorPanelOpen(false); setTaskStatus("");
    }
  }, [open, editTaskId]);

  const addEditor = (id: number) => {
    if (!selectedEditorIds.includes(id)) setSelectedEditorIds(prev => [...prev, id]);
  };

  const save = async () => {
    if (!form.title.trim())       { toast.error("Título obrigatório");           return; }
    if (!form.description.trim()) { toast.error("Direcionamento obrigatório");   return; }
    if (!form.client?.trim())     { toast.error("Cliente obrigatório");          return; }
    if (!form.folderUrl?.trim())  { toast.error("Pasta / Arquivos obrigatório"); return; }
    if (!form.dueDateTime)        { toast.error("Data de entrega obrigatória");  return; }
    if (selectedEditorIds.length === 0) { toast.error("Atribua ao menos um editor"); return; }

    const payload: Record<string, unknown> = {
      title: form.title, description: form.description || null,
      startDate: form.startDateTime || null, dueDate: form.dueDateTime || null,
      assignedToId: selectedEditorIds[0] ?? null, editorIds: selectedEditorIds,
      folderUrl: form.folderUrl || null, client: form.client || null,
    };
    if (!editMode) payload.status = "pending";

    setSaving(true);
    try {
      if (editMode && editTaskId) {
        await apiPut(`/api/tasks/${editTaskId}`, payload);
        toast.success("Tarefa atualizada");
      } else {
        await apiPost("/api/tasks", payload);
        toast.success("Tarefa publicada");
      }
      onOpenChange(false); onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const f = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));
  const availableEditors = editors.filter(e => !selectedEditorIds.includes(e.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-16px)] sm:max-w-md p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[90vh]"
        onInteractOutside={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{editMode ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>

        {/* Header com título + editores */}
        <div className="px-6 pt-7 pb-4 border-b border-[hsl(var(--border))]/40">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xl font-black tracking-tight">{editMode ? "Editar tarefa" : "Nova tarefa"}</p>

            <div className="flex items-center gap-2 shrink-0">
              {/* Avatares selecionados */}
              {selectedEditorIds.length > 0 && (
                <div className="flex items-center">
                  {selectedEditorIds.slice(0, 4).map((id, i) => {
                    const e = editors.find(x => x.id === id);
                    if (!e) return null;
                    return (
                      <div key={id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: selectedEditorIds.length - i }}
                        className="relative group">
                        <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={28}
                          className="ring-2 ring-[hsl(var(--card))]" />
                        <button
                          onClick={() => setSelectedEditorIds(prev => prev.filter(x => x !== id))}
                          className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-red-500 rounded-full hidden group-hover:flex items-center justify-center">
                          <X className="h-2 w-2 text-white" />
                        </button>
                      </div>
                    );
                  })}
                  {selectedEditorIds.length > 4 && (
                    <div style={{ marginLeft: -8 }} className="h-7 w-7 rounded-full bg-[hsl(var(--muted))] ring-2 ring-[hsl(var(--card))] flex items-center justify-center text-[10px] font-bold">
                      +{selectedEditorIds.length - 4}
                    </div>
                  )}
                </div>
              )}

              {/* Botão add editor */}
              <button
                onClick={() => setEditorPanelOpen(v => !v)}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-all ${
                  editorPanelOpen
                    ? "bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]"
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/50 hover:text-[hsl(var(--foreground))]"
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                {selectedEditorIds.length === 0 ? "Add editor" : "Editores"}
              </button>
            </div>
          </div>

          {/* Fan picker */}
          <div className={`mt-3 overflow-hidden transition-all duration-200 ${editorPanelOpen ? "max-h-24 opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="relative h-16 flex items-center justify-end">
              {editors.map((e, i) => {
                const selected = selectedEditorIds.includes(e.id);
                const spacing = 36;
                const total = editors.length;
                return (
                  <button key={e.id} type="button"
                    onClick={() => {
                      if (!selected) addEditor(e.id);
                      setEditorPanelOpen(false);
                    }}
                    className="absolute flex flex-col items-center gap-1 group"
                    style={{
                      right: 0,
                      transform: editorPanelOpen ? `translateX(-${i * spacing}px)` : "translateX(0px)",
                      transitionProperty: "transform, opacity",
                      transitionDuration: "180ms",
                      transitionTimingFunction: "cubic-bezier(0.34,1.3,0.64,1)",
                      transitionDelay: editorPanelOpen ? `${(total - 1 - i) * 35}ms` : `${i * 20}ms`,
                      zIndex: editors.length - i,
                    }}
                  >
                    <div className={`relative rounded-full transition-transform duration-150 group-hover:scale-110 ${selected ? "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--card))]" : ""}`}>
                      <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={38} />
                      {selected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center">
                          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] font-medium text-[hsl(var(--muted-foreground))] max-w-[44px] truncate">
                      {e.name.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loadingEdit ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-10 rounded-2xl bg-[hsl(var(--muted))]/40 animate-pulse" />)}
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>Título *</label>
                <input className={inputCls} value={form.title} onChange={e => f({ title: e.target.value })} placeholder="Nome da tarefa" />
              </div>

              <div>
                <label className={labelCls}>Cliente *</label>
                <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
              </div>

              <div>
                <label className={labelCls}>Início <span className="normal-case text-[hsl(var(--muted-foreground))]/40 font-normal">(opcional)</span></label>
                <DatePicker value={form.startDateTime} onChange={v => f({ startDateTime: v })} placeholder="DD/MM/AAAA HH:MM" withTime className="w-full border-zinc-700 bg-zinc-950/40 text-zinc-100 rounded-2xl" />
              </div>

              <div>
                <label className={labelCls}>Entrega *</label>
                <DatePicker value={form.dueDateTime} onChange={v => f({ dueDateTime: v })} placeholder="DD/MM/AAAA HH:MM" minDate={todayIso} withTime className="w-full border-zinc-700 bg-zinc-950/40 text-zinc-100 rounded-2xl" />
              </div>

              <div>
                <label className={labelCls}>Direcionamento *</label>
                <textarea className={`${inputCls} resize-none`} rows={4} value={form.description} onChange={e => f({ description: e.target.value })} placeholder="Briefing, referências ou observações…" />
              </div>

              <div>
                <label className={labelCls}>Pasta / Arquivos *</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50 pointer-events-none" />
                    <input className={`${inputCls} pl-9`} value={form.folderUrl} onChange={e => f({ folderUrl: e.target.value })} placeholder="https://drive.google.com/…" />
                  </div>
                  {form.folderUrl && (
                    <a href={form.folderUrl} target="_blank" rel="noreferrer"
                      className="h-10 w-10 flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                      <ExternalLink className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    </a>
                  )}
                </div>
              </div>

            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
          <button onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-full border border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
            Cancelar
          </button>
          <button onClick={() => save()} disabled={saving || loadingEdit}
            className="h-9 px-6 rounded-full font-black text-sm text-white bg-[hsl(var(--primary))] hover:opacity-90 flex items-center gap-1.5 transition-opacity disabled:opacity-50">
            {editMode
              ? saving ? "Salvando…" : "Salvar"
              : <><Send className="h-3.5 w-3.5" />{saving ? "Publicando…" : "Publicar"}</>
            }
          </button>
        </div>

      </DialogContent>
    </Dialog>
  );
}

/**
 * Modal de edição de metadados da tarefa — campos que NÃO afetam o algoritmo ESCALA.
 *
 * Campos sensíveis ao ESCALA (datas, editores, horas) são gerenciados exclusivamente
 * pelo menu de 3 pontos na listagem (Alterar prazo, Reatribuir editor, Adicionar editor).
 */
import { useState, useEffect } from "react";
import { apiFetch, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { FolderOpen, ExternalLink, Save, Layers, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  editTaskId?: number | null;
}

const EMPTY = {
  title: "", description: "", client: "", folderUrl: "",
  priority: "medium", complexity: "medium",
};

const PRIORITY_LABELS: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId }: Props) {
  const { user } = useAuth();
  const hideComplexity = user?.role !== "admin";

  const [form, setForm]       = useState(EMPTY);
  const [taskCode, setTaskCode] = useState("");
  const [taskType, setTaskType] = useState("task");
  const [saving, setSaving]   = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !editTaskId) return;
    setLoading(true);
    apiFetch<{
      title: string; description: string | null; client: string | null;
      folderUrl: string | null; priority: string; complexity: string;
      taskNumber?: number; taskYear?: number; taskType: string;
    }>(`/api/tasks/${editTaskId}`)
      .then(t => {
        setTaskCode(t.taskNumber && t.taskYear ? `${String(t.taskNumber).padStart(3,"0")}.${String(t.taskYear).slice(-2)}` : "");
        setTaskType(t.taskType ?? "task");
        setForm({
          title:       t.title ?? "",
          description: t.description ?? "",
          client:      t.client ?? "",
          folderUrl:   t.folderUrl ?? "",
          priority:    t.priority ?? "medium",
          complexity:  t.complexity ?? "medium",
        });
      })
      .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
      .finally(() => setLoading(false));
  }, [open, editTaskId]);

  const f = (patch: Partial<typeof EMPTY>) => setForm(prev => ({ ...prev, ...patch }));

  const save = async () => {
    if (!form.title.trim())  { toast.error("Título obrigatório");  return; }
    if (!form.client?.trim()){ toast.error("Cliente obrigatório"); return; }
    setSaving(true);
    try {
      await apiPut(`/api/tasks/${editTaskId}`, {
        title:       form.title,
        description: form.description || null,
        client:      form.client || null,
        folderUrl:   form.folderUrl || null,
        priority:    form.priority,
        ...(!hideComplexity ? { complexity: form.complexity } : {}),
      });
      toast.success("Tarefa atualizada");
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-16px)] sm:max-w-md p-0 gap-0 overflow-hidden rounded-3xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[88vh]">
        <DialogTitle className="sr-only">Editar tarefa</DialogTitle>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="px-6 py-12 flex items-center justify-center gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          ) : (
            <div className="px-6 pt-7 pb-5 space-y-6">

              {/* ── Identidade da tarefa (somente leitura) ─────────────── */}
              {(taskCode || taskType !== "task") && (
                <div className="flex items-center gap-2">
                  {taskCode && (
                    <span className="font-mono text-[11px] font-bold tracking-tight text-[hsl(var(--primary))]/60">
                      {taskCode}
                    </span>
                  )}
                  {taskType === "multi_task" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
                      <Layers className="h-3 w-3" />Multi-tarefa
                    </span>
                  )}
                  {taskType === "task" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))]">
                      <FileText className="h-3 w-3" />Tarefa simples
                    </span>
                  )}
                </div>
              )}

              {/* ── Título ────────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Título <span className="text-destructive">*</span>
                </p>
                <input
                  value={form.title}
                  onChange={e => f({ title: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && !saving && save()}
                  placeholder="Nome da tarefa…"
                  className="w-full h-11 px-0 text-xl font-black border-0 border-b-2 bg-transparent focus:outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))]/25"
                  style={{ borderBottomColor: form.title ? "hsl(var(--primary))" : "hsl(var(--border))" }}
                />
              </div>

              {/* ── Briefing ──────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Briefing
                </p>
                <Textarea
                  value={form.description}
                  onChange={e => f({ description: e.target.value })}
                  rows={3}
                  placeholder="Direcionamento, referências ou observações…"
                  className="text-sm resize-none rounded-2xl bg-[hsl(var(--muted))]/30 border-[hsl(var(--border))]"
                />
              </div>

              {/* ── Cliente ────────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Cliente <span className="text-destructive">*</span>
                </p>
                <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
              </div>

              {/* ── Pasta / Arquivos ───────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Pasta / Arquivos
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/40 pointer-events-none" />
                    <Input
                      value={form.folderUrl}
                      onChange={e => f({ folderUrl: e.target.value })}
                      placeholder="https://drive.google.com/…"
                      className="pl-9 h-10 rounded-2xl text-sm"
                    />
                  </div>
                  {form.folderUrl && (
                    <a href={form.folderUrl} target="_blank" rel="noreferrer"
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                      <ExternalLink className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                    </a>
                  )}
                </div>
              </div>

              {/* ── Prioridade ─────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Prioridade
                </p>
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map(p => (
                    <button key={p} type="button" onClick={() => f({ priority: p })}
                      className={`flex-1 h-9 rounded-full text-xs font-bold transition-all border
                        ${form.priority === p
                          ? p === "high"   ? "bg-red-500   border-red-500   text-white"
                          : p === "medium" ? "bg-amber-500 border-amber-500 text-white"
                          :                  "bg-slate-500 border-slate-500 text-white"
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50"
                        }`}>
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Complexidade (admin) ────────────────────────────────── */}
              {!hideComplexity && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    Complexidade
                  </p>
                  <Select value={form.complexity} onValueChange={v => f({ complexity: v })}>
                    <SelectTrigger className="h-10 rounded-2xl text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Simples</SelectItem>
                      <SelectItem value="medium">Moderada</SelectItem>
                      <SelectItem value="high">Complexa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 shrink-0 flex items-center justify-between bg-[hsl(var(--card))]">
          <button type="button" onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving || loading}
            className="h-9 px-6 rounded-full text-sm font-black text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
            style={{ background: "hsl(var(--primary))" }}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

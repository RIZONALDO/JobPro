/**
 * RescheduleModal — Reagenda uma tarefa ESCALA existente.
 *
 * Fluxo:
 *  1. Coordenador informa novo prazo
 *  2. Algoritmo roda GET /api/escala/options com o editor atual + novo prazo
 *  3. Mostra slots encontrados na agenda do editor
 *  4. Coordenador confirma → PUT deadline + POST allocate
 *
 * Não permite edição manual de datas — o algoritmo decide os slots.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { todayStr, parseDate } from "@/lib/date";
import { toast } from "sonner";
import { CalendarDays, Clock, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface HourSlot { date: string; hours: number; startTime?: string; endTime?: string; }
interface EditorOption {
  editor: { id: number; name: string; login: string; avatarUrl: string | null };
  possible: boolean;
  slots: HourSlot[];
  projectedCompletion: string | null;
  hoursFound: number;
  hoursNeeded: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  task: {
    id: number;
    title: string;
    effortHours: number;
    editor: { id: number; name: string; avatarUrl?: string | null } | null;
    dueDate: string | null;
  };
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function fmtSlots(slots: HourSlot[]) {
  return slots.map(s =>
    `${fmtDate(s.date)}${s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : ` · ${s.hours}h`}`
  ).join("  ·  ");
}

export function RescheduleModal({ open, onOpenChange, onSaved, task }: Props) {
  // Não pré-preenche com prazo vencido — coordenador precisa escolher nova data
  const initDeadline = (): string => {
    if (!task.dueDate) return "";
    const d = parseDate(task.dueDate);
    return d > new Date() ? task.dueDate : "";
  };

  const [newDeadline, setNewDeadline] = useState(initDeadline);
  const [searching,   setSearching]   = useState(false);
  const [result,      setResult]      = useState<EditorOption | null>(null);
  const [searched,    setSearched]    = useState(false);
  const [confirming,  setConfirming]  = useState(false);

  const today = todayStr();

  const reset = () => {
    setResult(null);
    setSearched(false);
  };

  const search = async () => {
    if (!newDeadline) { toast.error("Selecione o novo prazo"); return; }
    if (!task.editor) { toast.error("Tarefa sem editor atribuído"); return; }
    setSearching(true);
    setResult(null);
    setSearched(false);
    try {
      // Valida client-side que o prazo é futuro antes de chamar a API
      if (parseDate(newDeadline) <= new Date()) {
        toast.error("O novo prazo deve ser uma data futura");
        setSearching(false);
        return;
      }

      const params = new URLSearchParams({
        effortHours:   String(task.effortHours),
        startDate:     new Date().toISOString(),
        mode:          "client",
        deadline:      newDeadline,
        editorId:      String(task.editor.id),
        excludeTaskId: String(task.id),
      });
      const data = await apiFetch<{
        target: EditorOption | null;
        alternatives: EditorOption[];
      }>(`/api/escala/options?${params}`);

      const editorResult = data.target ?? data.alternatives.find(a => a.editor.id === task.editor!.id) ?? null;
      setResult(editorResult);
      setSearched(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("posterior") || msg.includes("deadline")) {
        toast.error("Prazo inválido — selecione uma data futura");
      } else {
        toast.error("Erro ao verificar disponibilidade");
      }
    } finally {
      setSearching(false);
    }
  };

  const confirm = async () => {
    if (!result || !result.possible || !task.editor) return;
    setConfirming(true);
    try {
      // Determina nova startDate a partir do primeiro slot
      const firstSlot = result.slots[0];
      const newStart  = firstSlot
        ? `${firstSlot.date}T${firstSlot.startTime ?? "08:00"}:00`
        : null;

      // 1. Atualiza prazo (e início) na tarefa
      await apiPut(`/api/tasks/${task.id}`, {
        ...(newStart ? { startDate: newStart } : {}),
        dueDate: newDeadline,
      });

      // 2. Re-aloca os slots encontrados pelo ESCALA
      await apiPost(`/api/escala/tasks/${task.id}/allocate`, {
        editorId:   task.editor.id,
        slots:      result.slots,
        effortHours: task.effortHours,
      });

      toast.success("Prazo reagendado pelo ESCALA");
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao reagendar");
    } finally {
      setConfirming(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) { reset(); setNewDeadline(initDeadline()); }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm p-0 gap-0 rounded-3xl border shadow-2xl bg-[hsl(var(--card))] [&>button]:hidden flex flex-col max-h-[90vh]">
        <DialogTitle className="sr-only">Reagendar tarefa</DialogTitle>

        <div className="flex-1 overflow-y-auto px-6 pt-7 pb-5 space-y-5">
          {/* Título */}
          <div>
            <p className="text-xl font-black tracking-tight">Reagendar prazo</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 truncate">{task.title}</p>
          </div>

          {/* Editor + horas */}
          {task.editor && (
            <div className="rounded-2xl border border-[hsl(var(--border))] px-3.5 py-3 bg-[hsl(var(--muted))]/30 flex items-center gap-3">
              <AvatarDisplay name={task.editor.name} avatarUrl={task.editor.avatarUrl} size={30} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{task.editor.name}</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60">editor atribuído</p>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">
                <Clock className="h-3 w-3" />
                {task.effortHours}h
              </div>
            </div>
          )}

          {/* Novo prazo */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              Novo prazo <span className="text-destructive">*</span>
            </p>
            <DatePicker
              value={newDeadline}
              onChange={v => { setNewDeadline(v); reset(); }}
              withTime
              defaultTime={d => new Date(d + "T12:00:00").getDay() === 6 ? "13:00" : "18:00"}
              minDate={today}
              placeholder="DD/MM/AAAA HH:MM"
            />
          </div>

          {/* Resultado da busca */}
          {searched && result && (
            <div className={`rounded-2xl border px-4 py-3.5 space-y-2 ${
              result.possible
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/20"
            }`}>
              {result.possible ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {result.hoursFound}h disponíveis neste prazo
                    </p>
                  </div>
                  <div className="space-y-1">
                    {result.slots.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                        <CalendarDays className="h-3 w-3 shrink-0 text-emerald-500/70" />
                        <span className="font-semibold text-[hsl(var(--foreground))]">{fmtDate(s.date)}</span>
                        {s.startTime && s.endTime && (
                          <span>{s.startTime}–{s.endTime}</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] font-semibold text-emerald-600/80">{s.hours}h</span>
                      </div>
                    ))}
                  </div>
                  {result.projectedCompletion && (
                    <p className="text-[10px] text-emerald-600/60 dark:text-emerald-400/60 pt-1">
                      Conclusão estimada: {fmtDate(result.projectedCompletion)}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-600 dark:text-red-400">
                      Editor sem disponibilidade
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                      Encontrado {result.hoursFound}h de {result.hoursNeeded}h necessárias neste prazo.
                      Tente um prazo maior ou reatribua o editor.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botão verificar */}
          {!searched && (
            <button onClick={search} disabled={searching || !newDeadline}
              className="w-full h-10 rounded-full text-sm font-black border-2 border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/8 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
              {searching
                ? <><Loader2 className="h-4 w-4 animate-spin" />Verificando…</>
                : "Verificar disponibilidade →"}
            </button>
          )}

          {/* Re-buscar depois de ver resultado */}
          {searched && (
            <button onClick={() => { reset(); }}
              className="w-full h-9 rounded-full text-xs font-semibold border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50 transition-colors">
              ← Alterar prazo e verificar novamente
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[hsl(var(--border))]/60 flex items-center justify-between shrink-0">
          <button onClick={() => handleClose(false)}
            className="h-9 px-4 rounded-full text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/60 transition-colors">
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={confirming || !result?.possible}
            className="h-9 px-6 rounded-full text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            {confirming
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Reagendando…</>
              : "Confirmar reagendamento"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

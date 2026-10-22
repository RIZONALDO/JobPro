/**
 * Assinatura do prazo do cliente. Toda mudança de prazo passa por aqui: quem muda assume combinar com o cliente,
 * e o histórico do job guarda o nome, o prazo antigo e o novo.
 *  - SignCheck: a caixa de assinatura (formulário do job, "colocar no fim").
 *  - SignDueDialog: job que vai atrasar → novo prazo, a partir do mais cedo possível pela fila.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Signature } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { fmt, fmtH, lmToIso, toLm, personName, type Board, type QTask } from "@/lib/fila";
import { Btn, inputCls } from "@/components/fila/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const tz = () => { const o = new Date().getTimezoneOffset(), a = Math.abs(o); return `${o <= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; };
/** minutos locais → valor do DatePicker (mesmo formato do formulário do job) */
export const lmToPicker = (lm: number) => { const d = new Date(lmToIso(lm)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${tz()}`; };

export function SignCheck({ checked, onChange, what = "este novo prazo", className }: { checked: boolean; onChange: (v: boolean) => void; what?: string; className?: string }) {
  const { user } = useAuth();
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] transition-colors",
      checked ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.06)]" : "bg-[hsl(var(--background))]", className)}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Signature className="h-4 w-4" />Assinatura</span>
        <span>Eu, <b>{user?.name ?? "gestor"}</b>, assumo a responsabilidade de combinar {what} com o cliente.</span>
      </span>
    </label>
  );
}

export function SignDueDialog({ board, task, open, onOpenChange, onDone }: {
  board: Board; task: QTask | null; open: boolean; onOpenChange: (v: boolean) => void; onDone?: () => void;
}) {
  const min = task?.proposedDue ?? null;
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && min != null) { setDue(lmToPicker(min)); setReason(""); setSigned(false); } }, [open, min]);
  if (!task) return null;
  const valid = !!due && !isNaN(new Date(due).getTime()) && (min == null || toLm(new Date(due)) >= min);

  const sign = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${task.id}/sign-due`, { dueDate: new Date(due).toISOString(), reason: reason.trim() || undefined, signed: true });
      toast.success(r.message ?? "Novo prazo assinado");
      onOpenChange(false); onDone?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(520px,calc(100vw-24px))] max-w-none flex-col gap-4 p-5">
        <DialogTitle className="text-base font-bold">Novo prazo do cliente</DialogTitle>
        <div className="flex flex-col gap-1 text-[13px]">
          <b className="text-[15px]">{task.title}</b>
          <span className="text-[hsl(var(--muted-foreground))]">{task.client ?? "sem cliente"} · {personName(board, task.editorId)}</span>
          <span>Prazo atual <b>{fmt(task.promised)}</b> · pela fila fica pronto <b>{fmt(task.slot?.end)}</b>{task.slot?.lateBy ? <span className="text-rose-500"> (atrasa {fmtH(task.slot.lateBy)})</span> : null}</span>
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          Novo prazo
          <div className="max-w-xs"><DatePicker value={due} onChange={setDue} withTime minDateTime={min != null ? lmToPicker(min) : undefined} /></div>
          {min != null && <span>O mais cedo possível pela fila é <b className="text-[hsl(var(--foreground))]">{fmt(min)}</b> (pronto + 1h de folga, no expediente).</span>}
        </div>
        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Motivo (opcional)
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: cliente mandou material atrasado" className={cn(inputCls, "h-9 text-sm text-[hsl(var(--foreground))]")} /></label>
        <SignCheck checked={signed} onChange={setSigned} />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">Outra saída: feche e use “Passar para outro editor”, se alguém entregar no prazo atual.</span>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={() => onOpenChange(false)}>Cancelar</Btn>
          <Btn v="pri" disabled={!signed || !valid || busy} onClick={sign}>{busy ? "Assinando…" : "Assinar novo prazo"}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

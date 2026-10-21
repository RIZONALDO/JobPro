import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { fmtH } from "@/lib/fila";
import { Btn, inputCls } from "@/components/fila/ui";

/** Peças comuns da página Jobs e dos detalhes do job: fases, cor do cliente e os diálogos curtos de ação. */

/** O mínimo de um job que os diálogos precisam. */
export interface JobRef { id: number; taskCode?: string; title: string; client: string | null; dueDate: string | null }

export type StageKey = "rascunho" | "fila" | "edicao" | "travado" | "cliente" | "entregue" | "cancelado";
export const STAGES: { k: StageKey; label: string; st: string[]; tone: string; open: boolean; hint: string }[] = [
  { k: "rascunho", label: "Rascunho", st: ["rascunho"], tone: "neu", open: true, hint: "Ainda não entrou na fila" },
  { k: "fila", label: "Na fila", st: ["pending"], tone: "acc", open: true, hint: "Esperando a vez do editor" },
  { k: "edicao", label: "Em edição", st: ["in_progress", "in_revision", "reopened"], tone: "acc", open: true, hint: "Editor já começou" },
  { k: "travado", label: "Travado", st: ["paused"], tone: "warn", open: true, hint: "Aguardando algo para continuar" },
  { k: "cliente", label: "Com o cliente", st: ["review"], tone: "warn", open: true, hint: "Esperando aprovação" },
  { k: "entregue", label: "Entregue", st: ["completed"], tone: "ok", open: false, hint: "Cliente aprovou" },
  { k: "cancelado", label: "Cancelado", st: ["cancelled"], tone: "bad", open: false, hint: "" },
];
const PALETTE = ["#2dd4bf", "#f5a524", "#f472b6", "#60a5fa", "#a3e635", "#c084fc", "#fb7185", "#34d399", "#fbbf24", "#38bdf8"];
/** Cor estável por cliente (o mesmo cliente tem sempre a mesma cor em Lista e Clientes). */
export const clientColor = (c: string | null) => { if (!c) return "#71717a"; let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
export const stageOf = (s: string) => STAGES.find(x => x.st.includes(s)) ?? STAGES[1];

/** duração corrida curta: 3h20, 2d */
export const ago = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}d` : fmtH(m));

/* ── diálogos curtos (alteração, reabrir, reativar, encerrar travado, cancelar, excluir) ── */
export type Ask = { kind: "change" | "reopen" | "reactivate" | "archive" | "cancel" | "delete"; job: JobRef };
const ASK_TEXT: Record<Ask["kind"], { title: string; ok: string; danger?: boolean; hours?: boolean; reason?: string; due?: boolean; info: string }> = {
  change: { title: "Cliente pediu alteração", ok: "Mandar para a fila", hours: true, reason: "O que o cliente pediu", info: "Entra logo depois do job atual do editor, como nova rodada com horas próprias." },
  reopen: { title: "Reabrir job entregue", ok: "Reabrir", hours: true, reason: "Motivo da reabertura", info: "Volta para o mesmo editor como nova rodada, logo depois do job atual dele." },
  reactivate: { title: "Reativar job cancelado", ok: "Reativar", due: true, info: "Volta para a fila do mesmo editor, no fim." },
  archive: { title: "Encerrar job travado", ok: "Encerrar", info: "Sai da fila e do calendário do editor. Não conta nos relatórios como entrega nem como atraso." },
  cancel: { title: "Cancelar job", ok: "Cancelar job", danger: true, reason: "Motivo do cancelamento", info: "Sai da fila e as horas liberam a agenda do editor. Dá para reativar depois." },
  delete: { title: "Excluir job", ok: "Excluir de vez", danger: true, info: "Apaga o job e o histórico. Não dá para desfazer." },
};

export function AskDialog({ ask, onClose, onDone }: { ask: Ask | null; onClose: () => void; onDone: () => void }) {
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"delivered" | "dropped">("delivered");
  useEffect(() => { setHours("2"); setReason(""); setOutcome("delivered"); setDue(ask?.job.dueDate && new Date(ask.job.dueDate) > new Date() ? ask.job.dueDate : ""); }, [ask]);
  if (!ask) return null;
  const c = ASK_TEXT[ask.kind], id = ask.job.id;
  const minutes = Math.round((parseFloat(hours.replace(",", ".")) || 0) * 60);
  const missing = (ask.kind === "archive" && outcome === "dropped" && !reason.trim()) || (c.reason && !reason.trim()) || (c.hours && minutes <= 0) || (c.due && !due);

  async function go() {
    setBusy(true);
    try {
      if (ask!.kind === "change") await apiPost(`/api/queue/tasks/${id}/client-change`, { minutes, comment: reason.trim() });
      if (ask!.kind === "reopen") await apiPut(`/api/tasks/${id}`, { status: "reopened", revisionComment: reason.trim(), revisionMinutes: minutes });
      if (ask!.kind === "reactivate") await apiPut(`/api/tasks/${id}`, { status: "pending", dueDate: due });
      if (ask!.kind === "archive") await apiPost(`/api/queue/tasks/${id}/archive`, { outcome, reason: reason.trim() });
      if (ask!.kind === "cancel") await apiPut(`/api/tasks/${id}`, { status: "cancelled", revisionComment: reason.trim() });
      if (ask!.kind === "delete") await apiDelete(`/api/tasks/${id}`);
      toast.success({ change: "Alteração na fila", reopen: "Job reaberto", reactivate: "Job reativado", archive: "Job encerrado", cancel: "Job cancelado", delete: "Job excluído" }[ask!.kind]);
      onClose(); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{c.title}</DialogTitle>
        <p className="-mt-2 text-[13px]"><span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{ask.job.taskCode}</span> <b>{ask.job.title}</b>{ask.job.client && <span className="text-[hsl(var(--muted-foreground))]"> · {ask.job.client}</span>}</p>
        {c.hours && <label className="flex flex-col gap-1 text-[13px] font-semibold">Quanto tempo é necessário para executar a alteração?
          <span className="flex items-center gap-2 font-normal">
            {["1", "2", "4", "8"].map(h => <Btn key={h} size="sm" v={hours === h ? "pri" : "def"} onClick={() => setHours(h)}>{h}h</Btn>)}
            <input type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} className={cn(inputCls, "w-20")} aria-label="Horas" /> horas
          </span>
        </label>}
        {ask.kind === "archive" && <>
          <div className="grid gap-2" role="radiogroup" aria-label="O que aconteceu com o job">
            {([["delivered", "Já foi entregue", "Foi feito e entregue, só não foi fechado aqui. Fica como entregue."],
               ["dropped", "Não vai mais ser feito", "O cliente desistiu ou mudou o plano. Fica como cancelado."]] as const).map(([k, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => setOutcome(k)}
                className={cn("rounded-xl border px-3 py-2 text-left transition-colors", outcome === k ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]" : "hover:bg-[hsl(var(--foreground)/0.04)]")}>
                <b className="block text-[13px]">{t}</b><span className="block text-xs text-[hsl(var(--muted-foreground))]">{d}</span>
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">{outcome === "dropped" ? "Por que não vai mais ser feito" : "Observação (opcional)"}
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={cn(inputCls, "h-auto py-1.5 font-normal")} />
          </label>
        </>}
        {c.reason && <label className="flex flex-col gap-1 text-[13px] font-semibold">{c.reason}
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={cn(inputCls, "h-auto py-1.5 font-normal")} />
        </label>}
        {c.due && <label className="flex flex-col gap-1 text-[13px] font-semibold">Novo prazo do cliente
          <DatePicker value={due} onChange={setDue} withTime minDateTime={new Date().toISOString()} />
        </label>}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{c.info}</p>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={onClose}>Voltar</Btn>
          <Btn v={c.danger ? "danger" : "pri"} disabled={busy || !!missing} onClick={go}>{c.ok}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

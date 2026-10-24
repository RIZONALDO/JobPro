import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtH } from "@/lib/fila";
import { Btn, inputCls } from "@/components/fila/ui";

/** Peças comuns da página Jobs e dos detalhes do job: fases, cor do cliente e os diálogos curtos de ação. */

/** O mínimo de um job que os diálogos precisam. */
export interface JobRef { id: number; taskCode?: string; title: string; client: string | null; dueDate: string | null; est?: number }

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
const ASK_TEXT: Record<Ask["kind"], { title: string; ok: string; danger?: boolean; reason?: string; est?: "required" | "optional"; info: string }> = {
  change: { title: "Cliente pediu alteração", ok: "Mandar para a fila", reason: "O que o cliente pediu", est: "required", info: "Volta para a fila do mesmo editor logo depois do job em edição. O prazo de entrega sai das horas." },
  reopen: { title: "Reabrir job entregue", ok: "Reabrir", reason: "Motivo da reabertura", est: "required", info: "Volta para a fila do mesmo editor logo depois do job em edição. O prazo de entrega sai das horas." },
  reactivate: { title: "Reativar job cancelado", ok: "Reativar", est: "optional", info: "Volta para o fim da fila do mesmo editor. O prazo de entrega sai das horas." },
  archive: { title: "Encerrar job travado", ok: "Encerrar", info: "Sai da fila do editor. Não conta nos relatórios como entrega nem como atraso." },
  cancel: { title: "Cancelar job", ok: "Cancelar job", danger: true, reason: "Motivo do cancelamento", info: "Sai da fila do editor. Dá para reativar depois." },
  delete: { title: "Excluir job", ok: "Excluir de vez", danger: true, info: "Apaga o job e o histórico. Não dá para desfazer." },
};

export function AskDialog({ ask, onClose, onDone }: { ask: Ask | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [est, setEst] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"delivered" | "dropped">("delivered");
  useEffect(() => { setReason(""); setOutcome("delivered"); setEst(ask?.kind === "reactivate" && ask.job.est ? ask.job.est : null); }, [ask]);
  if (!ask) return null;
  const c = ASK_TEXT[ask.kind], id = ask.job.id;
  const missing = (ask.kind === "archive" && outcome === "dropped" && !reason.trim()) || (c.reason && !reason.trim()) || (c.est === "required" && !est);

  async function go() {
    setBusy(true);
    try {
      let r: unknown;
      if (ask!.kind === "change") r = await apiPost(`/api/queue/tasks/${id}/client-change`, { comment: reason.trim(), estMinutes: est });
      if (ask!.kind === "reopen") r = await apiPut(`/api/tasks/${id}`, { status: "reopened", revisionComment: reason.trim(), estMinutes: est });
      if (ask!.kind === "reactivate") r = await apiPut(`/api/tasks/${id}`, { status: "pending", ...(est ? { estMinutes: est } : {}) });
      if (ask!.kind === "archive") await apiPost(`/api/queue/tasks/${id}/archive`, { outcome, reason: reason.trim() });
      if (ask!.kind === "cancel") await apiPut(`/api/tasks/${id}`, { status: "cancelled", revisionComment: reason.trim() });
      if (ask!.kind === "delete") await apiDelete(`/api/tasks/${id}`);
      const msg = { change: "Alteração na fila", reopen: "Job reaberto", reactivate: "Job reativado", archive: "Job encerrado", cancel: "Job cancelado", delete: "Job excluído" }[ask!.kind];
      toast.success((r as { message?: string } | undefined)?.message ?? msg);
      onClose(); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{c.title}</DialogTitle>
        <p className="-mt-2 text-[13px]"><span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{ask.job.taskCode}</span> <b>{ask.job.title}</b>{ask.job.client && <span className="text-[hsl(var(--muted-foreground))]"> · {ask.job.client}</span>}</p>
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
        {c.est && <div className="flex flex-col gap-1.5 text-[13px] font-semibold">{ask.kind === "reactivate" ? "Horas de trabalho" : "Horas de trabalho desta rodada"}
          <EstInput value={est} onChange={setEst} />
        </div>}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{c.info}</p>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={onClose}>Voltar</Btn>
          <Btn v={c.danger ? "danger" : "pri"} disabled={busy || !!missing} onClick={go}>{c.ok}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Atalhos de horas de trabalho (minutos). */
const EST_CHIPS = [30, 60, 120, 240, 480, 960];

/** Horas de trabalho: horas + minutos, com atalhos. O prazo de entrega sai delas. */
export function EstInput({ value, onChange }: { value: number | null; onChange: (m: number | null) => void }) {
  const h = value != null ? Math.floor(value / 60) : "", m = value != null ? value % 60 : "";
  const set = (hh: number, mm: number) => { const t = Math.max(0, hh) * 60 + Math.max(0, Math.min(59, mm)); onChange(t > 0 ? t : null); };
  const box = "h-10 w-20 rounded-xl border bg-[hsl(var(--background))] px-3 text-center text-base tabular-nums text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-sm">
        <input type="number" min={0} max={200} inputMode="numeric" aria-label="Horas" value={h} onChange={e => set(Number(e.target.value || 0), Number(m || 0))} className={box} />
        <span className="text-[hsl(var(--muted-foreground))]">h</span>
        <input type="number" min={0} max={59} step={5} inputMode="numeric" aria-label="Minutos" value={m} onChange={e => set(Number(h || 0), Number(e.target.value || 0))} className={box} />
        <span className="text-[hsl(var(--muted-foreground))]">min</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {EST_CHIPS.map(c => (
          <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}
            className={cn("rounded-full border px-3 py-1 text-xs tabular-nums transition-colors", value === c ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] font-semibold text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]")}>{fmtH(c)}</button>
        ))}
      </div>
    </div>
  );
}


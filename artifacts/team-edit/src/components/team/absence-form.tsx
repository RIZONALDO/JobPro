import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { openHandoff } from "@/components/fila/HandoffDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Palmtree } from "@/lib/icons";
import { ABSENCE_TYPE_OPTIONS, type Absence } from "@/lib/availability";
import type { Member } from "./shared";

interface AbsenceConflicts {
  tasks:  { id: number; title: string }[];
  duties: { id: number; date: string }[];
}

const EMPTY = { id: 0, userId: "", type: "vacation", startDate: "", endDate: "", notes: "" };

/** Formulário de ausência (criar/editar). `editing` com id → edição. */
export function AbsenceForm({ members, editing, presetUserId, onSaved, onCancel, submitLabel = "Registrar" }: {
  members: Member[];
  editing?: Absence | null;
  presetUserId?: number | null;
  onSaved: () => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setF({ id: editing.id, userId: String(editing.userId), type: editing.type, startDate: editing.startDate, endDate: editing.endDate, notes: editing.notes ?? "" });
    } else {
      setF({ ...EMPTY, userId: presetUserId ? String(presetUserId) : "" });
    }
  }, [editing, presetUserId]);

  const save = async () => {
    if (!f.userId || !f.startDate || !f.endDate) { toast.error("Informe a pessoa e o período"); return; }
    if (f.endDate < f.startDate) { toast.error("A data final deve ser igual ou posterior à inicial"); return; }
    setSaving(true);
    try {
      const body = { userId: Number(f.userId), type: f.type, startDate: f.startDate, endDate: f.endDate, notes: f.notes || null };
      const r = f.id
        ? await apiPut<{ conflicts: AbsenceConflicts }>(`/api/absences/${f.id}`, body)
        : await apiPost<{ conflicts: AbsenceConflicts }>("/api/absences", body);
      const nTasks = r?.conflicts?.tasks.length ?? 0;
      const nDuties = r?.conflicts?.duties.length ?? 0;
      if (nDuties > 0) {
        toast.warning(`Ausência salva. Há ${nDuties} plantão(ões) nesse período: confira a escala.`, { duration: 8000 });
      } else {
        toast.success("Ausência salva");
      }
      // jobs no período: já abre a redistribuição (o supervisor escolhe o que espera a volta)
      if (nTasks > 0) openHandoff({ userId: Number(f.userId), context: "absence" });
      if (!f.id) setF({ ...EMPTY });
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar ausência");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Quem</Label>
        <Select value={f.userId} onValueChange={v => setF(p => ({ ...p, userId: v }))} disabled={!!f.id}>
          <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
          <SelectContent>
            {members.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Tipo</Label>
        <div role="radiogroup" aria-label="Tipo de ausência" className="flex flex-wrap gap-1.5">
          {ABSENCE_TYPE_OPTIONS.map(o => {
            const on = f.type === o.value;
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on}
                onClick={() => setF(p => ({ ...p, type: o.value }))}
                className={cn("h-9 rounded-full border px-3 text-xs font-semibold transition-colors",
                  on ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                     : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <div className="space-y-1.5">
          <Label>De</Label>
          {/* meio-dia evita o DatePicker interpretar a data como UTC e mostrar o dia anterior */}
          <DatePicker value={f.startDate ? `${f.startDate}T12:00:00` : ""}
            onChange={v => setF(p => ({ ...p, startDate: v ? v.slice(0, 10) : "" }))} placeholder="DD/MM/AAAA" />
        </div>
        <div className="space-y-1.5">
          <Label>Até</Label>
          <DatePicker value={f.endDate ? `${f.endDate}T12:00:00` : ""}
            onChange={v => setF(p => ({ ...p, endDate: v ? v.slice(0, 10) : "" }))} placeholder="DD/MM/AAAA"
            minDate={f.startDate || undefined} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Observação</Label>
        <Textarea rows={2} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional" />
      </div>

      <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
        A pessoa continua ativa. No período aparece como ausente e volta sozinha no dia seguinte ao fim.
      </p>

      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancelar</Button>}
        <Button onClick={save} disabled={saving} className={onCancel ? "" : "w-full"}>
          {saving ? "Salvando..." : f.id ? "Salvar alterações" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function AbsenceDialog({ open, onOpenChange, members, editing, presetUserId, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: Member[];
  editing?: Absence | null;
  presetUserId?: number | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palmtree className="h-4 w-4 text-amber-500" />
            {editing ? "Editar ausência" : "Registrar ausência"}
          </DialogTitle>
        </DialogHeader>
        <AbsenceForm members={members} editing={editing} presetUserId={presetUserId}
          onSaved={() => { onOpenChange(false); onSaved(); }} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

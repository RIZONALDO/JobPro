import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./dialog";
import { Button } from "./button";

interface Props {
  open: boolean;
  task: { id: number; title: string; complexity: string };
  onConfirm: (complexity: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

const LEVELS = [
  { key: "low",    label: "Baixa",  desc: "Rápida de executar",          cls: "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-300 dark:border-green-800" },
  { key: "medium", label: "Média",  desc: "Esforço moderado",            cls: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-800" },
  { key: "high",   label: "Alta",   desc: "Complexa, exige mais tempo",  cls: "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/20 dark:text-red-300 dark:border-red-800" },
] as const;

const LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

export function ComplexityConfirmDialog({ open, task, onConfirm, onCancel, saving }: Props) {
  const [selected, setSelected] = useState(task.complexity ?? "medium");

  const adjusted = selected !== task.complexity;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !saving) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirmar complexidade</DialogTitle>
        </DialogHeader>

        <div className="py-1 space-y-4">
          <div>
            <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{task.title}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              Estimativa do coordenador: <strong>{LABEL[task.complexity] ?? task.complexity}</strong>
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map(({ key, label, desc, cls }) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`rounded-xl border-2 py-3 px-1 flex flex-col items-center gap-1 transition-all ${
                  selected === key ? cls : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border))]/80"
                }`}
              >
                <span className="text-xs font-bold">{label}</span>
                <span className="text-[9px] leading-snug text-center opacity-70">{desc}</span>
              </button>
            ))}
          </div>

          {adjusted && (
            <div className="rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]/50 px-3 py-2.5">
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Você alterou de <strong>{LABEL[task.complexity]}</strong> para <strong>{LABEL[selected]}</strong>.
                O coordenador será <strong>notificado automaticamente</strong>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onConfirm(selected)} disabled={saving}>
            {saving ? "Iniciando..." : "Iniciar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

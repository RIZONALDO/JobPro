import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { Label } from "./label";

interface Props {
  open: boolean;
  task: { id: number; title: string; complexity: string };
  onConfirm: (complexity: string, comment: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

const LEVELS = [
  { key: "low",    label: "Baixa"  },
  { key: "medium", label: "Média"  },
  { key: "high",   label: "Alta"   },
] as const;

const SELECTED_CLS = "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-semibold";
const DEFAULT_CLS  = "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/40";

export function ComplexityConfirmDialog({ open, task, onConfirm, onCancel, saving }: Props) {
  const [selected, setSelected] = useState(task.complexity ?? "medium");
  const [comment,  setComment]  = useState("");

  const canConfirm = comment.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !saving) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Iniciar tarefa</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Seletor de complexidade */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              Complexidade
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`rounded-lg border-2 py-2 text-sm transition-all ${selected === key ? SELECTED_CLS : DEFAULT_CLS}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Comentário obrigatório */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              Observação <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="Descreva o que será feito nesta tarefa..."
              value={comment}
              onChange={e => setComment(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onConfirm(selected, comment.trim())} disabled={saving || !canConfirm}>
            {saving ? "Iniciando..." : "Iniciar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

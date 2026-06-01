import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Textarea } from "./textarea";

export const COMPLEXITY_MESSAGES: Record<string, string> = {
  low:    "Processo operacional padrão, sem demandas técnicas especiais.",
  medium: "Múltiplas etapas com possibilidade de revisões intermediárias.",
  high:   "Demanda técnicas especializadas e dedicação integral até a entrega.",
};

const LEVELS = [
  { key: "low",    label: "Baixa"  },
  { key: "medium", label: "Média"  },
  { key: "high",   label: "Alta"   },
] as const;

interface Props {
  open: boolean;
  task: { id: number; title: string; complexity: string };
  onSave: (complexity: string, comment: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function ComplexityConfirmDialog({ open, task, onSave, onCancel, saving }: Props) {
  const [selected,  setSelected]  = useState(task.complexity ?? "medium");
  const [showExtra, setShowExtra] = useState(false);
  const [extra,     setExtra]     = useState("");

  const message = COMPLEXITY_MESSAGES[selected] ?? COMPLEXITY_MESSAGES.medium;
  const finalComment = extra.trim()
    ? `${message}\n\nObservação: ${extra.trim()}`
    : message;

  function handleSelect(key: string) {
    setSelected(key);
    setShowExtra(false);
    setExtra("");
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !saving) onCancel(); }}>
      <DialogContent className="max-w-sm">

        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm font-semibold">Definir complexidade</DialogTitle>
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate pt-0.5">{task.title}</p>
        </DialogHeader>

        <div className="space-y-3 py-1">

          {/* Seletor */}
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map(({ key, label }) => {
              const active = selected === key;
              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  className={[
                    "rounded-lg border-2 py-2 text-xs font-semibold transition-all",
                    active
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/40",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Mensagem padrão */}
          <div className="rounded-lg bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]/50 px-3 py-2.5">
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{message}</p>
          </div>

          {/* Observação opcional */}
          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-xs text-[hsl(var(--primary))] hover:underline"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Detalhes adicionais, se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-xs"
              rows={3}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(selected, finalComment)} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

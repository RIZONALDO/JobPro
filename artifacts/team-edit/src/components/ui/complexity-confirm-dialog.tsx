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
      <DialogContent className="max-w-xs">

        {/* Cabeçalho */}
        <DialogHeader className="gap-0.5 pb-1">
          <DialogTitle className="text-[13px] font-semibold tracking-tight">
            Definir complexidade
          </DialogTitle>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate leading-snug">
            {task.title}
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-3">

          {/* Seletor de nível */}
          <div className="grid grid-cols-3 gap-1.5">
            {LEVELS.map(({ key, label }) => {
              const active = selected === key;
              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  className={[
                    "rounded-md border py-2 text-[11px] font-semibold transition-all",
                    active
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/50 hover:text-[hsl(var(--foreground))]",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Mensagem padrão */}
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed px-0.5">
            {message}
          </p>

          {/* Observação opcional */}
          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-[11px] text-[hsl(var(--primary))]/70 hover:text-[hsl(var(--primary))] text-left transition-colors"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Detalhes adicionais, se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-[11px] leading-relaxed min-h-0"
              rows={3}
            />
          )}

        </div>

        <DialogFooter className="pt-1">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}
            className="text-xs h-8">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(selected, finalComment)} disabled={saving}
            className="text-xs h-8">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

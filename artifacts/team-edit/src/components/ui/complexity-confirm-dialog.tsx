import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Textarea } from "./textarea";

interface Props {
  open: boolean;
  task: { id: number; title: string; complexity: string };
  onConfirm: (complexity: string, comment: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

const LEVELS = [
  { key: "low",    label: "Baixa",  message: "Processo operacional padrão, sem demandas técnicas especiais." },
  { key: "medium", label: "Média",  message: "Múltiplas etapas com possibilidade de revisões intermediárias." },
  { key: "high",   label: "Alta",   message: "Demanda técnicas especializadas e dedicação integral até a entrega." },
] as const;

const SELECTED_CLS = "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-semibold";
const DEFAULT_CLS  = "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/40";

export function ComplexityConfirmDialog({ open, task, onConfirm, onCancel, saving }: Props) {
  const [selected,    setSelected]    = useState(task.complexity ?? "medium");
  const [showExtra,   setShowExtra]   = useState(false);
  const [extra,       setExtra]       = useState("");

  const level = LEVELS.find(l => l.key === selected) ?? LEVELS[1];

  const finalComment = extra.trim()
    ? `${level.message}\n\nObservação: ${extra.trim()}`
    : level.message;

  function handleSelect(key: string) {
    setSelected(key);
    setShowExtra(false);
    setExtra("");
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !saving) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Iniciar tarefa</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Seletor de complexidade */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              Complexidade
            </p>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  className={`rounded-lg border-2 py-2 text-sm transition-all ${selected === key ? SELECTED_CLS : DEFAULT_CLS}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mensagem padrão */}
          <div className="rounded-lg bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]/50 px-3 py-2.5">
            <p className="text-[12px] text-[hsl(var(--muted-foreground))] leading-relaxed">
              {level.message}
            </p>
          </div>

          {/* Observação opcional */}
          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-[11px] text-[hsl(var(--primary))] hover:underline w-full text-left"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Descreva detalhes adicionais se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onConfirm(selected, finalComment)} disabled={saving}>
            {saving ? "Iniciando..." : "Iniciar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

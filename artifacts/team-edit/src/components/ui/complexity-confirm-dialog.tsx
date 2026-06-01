import { useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { Minus, Layers, Zap } from "lucide-react";

export const COMPLEXITY_MESSAGES: Record<string, string> = {
  low:    "Processo operacional padrão, sem demandas técnicas especiais.",
  medium: "Múltiplas etapas com possibilidade de revisões intermediárias.",
  high:   "Demanda técnicas especializadas e dedicação integral até a entrega.",
};

const LEVELS = [
  { key: "low",    label: "Baixa",  Icon: Minus  },
  { key: "medium", label: "Média",  Icon: Layers },
  { key: "high",   label: "Alta",   Icon: Zap    },
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
      <DialogContent className="max-w-[300px] gap-0 p-0 overflow-hidden">

        {/* Cabeçalho */}
        <div className="px-5 pt-5 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-1">
            Complexidade
          </p>
          <p className="text-[13px] font-semibold text-[hsl(var(--foreground))] leading-snug truncate">
            {task.title}
          </p>
        </div>

        {/* Seletor */}
        <div className="grid grid-cols-3 gap-0 border-y border-[hsl(var(--border))]">
          {LEVELS.map(({ key, label, Icon }, i) => {
            const active = selected === key;
            return (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                className={[
                  "flex flex-col items-center gap-1.5 py-4 text-center transition-all relative",
                  i > 0 ? "border-l border-[hsl(var(--border))]" : "",
                  active
                    ? "bg-[hsl(var(--primary))] text-white"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50 hover:text-[hsl(var(--foreground))]",
                ].join(" ")}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[11px] font-semibold">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Mensagem + observação */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex gap-2.5">
            <div className="w-[2px] rounded-full bg-[hsl(var(--primary))]/25 shrink-0 mt-0.5" />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
              {message}
            </p>
          </div>

          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-[11px] text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--primary))] text-left transition-colors"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Detalhes adicionais, se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-[11px] leading-relaxed min-h-0 border-[hsl(var(--border))]"
              rows={3}
            />
          )}
        </div>

        {/* Rodapé */}
        <DialogFooter className="px-5 pb-4 pt-0">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}
            className="text-[11px] h-8 text-[hsl(var(--muted-foreground))]">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(selected, finalComment)} disabled={saving}
            className="text-[11px] h-8">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

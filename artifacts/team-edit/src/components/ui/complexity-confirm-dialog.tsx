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
  {
    key: "low",    label: "Baixa",  Icon: Minus,
    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0",
    activeBg: "#16a34a", activeText: "#ffffff",
  },
  {
    key: "medium", label: "Média",  Icon: Layers,
    color: "#ca8a04", bg: "#fefce8", border: "#fde68a",
    activeBg: "#ca8a04", activeText: "#ffffff",
  },
  {
    key: "high",   label: "Alta",   Icon: Zap,
    color: "#dc2626", bg: "#fef2f2", border: "#fecaca",
    activeBg: "#dc2626", activeText: "#ffffff",
  },
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

  const level  = LEVELS.find(l => l.key === selected) ?? LEVELS[1];
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
      <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">

        {/* Cabeçalho */}
        <div className="px-6 pt-6 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">
            Complexidade
          </p>
          <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-snug truncate">
            {task.title}
          </p>
        </div>

        {/* Seletor compacto */}
        <div className="grid grid-cols-3 gap-0 border-y border-[hsl(var(--border))]">
          {LEVELS.map(({ key, label, Icon, color, bg, border, activeBg, activeText }, i) => {
            const active = selected === key;
            return (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                style={active
                  ? { background: activeBg, color: activeText, borderColor: "transparent" }
                  : { background: bg, color, borderColor: "transparent" }
                }
                className={[
                  "flex items-center justify-center gap-1.5 py-2.5 transition-all",
                  i > 0 ? "border-l border-[hsl(var(--border))]" : "",
                ].join(" ")}
              >
                <Icon style={{ width: 11, height: 11 }} strokeWidth={active ? 2.5 : 2} />
                <span className="text-[11px] font-bold">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Mensagem + observação */}
        <div className="px-6 py-5 flex flex-col gap-4">

          <div className="flex gap-3">
            <div className="w-[3px] rounded-full shrink-0 mt-1"
              style={{ background: level.activeBg, opacity: 0.4 }} />
            <p className="text-[13px] font-medium text-[hsl(var(--foreground))]/80 leading-relaxed">
              {message}
            </p>
          </div>

          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-[11px] text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--muted-foreground))] text-left transition-colors"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Detalhes adicionais, se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-[12px] leading-relaxed min-h-0"
              rows={3}
            />
          )}
        </div>

        {/* Rodapé */}
        <DialogFooter className="px-6 pb-5 pt-0">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}
            className="text-xs h-8 text-[hsl(var(--muted-foreground))]">
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

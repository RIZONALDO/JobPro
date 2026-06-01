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
  task: { id: number; taskCode?: string; title: string; complexity: string };
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

        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Definir complexidade</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Tarefa */}
          <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2">
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-0.5">Tarefa</p>
            <div className="flex items-baseline gap-2 min-w-0">
              {task.taskCode && (
                <span className="shrink-0 font-mono text-xs font-semibold text-[hsl(var(--primary))]/70">
                  {task.taskCode}
                </span>
              )}
              <span className="text-sm font-medium truncate">{task.title}</span>
            </div>
          </div>

          {/* Opções */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">
              Nível
            </p>
            <div className="space-y-1">
              {LEVELS.map(({ key, label }) => {
                const active = selected === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleSelect(key)}
                    className={[
                      "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
                      active
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5"
                        : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40",
                    ].join(" ")}
                  >
                    <div className={[
                      "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                      active
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))]",
                    ].join(" ")}>
                      {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                    <span className={[
                      "text-sm font-medium",
                      active ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]",
                    ].join(" ")}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mensagem */}
          <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2.5">
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{message}</p>
          </div>

          {/* Observação opcional */}
          {!showExtra ? (
            <button
              onClick={() => setShowExtra(true)}
              className="text-xs text-[hsl(var(--primary))] hover:underline text-left"
            >
              + Adicionar observação
            </button>
          ) : (
            <Textarea
              autoFocus
              placeholder="Detalhes adicionais, se necessário..."
              value={extra}
              onChange={e => setExtra(e.target.value)}
              className="resize-none text-sm"
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

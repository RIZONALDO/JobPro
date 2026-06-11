import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./dialog";
import { Button } from "./button";
import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { parseDate, toLocalDateStr } from "@/lib/date";

interface Props {
  open:    boolean;
  task:    {
    id:          number;
    taskCode?:   string;
    title:       string;
    effortHours: number;
    dueDate?:    string | null;
    startDate?:  string | null;
  };
  onSave:   (adjustedHours: number, comment: string) => void;
  onCancel: () => void;
  saving?:  boolean;
}

// Mirrors backend calcTheoreticalCompletion
function calcCompletion(sd: string, hours: number): string {
  const DAILY_CAP = (dow: number) => (dow === 0 ? 0 : dow === 6 ? 5 : 8);
  const WORK_END  = (dow: number) => (dow === 6 ? 13 : 18);
  let remaining = hours;
  const d = parseDate(sd);
  // start at 08:00 of the startDate (or now if today)
  const todayStr = toLocalDateStr(new Date());
  const isToday  = sd.slice(0, 10) === todayStr;
  if (isToday) {
    const now = new Date();
    const curH = now.getHours() + now.getMinutes() / 60;
    d.setHours(Math.max(8, Math.ceil(curH * 2) / 2), 0, 0, 0);
  } else {
    d.setHours(8, 0, 0, 0);
  }

  while (remaining > 0.01) {
    const dow  = d.getDay();
    const cap  = DAILY_CAP(dow);
    if (cap > 0) {
      const endH   = WORK_END(dow);
      const curH   = d.getHours() + d.getMinutes() / 60;
      const startH = Math.max(curH, 8);
      const avail  = Math.max(0, endH - startH);
      if (avail > 0.01) {
        const use = Math.min(avail, remaining);
        remaining = Math.round((remaining - use) * 100) / 100;
        if (remaining <= 0.01) {
          const finH = startH + use;
          d.setHours(Math.floor(finH), Math.round((finH % 1) * 60), 0, 0);
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const hh = String(d.getHours()).padStart(2, "0");
          const mi = String(d.getMinutes()).padStart(2, "0");
          return `${dd}/${mm} às ${hh}:${mi}`;
        }
      }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// Returns YYYY-MM-DD of theoretical completion
function completionDate(sd: string, hours: number): string {
  const DAILY_CAP = (dow: number) => (dow === 0 ? 0 : dow === 6 ? 5 : 8);
  const WORK_END  = (dow: number) => (dow === 6 ? 13 : 18);
  let remaining = hours;
  const d = parseDate(sd);
  d.setHours(8, 0, 0, 0);
  while (remaining > 0.01) {
    const dow  = d.getDay();
    const cap  = DAILY_CAP(dow);
    if (cap > 0) {
      const avail = Math.max(0, WORK_END(dow) - 8);
      if (avail > 0.01) {
        const use = Math.min(avail, remaining);
        remaining = Math.round((remaining - use) * 100) / 100;
        if (remaining <= 0.01) return toLocalDateStr(d);
      }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return toLocalDateStr(d);
}

export function EffortHoursDialog({ open, task, onSave, onCancel, saving }: Props) {
  const [hours,     setHours]     = useState(task.effortHours);
  const [comment,   setComment]   = useState("");
  const [showExtra, setShowExtra] = useState(false);

  const startStr = task.startDate?.slice(0, 10) ?? toLocalDateStr(new Date());

  const completion  = useMemo(() => calcCompletion(startStr, hours),   [startStr, hours]);
  const compDateStr = useMemo(() => completionDate(startStr, hours),    [startStr, hours]);

  const exceeds = task.dueDate
    ? compDateStr > task.dueDate.slice(0, 10)
    : false;

  const changed = Math.abs(hours - task.effortHours) > 0.01;

  const finalComment = (() => {
    const base = changed
      ? `Horas ajustadas de ${task.effortHours}h para ${hours}h.`
      : `Horas confirmadas: ${hours}h.`;
    return comment.trim() ? `${base}\n\nObservação: ${comment.trim()}` : base;
  })();

  function handleHours(v: string) {
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) setHours(Math.round(n * 4) / 4); // 0.25h precision
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !saving) onCancel(); }}>
      <DialogContent className="max-w-sm">

        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Validar horas da tarefa</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Tarefa */}
          <div className="rounded-lg border bg-[hsl(var(--muted))]/30 px-3 py-2">
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-0.5">Tarefa</p>
            <div className="flex items-start gap-2 min-w-0">
              {task.taskCode && (
                <span className="shrink-0 font-mono text-xs font-semibold text-[hsl(var(--primary))]/70 mt-0.5">
                  {task.taskCode}
                </span>
              )}
              <span className="text-sm font-medium leading-snug break-words min-w-0">{task.title}</span>
            </div>
          </div>

          {/* Estimativa do coordenador */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
            <Clock className="h-4 w-4 text-[hsl(var(--muted-foreground))]/50 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-0.5">
                Estimativa do coordenador
              </p>
              <p className="text-sm font-semibold">{task.effortHours}h de trabalho efetivo</p>
            </div>
          </div>

          {/* Ajuste do editor */}
          <div>
            <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-2">
              Sua estimativa
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0.25}
                max={400}
                step={0.25}
                value={hours}
                onChange={e => handleHours(e.target.value)}
                className="w-24 h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/20 focus:border-[hsl(var(--primary))]"
              />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">horas de trabalho efetivo</span>
            </div>
          </div>

          {/* Previsão de conclusão */}
          <div className={[
            "rounded-lg border px-3 py-2.5 flex items-start gap-3",
            exceeds
              ? "border-amber-200/70 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/30"
              : "border-emerald-200/60 bg-emerald-50/50 dark:bg-emerald-950/15 dark:border-emerald-800/25",
          ].join(" ")}>
            {exceeds
              ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              : <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            }
            <div>
              <p className={[
                "text-xs font-semibold",
                exceeds ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
              ].join(" ")}>
                Conclusão estimada: {completion}
              </p>
              {exceeds && task.dueDate && (
                <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 mt-0.5 leading-snug">
                  Ultrapassa o prazo de entrega ({task.dueDate.slice(8, 10)}/{task.dueDate.slice(5, 7)}).
                  O coordenador será notificado.
                </p>
              )}
            </div>
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
            <textarea
              autoFocus
              placeholder="Justifique o ajuste, se necessário..."
              value={comment}
              onChange={e => setComment(e.target.value)}
              className="w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/20 focus:border-[hsl(var(--primary))]"
              rows={3}
            />
          )}

        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(hours, finalComment)} disabled={saving}>
            {saving ? "Salvando..." : "Confirmar"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

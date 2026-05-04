import { useState } from "react";
import { AlertTriangle, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export type GuardLevel = "critical" | "warning";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  level: GuardLevel;
  activeTasks: number;
  /** e.g. "excluir", "arquivar", "pausar", "concluir", "entregar", "aprovar" */
  action: string;
  resourceType: "projeto" | "job";
  resourceName: string;
  /** When true, "activeTasks" represents all tasks (delete), not just in-progress */
  allTasks?: boolean;
}

const MESSAGES: Record<GuardLevel, { title: string; confirmLabel: string; iconCls: string; borderCls: string }> = {
  critical: {
    title: "Ação irreversível",
    confirmLabel: "Confirmar mesmo assim",
    iconCls: "text-red-500",
    borderCls: "border-red-200 bg-red-50",
  },
  warning: {
    title: "Atenção",
    confirmLabel: "Confirmar mesmo assim",
    iconCls: "text-amber-500",
    borderCls: "border-amber-200 bg-amber-50",
  },
};

export function ActiveWorkGuardDialog({ open, onClose, onConfirm, level, activeTasks, action, resourceType, resourceName, allTasks }: Props) {
  const [confirming, setConfirming] = useState(false);
  const cfg = MESSAGES[level];
  const Icon = level === "critical" ? AlertOctagon : AlertTriangle;

  const handle = async () => {
    setConfirming(true);
    try { await onConfirm(); }
    finally { setConfirming(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !confirming) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 shrink-0 ${cfg.iconCls}`} />
            {cfg.title}
          </DialogTitle>
        </DialogHeader>

        <div className={`rounded-lg border p-4 text-sm space-y-2 ${cfg.borderCls}`}>
          <p>
            Você está prestes a <strong>{action}</strong> o {resourceType}{" "}
            <strong>"{resourceName}"</strong>.
          </p>
          <p>
            {allTasks ? (
              <>
                Este {resourceType} contém{" "}
                <strong>{activeTasks} tarefa{activeTasks !== 1 ? "s" : ""}</strong>{" "}
                que serão <strong>perdidas permanentemente</strong>.
              </>
            ) : (
              <>
                Há{" "}
                <strong>
                  {activeTasks} tarefa{activeTasks !== 1 ? "s" : ""} em andamento
                </strong>{" "}
                {level === "critical"
                  ? "que serão perdidas permanentemente."
                  : "que ainda não foram concluídas."}
              </>
            )}
          </p>
          {level === "critical" && (
            <p className="text-red-700 font-medium">
              Esta ação não pode ser desfeita.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            Cancelar
          </Button>
          <Button
            variant={level === "critical" ? "destructive" : "default"}
            onClick={handle}
            disabled={confirming}
          >
            {confirming ? "Aguarde…" : cfg.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

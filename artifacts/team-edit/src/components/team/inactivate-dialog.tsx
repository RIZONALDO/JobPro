import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { openHandoff } from "@/components/fila/HandoffDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, X } from "@/lib/icons";
import { fmtShortDate } from "@/lib/availability";
import { MemberAvatar, type Member } from "./shared";

interface PendingWork {
  openTasks:    { id: number }[];
  extraTasks:   { id: number }[];
  futureDuties: { id: number; date: string }[];
}

export function InactivateDialog({ member, onOpenChange, onDone }: {
  member: Member | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<PendingWork | null>(null);
  const [removeDuties, setRemoveDuties] = useState(true);
  const [saving, setSaving] = useState(false);
  // jobs abertos que ela edita ou coordena: precisam ser redistribuídos antes
  const [jobs, setJobs] = useState<{ editing: number; owned: number } | null>(null);

  useEffect(() => {
    if (!member) return;
    setPending(null);
    setJobs(null);
    setRemoveDuties(true);
    apiFetch<PendingWork>(`/api/users/${member.id}/pending`).then(setPending).catch(() => {});
    apiPost<{ editing: unknown[]; owned: unknown[] }>(`/api/queue/handoff/${member.id}/preview`, { context: "inactivate" })
      .then(p => setJobs({ editing: p.editing.length, owned: p.owned.length })).catch(() => setJobs({ editing: 0, owned: 0 }));
  }, [member]);

  const nJobs = jobs ? jobs.editing + jobs.owned : 0;

  const confirm = async () => {
    if (!member) return;
    if (nJobs > 0) {
      // a inativação acontece no fim da redistribuição
      openHandoff({ userId: member.id, context: "inactivate", removeDuties, onDone });
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const r = await apiPut<{ removedDuties?: number }>(`/api/users/${member.id}`, {
        status: "inactive", removeFutureDuties: removeDuties,
      });
      toast.success(`${member.name} inativado${r?.removedDuties ? ` — ${r.removedDuties} plantão(ões) futuro(s) removido(s)` : ""}`);
      onOpenChange(false);
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao inativar");
    } finally { setSaving(false); }
  };

  const nTasks = pending ? pending.extraTasks.length : 0;
  const nDuties = pending?.futureDuties.length ?? 0;

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {member && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <MemberAvatar member={member} size={48} />
                <div className="text-left">
                  <DialogTitle>Inativar {member.name}?</DialogTitle>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {member.jobTitle ? `${member.jobTitle} · ` : ""}@{member.login}
                  </p>
                </div>
              </div>
            </DialogHeader>

            <ul className="space-y-2 text-sm py-1">
              <li className="flex gap-2.5"><X className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />Perde o acesso agora — sessões abertas são encerradas.</li>
              <li className="flex gap-2.5"><X className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />Sai das listas da equipe e não pode mais ser escolhido.</li>
              <li className="flex gap-2.5"><Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />O histórico continua com o nome dele.</li>
              <li className="flex gap-2.5"><Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />Pode ser reativado a qualquer momento na aba Inativos.</li>
            </ul>

            {nJobs > 0 && (
              <div className="rounded-xl border px-3 py-2.5 text-xs">
                <p className="font-semibold">
                  {[jobs!.editing ? `Edita ${jobs!.editing} job(s) aberto(s)` : "", jobs!.owned ? `coordena ${jobs!.owned}` : ""].filter(Boolean).join(" e ")}
                </p>
                <p className="mt-0.5 text-[hsl(var(--muted-foreground))]">
                  No próximo passo você escolhe para quem vai cada um. O sistema sugere pelo prazo e pela fila de cada editor.
                </p>
              </div>
            )}

            {nTasks > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs">
                <p className="text-amber-800/80 dark:text-amber-200/80">
                  Também está como editor extra em {nTasks} tarefa(s) aberta(s). Confira depois quem segue com elas.
                </p>
              </div>
            )}

            {nDuties > 0 && (
              <label className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer select-none">
                <input type="checkbox" className="h-4 w-4 mt-0.5 rounded accent-[hsl(var(--primary))]"
                  checked={removeDuties} onChange={e => setRemoveDuties(e.target.checked)} />
                <span className="text-sm">
                  Remover os {nDuties} plantão(ões) futuro(s)
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    {pending!.futureDuties.slice(0, 6).map(d => fmtShortDate(d.date)).join(", ")}
                    {nDuties > 6 ? ` +${nDuties - 6}` : ""} · plantões passados são mantidos
                  </span>
                </span>
              </label>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button variant={nJobs ? "default" : "destructive"} onClick={confirm} disabled={saving || !pending || !jobs}>
                {saving ? "Inativando..." : nJobs ? `Continuar: redistribuir ${nJobs} job(s)` : "Inativar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

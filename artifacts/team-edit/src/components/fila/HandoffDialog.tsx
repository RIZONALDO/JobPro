/**
 * Redistribuir os jobs de quem sai (inativação) ou fica fora (férias, afastamento).
 * Abre de qualquer lugar com `openHandoff(...)`; o <HandoffHost/> fica montado no Shell.
 *
 * A prévia vem do servidor (/queue/handoff/:id/preview): sugere para cada job o editor com menos jobs na fila,
 * contando os já redistribuídos. Ao trocar um destino, a prévia é refeita e as sugestões dos outros se ajustam.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { roleName } from "@/lib/roles";
import { fmt } from "@/lib/fila";
import { Button } from "@/components/ui/button";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Loader2, Play } from "@/lib/icons";

/* ── abrir de qualquer tela ── */
export type HandoffContext = "inactivate" | "absence" | "queue";
export interface HandoffRequest { userId: number; context: HandoffContext; removeDuties?: boolean; onDone?: () => void }
let current: HandoffRequest | null = null;
const subs = new Set<() => void>();
export function openHandoff(r: HandoffRequest | null) { current = r; subs.forEach(f => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function HandoffHost() {
  const req = useSyncExternalStore(subscribe, () => current);
  return <HandoffDialog req={req} onClose={() => openHandoff(null)} />;
}

/* ── dados da prévia ── */
type Mode = "end" | "prio" | "gestor" | "keep" | "swap";
interface Job {
  id: number; code: string; title: string; client: string | null; status: string; coordId: number | null; editorId: number | null;
  playing: boolean; promised: number | null;
}
interface EditJob extends Job { inQueue: boolean; mode: Mode; to: number | null; late: boolean }
interface Preview {
  now: number; returnsAt: number | null;
  person: { id: number; name: string; role: string; status: string; jobTitle: string | null; avatarUrl: string | null };
  editors: { id: number; name: string; jobTitle: string | null; avatarUrl: string | null; before: number; after: number; offToday: string | null }[];
  owners: { id: number; name: string; role: string; jobTitle: string | null; avatarUrl: string | null }[];
  editing: EditJob[]; owned: Job[]; names: Record<string, string>;
}
type Choice = { editorId: number | null; mode: Mode };

const STATUS: Record<string, string> = {
  pending: "Na fila", in_progress: "Em edição", in_revision: "Alteração", reopened: "Reaberto",
  paused: "Travado", review: "Com o cliente", rascunho: "Rascunho",
};
const first = (n?: string) => (n ?? "—").split(" ")[0];

/** valor do Select ↔ escolha */
const enc = (c: Choice) => (c.mode === "end" || c.mode === "prio" || c.mode === "swap") && c.editorId ? `ed:${c.editorId}` : c.mode === "swap" ? "none" : c.mode;
function dec(v: string, j: EditJob): Choice {
  if (v.startsWith("ed:")) return { editorId: Number(v.slice(3)), mode: j.inQueue ? "end" : "swap" };
  if (v === "none") return { editorId: null, mode: "swap" };
  return { editorId: null, mode: v as Mode };
}

function HandoffDialog({ req, onClose }: { req: HandoffRequest | null; onClose: () => void }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const [owners, setOwners] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const context = req?.context ?? "queue";

  useEffect(() => { setPv(null); setChoices(new Map()); setOwners(new Map()); }, [req]);

  // prévia: refeita a cada destino trocado (as sugestões dos outros jobs se ajustam)
  useEffect(() => {
    if (!req) return;
    const n = ++seq.current;
    setLoading(true);
    apiPost<Preview>(`/api/queue/handoff/${req.userId}/preview`, {
      context: req.context,
      choices: [...choices].map(([taskId, c]) => ({ taskId, ...c })),
    }).then(p => { if (n === seq.current) setPv(p); })
      .catch(e => { toast.error(e.message); onClose(); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [req, choices]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: number | null | undefined) => (id ? pv?.names[String(id)] : undefined);
  const defOwner = useMemo(() => pv?.owners.find(o => o.role === "supervisor" || o.role === "admin")?.id ?? pv?.owners[0]?.id ?? null, [pv]);
  const ownerOf = (taskId: number) => owners.get(taskId) ?? owners.get(0) ?? defOwner;

  const setChoice = (j: EditJob, c: Choice) => setChoices(m => new Map(m).set(j.id, c));

  const total = (pv?.editing.length ?? 0) + (pv?.owned.length ?? 0);
  const leaving = context === "inactivate";
  // quem sai (ou já saiu) não volta: "keep" aqui é job parado
  const gone = leaving || pv?.person.status === "inactive";
  const unresolved = gone ? (pv?.editing.filter(j => j.mode === "keep").length ?? 0) : 0;

  const apply = async () => {
    if (!req || !pv) return;
    setSaving(true);
    try {
      const r = await apiPost<{ owners: number; moved: number; swapped: number; gestor: number; requests: number; kept: number; errors: string[] }>(
        `/api/queue/handoff/${req.userId}`, {
          inactivate: leaving,
          editing: pv.editing.map(j => ({ taskId: j.id, editorId: j.to, mode: j.mode })),
          owned: pv.owned.map(j => ({ taskId: j.id, coordId: ownerOf(j.id) })),
        });
      if (leaving) await apiPut(`/api/users/${req.userId}`, { status: "inactive", removeFutureDuties: !!req.removeDuties, force: true });
      const parts = [
        r.moved + r.swapped ? `${r.moved + r.swapped} job(s) com outro editor` : "",
        r.requests ? `${r.requests} aguardando aprovação` : "",
        r.gestor ? `${r.gestor} para a supervisão decidir` : "",
        r.kept ? `${r.kept} esperando a volta` : "",
        r.owners ? `${r.owners} com outro gestor` : "",
      ].filter(Boolean).join(" · ");
      toast.success(`${leaving ? `${pv.person.name} inativado. ` : ""}${parts || "Nada mudou."}`, { duration: 8000 });
      if (r.errors.length) toast.warning(r.errors.join("\n"), { duration: 10000 });
      req.onDone?.();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao redistribuir");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!req} onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-24px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {/* cabeçalho */}
        <div className="flex items-center gap-3 border-b px-5 py-4 pr-12">
          {pv ? <AvatarDisplay name={pv.person.name} avatarUrl={pv.person.avatarUrl} size={40} />
              : <span className="h-10 w-10 shrink-0 rounded-full bg-[hsl(var(--muted))]" />}
          <div className="min-w-0">
            <DialogTitle className="text-base">Redistribuir jobs{pv ? ` de ${pv.person.name}` : ""}</DialogTitle>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              {leaving ? "Ao inativar, cada job precisa de um destino."
                : context === "absence" ? "Durante a ausência: escolha o que espera a volta e o que passa adiante."
                : "Passe os jobs para outra pessoa sem mexer no resto da fila."}
            </p>
          </div>
          {loading && pv && <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!pv ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />)}</div>
          ) : total === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhum job aberto no nome de {pv.person.name}.</p>
          ) : (
            <>
              {pv.editing.length > 0 && (
                <section className="px-5 pt-4">
                  <SectionHead title="Jobs que edita" sub={`Sugestão: o editor com menos jobs na fila em que o prazo cabe na ordem.${pv.returnsAt != null ? ` Jobs com prazo depois da volta (${fmt(pv.returnsAt).slice(0, 9)}) ficam com ${first(pv.person.name)}.` : ""}`} />
                  <ul className="divide-y rounded-lg border">
                    {pv.editing.map(j => <EditRow key={j.id} j={j} pv={pv} gone={!!gone} name={name}
                      touched={choices.has(j.id)} onChange={c => setChoice(j, c)} />)}
                  </ul>
                  {pv.editors.length > 0 && <Load pv={pv} />}
                </section>
              )}

              {pv.owned.length > 0 && (
                <section className="px-5 pt-5">
                  <SectionHead title="Jobs que coordena" sub="Troca o responsável. A posição na fila não muda e o novo gestor é avisado." />
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-[hsl(var(--muted-foreground))]">Passar todos para</span>
                    <OwnerSelect pv={pv} value={owners.get(0) ?? defOwner}
                      onChange={v => setOwners(new Map([[0, v]]))} className="w-56" />
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {pv.owned.map(j => (
                      <li key={j.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
                        <JobInfo j={j} pv={pv} name={name} />
                        <OwnerSelect pv={pv} value={ownerOf(j.id)} onChange={v => setOwners(m => new Map(m).set(j.id, v))} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          <div className="h-4" />
        </div>

        {/* rodapé */}
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <p className="mr-auto text-xs text-[hsl(var(--muted-foreground))]">
            {pv && total > 0 ? (unresolved ? `${unresolved} job(s) sem destino ficam parados.` : "Todos os avisos saem para quem é afetado.") : ""}
          </p>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={apply} disabled={!pv || saving || loading}
            variant={leaving ? "destructive" : "default"}>
            {saving ? "Aplicando..." : leaving ? (total ? "Redistribuir e inativar" : "Inativar") : "Redistribuir"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{sub}</p>
    </div>
  );
}

function JobInfo({ j, pv, name }: { j: Job; pv: Preview; name: (id: number | null) => string | undefined }) {
  const late = j.promised != null && j.promised <= pv.now;
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {j.playing && <Play className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" weight="fill" />}
        <span className="shrink-0 tabular-nums text-[hsl(var(--muted-foreground))]">{j.code}</span>
        <span className="truncate">{j.title}</span>
      </p>
      <p className="mt-0.5 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
        {[STATUS[j.status] ?? j.status, j.client,
          j.coordId !== pv.person.id && name(j.coordId) ? `de ${first(name(j.coordId))}` : ""].filter(Boolean).join(" · ")}
        {j.promised != null && <> · prazo <span className={cn(late && "text-rose-600 dark:text-rose-400")}>{fmt(j.promised)}</span></>}
      </p>
    </div>
  );
}

function EditRow({ j, pv, gone, name, touched, onChange }: {
  j: EditJob; pv: Preview; gone: boolean; name: (id: number | null) => string | undefined;
  touched: boolean; onChange: (c: Choice) => void;
}) {
  const value = enc({ editorId: j.to, mode: j.mode });

  return (
    <li className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
      <JobInfo j={j} pv={pv} name={name} />
      <div className="min-w-0 space-y-1.5">
        <Select value={value} onValueChange={v => onChange(dec(v, j))}>
          <SelectTrigger className="h-9" aria-label={`Destino de ${j.title}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {pv.editors.map(e => (
              <SelectItem key={e.id} value={`ed:${e.id}`}>
                {e.name}<span className="text-[hsl(var(--muted-foreground))]"> · {e.before} na fila{e.offToday ? ` · ${e.offToday}` : ""}</span>
              </SelectItem>
            ))}
            {j.inQueue && <SelectItem value="gestor">Supervisão decide</SelectItem>}
            {!j.inQueue && gone && <SelectItem value="none">Sem editor por enquanto</SelectItem>}
            <SelectItem value="keep">{gone ? "Deixar parado" : `Fica com ${first(pv.person.name)}`}</SelectItem>
          </SelectContent>
        </Select>

        <Outcome j={j} gone={gone} name={name} touched={touched} />
      </div>
    </li>
  );
}

/** O que acontece com o job no destino escolhido. */
function Outcome({ j, gone, name, touched }: { j: EditJob; gone: boolean; name: (id: number | null) => string | undefined; touched: boolean }) {
  let text: React.ReactNode, tone = "";
  if (j.mode === "gestor") text = "Fica sem editor; a supervisão é avisada.";
  else if (j.mode === "keep") {
    if (gone) { text = "Fica parado, sem ninguém para fazer."; tone = "bad"; }
    else text = "Continua com a pessoa, na mesma posição.";
  } else if (j.mode === "swap") text = j.to ? `Volta para a fila de ${first(name(j.to))} quando reabrir.` : "Fica sem editor.";
  else text = <>Entra na fila de {first(name(j.to))} pelo prazo{j.late ? <span className="text-rose-600 dark:text-rose-400"> · prazo já vencido</span> : ""}</>;

  return (
    <p className={cn("flex items-center gap-1 text-[11.5px] leading-snug text-[hsl(var(--muted-foreground))]",
      tone === "bad" && "text-rose-600 dark:text-rose-400", tone === "warn" && "text-amber-700 dark:text-amber-300")}>
      <ArrowRight className="h-3 w-3 shrink-0" />
      <span className="min-w-0">{text}{!touched && <span className="text-[hsl(var(--muted-foreground))]"> · sugestão</span>}</span>
    </p>
  );
}

/** Jobs na fila de cada editor, antes e depois. */
function Load({ pv }: { pv: Preview }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {pv.editors.map(e => (
        <span key={e.id} className="text-[hsl(var(--muted-foreground))]">
          <span className="font-medium text-[hsl(var(--foreground))]">{e.name}</span> {e.before}{e.after !== e.before && <> → {e.after}</>} na fila
        </span>
      ))}
    </div>
  );
}

function OwnerSelect({ pv, value, onChange, className }: { pv: Preview; value: number | null; onChange: (v: number) => void; className?: string }) {
  return (
    <Select value={value ? String(value) : ""} onValueChange={v => onChange(Number(v))}>
      <SelectTrigger className={cn("h-9", className)} aria-label="Novo responsável"><SelectValue placeholder="Escolher gestor" /></SelectTrigger>
      <SelectContent>
        {pv.owners.map(o => (
          <SelectItem key={o.id} value={String(o.id)}>
            {o.name} <span className="text-[hsl(var(--muted-foreground))]">· {roleName(o)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

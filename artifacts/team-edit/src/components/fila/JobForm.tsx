import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Lock } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { fmt, fmtH, lmToIso, toLm } from "@/lib/fila";

const DURATIONS: [number, string][] = [[60, "1h"], [120, "2h"], [240, "4h · meio dia"], [480, "8h · 1 dia"], [720, "12h · 1 dia e meio"], [960, "16h · 2 dias"], [1440, "24h · 3 dias"]];
/** 720 → "1 dia e meio"; 600 → "1 dia e 2h"; 90 → "1h30" (dia = 8h de expediente) */
function durLabel(m: number): string {
  const d = Math.floor(m / 480), r = m % 480;
  if (!d) return r === 240 ? "meio dia" : fmtH(r);
  const days = `${d} dia${d > 1 ? "s" : ""}`;
  return !r ? days : r === 240 ? `${days} e meio` : `${days} e ${fmtH(r)}`;
}
import { Alert, Btn, Chip } from "@/components/fila/ui";
import { FollowersPicker } from "@/components/fila/followers";

interface Plan {
  editorId: number; full: boolean; queueMinutes: number; end: number; fits: boolean; lateBy: number;
  /** prazo se aceitar a data (pronto + 1h de folga); maxEst: até quantos minutos caberiam no prazo */
  newDue: number; maxEst: number | null;
  prio: { k: number; end: number; fits: boolean; passed: number; impacts: { text: string; bad: boolean }[]; approverId: number | null };
}
interface UserLite { id: number; name: string; role: string; avatarUrl?: string | null; status?: string; absence?: { label: string } | null }
interface TaskFull {
  id: number; title: string; client: string | null; description: string | null; folderUrl: string | null; status: string;
  estMinutes: number; workedMinutes: number; dueDate: string | null; startDate: string | null; lockReason: string | null; assignedToId: number | null;
  createdById: number | null; followers?: { id: number; addedById: number | null }[];
}

export type JobFormMode = "new" | "edit" | "move";

const pad = (n: number) => String(n).padStart(2, "0");
const tz = () => { const o = new Date().getTimezoneOffset(), a = Math.abs(o); return `${o <= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; };
const localDT = (d: Date, hhmm: string) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}:00${tz()}`;
const addWorkdays = (n: number) => { const d = new Date(); let k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) k++; } return d; };
const toPickerValue = (iso: string | null) => (iso ? localDT(new Date(iso), `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}`) : "");

/**
 * Formulário do job na fila em horas.
 *  new  → cria e escolhe onde entra (fim da fila, prioridade ou supervisão)
 *  edit → edita dados; rascunho pode ser publicado escolhendo onde entra
 *  move → passa para outro editor (mesma prévia)
 */
export function JobForm({ open, onOpenChange, onSaved, taskId, mode = taskId ? "edit" : "new", initialDueDate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved?: () => void; taskId?: number | null; mode?: JobFormMode;
  /** YYYY-MM-DD: prazo sugerido (ex.: clicou num dia do calendário) */
  initialDueDate?: string;
}) {
  const { user } = useAuth();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [task, setTask] = useState<TaskFull | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [hours, setHours] = useState("8");
  const [due, setDue] = useState("");
  const [lockOn, setLockOn] = useState(false);
  const [notBefore, setNotBefore] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [limit, setLimit] = useState(2400);
  const [earliest, setEarliest] = useState<number | null>(null);
  const [adjusted, setAdjusted] = useState<string | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [followers, setFollowers] = useState<number[]>([]);
  const [followers0, setFollowers0] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  const isDraft = task?.status === "rascunho";
  const placing = mode === "new" || mode === "move" || isDraft;
  // gestor trocando o editor: se mexe em prazo, vira pedido para a supervisão (com motivo)
  const gated = mode === "move" && !isSup && !!task?.assignedToId;
  const needsOk = (p: Plan, m: "end" | "prio") => gated && (m === "end" ? !p.fits : !p.prio.fits || p.prio.impacts.some(x => x.bad));

  useEffect(() => {
    if (!open) return;
    apiFetch<UserLite[]>("/api/users?active=1").then(setUsers).catch(() => {});
    if (taskId) {
      apiFetch<TaskFull>(`/api/tasks/${taskId}`).then(t => {
        setTask(t); setTitle(t.title); setClient(t.client ?? ""); setDescription(t.description ?? ""); setFolderUrl(t.folderUrl ?? "");
        setHours(String((t.estMinutes || 480) / 60)); setDue(toPickerValue(t.dueDate));
        setLockOn(!!t.startDate); setNotBefore(toPickerValue(t.startDate)); setLockReason(t.lockReason ?? "");
        const f = (t.followers ?? []).map(x => x.id); setFollowers(f); setFollowers0(f);
      }).catch(e => toast.error(e.message));
    } else {
      setTask(null); setTitle(""); setClient(""); setDescription(""); setFolderUrl(""); setHours("8"); setFollowers([]); setFollowers0([]);
      setDue(initialDueDate ? localDT(new Date(`${initialDueDate.slice(0, 10)}T12:00:00`), "18:30") : localDT(addWorkdays(2), "18:30")); setLockOn(false); setNotBefore(""); setLockReason("");
    }
    setPlans(null); setStep(0); setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const est = Math.round((parseFloat(hours.replace(",", ".")) || 0) * 60);
  const dueValid = !!due && !isNaN(new Date(due).getTime());

  // prévia: quando cada editor entrega
  useEffect(() => {
    if (!open || !(est > 0)) { setPlans(null); setEarliest(null); return; }
    const my = ++seq.current;
    const h = setTimeout(() => {
      apiPost<{ plans: Plan[]; limit: number; earliest: number; dueError: string | null }>("/api/queue/plan", {
        estMinutes: est, dueDate: dueValid ? new Date(due).toISOString() : null, startDate: lockOn && notBefore ? new Date(notBefore).toISOString() : null,
        title: title || "Job novo", taskId: taskId ?? undefined,
      }).then(r => { if (my === seq.current) { setPlans(r.plans); setLimit(r.limit); setEarliest(r.earliest); setDueError(r.dueError); setPlanErr(null); } })
        .catch(e => { if (my === seq.current) setPlanErr(e.message); });
    }, 250);
    return () => clearTimeout(h);
  }, [open, placing, est, due, dueValid, lockOn, notBefore, title, taskId]);

  // trava: o prazo nunca fica antes do momento mais cedo possível para esse tempo de execução
  const minDue = earliest != null ? Math.ceil(earliest / 30) * 30 : null;
  const minDueValue = minDue != null ? (() => { const d = new Date(lmToIso(minDue)); return localDT(d, `${pad(d.getHours())}:${pad(d.getMinutes())}`); })() : "";
  useEffect(() => {
    if (minDue == null || !dueValid || mode === "move") return;
    if (toLm(new Date(due)) < minDue) { setDue(minDueValue); setAdjusted(fmt(minDue)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDue]);
  const name = (id: number | null) => users.find(u => u.id === id)?.name ?? "—";
  const fields = () => ({
    title: title.trim(), client: client || null, description: description || null, folderUrl: folderUrl || null,
    estMinutes: est, dueDate: dueValid ? new Date(due).toISOString() : null,
    startDate: lockOn && notBefore ? new Date(notBefore).toISOString() : null, lockReason: lockOn ? lockReason || null : null,
  });
  const missing = [!title.trim() && "título", !(est > 0) && "tempo de execução", !dueValid && "prazo do cliente", dueValid && dueError && "prazo dentro do expediente"].filter(Boolean) as string[];

  async function submit(placement: { editorId?: number | null; mode: "end" | "prio" | "gestor" } | null, draft = false) {
    if (!draft && missing.length) { toast.error(`Falta: ${missing.join(", ")}`); return; }
    if (draft && !title.trim()) { toast.error("Dê um título ao rascunho"); return; }
    setBusy(true);
    try {
      let msg = "Salvo";
      if (mode === "move" && taskId) {
        const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${taskId}/place`, { ...placement, reason: reason.trim() || undefined });
        msg = r.message ?? msg;
      } else if (taskId) {
        const body: Record<string, unknown> = fields();
        if (isDraft && placement && !draft) { body.status = "pending"; body.placement = placement; }
        const r = await apiPut<{ message?: string }>(`/api/tasks/${taskId}`, body);
        if (canFollowers && followers.join() !== followers0.join()) await apiPut(`/api/tasks/${taskId}/followers`, { userIds: followers });
        msg = r.message ?? (isDraft && !draft ? "Publicado" : "Alterações salvas");
      } else {
        const r = await apiPost<{ message?: string }>("/api/tasks", { ...fields(), followerIds: followers, ...(draft ? { status: "rascunho" } : { placement }) });
        msg = r.message ?? (draft ? "Rascunho salvo" : "Job criado");
      }
      toast.success(msg);
      onSaved?.(); onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  // quem acompanha: só o dono do job escolhe (no job novo, quem está criando)
  const ownerId = task ? task.createdById : user?.id ?? null;
  const canFollowers = !task || task.createdById === user?.id;
  const none = plans && plans.every(p => p.full || !p.fits);
  const heading = mode === "move" ? `Passar para outro editor${task ? `: ${task.title}` : ""}` : taskId ? (isDraft ? "Rascunho" : "Editar job") : "Novo job";
  const sorted = useMemo(() => (plans ?? []).slice().sort((a, b) => Number(a.full) - Number(b.full) || Number(b.fits) - Number(a.fits) || a.end - b.end), [plans]);

  // job novo: uma pergunta por vez (os passos já respondidos viram um resumo clicável)
  const wizard = mode === "new" && !taskId;
  const STEPS = ["O job", "Tempo de edição", "Prazo do cliente", "Editor"];
  const stepOk = [!!title.trim(), est > 0, dueValid && !dueError, true];
  const canNext = stepOk[step];
  const next = () => { if (canNext && step < 3) setStep(step + 1); };
  const titleRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wizard || !open) return;
    const t = setTimeout(() => {
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (step === 0) titleRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [step, wizard, open]);
  const followerNames = followers.map(id => name(id).split(" ")[0]);
  const dueText = dueValid ? new Date(due).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const summaries = [
    <>{client && <span className="text-[hsl(var(--muted-foreground))]">{client} · </span>}<b>{title}</b>{followerNames.length > 0 && <span className="text-[hsl(var(--muted-foreground))]"> · acompanham: {followerNames.join(", ")}</span>}</>,
    <><b>{fmtH(est)} de edição</b> <span className="text-[hsl(var(--muted-foreground))]">· {durLabel(est)}</span></>,
    <><b>{dueText}</b>{lockOn && notBefore && <span className="text-[hsl(var(--muted-foreground))]"> · não começa antes de {new Date(notBefore).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}</>,
    null,
  ];
  const stepProps = (n: number) => ({ wizard, n, step, label: STEPS[n], summary: summaries[n], onEdit: () => setStep(n), activeRef });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[min(980px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={e => { if (mode !== "move") { e.preventDefault(); setTimeout(() => titleRef.current?.focus(), 30); } }}>
        <div className="flex flex-col gap-2.5 border-b py-3 pl-5 pr-12">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base font-bold">{heading}</DialogTitle>
            {wizard && <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">Passo {step + 1} de 4</span>}
          </div>
          {wizard && (
            <div className="flex gap-1" aria-hidden>
              {STEPS.map((_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= step ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--secondary))]")} />)}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-5 py-4"
          onKeyDown={e => {
            if (!wizard || e.key !== "Enter" || e.defaultPrevented) return;
            const el = e.target as HTMLElement;
            if (el.tagName === "BUTTON" || el.closest("[role=listbox],[role=dialog] [role=dialog]")) return;
            if (el.tagName === "TEXTAREA" && !(e.metaKey || e.ctrlKey)) return;
            if (el.tagName === "INPUT" && el.getAttribute("aria-expanded") === "true") return;
            if (canNext && step < 3) { e.preventDefault(); next(); }
          }}>
          <div className={cn("flex flex-col", wizard ? "gap-2" : "gap-5")}>
            {mode !== "move" && <>
              <Step {...stepProps(0)} heading="1 · O quê" question="Qual é o job?" hint="Dê um nome que o editor reconheça de cara. O resto ajuda, mas é opcional.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Título *
                    <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: VT Black Friday 30”" className="h-9 rounded-xl border bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" /></label>
                  <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Cliente<ClientCombobox value={client} onChange={setClient} /></label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Briefing
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="O que precisa ser entregue…" className="rounded-xl border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" /></label>
                <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Pasta do projeto
                  <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)} placeholder="\\servidor\projetos\cliente\job" className="h-9 rounded-xl border bg-[hsl(var(--background))] px-3 font-mono text-[13px] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" /></label>
                <div className="flex flex-col gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  <span>Outros gestores acompanhando <span className="opacity-70">(opcional: recebem os avisos importantes e veem o job em “Meus jobs”)</span></span>
                  <FollowersPicker users={users} value={followers} onChange={setFollowers} ownerId={ownerId} disabled={!canFollowers} />
                </div>
              </Step>

              <Step {...stepProps(1)} heading="2 · Quanto tempo é necessário para executar este trabalho? *" question="Quanto tempo de edição esse job pede?" hint="Conte só o trabalho do editor. Toque numa opção ou digite as horas.">
                <div className="flex flex-wrap items-center gap-1.5">
                  {DURATIONS.map(([m, l]) => (
                    <button key={m} type="button" onClick={() => { setHours(String(m / 60)); if (wizard && step === 1) setTimeout(() => setStep(s => (s === 1 ? 2 : s)), 260); }} aria-pressed={est === m}
                      className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors", est === m ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]")}>
                      {l}
                    </button>
                  ))}
                  <label className="ml-1 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">ou
                    <input type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} aria-label="Horas de edição"
                      className="h-8 w-20 rounded-lg border bg-[hsl(var(--background))] px-2 text-sm text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" /> horas</label>
                </div>
                {est > 0 && <p className="text-[13px]"><b>{fmtH(est)} de edição</b> <span className="text-[hsl(var(--muted-foreground))]">= {durLabel(est)} de trabalho do editor</span></p>}
              </Step>

              <Step {...stepProps(2)} heading="3 · Quando o cliente precisa receber? *" question="Quando o cliente precisa receber?" hint="As datas que não dão tempo de editar ficam riscadas.">
                <div className="max-w-sm"><DatePicker value={due} onChange={v => { setDue(v); setAdjusted(null); }} withTime placeholder="DD/MM/AAAA HH:MM" minDateTime={minDueValue || new Date().toISOString()} /></div>
                {minDue != null && <p className="text-xs text-[hsl(var(--muted-foreground))]">Com {fmtH(est)} de edição, a entrega mais cedo possível é <b className="text-[hsl(var(--foreground))]">{fmt(minDue)}</b> (com um editor disponível agora, contando só o expediente e 1h de folga antes do prazo).{adjusted && <span className="text-amber-600 dark:text-amber-400"> O prazo foi ajustado para {adjusted}.</span>}</p>}
                {dueValid && dueError && <Alert tone="bad">{dueError}</Alert>}
                <div className="flex flex-wrap gap-1.5">
                  {[["Hoje", 0], ["Amanhã", 1], ["Em 2 dias", 2], ["Em 1 semana", 5]].map(([l, n]) => {
                    const v = localDT(n ? addWorkdays(n as number) : new Date(), "18:30");
                    const blocked = minDue != null && toLm(new Date(v)) < minDue;
                    const on = dueValid && toLm(new Date(due)) === toLm(new Date(v));
                    return <button key={l} type="button" disabled={blocked} title={blocked ? "Não dá tempo de executar até lá" : undefined} aria-pressed={on}
                      onClick={() => { setDue(v); setAdjusted(null); }}
                      className={cn("rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through", on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] font-semibold text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]")}>{l} 18:30</button>;
                  })}
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Você não marca início nem fim da edição: o sistema calcula pela fila do editor, só no expediente (8h30–12h, 14h–18h30, sábado até 13h).</p>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={lockOn} onChange={e => { setLockOn(e.target.checked); if (e.target.checked && !notBefore) setNotBefore(localDT(addWorkdays(1), "08:30")); }} /><Lock className="h-3.5 w-3.5" /> Não pode começar antes de uma data (ex.: material do cliente chega depois)</label>
                {lockOn && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Não começar antes de<DatePicker value={notBefore} onChange={setNotBefore} withTime minDateTime={new Date().toISOString()} /></div>
                    <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">Motivo
                      <input value={lockReason} onChange={e => setLockReason(e.target.value)} placeholder="Material do cliente chega quinta" className="h-9 rounded-xl border bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none" /></label>
                  </div>
                )}
              </Step>
            </>}

            {placing && (
              <Step {...stepProps(3)} heading={mode === "move" ? "Para quem passar" : "4 · Onde entra na fila"} question="Quem edita?">
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  O sistema calcula quando cada editor entrega. Você escolhe: colocar onde cabe, aceitar a data calculada ou pedir prioridade. Fila acima de {fmtH(limit)} não recebe job.
                  {mode === "move" && task && task.workedMinutes > 0 && " Job começado: soma 1h de troca de mãos para quem pega."}
                </p>
                {gated && (
                  <label className="flex flex-col gap-1.5 text-xs font-semibold">
                    Motivo da troca
                    <textarea ref={reasonRef} value={reason} onChange={e => setReason(e.target.value)} rows={2}
                      placeholder="Ex.: editor travado em outro job, cliente pediu urgência…"
                      className="rounded-xl border bg-[hsl(var(--background))] px-3 py-2 text-sm font-normal text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
                    <span className="font-normal text-[hsl(var(--muted-foreground))]">Se a troca mexer em prazo, vai para a supervisão aprovar e o job fica onde está até a resposta. Sem mexer em prazo, a troca é na hora.</span>
                  </label>
                )}
                {missing.length > 0 && mode !== "move" ? <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Preencha {missing.join(", ")} para ver as opções.</p>
                  : planErr ? <Alert tone="bad">{planErr}</Alert>
                  : !plans || !dueValid ? <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Calculando…</p>
                  : <>
                    {plans.some(p => !p.full && p.fits) && plans.some(p => !p.fits) && <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Outro editor entrega no prazo</span>}
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {sorted.map(p => <PlanCard key={p.editorId} p={p} est={est} limit={limit} user={users.find(u => u.id === p.editorId)} isSup={isSup} busy={busy} name={name}
                        needsOk={m => needsOk(p, m)} onHours={m => setHours(String(m / 60))}
                        onPick={(m) => {
                          if (needsOk(p, m) && !reason.trim()) { toast.error("Essa troca mexe em prazo: diga o motivo para a supervisão."); reasonRef.current?.focus(); return; }
                          submit({ editorId: p.editorId, mode: m });
                        }} />)}
                    </div>
                    {none && (
                      <Alert tone="warn" title="Nenhum editor entrega no prazo sem mexer na fila.">
                        <span>Use uma das opções acima ou mande para a supervisão decidir (freelancer ou renegociar com o cliente).</span>
                        <div><Btn size="sm" disabled={busy} onClick={() => submit({ editorId: null, mode: "gestor" })}>Mandar para a supervisão</Btn></div>
                      </Alert>
                    )}
                  </>}
              </Step>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-[hsl(var(--card))] px-5 py-3">
          {wizard ? (
            <span className="flex items-center gap-2">
              {step > 0 && <Btn v="ghost" disabled={busy} onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" />Voltar</Btn>}
              <span className="hidden text-xs text-[hsl(var(--muted-foreground))] sm:inline">
                {step < 3 ? (canNext ? <>Enter para continuar</> : step === 0 ? "Comece pelo título." : "") : "Escolha um editor acima para colocar o job na fila."}
              </span>
            </span>
          ) : (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{missing.length && mode !== "move" ? `Falta: ${missing.join(", ")}` : placing ? "Escolha uma opção acima para colocar o job na fila." : ""}</span>
          )}
          <div className="flex gap-2">
            {mode !== "move" && (!taskId || isDraft) && <Btn disabled={busy} onClick={() => submit(null, true)}>Salvar rascunho</Btn>}
            {wizard && step < 3 && <Btn v="pri" disabled={!canNext} onClick={next}>Continuar<ArrowRight className="h-4 w-4" /></Btn>}
            {mode === "edit" && !isDraft && <Btn v="pri" disabled={busy || missing.length > 0} onClick={() => submit(null)}>Salvar alterações</Btn>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Um bloco do formulário. Fora do assistente (editar, rascunho, passar) é a seção de sempre, com o título numerado.
 * No assistente do job novo: o passo da vez aparece como pergunta; os anteriores viram resumo clicável; os próximos, só o nome.
 */
function Step({ wizard, n, step, label, heading, question, hint, summary, onEdit, activeRef, children }: {
  wizard: boolean; n: number; step: number; label: string; heading: string; question: string; hint?: string;
  summary: React.ReactNode; onEdit: () => void; activeRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode;
}) {
  if (!wizard) return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13px] font-bold">{heading}</h3>
      {children}
    </section>
  );
  const badge = (state: "done" | "now" | "next") => (
    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors",
      state === "done" ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : state === "now" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border text-[hsl(var(--muted-foreground))]")}>
      {state === "done" ? <Check className="h-3.5 w-3.5" weight="bold" /> : n + 1}
    </span>
  );
  if (n < step) return (
    <button type="button" onClick={onEdit} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--accent))]">
      {badge("done")}
      <span className="w-28 shrink-0 text-xs text-[hsl(var(--muted-foreground))] max-sm:hidden">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{summary}</span>
      <span className="text-xs font-semibold text-[hsl(var(--primary))] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-100">Alterar</span>
    </button>
  );
  if (n > step) return (
    <div className="flex items-center gap-3 px-3 py-2 opacity-55">{badge("next")}<span className="text-[13px] text-[hsl(var(--muted-foreground))]">{label}</span></div>
  );
  return (
    <section ref={activeRef} className="step-in flex flex-col gap-3 rounded-2xl border border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--card))] p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        {badge("now")}
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[16px] font-semibold leading-snug">{question}</h3>
          {hint && <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{hint}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:pl-9">{children}</div>
    </section>
  );
}

function PlanCard({ p, est, limit, user, isSup, busy, name, needsOk, onPick, onHours }: {
  p: Plan; est: number; limit: number; user?: UserLite; isSup: boolean; busy: boolean; name: (id: number | null) => string;
  needsOk: (m: "end" | "prio") => boolean; onPick: (m: "end" | "prio") => void; onHours: (m: number) => void;
}) {
  const ask = "Pedir à supervisão: ";
  const head = (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={user?.name ?? "?"} avatarUrl={user?.avatarUrl ?? null} size={26} /><b className="truncate text-sm">{user?.name ?? `#${p.editorId}`}</b>{user?.absence && <Chip tone="warn">{user.absence.label}</Chip>}</span>
      <span className="text-xs text-[hsl(var(--muted-foreground))]">fila {fmtH(p.queueMinutes)} → {fmtH(p.queueMinutes + est)} de {fmtH(limit)}</span>
    </div>
  );
  const base = "flex min-w-0 flex-col gap-2 rounded-xl border bg-[hsl(var(--background))] p-3";
  if (p.full && !isSup) return (
    <div className={cn(base, "opacity-65")}>{head}<Chip tone="bad" className="self-start">fila cheia</Chip>
      <span className="text-xs text-[hsl(var(--muted-foreground))]">Com este job passaria do limite de {fmtH(limit)}. Não entra; só a supervisão pode decidir.</span></div>
  );
  const endLine = <>
    <span className="text-xs text-[hsl(var(--muted-foreground))]">No fim da fila: pronto <b className="text-[hsl(var(--foreground))]">{fmt(p.end)}</b></span>
    {p.fits ? <Chip tone="ok" className="self-start">entrega no prazo</Chip>
      : p.lateBy > 0 ? <Chip tone="bad" className="self-start">passa do prazo {fmtH(p.lateBy)}</Chip>
      : <Chip tone="warn" className="self-start">em cima do prazo: menos de 1h de folga</Chip>}
    {p.full && <Chip tone="warn" className="self-start">agenda cheia: só a supervisão</Chip>}
  </>;
  if (p.fits) return <div className={base}>{head}{endLine}<div><Btn v="pri" size="sm" disabled={busy} onClick={() => onPick("end")}>Colocar na fila de {user?.name.split(" ")[0]}</Btn></div></div>;
  const pr = p.prio;
  return (
    <div className={base}>{head}{endLine}
      <span className="text-xs text-[hsl(var(--muted-foreground))]">Com este prazo o job não entra: quebraria a agenda de {user?.name.split(" ")[0] ?? "o editor"}.</span>
      {p.maxEst != null && <>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Diminuir as horas</span>
        <div><Btn size="sm" disabled={busy} onClick={() => onHours(p.maxEst!)}>Cabe com até {fmtH(p.maxEst)}: usar {fmtH(p.maxEst)}</Btn></div>
      </>}
      <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Mudar o prazo</span>
      <div><Btn size="sm" disabled={busy} onClick={() => onPick("end")}>{needsOk("end") ? ask : ""}Colocar no fim: prazo passa para {fmt(p.newDue)}</Btn></div>
      <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pedir prioridade</span>
      <span className="text-xs text-[hsl(var(--muted-foreground))]">{pr.fits ? `Entraria em ${pr.k + 1}º e fica pronto ${fmt(pr.end)}.` : `Mesmo em ${pr.k + 1}º fica pronto só ${fmt(pr.end)}: passa do prazo.`}{pr.passed ? ` Passa na frente de ${pr.passed} job${pr.passed > 1 ? "s" : ""} de outro coordenador.` : ""}</span>
      {pr.impacts.length > 0 && <ul className="list-disc pl-5 text-xs text-[hsl(var(--muted-foreground))]">{pr.impacts.map((x, i) => <li key={i} className={x.bad ? "text-rose-500" : ""}>{x.text}</li>)}</ul>}
      <div><Btn size="sm" disabled={busy} onClick={() => onPick("prio")}>{needsOk("prio") ? `${ask}colocar na frente` : pr.approverId ? `Pedir prioridade a ${name(pr.approverId).split(" ")[0]}` : "Colocar na frente (ninguém de outro coordenador atrasa)"}</Btn></div>
    </div>
  );
}

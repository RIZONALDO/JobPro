import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Alert, Btn, Chip } from "@/components/fila/ui";
import { fmt, fmtH } from "@/lib/fila";
import { FollowersPicker } from "@/components/fila/followers";
import { EstInput } from "@/components/fila/job-shared";

/** Prévia de cada editor: com estas horas, o job entra no fim da fila e é entregue quando. */
interface Plan {
  editorId: number; count: number; late: number; offToday: string | null;
  pos: number; start: number; due: number;
}
interface UserLite { id: number; name: string; role: string; avatarUrl?: string | null; status?: string; absence?: { label: string } | null }
interface TaskFull {
  id: number; title: string; client: string | null; description: string | null; folderUrl: string | null; status: string;
  dueDate: string | null; estMinutes: number; assignedToId: number | null;
  createdById: number | null; followers?: { id: number; addedById: number | null }[];
}

export type JobFormMode = "new" | "edit" | "move";

/**
 * Formulário do job. O gestor informa as horas de trabalho; o prazo de entrega é calculado (as horas contam no
 * expediente do editor, na ordem da fila, + 1h). O job entra no fim da fila; para mudar a ordem, arraste na fila.
 *  new  → cria e escolhe o editor (ou supervisão)
 *  edit → edita dados; rascunho pode ser publicado escolhendo onde entra
 *  move → passa para outro editor
 */
export function JobForm({ open, onOpenChange, onSaved, taskId, mode = taskId ? "edit" : "new" }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved?: () => void; taskId?: number | null; mode?: JobFormMode;
  /** legado (calendário): o prazo agora sai das horas */
  initialDueDate?: string;
}) {
  const { user } = useAuth();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [task, setTask] = useState<TaskFull | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [est, setEst] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [duePrev, setDuePrev] = useState<number | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [followers, setFollowers] = useState<number[]>([]);
  const [followers0, setFollowers0] = useState<number[]>([]);
  const [step, setStep] = useState(0);

  const isDraft = task?.status === "rascunho";
  const placing = mode === "new" || mode === "move" || isDraft;

  useEffect(() => {
    if (!open) return;
    apiFetch<UserLite[]>("/api/users?active=1").then(setUsers).catch(() => {});
    if (taskId) {
      apiFetch<TaskFull>(`/api/tasks/${taskId}`).then(t => {
        setTask(t); setTitle(t.title); setClient(t.client ?? ""); setDescription(t.description ?? ""); setFolderUrl(t.folderUrl ?? "");
        setEst(t.estMinutes > 0 ? t.estMinutes : null);
        const f = (t.followers ?? []).map(x => x.id); setFollowers(f); setFollowers0(f);
      }).catch(e => toast.error(e.message));
    } else {
      setTask(null); setTitle(""); setClient(""); setDescription(""); setFolderUrl(""); setFollowers([]); setFollowers0([]);
      setEst(null);
    }
    setPlans(null); setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const estValid = est != null && est > 0;

  // prévia: com estas horas, quando o job é entregue no fim da fila de cada editor
  useEffect(() => {
    if (!open || !placing || !estValid) { setPlans(null); return; }
    const h = setTimeout(() => {
      apiPost<{ plans: Plan[] }>("/api/queue/plan", { taskId: taskId ?? undefined, estMinutes: est })
        .then(r => { setPlans(r.plans); setPlanErr(null); }).catch(e => setPlanErr(e.message));
    }, 200);
    return () => clearTimeout(h);
  }, [open, placing, taskId, est, estValid]);

  // prévia na edição: com as horas novas, para onde vai o prazo (a mesma conta de quando salva)
  const estChanged = mode === "edit" && !isDraft && !!taskId && estValid && est !== task?.estMinutes;
  useEffect(() => {
    if (!open || !estChanged) { setDuePrev(null); return; }
    const h = setTimeout(() => {
      apiPost<{ due: number | null }>(`/api/queue/tasks/${taskId}/due-preview`, { estMinutes: est })
        .then(r => setDuePrev(r.due)).catch(() => setDuePrev(null));
    }, 200);
    return () => clearTimeout(h);
  }, [open, estChanged, taskId, est]);

  const name = (id: number | null) => users.find(u => u.id === id)?.name ?? "—";
  const fields = () => ({
    title: title.trim(), client: client || null, description: description || null, folderUrl: folderUrl || null,
    ...(estValid ? { estMinutes: est } : {}),
  });
  const missing = [!title.trim() && "título", !estValid && "horas de trabalho"].filter(Boolean) as string[];

  async function submit(placement: { editorId?: number | null; mode: "fila" | "gestor" } | null, draft = false) {
    if (!draft && missing.length && mode !== "move") { toast.error(`Falta: ${missing.join(", ")}`); return; }
    if (draft && !title.trim()) { toast.error("Dê um título ao rascunho"); return; }
    setBusy(true);
    try {
      let msg = "Salvo";
      if (mode === "move" && taskId) {
        const changed = estValid && est !== task?.estMinutes;
        const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${taskId}/place`, { ...(placement ?? {}), ...(changed ? { estMinutes: est } : {}) });
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
  const heading = mode === "move" ? `Passar para outro editor${task ? `: ${task.title}` : ""}` : taskId ? (isDraft ? "Rascunho" : "Editar job") : "Novo job";
  // quem entrega mais cedo primeiro (fora hoje vai para o fim)
  const sorted = useMemo(() => (plans ?? []).filter(p => mode !== "move" || p.editorId !== task?.assignedToId).slice()
    .sort((a, b) => Number(!!a.offToday) - Number(!!b.offToday) || a.due - b.due), [plans, mode, task]);
  const best = sorted[0]?.editorId;

  // job novo: uma pergunta por vez (os passos já respondidos viram um resumo clicável)
  const wizard = mode === "new" && !taskId;
  const STEPS = ["O job", "Horas de trabalho", "Editor"];
  const LAST = STEPS.length - 1;
  const stepOk = [!!title.trim(), estValid, true];
  const canNext = stepOk[step];
  const next = () => { if (canNext && step < LAST) setStep(step + 1); };
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
  const estText = estValid ? `${fmtH(est)} de trabalho` : "";
  const summaries = [
    <>{client && <span className="text-[hsl(var(--muted-foreground))]">{client} · </span>}<b>{title}</b>{followerNames.length > 0 && <span className="text-[hsl(var(--muted-foreground))]"> · acompanham: {followerNames.join(", ")}</span>}</>,
    <b>{estText}</b>,
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
            {wizard && <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">Passo {step + 1} de {STEPS.length}</span>}
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
            if (canNext && step < LAST) { e.preventDefault(); next(); }
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

              <Step {...stepProps(1)} heading="2 · Horas de trabalho *" question="Quanto tempo de edição?" hint="O prazo de entrega é calculado: as horas contam no expediente do editor, na ordem da fila, e a entrega fica 1h depois. Se o job mudar de lugar na fila, o prazo acompanha.">
                <EstInput value={est} onChange={setEst} />
                {mode === "edit" && !isDraft && task?.dueDate && <p className="text-xs text-[hsl(var(--muted-foreground))]">Prazo de entrega agora: <b className="text-[hsl(var(--foreground))]">{new Date(task.dueDate).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>.{" "}
                  {estChanged && duePrev != null ? <>Com {fmtH(est)}, passa para <b className="text-[hsl(var(--foreground))]">{fmt(duePrev)}</b> ao salvar.</> : "Ao salvar novas horas, ele é recalculado."}</p>}
              </Step>
            </>}

            {placing && (
              <Step {...stepProps(2)} heading={mode === "move" ? "Para quem passar" : "3 · Onde entra na fila"} question="Quem edita?">
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  O job entra no fim da fila. Para mudar a ordem depois, arraste o job na fila: os prazos de entrega são recalculados.
                </p>
                {missing.length > 0 && mode !== "move" ? <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Preencha {missing.join(", ")} para ver as opções.</p>
                  : planErr ? <Alert tone="bad">{planErr}</Alert>
                  : !plans ? <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Carregando…</p>
                  : <>
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {sorted.map(p => <PlanCard key={p.editorId} p={p} best={p.editorId === best} user={users.find(u => u.id === p.editorId)} busy={busy}
                        onPick={() => submit({ editorId: p.editorId, mode: "fila" })} />)}
                    </div>
                    {!isSup && <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                      Não sabe quem pode pegar?<Btn size="sm" v="ghost" disabled={busy} onClick={() => submit({ editorId: null, mode: "gestor" })}>Mandar para a supervisão escolher</Btn>
                    </div>}
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
                {step < LAST ? (canNext ? <>Enter para continuar</> : step === 0 ? "Comece pelo título." : "") : "Escolha um editor acima para colocar o job na fila."}
              </span>
            </span>
          ) : (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{missing.length && mode !== "move" ? `Falta: ${missing.join(", ")}` : placing ? "Escolha uma opção acima para colocar o job na fila." : ""}</span>
          )}
          <div className="flex gap-2">
            {mode !== "move" && (!taskId || isDraft) && <Btn disabled={busy} onClick={() => submit(null, true)}>Salvar rascunho</Btn>}
            {wizard && step < LAST && <Btn v="pri" disabled={!canNext} onClick={next}>Continuar<ArrowRight className="h-4 w-4" /></Btn>}
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

function PlanCard({ p, best, user, busy, onPick }: {
  p: Plan; best: boolean; user?: UserLite; busy: boolean; onPick: () => void;
}) {
  const first = user?.name.split(" ")[0] ?? "o editor";
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-[hsl(var(--background))] p-3", best && "border-emerald-500/50")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={user?.name ?? "?"} avatarUrl={user?.avatarUrl ?? null} size={26} /><b className="truncate text-sm">{user?.name ?? `#${p.editorId}`}</b>{(p.offToday ?? user?.absence?.label) && <Chip tone="warn">{p.offToday ?? user?.absence?.label}</Chip>}</span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{p.count ? `${p.count} job${p.count > 1 ? "s" : ""} na fila` : "fila vazia"}{p.late > 0 && <span className="text-rose-500"> · {p.late} atrasado{p.late > 1 ? "s" : ""}</span>}</span>
      </div>
      <span className="text-xs">
        <b>Entra em {p.pos}º</b>
        <span className="text-[hsl(var(--muted-foreground))]">{p.count ? ` · começa ${fmt(p.start)}` : " · começa agora"}</span>
      </span>
      <span className="text-sm">Entrega: <b className={best ? "text-emerald-600 dark:text-emerald-400" : ""}>{fmt(p.due)}</b>{best && <span className="text-xs text-emerald-600 dark:text-emerald-400"> · mais cedo</span>}</span>
      <div><Btn v={best ? "pri" : "def"} size="sm" disabled={busy} onClick={onPick}>Colocar na fila de {first}</Btn></div>
    </div>
  );
}

import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Play, MoreHorizontal, ArrowUp, ArrowDown, GripVertical, ArrowsDownUp, ListOrdered, CalendarRange, HandPalm, Mail, Question, Timer, CheckCircle2, Shuffle } from "@/lib/icons";
import { openHandoff } from "@/components/fila/HandoffDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { blockedLine, deadlineState, dur, fmt, fmtH, inQueue, personName, planMove, queueLine, relDay, useBoard, type Board, type PlanItem, type QTask } from "@/lib/fila";
import { Alert, Btn, Chip, HeadAction, Section } from "@/components/fila/ui";
import { QueueTrack } from "@/components/fila/QueueTrack";
import { Notices } from "@/components/fila/Notices";
import { OccAvatar, OccMeter } from "@/components/fila/Occupancy";
import { Tour, type TourStep } from "@/components/tour/Tour";
import { QueueHistoryButton } from "@/components/fila/QueueHistory";
import { JobForm, type JobFormMode } from "@/components/fila/JobForm";
import { AskDialog, ago, type Ask } from "@/components/fila/job-shared";


async function run(p: Promise<unknown>, ok?: string) {
  try { const r = await p as { message?: string; auto?: boolean; approverId?: number | null } | undefined; toast.success(r?.message ?? ok ?? "Feito"); return r; }
  catch (e) { toast.error((e as Error).message); return null; }
}

/** Título de bloco com ícone e contador. */
function Title({ icon: I, n, children }: { icon: React.ComponentType<{ className?: string }>; n?: number; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <I className="h-4 w-4 text-[hsl(var(--primary))]" />{children}
      {!!n && <span className="rounded-full bg-[hsl(var(--primary)/0.14)] px-1.5 text-[11px] font-bold leading-5 text-[hsl(var(--primary))] tabular-nums">{n}</span>}
    </span>
  );
}

/** Coordenação: vê a fila de todos os editores; mexe só nos próprios jobs. */
export default function Filas() {
  usePageTitle("Filas");
  const { board, error, reload } = useBoard();
  if (error) return <p className="p-6 text-sm text-rose-500">{error}</p>;
  if (!board) return <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Carregando as filas…</p>;
  return <CoordView board={board} reload={reload} />;
}

function CoordView({ board, reload }: { board: Board; reload: () => void }) {
  const { openTask } = useTaskModal();
  const me = board.me, now = board.now;
  const isSup = board.role === "admin" || board.role === "supervisor";
  const canManage = (t: QTask) => isSup || t.coordId === me;
  const [form, setForm] = useState<{ open: boolean; id?: number | null; mode?: JobFormMode }>({ open: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  // job sendo arrastado na fila: destacado também na agenda
  const [focus, setFocus] = useState<number | null>(null);
  // prévia ao arrastar: as filas como ficariam se soltasse ali (a agenda redesenha e lista os prazos que mudam)
  const [plan, setPlan] = useState<Map<number, PlanItem[]> | null>(null);

  const mine = board.tasks.filter(t => t.coordId === me);
  const fila = mine.filter(inQueue);
  const late = fila.filter(t => t.late);
  const waiting = mine.filter(t => t.status === "review");
  // travado com prazo correndo: a supervisão vê os de todos; o mais crítico primeiro
  const blocked = (isSup ? board.tasks : mine).filter(t => t.status === "paused")
    .sort((a, b) => Number(!!b.blocked?.critical) - Number(!!a.blocked?.critical) || (a.promised ?? Infinity) - (b.promised ?? Infinity));
  const noEditor = mine.filter(t => !t.editorId && t.status === "pending");
  const act = async (p: string, b: unknown = {}, ok?: string) => { if (await run(apiPost(p, b), ok)) reload(); };
  // arrastar na agenda: mesmo endpoint de arrastar na fila
  const moveJob = async (id: number, editorId: number, index: number) => {
    try { const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${id}/move`, { editorId, index }); toast.success(r?.message ?? "Movido"); reload(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const items: React.ReactNode[] = [];
  for (const t of blocked) items.push(
    <Alert key={`b${t.id}`} tone={t.blocked?.critical ? "bad" : "warn"} icon={<HandPalm />}
      title={`“${t.title}” travado${t.blocked?.since != null ? ` há ${ago(now - t.blocked.since)}` : ""} (${personName(board, t.editorId)}${t.coordId !== me ? ` · de ${personName(board, t.coordId).split(" ")[0]}` : ""})`}>
      <span>{t.blockReason ?? "Sem motivo"}</span>
      <span className={cn("text-[12.5px]", t.blocked?.critical ? "font-medium text-rose-600 dark:text-rose-400" : "text-[hsl(var(--muted-foreground))]")}>
        {t.blocked?.critical ? "Prazo em risco: " : ""}{blockedLine(t, now)}
      </span>
      {canManage(t) && <div className="flex flex-wrap gap-2"><Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/unblock`, {}, "Destravado")}>Destravar: volta para a frente</Btn>
        <Btn size="sm" v="ghost" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Passar para outro editor</Btn>
        <Btn size="sm" v="ghost" onClick={() => setAsk({ kind: "archive", job: { id: t.id, taskCode: t.code, title: t.title, client: t.client, dueDate: null } })}>Encerrar…</Btn>
        <Btn size="sm" v="ghost" onClick={() => openTask(t.id)}>Abrir job</Btn></div>}
    </Alert>);
  for (const t of waiting) items.push(
    <Alert key={`w${t.id}`} tone="info" icon={<Mail />} title={`“${t.title}” com o cliente${t.sentAt ? ` desde ${fmt(t.sentAt)}` : ""}`}>
      <span>Editor: {personName(board, t.editorId)}. Prazo de entrega: {fmt(t.promised)}.</span>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/client-ok`, {}, "Job concluído")}>Cliente aprovou</Btn>
        <Btn size="sm" onClick={() => setAsk({ kind: "change", job: { id: t.id, taskCode: t.code, title: t.title, client: t.client, dueDate: null } })}>Cliente pediu alteração</Btn>
      </div>
    </Alert>);
  for (const t of noEditor) items.push(<Alert key={`n${t.id}`} tone="warn" icon={<Question />} title={`“${t.title}” sem editor`}><span>Enviado para a supervisão decidir. {fmtH(t.est)} de trabalho.</span>
    <div><Btn size="sm" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Escolher editor</Btn></div></Alert>);
  for (const t of late) items.push(
    <Alert key={`l${t.id}`} tone="warn" icon={<Timer />} title={`“${t.title}” está atrasado`}>
      <span>{personName(board, t.editorId)} · {(t.pos ?? 0) + 1}º na fila · prazo {fmt(t.promised)}</span>
      <div className="flex flex-wrap gap-2"><Btn size="sm" onClick={() => setForm({ open: true, id: t.id, mode: "edit" })}>Ajustar as horas</Btn>
        <Btn size="sm" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Passar para outro editor</Btn></div>
    </Alert>);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Filas dos editores</h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Você vê a fila de todos. Arraste os jobs para mudar a ordem ou o editor: os prazos de entrega são recalculados pelas horas de trabalho.</p>
        </div>
        <HeadAction data-tour="novo-job" icon={Plus} label="Novo job" onClick={() => setForm({ open: true, id: null, mode: "new" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div data-tour="precisa" className="flex min-w-0"><Section className="flex-1" title={<Title icon={CheckCircle2} n={items.length}>Precisa de você</Title>}>
          {items.length ? <div className="flex flex-col gap-2">{items}</div>
            : <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-5 text-[13px] text-[hsl(var(--muted-foreground))]"><CheckCircle2 className="h-5 w-5 text-emerald-500" />Tudo em dia. Nada depende de você agora.</div>}
        </Section></div>
        <div data-tour="avisos" className="relative lg:min-h-[220px]"><Notices className="max-h-[420px] lg:absolute lg:inset-0 lg:max-h-none" /></div>
      </div>

      <PartHead icon={CalendarRange} title="Agenda dos editores" hint="Previsão de cada job nas horas de expediente. Clique num bloco para abrir." />
      <QueueTrack board={board} me={me} focus={focus} plan={plan} onOpen={t => openTask(t.id)} onMove={moveJob} />

      <PartHead icon={ListOrdered} title="Fila de cada editor" hint="Arraste para mudar a ordem ou o editor. O prazo sai das horas de trabalho." />
      <EditorQueues board={board} me={me} now={now} canManage={canManage} onOpen={id => openTask(id)} onFocus={setFocus} onPlan={setPlan}
        onEdit={id => setForm({ open: true, id, mode: "edit" })} onPass={id => setForm({ open: true, id, mode: "move" })} reload={reload} />

      <JobForm open={form.open} onOpenChange={o => setForm(f => ({ ...f, open: o }))} taskId={form.id} mode={form.mode} onSaved={reload} />
      <Tour id="fila-gestor" steps={TOUR} />
      <AskDialog ask={ask} onClose={() => setAsk(null)} onDone={reload} />
    </div>
  );
}

/* ── tour da tela (abre na primeira visita e pelo "?" do topo) ── */
const TOUR: TourStep[] = [
  { target: "novo-job", title: "Comece pelo Novo job", text: "Título, horas de edição e editor. O prazo de entrega é calculado sozinho: horas no expediente + 1h." },
  { target: "precisa", title: "Precisa de você", text: "Só o que espera uma ação sua, já com os botões para resolver." },
  { target: "avisos", title: "Avisos", text: "O importante: prazo vencido, job travado, job pronto para o cliente. Clique para abrir o job." },
  { target: "agenda", title: "Agenda dos editores", text: "Cada bloco é um job, do tamanho das horas de trabalho. Eles ficam colados, na ordem da fila." },
  { target: "agenda-block", title: "Arraste para mudar a ordem", text: "Solte na mesma linha ou na de outro editor. Antes de soltar, o rodapé mostra quais prazos mudam." },
  { target: "historico", title: "Por que o prazo mudou?", text: "O relógio ao lado do editor mostra a ordem atual e a história de cada prazo." },
  { target: "fila", title: "Fila de cada editor", text: "A mesma fila, em lista. O 1º é o job em edição e não sai da frente. Aqui também dá para arrastar." },
  { target: "fila-menu", title: "Menu do job", text: "Subir ou descer na fila, passar para outro editor ou ajustar as horas." },
  { target: "sino", title: "Sininho", text: "Só informação: prazo recalculado, job movido, job começou." },
  { target: "ajuda", title: "Rever quando quiser", text: "Este botão abre o tour de novo." },
];

/* ── título de cada parte da página ── */
function PartHead({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <div className="mt-6 flex flex-col gap-0.5 border-t pt-5">
      <h2 className="inline-flex items-center gap-2 text-[15px] font-bold"><Icon className="h-4 w-4 text-[hsl(var(--primary))]" />{title}</h2>
      <p className="text-[12.5px] text-[hsl(var(--muted-foreground))]">{hint}</p>
    </div>
  );
}

/* ── fila de cada editor: uma trilha por editor (agora → depois), poucos dados e bastante respiro ── */
function EditorQueues({ board, me, now, canManage, onOpen, onFocus, onPlan, onEdit, onPass, reload }: {
  board: Board; me: number; now: number; canManage: (t: QTask) => boolean; onFocus: (id: number | null) => void;
  onPlan: (p: Map<number, PlanItem[]> | null) => void;
  onOpen: (id: number) => void; onEdit: (id: number) => void; onPass: (id: number) => void; reload: () => void;
}) {
  const muted = "text-[hsl(var(--muted-foreground))]";
  const sup = board.role === "admin" || board.role === "supervisor";
  // arrastar: qualquer gestor move qualquer job (menos o em edição); soltar recalcula os prazos de todos
  const [drag, setDrag] = useState<{ id: number; ed: number; k: number } | null>(null);
  const [over, setOver] = useState<{ ed: number; k: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const moveTo = async (id: number, fromEd: number, fromK: number, ed: number, k: number) => {
    const index = fromEd === ed && fromK < k ? k - 1 : k;
    if (fromEd === ed && index === fromK) return;
    setBusy(true);
    try { const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${id}/move`, { editorId: ed, index }); toast.success(r?.message ?? "Movido"); reload(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  // prévia: a cada lugar novo sob o mouse, simula as filas (sem gravar nada)
  useEffect(() => {
    if (!drag || !over) { onPlan(null); return; }
    const index = drag.ed === over.ed && drag.k < over.k ? over.k - 1 : over.k;
    onPlan(drag.ed === over.ed && index === drag.k ? null : planMove(board, drag.id, drag.ed, over.ed, index));
  }, [drag?.id, drag?.ed, drag?.k, over?.ed, over?.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = () => { if (drag && over) moveTo(drag.id, drag.ed, drag.k, over.ed, over.k); setDrag(null); setOver(null); };
  const hover = (e: React.DragEvent, ed: number, k: number, min: number) => {
    if (!drag) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    const n = Math.max(min, k);
    if (over?.ed !== ed || over.k !== n) setOver({ ed, k: n });
  };
  const mark = <li aria-hidden className="pointer-events-none -mx-2 h-0.5 rounded-full bg-[hsl(var(--primary))] shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]" />;
  return (
    <section data-tour="fila" className={cn("grid overflow-hidden rounded-xl border bg-[hsl(var(--card))] transition-opacity md:grid-cols-2 md:divide-x xl:[grid-template-columns:repeat(auto-fit,minmax(380px,1fr))] max-md:divide-y", busy && "pointer-events-none opacity-70")}>
      {board.editors.map(ed => {
        const { items, freeFrom } = queueLine(board, ed.id);
        const q = items.map(i => i.t);
        // quem saiu ou está fora hoje (ausência própria, não feriado) e ainda tem jobs: caminho para redistribuir
        const owns = board.tasks.filter(t => t.editorId === ed.id).length;
        const stuck = board.tasks.filter(t => t.editorId === ed.id && t.status === "paused");
        const away = ed.inactive ? "Inativo" : ed.offToday;
        return (
          <div key={ed.id} className="min-w-0 px-5 py-5 sm:px-6">
            {away && owns > 0 && sup && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{ed.inactive ? "Saiu da equipe" : `${away} hoje`}</span>
                  <span className={muted}> · {owns} job{owns > 1 ? "s" : ""} no nome de {ed.name.split(" ")[0]}</span>
                </span>
                <button type="button" onClick={() => openHandoff({ userId: ed.id, context: "queue", onDone: reload })}
                  className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                  <Shuffle className="h-3.5 w-3.5" />Redistribuir
                </button>
              </div>
            )}
            <header className="mb-5 flex items-center gap-3">
              <OccAvatar board={board} editorId={ed.id} name={ed.name} avatarUrl={board.people.find(p => p.id === ed.id)?.avatarUrl ?? null} size={36} />
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">{ed.name}{ed.inactive ? <Chip tone="neu">Inativo</Chip> : ed.offToday && <Chip tone="warn">{ed.offToday}</Chip>}</h3>
                <p className={cn("text-xs", muted)}>{q.length ? `${q.length} job${q.length > 1 ? "s" : ""} na fila` : "Sem jobs na fila"}{ed.late > 0 && <span className="text-rose-500"> · {ed.late} atrasado{ed.late > 1 ? "s" : ""}</span>}</p>
                <OccMeter board={board} editorId={ed.id} className="mt-1" />
              </div>
              <QueueHistoryButton editorId={ed.id} name={ed.name} />
            </header>
            {q.length ? (
              <ol className="relative flex flex-col gap-1" onDragOver={e => drag && e.preventDefault()} onDrop={e => { e.preventDefault(); drop(); }}>
                {items.map(({ t, late, risk: atRisk }, k) => {
                  const own = canManage(t), d = deadlineState(t, now);
                  const risk = late || atRisk || d.tone === "warn";
                  const state = late ? `atrasado ${dur(now - t.promised!)}` : atRisk ? "em risco" : d.tone === "warn" ? "vence hoje" : "prazo";
                  const stateCls = late ? "text-rose-500" : "text-amber-600 dark:text-amber-400";
                  // o olho segue a fila: o 1º em destaque, o 2º normal, os demais cada vez mais discretos
                  const first = k === 0, fade = k === 0 ? "" : k === 1 ? "" : k === 2 ? "opacity-75" : "opacity-55";
                  const tag = first ? (t.playing ? "Agora" : "Próximo") : k === 1 ? "Depois" : null;
                  const min = q[0]?.playing ? 1 : 0, canMove = !t.playing;
                  return (
                    <Fragment key={t.id}>
                    {over?.ed === ed.id && over.k === k && drag?.id !== t.id && mark}
                    <li draggable={canMove}
                      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); setDrag({ id: t.id, ed: ed.id, k }); onFocus(t.id); }}
                      onDragEnd={() => { setDrag(null); setOver(null); onFocus(null); }}
                      onDragOver={e => { const r = e.currentTarget.getBoundingClientRect(); hover(e, ed.id, e.clientY < r.top + r.height / 2 ? k : k + 1, min); }}
                      className={cn("group relative -mx-2 grid grid-cols-[22px_minmax(0,1fr)_auto] gap-x-3.5 rounded-xl px-2 transition-[background-color,opacity]", canMove && "cursor-move", drag?.id === t.id && "opacity-40",
                      first ? cn("mb-1.5 py-3.5 ring-1", late ? "bg-rose-500/[0.06] ring-rose-500/40" : "bg-[hsl(var(--foreground)/0.04)] ring-[hsl(var(--border))]") : cn("py-2.5 hover:bg-[hsl(var(--accent)/0.45)]", atRisk && "bg-amber-500/[0.06]"),
                      fade, "hover:opacity-100")}>
                      <span className={cn("absolute -bottom-2.5 left-[18.5px] w-px", first ? "top-[46px]" : "top-[38px]", k === 0 ? "bg-[hsl(var(--border))]" : "bg-[hsl(var(--border)/0.6)]")} aria-hidden />
                      <span className={cn("relative mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border text-[10.5px] font-semibold tabular-nums",
                        t.playing ? "border-emerald-500 bg-emerald-500 text-white"
                          : first ? "border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
                          : k === 1 ? "border-[hsl(var(--foreground)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]"
                          : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]")}
                        title={t.playing ? "em edição: não sai da frente" : `${k + 1}º na fila · arraste para mudar de lugar ou de editor`}>
                        {t.playing ? <Play weight="fill" className="h-2.5 w-2.5" /> : <><span className="group-hover:hidden">{k + 1}</span><GripVertical className="hidden h-3.5 w-3.5 group-hover:block" /></>}
                      </span>
                      <div className="min-w-0">
                        {tag && <p className={cn("text-[10.5px] font-semibold uppercase tracking-[0.08em]", t.playing ? "text-emerald-600 dark:text-emerald-400" : muted)}>{tag}</p>}
                        <button type="button" onClick={() => onOpen(t.id)} className={cn("block max-w-full truncate text-left hover:underline",
                          first ? "text-[15.5px] font-semibold leading-6" : k === 1 ? "text-[14px] font-medium leading-6" : "text-[13.5px] leading-6", !own && !first && muted)}>{t.title}</button>
                        <p className={cn("truncate text-xs leading-5 max-sm:whitespace-normal", muted)}>
                          {t.playing && <span className="text-emerald-600 dark:text-emerald-400">em edição · </span>}
                          {t.est > 0 ? fmtH(t.est) : <span className="font-medium text-amber-600 dark:text-amber-400">sem horas</span>} · {t.client ?? "sem cliente"}{t.coordId !== me && ` · ${personName(board, t.coordId).split(" ")[0]}`}
                        </p>
                      </div>
                      <div className="flex items-start gap-1">
                        <div className="text-right leading-6">
                          <p className={cn("tabular-nums", first ? "text-[14px] font-semibold" : "text-[13px]")} title={`Prazo ${fmt(t.promised)}`}>{t.promised != null ? relDay(t.promised, now) : "—"}</p>
                          <p className={cn("text-xs leading-5", risk ? cn(stateCls, "font-medium") : muted)} title={atRisk ? "Tem job atrasado na frente e este vence em menos de 24h" : undefined}>{state}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><button type="button" data-tour={t.playing ? undefined : "fila-menu"} aria-label={`Ações de ${t.title}`} className={cn("-mr-1 grid h-7 w-7 place-items-center rounded-md opacity-50 transition-opacity hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100", muted)}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[200px]">
                            <DropdownMenuItem onClick={() => onOpen(t.id)}>Abrir job</DropdownMenuItem>
                            {canMove && k > min && <DropdownMenuItem onClick={() => moveTo(t.id, ed.id, k, ed.id, k - 1)}><ArrowUp className="mr-2 h-4 w-4" />Subir na fila</DropdownMenuItem>}
                            {canMove && k < q.length - 1 && <DropdownMenuItem onClick={() => moveTo(t.id, ed.id, k, ed.id, k + 2)}><ArrowDown className="mr-2 h-4 w-4" />Descer na fila</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => onPass(t.id)}>Passar para outro editor</DropdownMenuItem>
                            {own && <DropdownMenuItem onClick={() => onEdit(t.id)}>Ajustar horas / editar</DropdownMenuItem>}
                            {t.playing && <p className={cn("px-2 py-1 text-xs", muted)}>Em edição: não sai da frente.</p>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                    </Fragment>
                  );
                })}
                {over?.ed === ed.id && over.k === q.length && mark}
                <li onDragOver={e => hover(e, ed.id, q.length, 0)} className="relative -mx-2 grid grid-cols-[22px_minmax(0,1fr)] gap-x-3.5 px-2 py-2 text-xs">
                  <span className="absolute -top-1 left-[18.5px] h-3 w-px bg-[hsl(var(--border))]" aria-hidden />
                  <span className="mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-emerald-500/60 text-emerald-600 dark:text-emerald-400"><Plus className="h-3 w-3" /></span>
                  <span className="self-center">
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">Livre a partir de {relDay(freeFrom, now)}</span>
                    <span className={muted}> · job novo entra no fim; arraste para mudar a ordem</span>
                  </span>
                </li>
              </ol>
            ) : <p onDragOver={e => hover(e, ed.id, 0, 0)} onDrop={e => { e.preventDefault(); drop(); }}
                className={cn("rounded-lg border border-dashed py-6 text-center text-[13px] transition-colors", muted, over?.ed === ed.id && "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] text-[hsl(var(--foreground))]")}>
                {drag ? "Solte aqui para passar para este editor" : "Fila vazia: pode receber job agora."}</p>}
            {stuck.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wider", muted)}>Travado{stuck.length > 1 ? "s" : ""} · fora da fila, prazo correndo</p>
                <ul className="flex flex-col">
                  {stuck.map(t => (
                    <li key={t.id}>
                      <button type="button" onClick={() => onOpen(t.id)}
                        className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[hsl(var(--accent))]">
                        <span className="mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border"><HandPalm className="h-3 w-3" /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium">{t.title}</span>
                          <span className={cn("block text-xs", muted)}>
                            {t.blocked?.since != null ? `há ${ago(now - t.blocked.since)} · ` : ""}{t.blockReason ?? "sem motivo"}
                          </span>
                        </span>
                        <span className="text-right text-xs">
                          <span className="block tabular-nums">{fmt(t.promised)}</span>
                          <span className={cn("block", t.blocked?.critical ? "text-rose-600 dark:text-rose-400" : muted)}>
                            {t.promised != null && t.promised <= now ? "prazo vencido" : t.blocked?.critical ? "vence em menos de 24h" : "prazo"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

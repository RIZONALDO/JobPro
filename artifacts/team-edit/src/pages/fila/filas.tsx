import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Play, ArrowDown, ArrowUp, MoreHorizontal, ArrowsDownUp, Bell, CalendarRange, ListOrdered, Scales, HandPalm, Mail, Question, Timer, Lock, CheckCircle2, Shuffle } from "@/lib/icons";
import { openHandoff } from "@/components/fila/HandoffDialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useRealtime } from "@/hooks/use-realtime";
import { blockedLine, coordColor, deadlineState, fmt, fmtH, inQueue, personName, rem, useBoard, type Board, type QTask, type QRequest } from "@/lib/fila";
import { Alert, Btn, Chip, HeadAction, DeadlineChip, Section, inputCls, LiveDot } from "@/components/fila/ui";
import { QueueTimeline } from "@/components/fila/QueueTimeline";
import { JobForm, type JobFormMode } from "@/components/fila/JobForm";
import { AskDialog, type Ask } from "@/components/fila/job-shared";

interface Notif { id: number; message: string; read: boolean; createdAt: string }

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

/** Cabeçalho de seção fora de cartão (agenda, filas). */
function Heading({ icon: I, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h2 className="inline-flex items-center gap-2 text-[15px] font-bold"><I className="h-4 w-4 self-center text-[hsl(var(--primary))]" />{title}</h2>
      {sub && <p className="text-xs text-[hsl(var(--muted-foreground))]">{sub}</p>}
    </div>
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

export function RequestItem({ board, r, onDone }: { board: Board; r: QRequest; onDone: () => void }) {
  const t = board.tasks.find(x => x.id === r.taskId);
  const who = personName(board, r.requestedById), ed = personName(board, r.editorId);
  const title = r.kind === "insert" ? `${who} quer colocar o job novo “${t?.title}” (${fmtH(t?.est)}) na frente na fila de ${ed}`
    : r.kind === "swap" ? `${who} quer mudar “${t?.title}” de lugar na fila de ${ed}`
    : r.kind === "reassign" ? `${who} quer passar “${t?.title}” de ${personName(board, t?.editorId)} para ${ed}`
    : `${who} pediu para fazer “${t?.title}” antes`;
  const decide = async (ok: boolean) => { if (await run(apiPost(`/api/queue/requests/${r.id}/decide`, { ok }), ok ? "Aprovado" : "Recusado")) onDone(); };
  return (
    <Alert tone="bad" icon={<ArrowsDownUp />} title={title}>
      <ul className="list-disc pl-5 text-[12.5px]">{r.impacts.map((x, i) => <li key={i} className={x.includes("passa do prazo") ? "text-rose-500" : x.startsWith("Motivo:") ? "list-none -ml-5 text-[hsl(var(--foreground))]" : ""}>{x}</li>)}</ul>
      <span className="text-xs text-[hsl(var(--muted-foreground))]">O efeito é recalculado na hora em que você responde.</span>
      {r.escalated && r.kind !== "reassign" && <Chip tone="warn" className="self-start">sem resposta há 30 min: a supervisão também foi avisada</Chip>}
      <div className="flex gap-2"><Btn v="pri" size="sm" onClick={() => decide(true)}>Aprovar</Btn><Btn size="sm" onClick={() => decide(false)}>Recusar</Btn></div>
    </Alert>
  );
}

function CoordView({ board, reload }: { board: Board; reload: () => void }) {
  const { openTask } = useTaskModal();
  const me = board.me, now = board.now;
  const isSup = board.role === "admin" || board.role === "supervisor";
  const canManage = (t: QTask) => isSup || t.coordId === me;
  const [form, setForm] = useState<{ open: boolean; id?: number | null; mode?: JobFormMode }>({ open: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [chg, setChg] = useState<{ id: number; h: string; c: string } | null>(null);
  const [notes, setNotes] = useState<Notif[]>([]);
  const loadNotes = () => apiFetch<Notif[]>("/api/notifications").then(setNotes).catch(() => {});
  useEffect(() => { loadNotes(); }, []);
  useRealtime({ onTasksChanged: loadNotes });

  const mine = board.tasks.filter(t => t.coordId === me);
  const fila = mine.filter(inQueue);
  const late = fila.filter(t => t.slot?.late || (t.promised != null && t.promised <= now));
  const waiting = mine.filter(t => t.status === "review");
  // travado com prazo correndo: a supervisão vê os de todos; o mais crítico primeiro
  const blocked = (isSup ? board.tasks : mine).filter(t => t.status === "paused")
    .sort((a, b) => Number(!!b.blocked?.critical) - Number(!!a.blocked?.critical) || (a.promised ?? Infinity) - (b.promised ?? Infinity));
  const noEditor = mine.filter(t => !t.editorId && t.status === "pending");
  const reqs = board.requests.filter(r => r.approverId === me || (isSup && r.escalated && r.approverId !== me));
  const myReqs = board.requests.filter(r => r.requestedById === me);
  const disputes = mine.filter(t => t.estDisputeOpen);
  const act = async (p: string, b: unknown = {}, ok?: string) => { if (await run(apiPost(p, b), ok)) reload(); };

  const items: React.ReactNode[] = [];
  for (const t of blocked) items.push(
    <Alert key={`b${t.id}`} tone={t.blocked?.critical ? "bad" : "warn"} icon={<HandPalm />}
      title={`“${t.title}” travado${t.blocked?.stopped ? ` há ${fmtH(t.blocked.stopped)}` : ""} (${personName(board, t.editorId)}${t.coordId !== me ? ` · de ${personName(board, t.coordId).split(" ")[0]}` : ""})`}>
      <span>{t.blockReason ?? "Sem motivo"}</span>
      <span className={cn("text-[12.5px]", t.blocked?.critical ? "font-medium text-rose-600 dark:text-rose-400" : "text-[hsl(var(--muted-foreground))]")}>
        {t.blocked?.critical ? "Prazo em risco: " : ""}{blockedLine(t, now)}
      </span>
      {canManage(t) && <div className="flex flex-wrap gap-2"><Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/unblock`, {}, "Destravado")}>Destravar: volta depois do job atual</Btn>
        <Btn size="sm" v="ghost" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Passar para outro editor</Btn>
        <Btn size="sm" v="ghost" onClick={() => setAsk({ kind: "archive", job: { id: t.id, taskCode: t.code, title: t.title, client: t.client, dueDate: null } })}>Encerrar…</Btn>
        <Btn size="sm" v="ghost" onClick={() => openTask(t.id)}>Abrir job</Btn></div>}
    </Alert>);
  for (const r of reqs) items.push(<RequestItem key={`r${r.id}`} board={board} r={r} onDone={reload} />);
  for (const r of myReqs) {
    const t = board.tasks.find(x => x.id === r.taskId);
    items.push(<Alert key={`m${r.id}`} tone="info" icon={<ArrowsDownUp />} title={r.kind === "reassign" ? `Seu pedido: passar “${t?.title}” para ${personName(board, r.editorId)}` : `Seu pedido: “${t?.title}” na fila de ${personName(board, r.editorId)}`}>
      <span>{r.kind === "reassign"
        ? `Aguardando a supervisão. O job continua com ${personName(board, t?.editorId)} até a resposta.`
        : `Aguardando ${r.escalated ? `${personName(board, r.approverId)} ou a supervisão` : personName(board, r.approverId)}. O job fica fora da fila até a resposta.`}</span>
      <div><Btn size="sm" v="ghost" onClick={() => act(`/api/queue/requests/${r.id}/cancel`, {}, "Pedido cancelado")}>Cancelar pedido</Btn></div>
    </Alert>);
  }
  for (const t of disputes) items.push(
    <Alert key={`d${t.id}`} tone="warn" icon={<Scales />} title={`${personName(board, t.editorId)} estima ${fmtH(t.estEditor)} para “${t.title}” (você estimou ${fmtH(t.estCoord)})`}>
      <span>A fila já está calculada com {fmtH(t.estEditor)}. Se você mantiver a sua e o job estourar, o estouro fica registrado na sua estimativa.</span>
      <div className="flex gap-2"><Btn v="pri" size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/estimate-resolve`, { keep: false }, "Estimativa do editor aceita")}>Usar {fmtH(t.estEditor)}</Btn>
        <Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/estimate-resolve`, { keep: true }, "Estimativa mantida")}>Manter {fmtH(t.estCoord)}</Btn></div>
    </Alert>);
  for (const ed of board.editors) {
    const hd = board.tasks.find(t => t.editorId === ed.id && t.slot?.pos === 0);
    if (hd && hd.coordId === me && !hd.playing && ed.idleMinutes >= 30) items.push(
      <Alert key={`i${ed.id}`} tone="info" title={`“${hd.title}” é o próximo de ${ed.name.split(" ")[0]} e ainda não foi iniciado`}>
        <span>A previsão de entrega considera o início a partir de agora. Se algo está impedindo, combine com o editor.</span></Alert>);
    if (hd && hd.coordId === me && hd.waitingEst) items.push(
      <Alert key={`e${ed.id}`} tone="warn" title={`As horas estimadas de “${hd.title}” acabaram (${ed.name})`}>
        <span>Aguardando {ed.name} informar quanto falta. Reservado +1h.</span></Alert>);
  }
  for (const t of waiting) {
    const op = chg?.id === t.id;
    items.push(
      <Alert key={`w${t.id}`} tone="info" icon={<Mail />} title={`“${t.title}” com o cliente${t.sentAt ? ` desde ${fmt(t.sentAt)}` : ""}`}>
        <span>Não ocupa horas de {personName(board, t.editorId)}. Prazo final: {fmt(t.promised)}.</span>
        {op ? <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12.5px]">Tempo de edição da alteração: <input type="number" min="0.5" step="0.5" value={chg!.h} onChange={e => setChg({ ...chg!, h: e.target.value })} className={cn(inputCls, "w-16")} /> h</label>
            <input value={chg!.c} onChange={e => setChg({ ...chg!, c: e.target.value })} placeholder="O que o cliente pediu" className={cn(inputCls, "min-w-[200px] flex-1")} />
          </div>
          <div className="flex gap-2"><Btn v="pri" size="sm" onClick={async () => { await act(`/api/queue/tasks/${t.id}/client-change`, { minutes: Math.round(parseFloat(chg!.h) * 60), comment: chg!.c }, "Alteração na fila"); setChg(null); }}>Mandar para a fila</Btn><Btn v="ghost" size="sm" onClick={() => setChg(null)}>Cancelar</Btn></div>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">Entra logo depois do job atual do editor, como nova rodada com horas próprias.</span>
        </div> : <div className="flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/client-ok`, {}, "Job concluído")}>Cliente aprovou</Btn>
          <Btn size="sm" onClick={() => setChg({ id: t.id, h: "2", c: "" })}>Cliente pediu alteração</Btn>
        </div>}
      </Alert>);
  }
  for (const t of noEditor) items.push(<Alert key={`n${t.id}`} tone="warn" icon={<Question />} title={`“${t.title}” sem editor`}><span>Enviado para a supervisão decidir. Prazo pedido {fmt(t.promised)}.</span>
    <div><Btn size="sm" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Escolher editor</Btn></div></Alert>);
  for (const t of late) items.push(
    <Alert key={`l${t.id}`} tone="warn" icon={<Timer />} title={`“${t.title}” ${t.promised != null && t.promised <= now ? "está atrasado" : `vai atrasar ${fmtH(t.slot?.lateBy)}`}`}>
      <span>{personName(board, t.editorId)} · pronto {fmt(t.slot?.end)} · prazo {fmt(t.promised)}</span>
      <div className="flex flex-wrap gap-2"><Btn size="sm" onClick={() => setForm({ open: true, id: t.id, mode: "move" })}>Passar para outro editor</Btn>
        <Btn size="sm" v="ghost" onClick={() => setForm({ open: true, id: t.id, mode: "edit" })}>Combinar novo prazo com o cliente</Btn></div>
    </Alert>);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Filas dos editores</h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Você vê a fila de todos. {isSup ? "Como supervisão, pode mexer em qualquer job." : "Pode mexer só nos seus jobs. Mexer no que atrasa job de outro coordenador vira pedido."}</p>
        </div>
        <HeadAction icon={Plus} label="Novo job" onClick={() => setForm({ open: true, id: null, mode: "new" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title={<Title icon={CheckCircle2} n={items.length}>Precisa de você</Title>}>
          {items.length ? <div className="flex flex-col gap-2">{items}</div>
            : <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-5 text-[13px] text-[hsl(var(--muted-foreground))]"><CheckCircle2 className="h-5 w-5 text-emerald-500" />Tudo em dia. Nada depende de você agora.</div>}
        </Section>
        <div className="relative lg:min-h-[220px]"><Section className="lg:absolute lg:inset-0" title={<Title icon={Bell} n={notes.filter(n => !n.read).length}>Avisos</Title>}>
          {notes.length ? <ul className="-mr-1.5 flex max-h-[420px] min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1.5 lg:max-h-none">
            {notes.slice(0, 12).map(n => <li key={n.id} className="flex flex-col gap-0.5 border-t pt-2 text-[12.5px] first:border-t-0 first:pt-0">
              <time className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{new Date(n.createdAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
              <span className="flex items-start gap-1.5">{!n.read && <LiveDot pulse={false} className="mt-1.5 h-1.5 w-1.5 text-[hsl(var(--primary))]" />}<span>{n.message}</span></span></li>)}
          </ul> : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nenhum aviso.</p>}
        </Section></div>
      </div>

      <div className="flex flex-col gap-2">
        <Heading icon={CalendarRange} title="Agenda dos editores" sub="Previsão de cada job nas horas de expediente. Clique num bloco para abrir." />
        <QueueTimeline board={board} me={me} onOpen={t => openTask(t.id)} />
      </div>

      <Heading icon={ListOrdered} title="Fila de cada editor" sub="Ordem de execução. Você muda a ordem dos seus jobs." />
      <EditorQueues board={board} me={me} now={now} canManage={canManage} onOpen={id => openTask(id)}
        onEdit={id => setForm({ open: true, id, mode: "edit" })} onPass={id => setForm({ open: true, id, mode: "move" })} reload={reload} />

      <JobForm open={form.open} onOpenChange={o => setForm(f => ({ ...f, open: o }))} taskId={form.id} mode={form.mode} onSaved={reload} />
      <AskDialog ask={ask} onClose={() => setAsk(null)} onDone={reload} />
    </div>
  );
}

/** "hoje 14:00", "amanhã 08:30" ou "qui 16/10 14:00" (minutos locais) */
function relDay(lm: number, now: number) {
  const d = Math.floor(lm / 1440) - Math.floor(now / 1440), hh = fmt(lm).slice(-5);
  return d === 0 ? `hoje ${hh}` : d === 1 ? `amanhã ${hh}` : fmt(lm);
}

/* ── fila de cada editor: uma trilha por editor (agora → depois), poucos dados e bastante respiro ── */
function EditorQueues({ board, me, now, canManage, onOpen, onEdit, onPass, reload }: {
  board: Board; me: number; now: number; canManage: (t: QTask) => boolean;
  onOpen: (id: number) => void; onEdit: (id: number) => void; onPass: (id: number) => void; reload: () => void;
}) {
  const muted = "text-[hsl(var(--muted-foreground))]";
  const sup = board.role === "admin" || board.role === "supervisor";
  return (
    <section className="-mt-2 grid overflow-hidden rounded-xl border bg-[hsl(var(--card))] md:grid-cols-2 md:divide-x xl:[grid-template-columns:repeat(auto-fit,minmax(380px,1fr))] max-md:divide-y">
      {board.editors.map(ed => {
        const q = board.tasks.filter(t => inQueue(t) && t.editorId === ed.id && t.slot).sort((a, b) => a.slot!.pos - b.slot!.pos);
        const byOrder = [...q].sort((a, b) => (Number(b.playing) - Number(a.playing)) || a.order - b.order);
        const move = async (t: QTask, dir: -1 | 1) => { const r = await run(apiPost(`/api/queue/tasks/${t.id}/move`, { dir }), "Ordem alterada"); if (r && r.auto === false) toast.info("Isso atrasa job de outro coordenador: virou pedido."); reload(); };
        // quem saiu ou está fora hoje (ausência própria, não feriado) e ainda tem jobs: caminho para redistribuir
        const owns = board.tasks.filter(t => t.editorId === ed.id).length;
        const stuck = board.tasks.filter(t => t.editorId === ed.id && t.status === "paused");
        const away = ed.inactive ? "Inativo" : ed.offToday && !board.days[0]?.off ? ed.offToday : null;
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
              <AvatarDisplay name={ed.name} avatarUrl={board.people.find(p => p.id === ed.id)?.avatarUrl ?? null} size={36} />
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">{ed.name}{ed.inactive ? <Chip tone="neu">Inativo</Chip> : ed.offToday && <Chip tone="warn">{ed.offToday}</Chip>}</h3>
                <p className={cn("text-xs", muted)}>{q.length ? `${q.length} job${q.length > 1 ? "s" : ""} · livre ${fmt(ed.freeFrom)}` : "Sem jobs na fila"}</p>
              </div>
              <div className="w-24 shrink-0 text-right sm:w-36" title={`${fmtH(ed.queueMinutes)} na fila de ${fmtH(board.limit)}`}>
                <p className="text-xs tabular-nums"><span className="font-semibold">{fmtH(ed.queueMinutes)}</span><span className={muted}> / {fmtH(board.limit)}</span></p>
                <div className="mt-1.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  {q.map(t => (
                    <i key={t.id} title={`${t.slot!.pos + 1}. ${t.title} · ${fmtH(rem(t))}`}
                      className={cn("block h-full shrink-0 first:rounded-l-full", t.slot!.pos === 0 ? "bg-[hsl(var(--foreground)/0.7)]" : "bg-[hsl(var(--foreground)/0.3)]")}
                      style={{ width: `${(rem(t) / board.limit) * 100}%` }} />
                  ))}
                </div>
              </div>
            </header>
            {q.length ? (
              <ol className="relative flex flex-col gap-1">
                {q.map((t, k) => {
                  const s = t.slot!, own = canManage(t), i = byOrder.indexOf(t), d = deadlineState(t, now);
                  const risk = d.tone === "bad" || d.tone === "warn";
                  // o olho segue a fila: o 1º em destaque, o 2º normal, os demais cada vez mais discretos
                  const first = k === 0, fade = k === 0 ? "" : k === 1 ? "" : k === 2 ? "opacity-75" : "opacity-55";
                  const tag = first ? (t.playing ? "Agora" : "Próximo") : k === 1 ? "Depois" : null;
                  return (
                    <li key={t.id} className={cn("group relative -mx-2 grid grid-cols-[22px_minmax(0,1fr)_auto] gap-x-3.5 rounded-xl px-2 transition-[background-color,opacity]",
                      first ? "mb-1.5 bg-[hsl(var(--foreground)/0.04)] py-3.5 ring-1 ring-[hsl(var(--border))]" : "py-2.5 hover:bg-[hsl(var(--accent)/0.45)]",
                      fade, "hover:opacity-100")}>
                      <span className={cn("absolute -bottom-2.5 left-[18.5px] w-px", first ? "top-[46px]" : "top-[38px]", k === 0 ? "bg-[hsl(var(--border))]" : "bg-[hsl(var(--border)/0.6)]")} aria-hidden />
                      <span className={cn("relative mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border text-[10.5px] font-semibold tabular-nums",
                        t.playing ? "border-emerald-500 bg-emerald-500 text-white"
                          : first ? "border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
                          : k === 1 ? "border-[hsl(var(--foreground)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]"
                          : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]")}
                        title={t.playing ? "em execução" : s.pos === 0 ? "próximo, ainda não começou" : `${s.pos + 1}º na fila`}>
                        {t.playing ? <Play weight="fill" className="h-2.5 w-2.5" /> : s.pos + 1}
                      </span>
                      <div className="min-w-0">
                        {tag && <p className={cn("text-[10.5px] font-semibold uppercase tracking-[0.08em]", t.playing ? "text-emerald-600 dark:text-emerald-400" : muted)}>{tag}</p>}
                        <button type="button" onClick={() => onOpen(t.id)} className={cn("block max-w-full truncate text-left hover:underline",
                          first ? "text-[15.5px] font-semibold leading-6" : k === 1 ? "text-[14px] font-medium leading-6" : "text-[13.5px] leading-6", !own && !first && muted)}>{t.title}</button>
                        <p className={cn("truncate text-xs leading-5 max-sm:whitespace-normal", muted)}>
                          {t.playing ? <span className="text-emerald-600 dark:text-emerald-400 max-sm:block">{first ? "termina" : "em execução, termina"} {relDay(s.end, now)}<span className="max-sm:hidden"> · </span></span>
                            : <span className={cn("max-sm:block", s.pos === 0 && "text-[hsl(var(--foreground))]")}>{s.pos === 0 && !first ? "próximo, " : ""}começa {relDay(s.start, now)}<span className="max-sm:hidden"> · </span></span>}
                          {t.client ?? "sem cliente"} · {fmtH(rem(t))}{t.coordId !== me && ` · ${personName(board, t.coordId).split(" ")[0]}`}
                        </p>
                      </div>
                      <div className="flex items-start gap-1">
                        <div className="text-right leading-6">
                          <p className={cn("tabular-nums", first ? "text-[14px] font-semibold" : "text-[13px]")} title={`Pronto ${fmt(s.end)} · prazo ${fmt(t.promised)}`}>{fmt(t.promised)}</p>
                          <p className={cn("text-xs leading-5", risk ? (d.tone === "bad" ? "text-rose-500" : "text-amber-600 dark:text-amber-400") : muted)}>{risk ? d.label : "prazo"}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><button type="button" aria-label={`Ações de ${t.title}`} className={cn("-mr-1 grid h-7 w-7 place-items-center rounded-md opacity-50 transition-opacity hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100", muted)}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[200px]">
                            <DropdownMenuItem onClick={() => onOpen(t.id)}>Abrir job</DropdownMenuItem>
                            {own && <>
                              <DropdownMenuItem disabled={i === 0 || (i === 1 && byOrder[0].playing) || t.playing} onClick={() => move(t, -1)}><ArrowUp className="h-3.5 w-3.5" />Subir na fila</DropdownMenuItem>
                              <DropdownMenuItem disabled={i === byOrder.length - 1 || t.playing} onClick={() => move(t, 1)}><ArrowDown className="h-3.5 w-3.5" />Descer na fila</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onEdit(t.id)}>Editar job</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onPass(t.id)}>Passar para outro editor</DropdownMenuItem>
                            </>}
                            {t.playing && own && <p className={cn("px-2 py-1 text-xs", muted)}>Em execução: só o editor pausa.</p>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })}
                <li className={cn("relative -mx-2 grid grid-cols-[22px_minmax(0,1fr)] gap-x-3.5 px-2 py-2 text-xs", muted)}>
                  <span className="absolute -top-1 left-[18.5px] h-3 w-px bg-[hsl(var(--border))]" aria-hidden />
                  <span className="mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed"><Plus className="h-3 w-3" /></span>
                  <span className="self-center">Fim da fila · próximo job entra <span className="text-[hsl(var(--foreground))]">{relDay(ed.freeFrom, now)}</span></span>
                </li>
              </ol>
            ) : <p className={cn("rounded-lg border border-dashed py-6 text-center text-[13px]", muted)}>Fila vazia: pode receber job agora.</p>}
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
                            {t.blocked?.stopped ? `há ${fmtH(t.blocked.stopped)} · ` : ""}{t.blockReason ?? "sem motivo"}
                          </span>
                        </span>
                        <span className="text-right text-xs">
                          <span className="block tabular-nums">{fmt(t.promised)}</span>
                          <span className={cn("block", t.blocked?.critical ? "text-rose-600 dark:text-rose-400" : muted)}>
                            {t.promised != null && t.promised <= now ? "prazo vencido" : t.blocked?.ifNow?.late ? `atrasa ${fmtH(t.blocked.ifNow.lateBy)}` : t.blocked?.critical ? "folga curta" : "prazo"}
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

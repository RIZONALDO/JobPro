import { useCallback, useEffect, useMemo, useState } from "react";
import { roleName } from "@/lib/roles";
import { Link } from "wouter";
import { toast } from "sonner";
import { Bell, Check, Copy, ExternalLink, FolderOpen, Lock, MoreHorizontal, UserPlus } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiDelete, apiFetch, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/use-realtime";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deadlineState, fmt, fmtH, rem, toLm, useBoard, type QTask } from "@/lib/fila";
import { Btn, Chip, LiveDot } from "@/components/fila/ui";
import { JobForm, type JobFormMode } from "@/components/fila/JobForm";
import { AskDialog, STAGES, ago, clientColor, stageOf, type Ask } from "@/components/fila/job-shared";
import { FollowersPicker, type FollowerUser } from "@/components/fila/followers";

/**
 * Página do job (`/jobs/:id`).
 * Em cima, a situação em uma frase e as ações da fase; à esquerda o que é o trabalho
 * (briefing, pasta, rodadas, histórico); à direita os números (prazo, horas, pessoas).
 */

interface Person { id: number; name: string; avatarUrl?: string | null; role?: string; jobTitle?: string | null }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string }
interface StatusEvent { id: number; from: string; to: string; by: string | null; at: string }
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null; client: string | null; status: string;
  estMinutes: number; workedMinutes: number; playingSince?: string | null; lockReason?: string | null;
  dueDate: string | null; dueDateOriginal?: string | null; startDate?: string | null; folderUrl: string | null; revisionCount: number;
  createdBy: Person | null; assignedTo: Person | null; revisions: Revision[]; statusEvents?: StatusEvent[]; followers?: (Person & { addedById: number | null })[];
  createdAt: string; updatedAt: string;
}
interface QueueEvent { id: number; kind: string; text: string | null; actor: string | null; at: string }

type Tone = "ok" | "warn" | "bad" | "acc" | "neu";
const EVENT: Record<string, [string, Tone]> = {
  created: ["Criou o job", "neu"], assign: ["Entrou na fila", "acc"], play: ["Começou a editar", "ok"], pause: ["Pausou", "neu"],
  sent: ["Enviou para o cliente", "acc"], blocked: ["Travou o job", "warn"], unblocked: ["Destravou", "ok"], inform: ["Pediu mais tempo", "warn"],
  est_confirm: ["Confirmou a estimativa", "ok"], est_contest: ["Contestou a estimativa", "warn"], est_keep: ["Manteve a estimativa", "neu"],
  est_use: ["Aceitou a estimativa do editor", "ok"], reorder: ["Mudou a ordem", "neu"], furou: ["Furou a fila", "warn"], reneg: ["Prazo empurrado", "bad"],
  reassign: ["Passou para outro editor", "acc"], follow: ["Incluiu quem acompanha", "neu"], client_change: ["Cliente pediu alteração", "warn"], client_ok: ["Cliente aprovou", "ok"],
  request: ["Pediu mudança na fila", "neu"], decide: ["Respondeu pedido", "neu"], idle_alert: ["Lembrete: job aguardando início", "neu"],
  est_expired: ["Horas estimadas acabaram", "bad"], cancelled: ["Cancelou", "bad"], archived: ["Encerrou job travado", "neu"],
  owner: ["Trocou o gestor responsável", "acc"], blocked_alert: ["Supervisão avisada: travado com prazo em risco", "bad"],
};
const DOT: Record<Tone, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", acc: "bg-[hsl(var(--primary))]", neu: "bg-[hsl(var(--muted-foreground))]" };
const STEPS = ["fila", "edicao", "cliente", "entregue"] as const;
const muted = "text-[hsl(var(--muted-foreground))]";

export interface JobHead { id: number; title: string; client: string | null; taskCode?: string }

/** Conteúdo da página do job (`/jobs/:id`). `onLoaded` informa título/cliente para a barra de navegação; `onGone` quando o job é excluído. */
export function JobDetail({ taskId, onLoaded, onGone }: { taskId: number; onLoaded?: (h: JobHead | null) => void; onGone: () => void }) {
  const { user } = useAuth();
  const { board } = useBoard();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<JobFormMode | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const load = useCallback(() => {
    apiFetch<TaskDetail>(`/api/tasks/${taskId}`).then(t => { setTask(t); setErr(null); }).catch(e => setErr(e.message));
    apiFetch<QueueEvent[]>(`/api/queue/tasks/${taskId}/events`).then(setEvents).catch(() => {});
  }, [taskId]);
  useEffect(() => { setTask(null); setEvents([]); load(); }, [load]);
  useRealtime({ onTasksChanged: load });
  useEffect(() => { onLoaded?.(task ? { id: task.id, title: task.title, client: task.client, taskCode: task.taskCode } : null); }, [task, onLoaded]);

  const live = board?.tasks.find(t => t.id === taskId);
  const now = board?.now ?? toLm(new Date());
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const canAct = !!task && (isSup || (user?.role === "coordinator" && task.createdBy?.id === user.id));
  const mine = !!task && user?.role === "editor" && task.assignedTo?.id === user.id;

  if (!task) return <p className={cn("py-24 text-center text-sm", err ? "text-rose-500" : muted)}>{err ?? "Carregando…"}</p>;
  return (
    <div className="flex flex-col gap-5">
      <Header task={task} live={live} now={now} canAct={canAct} mine={mine} onForm={setForm} onAsk={setAsk} reload={load} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Brief task={task} canAct={canAct} />
          <Rounds task={task} />
          <History task={task} events={events} />
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-16 lg:self-start">
          <DeadlineCard task={task} live={live} now={now} />
          <HoursCard task={task} live={live} board={board} />
          <PeopleCard task={task} reload={load} />
        </aside>
      </div>
      <JobForm open={!!form} onOpenChange={o => { if (!o) setForm(null); }} taskId={task.id} mode={form ?? "edit"} onSaved={load} />
      <AskDialog ask={ask} onClose={() => setAsk(null)} onDone={() => (ask?.kind === "delete" ? onGone() : load())} />
    </div>
  );
}

/* ── cabeçalho: identidade, fases, situação e ações ── */
function Header({ task, live, now, canAct, mine, onForm, onAsk, reload }: {
  task: TaskDetail; live?: QTask; now: number; canAct: boolean; mine: boolean;
  onForm: (m: JobFormMode) => void; onAsk: (a: Ask) => void; reload: () => void;
}) {
  const s = stageOf(task.status);
  const ref = { id: task.id, taskCode: task.taskCode, title: task.title, client: task.client, dueDate: task.dueDate };
  const call = async (url: string, ok: string) => { try { await apiPost(url, {}); toast.success(ok); reload(); } catch (e) { toast.error((e as Error).message); } };

  // ações principais por fase (as outras vão para o menu "…")
  type A = { label: string; v?: "pri" | "go" | "def" | "danger"; run: () => void };
  const main: A[] = [], more: A[] = [];
  if (canAct) {
    const k = s.k;
    if (k === "rascunho") main.push({ label: "Completar e colocar na fila", v: "pri", run: () => onForm("edit") });
    if (k === "cliente") main.push({ label: "Cliente aprovou", v: "go", run: () => call(`/api/queue/tasks/${task.id}/client-ok`, "Job entregue") }, { label: "Pediu alteração", run: () => onAsk({ kind: "change", job: ref }) });
    if (k === "travado") main.push({ label: "Destravar", v: "pri", run: () => call(`/api/queue/tasks/${task.id}/unblock`, "Destravado: volta depois do job atual") });
    if (k === "travado") more.push({ label: "Encerrar (ficou para trás)…", run: () => onAsk({ kind: "archive", job: ref }) });
    if (k === "entregue") main.push({ label: "Reabrir", run: () => onAsk({ kind: "reopen", job: ref }) });
    if (k === "cancelado") main.push({ label: "Reativar", run: () => onAsk({ kind: "reactivate", job: ref }) });
    if (["fila", "edicao", "travado"].includes(k)) { main.push({ label: "Editar", run: () => onForm("edit") }); main.push({ label: "Passar para outro editor", run: () => onForm("move") }); }
    if (["fila", "edicao", "travado", "cliente"].includes(k)) more.push({ label: "Cancelar job…", v: "danger", run: () => onAsk({ kind: "cancel", job: ref }) });
    if (k === "rascunho" || k === "cancelado") more.push({ label: "Excluir…", v: "danger", run: () => onAsk({ kind: "delete", job: ref }) });
  }

  return (
    <header className="rounded-2xl border bg-[hsl(var(--card))] p-4 sm:p-5">
      <div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold"><i className="h-2.5 w-2.5 rounded-full" style={{ background: clientColor(task.client) }} />{task.client ?? <span className={muted}>Sem cliente</span>}</span>
            <span className={cn("font-mono", muted)}>{task.taskCode}</span>
            <Chip tone={s.tone}>{s.label}</Chip>
            {live?.playing && <Chip tone="ok"><LiveDot />editando agora</Chip>}
            {task.revisionCount > 0 && <Chip>alteração {task.revisionCount}</Chip>}
          </div>
          <h1 className="mt-1.5 text-xl font-bold leading-snug tracking-tight sm:text-2xl">{task.title}</h1>
        </div>
      </div>

      <Stepper status={task.status} />
      <Situation task={task} live={live} now={now} />

      {(main.length > 0 || more.length > 0 || mine) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {main.map(a => <Btn key={a.label} v={a.v ?? "def"} onClick={a.run}>{a.label}</Btn>)}
          {mine && <Link href="/fila"><Btn v="pri">Abrir na Minha fila</Btn></Link>}
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Mais ações" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">{more.map(a => <DropdownMenuItem key={a.label} className={a.v === "danger" ? "text-rose-500" : ""} onClick={a.run}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </header>
  );
}

/** Na fila → Em edição → Com o cliente → Entregue. Rascunho, travado e cancelado aparecem como desvio. */
function Stepper({ status }: { status: string }) {
  const k = stageOf(status).k;
  const at = k === "travado" ? 1 : STEPS.indexOf(k as typeof STEPS[number]);
  if (k === "rascunho") return <p className={cn("mt-3 rounded-lg bg-[hsl(var(--muted)/0.6)] px-3 py-1.5 text-[13px] font-semibold", muted)}>Rascunho: completa os dados e escolhe onde entra na fila para começar.</p>;
  if (k === "cancelado") return <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[13px] font-semibold text-rose-600 dark:text-rose-400">Job cancelado: fora da fila e do calendário.</p>;
  return (
    <ol className="mt-3 flex items-center gap-1 overflow-x-auto text-[11.5px] font-semibold">
      {STEPS.map((st, i) => {
        const label = STAGES.find(x => x.k === st)!.label, done = i < at, cur = i === at;
        return (
          <li key={st} className="flex min-w-0 flex-1 items-center gap-1">
            <span className={cn("flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1",
              cur ? (k === "travado" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]") : done ? "text-[hsl(var(--foreground))]" : muted)}>
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px]",
                cur ? (k === "travado" ? "bg-amber-500 text-white" : "bg-[hsl(var(--primary))] text-white") : done ? "bg-emerald-500 text-white" : "border")}>
                {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span className={cn(!cur && "hidden sm:inline")}>{cur && k === "travado" ? "Travado" : label}</span>
            </span>
            {i < STEPS.length - 1 && <span className={cn("h-px min-w-3 flex-1", done ? "bg-emerald-500/60" : "bg-[hsl(var(--border))]")} />}
          </li>
        );
      })}
    </ol>
  );
}

/** A situação do job em uma frase, com o tom certo. */
function Situation({ task, live, now }: { task: TaskDetail; live?: QTask; now: number }) {
  const ed = task.assignedTo?.name.split(" ")[0];
  let tone: Tone = "neu", text: React.ReactNode;
  const slot = live?.slot;
  switch (stageOf(task.status).k) {
    case "rascunho": text = <>Rascunho de {task.createdBy?.name.split(" ")[0] ?? "—"}. Ainda não ocupa a fila de ninguém.</>; break;
    case "fila":
      if (!task.assignedTo) { tone = "warn"; text = <>Sem editor: nenhuma fila comportava no prazo. A supervisão escolhe quem faz.</>; break; }
      text = slot ? <><b>{slot.pos + 1}º na fila de {ed}.</b> Começa {fmt(slot.start)} e termina {fmt(slot.end)}.</> : <>Na fila de {ed}.</>; break;
    case "edicao":
      text = live?.playing ? <><b>{ed} está editando agora.</b> {slot && <>Termina {fmt(slot.end)}.</>}</>
        : <>{ed} já começou ({fmtH(live?.worked ?? task.workedMinutes)} feitas). {slot && <>Retoma {fmt(slot.start)}, termina {fmt(slot.end)}.</>}</>; break;
    case "travado": tone = "warn"; text = <><b>Travado</b>{live?.blockReason ? `: ${live.blockReason}` : ""}. Fora da fila até destravar.</>; break;
    case "cliente": {
      const since = live?.sentAt != null ? now - live.sentAt : null;
      tone = since != null && since > 2 * 1440 ? "warn" : "acc";
      text = <><b>Com o cliente</b>{since != null ? ` há ${ago(since)}` : ""}. Esperando aprovação ou pedido de alteração.</>; break;
    }
    case "entregue": tone = "ok"; text = <><b>Entregue.</b> Cliente aprovou {fmt(toLm(lastTo(task, "completed") ?? task.updatedAt))}.</>; break;
    default: return null;
  }
  if (live && ["fila", "edicao"].includes(stageOf(task.status).k)) {
    const d = deadlineState(live, now);
    if (d.tone === "bad") tone = "bad";
    text = <>{text} <Chip tone={d.tone} className="ml-1 align-middle">{d.label}</Chip></>;
  }
  const box: Record<Tone, string> = {
    neu: "bg-[hsl(var(--muted)/0.6)]", acc: "bg-[hsl(var(--primary)/0.08)]", ok: "bg-emerald-500/10",
    warn: "bg-amber-500/10", bad: "bg-rose-500/10",
  };
  return <p className={cn("mt-3 rounded-xl px-3 py-2 text-[13.5px] leading-relaxed", box[tone])}>{text}</p>;
}
const lastTo = (t: TaskDetail, to: string) => [...(t.statusEvents ?? [])].reverse().find(e => e.to === to)?.at ?? null;

/* ── coluna principal ── */
function Block({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><h3 className={cn("text-[11px] font-bold uppercase tracking-wider", muted)}>{title}</h3>{right}</div>
      {children}
    </section>
  );
}

function Brief({ task, canAct }: { task: TaskDetail; canAct: boolean }) {
  const copy = () => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Caminho copiado"); };
  const isUrl = !!task.folderUrl && /^https?:\/\//.test(task.folderUrl);
  return (
    <Block title="O que é para fazer">
      <div className="rounded-2xl border bg-[hsl(var(--card))]">
        <div className="px-4 py-3 text-[14px] leading-relaxed">
          {task.description ? <p className="whitespace-pre-wrap">{task.description}</p> : <p className={cn("italic", muted)}>Sem briefing.{canAct && " Use Editar para descrever o que o cliente pediu."}</p>}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-2.5 text-[13px]">
          <FolderOpen className={cn("h-4 w-4 shrink-0", muted)} />
          {task.folderUrl ? <>
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={task.folderUrl}>{task.folderUrl}</span>
            <button type="button" onClick={copy} title="Copiar" className="rounded-md p-1 hover:bg-[hsl(var(--accent))]"><Copy className="h-3.5 w-3.5" /></button>
            {isUrl && <a href={task.folderUrl} target="_blank" rel="noopener noreferrer" title="Abrir" className="rounded-md p-1 hover:bg-[hsl(var(--accent))]"><ExternalLink className="h-3.5 w-3.5" /></a>}
          </> : <span className={cn("italic", muted)}>Nenhuma pasta vinculada.</span>}
        </div>
      </div>
    </Block>
  );
}

/** Rodada 1 é o pedido original; cada alteração do cliente ou reabertura abre uma nova. */
function Rounds({ task }: { task: TaskDetail }) {
  if (!task.revisions.length) return null;
  const rounds = [{ n: 1, title: "Pedido original", text: null as string | null, at: task.createdAt },
    ...task.revisions.map(r => ({ n: r.revisionNumber + 1, title: `Alteração ${r.revisionNumber}`, text: r.comment, at: r.createdAt }))];
  return (
    <Block title={`Rodadas · ${rounds.length}`}>
      <ol className="flex flex-col">
        {rounds.map((r, i) => (
          <li key={r.n} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", i === rounds.length - 1 ? "bg-amber-500 text-white" : "bg-[hsl(var(--muted))]")}>{r.n}</span>
              {i < rounds.length - 1 && <span className="w-px flex-1 bg-[hsl(var(--border))]" />}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <p className="text-[13px]"><b>{r.title}</b> <span className={cn("text-xs", muted)}>· {fmt(toLm(r.at))}</span></p>
              {r.text && <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed">{r.text}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Block>
  );
}

/** Fila + mudanças de fase numa linha do tempo só, por dia. */
function History({ task, events }: { task: TaskDetail; events: QueueEvent[] }) {
  const [all, setAll] = useState(false);
  const items = useMemo(() => {
    const q = events.map(e => { const [label, tone] = EVENT[e.kind] ?? [e.kind, "neu" as Tone]; return { id: `q${e.id}`, at: e.at, label, tone, who: e.actor, text: e.text }; });
    const qt = q.map(x => +new Date(x.at));
    // mudança de fase só entra se a fila não registrou nada no mesmo instante (evita linha repetida)
    const st = (task.statusEvents ?? []).filter(e => !qt.some(t => Math.abs(t - +new Date(e.at)) < 15_000)).map(e => ({
      id: `s${e.id}`, at: e.at, label: `Fase: ${stageOf(e.to).label}`, tone: (e.to === "completed" ? "ok" : e.to === "cancelled" ? "bad" : "neu") as Tone, who: e.by, text: null as string | null,
    }));
    return [...q, ...st].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [events, task.statusEvents]);
  const shown = all ? items : items.slice(0, 12);
  const days = new Map<string, typeof items>();
  for (const it of shown) { const k = fmt(toLm(it.at)).slice(0, 9); days.set(k, [...(days.get(k) ?? []), it]); }

  return (
    <Block title="Histórico: quem fez o quê" right={<span className={cn("text-xs", muted)}>criado {fmt(toLm(task.createdAt))}</span>}>
      {!items.length ? <p className={cn("text-[13px] italic", muted)}>Sem registros ainda.</p> : (
        <div className="rounded-2xl border bg-[hsl(var(--card))] px-4 py-3">
          {[...days].map(([day, list]) => (
            <div key={day} className="mb-2 last:mb-0">
              <p className={cn("mb-1 text-[11px] font-bold uppercase tracking-wider", muted)}>{day}</p>
              <ul className="flex flex-col">
                {list.map(it => (
                  <li key={it.id} className="flex gap-2.5 py-1 text-[13px] leading-snug">
                    <span className={cn("w-10 shrink-0 font-mono text-[11px] leading-5", muted)}>{fmt(toLm(it.at)).slice(10)}</span>
                    <i className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", DOT[it.tone])} />
                    <span className="min-w-0"><b className="font-semibold">{it.label}</b>{it.who && <span className={muted}> · {it.who}</span>}{it.text && <span className="block text-[12.5px] text-[hsl(var(--muted-foreground))]">{it.text}</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {items.length > 12 && <button type="button" onClick={() => setAll(v => !v)} className="mt-1 text-xs font-semibold text-[hsl(var(--primary))] hover:underline">{all ? "Mostrar menos" : `Ver tudo (${items.length})`}</button>}
        </div>
      )}
    </Block>
  );
}

/* ── coluna lateral ── */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2 rounded-2xl border bg-[hsl(var(--card))] p-3.5"><h3 className={cn("text-[11px] font-bold uppercase tracking-wider", muted)}>{title}</h3>{children}</section>;
}
function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className={muted}>{k}</span><span className="text-right"><b className="font-semibold">{v}</b>{sub && <span className={cn("block text-[11.5px]", muted)}>{sub}</span>}</span></div>;
}

function DeadlineCard({ task, live, now }: { task: TaskDetail; live?: QTask; now: number }) {
  const due = task.dueDate ? toLm(task.dueDate) : null;
  const end = live?.slot?.end ?? null;
  const open = ["fila", "edicao"].includes(stageOf(task.status).k);
  const sent = task.statusEvents?.find(e => e.to === "review")?.at;
  return (
    <Card title="Prazo">
      <div>
        <p className={cn("text-xs", muted)}>O cliente precisa receber</p>
        <p className="text-lg font-bold leading-tight">{due != null ? fmt(due) : "sem prazo"}</p>
        {due != null && due < now && stageOf(task.status).open && task.status !== "review" && <p className="text-xs font-semibold text-rose-500">vencido há {ago(now - due)}</p>}
        {task.dueDateOriginal && <p className="text-xs text-rose-500">era {fmt(toLm(task.dueDateOriginal))} · prazo empurrado</p>}
      </div>
      {open && end != null && <Row k="Previsão de entrega" v={fmt(end)} sub={due != null ? (end > due ? <span className="text-rose-500">{fmtH(live!.slot!.lateBy ?? 0)} de expediente depois do prazo</span> : `folga até o prazo`) : undefined} />}
      {open && live && <div><Chip tone={deadlineState(live, now).tone}>{deadlineState(live, now).label}</Chip></div>}
      {!open && sent && due != null && <Row k="1ª versão ao cliente" v={fmt(toLm(sent))} sub={toLm(sent) > due ? <span className="text-rose-500">depois do prazo</span> : <span className="text-emerald-600 dark:text-emerald-400">no prazo</span>} />}
      {task.startDate && stageOf(task.status).open && <div className="flex gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Não começar antes de <b>{fmt(toLm(task.startDate))}</b>{task.lockReason ? `: ${task.lockReason}` : ""}</span></div>}
    </Card>
  );
}

function HoursCard({ task, live, board }: { task: TaskDetail; live?: QTask; board: ReturnType<typeof useBoard>["board"] }) {
  const est = live?.est ?? task.estMinutes ?? 0, worked = live?.worked ?? task.workedMinutes ?? 0;
  const pct = est ? Math.min(100, (worked / est) * 100) : 0, over = worked > est;
  const owner = live?.estOwnerId ? board?.people.find(p => p.id === live.estOwnerId)?.name.split(" ")[0] : null;
  const open = stageOf(task.status).open && task.status !== "rascunho";
  return (
    <Card title="Horas de edição">
      <div className="flex items-end justify-between gap-2">
        <p><span className="text-lg font-bold">{fmtH(worked)}</span> <span className={cn("text-[13px]", muted)}>de {fmtH(est)}</span></p>
        {live?.playing && <Chip tone="ok"><LiveDot />contando</Chip>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><i className={cn("block h-full rounded-full", over ? "bg-rose-500" : "bg-[hsl(var(--primary))]")} style={{ width: `${pct}%` }} /></div>
      {open && live && <Row k="Falta" v={fmtH(rem(live))} sub={over ? "estimativa estourada: reserva de 1h" : undefined} />}
      {live && open && (
        live.estDisputeOpen ? <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">Editor contestou: acha que precisa de <b>{fmtH(live.estEditor)}</b>. Gestor decide.</p>
        : live.estConfirmed ? <p className={cn("flex items-center gap-1 text-xs", muted)}><Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />Estimativa combinada com o editor{owner ? ` (vale a de ${owner})` : ""}.</p>
        : live.waitingEst ? <p className={cn("text-xs", muted)}>Esperando o editor confirmar a estimativa.</p> : null
      )}
    </Card>
  );
}

function PeopleCard({ task, reload }: { task: TaskDetail; reload: () => void }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [users, setUsers] = useState<FollowerUser[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const fol = task.followers ?? [];
  const following = fol.some(f => f.id === user?.id), isOwner = task.createdBy?.id === user?.id;
  // só o dono do job escolhe quem acompanha; quem foi incluído pode sair
  const canEdit = isOwner;
  const run = async (p: Promise<unknown>, ok: string) => { try { await p; toast.success(ok); reload(); } catch (e) { toast.error((e as Error).message); } };
  const startEdit = () => { setSel(fol.map(f => f.id)); setEditing(true); if (!users.length) apiFetch<FollowerUser[]>("/api/users?active=1").then(setUsers).catch(() => {}); };
  const save = async () => { await run(apiPut(`/api/tasks/${task.id}/followers`, { userIds: sel }), "Acompanhantes atualizados"); setEditing(false); };
  const P = ({ p, role }: { p: Person | null; role: string }) => (
    <div className="flex items-center gap-2.5">
      {p ? <AvatarDisplay name={p.name} avatarUrl={p.avatarUrl ?? null} size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-dashed text-xs">?</span>}
      <div className="min-w-0"><p className={cn("text-[11px]", muted)}>{role}</p><p className="truncate text-[13px]"><b className="font-semibold">{p?.name ?? "ninguém ainda"}</b>{p && roleName(p) && <span className={cn("font-normal", muted)}> · {roleName(p)}</span>}</p></div>
    </div>
  );
  return (
    <Card title="Pessoas">
      <P p={task.createdBy} role="Responsável pelo job (fala com o cliente)" />
      <P p={task.assignedTo} role="Editor" />
      <div className="flex flex-col gap-1.5 border-t pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className={cn("text-[11px]", muted)}>Acompanhando{fol.length ? ` · ${fol.length}` : ""}</p>
          {canEdit && !editing && fol.length > 0 && <button type="button" onClick={startEdit} className="text-[11.5px] font-semibold text-[hsl(var(--primary))] hover:underline">Editar</button>}
        </div>
        {editing ? <>
          <p className={cn("text-xs", muted)}>Quem você incluir recebe os avisos importantes deste job e o vê em “Meus jobs”.</p>
          <FollowersPicker users={users} value={sel} onChange={setSel} ownerId={task.createdBy?.id} />
          <div className="flex gap-2"><Btn size="sm" v="pri" onClick={save}>Salvar</Btn><Btn size="sm" v="ghost" onClick={() => setEditing(false)}>Cancelar</Btn></div>
        </> : fol.length ? (
          <ul className="flex flex-col gap-1.5">{fol.map(f => (
            <li key={f.id} className="flex items-center gap-2 text-[13px]"><AvatarDisplay name={f.name} avatarUrl={f.avatarUrl ?? null} size={22} /><span className="truncate"><b className="font-semibold">{f.name}</b>{roleName(f) && <span className={muted}> · {roleName(f)}</span>}</span>{f.id === user?.id && <Chip className="text-[10px]">você</Chip>}</li>
          ))}</ul>
        ) : isOwner ? (
          <button type="button" onClick={startEdit} className="flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-left transition-colors hover:border-[hsl(var(--primary)/0.6)] hover:bg-[hsl(var(--primary)/0.05)]">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
            <span><b className="block text-[13px] font-semibold">Incluir gestores para acompanhar</b><span className={cn("block text-xs leading-snug", muted)}>Eles recebem os avisos importantes e veem o job em “Meus jobs”.</span></span>
          </button>
        ) : <p className={cn("text-xs", muted)}>Nenhum outro gestor acompanha este job.</p>}
        {following && !isOwner && <>
          <p className={cn("flex items-center gap-1.5 text-xs", muted)}><Bell className="h-3.5 w-3.5 shrink-0" />Você recebe os avisos importantes deste job.</p>
          <Btn size="sm" v="ghost" className="self-start" onClick={() => run(apiDelete(`/api/tasks/${task.id}/follow`), "Você deixou de acompanhar")}>Deixar de acompanhar</Btn>
        </>}
      </div>
      <p className={cn("border-t pt-2 text-[11.5px]", muted)}>Criado {fmt(toLm(task.createdAt))} · atualizado {fmt(toLm(task.updatedAt))}</p>
    </Card>
  );
}

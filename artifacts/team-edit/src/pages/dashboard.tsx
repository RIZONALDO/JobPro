import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowDownRight, ArrowUpRight, Check, Plus, Settings2, Confetti, Settings, CheckCircle2, CalendarDays, Clock, Users, ListOrdered, Briefcase, Newspaper } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DAY, coordColor, deadlineState, fmt, fmtDay, fmtH, personName, toLm, useBoard, type Board, type QTask } from "@/lib/fila";
import { Btn, Chip, HeadAction, LiveDot } from "@/components/fila/ui";
import { Widget } from "@/components/ui/widget";
import { JobForm } from "@/components/fila/JobForm";
import { SignDueDialog } from "@/components/fila/SignDue";
import { STAGES, ago, clientColor, stageOf } from "@/components/fila/job-shared";

/**
 * Dashboard (gestor e supervisão), no espírito do Jira/Asana:
 * saudação com o resumo do dia → indicadores com tendência → "Para você" (o que pede ação) e agenda da semana
 * → linha do dia, disponibilidade da equipe e clientes (à esquerda); fases e atividade (à direita, preenchendo a coluna).
 * Cada bloco pode ser escondido em "Blocos". "Meus jobs" / "Equipe toda" muda o recorte de tudo.
 */

interface Person { id: number; name: string; avatarUrl?: string | null }
interface Job {
  id: number; taskCode?: string; title: string; status: string; client: string | null; dueDate: string | null;
  estMinutes: number | null; workedMinutes: number | null; reviewedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string; assignee: Person | null; coordinator: Person | null; isOwn: boolean; isFollowing: boolean;
}
interface Activity {
  id: number; kind: string; text: string | null; at: string; taskId: number | null; coordId: number | null;
  actorId: number | null; actor: string | null; avatarUrl: string | null; title: string | null; client: string | null; taskCode: string | null;
}

const WIDGETS = [
  ["kpis", "Indicadores"], ["foryou", "Para você"], ["week", "Agenda da semana"], ["day", "Hoje na ilha"],
  ["phases", "Jobs por fase"], ["team", "Disponibilidade da equipe"], ["activity", "Atividade recente"], ["clients", "Clientes"],
] as const;
type WidgetKey = typeof WIDGETS[number][0];

const muted = "text-[hsl(var(--muted-foreground))]";
const OPEN = ["pending", "in_progress", "in_revision", "reopened", "paused", "review"];
const QUEUE = ["pending", "in_progress", "in_revision", "reopened"];
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } } };

export default function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const { board } = useBoard();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const load = useCallback(() => {
    apiFetch<Job[]>("/api/tasks/overview?status=all").then(setJobs).catch(() => setJobs([]));
    apiFetch<Activity[]>("/api/queue/activity?limit=60").then(setActs).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useRealtime({ onTasksChanged: load });

  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [mine, setMine] = useState(() => (store.get("dash:scope") ?? (isSup ? "team" : "mine")) === "mine");
  const [hidden, setHidden] = useState<WidgetKey[]>(() => { try { return JSON.parse(store.get("dash:hidden") ?? "[]"); } catch { return []; } });
  const [newJob, setNewJob] = useState(false);
  useEffect(() => store.set("dash:scope", mine ? "mine" : "team"), [mine]);
  useEffect(() => store.set("dash:hidden", JSON.stringify(hidden)), [hidden]);
  const show = (k: WidgetKey) => !hidden.includes(k);

  if (!jobs || !board || !user) return <p className={cn("py-24 text-center text-sm", muted)}>Carregando…</p>;

  const me = user.id;
  // "Meus jobs" = os que eu crio + os que eu acompanho
  const sj = jobs.filter(j => j.status !== "rascunho" && (!mine || j.isOwn || j.isFollowing));
  const st = board.tasks.filter(t => !mine || t.coordId === me || t.followerIds.includes(me));
  const followed = new Set(jobs.filter(j => j.isFollowing).map(j => j.id));
  const acts2 = acts.filter(a => !mine || a.coordId === me || (a.taskId != null && followed.has(a.taskId)));
  const ctx: Ctx = { board, jobs: sj, tasks: st, me, isSup, mine, now: board.now };
  /** dois blocos lado a lado (7 + 5 colunas); se um está escondido, o outro ocupa a linha inteira.
   *  `fill`: o da direita acompanha a altura do da esquerda e rola por dentro. */
  const pair = (ka: WidgetKey, a: React.ReactNode, kb: WidgetKey, b: React.ReactNode, fill = false) => {
    const sa = show(ka), sb = show(kb);
    return <>
      {sa && <div className={cn("min-w-0", sb ? "lg:col-span-7" : "lg:col-span-12")}>{a}</div>}
      {sb && <div className={cn("min-w-0", sa ? "lg:col-span-5" : "lg:col-span-12", fill && sa && "relative lg:min-h-[360px] [&>section]:lg:absolute [&>section]:lg:inset-0")}>{b}</div>}
    </>;
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      <Greeting ctx={ctx} name={user.name} mine={mine} setMine={setMine} hidden={hidden} setHidden={setHidden} onNew={() => setNewJob(true)} />
      {show("kpis") && <Kpis ctx={ctx} />}
      {/* grade em pares: os dois blocos de cada linha têm a mesma altura (sem buracos); sozinho, o bloco ocupa a linha */}
      <div className="grid gap-4 lg:grid-cols-12">
        {pair("foryou", <ForYou ctx={ctx} />, "team", <Team ctx={ctx} />)}
        {show("day") && <div className="min-w-0 lg:col-span-12"><DayLine ctx={ctx} /></div>}
        {pair("week", <Week ctx={ctx} />, "phases", <Phases ctx={ctx} />)}
        {pair("clients", <Clients ctx={ctx} />, "activity", <Feed items={acts2} />, true)}
      </div>
      <JobForm open={newJob} onOpenChange={setNewJob} onSaved={load} />
    </div>
  );
}

/** Abre Jobs já filtrado (a página guarda os filtros em "jobs:v2"); limpa o resto para não somar filtros antigos. */
function openJobs(patch: Record<string, unknown>) {
  try {
    const f = JSON.parse(sessionStorage.getItem("jobs:v2") ?? "{}");
    sessionStorage.setItem("jobs:v2", JSON.stringify({ ...f, scope: "aberto", phase: null, flag: null, q: "", clients: [], editors: [], coords: [], dueDay: null, ...patch }));
  } catch { /* ok */ }
}

interface Ctx { board: Board; jobs: Job[]; tasks: QTask[]; me: number; isSup: boolean; mine: boolean; now: number }
const live = (ctx: Ctx, id: number) => ctx.board.tasks.find(t => t.id === id);

/* ── saudação ── */
function Greeting({ ctx, name, mine, setMine, hidden, setHidden, onNew }: {
  ctx: Ctx; name: string; mine: boolean; setMine: (v: boolean) => void; hidden: WidgetKey[]; setHidden: (v: WidgetKey[]) => void; onNew: () => void;
}) {
  const h = Math.floor((ctx.now % DAY) / 60);
  const hello = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const date = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const actions = needsYou(ctx).length;
  const late = ctx.tasks.filter(t => QUEUE.includes(t.status) && t.editorId && deadlineState(t, ctx.now).tone === "bad").length;
  const today = Math.floor(ctx.now / DAY);
  const dueToday = ctx.jobs.filter(j => OPEN.includes(j.status) && j.dueDate && Math.floor(toLm(j.dueDate) / DAY) === today).length;
  const bits = [
    actions ? <><b>{actions}</b> {actions > 1 ? "coisas esperam" : "coisa espera"} você</> : <>nada esperando você</>,
    late ? <span className="text-rose-500"><b>{late}</b> {late > 1 ? "jobs vão" : "job vai"} atrasar</span> : <span className="text-emerald-600 dark:text-emerald-400">tudo no prazo</span>,
    <><b>{dueToday}</b> {dueToday === 1 ? "entrega" : "entregas"} hoje</>,
  ];
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className={cn("text-[13px] first-letter:uppercase", muted)}>{date}</p>
        <h1 className="text-2xl font-bold tracking-tight">{hello}, {name.split(" ")[0]}</h1>
        <p className="mt-0.5 text-[13.5px]">{bits.map((b, i) => <span key={i}>{i > 0 && <span className={muted}> · </span>}{b}</span>)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5 text-[13px] font-semibold">
          {[[true, "Meus jobs"], [false, "Equipe toda"]].map(([v, l]) => (
            <button key={String(v)} type="button" onClick={() => setMine(v as boolean)} className={cn("h-8 rounded-md px-3", mine === v ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : cn(muted, "hover:text-[hsl(var(--foreground))]"))}>{l as string}</button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]"><Settings2 className="h-4 w-4" />Blocos</button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <p className={cn("px-2 py-1 text-[11px] font-bold uppercase tracking-wider", muted)}>Blocos visíveis</p>
            {WIDGETS.map(([k, l]) => (
              <DropdownMenuItem key={k} onSelect={e => { e.preventDefault(); setHidden(hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k]); }}>
                <span className={cn("grid h-4 w-4 place-items-center rounded border", !hidden.includes(k) && "border-transparent bg-[hsl(var(--primary))] text-white")}>{!hidden.includes(k) && <Check className="h-3 w-3" />}</span>{l}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <HeadAction icon={Plus} label="Novo job" onClick={onNew} />
      </div>
    </div>
  );
}

/* ── indicadores ── */
function Kpis({ ctx }: { ctx: Ctx }) {
  const { jobs, now } = ctx, today = Math.floor(now / DAY);
  const done = jobs.filter(j => j.status === "completed" && j.closedAt).map(j => ({ j, d: Math.floor(toLm(j.closedAt!) / DAY) }));
  const doneIn = (a: number, b: number) => done.filter(x => x.d > today - a && x.d <= today - b).length;
  const spark = Array.from({ length: 14 }, (_, i) => done.filter(x => x.d === today - 13 + i).length);
  const onTime = (a: number, b: number) => {
    const xs = done.filter(x => x.d > today - a && x.d <= today - b && x.j.reviewedAt && x.j.dueDate);
    return xs.length ? Math.round((xs.filter(x => toLm(x.j.reviewedAt!) <= toLm(x.j.dueDate!)).length / xs.length) * 100) : null;
  };
  const open = jobs.filter(j => OPEN.includes(j.status));
  const created7 = jobs.filter(j => Math.floor(toLm(j.createdAt) / DAY) > today - 7).length;
  const late = ctx.tasks.filter(t => QUEUE.includes(t.status) && t.editorId && deadlineState(t, now).tone === "bad");
  const overdue = late.filter(t => t.promised != null && t.promised <= now).length;
  const client = ctx.tasks.filter(t => t.status === "review");
  const oldest = Math.max(0, ...client.map(t => (t.sentAt != null ? now - t.sentAt : 0)));
  const ot = onTime(30, 0), otPrev = onTime(60, 30);
  const d7 = doneIn(7, 0), d7prev = doneIn(14, 7);

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[hsl(var(--border))] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] md:grid-cols-3 xl:grid-cols-5 [&>*:last-child:nth-child(odd)]:max-md:col-span-2">
      <Kpi label="Em aberto" value={open.length} foot={<>{created7} criados em 7 dias</>} />
      <Kpi label="Entregues · 7 dias" value={d7} delta={d7 - d7prev} deltaTxt="vs 7 dias antes" spark={spark} />
      <Kpi label="No prazo · 30 dias" value={ot == null ? "—" : `${ot}%`} meter={ot ?? undefined} delta={ot != null && otPrev != null ? ot - otPrev : undefined} deltaUnit=" p.p." deltaTxt="vs 30 dias antes"
        tone={ot == null ? undefined : ot >= 85 ? "ok" : ot >= 65 ? "warn" : "bad"} foot={ot == null ? "sem entregas no período" : "1ª versão antes do prazo"} />
      <Kpi label="Vão atrasar" value={late.length} tone={late.length ? "bad" : "ok"} foot={overdue ? <span className="text-rose-500">{overdue} com prazo já vencido</span> : "pela previsão da fila"} />
      <Kpi label="Com o cliente" value={client.length} tone={oldest > 2 * DAY ? "warn" : undefined} foot={!client.length ? "nada esperando aprovação" : oldest > 0 ? <>mais antigo há {ago(oldest)}</> : "esperando aprovação"} />
    </div>
  );
}

function Kpi({ label, value, foot, delta, deltaUnit = "", deltaTxt, spark, tone, meter }: {
  label: string; value: React.ReactNode; foot?: React.ReactNode; delta?: number; deltaUnit?: string; deltaTxt?: string; spark?: number[]; tone?: "ok" | "warn" | "bad"; meter?: number;
}) {
  // cor só no número quando pede atenção; o resto fica neutro
  const color = tone === "bad" ? "text-rose-500" : tone === "warn" ? "text-amber-500" : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-[hsl(var(--card))] px-4 py-3.5">
      <p className={cn("text-[11px] font-semibold uppercase tracking-wider", muted)}>{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className={cn("text-[30px] font-semibold leading-none tracking-tight tabular-nums", color)}>{value}</p>
        {spark && <Sparkline data={spark} />}
      </div>
      {meter != null && <div className="h-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><i className="block h-full rounded-full bg-[hsl(var(--foreground)/0.55)]" style={{ width: `${meter}%` }} /></div>}
      {delta != null ? (
        <p className="flex items-center gap-1 text-xs">
          <span className={cn("inline-flex items-center font-semibold", delta > 0 ? "text-emerald-500" : delta < 0 ? "text-rose-500" : muted)}>
            {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}{delta > 0 ? "+" : ""}{delta}{deltaUnit}
          </span><span className={muted}>{deltaTxt}</span>
        </p>
      ) : <p className={cn("truncate text-xs", muted)}>{foot}</p>}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data), w = 84, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 text-[hsl(var(--primary))]" aria-hidden>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="currentColor" opacity={0.12} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── para você ── */
interface Need { key: string; tone: "bad" | "warn" | "acc" | "neu"; title: string; sub: React.ReactNode; taskId?: number; href?: string; cta: string; sign?: QTask }
function needsYou(ctx: Ctx): Need[] {
  const { board, tasks, me, isSup, now } = ctx, out: Need[] = [];
  const title = (id: number) => board.tasks.find(t => t.id === id)?.title ?? "job";
  for (const r of board.requests) {
    if (r.status !== "pendente" && r.status !== "pending") continue;
    if (r.approverId === me || (isSup && r.escalated)) out.push({ key: `r${r.id}`, tone: "warn", title: `${personName(board, r.requestedById).split(" ")[0]} pediu para passar “${title(r.taskId)}” na frente`, sub: r.impacts[0] ?? "Atrasa um job seu na fila", href: "/fila", cta: "Responder" });
  }
  for (const t of tasks) {
    // ação é de quem é dono do job (ou da supervisão); quem só acompanha vê nos outros blocos
    if (t.coordId !== me && !isSup) continue;
    if (t.estDisputeOpen) out.push({ key: `d${t.id}`, tone: "warn", title: `Editor contestou a estimativa de “${t.title}”`, sub: <>Ele acha que precisa de {fmtH(t.estEditor)}; você estimou {fmtH(t.estCoord ?? t.est)}</>, taskId: t.id, cta: "Decidir" });
    if (t.status === "paused") out.push({ key: `b${t.id}`, tone: "warn", title: `“${t.title}” está travado`, sub: t.blockReason ?? "Esperando algo para continuar", taskId: t.id, cta: "Ver" });
    if (t.status === "review" && t.sentAt != null && now - t.sentAt > 2 * DAY) out.push({ key: `c${t.id}`, tone: "acc", title: `Cobrar o cliente: “${t.title}”`, sub: <>Com o cliente há {ago(now - t.sentAt)}</>, taskId: t.id, cta: "Ver" });
    if (QUEUE.includes(t.status) && t.editorId && t.slot?.late) out.push({ key: `l${t.id}`, tone: "bad", title: `“${t.title}” vai atrasar ${fmtH(t.slot.lateBy)}`, sub: <>Termina {fmt(t.slot.end)} · prazo {fmt(t.promised)}{t.proposedDue != null ? <> · novo prazo a partir de {fmt(t.proposedDue)}</> : null}</>, taskId: t.id, cta: t.proposedDue != null ? "Assinar novo prazo" : "Resolver", sign: t.proposedDue != null ? t : undefined });
    if (t.status === "pending" && !t.editorId && !t.hold && (isSup || t.coordId === me)) out.push({ key: `n${t.id}`, tone: "bad", title: `“${t.title}” está sem editor`, sub: "Nenhuma fila comportava no prazo", taskId: t.id, cta: "Ver" });
  }
  const rank = { bad: 0, warn: 1, acc: 2, neu: 3 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

function ForYou({ ctx }: { ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"need" | "next" | "late">("need");
  const [signing, setSigning] = useState<QTask | null>(null);
  const today = Math.floor(ctx.now / DAY);
  const needs = needsYou(ctx);
  const open = ctx.jobs.filter(j => OPEN.includes(j.status) && j.dueDate);
  const next = open.filter(j => { const d = Math.floor(toLm(j.dueDate!) / DAY); return d >= today && d < today + 7 && toLm(j.dueDate!) > ctx.now; }).sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!));
  const late = open.filter(j => j.status !== "review" && toLm(j.dueDate!) <= ctx.now).sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!));
  const tabs = [["need", "Precisa de você", needs.length], ["next", "Próximas entregas", next.length], ["late", "Prazo vencido", late.length]] as const;
  const list = tab === "next" ? next : late;

  return (
    <Widget icon={CheckCircle2} title="Para você" sub="O que pede uma ação sua agora">
      <SignDueDialog board={ctx.board} task={signing} open={!!signing} onOpenChange={o => { if (!o) setSigning(null); }} />
      <div className="-mx-4 -mt-4 mb-1 flex gap-1 overflow-x-auto border-b px-3">
        {tabs.map(([k, l, n]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[13px] font-semibold",
            tab === k ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : cn("border-transparent", muted, "hover:text-[hsl(var(--foreground))]"))}>
            {l}<span className={cn("rounded-full px-1.5 text-[11px] leading-5", k === "late" && n ? "bg-rose-500/15 text-rose-500" : "bg-[hsl(var(--muted))]")}>{n}</span>
          </button>
        ))}
      </div>
      <ul className="flex max-h-[340px] min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === "need" ? (needs.length ? needs.map(n => (
          <li key={n.key}>
            <button type="button" onClick={() => (n.sign ? setSigning(n.sign) : n.taskId ? openTask(n.taskId) : navigate(n.href!))} className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-[hsl(var(--accent)/0.6)]">
              <i className={cn("h-2 w-2 shrink-0 rounded-full", { bad: "bg-rose-500", warn: "bg-amber-500", acc: "bg-[hsl(var(--primary))]", neu: "bg-[hsl(var(--muted-foreground))]" }[n.tone])} />
              <span className="min-w-0 flex-1"><b className="block truncate text-[13px] font-semibold">{n.title}</b><span className={cn("block truncate text-xs", muted)}>{n.sub}</span></span>
              <span className="shrink-0 text-xs font-semibold text-[hsl(var(--primary))] opacity-70 group-hover:opacity-100">{n.cta} →</span>
            </button>
          </li>
        )).concat(needs.length < 4 && next.length ? [
          // pouca coisa pendente: o espaço vira "a seguir" (as próximas entregas), em vez de ficar vazio
          <li key="sep" className={cn("mt-2 border-t px-1.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider", muted)}>A seguir</li>,
          ...next.slice(0, 4 - needs.length + 1).map(j => <NextRow key={`x${j.id}`} ctx={ctx} j={j} onOpen={() => openTask(j.id)} />),
        ] : []) : <>
          <Empty><span className="inline-flex items-center gap-1.5"><Confetti className="h-4 w-4" />Nada esperando você.</span></Empty>
          {next.length > 0 && <li className={cn("border-t px-1.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider", muted)}>A seguir</li>}
          {next.slice(0, 4).map(j => <NextRow key={`x${j.id}`} ctx={ctx} j={j} onOpen={() => openTask(j.id)} />)}
        </>)
        : list.length ? list.map(j => {
          const t = live(ctx, j.id), d = t && QUEUE.includes(j.status) ? deadlineState(t, ctx.now) : null;
          return (
            <li key={j.id}>
              <button type="button" onClick={() => openTask(j.id, { ids: list.map(x => x.id), label: tab === "next" ? "Próximas entregas" : "Prazo vencido" })} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-[hsl(var(--accent)/0.6)]">
                <span className="w-[74px] shrink-0 text-xs"><b className="block">{fmt(toLm(j.dueDate!)).slice(0, 9)}</b><span className={muted}>{fmt(toLm(j.dueDate!)).slice(10)}</span></span>
                <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientColor(j.client) }} />
                <span className="min-w-0 flex-1"><b className="block truncate text-[13px] font-semibold">{j.title}</b><span className={cn("block truncate text-xs", muted)}>{j.client ?? "Sem cliente"} · {j.assignee?.name ?? "sem editor"}</span></span>
                {j.status === "review" ? <Chip tone="acc">com o cliente</Chip> : j.status === "paused" ? <Chip tone="warn">travado</Chip> : d ? <Chip tone={d.tone}>{d.label}</Chip> : null}
              </button>
            </li>
          );
        }) : <Empty>{tab === "next" ? "Nenhuma entrega nos próximos 7 dias." : "Nenhum prazo vencido."}</Empty>}
      </ul>
    </Widget>
  );
}
/** Uma entrega próxima, compacta (usada no "A seguir" do "Para você"). */
function NextRow({ ctx, j, onOpen }: { ctx: Ctx; j: Job; onOpen: () => void }) {
  const t = live(ctx, j.id), d = t && QUEUE.includes(j.status) ? deadlineState(t, ctx.now) : null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-[hsl(var(--accent)/0.6)]">
        <span className={cn("w-[74px] shrink-0 text-xs tabular-nums", muted)}>{fmt(toLm(j.dueDate!)).slice(4)}</span>
        <span className="min-w-0 flex-1"><b className="block truncate text-[13px] font-medium">{j.title}</b><span className={cn("block truncate text-xs", muted)}>{j.client ?? "Sem cliente"} · {j.assignee?.name.split(" ")[0] ?? "sem editor"}</span></span>
        {j.status === "review" ? <Chip tone="acc">com o cliente</Chip> : j.status === "paused" ? <Chip tone="warn">travado</Chip> : d && (d.tone === "bad" || d.tone === "warn") ? <Chip tone={d.tone}>{d.label}</Chip> : null}
      </button>
    </li>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <li className={cn("py-10 text-center text-[13px]", muted)}>{children}</li>;

/* ── agenda da semana ── */
function Week({ ctx }: { ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const today = Math.floor(ctx.now / DAY);
  const [sel, setSel] = useState(today);
  const open = ctx.jobs.filter(j => OPEN.includes(j.status) && j.dueDate);
  const days = Array.from({ length: 7 }, (_, i) => today + i).map(d => ({ d, items: open.filter(j => Math.floor(toLm(j.dueDate!) / DAY) === d), off: ctx.board.days.find(x => x.day === d)?.off ?? null }));
  const max = Math.max(1, ...days.map(x => x.items.length));
  const cur = days.find(x => x.d === sel) ?? days[0];
  return (
    <Widget icon={CalendarDays} title="Agenda da semana" sub="Prazos combinados com o cliente" right={<Link href="/tasks?group=prazo" className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Ver prazos</Link>}>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(({ d, items, off }) => {
          const late = items.some(j => { const t = live(ctx, j.id); return t && deadlineState(t, ctx.now).tone === "bad"; });
          return (
            <button key={d} type="button" onClick={() => setSel(d)} title={off ?? undefined}
              className={cn("flex flex-col items-center gap-1 rounded-xl border px-1 pb-1.5 pt-2 text-center transition-colors", sel === d ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]" : "border-transparent hover:bg-[hsl(var(--accent)/0.6)]", off && "fila-stripes")}>
              <span className={cn("text-[10.5px] font-semibold uppercase", muted)}>{d === today ? "hoje" : fmtDay(d).slice(0, 3)}</span>
              <span className="text-[15px] font-bold leading-none">{fmtDay(d).slice(4, 6)}</span>
              <span className="flex h-10 w-full items-end justify-center">
                <i className={cn("block w-3 rounded-t", items.length ? (late ? "bg-rose-500" : "bg-[hsl(var(--primary))]") : "bg-[hsl(var(--muted))]")} style={{ height: `${items.length ? 18 + (items.length / max) * 82 : 8}%` }} />
              </span>
              <span className={cn("text-[11px] font-bold", !items.length && muted)}>{items.length}</span>
            </button>
          );
        })}
      </div>
      <p className={cn("mb-1 mt-3 text-[11px] font-bold uppercase tracking-wider", muted)}>{cur.d === today ? "Hoje" : fmtDay(cur.d)}{cur.off ? ` · ${cur.off}` : ""}</p>
      <ul className="flex max-h-[180px] flex-col overflow-y-auto">
        {cur.items.length ? cur.items.sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!)).map(j => (
          <li key={j.id}><button type="button" onClick={() => openTask(j.id, { ids: cur.items.map(x => x.id), label: fmtDay(cur.d) })} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.6)]">
            <span className={cn("w-10 shrink-0 font-mono text-[11px]", muted)}>{fmt(toLm(j.dueDate!)).slice(10)}</span>
            <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientColor(j.client) }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{j.title}</span>
            <Chip tone={stageOf(j.status).tone} className="text-[10.5px]">{stageOf(j.status).label}</Chip>
          </button></li>
        )) : <li className={cn("py-4 text-center text-[13px]", muted)}>Nenhum prazo neste dia.</li>}
      </ul>
    </Widget>
  );
}

/* ── hoje na ilha: o expediente de cada editor numa régua, com o que fica pronto e o que vence ── */
function DayLine({ ctx }: { ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const { board, now } = ctx;
  const today = Math.floor(now / DAY);
  // hoje; se o expediente já acabou, o próximo dia de trabalho
  const work = board.days.filter(d => !d.off && d.periods.length);
  const day = work.find(d => d.day === today && today * DAY + d.periods[d.periods.length - 1][1] > now) ?? work.find(d => d.day > today);
  if (!day) return null;
  const base = day.day * DAY, a = base + day.periods[0][0], z = base + day.periods[day.periods.length - 1][1];
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - a) / (z - a)) * 100));
  const hh = (t: number) => fmt(t).slice(-5);
  const isToday = day.day === today;
  const gaps = day.periods.slice(1).map((p, i) => [base + day.periods[i][1], base + p[0]] as const);
  const hours = Array.from({ length: 12 }, (_, i) => Math.ceil(a / 60) * 60 + i * 60).filter(t => t <= z);
  const inScope = new Set(ctx.tasks.map(t => t.id));
  const eds = board.editors.filter(e => !e.inactive);
  const first = (id: number | null) => personName(board, id).split(" ")[0];

  type Ev = { t: number; kind: "due" | "done"; task: QTask; bad: boolean };
  const evs: Ev[] = [];
  for (const t of ctx.tasks) {
    if (t.promised != null && t.promised >= a && t.promised <= z && t.status !== "rascunho") evs.push({ t: t.promised, kind: "due", task: t, bad: deadlineState(t, now).tone === "bad" });
    if (t.slot && QUEUE.includes(t.status) && t.slot.end >= a && t.slot.end <= z) evs.push({ t: t.slot.end, kind: "done", task: t, bad: t.slot.late });
  }
  evs.sort((x, y) => x.t - y.t);
  const ahead = evs.filter(e => e.t >= now);
  const nextDue = ctx.tasks.filter(t => t.promised != null && t.promised > z && t.status !== "rascunho").sort((x, y) => x.promised! - y.promised!)[0];
  // horas de edição agendadas no dia (recorte atual)
  let booked = 0;
  for (const t of ctx.tasks) if (t.slot) for (const [x, y] of t.slot.segs) booked += Math.max(0, Math.min(y, z) - Math.max(x, a, now));
  const Mark = ({ e, size = "h-2.5 w-2.5" }: { e: Pick<Ev, "kind" | "bad">; size?: string }) => e.kind === "due"
    ? <i className={cn("block rotate-45 rounded-[2px]", size, e.bad ? "bg-rose-500" : "bg-[hsl(var(--foreground)/0.8)]")} />
    : <i className={cn("block rounded-full border-2 bg-[hsl(var(--card))]", size, e.bad ? "border-rose-500" : "border-[hsl(var(--foreground)/0.65)]")} />;

  return (
    <Widget icon={Clock} title={isToday ? "Hoje na ilha" : `Próximo expediente · ${fmtDay(day.day)}`}
      sub={`${hh(a)}–${hh(z)} · ${fmtH(booked)} de edição agendadas · ${evs.filter(e => e.kind === "done").length} prontos previstos · ${evs.filter(e => e.kind === "due").length} prazos`}
      right={<span className={cn("hidden items-center gap-3 text-[11px] sm:flex", muted)}>
        <span className="inline-flex items-center gap-1.5"><Mark e={{ kind: "due", bad: false }} size="h-2 w-2" />prazo</span>
        <span className="inline-flex items-center gap-1.5"><Mark e={{ kind: "done", bad: false }} size="h-2 w-2" />fica pronto</span>
        <span className="hidden items-center gap-1.5 sm:inline-flex"><i className="h-2.5 w-4 rounded-sm border bg-[hsl(var(--foreground)/0.12)]" />agendado</span>
      </span>}
      bodyClass="p-0">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* régua por editor */}
        <div className="overflow-x-auto px-4 pb-4 pt-3">
          <div className="grid min-w-[560px] grid-cols-[96px_minmax(0,1fr)] gap-x-3">
            <span />
            <div className="relative mb-1 h-4">
              {hours.map(t => <span key={t} className={cn("absolute -translate-x-1/2 text-[10.5px] tabular-nums", muted)} style={{ left: `${pct(t)}%` }}>{hh(t).slice(0, 2)}h</span>)}
            </div>
            <div className="flex flex-col">
              {eds.map(e => (
                <span key={e.id} className="flex h-11 min-w-0 items-center gap-2">
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={24} />
                  <span className="truncate text-[13px] font-medium">{e.name.split(" ")[0]}</span>
                </span>
              ))}
            </div>
            <div className="relative flex flex-col">
              {/* intervalo, já passou e agora: atravessam todas as faixas */}
              {gaps.map(([x, y]) => <i key={x} className="fila-stripes pointer-events-none absolute inset-y-0 z-0" style={{ left: `${pct(x)}%`, width: `${pct(y) - pct(x)}%` }} />)}
              {isToday && <i className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-[hsl(var(--foreground)/0.035)]" style={{ width: `${pct(now)}%` }} />}
              {isToday && now >= a && now <= z && (
                <div className="pointer-events-none absolute -top-1 bottom-0 z-20 w-px bg-[hsl(var(--foreground))]" style={{ left: `${pct(now)}%` }}>
                  <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 rounded bg-[hsl(var(--foreground))] px-1 text-[9.5px] font-bold uppercase tracking-wide text-[hsl(var(--background))]">{hh(now)}</span>
                </div>
              )}
              {eds.map(e => {
                const off = isToday ? e.offToday : e.offDays.find(o => o.day === day.day)?.off ?? null;
                const blocks = board.tasks.filter(t => t.editorId === e.id && t.slot && QUEUE.includes(t.status))
                  .flatMap(t => t.slot!.segs.filter(([x, y]) => y > a && x < z).map(([x, y]) => ({ t, x: Math.max(x, a), y: Math.min(y, z) })));
                const dues = evs.filter(v => v.kind === "due" && v.task.editorId === e.id);
                return (
                  <div key={e.id} className="relative z-10 h-11 border-b border-dashed border-[hsl(var(--border)/0.7)] last:border-b-0">
                    {off ? <span className={cn("fila-stripes absolute inset-x-0 inset-y-2 grid place-items-center rounded-md text-[11.5px]", muted)}>{off}</span>
                      : blocks.map(({ t, x, y }, i) => {
                        const mineT = inScope.has(t.id), w = pct(y) - pct(x);
                        return (
                          <button key={`${t.id}-${i}`} type="button" onClick={() => openTask(t.id)}
                            title={`${t.title} · ${hh(x)}–${hh(y)}${t.slot ? ` · pronto ${fmt(t.slot.end)}` : ""}${t.slot?.late ? " · passa do prazo" : ""}`}
                            className={cn("absolute inset-y-2 flex items-center overflow-hidden rounded-md border px-1.5 text-left text-[11.5px] font-medium transition-[filter] hover:brightness-110",
                              t.playing ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : mineT ? "border-[hsl(var(--foreground)/0.22)] bg-[hsl(var(--foreground)/0.12)]"
                                : cn("border-transparent bg-[hsl(var(--foreground)/0.06)]", muted),
                              t.slot?.late && "border-rose-500/60")}
                            style={{ left: `${pct(x)}%`, width: `max(${w}%, 6px)` }}>
                            {w > 9 && <span className="truncate">{t.playing && <LiveDot className="mr-1 inline-block" />}{t.title}</span>}
                          </button>
                        );
                      })}
                    {dues.map((v, i) => (
                      <button key={`d${v.task.id}${i}`} type="button" onClick={() => openTask(v.task.id)} title={`${hh(v.t)} · prazo de “${v.task.title}”`}
                        className="absolute top-0.5 z-10 -translate-x-1/2 p-0.5" style={{ left: `${pct(v.t)}%` }}><Mark e={v} size="h-2 w-2" /></button>
                    ))}
                    {blocks.filter(b => b.t.slot && b.y === b.t.slot.end && inScope.has(b.t.id)).map(b => (
                      <span key={`e${b.t.id}`} className="pointer-events-none absolute bottom-0.5 z-10 -translate-x-1/2" style={{ left: `${pct(b.y)}%` }}><Mark e={{ kind: "done", bad: !!b.t.slot?.late }} size="h-2 w-2" /></span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* próximos marcos */}
        <div className="border-t px-4 py-3 lg:border-l lg:border-t-0">
          <p className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wider", muted)}>Próximos marcos</p>
          {ahead.length ? (
            <ol className="relative flex flex-col">
              <span className="absolute bottom-2 left-[5px] top-2 w-px bg-[hsl(var(--border))]" aria-hidden />
              {ahead.slice(0, 5).map((e, i) => (
                <li key={`${e.kind}${e.task.id}${i}`}>
                  <button type="button" onClick={() => openTask(e.task.id)} className="relative flex w-full items-start gap-3 rounded-lg py-1.5 pr-1 text-left hover:bg-[hsl(var(--accent)/0.6)]">
                    <span className="relative z-10 mt-[5px] grid w-[11px] shrink-0 place-items-center bg-[hsl(var(--card))] py-0.5"><Mark e={e} size="h-2 w-2" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <b className="text-[13px] font-semibold tabular-nums">{hh(e.t)}</b>
                        <span className={cn("text-[11px]", e.bad ? "text-rose-600 dark:text-rose-400" : muted)}>
                          {e.bad ? (e.kind === "due" ? "vai atrasar" : "depois do prazo") : isToday ? `em ${fmtH(e.t - now)}` : ""}
                        </span>
                      </span>
                      <span className="block truncate text-[12.5px]">{e.kind === "due" ? "Prazo · " : "Pronto · "}{e.task.title}</span>
                      <span className={cn("block truncate text-[11.5px]", muted)}>{first(e.task.editorId)}{e.task.client ? ` · ${e.task.client}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
              {ahead.length > 5 && <li className={cn("pl-6 pt-0.5 text-xs", muted)}>+{ahead.length - 5} até {hh(z)}</li>}
            </ol>
          ) : (
            <p className={cn("text-[13px] leading-relaxed", muted)}>
              Nada vence nem fica pronto {isToday ? "no resto do expediente" : "nesse dia"}.
              {nextDue && <> Próximo prazo: <button type="button" onClick={() => openTask(nextDue.id)} className="font-semibold text-[hsl(var(--foreground))] hover:underline">{nextDue.title}</button>, {fmt(nextDue.promised)}.</>}
            </p>
          )}
        </div>
      </div>
    </Widget>
  );
}

/* ── jobs por fase (rosca) ── */
const PHASE_COLOR: Record<string, string> = { fila: "#60a5fa", edicao: "hsl(var(--primary))", travado: "#f59e0b", cliente: "#f472b6" };
function Phases({ ctx }: { ctx: Ctx }) {
  const [, navigate] = useLocation();
  const keys = ["fila", "edicao", "travado", "cliente"] as const;
  const data = keys.map(k => ({ k, label: STAGES.find(s => s.k === k)!.label, n: ctx.jobs.filter(j => stageOf(j.status).k === k).length }));
  const total = data.reduce((s, d) => s + d.n, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  const goStage = (k: string) => { openJobs({ phase: k, mine: ctx.mine }); navigate("/tasks"); };
  return (
    <Widget icon={ListOrdered} title="Jobs por fase" sub="Em aberto agora">
      <div className="flex flex-1 items-center gap-5">
        <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
          {total > 0 && data.map(d => {
            const len = (d.n / total) * C, el = <circle key={d.k} cx="50" cy="50" r={R} fill="none" stroke={PHASE_COLOR[d.k]} strokeWidth="12" strokeDasharray={`${Math.max(0, len - 1.2)} ${C}`} strokeDashoffset={-acc} />;
            acc += len; return el;
          })}
          <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-[hsl(var(--foreground))] text-[20px] font-bold">{total}</text>
        </svg>
        <ul className="flex min-w-0 flex-1 flex-col gap-1">
          {data.map(d => (
            <li key={d.k}><button type="button" onClick={() => goStage(d.k)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] hover:bg-[hsl(var(--accent)/0.6)]">
              <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PHASE_COLOR[d.k] }} />
              <span className="flex-1 text-left">{d.label}</span><b>{d.n}</b>
              <span className={cn("w-9 text-right text-xs", muted)}>{total ? Math.round((d.n / total) * 100) : 0}%</span>
            </button></li>
          ))}
        </ul>
      </div>
    </Widget>
  );
}

/* ── carga da equipe (workload) ── */
function Team({ ctx }: { ctx: Ctx }) {
  const { board, now } = ctx;
  const [view, setView] = useState<"dia" | "semana">(() => (store.get("dash:teamView") === "semana" ? "semana" : "dia"));
  useEffect(() => store.set("dash:teamView", view), [view]);
  const today = Math.floor(now / DAY);
  const eds = [...board.editors].filter(e => !e.inactive).sort((a, b) => a.name.localeCompare(b.name));
  // próximos 6 dias de trabalho da equipe (pula domingo e feriado)
  const week = board.days.filter(d => d.day >= today && (d.day === today || !d.off)).slice(0, 6);

  /** capacidade (expediente) e minutos agendados de um editor num dia */
  const dayStats = (edId: number, day: number) => {
    const e = board.editors.find(x => x.id === edId)!;
    const d = board.days.find(x => x.day === day);
    const off = e.offDays.find(o => o.day === day)?.off ?? d?.off ?? null;
    const cap = day === today ? e.todayCap : off ? 0 : (d?.periods ?? []).reduce((s, [x, y]) => s + y - x, 0);
    const a = day * DAY, z = a + DAY;
    let planned = 0;
    for (const t of board.tasks) if (t.editorId === edId && t.slot) for (const [x, y] of t.slot.segs) planned += Math.max(0, Math.min(y, z) - Math.max(x, a, now));
    const done = day === today ? Math.min(e.todayDone, cap) : 0;
    return { cap, done, planned: Math.min(planned, Math.max(0, cap - done)), off };
  };

  return (
    <Widget icon={Users} title="Disponibilidade da equipe" sub={view === "dia" ? "Expediente de hoje de cada editor" : "Ocupação dos próximos dias de trabalho"}
      right={<div className="flex rounded-lg border p-0.5 text-[12.5px] font-semibold">
        {([["dia", "Hoje"], ["semana", "Semana"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={cn("h-7 rounded-md px-2.5", view === k ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : cn(muted, "hover:text-[hsl(var(--foreground))]"))}>{l}</button>
        ))}
      </div>}>
      {/* legenda: uma cor só, significado fixo */}
      <div className={cn("mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]", muted)}>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--primary))]" />agendado</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border bg-[hsl(var(--muted))]" />livre</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--muted-foreground)/0.35)]" />já passou</span>
        {view === "semana" && <span className="inline-flex items-center gap-1.5"><i className="fila-stripes h-2.5 w-2.5 rounded-sm" />sem expediente</span>}
      </div>

      {view === "semana" && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_64px] items-end gap-3 border-b pb-1.5 pt-1">
          <span />
          <div className="grid grid-cols-6 gap-1 text-center">{week.map(d => <span key={d.day} className={cn("text-[10.5px] font-semibold uppercase", d.day === today ? "text-[hsl(var(--primary))]" : muted)}>{d.day === today ? "hoje" : fmtDay(d.day).slice(0, 3)}</span>)}</div>
          <span className={cn("text-right text-[10.5px] font-semibold uppercase", muted)}>livre</span>
        </div>
      )}

      <ul className="flex flex-col divide-y">
        {eds.map(e => {
          const playing = board.tasks.find(t => t.editorId === e.id && t.playing);
          if (view === "dia") {
            const s = dayStats(e.id, today), free = Math.max(0, s.cap - s.done - s.planned);
            return (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <b className="truncate font-semibold">{e.name}</b>
                    <span className={cn("shrink-0 text-xs", muted)}>{s.off ? s.off : s.cap && s.cap - s.done <= 0 ? "dia encerrado" : s.cap ? <>livre <b className={cn("font-semibold", free ? "text-[hsl(var(--foreground))]" : "")}>{fmtH(free)}</b> de {fmtH(s.cap)}</> : "sem expediente hoje"}</span>
                  </div>
                  <div className={cn("my-1 flex h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]", s.off && "fila-stripes")}>
                    {s.cap > 0 && <>
                      <i className="block h-full bg-[hsl(var(--muted-foreground)/0.35)]" style={{ width: `${(s.done / s.cap) * 100}%` }} />
                      <i className="block h-full bg-[hsl(var(--primary))]" style={{ width: `${(s.planned / s.cap) * 100}%` }} />
                    </>}
                  </div>
                  <p className={cn("truncate text-xs", muted)}>
                    {s.off ? "Fora hoje" : playing ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><LiveDot />Em edição: “{playing.title}”</span>
                      : s.planned ? <>{fmtH(s.planned)} agendadas até o fim do dia</> : s.cap - s.done > 0 ? "Nada agendado para o resto do dia" : "Expediente de hoje encerrado"}
                  </p>
                </div>
              </li>
            );
          }
          const stats = week.map(d => ({ d, ...dayStats(e.id, d.day) }));
          const free = stats.reduce((sum, x) => sum + Math.max(0, x.cap - x.done - x.planned), 0);
          return (
            <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_64px] items-center gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={26} /><b className="truncate text-[13px] font-semibold">{e.name}</b></span>
              <div className="grid grid-cols-6 gap-1">
                {stats.map(x => {
                  return (
                    <div key={x.d.day} title={x.off ? `${fmtDay(x.d.day)}: ${x.off}` : `${fmtDay(x.d.day)}: ${fmtH(x.planned)} agendadas, livre ${fmtH(Math.max(0, x.cap - x.done - x.planned))} de ${fmtH(x.cap)}`}
                      className={cn("relative h-7 overflow-hidden rounded-md border bg-[hsl(var(--muted))]", x.off && "fila-stripes")}>
                      {!x.off && x.cap > 0 && <span className="absolute inset-0 flex flex-col justify-end">
                        <i className="block bg-[hsl(var(--primary))]" style={{ height: `${(x.planned / x.cap) * 100}%` }} />
                        <i className="block bg-[hsl(var(--muted-foreground)/0.35)]" style={{ height: `${(x.done / x.cap) * 100}%` }} />
                      </span>}
                    </div>
                  );
                })}
              </div>
              <span className={cn("text-right text-[13px] font-semibold", !free && muted)}>{fmtH(free)}</span>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}

/* ── atividade recente ── */
const VERB: Record<string, string> = {
  created: "criou", assign: "colocou na fila", play: "começou a editar", pause: "pausou", sent: "enviou para o cliente", blocked: "travou",
  unblocked: "destravou", inform: "pediu mais tempo em", est_confirm: "confirmou a estimativa de", est_contest: "contestou a estimativa de",
  est_keep: "manteve a estimativa de", est_use: "aceitou a estimativa do editor em", furou: "furou a fila com", reneg: "empurrou o prazo de",
  reassign: "passou para outro editor", client_change: "registrou alteração do cliente em", client_ok: "marcou como aprovado", request: "pediu mudança na fila em",
  decide: "respondeu pedido sobre", follow: "incluiu acompanhantes em", est_expired: "estourou as horas de", cancelled: "cancelou", owner: "trocou o gestor de", archived: "encerrou",
};
function Feed({ items, className }: { items: Activity[]; className?: string }) {
  const { openTask } = useTaskModal();
  const [n, setN] = useState(30);
  const rel = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000)); return m < 1 ? "agora" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };
  return (
    <Widget icon={Newspaper} title="Atividade recente" sub="Quem mexeu em quê" className={className}>
      {!items.length ? <p className={cn("py-10 text-center text-[13px]", muted)}>Sem atividade ainda.</p> : (
        <ul className="-mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2 max-lg:max-h-[420px]">
          {items.slice(0, n).map(a => (
            <li key={a.id} className="flex gap-2.5 py-1.5">
              {a.actor ? <AvatarDisplay name={a.actor} avatarUrl={a.avatarUrl} size={26} /> : <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] text-[11px]"><Settings className="h-3.5 w-3.5" /></span>}
              <div className="min-w-0 flex-1 text-[13px] leading-snug">
                <p><b className="font-semibold">{a.actor?.split(" ")[0] ?? "Sistema"}</b>{" "}
                  {a.taskId ? <><span className={muted}>{VERB[a.kind] ?? a.kind}</span>{" "}
                    <button type="button" onClick={() => openTask(a.taskId!)} className="font-semibold hover:text-[hsl(var(--primary))] hover:underline">{a.title}</button></>
                    : <span className={muted}>{(a.text ?? VERB[a.kind] ?? a.kind).replace(/^./, c => c.toLowerCase())}</span>}
                </p>
                {a.taskId && a.text && a.kind !== "created" && <p className={cn("truncate text-xs", muted)}>{a.text}</p>}
              </div>
              <span className={cn("shrink-0 pt-0.5 text-[11px]", muted)}>{rel(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > n && <button type="button" onClick={() => setN(x => x + 15)} className="mt-1 self-start text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Ver mais</button>}
    </Widget>
  );
}

/* ── clientes ── */
function Clients({ ctx }: { ctx: Ctx }) {
  const [, navigate] = useLocation();
  const today = Math.floor(ctx.now / DAY);
  const rows = useMemo(() => {
    const m = new Map<string, Job[]>();
    ctx.jobs.forEach(j => { if (j.client) m.set(j.client, [...(m.get(j.client) ?? []), j]); });
    return [...m].map(([name, list]) => {
      const open = list.filter(j => OPEN.includes(j.status));
      const late = open.filter(j => { const t = live(ctx, j.id); return t && QUEUE.includes(j.status) && deadlineState(t, ctx.now).tone === "bad"; }).length;
      const done = list.filter(j => j.status === "completed" && j.closedAt && Math.floor(toLm(j.closedAt) / DAY) > today - 30);
      const rated = done.filter(j => j.reviewedAt && j.dueDate);
      const ot = rated.length ? Math.round((rated.filter(j => toLm(j.reviewedAt!) <= toLm(j.dueDate!)).length / rated.length) * 100) : null;
      return { name, open: open.length, late, done: done.length, ot };
    }).filter(r => r.open || r.done).sort((a, b) => b.open - a.open || b.done - a.done).slice(0, 8);
  }, [ctx, today]);
  const goClient = (c: string) => { openJobs({ clients: [c], mine: ctx.mine }); navigate("/tasks"); };
  if (!rows.length) return null;
  return (
    <Widget icon={Briefcase} title="Clientes" sub="Mais movimentados · últimos 30 dias" right={<Link href="/tasks" className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Ver todos os jobs</Link>}>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead><tr className={cn("text-[11px] uppercase tracking-wider", muted)}>
            {["Cliente", "Em aberto", "Vão atrasar", "Entregues", "No prazo"].map((h, i) => <th key={h} className={cn("px-4 py-1.5 font-semibold", i ? "text-right" : "text-left")}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.name} onClick={() => goClient(r.name)} className="cursor-pointer border-t hover:bg-[hsl(var(--accent)/0.5)]">
              <td className="px-4 py-2"><span className="inline-flex items-center gap-2 font-semibold"><i className="h-2.5 w-2.5 rounded-full" style={{ background: clientColor(r.name) }} />{r.name}</span></td>
              <td className="px-4 py-2 text-right font-mono">{r.open}</td>
              <td className={cn("px-4 py-2 text-right font-mono", r.late ? "font-bold text-rose-500" : muted)}>{r.late}</td>
              <td className="px-4 py-2 text-right font-mono">{r.done}</td>
              <td className="px-4 py-2 text-right">
                {r.ot == null ? <span className={muted}>—</span> : <span className="inline-flex items-center gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[hsl(var(--muted))] sm:block"><i className={cn("block h-full", r.ot >= 85 ? "bg-emerald-500" : r.ot >= 65 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${r.ot}%` }} /></span>
                  <b className="w-9 font-mono">{r.ot}%</b></span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Widget>
  );
}

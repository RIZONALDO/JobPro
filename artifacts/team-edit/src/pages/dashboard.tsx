import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowDownRight, ArrowUpRight, Check, Plus, Settings2, Confetti, Settings, CheckCircle2, CalendarDays, Users, ListOrdered, Briefcase, Newspaper } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DAY, coordColor, deadlineState, fmt, fmtDay, personName, toLm, useBoard, type Board, type QTask } from "@/lib/fila";
import { Btn, Chip, HeadAction, LiveDot } from "@/components/fila/ui";
import { Widget } from "@/components/ui/widget";
import { JobForm } from "@/components/fila/JobForm";
import { STAGES, ago, clientColor, stageOf } from "@/components/fila/job-shared";

/**
 * Dashboard (gestor e supervisão), no espírito do Jira/Asana:
 * saudação com o resumo do dia → indicadores com tendência → "Para você" (o que pede ação) e agenda da semana
 * → equipe e clientes (à esquerda); fases e atividade (à direita, preenchendo a coluna).
 * Cada bloco pode ser escondido em "Blocos". "Meus jobs" / "Equipe toda" muda o recorte de tudo.
 */

interface Person { id: number; name: string; avatarUrl?: string | null }
interface Job {
  id: number; taskCode?: string; title: string; status: string; client: string | null; dueDate: string | null;
  reviewedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string; assignee: Person | null; coordinator: Person | null; isOwn: boolean; isFollowing: boolean;
}
interface Activity {
  id: number; kind: string; text: string | null; at: string; taskId: number | null; coordId: number | null;
  actorId: number | null; actor: string | null; avatarUrl: string | null; title: string | null; client: string | null; taskCode: string | null;
}

const WIDGETS = [
  ["kpis", "Indicadores"], ["foryou", "Para você"], ["week", "Agenda da semana"],
  ["phases", "Jobs por fase"], ["team", "Equipe"], ["activity", "Atividade recente"], ["clients", "Clientes"],
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
    late ? <span className="text-rose-500"><b>{late}</b> {late > 1 ? "jobs atrasados" : "job atrasado"}</span> : <span className="text-emerald-600 dark:text-emerald-400">tudo no prazo</span>,
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
  const late = ctx.tasks.filter(t => QUEUE.includes(t.status) && t.editorId && t.late);
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
      <Kpi label="Atrasados" value={late.length} tone={late.length ? "bad" : "ok"} foot={late.length ? "prazo vencido, ainda na fila" : "nenhum prazo vencido"} />
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
interface Need { key: string; tone: "bad" | "warn" | "acc" | "neu"; title: string; sub: React.ReactNode; taskId?: number; href?: string; cta: string }
function needsYou(ctx: Ctx): Need[] {
  const { board, tasks, me, isSup, now } = ctx, out: Need[] = [];
  for (const t of tasks) {
    // ação é de quem é dono do job (ou da supervisão); quem só acompanha vê nos outros blocos
    if (t.coordId !== me && !isSup) continue;
    if (t.status === "paused") out.push({ key: `b${t.id}`, tone: "warn", title: `“${t.title}” está travado`, sub: t.blockReason ?? "Esperando algo para continuar", taskId: t.id, cta: "Ver" });
    if (t.status === "review" && t.sentAt != null && now - t.sentAt > 2 * DAY) out.push({ key: `c${t.id}`, tone: "acc", title: `Cobrar o cliente: “${t.title}”`, sub: <>Com o cliente há {ago(now - t.sentAt)}</>, taskId: t.id, cta: "Ver" });
    if (QUEUE.includes(t.status) && t.editorId && t.late) out.push({ key: `l${t.id}`, tone: "bad", title: `“${t.title}” está atrasado`, sub: <>Prazo {fmt(t.promised)} · {personName(board, t.editorId).split(" ")[0]}, {(t.pos ?? 0) + 1}º na fila</>, taskId: t.id, cta: "Resolver" });
    if (t.status === "pending" && !t.editorId && !t.hold && (isSup || t.coordId === me)) out.push({ key: `n${t.id}`, tone: "bad", title: `“${t.title}” está sem editor`, sub: "A supervisão escolhe quem faz", taskId: t.id, cta: "Ver" });
  }
  const rank = { bad: 0, warn: 1, acc: 2, neu: 3 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

function ForYou({ ctx }: { ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"need" | "next" | "late">("need");
  const today = Math.floor(ctx.now / DAY);
  const needs = needsYou(ctx);
  const open = ctx.jobs.filter(j => OPEN.includes(j.status) && j.dueDate);
  const next = open.filter(j => { const d = Math.floor(toLm(j.dueDate!) / DAY); return d >= today && d < today + 7 && toLm(j.dueDate!) > ctx.now; }).sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!));
  const late = open.filter(j => j.status !== "review" && toLm(j.dueDate!) <= ctx.now).sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!));
  const tabs = [["need", "Precisa de você", needs.length], ["next", "Próximas entregas", next.length], ["late", "Prazo vencido", late.length]] as const;
  const list = tab === "next" ? next : late;

  return (
    <Widget icon={CheckCircle2} title="Para você" sub="O que pede uma ação sua agora">
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
            <button type="button" onClick={() => (n.taskId ? openTask(n.taskId) : navigate(n.href!))} className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-[hsl(var(--accent)/0.6)]">
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
  const days = Array.from({ length: 7 }, (_, i) => today + i).map(d => ({ d, items: open.filter(j => Math.floor(toLm(j.dueDate!) / DAY) === d), off: new Date(d * 86_400_000).getUTCDay() === 0 ? "Domingo" : null }));
  const max = Math.max(1, ...days.map(x => x.items.length));
  const cur = days.find(x => x.d === sel) ?? days[0];
  return (
    <Widget icon={CalendarDays} title="Agenda da semana" sub="Prazos de entrega" right={<Link href="/tasks?group=prazo" className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Ver prazos</Link>}>
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

/* ── equipe: quantos jobs cada editor tem na fila e o que está fazendo agora ── */
function Team({ ctx }: { ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const { board } = ctx;
  const eds = [...board.editors].filter(e => !e.inactive).sort((a, b) => a.name.localeCompare(b.name));
  const max = Math.max(1, ...eds.map(e => e.count));
  return (
    <Widget icon={Users} title="Equipe" sub="Jobs na fila de cada editor" right={<Link href="/fila" className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Ver filas</Link>}>
      <ul className="flex flex-col divide-y">
        {eds.map(e => {
          const playing = board.tasks.find(t => t.editorId === e.id && t.playing);
          const next = board.tasks.find(t => t.editorId === e.id && t.pos === 0 && QUEUE.includes(t.status));
          const cur = playing ?? next;
          return (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <b className="truncate font-semibold">{e.name}</b>
                  <span className={cn("shrink-0 text-xs", muted)}>{e.offToday ? e.offToday : <><b className="font-semibold text-[hsl(var(--foreground))]">{e.count}</b> na fila{e.late > 0 && <span className="text-rose-500"> · {e.late} atrasado{e.late > 1 ? "s" : ""}</span>}</>}</span>
                </div>
                <div className="my-1 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><i className="block h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${(e.count / max) * 100}%` }} /></div>
                <p className={cn("truncate text-xs", muted)}>
                  {playing ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><LiveDot />Em edição: </span> : next ? "Próximo: " : "Fila vazia"}
                  {cur && <button type="button" onClick={() => openTask(cur.id)} className="hover:underline">“{cur.title}”</button>}
                </p>
              </div>
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
  unblocked: "destravou", inform: "pediu mais tempo em", due_changed: "mudou o prazo de", est_confirm: "confirmou a estimativa de", est_contest: "contestou a estimativa de",
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

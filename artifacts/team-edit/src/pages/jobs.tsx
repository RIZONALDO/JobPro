import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  CalendarDays, CalendarPlus, Check, ChevronDown, ChevronRight, ExternalLink, Eye, Group, HandPalm, Hourglass,
  MoreHorizontal, Plus, Search, Timer, UserX, X,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { deadlineState, fmt, fmtDay, toLm, useBoard, type QTask } from "@/lib/fila";
import { Btn, Chip, HeadAction, LiveDot } from "@/components/fila/ui";
import { JobForm, type JobFormMode } from "@/components/fila/JobForm";
import { FollowersStack } from "@/components/fila/followers";
import { FilterPop, type Opt } from "@/components/fila/FilterPop";
import { AskDialog, STAGES, ago, clientColor, stageOf, type Ask, type StageKey } from "@/components/fila/job-shared";

/**
 * Jobs: o registro de todos os jobs. Responde "onde está o job X", "o que vence quando"
 * e "o que o cliente Y tem com a gente". Ordem e horário de cada editor ficam na Fila.
 *
 * Uma lista só, com escopo (em aberto, rascunhos, entregues, cancelados), resumo do pipeline,
 * atalhos de atenção, filtros e "agrupar por" (prazo, fase, cliente, editor, mês).
 */

interface Person { id: number; name: string; avatarUrl?: string | null }
interface Job {
  id: number; taskCode?: string; title: string; status: string; client: string | null; color: string;
  dueDate: string | null; folderUrl: string | null;
  revisionCount: number; reviewedAt: string | null; closedAt: string | null; assignee: Person | null; coordinator: Person | null;
  isOwn: boolean; isFollowing: boolean; followerIds: number[]; updatedAt: string;
}

type Scope = "aberto" | "rascunho" | "entregue" | "cancelado";
type Flag = "late" | "noEditor" | "waitClient" | "today";
type GroupBy = "prazo" | "fase" | "cliente" | "editor" | "mes" | "nada";
const H48 = 2 * 1440;
const OPEN: StageKey[] = ["fila", "edicao", "travado", "cliente"];
const STAGE_COLOR: Record<string, string> = { fila: "hsl(var(--primary) / 0.4)", edicao: "hsl(var(--primary))", travado: "#f59e0b", cliente: "#38bdf8" };
const GROUPS: Record<GroupBy, string> = { prazo: "Prazo", fase: "Fase", cliente: "Cliente", editor: "Editor", mes: "Mês", nada: "Sem grupos" };
const muted = "text-[hsl(var(--muted-foreground))]";
const day = (lm: number) => Math.floor(lm / 1440);

/** "hoje 18:30", "amanhã 18:30", "ontem 12:00" ou "qui 16/10 18:30" */
function relWhen(lm: number, now: number) {
  const d = day(lm) - day(now), hh = fmt(lm).slice(-5);
  return d === 0 ? `hoje ${hh}` : d === 1 ? `amanhã ${hh}` : d === -1 ? `ontem ${hh}` : fmt(lm);
}

export default function JobsPage() {
  usePageTitle("Jobs");
  const { user } = useAuth();
  if (user?.role === "editor") return <Redirect to="/fila" />;
  return <Jobs />;
}

function Jobs() {
  const { user } = useAuth();
  const { openTask } = useTaskModal();
  const { board } = useBoard();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const qs = useSearch();
  const [, navigate] = useLocation();

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const load = useCallback(() => { apiFetch<Job[]>("/api/tasks/overview?status=all").then(setJobs).catch(e => toast.error(e.message)); }, []);
  useEffect(load, [load]);
  useRealtime({ onTasksChanged: load });

  // filtros sobrevivem à ida e volta da página do job (por aba do navegador)
  const p0 = new URLSearchParams(window.location.search);
  const saved = useMemo(() => { try { return JSON.parse(sessionStorage.getItem("jobs:v2") ?? "null"); } catch { return null; } }, []) as Record<string, any> | null;
  const [scope, setScope] = useState<Scope>(p0.get("tab") === "rascunho" ? "rascunho" : saved?.scope ?? "aberto");
  const [phase, setPhase] = useState<StageKey | null>(saved?.phase ?? null);
  const [flag, setFlag] = useState<Flag | null>(saved?.flag ?? null);
  const [q, setQ] = useState<string>(saved?.q ?? "");
  const [clients, setClients] = useState<string[]>(saved?.clients ?? []);
  const [editors, setEditors] = useState<number[]>(saved?.editors ?? []);
  const [coords, setCoords] = useState<number[]>(saved?.coords ?? []);
  const [mine, setMine] = useState<boolean>(saved?.mine ?? user?.role === "coordinator");
  const [groupOpen, setGroupOpen] = useState<GroupBy>(p0.get("tab") === "calendario" || p0.get("group") === "prazo" ? "prazo" : saved?.groupOpen ?? "prazo");
  const [groupClosed, setGroupClosed] = useState<GroupBy>(saved?.groupClosed ?? "mes");
  const [dueDay, setDueDay] = useState<number | null>(saved?.dueDay ?? null);
  useEffect(() => {
    try { sessionStorage.setItem("jobs:v2", JSON.stringify({ scope, phase, flag, q, clients, editors, coords, mine, groupOpen, groupClosed, dueDay })); } catch { /* ok */ }
  }, [scope, phase, flag, q, clients, editors, coords, mine, groupOpen, groupClosed, dueDay]);
  const isOpenScope = scope === "aberto";
  const group = isOpenScope || scope === "rascunho" ? groupOpen : groupClosed;
  const setGroup = (g: GroupBy) => (isOpenScope || scope === "rascunho" ? setGroupOpen(g) : setGroupClosed(g));

  const [form, setForm] = useState<{ id?: number | null; mode: JobFormMode; due?: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  // links antigos: /tasks?highlight=ID vão para a página do job
  useEffect(() => { const h = new URLSearchParams(qs).get("highlight"); if (h) navigate(`/jobs/${h}`, { replace: true }); }, [qs, navigate]);

  // atalhos: "/" busca, "n" novo job
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "n") { e.preventDefault(); setForm({ mode: "new" }); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const live = useMemo(() => new Map((board?.tasks ?? []).map(t => [t.id, t])), [board]);
  const now = board?.now ?? toLm(new Date());
  const peopleById = useMemo(() => new Map((board?.people ?? []).map(p => [p.id, p])), [board]);

  // rascunho é pessoal: gestor só vê os seus
  const visible = useMemo(() => (jobs ?? []).filter(j => j.status !== "rascunho" || isSup || j.isOwn), [jobs, isSup]);

  const flagsOf = useCallback((j: Job): Flag[] => {
    const t = live.get(j.id), f: Flag[] = [];
    if (t && ["pending", "in_progress", "in_revision", "reopened"].includes(t.status) && deadlineState(t, now).tone === "bad") f.push("late");
    if (j.status === "pending" && !j.assignee) f.push("noEditor");
    if (j.status === "review" && t?.sentAt != null && now - t.sentAt > H48) f.push("waitClient");
    if (j.dueDate && OPEN.includes(stageOf(j.status).k) && j.status !== "review" && day(toLm(j.dueDate)) === day(now)) f.push("today");
    return f;
  }, [live, now]);

  // busca, pessoas e "só os meus" valem para tudo; escopo, fase, alerta e dia vêm depois
  const base = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visible.filter(j =>
      (!mine || j.isOwn || j.isFollowing) &&
      (!clients.length || clients.includes(j.client ?? "")) &&
      (!editors.length || editors.includes(j.assignee?.id ?? 0)) &&
      (!coords.length || coords.includes(j.coordinator?.id ?? 0)) &&
      (!term || [j.taskCode, j.title, j.client, j.assignee?.name, j.coordinator?.name].some(s => s?.toLowerCase().includes(term))));
  }, [visible, q, mine, clients, editors, coords]);

  const inScope = useCallback((j: Job, s: Scope) => {
    const k = stageOf(j.status).k;
    return s === "aberto" ? OPEN.includes(k) : k === s;
  }, []);
  const scopeCounts = useMemo(() => {
    const c: Record<Scope, number> = { aberto: 0, rascunho: 0, entregue: 0, cancelado: 0 };
    for (const j of base) for (const s of Object.keys(c) as Scope[]) if (inScope(j, s)) c[s]++;
    return c;
  }, [base, inScope]);
  const scoped = useMemo(() => base.filter(j => inScope(j, scope)), [base, scope, inScope]);
  const phaseCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of scoped) { const k = stageOf(j.status).k; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [scoped]);
  const flagCounts = useMemo(() => {
    const c: Record<Flag, number> = { late: 0, noEditor: 0, waitClient: 0, today: 0 };
    for (const j of scoped) for (const f of flagsOf(j)) c[f]++;
    return c;
  }, [scoped, flagsOf]);

  const shown = useMemo(() => {
    const list = scoped.filter(j =>
      (!isOpenScope || !phase || stageOf(j.status).k === phase) &&
      (!isOpenScope || !flag || flagsOf(j).includes(flag)) &&
      (!isOpenScope || dueDay == null || (j.dueDate != null && day(toLm(j.dueDate)) === dueDay)));
    const closed = scope === "entregue" || scope === "cancelado";
    const due = (j: Job) => (j.dueDate ? +new Date(j.dueDate) : Infinity);
    return list.sort((a, b) => closed ? +new Date(b.closedAt ?? b.updatedAt) - +new Date(a.closedAt ?? a.updatedAt) : due(a) - due(b));
  }, [scoped, isOpenScope, phase, flag, dueDay, flagsOf, scope]);

  // opções dos filtros, com quantos jobs cada uma tem no escopo atual
  const options = useMemo(() => {
    const inS = visible.filter(j => inScope(j, scope));
    const count = <K,>(key: (j: Job) => K | null | undefined) => { const m = new Map<K, number>(); inS.forEach(j => { const k = key(j); if (k != null) m.set(k, (m.get(k) ?? 0) + 1); }); return m; };
    const cl = count(j => j.client), ed = count(j => j.assignee?.id), co = count(j => j.coordinator?.id);
    const person = (id: number) => visible.map(j => (j.assignee?.id === id ? j.assignee : j.coordinator?.id === id ? j.coordinator : null)).find(Boolean)!;
    const allClients = [...new Set(visible.map(j => j.client).filter(Boolean) as string[])];
    const allEd = [...new Set(visible.map(j => j.assignee?.id).filter(Boolean) as number[])];
    const allCo = [...new Set(visible.map(j => j.coordinator?.id).filter(Boolean) as number[])];
    const sort = (a: Opt, b: Opt) => b.n - a.n || a.label.localeCompare(b.label);
    return {
      clients: allClients.map(c => ({ value: c, label: c, n: cl.get(c) ?? 0, color: clientColor(c) })).sort(sort),
      editors: allEd.map(id => { const p = person(id); return { value: id, label: p.name, n: ed.get(id) ?? 0, avatar: p }; }).sort(sort),
      coords: allCo.map(id => { const p = person(id); return { value: id, label: p.name, n: co.get(id) ?? 0, avatar: p }; }).sort(sort),
    };
  }, [visible, scope, inScope]);

  const narrowed = !!(q || clients.length || editors.length || coords.length || phase || flag || dueDay != null);
  const clearAll = () => { setQ(""); setClients([]); setEditors([]); setCoords([]); setPhase(null); setFlag(null); setDueDay(null); };
  const changeScope = (s: Scope) => {
    setScope(s); setPhase(null); setFlag(null); setDueDay(null);
    if ((s === "entregue" || s === "cancelado") && !["mes", "cliente", "editor", "nada"].includes(groupClosed)) setGroupClosed("mes");
  };
  const groupChoices: GroupBy[] = isOpenScope || scope === "rascunho" ? ["prazo", "fase", "cliente", "editor", "nada"] : ["mes", "cliente", "editor", "nada"];
  const label = scope === "aberto" ? (phase ? STAGES.find(s => s.k === phase)?.label : "Em aberto") : STAGES.find(s => s.k === scope)?.label;

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-4 pb-12">
      {/* cabeçalho */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">Jobs</h1>
          <p className={cn("mt-0.5 text-[13px]", muted)}>Todos os jobs, de qualquer fase. A ordem de cada editor fica na <Link href="/fila" className="font-semibold text-[hsl(var(--primary))] hover:underline">Fila</Link>.</p>
        </div>
        <HeadAction icon={Plus} label="Novo job" short="Novo" kbd="N" onClick={() => setForm({ mode: "new" })} />
      </header>

      {/* escopo */}
      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Escopo">
        <div className="flex min-w-max gap-5 border-b">
          {([["aberto", "Em aberto"], ["rascunho", "Rascunhos"], ["entregue", "Entregues"], ["cancelado", "Cancelados"]] as [Scope, string][])
            .filter(([k]) => k !== "rascunho" || scopeCounts.rascunho > 0 || scope === "rascunho")
            .map(([k, l]) => (
              <button key={k} type="button" onClick={() => changeScope(k)} aria-current={scope === k}
                className={cn("-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-[14px] font-semibold transition-colors",
                  scope === k ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
                {l}<span className={cn("rounded-full px-1.5 text-[11px] font-bold leading-5 tabular-nums", scope === k ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]")}>{scopeCounts[k]}</span>
              </button>
            ))}
        </div>
      </nav>

      {/* resumo do que está em aberto: pipeline + atenção */}
      {isOpenScope && jobs != null && (
        <Overview total={scoped.length} phaseCounts={phaseCounts} phase={phase} setPhase={setPhase}
          flagCounts={flagCounts} flag={flag} setFlag={f => setFlag(x => (x === f ? null : f))} />
      )}

      {/* busca, filtros e agrupamento */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1.5 lg:contents">
        <label className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
          <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", muted)} />
          <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }}
            placeholder="Buscar job, código, cliente ou pessoa"
            className="h-9 w-full rounded-xl border bg-[hsl(var(--card))] pl-9 pr-9 text-[13.5px] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
          {q ? <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className={cn("absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md hover:bg-[hsl(var(--accent))]", muted)}><X className="h-3.5 w-3.5" /></button>
            : <kbd className={cn("pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border px-1.5 text-[10.5px] max-lg:hidden", muted)}>/</kbd>}
        </label>
        <span className="lg:hidden"><GroupMenu value={group} choices={groupChoices} onChange={setGroup} /></span>
        </div>
        <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 lg:flex-1">
          <FilterPop label="Cliente" plural="clientes" options={options.clients} value={clients} onChange={setClients} />
          <FilterPop label="Editor" plural="editores" options={options.editors} value={editors} onChange={setEditors} />
          <FilterPop label="Gestor" plural="gestores" options={options.coords} value={coords} onChange={setCoords} />
          <button type="button" onClick={() => setMine(m => !m)} aria-pressed={mine} title="Jobs que você criou ou acompanha"
            className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
              mine ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]")}>
            {mine && <Check className="h-3.5 w-3.5" weight="bold" />}Só os meus
          </button>
          {narrowed && <button type="button" onClick={clearAll} className={cn("flex h-8 shrink-0 items-center gap-1 px-2 text-xs font-semibold hover:text-[hsl(var(--foreground))]", muted)}><X className="h-3 w-3" />Limpar</button>}
          <span className="flex-1" />
          <span className="max-lg:hidden"><GroupMenu value={group} choices={groupChoices} onChange={setGroup} /></span>
        </div>
      </div>

      {/* régua de prazos (agrupado por prazo) */}
      {isOpenScope && group === "prazo" && jobs != null && (
        <DueStrip jobs={scoped.filter(j => (!phase || stageOf(j.status).k === phase) && (!flag || flagsOf(j).includes(flag)))} now={now} value={dueDay} onChange={setDueDay}
          onNew={d => setForm({ mode: "new", due: d })} />
      )}

      {jobs == null ? <Skeleton />
        : !shown.length ? <Empty scope={scope} narrowed={narrowed} clear={clearAll} onNew={() => setForm({ mode: "new" })} />
        : <Groups jobs={shown} group={group} live={live} now={now} people={peopleById} flagsOf={flagsOf} canAct={j => isSup || j.isOwn}
            onOpen={id => openTask(id, { ids: shown.map(j => j.id), label })} onForm={(id, mode) => setForm({ id, mode })} onAsk={setAsk} reload={load} />}

      <JobForm open={!!form} onOpenChange={o => { if (!o) setForm(null); }} taskId={form?.id} mode={form?.mode} initialDueDate={form?.due} onSaved={load} />
      <AskDialog ask={ask} onClose={() => setAsk(null)} onDone={load} />
    </div>
  );
}

function GroupMenu({ value, choices, onChange }: { value: GroupBy; choices: GroupBy[]; onChange: (g: GroupBy) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Agrupar por: ${GROUPS[value]}`} className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[13px] font-semibold hover:bg-[hsl(var(--accent))] lg:h-8 lg:rounded-full lg:border-transparent", muted)}>
          <Group className="h-4 w-4" /><span className="max-sm:hidden">Agrupar:</span><span className="text-[hsl(var(--foreground))]">{GROUPS[value]}</span><ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {choices.map(g => <DropdownMenuItem key={g} onSelect={() => onChange(g)}><span className="flex-1">{GROUPS[g]}</span>{value === g && <Check className="h-3.5 w-3.5" />}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── resumo: barra do pipeline (clica para filtrar a fase) + o que precisa de atenção ── */
const FLAGS: { k: Flag; label: string; icon: typeof Timer; tone: "bad" | "warn" | "acc"; hint: string }[] = [
  { k: "late", label: "atrasados", icon: Timer, tone: "bad", hint: "O prazo de entrega passou e o job não foi entregue" },
  { k: "today", label: "vencem hoje", icon: CalendarDays, tone: "acc", hint: "O prazo de entrega é hoje" },
  { k: "noEditor", label: "sem editor", icon: UserX, tone: "warn", hint: "Esperando a supervisão escolher quem edita" },
  { k: "waitClient", label: "cliente sem resposta +2 dias", icon: Hourglass, tone: "warn", hint: "Enviado ao cliente há mais de 2 dias" },
];
const FLAG_TONE = {
  bad: { on: "border-rose-500/50 bg-rose-500/12 text-rose-600 dark:text-rose-400", icon: "text-rose-500" },
  warn: { on: "border-amber-500/50 bg-amber-500/12 text-amber-700 dark:text-amber-300", icon: "text-amber-500" },
  acc: { on: "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]", icon: "text-[hsl(var(--primary))]" },
};

function Overview({ total, phaseCounts, phase, setPhase, flagCounts, flag, setFlag }: {
  total: number; phaseCounts: Record<string, number>; phase: StageKey | null; setPhase: (p: StageKey | null) => void;
  flagCounts: Record<Flag, number>; flag: Flag | null; setFlag: (f: Flag) => void;
}) {
  const attention = FLAGS.filter(f => flagCounts[f.k] > 0 || flag === f.k);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-[hsl(var(--card))] p-3.5 sm:p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px]"><b className="text-[22px] font-bold tabular-nums leading-none">{total}</b> <span className={muted}>job{total === 1 ? "" : "s"} em aberto</span></p>
      </div>
      {total > 0 && (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]" role="img" aria-label="Jobs por fase">
          {OPEN.map(k => phaseCounts[k] ? (
            <span key={k} title={`${STAGES.find(s => s.k === k)?.label}: ${phaseCounts[k]}`} className={cn("h-full transition-[opacity,flex-grow] duration-300", phase && phase !== k && "opacity-25")}
              style={{ flexGrow: phaseCounts[k], background: STAGE_COLOR[k] }} />
          ) : null)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {OPEN.map(k => {
          const s = STAGES.find(x => x.k === k)!, on = phase === k;
          return (
            <button key={k} type="button" onClick={() => setPhase(on ? null : k)} aria-pressed={on} title={s.hint}
              className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
                on ? "border-[hsl(var(--primary)/0.6)] bg-[hsl(var(--primary)/0.08)]" : "border-transparent hover:bg-[hsl(var(--accent))]")}>
              <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STAGE_COLOR[k] }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.label}</span>
              <b className="text-[14px] tabular-nums">{phaseCounts[k] ?? 0}</b>
            </button>
          );
        })}
      </div>
      {attention.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className={cn("mr-1 text-xs font-semibold", muted)}>Precisa de atenção</span>
          {attention.map(f => {
            const on = flag === f.k, I = f.icon;
            return (
              <button key={f.k} type="button" onClick={() => setFlag(f.k)} aria-pressed={on} title={f.hint}
                className={cn("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors", on ? FLAG_TONE[f.tone].on : "hover:bg-[hsl(var(--accent))]")}>
                <I className={cn("h-3.5 w-3.5", !on && FLAG_TONE[f.tone].icon)} /><span className="tabular-nums">{flagCounts[f.k]}</span>{f.label}{on && <X className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── filtro com busca e várias escolhas ── */
/* ── régua dos próximos 14 dias: quantos prazos vencem em cada dia ── */
function DueStrip({ jobs, now, value, onChange, onNew }: { jobs: Job[]; now: number; value: number | null; onChange: (d: number | null) => void; onNew: (yyyyMmDd: string) => void }) {
  const today = day(now);
  const days = Array.from({ length: 14 }, (_, i) => today + i);
  const count = new Map<number, number>();
  let before = 0;
  for (const j of jobs) if (j.dueDate) { const d = day(toLm(j.dueDate)); if (d < today) before++; else count.set(d, (count.get(d) ?? 0) + 1); }
  const max = Math.max(1, ...days.map(d => count.get(d) ?? 0));
  const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  return (
    <section className="rounded-2xl border bg-[hsl(var(--card))] p-3 sm:p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">Prazos dos próximos 14 dias{before > 0 && <span className="font-normal text-rose-500"> · {before} com prazo vencido</span>}</p>
        {value != null
          ? <span className="flex items-center gap-1">
              <Btn size="sm" v="ghost" onClick={() => onNew(iso(value))} title="Criar job com este prazo"><CalendarPlus className="h-4 w-4" /><span className="max-sm:hidden">Novo job para {fmtDay(value)}</span></Btn>
              <Btn size="sm" v="ghost" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" />Ver todos</Btn>
            </span>
          : <span className={cn("text-xs max-sm:hidden", muted)}>Toque num dia para filtrar</span>}
      </div>
      <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5 sm:gap-1">
        {days.map(d => {
          const n = count.get(d) ?? 0, on = value === d, [wd, dm] = fmtDay(d).split(" ");
          const sunday = new Date(d * 86_400_000).getUTCDay() === 0;
          return (
            <button key={d} type="button" onClick={() => onChange(on ? null : d)} aria-pressed={on} title={`${fmtDay(d)}: ${n} prazo${n === 1 ? "" : "s"}`}
              className={cn("group flex min-w-0 flex-col items-center gap-1 rounded-lg px-0 py-1.5 transition-colors", on ? "bg-[hsl(var(--primary)/0.12)]" : "hover:bg-[hsl(var(--accent))]", sunday && !n && "opacity-40")}>
              <span className={cn("h-4 text-[10.5px] leading-4 tabular-nums", on ? "font-bold text-[hsl(var(--primary))]" : muted)}>{n || ""}</span>
              <span className="flex h-10 w-full max-w-[22px] items-end justify-center">
                <i className={cn("block w-full rounded-t-[4px] transition-all", n ? (on ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--primary)/0.45)] group-hover:bg-[hsl(var(--primary)/0.7)]") : "bg-[hsl(var(--muted))]")}
                  style={{ height: n ? `${Math.max(14, (n / max) * 100)}%` : 3 }} />
              </span>
              <span className={cn("text-[10px] uppercase leading-none", d === today ? "font-bold text-[hsl(var(--primary))]" : muted)}>{d === today ? "hoje" : wd}</span>
              <span className={cn("text-[10px] leading-none tabular-nums max-sm:hidden", muted)}>{dm.slice(0, 5)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── grupos ── */
interface GroupDef { key: string; title: React.ReactNode; lead?: React.ReactNode; meta?: React.ReactNode; tone?: "bad"; items: Job[] }

function Groups({ jobs, group, live, now, people, flagsOf, canAct, onOpen, onForm, onAsk, reload }: {
  jobs: Job[]; group: GroupBy; live: Map<number, QTask>; now: number; people: Map<number, { id: number; name: string; avatarUrl: string | null }>;
  flagsOf: (j: Job) => Flag[]; canAct: (j: Job) => boolean;
  onOpen: (id: number) => void; onForm: (id: number, mode: JobFormMode) => void; onAsk: (a: Ask) => void; reload: () => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Record<string, number>>({});
  const lateN = (list: Job[]) => list.filter(j => flagsOf(j).includes("late")).length;
  const openMeta = (list: Job[]) => { const l = lateN(list); return [l ? <span key="l" className="text-rose-500">{l} atrasado{l > 1 ? "s" : ""}</span> : null].filter(Boolean); };

  const groups = useMemo<GroupDef[]>(() => {
    const by = <K,>(key: (j: Job) => K) => { const m = new Map<K, Job[]>(); jobs.forEach(j => { const k = key(j); m.set(k, [...(m.get(k) ?? []), j]); }); return m; };
    if (group === "nada") return [{ key: "all", title: null, items: jobs }];
    if (group === "prazo") {
      const today = day(now), wd = new Date(today * 86_400_000).getUTCDay(), endWeek = today + (wd === 0 ? 0 : 7 - wd), endNext = endWeek + 7;
      const B: [string, string, (d: number | null) => boolean, "bad"?][] = [
        ["vencido", "Prazo vencido", d => d != null && d < today, "bad"], ["hoje", "Hoje", d => d === today], ["amanha", "Amanhã", d => d === today + 1],
        ["semana", "Ainda esta semana", d => d != null && d > today + 1 && d <= endWeek], ["proxima", "Semana que vem", d => d != null && d > endWeek && d <= endNext],
        ["depois", "Mais adiante", d => d != null && d > endNext], ["sem", "Sem prazo", d => d == null],
      ];
      const m = by(j => { const d = j.dueDate ? day(toLm(j.dueDate)) : null; return B.find(b => b[2](d))![0]; });
      return B.filter(b => m.has(b[0])).map(([k, t, , tone]) => ({ key: k, title: t, tone, items: m.get(k)!, meta: openMeta(m.get(k)!) }));
    }
    if (group === "fase") {
      const m = by(j => stageOf(j.status).k);
      return STAGES.filter(s => m.has(s.k)).map(s => ({ key: s.k, title: s.label, lead: <i className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLOR[s.k] ?? "hsl(var(--muted-foreground))" }} />, items: m.get(s.k)!, meta: [s.hint, ...openMeta(m.get(s.k)!)].filter(Boolean) }));
    }
    if (group === "cliente") {
      const m = by(j => j.client ?? "");
      return [...m].sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0]))).map(([c, items]) => ({
        key: `c:${c}`, title: c || "Sem cliente", lead: <i className="h-2.5 w-2.5 rounded-full" style={{ background: clientColor(c || null) }} />, items,
        meta: items.some(j => stageOf(j.status).open) ? openMeta(items) : [deliveredMeta(items)].filter(Boolean),
      }));
    }
    if (group === "editor") {
      const m = by(j => j.assignee?.id ?? 0);
      return [...m].sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[1].length - a[1].length)).map(([id, items]) => {
        const p = items[0].assignee;
        return { key: `e:${id}`, title: p?.name ?? "Sem editor", lead: p ? <AvatarDisplay name={p.name} avatarUrl={p.avatarUrl ?? null} size={22} /> : <UserX className={cn("h-4 w-4", muted)} />, items,
          meta: items.some(j => stageOf(j.status).open) ? openMeta(items) : [deliveredMeta(items)].filter(Boolean) };
      });
    }
    // mês em que fechou (entregues e cancelados)
    const m = by(j => (j.closedAt ?? j.updatedAt).slice(0, 7));
    return [...m].sort((a, b) => b[0].localeCompare(a[0])).map(([k, items]) => {
      const [y, mo] = k.split("-").map(Number);
      const name = new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
      return { key: k, title: name.charAt(0).toUpperCase() + name.slice(1), items, meta: [deliveredMeta(items)].filter(Boolean) };
    });
  }, [jobs, group, now, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setClosed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const head = "hidden grid-cols-[minmax(0,1fr)_132px_170px_110px_200px_36px] items-center gap-4 px-4 lg:grid";

  return (
    <div className="flex flex-col gap-3">
      {groups.map(g => {
        const isClosed = closed.has(g.key), lim = more[g.key] ?? 40;
        return (
          <section key={g.key} className="overflow-clip rounded-2xl border bg-[hsl(var(--card))]">
            {g.title != null && (
              <button type="button" onClick={() => toggle(g.key)} aria-expanded={!isClosed}
                className="sticky top-0 z-[1] flex w-full items-center gap-2.5 bg-[hsl(var(--card))] px-3.5 py-2.5 text-left hover:bg-[hsl(var(--accent)/0.5)] sm:px-4">
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", muted, !isClosed && "rotate-90")} />
                {g.lead}
                <b className={cn("truncate text-[14px] font-semibold", g.tone === "bad" && "text-rose-600 dark:text-rose-400")}>{g.title}</b>
                <span className={cn("rounded-full bg-[hsl(var(--muted))] px-1.5 text-[11px] font-bold leading-5 tabular-nums", muted)}>{g.items.length}</span>
                {g.meta && (g.meta as React.ReactNode[]).length > 0 && <span className={cn("ml-auto flex min-w-0 shrink items-center gap-2 truncate text-xs max-sm:hidden", muted)}>{(g.meta as React.ReactNode[]).map((x, i) => <span key={i} className="truncate">{i > 0 && "· "}{x}</span>)}</span>}
              </button>
            )}
            {!isClosed && <>
              <div className={cn(head, "border-y py-1.5 text-[11px] font-semibold uppercase tracking-wider", muted, g.title == null && "border-t-0")}>
                <span>Job</span><span>Fase</span><span>Editor · responsável</span><span>Fila</span><span>Prazo de entrega</span><span />
              </div>
              <ul className={cn(g.title != null && "max-lg:border-t")}>
                {g.items.slice(0, lim).map(j => (
                  <Row key={j.id} j={j} t={live.get(j.id)} now={now} people={people} flags={flagsOf(j)} canAct={canAct(j)} hidePhase={group === "fase"} hideEditor={group === "editor"}
                    onOpen={onOpen} onForm={onForm} onAsk={onAsk} reload={reload} />
                ))}
              </ul>
              {g.items.length > lim && <button type="button" onClick={() => setMore(m => ({ ...m, [g.key]: lim + 60 }))} className="w-full border-t py-2.5 text-[13px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--accent)/0.5)]">Mostrar mais {Math.min(60, g.items.length - lim)} de {g.items.length - lim}</button>}
            </>}
          </section>
        );
      })}
    </div>
  );
}

/** "8 entregues · 6 com 1ª versão no prazo" */
function deliveredMeta(items: Job[]) {
  const done = items.filter(j => j.status === "completed");
  if (!done.length) return null;
  const judged = done.filter(j => j.reviewedAt && j.dueDate), onTime = judged.filter(j => +new Date(j.reviewedAt!) <= +new Date(j.dueDate!)).length;
  return `${done.length} entregue${done.length > 1 ? "s" : ""}${judged.length ? ` · ${Math.round((onTime / judged.length) * 100)}% no prazo` : ""}`;
}

/* ── linha do job: cartão no celular, tabela no desktop ── */
function Row({ j, t, now, people, flags, canAct, hidePhase, hideEditor, onOpen, onForm, onAsk, reload }: {
  j: Job; t?: QTask; now: number; people: Map<number, { id: number; name: string; avatarUrl: string | null }>; flags: Flag[]; canAct: boolean; hidePhase: boolean; hideEditor: boolean;
  onOpen: (id: number) => void; onForm: (id: number, mode: JobFormMode) => void; onAsk: (a: Ask) => void; reload: () => void;
}) {
  const s = stageOf(j.status);
  const followers = j.followerIds.map(id => people.get(id)).filter(Boolean) as { id: number; name: string; avatarUrl: string | null }[];
  const when = whenOf(j, t, now);
  const phase = <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium"><i className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s.k] ?? (s.k === "entregue" ? "#10b981" : "#a1a1aa") }} />{s.label}</span>;
  const tags = (
    <>
      {t?.playing && <Chip tone="ok" className="text-[10.5px]"><LiveDot className="h-1.5 w-1.5" />editando agora</Chip>}
      {flags.includes("noEditor") && <Chip tone="warn" className="text-[10.5px]">sem editor</Chip>}
      {j.revisionCount > 0 && s.open && <Chip className="text-[10.5px]">alteração {j.revisionCount}</Chip>}
      {j.isFollowing && <Chip tone="acc" className="text-[10.5px]"><Eye className="h-3 w-3" />você acompanha</Chip>}
      {t?.blockReason && j.status === "paused" && <span className={cn("inline-flex min-w-0 items-center gap-1 truncate text-xs", muted)}><HandPalm className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="truncate">{t.blockReason}</span></span>}
    </>
  );
  const actions = <div onClick={e => e.stopPropagation()}><Actions j={j} t={t} canAct={canAct} onOpen={onOpen} onForm={onForm} onAsk={onAsk} reload={reload} /></div>;
  const open = () => onOpen(j.id);

  return (
    <li className="group relative border-b last:border-b-0">
      <i className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: clientColor(j.client) }} aria-hidden />

      {/* celular e tablet */}
      <div role="link" tabIndex={0} onClick={open} onKeyDown={e => e.key === "Enter" && open()} className="flex cursor-pointer flex-col gap-1.5 px-3.5 py-3 hover:bg-[hsl(var(--accent)/0.5)] sm:px-4 lg:hidden">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn("flex min-w-0 items-center gap-1.5 text-xs", muted)}><span className="font-mono">{j.taskCode}</span>{j.client && <><span>·</span><span className="truncate font-medium">{j.client}</span></>}</p>
            <p className="mt-0.5 line-clamp-2 text-[14.5px] font-semibold leading-snug">{j.title}</p>
          </div>
          <span className="-mr-1.5 -mt-1">{actions}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{!hidePhase && phase}{tags}</div>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
            {j.assignee ? <><AvatarDisplay name={j.assignee.name} avatarUrl={j.assignee.avatarUrl ?? null} size={20} /><span className="truncate">{j.assignee.name.split(" ")[0]}</span></> : <span className={muted}>sem editor</span>}
            {t?.pos != null && <span className={cn("shrink-0", muted)}>· {t.pos + 1}º na fila</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end text-right">
            <span className={cn("text-[12.5px] font-semibold", when.tone === "bad" && "text-rose-600 dark:text-rose-400")}>{when.main}</span>
            {when.chip ? <Chip tone={when.chip.tone} className="mt-0.5 text-[10.5px]">{when.chip.label}</Chip> : when.sub && <span className={cn("text-[11.5px]", when.subTone ?? muted)}>{when.sub}</span>}
          </span>
        </div>
      </div>

      {/* desktop */}
      <div role="link" tabIndex={0} onClick={open} onKeyDown={e => e.key === "Enter" && open()}
        className="hidden cursor-pointer grid-cols-[minmax(0,1fr)_132px_170px_110px_200px_36px] items-center gap-4 px-4 py-2.5 hover:bg-[hsl(var(--accent)/0.5)] lg:grid">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2"><span className={cn("shrink-0 font-mono text-[11px]", muted)}>{j.taskCode}</span><b className="truncate text-[13.5px] font-semibold">{j.title}</b></p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">{j.client && <span className={cn("font-medium", muted)}>{j.client}</span>}{tags}</div>
        </div>
        <div className="min-w-0">{phase}</div>
        <div className="flex min-w-0 items-center gap-2">
          {!hideEditor && (j.assignee ? <AvatarDisplay name={j.assignee.name} avatarUrl={j.assignee.avatarUrl ?? null} size={26} /> : <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-dashed"><UserX className={cn("h-3.5 w-3.5", muted)} /></span>)}
          <div className="min-w-0 text-xs leading-tight">
            {!hideEditor && <div className="truncate font-semibold">{j.assignee?.name ?? <span className={muted}>sem editor</span>}</div>}
            <div className={cn("flex min-w-0 items-center gap-1.5 truncate", muted)}><span className="truncate" title={j.coordinator ? `Responsável pelo job: ${j.coordinator.name}` : undefined}>{j.coordinator ? `resp. ${j.coordinator.name.split(" ")[0]}` : "—"}</span>{followers.length > 0 && <FollowersStack people={followers} />}</div>
          </div>
        </div>
        <span className={cn("text-xs", muted)}>{t?.playing ? "em edição" : t?.pos != null ? `${t.pos + 1}º na fila` : "—"}</span>
        <div className="min-w-0 text-xs">
          <p className={cn("truncate text-[13px] font-semibold", when.tone === "bad" && "text-rose-600 dark:text-rose-400")}>{when.main}</p>
          {when.chip ? <Chip tone={when.chip.tone} className="mt-0.5 text-[10.5px]">{when.chip.label}</Chip> : when.sub && <p className={cn("truncate", when.subTone ?? muted)}>{when.sub}</p>}
        </div>
        {actions}
      </div>
    </li>
  );
}

/** O que importa sobre o tempo depende da fase: prazo + a situação em uma linha. */
function whenOf(j: Job, t: QTask | undefined, now: number): { main: string; sub?: string; subTone?: string; tone?: "bad"; chip?: { label: string; tone: string } } {
  const due = j.dueDate ? toLm(j.dueDate) : null;
  const dueTxt = due != null ? relWhen(due, now) : "sem prazo";
  const closed = toLm(j.closedAt ?? j.updatedAt);
  if (j.status === "completed") {
    // pontualidade = quando a 1ª versão chegou ao cliente, não quando ele aprovou
    const sent = j.reviewedAt ? toLm(j.reviewedAt) : null;
    const late = sent != null && due != null && sent > due;
    return { main: `aprovado ${fmtDay(day(closed))}`, sub: sent != null && due != null ? (late ? `1ª versão ${ago(sent - due)} após o prazo` : "1ª versão no prazo") : due != null ? `prazo ${fmtDay(day(due))}` : undefined, subTone: late ? "text-rose-500" : sent != null && due != null ? "text-emerald-600 dark:text-emerald-400" : undefined };
  }
  if (j.status === "cancelled") return { main: `cancelado ${fmtDay(day(closed))}`, sub: due != null ? `prazo era ${fmtDay(day(due))}` : undefined };
  if (j.status === "rascunho") return { main: dueTxt, sub: "ainda não entrou na fila" };
  if (j.status === "review") {
    const since = t?.sentAt != null ? now - t.sentAt : null;
    return { main: dueTxt, sub: since != null ? `com o cliente há ${ago(since)}` : "com o cliente", subTone: since != null && since > H48 ? "text-amber-600 dark:text-amber-400" : undefined };
  }
  if (!t) return { main: dueTxt };
  const d = deadlineState(t, now);
  if (d.tone === "bad" || d.tone === "warn") return { main: dueTxt, tone: d.tone === "bad" && t.promised != null && t.promised <= now ? "bad" : undefined, chip: { label: d.label, tone: d.tone } };
  if (j.status === "paused") return { main: dueTxt, sub: "fora da fila até destravar" };
  if (!t.editorId) return { main: dueTxt, sub: "supervisão escolhendo editor" };
  return { main: dueTxt };
}

/* ── menu de ações por fase ── */
function Actions({ j, t, canAct, onOpen, onForm, onAsk, reload }: {
  j: Job; t?: QTask; canAct: boolean; onOpen: (id: number) => void; onForm: (id: number, mode: JobFormMode) => void; onAsk: (a: Ask) => void; reload: () => void;
}) {
  const s = stageOf(j.status).k;
  const call = async (p: Promise<unknown>, ok: string) => { try { const r = await p as { message?: string } | undefined; toast.success(r?.message ?? ok); reload(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Ações de ${j.title}`} className={cn("grid h-8 w-8 place-items-center rounded-lg hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]", muted)}><MoreHorizontal className="h-4 w-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        <DropdownMenuItem onClick={() => onOpen(j.id)}>Abrir job</DropdownMenuItem>
        {j.folderUrl && <DropdownMenuItem onClick={() => window.open(j.folderUrl!, "_blank", "noopener")}><ExternalLink className="h-3.5 w-3.5" />Abrir pasta</DropdownMenuItem>}
        {t && t.editorId && ["fila", "edicao"].includes(s) && <DropdownMenuItem asChild><Link href="/fila">Ver na fila do editor</Link></DropdownMenuItem>}
        {canAct && <>
          <DropdownMenuSeparator />
          {s === "rascunho" && <DropdownMenuItem onClick={() => onForm(j.id, "edit")}>Completar e colocar na fila</DropdownMenuItem>}
          {["fila", "edicao", "travado"].includes(s) && <DropdownMenuItem onClick={() => onForm(j.id, "edit")}>Editar job</DropdownMenuItem>}
          {["fila", "edicao", "travado"].includes(s) && <DropdownMenuItem onClick={() => onForm(j.id, "move")}>Passar para outro editor</DropdownMenuItem>}
          {s === "travado" && <DropdownMenuItem onClick={() => call(apiPost(`/api/queue/tasks/${j.id}/unblock`, {}), "Destravado")}>Destravar</DropdownMenuItem>}
          {s === "travado" && <DropdownMenuItem onClick={() => onAsk({ kind: "archive", job: j })}>Encerrar…</DropdownMenuItem>}
          {s === "cliente" && <>
            <DropdownMenuItem onClick={() => call(apiPost(`/api/queue/tasks/${j.id}/client-ok`, {}), "Job entregue")}>Cliente aprovou</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAsk({ kind: "change", job: j })}>Cliente pediu alteração…</DropdownMenuItem>
          </>}
          {s === "entregue" && <DropdownMenuItem onClick={() => onAsk({ kind: "reopen", job: j })}>Reabrir (nova rodada)…</DropdownMenuItem>}
          {s === "cancelado" && <DropdownMenuItem onClick={() => onAsk({ kind: "reactivate", job: j })}>Reativar…</DropdownMenuItem>}
          {["fila", "edicao", "travado", "cliente"].includes(s) && <DropdownMenuItem className="text-rose-500" onClick={() => onAsk({ kind: "cancel", job: j })}>Cancelar job…</DropdownMenuItem>}
          {(s === "rascunho" || s === "cancelado") && <DropdownMenuItem className="text-rose-500" onClick={() => onAsk({ kind: "delete", job: j })}>Excluir…</DropdownMenuItem>}
        </>}
        {!canAct && <p className={cn("px-2 py-1.5 text-xs", muted)}>Job de {j.coordinator?.name.split(" ")[0] ?? "outro gestor"}: só ele ou a supervisão mexem.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Skeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-[hsl(var(--card))]">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
          <div className="flex-1 space-y-2"><div className="h-3 w-24 rounded bg-[hsl(var(--muted))]" /><div className="h-3.5 w-2/3 rounded bg-[hsl(var(--muted))]" /></div>
          <div className="h-3 w-20 rounded bg-[hsl(var(--muted))]" />
        </div>
      ))}
    </div>
  );
}

function Empty({ scope, narrowed, clear, onNew }: { scope: Scope; narrowed: boolean; clear: () => void; onNew: () => void }) {
  const text = narrowed ? "Nenhum job com esses filtros." : { aberto: "Nenhum job em aberto. Tudo entregue!", rascunho: "Nenhum rascunho. Rascunhos salvos no Novo job aparecem aqui.", entregue: "Nenhum job entregue ainda.", cancelado: "Nenhum job cancelado." }[scope];
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-14 text-center">
      <p className={cn("text-sm", muted)}>{text}</p>
      {narrowed ? <Btn onClick={clear}><X className="h-4 w-4" />Limpar filtros</Btn> : scope === "aberto" && <Btn v="pri" onClick={onNew}><Plus className="h-4 w-4" />Novo job</Btn>}
    </div>
  );
}

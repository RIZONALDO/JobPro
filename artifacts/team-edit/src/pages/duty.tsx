/**
 * Plantões — escala de fim de semana e dias especiais.
 * Mesmo layout das outras telas (cabeçalho com resumo, abas segmentadas, blocos em grade).
 *  - Próximos (todos): este fim de semana em destaque, o próximo e o anterior, e os dias especiais que vêm aí.
 *  - Escala (supervisão): calendário do mês + coluna lateral com plantões por editor, fins de semana
 *    sem plantonista (com atalho para escalar) e faturamento por semana.
 *  - Sorteio e feriados (supervisão): alternância anual de 2 editores, feriados nacionais e dia especial manual.
 *  - E-mail (supervisão): envio do faturamento semanal (configuração, envio manual e histórico).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { usePageTitle } from "@/lib/use-page-title";
import { Widget } from "@/components/ui/widget";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  CalendarDays, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Mail, MoreHorizontal, Pencil,
  Plus, RefreshCw, Shield, Shuffle, Trash2, Users, X, AlertTriangle,
} from "@/lib/icons";

/* ── tipos ── */
interface Editor { id: number; name: string; avatarUrl: string | null; login: string }
interface ScheduleEditor { id: number; name: string; avatarUrl: string | null; scheduleId: number; slotType: string; inactive?: boolean; absence?: string | null }
interface WeekendSlot { weekendStart: string; editors: ScheduleEditor[]; notes: string | null }
interface UpcomingEditor { id: number; name: string; avatarUrl: string | null; inactive?: boolean; absence?: string | null }
interface UpcomingWeekend { weekendStart: string; satEditors: UpcomingEditor[]; sunEditors: UpcomingEditor[] }
interface HolidayEntry { dutyDate: string; notes: string | null; editors: UpcomingEditor[] }
interface UpcomingData { lastWeekend: UpcomingWeekend; thisWeekend: UpcomingWeekend; nextWeekend: UpcomingWeekend; upcomingHolidays: HolidayEntry[] }

/* ── datas ── */
const MON = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const p2 = (n: number) => String(n).padStart(2, "0");
const dt = (iso: string) => new Date(iso + "T12:00:00");
const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const todayIso = () => isoOf(new Date());
const fmtShort = (iso: string) => { const d = dt(iso); return `${DOW[d.getDay()]} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };
const addDays = (iso: string, n: number) => { const d = dt(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const isWeekend = (iso: string) => [0, 6].includes(dt(iso).getDay());
const first = (n: string) => n.split(" ")[0];
const muted = "text-[hsl(var(--muted-foreground))]";

/** Marca na escala: editor inativo (precisa trocar) ou ausente (férias/afastamento) na data. */
function DutyFlag({ ed }: { ed: { inactive?: boolean; absence?: string | null } }) {
  if (ed.inactive) return <span title="Editor inativo: substitua neste plantão" className="ml-1 rounded bg-[hsl(var(--muted))] px-1 py-px text-[9px] font-semibold uppercase leading-none">inativo</span>;
  if (ed.absence) return <span title={`${ed.absence} nesta data`} className="ml-1 rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase leading-none text-amber-700 dark:text-amber-400">{ed.absence}</span>;
  return null;
}

type Tab = "proximos" | "escala" | "sorteio" | "email";
const TABS: [Tab, string][] = [["escala", "Escala"], ["proximos", "Próximos"], ["sorteio", "Sorteio e feriados"], ["email", "E-mail"]];

export default function DutyPage() {
  usePageTitle("Plantões");
  const { user } = useAuth();
  const { settings } = useSettings();
  const appName = settings.company_name || "EditorPro";
  const canManage = ["admin", "supervisor"].includes(user?.role ?? "");
  const [tab, setTabState] = useState<Tab>(() => {
    try { const v = sessionStorage.getItem("duty:tab") as Tab | null; if (v && canManage) return v; } catch { /* ok */ }
    return canManage ? "escala" : "proximos";
  });
  const setTab = (t: Tab) => { setTabState(t); try { sessionStorage.setItem("duty:tab", t); } catch { /* ok */ } };

  const [upcoming, setUpcoming] = useState<UpcomingData | null>(null);
  const [upLoading, setUpLoading] = useState(true);
  const loadUpcoming = useCallback(() => {
    setUpLoading(true);
    apiFetch<UpcomingData>("/api/duty/upcoming").then(setUpcoming).catch(() => toast.error("Erro ao carregar escala")).finally(() => setUpLoading(false));
  }, []);
  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  const [editors, setEditors] = useState<Editor[]>([]);
  useEffect(() => {
    if (!canManage) return;
    apiFetch<(Editor & { role: string; status: string })[]>("/api/users")
      .then(all => setEditors(all.filter(u => u.role === "editor" && u.status === "active"))).catch(() => {});
  }, [canManage]);

  // resumo do cabeçalho
  const tw = upcoming?.thisWeekend;
  const twNames = tw ? [...new Map([...tw.satEditors, ...tw.sunEditors].map(e => [e.id, e])).values()] : [];
  const meOn = twNames.some(e => e.id === user?.id);
  const nextHol = upcoming?.upcomingHolidays.filter(h => h.dutyDate >= todayIso())[0];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px]", muted)}>Escala de plantões</p>
          <h1 className="text-2xl font-bold tracking-tight">Plantões</h1>
          <p className="mt-0.5 text-[13.5px]">
            {!upcoming ? <span className={muted}>Carregando…</span> : <>
              Este fim de semana: {twNames.length ? <b>{twNames.map(e => first(e.name)).join(" e ")}</b> : <span className="text-rose-500">sem plantonista</span>}
              {meOn && <span className="ml-1.5 rounded-full bg-[hsl(var(--primary)/0.12)] px-2 py-0.5 text-[11.5px] font-semibold text-[hsl(var(--primary))]">você está de plantão</span>}
              {nextHol && <span className={muted}> · próximo dia especial: {fmtShort(nextHol.dutyDate)}{nextHol.notes ? ` (${nextHol.notes})` : ""}</span>}
            </>}
          </p>
        </div>
        {canManage && (
          <div className="flex max-w-full overflow-x-auto rounded-lg border p-0.5 text-[13px] font-semibold">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                className={cn("h-8 shrink-0 rounded-md px-3", tab === k ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : cn(muted, "hover:text-[hsl(var(--foreground))]"))}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {tab === "proximos" || !canManage ? <Upcoming data={upcoming} loading={upLoading} me={user?.id} onReload={loadUpcoming} />
        : tab === "escala" ? <MonthSchedule editors={editors} appName={appName} onChanged={loadUpcoming} />
        : tab === "sorteio" ? <DrawAndHolidays editors={editors} onChanged={loadUpcoming} />
        : <EmailPanel />}
    </div>
  );
}

/* ═════════════════════════ PRÓXIMOS ═════════════════════════ */

function Upcoming({ data, loading, me, onReload }: { data: UpcomingData | null; loading: boolean; me?: number; onReload: () => void }) {
  if (loading && !data) return <div className="grid gap-4 lg:grid-cols-12"><div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))] lg:col-span-7" /><div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))] lg:col-span-5" /></div>;
  if (!data) return <p className={cn("py-16 text-center text-sm", muted)}>Não foi possível carregar a escala.</p>;
  const hols = data.upcomingHolidays.filter(h => h.dutyDate >= todayIso());
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7"><WeekendHero w={data.thisWeekend} me={me} onReload={onReload} loading={loading} /></div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
        <WeekendRow title="Próximo fim de semana" w={data.nextWeekend} me={me} />
        <WeekendRow title="Fim de semana passado" w={data.lastWeekend} me={me} past />
      </div>
      <div className="min-w-0 lg:col-span-12">
        <Widget icon={CalendarPlus} title="Dias especiais" sub="Feriados e eventos com plantão nas próximas semanas">
          {!hols.length ? <p className={cn("py-6 text-center text-[13.5px]", muted)}>Nenhum dia especial nas próximas semanas.</p> : (
            <ul className="-my-1 flex flex-col divide-y">
              {hols.map(h => {
                const mine = h.editors.some(e => e.id === me), d = dt(h.dutyDate);
                return (
                  <li key={h.dutyDate} className="flex items-center gap-4 py-3">
                    <span className="grid w-12 shrink-0 place-items-center rounded-xl border py-1.5 text-center">
                      <span className={cn("text-[10.5px] font-semibold uppercase", muted)}>{DOW[d.getDay()]}</span>
                      <span className="text-[18px] font-semibold leading-none tabular-nums">{p2(d.getDate())}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[14px] font-semibold">{h.notes ?? "Dia especial"}</b>
                      <span className={cn("text-[12.5px]", muted)}>{h.dutyDate === todayIso() ? "hoje" : `${p2(d.getDate())} de ${MON[d.getMonth()]}`}</span>
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {h.editors.length ? h.editors.map(e => <Person key={e.id} e={e} me={me} size={24} />) : <span className="text-[12.5px] text-rose-500">sem plantonista</span>}
                      {mine && <span className="rounded-full bg-[hsl(var(--primary)/0.12)] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--primary))]">você</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Widget>
      </div>
    </div>
  );
}

function Person({ e, me, size = 28 }: { e: UpcomingEditor; me?: number; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={size} />
      <span className="truncate text-[13px] font-medium">{first(e.name)}{e.id === me && <span className="font-normal text-[hsl(var(--primary))]"> (você)</span>}<DutyFlag ed={e} /></span>
    </span>
  );
}

const sameDays = (w: UpcomingWeekend) => w.satEditors.length > 0 && w.satEditors.length === w.sunEditors.length && w.satEditors.every((e, i) => e.id === w.sunEditors[i]?.id);
const wkLabel = (w: UpcomingWeekend) => { const s = dt(w.weekendStart), d = dt(addDays(w.weekendStart, 1)); return s.getMonth() === d.getMonth() ? `${p2(s.getDate())} e ${p2(d.getDate())} de ${MON[s.getMonth()]}` : `${p2(s.getDate())}/${p2(s.getMonth() + 1)} e ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };

function WeekendHero({ w, me, onReload, loading }: { w: UpcomingWeekend; me?: number; onReload: () => void; loading: boolean }) {
  const all = [...new Map([...w.satEditors, ...w.sunEditors].map(e => [e.id, e])).values()];
  const mine = all.some(e => e.id === me), same = sameDays(w);
  return (
    <section className={cn("flex h-full flex-col overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]", mine && "border-[hsl(var(--primary)/0.5)]")}>
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-[hsl(var(--background))]"><Shield className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-[14.5px] font-semibold leading-tight">Este fim de semana</h2><p className={cn("text-xs", muted)}>sábado e domingo</p></div>
        <button type="button" onClick={onReload} disabled={loading} aria-label="Atualizar" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))] disabled:opacity-50"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></button>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-6 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[30px] font-semibold leading-none tracking-tight sm:text-[38px]">{wkLabel(w)}</p>
          <p className={cn("mt-2 text-[13px]", muted)}>{dt(w.weekendStart).getFullYear()}</p>
        </div>
        {!all.length ? <p className="text-[14px] text-rose-500">Ninguém escalado ainda.</p> : same ? (
          <div className="flex flex-wrap gap-5">
            {w.satEditors.map(e => (
              <div key={e.id} className="flex flex-col items-center gap-2 text-center">
                <span className={cn("rounded-full", e.id === me && "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--card))]")}><AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={64} /></span>
                <span className="text-[14px] font-semibold">{first(e.name)}<DutyFlag ed={e} /></span>
                <span className={cn("-mt-1.5 text-[11.5px]", muted)}>sábado e domingo</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {([["Sábado", w.satEditors], ["Domingo", w.sunEditors]] as const).map(([l, es]) => (
              <div key={l} className="flex items-center gap-3">
                <span className={cn("w-16 text-[12px] font-semibold uppercase tracking-wider", muted)}>{l}</span>
                {es.length ? <span className="flex flex-wrap gap-3">{es.map(e => <Person key={e.id} e={e} me={me} size={34} />)}</span> : <span className="text-[13px] text-rose-500">a definir</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {mine && <div className="border-t bg-[hsl(var(--primary)/0.07)] px-5 py-2.5 text-[13px] font-semibold text-[hsl(var(--primary))]"><Shield className="mr-1.5 inline h-4 w-4 align-[-3px]" />Você está de plantão neste fim de semana</div>}
    </section>
  );
}

function WeekendRow({ title, w, me, past }: { title: string; w: UpcomingWeekend; me?: number; past?: boolean }) {
  const same = sameDays(w);
  return (
    <section className={cn("flex flex-1 flex-col overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]", past && "opacity-70")}>
      <header className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        <span className={cn("text-[13px] tabular-nums", muted)}>{wkLabel(w)}</span>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-2.5 px-4 py-4">
        {!w.satEditors.length && !w.sunEditors.length ? <p className={cn("text-[13px]", past ? muted : "text-rose-500")}>{past ? "Sem editor" : "A definir"}</p>
          : same ? <div className="flex flex-wrap gap-3">{w.satEditors.map(e => <Person key={e.id} e={e} me={me} size={30} />)}<span className={cn("self-center text-[12px]", muted)}>sábado e domingo</span></div>
          : ([["Sáb", w.satEditors], ["Dom", w.sunEditors]] as const).map(([l, es]) => (
            <div key={l} className="flex items-center gap-3">
              <span className={cn("w-9 text-[11.5px] font-semibold uppercase", muted)}>{l}</span>
              {es.length ? <span className="flex flex-wrap gap-3">{es.map(e => <Person key={e.id} e={e} me={me} size={26} />)}</span> : <span className={cn("text-[12.5px]", muted)}>a definir</span>}
            </div>
          ))}
      </div>
    </section>
  );
}

/* ═════════════════════════ ESCALA (calendário do mês) ═════════════════════════ */

function MonthSchedule({ editors, appName, onChanged }: { editors: Editor[]; appName: string; onChanged: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [schedule, setSchedule] = useState<WeekendSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [eventFor, setEventFor] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<{ iso: string; value: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<WeekendSlot[]>(`/api/duty?year=${year}&month=${month + 1}`).then(setSchedule)
      .catch(() => toast.error("Erro ao carregar escala")).finally(() => { if (!silent) setLoading(false); });
  }, [year, month]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(true); onChanged(); };

  const slotOf = (iso: string): WeekendSlot => schedule.find(s => s.weekendStart === iso) ?? { weekendStart: iso, editors: [], notes: null };

  /* ── ações (mesmas regras de antes: otimista, e volta atrás se a API recusar) ── */
  const removeEntry = async (scheduleId: number) => {
    const prev = schedule;
    setSchedule(s => s.map(slot => ({ ...slot, editors: slot.editors.filter(e => e.scheduleId !== scheduleId) })));
    try { await apiDelete(`/api/duty/${scheduleId}`); onChanged(); } catch { setSchedule(prev); toast.error("Erro ao remover"); }
  };
  const addEditor = async (iso: string, editorId: number, slotType: "normal" | "extra") => {
    const ed = editors.find(e => e.id === editorId); if (!ed) return;
    const prev = schedule, TEMP = -Date.now();
    const entry: ScheduleEditor = { id: editorId, name: ed.name, avatarUrl: ed.avatarUrl, scheduleId: TEMP, slotType };
    setSchedule(s => s.some(x => x.weekendStart === iso) ? s.map(x => x.weekendStart === iso ? { ...x, editors: [...x.editors, entry] } : x) : [...s, { weekendStart: iso, notes: null, editors: [entry] }]);
    try {
      const row = await apiPost<{ id: number; warning?: string | null } | null>("/api/duty", { weekendStart: iso, editorId, slotType, notes: null });
      if (!row) { changed(); return; }
      if (row.warning) toast.warning(`${row.warning}: escalado mesmo assim`, { duration: 7000 });
      setSchedule(s => s.map(x => ({ ...x, editors: x.editors.map(e => e.scheduleId === TEMP ? { ...e, scheduleId: row.id } : e) })));
      changed();
    } catch { setSchedule(prev); toast.error("Erro ao adicionar editor"); }
  };
  const updateNotes = async (iso: string, notes: string | null) => {
    const clean = notes ? notes.trim() || null : null, prev = schedule;
    setSchedule(s => s.map(x => x.weekendStart === iso ? { ...x, notes: clean } : x));
    try { await apiPatch("/api/duty/event-name", { weekendStart: iso, notes: clean }); changed(); } catch { setSchedule(prev); toast.error("Erro ao atualizar evento"); }
  };
  const createEvent = async (iso: string, name: string) => {
    const prev = schedule;
    setSchedule(s => s.some(x => x.weekendStart === iso) ? s.map(x => x.weekendStart === iso ? { ...x, notes: name || null } : x) : [...s, { weekendStart: iso, notes: name || null, editors: [] }]);
    try { await apiPost("/api/duty", { weekendStart: iso, notes: name || null }); changed(); } catch { setSchedule(prev); toast.error("Erro ao criar evento"); }
  };
  const resetAll = async () => {
    try { await apiDelete("/api/duty/all"); toast.success("Escala apagada"); setSchedule([]); onChanged(); } catch { toast.error("Erro ao resetar"); }
    setConfirmReset(false);
  };

  /* ── calendário ── */
  const daysIn = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // seg = 0
  const weeks = Math.ceil((offset + daysIn) / 7);
  const isoDay = (d: number) => `${year}-${p2(month + 1)}-${p2(d)}`;
  const go = (delta: number) => { const d = new Date(year, month + delta, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
  const today = todayIso();
  const monthDays = Array.from({ length: daysIn }, (_, i) => isoDay(i + 1));

  // resumo do mês: plantões por editor, fins de semana descobertos, semanas para faturar
  const perEditor = useMemo(() => {
    const m = new Map<number, { e: ScheduleEditor; normal: number; extra: number }>();
    for (const s of schedule) for (const e of s.editors) { const r = m.get(e.id) ?? { e, normal: 0, extra: 0 }; e.slotType === "extra" ? r.extra++ : r.normal++; m.set(e.id, r); }
    return [...m.values()].sort((a, b) => b.normal + b.extra - (a.normal + a.extra));
  }, [schedule]);
  const uncovered = monthDays.filter(iso => isWeekend(iso) && iso >= today && !slotOf(iso).editors.length);
  const flagged = schedule.flatMap(s => s.editors.filter(e => e.inactive || e.absence).map(e => ({ iso: s.weekendStart, e }))).filter(x => x.iso >= today);
  const weekList = Array.from({ length: weeks }, (_, w) => {
    const mon = new Date(year, month, 1 - offset + w * 7), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: isoOf(mon), end: isoOf(sun), label: `${p2(mon.getDate())}/${p2(mon.getMonth() + 1)} a ${p2(sun.getDate())}/${p2(sun.getMonth() + 1)}`, past: isoOf(sun) < today };
  });
  const lastWeek = (() => { const t = new Date(); const dow = t.getDay(); const mon = new Date(t); mon.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); return { start: isoOf(mon), end: isoOf(sun) }; })();
  const max = Math.max(1, ...perEditor.map(r => r.normal + r.extra));

  const DayAdd = ({ iso, className }: { iso: string; className?: string }) => {
    const slot = slotOf(iso), avail = editors.filter(e => !slot.editors.some(x => x.id === e.id));
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Adicionar em ${fmtShort(iso)}`} className={cn("grid h-6 w-6 place-items-center rounded-md hover:bg-[hsl(var(--accent))]", muted, className)}><Plus className="h-3.5 w-3.5" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[190px]">
          <p className={cn("px-2 py-1 text-[11px] font-semibold uppercase tracking-wider", muted)}>{fmtShort(iso)}</p>
          <DropdownMenuItem disabled={!avail.length} onSelect={() => setAddFor(iso)}><Users className="h-4 w-4" />Escalar plantonista</DropdownMenuItem>
          {!slot.notes && <DropdownMenuItem onSelect={() => setEventFor(iso)}><CalendarPlus className="h-4 w-4" />Marcar dia especial</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const Chip = ({ e }: { e: ScheduleEditor }) => (
    <span className="group/chip flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-1 hover:bg-[hsl(var(--accent)/0.7)]">
      <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={20} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{first(e.name)}<DutyFlag ed={e} /></span>
      {e.slotType === "extra" && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold uppercase text-amber-700 group-hover/chip:hidden dark:text-amber-400">extra</span>}
      <button type="button" aria-label={`Tirar ${first(e.name)}`} onClick={() => removeEntry(e.scheduleId)} className={cn("hidden shrink-0 rounded p-0.5 hover:text-rose-500 group-hover/chip:block", muted)}><X className="h-3 w-3" /></button>
    </span>
  );
  const EventLine = ({ iso, notes }: { iso: string; notes: string }) => editingNotes?.iso === iso ? (
    <input autoFocus value={editingNotes.value} onChange={e => setEditingNotes({ iso, value: e.target.value })}
      onKeyDown={e => { if (e.key === "Enter") { updateNotes(iso, editingNotes.value); setEditingNotes(null); } if (e.key === "Escape") setEditingNotes(null); }}
      onBlur={() => { updateNotes(iso, editingNotes.value); setEditingNotes(null); }}
      className="w-full rounded border border-amber-500/50 bg-transparent px-1 text-[11px] font-semibold text-amber-700 outline-none dark:text-amber-400" />
  ) : (
    <span className="group/ev flex items-center gap-0.5">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-amber-700 dark:text-amber-400" title={notes}>{notes}</span>
      <button type="button" aria-label="Renomear dia especial" onClick={() => setEditingNotes({ iso, value: notes })} className="hidden shrink-0 p-0.5 text-amber-600 group-hover/ev:block"><Pencil className="h-3 w-3" /></button>
      <button type="button" aria-label="Tirar dia especial" onClick={() => updateNotes(iso, null)} className="hidden shrink-0 p-0.5 text-amber-600 hover:text-rose-500 group-hover/ev:block"><X className="h-3 w-3" /></button>
    </span>
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
        {/* barra do mês */}
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-[hsl(var(--background))]"><CalendarDays className="h-4 w-4" /></span>
          <h2 className="min-w-0 flex-1 text-[16px] font-semibold capitalize">{MON[month]} <span className={cn("font-normal", muted)}>{year}</span></h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go(-1)} aria-label="Mês anterior" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} className="h-8 rounded-lg border px-3 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]">Hoje</button>
            <button type="button" onClick={() => go(1)} aria-label="Próximo mês" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><ChevronRight className="h-4 w-4" /></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Mais ações" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[230px]">
                <DropdownMenuItem onSelect={() => generateReceipt(lastWeek.start, lastWeek.end, appName)}><FileText className="h-4 w-4" />Faturamento da última semana</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirmReset(true)} className="text-rose-600 focus:text-rose-600"><Trash2 className="h-4 w-4" />Apagar toda a escala…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-[11.5px]", muted)}>
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded-full border-2 border-[hsl(var(--foreground)/0.4)]" />plantonista</span>
          <span className="inline-flex items-center gap-1.5"><span className="rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold uppercase text-amber-700 dark:text-amber-400">extra</span>plantão extra</span>
          <span className="inline-flex items-center gap-1.5"><span className="font-semibold text-amber-700 dark:text-amber-400">Nome</span>dia especial</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-rose-500" />fim de semana sem plantonista</span>
        </div>

        {loading ? <div className="h-[520px] animate-pulse bg-[hsl(var(--muted)/0.4)]" /> : <>
          {/* desktop: grade do mês */}
          <div className="hidden md:block">
            <div className="grid grid-cols-7 border-b">
              {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d, i) => <span key={d} className={cn("py-2 text-center text-[11px] font-semibold uppercase tracking-wider", muted, i >= 5 && "bg-[hsl(var(--foreground)/0.03)]")}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: weeks * 7 }, (_, c) => {
                const day = c - offset + 1, col = c % 7;
                const lastRow = c >= (weeks - 1) * 7;
                if (day < 1 || day > daysIn) return <div key={c} className={cn("min-h-[118px] border-r last:border-r-0 bg-[hsl(var(--muted)/0.25)]", !lastRow && "border-b", col === 6 && "border-r-0")} />;
                const iso = isoDay(day), slot = slotOf(iso), wknd = col >= 5, past = iso < today;
                const hole = wknd && !past && !slot.editors.length;
                return (
                  <div key={c} className={cn("group relative flex min-h-[118px] min-w-0 flex-col gap-1 border-r p-1.5", !lastRow && "border-b", col === 6 && "border-r-0", wknd && "bg-[hsl(var(--foreground)/0.03)]", past && "opacity-60")}>
                    <div className="flex items-center justify-between">
                      <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12.5px] font-semibold tabular-nums", iso === today ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]" : wknd ? "" : muted)}>{day}</span>
                      <DayAdd iso={iso} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
                    </div>
                    {slot.notes && <EventLine iso={iso} notes={slot.notes} />}
                    <div className="flex min-w-0 flex-col gap-0.5">{slot.editors.map(e => <Chip key={e.scheduleId} e={e} />)}</div>
                    {hole && <button type="button" onClick={() => setAddFor(iso)} className="mt-auto flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] text-rose-500 hover:bg-rose-500/10"><i className="h-1.5 w-1.5 rounded-full bg-rose-500" />sem plantonista</button>}
                  </div>
                );
              })}
            </div>
          </div>
          {/* celular: agenda (fins de semana e dias com plantão) */}
          <ul className="divide-y md:hidden">
            {monthDays.filter(iso => isWeekend(iso) || slotOf(iso).editors.length || slotOf(iso).notes).map(iso => {
              const slot = slotOf(iso), d = dt(iso), hole = isWeekend(iso) && iso >= today && !slot.editors.length;
              return (
                <li key={iso} className={cn("flex items-start gap-3 px-4 py-3", iso < today && "opacity-60")}>
                  <span className="grid w-11 shrink-0 place-items-center rounded-xl border py-1 text-center">
                    <span className={cn("text-[10px] font-semibold uppercase", muted)}>{DOW[d.getDay()]}</span>
                    <span className="text-[16px] font-semibold leading-none tabular-nums">{p2(d.getDate())}</span>
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {slot.notes && <EventLine iso={iso} notes={slot.notes} />}
                    {slot.editors.map(e => <Chip key={e.scheduleId} e={e} />)}
                    {hole && <button type="button" onClick={() => setAddFor(iso)} className="text-[12.5px] text-rose-500">Sem plantonista · escalar</button>}
                    {!slot.editors.length && !slot.notes && !hole && <span className={cn("text-[12.5px]", muted)}>—</span>}
                  </div>
                  <DayAdd iso={iso} />
                </li>
              );
            })}
          </ul>
        </>}
      </section>

      {/* coluna lateral: o que pede atenção no mês */}
      <aside className="flex min-w-0 flex-col gap-4">
        <Widget icon={AlertTriangle} title="Pede atenção" sub={uncovered.length + flagged.length ? "Fins de semana descobertos e plantonistas fora" : "Tudo coberto neste mês"}>
          {!uncovered.length && !flagged.length ? <p className={cn("text-[13px]", muted)}>Nenhum fim de semana sem plantonista daqui para frente.</p> : (
            <ul className="-my-1 flex flex-col divide-y">
              {uncovered.map(iso => (
                <li key={iso} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-[13px]"><i className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />{fmtShort(iso)}</span>
                  <button type="button" onClick={() => setAddFor(iso)} className="rounded-md border px-2 py-1 text-[12px] font-semibold hover:bg-[hsl(var(--accent))]">Escalar</button>
                </li>
              ))}
              {flagged.map(({ iso, e }) => (
                <li key={`${iso}${e.scheduleId}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-[13px]">{fmtShort(iso)} · {first(e.name)}<DutyFlag ed={e} /></span>
                  <button type="button" onClick={() => setAddFor(iso)} className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-semibold hover:bg-[hsl(var(--accent))]">Trocar</button>
                </li>
              ))}
            </ul>
          )}
        </Widget>
        <Widget icon={Users} title="Plantões no mês" sub="Por editor · ajuda a dividir de forma justa">
          {!perEditor.length ? <p className={cn("text-[13px]", muted)}>Ninguém escalado neste mês.</p> : (
            <ul className="flex flex-col gap-2.5">
              {perEditor.map(r => (
                <li key={r.e.id} className="flex items-center gap-2.5">
                  <AvatarDisplay name={r.e.name} avatarUrl={r.e.avatarUrl} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-[13px]"><b className="truncate font-medium">{first(r.e.name)}</b><span className="tabular-nums"><b className="font-semibold">{r.normal + r.extra}</b>{r.extra > 0 && <span className={cn("text-[11.5px]", muted)}> · {r.extra} extra</span>}</span></span>
                    <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                      <i className="block h-full bg-[hsl(var(--foreground)/0.55)]" style={{ width: `${(r.normal / max) * 100}%` }} />
                      <i className="block h-full bg-amber-500/80" style={{ width: `${(r.extra / max) * 100}%` }} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Widget>
        <Widget icon={FileText} title="Faturamento" sub="Documento por semana, pronto para imprimir">
          <ul className="-my-1 flex flex-col">
            {weekList.map((w, i) => (
              <li key={w.start}>
                <button type="button" disabled={!w.past} onClick={() => generateReceipt(w.start, w.end, appName)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.6)] disabled:opacity-40 disabled:hover:bg-transparent">
                  <span>Semana {i + 1} <span className={muted}>· {w.label}</span></span>
                  {w.start === lastWeek.start && <span className="rounded-full bg-[hsl(var(--muted))] px-1.5 text-[10.5px] font-semibold">última</span>}
                </button>
              </li>
            ))}
          </ul>
        </Widget>
      </aside>

      {/* escalar plantonista */}
      <Dialog open={!!addFor} onOpenChange={o => !o && setAddFor(null)}>
        <DialogContent className="max-w-sm gap-0 p-0">
          {addFor && (() => {
            const slot = slotOf(addFor), avail = editors.filter(e => !slot.editors.some(x => x.id === e.id));
            return <>
              <div className="border-b px-5 py-4"><DialogTitle className="text-base">Escalar plantonista</DialogTitle><p className={cn("text-[13px]", muted)}>{fmtShort(addFor)}{slot.notes ? ` · ${slot.notes}` : ""}</p></div>
              <ul className="max-h-80 overflow-y-auto">
                {!avail.length ? <li className={cn("py-8 text-center text-[13px]", muted)}>Todos os editores já estão escalados.</li> : avail.map(e => (
                  <li key={e.id} className="flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={30} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.name}</span>
                    <button type="button" onClick={() => { addEditor(addFor, e.id, "normal"); setAddFor(null); }} className="h-7 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-[hsl(var(--accent))]">Plantão</button>
                    <button type="button" onClick={() => { addEditor(addFor, e.id, "extra"); setAddFor(null); }} className="h-7 rounded-md border border-amber-500/40 px-2.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">Extra</button>
                  </li>
                ))}
              </ul>
            </>;
          })()}
        </DialogContent>
      </Dialog>

      {/* dia especial */}
      <EventDialog iso={eventFor} onClose={() => setEventFor(null)} onSave={(iso, name) => { createEvent(iso, name); setEventFor(null); }} />

      {/* apagar tudo */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Apagar toda a escala?</DialogTitle>
          <p className={cn("text-[13.5px]", muted)}>Remove todos os plantões e dias especiais de todos os meses. Não dá para desfazer.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmReset(false)} className="h-9 rounded-lg border px-4 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]">Cancelar</button>
            <button type="button" onClick={resetAll} className="h-9 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700">Apagar tudo</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventDialog({ iso, onClose, onSave }: { iso: string | null; onClose: () => void; onSave: (iso: string, name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(""), [iso]);
  return (
    <Dialog open={!!iso} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <div><DialogTitle className="text-base">Dia especial</DialogTitle>{iso && <p className={cn("text-[13px]", muted)}>{fmtShort(iso)}</p>}</div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && iso && name.trim() && onSave(iso, name.trim())}
          placeholder="Ex.: Feriado municipal, Círio" className="h-10 w-full rounded-lg border bg-[hsl(var(--background))] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]">Cancelar</button>
          <button type="button" disabled={!name.trim()} onClick={() => iso && onSave(iso, name.trim())} className="h-9 rounded-lg bg-[hsl(var(--primary))] px-4 text-[13px] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">Criar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════════ SORTEIO E FERIADOS ═════════════════════════ */

function DrawAndHolidays({ editors, onChanged }: { editors: Editor[]; onChanged: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  // sorteio
  const [pick, setPick] = useState<number[]>([]);
  const [replace, setReplace] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const toggle = (id: number) => setPick(p => p.includes(id) ? p.filter(x => x !== id) : p.length < 2 ? [...p, id] : p);
  const draw = async () => {
    if (pick.length !== 2) { toast.error("Selecione exatamente 2 editores"); return; }
    setDrawing(true);
    try { const { weeks } = await apiPost<{ weeks: number }>("/api/duty/sorteio", { year, editorIds: pick, replaceExisting: replace }); toast.success(`Sorteio feito: ${weeks} fins de semana escalados`); onChanged(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro ao realizar sorteio"); }
    finally { setDrawing(false); }
  };
  // prévia: os próximos 6 sábados do ano, alternando
  const preview = useMemo(() => {
    const out: string[] = []; const start = new Date(Math.max(Date.now(), new Date(year, 0, 1).getTime()));
    const d = new Date(start); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    while (out.length < 6 && d.getFullYear() === year) { out.push(isoOf(d)); d.setDate(d.getDate() + 7); }
    return out;
  }, [year]);

  // feriados nacionais
  const [national, setNational] = useState<{ date: string; name: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [natEditor, setNatEditor] = useState("");
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const fetchNational = async () => {
    setFetching(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
      const data: { date: string; name: string }[] = await res.json();
      const f = data.filter(h => dt(h.date).getDay() !== 6);
      setNational(f); setSel(new Set(f.map(h => h.date)));
    } catch { toast.error("Erro ao buscar feriados da BrasilAPI"); } finally { setFetching(false); }
  };
  const importNational = async () => {
    if (!natEditor) { toast.error("Escolha o editor"); return; }
    const list = national.filter(h => sel.has(h.date)); if (!list.length) { toast.error("Nenhum feriado selecionado"); return; }
    setImporting(true);
    try {
      await Promise.all(list.map(h => apiPost("/api/duty", { weekendStart: h.date, editorId: parseInt(natEditor, 10), notes: h.name })));
      toast.success(`${list.length} feriado${list.length > 1 ? "s" : ""} importado${list.length > 1 ? "s" : ""}`); setNational([]); setSel(new Set()); onChanged();
    } catch { toast.error("Erro ao importar feriados"); } finally { setImporting(false); }
  };

  // dia especial manual
  const [hDate, setHDate] = useState(""), [hName, setHName] = useState(""), [hEd, setHEd] = useState(""), [adding, setAdding] = useState(false);
  const addManual = async () => {
    if (!hDate || !hEd) { toast.error("Escolha a data e o editor"); return; }
    setAdding(true);
    try {
      const row = await apiPost<{ warning?: string | null } | null>("/api/duty", { weekendStart: hDate, editorId: parseInt(hEd, 10), notes: hName || null });
      toast.success("Dia especial adicionado"); if (row?.warning) toast.warning(`${row.warning}: escalado mesmo assim`, { duration: 7000 });
      setHDate(""); setHName(""); setHEd(""); onChanged();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro ao adicionar"); } finally { setAdding(false); }
  };

  const input = "h-9 w-full rounded-lg border bg-[hsl(var(--background))] px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";
  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-50";
  const yearSel = (
    <select value={year} onChange={e => setYear(Number(e.target.value))} className="h-8 rounded-lg border bg-[hsl(var(--background))] px-2 text-[13px] font-semibold">
      {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
  const A = editors.find(e => e.id === pick[0]), B = editors.find(e => e.id === pick[1]);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7">
        <Widget icon={Shuffle} title="Sorteio do ano" sub="Dois editores se alternam: cada um fica com sábado e domingo em semanas alternadas" right={yearSel}>
          <p className={cn("mb-2 text-[12px] font-semibold uppercase tracking-wider", muted)}>Escolha 2 editores</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {editors.map(e => {
              const i = pick.indexOf(e.id), on = i >= 0, off = !on && pick.length >= 2;
              return (
                <button key={e.id} type="button" onClick={() => toggle(e.id)} disabled={off} aria-pressed={on}
                  className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40", on ? "border-[hsl(var(--foreground)/0.5)] bg-[hsl(var(--foreground)/0.04)]" : "hover:bg-[hsl(var(--accent)/0.6)]")}>
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{e.name}</span>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full border text-[11.5px] font-semibold", on && "border-transparent bg-[hsl(var(--foreground))] text-[hsl(var(--background))]")}>{on ? i + 1 : ""}</span>
                </button>
              );
            })}
          </div>
          {A && B && (
            <div className="mt-4">
              <p className={cn("mb-2 text-[12px] font-semibold uppercase tracking-wider", muted)}>Como fica</p>
              <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {preview.map((iso, i) => { const e = i % 2 ? B : A; return (
                  <li key={iso} className="flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center">
                    <span className={cn("text-[11px] tabular-nums", muted)}>{fmtShort(iso).slice(4)}</span>
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={24} />
                    <span className="max-w-full truncate text-[12px] font-medium">{first(e.name)}</span>
                  </li>
                ); })}
              </ol>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[13px]"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} className="h-4 w-4 rounded" />Substituir fins de semana já escalados</label>
            <button type="button" onClick={draw} disabled={drawing || pick.length !== 2} className={cn(btn, "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]")}><Shuffle className={cn("h-4 w-4", drawing && "animate-spin")} />{drawing ? "Sorteando…" : `Sortear ${year}`}</button>
          </div>
        </Widget>
      </div>

      <div className="min-w-0 lg:col-span-5">
        <Widget icon={CalendarPlus} title="Dia especial" sub="Feriado local, evento ou cobertura fora do fim de semana">
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-semibold">Data<input type="date" value={hDate} onChange={e => setHDate(e.target.value)} className={input} /></label>
            <label className="grid gap-1 text-[12px] font-semibold">Nome<input value={hName} onChange={e => setHName(e.target.value)} placeholder="Ex.: Feriado municipal" className={input} /></label>
            <label className="grid gap-1 text-[12px] font-semibold">Plantonista
              <select value={hEd} onChange={e => setHEd(e.target.value)} className={input}><option value="">Escolher…</option>{editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            </label>
            <button type="button" onClick={addManual} disabled={adding || !hDate || !hEd} className={cn(btn, "border hover:bg-[hsl(var(--accent))]")}><Plus className="h-4 w-4" />{adding ? "Adicionando…" : "Adicionar"}</button>
          </div>
        </Widget>
      </div>

      <div className="min-w-0 lg:col-span-12">
        <Widget icon={CalendarDays} title="Feriados nacionais" sub="Busca na BrasilAPI os feriados do ano (fora de sábado) e escala um editor em todos de uma vez" right={yearSel}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={fetchNational} disabled={fetching} className={cn(btn, "border hover:bg-[hsl(var(--accent))]")}><RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} />{fetching ? "Buscando…" : `Buscar feriados de ${year}`}</button>
            {national.length > 0 && <>
              <select value={natEditor} onChange={e => setNatEditor(e.target.value)} className={cn(input, "w-auto")}><option value="">Plantonista…</option>{editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              <button type="button" onClick={importNational} disabled={importing || !sel.size || !natEditor} className={cn(btn, "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]")}><Plus className="h-4 w-4" />{importing ? "Importando…" : `Escalar ${sel.size}`}</button>
              <button type="button" onClick={() => setSel(sel.size === national.length ? new Set() : new Set(national.map(h => h.date)))} className={cn("text-[12.5px] font-semibold", muted)}>{sel.size === national.length ? "Desmarcar todos" : "Marcar todos"}</button>
            </>}
          </div>
          {national.length > 0 && (
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {national.map(h => {
                const on = sel.has(h.date);
                return (
                  <li key={h.date}>
                    <button type="button" onClick={() => setSel(s => { const n = new Set(s); n.has(h.date) ? n.delete(h.date) : n.add(h.date); return n; })} aria-pressed={on}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors", on ? "" : "opacity-50")}>
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on && "border-transparent bg-[hsl(var(--foreground))] text-[hsl(var(--background))]")}>{on && <Check className="h-3 w-3" weight="bold" />}</span>
                      <span className="w-[62px] shrink-0 tabular-nums font-semibold">{fmtShort(h.date)}</span>
                      <span className="min-w-0 truncate">{h.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Widget>
      </div>
    </div>
  );
}

/* ═════════════════════════ E-MAIL ═════════════════════════ */

type EmailCfg = { enabled: boolean; recipients: string[]; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; cronDay: number; cronHour: number; cronMinute: number };
type LogEntry = { id: number; sentAt: string; weekStart: string; weekEnd: string; recipients: string[]; status: string; errorMessage: string | null; trigger: string; senderName: string | null };
const DAYS_FULL = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function EmailPanel() {
  const [cfg, setCfg] = useState<EmailCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [weekIdx, setWeekIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ logs: LogEntry[]; total: number } | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [page, setPage] = useState(1), [fStatus, setFStatus] = useState(""), [fTrigger, setFTrigger] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { apiFetch<EmailCfg>("/api/duty/email-config").then(setCfg).catch(() => toast.error("Erro ao carregar a configuração de e-mail")); }, []);
  const loadLogs = useCallback((p: number, st: string, tr: string) => {
    setLogsLoading(true);
    const q = new URLSearchParams({ page: String(p), limit: "20" }); if (st) q.set("status", st); if (tr) q.set("trigger", tr);
    apiFetch<{ logs: LogEntry[]; total: number }>(`/api/duty/email-logs?${q}`).then(d => { setLogs(d); setPage(p); }).catch(() => toast.error("Erro ao carregar o histórico")).finally(() => setLogsLoading(false));
  }, []);
  useEffect(() => { loadLogs(1, "", ""); }, [loadLogs]);

  const save = async (next: EmailCfg) => {
    setCfg(next); setSaving(true);
    try { setCfg(await apiPut<EmailCfg>("/api/duty/email-config", next)); } catch { toast.error("Erro ao salvar"); } finally { setSaving(false); }
  };
  const weeks = useMemo(() => {
    const t = new Date(), dow = t.getDay(), lastMon = new Date(t); lastMon.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
    return Array.from({ length: 12 }, (_, i) => {
      const mon = new Date(lastMon); mon.setDate(lastMon.getDate() - i * 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: isoOf(mon), end: isoOf(sun), label: `${p2(mon.getDate())}/${p2(mon.getMonth() + 1)} a ${p2(sun.getDate())}/${p2(sun.getMonth() + 1)}/${sun.getFullYear()}`, last: i === 0 };
    });
  }, []);
  const wk = weeks[weekIdx] ?? weeks[0];
  const sendNow = async () => {
    setSending(true);
    try { await apiPost("/api/duty/email-send", { weekStart: wk.start, weekEnd: wk.end }); toast.success("Relatório enviado"); loadLogs(1, fStatus, fTrigger); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro ao enviar"); } finally { setSending(false); }
  };
  const preview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/duty/email-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: wk.start, weekEnd: wk.end }), credentials: "include" });
      setPreviewHtml(await res.text());
    } catch { toast.error("Erro ao gerar a prévia"); } finally { setPreviewing(false); }
  };
  const addEmail = () => {
    const v = newEmail.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast.error("E-mail inválido"); return; }
    if (!cfg || cfg.recipients.includes(v)) { toast.error("E-mail já cadastrado"); return; }
    setNewEmail(""); save({ ...cfg, recipients: [...cfg.recipients, v] });
  };
  const clearLogs = async () => {
    try { await apiDelete("/api/duty/email-logs"); setLogs({ logs: [], total: 0 }); toast.success("Histórico limpo"); } catch { toast.error("Erro ao limpar"); }
    setConfirmClear(false);
  };

  if (!cfg) return <div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" />;
  const input = "h-9 rounded-lg border bg-[hsl(var(--background))] px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";
  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / 20)) : 1;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
        <Widget icon={Mail} title="Enviar faturamento" sub="Relatório de plantões de uma semana, por e-mail">
          <div className="grid gap-3">
            <select value={weekIdx} onChange={e => setWeekIdx(Number(e.target.value))} className={cn(input, "w-full")}>
              {weeks.map((w, i) => <option key={w.start} value={i}>{w.label}{w.last ? " (semana passada)" : ""}</option>)}
            </select>
            {cfg.recipients.length ? <p className={cn("truncate text-[12.5px]", muted)}>Para: {cfg.recipients.join(", ")}</p>
              : <p className="text-[12.5px] text-amber-700 dark:text-amber-400">Cadastre ao menos um destinatário abaixo.</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={preview} disabled={previewing} className="h-10 rounded-lg border text-[13px] font-semibold hover:bg-[hsl(var(--accent))] disabled:opacity-50">{previewing ? "Gerando…" : "Pré-visualizar"}</button>
              <button type="button" onClick={sendNow} disabled={sending || !cfg.recipients.length} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] text-[13px] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"><Mail className="h-4 w-4" />{sending ? "Enviando…" : "Enviar agora"}</button>
            </div>
          </div>
        </Widget>

        <Widget icon={RefreshCw} title="Envio automático" sub="Manda o relatório da semana anterior sozinho, toda semana"
          right={<button type="button" role="switch" aria-checked={cfg.enabled} aria-label="Envio automático" onClick={() => save({ ...cfg, enabled: !cfg.enabled })}
            className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors", cfg.enabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]")}>
            <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", cfg.enabled ? "translate-x-5" : "translate-x-0")} />
          </button>}>
          {cfg.enabled ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              Toda
              <select value={cfg.cronDay} onChange={e => save({ ...cfg, cronDay: Number(e.target.value) })} className={input}>{DAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
              às
              <select value={cfg.cronHour} onChange={e => save({ ...cfg, cronHour: Number(e.target.value) })} className={cn(input, "w-20")}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{p2(h)}h</option>)}</select>
              <select value={cfg.cronMinute} onChange={e => save({ ...cfg, cronMinute: Number(e.target.value) })} className={cn(input, "w-24")}>{Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{p2(m)}min</option>)}</select>
              <span className={cn("text-[12px]", muted)}>(horário de Brasília)</span>
            </div>
          ) : <p className={cn("text-[13px]", muted)}>Desligado. Ligue para escolher o dia e a hora.</p>}
          {saving && <p className={cn("mt-2 text-[11.5px]", muted)}>Salvando…</p>}
        </Widget>

        <Widget icon={Users} title="Destinatários" sub={`${cfg.recipients.length} cadastrado${cfg.recipients.length === 1 ? "" : "s"}`}>
          <div className="flex gap-2">
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && addEmail()} placeholder="email@exemplo.com" className={cn(input, "min-w-0 flex-1")} />
            <button type="button" onClick={addEmail} aria-label="Adicionar destinatário" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><Plus className="h-4 w-4" /></button>
          </div>
          {cfg.recipients.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y">
              {cfg.recipients.map((r, i) => (
                <li key={r} className="flex items-center gap-2.5 py-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] text-[11px] font-semibold uppercase">{r[0]}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r}</span>
                  {i === 0 && <span className={cn("text-[11px]", muted)}>principal</span>}
                  <button type="button" aria-label={`Tirar ${r}`} onClick={() => save({ ...cfg, recipients: cfg.recipients.filter(x => x !== r) })} className={cn("rounded p-1 hover:text-rose-500", muted)}><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t pt-3">
            <button type="button" onClick={() => setSmtpOpen(o => !o)} className="flex w-full items-center justify-between text-[13px] font-semibold">
              <span>Servidor de saída (SMTP){cfg.smtpUser && !smtpOpen && <span className={cn("font-normal", muted)}> · {cfg.smtpUser}</span>}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", smtpOpen && "rotate-180", muted)} />
            </button>
            {smtpOpen && (
              <div className="mt-3 grid gap-2">
                <div className="flex gap-2">
                  <input value={cfg.smtpHost} onChange={e => setCfg({ ...cfg, smtpHost: e.target.value })} onBlur={e => save({ ...cfg, smtpHost: e.target.value })} placeholder="mail.seudominio.com.br" className={cn(input, "min-w-0 flex-1")} />
                  <input type="number" value={cfg.smtpPort} onChange={e => setCfg({ ...cfg, smtpPort: parseInt(e.target.value, 10) || 465 })} onBlur={e => save({ ...cfg, smtpPort: parseInt(e.target.value, 10) || 465 })} className={cn(input, "w-20")} />
                </div>
                <input value={cfg.smtpUser} onChange={e => setCfg({ ...cfg, smtpUser: e.target.value })} onBlur={e => save({ ...cfg, smtpUser: e.target.value })} placeholder="email@seudominio.com.br" className={input} />
                <input type="password" value={cfg.smtpPass} onChange={e => setCfg({ ...cfg, smtpPass: e.target.value })} onBlur={e => save({ ...cfg, smtpPass: e.target.value })} placeholder="Senha do e-mail" className={input} />
                <p className={cn("text-[11.5px]", muted)}>Porta 465 (SSL) ou 587 (TLS), com as credenciais do cPanel.</p>
              </div>
            )}
          </div>
        </Widget>
      </div>

      <div className="min-w-0 lg:col-span-7">
        <Widget icon={FileText} title="Histórico de envios" sub={logs ? `${logs.total} registro${logs.total === 1 ? "" : "s"}` : undefined}
          right={<div className="flex items-center gap-1.5">
            <select value={fStatus} onChange={e => { setFStatus(e.target.value); loadLogs(1, e.target.value, fTrigger); }} className="h-8 rounded-lg border bg-[hsl(var(--background))] px-2 text-[12.5px]"><option value="">Todos</option><option value="sent">Enviados</option><option value="failed">Com falha</option></select>
            <select value={fTrigger} onChange={e => { setFTrigger(e.target.value); loadLogs(1, fStatus, e.target.value); }} className="h-8 rounded-lg border bg-[hsl(var(--background))] px-2 text-[12.5px]"><option value="">Manual e automático</option><option value="manual">Manual</option><option value="auto">Automático</option></select>
            <button type="button" onClick={() => loadLogs(page, fStatus, fTrigger)} aria-label="Atualizar" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-[hsl(var(--accent))]"><RefreshCw className={cn("h-3.5 w-3.5", logsLoading && "animate-spin")} /></button>
            <button type="button" onClick={() => setConfirmClear(true)} aria-label="Limpar histórico" className={cn("grid h-8 w-8 place-items-center rounded-lg border hover:text-rose-500", muted)}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>}>
          {!logs || logsLoading && !logs.logs.length ? <div className="h-40 animate-pulse rounded-xl bg-[hsl(var(--muted)/0.5)]" /> : !logs.logs.length ? (
            <p className={cn("py-10 text-center text-[13px]", muted)}>Nenhum envio registrado.</p>
          ) : <>
            <ul className="-my-1 flex flex-col divide-y">
              {logs.logs.map(l => {
                const d = new Date(l.sentAt), ok = l.status === "sent";
                return (
                  <li key={l.id} className="flex items-start gap-3 py-2.5">
                    <i className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-rose-500")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]"><b className="font-semibold">Semana {fmtShort(l.weekStart).slice(4)} a {fmtShort(l.weekEnd).slice(4)}</b> <span className={muted}>· {ok ? "enviado" : "falhou"} · {l.trigger === "auto" ? "automático" : `manual${l.senderName ? ` por ${first(l.senderName)}` : ""}`}</span></p>
                      <p className={cn("truncate text-[12px]", muted)}>{p2(d.getDate())}/{p2(d.getMonth() + 1)} {p2(d.getHours())}:{p2(d.getMinutes())} · {(l.recipients ?? []).join(", ")}</p>
                      {l.errorMessage && <p className="mt-0.5 break-words text-[12px] text-rose-500">{l.errorMessage}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className={cn("text-[12px] tabular-nums", muted)}>página {page} de {totalPages}</span>
                <span className="flex gap-1">
                  <button type="button" disabled={page <= 1 || logsLoading} onClick={() => loadLogs(page - 1, fStatus, fTrigger)} aria-label="Página anterior" className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" disabled={page >= totalPages || logsLoading} onClick={() => loadLogs(page + 1, fStatus, fTrigger)} aria-label="Próxima página" className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </span>
              </div>
            )}
          </>}
        </Widget>
      </div>

      <Dialog open={previewHtml !== null} onOpenChange={o => !o && setPreviewHtml(null)}>
        <DialogContent className="flex h-[88dvh] w-[calc(100vw-24px)] max-w-3xl flex-col gap-3 p-4">
          <DialogTitle className="text-base">Prévia do e-mail · semana {wk.label}</DialogTitle>
          {previewHtml !== null && <iframe srcDoc={previewHtml} sandbox="allow-same-origin" title="Prévia do e-mail" className="min-h-0 w-full flex-1 rounded-xl border bg-white" />}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Limpar o histórico de envios?</DialogTitle>
          <p className={cn("text-[13.5px]", muted)}>Apaga todos os registros de envio. Os e-mails já enviados não são afetados.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmClear(false)} className="h-9 rounded-lg border px-4 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]">Cancelar</button>
            <button type="button" onClick={clearLogs} className="h-9 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700">Limpar</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═════════════════════════ FATURAMENTO (documento) ═════════════════════════ */

/** Abre o documento de faturamento da semana (seg a dom) numa aba nova, pronto para imprimir. */
async function generateReceipt(weekStart: string, weekEnd: string, appName: string) {
  const fmt = (iso: string) => { const d = dt(iso); return `${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()]}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
  // abre a aba já (o navegador bloqueia pop-up aberto depois de um await)
  const w = window.open("", "_blank");
  if (!w) { toast.error("O navegador bloqueou a nova aba. Permita pop-ups para este site."); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Faturamento de plantões</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#999}</style></head><body>Gerando faturamento…</body></html>`);
  w.document.close();
  try {
    const [sy, sm, ey, em] = [weekStart.slice(0, 4), weekStart.slice(5, 7), weekEnd.slice(0, 4), weekEnd.slice(5, 7)].map(Number);
    const raw = sy === ey && sm === em
      ? await apiFetch<WeekendSlot[]>(`/api/duty?year=${sy}&month=${sm}`)
      : (await Promise.all([apiFetch<WeekendSlot[]>(`/api/duty?year=${sy}&month=${sm}`), apiFetch<WeekendSlot[]>(`/api/duty?year=${ey}&month=${em}`)])).flat();
    const slots = raw.filter(s => s.weekendStart >= weekStart && s.weekendStart <= weekEnd);
    type REd = Map<number, { name: string; days: { date: string; event: string | null }[] }>;
    const grp = () => ({ normal: new Map() as REd, extra: new Map() as REd });
    const wkd = grp(), wday = grp();
    for (const s of slots) {
      const g = isWeekend(s.weekendStart) ? wkd : wday;
      for (const e of s.editors ?? []) { const m = e.slotType === "extra" ? g.extra : g.normal; if (!m.has(e.id)) m.set(e.id, { name: e.name, days: [] }); m.get(e.id)!.days.push({ date: s.weekendStart, event: s.notes?.trim() || null }); }
    }
    const count = (m: REd) => [...m.values()].reduce((a, e) => a + e.days.length, 0);
    const tW = count(wkd.normal) + count(wkd.extra), tD = count(wday.normal) + count(wday.extra), total = tW + tD;
    const badge = (l: string) => `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:5px">${l}</span>`;
    const rows = (m: REd) => [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(({ name, days }) =>
      `<tr><td>${name}</td><td style="color:#555;font-size:12px;line-height:1.9">${days.map(d => fmt(d.date) + (d.event ? badge(d.event) : "")).join("<br>")}</td><td style="text-align:right;font-weight:700">${days.length}</td></tr>`).join("");
    const section = (g: { normal: REd; extra: REd }, label: string, sub: number) => sub === 0 ? "" : [
      `<tr><td colspan="3" style="padding:14px 0 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em">${label}</td></tr>`,
      rows(g.normal),
      g.extra.size ? `<tr><td colspan="3" style="padding:10px 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#b45309">↳ Extra</td></tr>${rows(g.extra)}` : "",
      `<tr><td colspan="2" style="padding:6px 0 10px;font-size:11px;font-weight:600;color:#777">Subtotal</td><td style="padding:6px 0 10px;text-align:right;font-weight:700;color:#555">${sub}</td></tr>`,
    ].join("");
    const body = total === 0 ? `<tr><td colspan="3" style="padding:20px;text-align:center;color:#999;font-style:italic">Nenhum plantão nesta semana</td></tr>`
      : section(wkd, "Plantões especiais (sábado e domingo)", tW) + section(wday, "Outros plantões (segunda a sexta)", tD);
    w.document.open();
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${appName} · Faturamento de plantões · ${fmt(weekStart).slice(5)} a ${fmt(weekEnd).slice(5)}</title><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;padding:48px 56px;max-width:700px;margin:0 auto}
      .logo{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-bottom:32px}h1{font-size:26px;font-weight:800;letter-spacing:-.02em}
      .period{font-size:13px;color:#555;margin-top:6px}hr{border:none;border-top:2px solid #111;margin:28px 0 20px}table{width:100%;border-collapse:collapse}
      th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;padding:0 0 10px;text-align:left;border-bottom:1px solid #e5e5e5}
      td{padding:14px 0;vertical-align:top;border-bottom:1px solid #f0f0f0;font-size:14px}.t{display:flex;justify-content:space-between;align-items:baseline;margin-top:24px;padding-top:16px;border-top:2px solid #111}
      .t b{font-size:32px}.f{margin-top:48px;font-size:11px;color:#bbb;text-align:center}@media print{body{padding:0}}</style></head><body>
      <div class="logo">${appName}</div><h1>Faturamento de plantões da edição</h1><p class="period">Semana de ${fmt(weekStart)} a ${fmt(weekEnd)}</p><hr>
      <table><thead><tr><th>Editor</th><th>Datas</th><th style="text-align:right">Dias</th></tr></thead><tbody>${body}</tbody></table>
      <div class="t"><span>Total de plantões</span><b>${total}</b></div>
      <div class="f">Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })} · ${appName}</div></body></html>`);
    w.document.close();
  } catch { w.close(); toast.error("Erro ao gerar o faturamento"); }
}

import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Shield, CalendarPlus, X } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Editor { id: number; name: string; avatarUrl: string | null; login: string; }
interface ScheduleEditor { id: number; name: string; avatarUrl: string | null; scheduleId: number; }
interface WeekendSlot { weekendStart: string; editors: ScheduleEditor[]; notes: string | null; }

interface UpcomingEditor { id: number; name: string; avatarUrl: string | null; }
interface UpcomingWeekend { weekendStart: string; editors: UpcomingEditor[]; }
interface HolidayEntry { dutyDate: string; editors: UpcomingEditor[]; }
interface UpcomingData {
  lastWeekend: UpcomingWeekend;
  thisWeekend: UpcomingWeekend;
  nextWeekend: UpcomingWeekend;
  upcomingHolidays: HolidayEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MON_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MON_PT_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DAY_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function fmtWeekend(satIso: string): string {
  const sat = new Date(satIso + "T12:00:00");
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  return `${fmt(sat)} – ${fmt(sun)}`;
}

function fmtSingleDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const pad = (n: number) => String(n).padStart(2,"0");
  return `${DAY_PT[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
}

function fmtDay(satIso: string): { satLabel: string; sunLabel: string; month: string; year: number } {
  const sat = new Date(satIso + "T12:00:00");
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    satLabel: `Sáb ${pad(sat.getDate())}`,
    sunLabel: `Dom ${pad(sun.getDate())}`,
    month: MON_PT_SHORT[sat.getMonth()],
    year: sat.getFullYear(),
  };
}

function monthOf(iso: string): number {
  return new Date(iso + "T12:00:00").getMonth();
}

function isSaturdayDate(iso: string): boolean {
  return new Date(iso + "T12:00:00").getDay() === 6;
}

function isCurrentWeekend(satIso: string): boolean {
  const today = new Date(); today.setHours(0,0,0,0);
  const day = today.getDay();
  const diff = day === 0 ? -1 : 6 - day;
  const thisSat = new Date(today); thisSat.setDate(thisSat.getDate() + diff);
  return thisSat.toISOString().split("T")[0] === satIso;
}

function isToday(iso: string): boolean {
  return new Date().toISOString().split("T")[0] === iso;
}

// ── Weekend Card — side-by-side layout (non-admin view) ───────────────────────

type CardVariant = "past" | "current" | "next";

function WeekendCard({ variant, weekend, currentUserId }: {
  variant: CardVariant;
  weekend: UpcomingWeekend;
  currentUserId: number | undefined;
}) {
  const sat = new Date(weekend.weekendStart + "T12:00:00");
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const isOnDuty = weekend.editors.some(e => e.id === currentUserId);
  const isEmpty  = weekend.editors.length === 0;
  const c = variant === "current";
  const p = variant === "past";

  const label = c ? "Este fim de semana" : p ? "Fim de semana passado" : "Próximo fim de semana";

  return (
    <div className={`rounded-2xl flex flex-col bg-[hsl(var(--card))] overflow-hidden ${
      c ? "border-2 border-[hsl(var(--primary))] shadow-md"
        : p ? "border border-[hsl(var(--border))] opacity-55"
            : "border border-[hsl(var(--border))]"
    }`}>
      {/* top strip */}
      <div className={`h-0.5 ${c ? "bg-[hsl(var(--primary))]" : "bg-transparent"}`} />

      {/* label */}
      <div className={`${c ? "px-4 pt-3" : "px-3 pt-3"}`}>
        <p className={`font-semibold leading-tight ${
          c ? "text-[11px] text-[hsl(var(--primary))]" : "text-[10px] text-[hsl(var(--muted-foreground))]"
        }`}>
          {label}
        </p>
      </div>

      {/* dates */}
      <div className={`${c ? "px-4 pt-2.5 pb-3" : "px-3 pt-2 pb-2.5"}`}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1">
            <span className={`font-black tabular-nums tracking-tight leading-none ${c ? "text-4xl" : "text-2xl"}`}>
              {pad(sat.getDate())}
            </span>
            <span className={`font-semibold text-[hsl(var(--muted-foreground))] ${c ? "text-[11px]" : "text-[9px]"}`}>
              Sáb
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`font-black tabular-nums tracking-tight leading-none ${c ? "text-4xl" : "text-2xl"}`}>
              {pad(sun.getDate())}
            </span>
            <span className={`font-semibold text-[hsl(var(--muted-foreground))] ${c ? "text-[11px]" : "text-[9px]"}`}>
              Dom
            </span>
          </div>
          <p className={`text-[hsl(var(--muted-foreground))] mt-0.5 ${c ? "text-xs font-medium" : "text-[9px]"}`}>
            {MON_PT_SHORT[sat.getMonth()]} {sat.getFullYear()}
          </p>
        </div>
      </div>

      {/* divider */}
      <div className={`h-px bg-[hsl(var(--border))] ${c ? "mx-4" : "mx-3"}`} />

      {/* editor — portrait, avatar centrado */}
      <div className={`flex-1 flex flex-col items-center text-center ${c ? "px-3 py-4" : "px-2 py-3"}`}>
        {isEmpty ? (
          <p className={`text-[hsl(var(--muted-foreground))] ${c ? "text-xs" : "text-[10px]"}`}>
            {p ? "Sem editor" : "A definir"}
          </p>
        ) : (
          <div className={`flex w-full justify-center ${c ? "flex-row gap-4" : "flex-col gap-2"}`}>
            {weekend.editors.map(ed => (
              <div key={ed.id} className="flex flex-col items-center gap-1.5">
                <div className={c ? "ring-2 ring-[hsl(var(--primary))]/30 ring-offset-2 ring-offset-[hsl(var(--card))] rounded-full" : ""}>
                  <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={c ? 64 : 36} />
                </div>
                <div>
                  <p className={`font-semibold leading-tight ${c ? "text-sm" : "text-[11px]"}`}>
                    {ed.name.split(" ")[0]}
                  </p>
                  {ed.id === currentUserId && (
                    <p className={`font-bold text-[hsl(var(--primary))] ${c ? "text-[10px]" : "text-[9px]"}`}>
                      você
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* "você está de plantão" banner — current + on duty only */}
      {c && isOnDuty && (
        <div className="mx-4 mb-4 rounded-xl bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20 px-3 py-2 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-[hsl(var(--primary))] shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-wide text-[hsl(var(--primary))]">
            Você está de plantão
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DutyPage() {
  usePageTitle("Plantões");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── Admin state ──────────────────────────────────────────────────────────────
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [schedule,   setSchedule]   = useState<WeekendSlot[]>([]);
  const [editors,    setEditors]    = useState<Editor[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [month,           setMonth]           = useState(new Date().getMonth());
  const [adding,          setAdding]          = useState<Record<string, string>>({});
  const [generating,      setGenerating]      = useState(false);
  const [bulkEditorIds,   setBulkEditorIds]   = useState<number[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [holidayDate,     setHolidayDate]     = useState("");
  const [holidayEditorId, setHolidayEditorId] = useState("");
  const [addingHoliday,   setAddingHoliday]   = useState(false);

  // ── Non-admin state ──────────────────────────────────────────────────────────
  const [upcoming,     setUpcoming]     = useState<UpcomingData | null>(null);
  const [upcomingLoad, setUpcomingLoad] = useState(true);

  // ── Admin data loading ───────────────────────────────────────────────────────
  const loadSchedule = useCallback(() => {
    setLoading(true);
    apiFetch<WeekendSlot[]>(`/api/duty?year=${year}`)
      .then(setSchedule)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { if (isAdmin) loadSchedule(); }, [isAdmin, loadSchedule]);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<(Editor & { role: string; status: string })[]>("/api/users")
      .then(all => setEditors(all.filter(u => u.role === "editor" && u.status === "active")))
      .catch(() => {});
  }, [isAdmin]);

  // ── Non-admin data loading ───────────────────────────────────────────────────
  const loadUpcoming = useCallback(() => {
    setUpcomingLoad(true);
    apiFetch<UpcomingData>("/api/duty/upcoming")
      .then(setUpcoming)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => setUpcomingLoad(false));
  }, []);

  useEffect(() => {
    if (isAdmin) return;
    loadUpcoming();
  }, [isAdmin, loadUpcoming]);

  // ── Admin actions ────────────────────────────────────────────────────────────
  const toggleBulkEditor = (id: number) =>
    setBulkEditorIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const generate = async () => {
    if (bulkEditorIds.length === 0) { toast.error("Selecione ao menos um editor"); return; }
    setGenerating(true);
    try {
      const { weeks } = await apiPost<{ weeks: number; entries: number }>("/api/duty/bulk", {
        year, editorIds: bulkEditorIds, replaceExisting,
      });
      toast.success(`Escala gerada: ${weeks} fins de semana`);
      loadSchedule();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar escala");
    } finally {
      setGenerating(false);
    }
  };

  const addHolidayEntry = async () => {
    if (!holidayDate || !holidayEditorId) { toast.error("Selecione a data e o editor"); return; }
    setAddingHoliday(true);
    try {
      await apiPost("/api/duty", { weekendStart: holidayDate, editorId: parseInt(holidayEditorId, 10) });
      toast.success("Feriado adicionado");
      setHolidayDate(""); setHolidayEditorId("");
      loadSchedule();
    } catch {
      toast.error("Erro ao adicionar feriado");
    } finally {
      setAddingHoliday(false);
    }
  };

  const removeEntry = async (scheduleId: number) => {
    try {
      await apiDelete(`/api/duty/${scheduleId}`);
      loadSchedule();
    } catch {
      toast.error("Erro ao remover");
    }
  };

  const addEditor = async (weekendStart: string) => {
    const editorId = adding[weekendStart];
    if (!editorId) return;
    try {
      await apiPost("/api/duty", { weekendStart, editorId: parseInt(editorId, 10) });
      setAdding(prev => ({ ...prev, [weekendStart]: "" }));
      loadSchedule();
    } catch {
      toast.error("Erro ao adicionar editor");
    }
  };

  // ── Admin: index slots by month ──────────────────────────────────────────────
  const slotsByMonth = new Map<number, WeekendSlot[]>();
  for (const slot of schedule) {
    const m = monthOf(slot.weekendStart);
    if (!slotsByMonth.has(m)) slotsByMonth.set(m, []);
    slotsByMonth.get(m)!.push(slot);
  }

  const availableEditors = (slot: WeekendSlot) =>
    editors.filter(e => !slot.editors.some(se => se.id === e.id));

  // ── Non-admin view ───────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-bold">Escala de Plantões</h1>
          </div>
          <button
            onClick={loadUpcoming}
            disabled={upcomingLoad}
            className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${upcomingLoad ? "animate-spin" : ""}`} />
          </button>
        </div>

        {upcomingLoad ? (
          <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
            Carregando…
          </div>
        ) : upcoming ? (
          <div className="flex flex-col gap-4">
            {/* Three cards side by side */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <WeekendCard variant="past"    weekend={upcoming.lastWeekend} currentUserId={user?.id} />
              <WeekendCard variant="current" weekend={upcoming.thisWeekend} currentUserId={user?.id} />
              <WeekendCard variant="next"    weekend={upcoming.nextWeekend} currentUserId={user?.id} />
            </div>

            {/* Upcoming holidays */}
            {(upcoming.upcomingHolidays ?? []).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] mb-2 px-1">
                  Feriados / Dias especiais
                </p>
                <div className="rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-900/10 overflow-hidden">
                  {(upcoming.upcomingHolidays ?? []).map((h, i) => {
                    const isOnDuty = h.editors.some(e => e.id === user?.id);
                    return (
                      <div
                        key={h.dutyDate}
                        className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-amber-500/20" : ""}`}>
                        <div className="shrink-0">
                          <span className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                            {fmtSingleDate(h.dutyDate)}
                          </span>
                          {isToday(h.dutyDate) && (
                            <span className="ml-2 text-[10px] font-bold text-amber-600 uppercase tracking-wide">hoje</span>
                          )}
                        </div>
                        <div className="flex-1 flex flex-wrap items-center gap-2">
                          {h.editors.length === 0 ? (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</span>
                          ) : h.editors.map(ed => (
                            <div key={ed.id} className="flex items-center gap-1.5">
                              <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={22} />
                              <span className="text-sm font-medium">{ed.name.split(" ")[0]}</span>
                            </div>
                          ))}
                        </div>
                        {isOnDuty && (
                          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wide border border-amber-500/20">
                            <Shield className="h-3 w-3" /> você
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
            Não foi possível carregar a escala.
          </div>
        )}
      </div>
    );
  }

  // ── Admin: month navigation helpers ─────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const monthSlots = slotsByMonth.get(month) ?? [];

  // ── Admin view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h1 className="text-lg font-bold">Escala de Plantões</h1>
        </div>
        {/* Month + year selector */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={prevMonth}
            className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-center w-32 tabular-nums">
            {MON_PT[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Auto-gerar escala */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-2.5">
        <p className="text-xs font-semibold">Auto gerar — {year}</p>
        <div className="flex flex-wrap gap-1.5">
          {editors.map(e => {
            const sel = bulkEditorIds.includes(e.id);
            return (
              <button key={e.id} onClick={() => toggleBulkEditor(e.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  sel ? "bg-[hsl(var(--primary))] text-white border-transparent"
                      : "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50"
                }`}>
                <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={16} />
                {e.name.split(" ")[0]}
                {sel && <span className="opacity-80">✓</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={replaceExisting}
              onChange={e => setReplaceExisting(e.target.checked)} className="rounded" />
            Substituir existentes
          </label>
          <Button onClick={generate} disabled={generating || bulkEditorIds.length === 0}
            className="h-7 text-xs px-3 gap-1.5">
            <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Gerando…" : "Gerar"}
          </Button>
        </div>
      </div>

      {/* Feriado / dia especial */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-50/30 dark:bg-amber-900/10 p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <CalendarPlus className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs font-semibold">Feriado / dia especial</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-[hsl(var(--border))]
              bg-[hsl(var(--background))] focus:outline-none focus:border-amber-500 tabular-nums" />
          <select value={holidayEditorId} onChange={e => setHolidayEditorId(e.target.value)}
            className="h-8 pl-2.5 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
              bg-[hsl(var(--background))] appearance-none cursor-pointer focus:outline-none focus:border-amber-500">
            <option value="">Editor…</option>
            {editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <Button onClick={addHolidayEntry}
            disabled={addingHoliday || !holidayDate || !holidayEditorId}
            variant="outline"
            className="h-8 text-xs gap-1.5 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-900/20">
            <Plus className="h-3.5 w-3.5" />
            {addingHoliday ? "…" : "Adicionar"}
          </Button>
        </div>
      </div>

      {/* Month slots */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
          Carregando…
        </div>
      ) : monthSlots.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
          Nenhum plantão em {MON_PT[month].toLowerCase()}.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {monthSlots.map(slot => {
            const sat       = new Date(slot.weekendStart + "T12:00:00");
            const sun       = new Date(sat); sun.setDate(sun.getDate() + 1);
            const pad       = (n: number) => String(n).padStart(2, "0");
            const isSat     = isSaturdayDate(slot.weekendStart);
            const isCurrent = isSat ? isCurrentWeekend(slot.weekendStart) : isToday(slot.weekendStart);
            const avail     = availableEditors(slot);
            const addVal    = adding[slot.weekendStart] ?? "";

            return (
              <div
                key={slot.weekendStart}
                className={`rounded-2xl border bg-[hsl(var(--card))] overflow-hidden ${
                  isCurrent
                    ? "border-[hsl(var(--primary))]/50"
                    : !isSat
                    ? "border-amber-500/30"
                    : "border-[hsl(var(--border))]"
                }`}>

                {/* Top strip */}
                <div className={`h-0.5 ${isCurrent ? "bg-[hsl(var(--primary))]" : !isSat ? "bg-amber-400/50" : "bg-transparent"}`} />

                {/* Date header */}
                <div className={`flex items-center gap-4 px-4 pt-3 pb-2.5 ${!isSat ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
                  {isSat ? (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-3xl font-black tabular-nums leading-none ${isCurrent ? "text-[hsl(var(--primary))]" : ""}`}>
                          {pad(sat.getDate())}
                        </span>
                        <span className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">Sáb</span>
                      </div>
                      <span className="text-[hsl(var(--muted-foreground))] font-light text-lg leading-none">—</span>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-3xl font-black tabular-nums leading-none ${isCurrent ? "text-[hsl(var(--primary))]" : ""}`}>
                          {pad(sun.getDate())}
                        </span>
                        <span className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">Dom</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black tabular-nums leading-none text-amber-600 dark:text-amber-400">
                        {pad(sat.getDate())}
                      </span>
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][sat.getDay()]}
                      </span>
                      <span className="ml-1 text-[10px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                        feriado
                      </span>
                    </div>
                  )}
                  {isCurrent && (
                    <span className="ml-auto text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-wide">
                      este fim de semana
                    </span>
                  )}
                </div>

                {/* Editor cards */}
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap gap-1.5">
                    {slot.editors.map(ed => (
                      <div
                        key={ed.scheduleId}
                        className="relative flex flex-col items-center gap-1.5 px-3 pt-4 pb-2.5 rounded-xl
                          bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]
                          min-w-[60px] hover:border-[hsl(var(--primary))]/40 transition-colors group">
                        <button
                          onClick={() => removeEntry(ed.scheduleId)}
                          className="absolute top-1.5 right-1.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100
                            text-[hsl(var(--muted-foreground))] hover:text-destructive hover:bg-destructive/10 transition-all">
                          <X className="h-3 w-3" />
                        </button>
                        <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={32} />
                        <span className="text-[11px] font-semibold leading-none text-center">
                          {ed.name.split(" ")[0]}
                        </span>
                      </div>
                    ))}

                    {/* Add editor */}
                    {avail.length > 0 && (
                      <div className="relative flex flex-col items-center justify-center gap-1 px-2 pt-2 pb-2.5 rounded-xl
                        border border-dashed border-[hsl(var(--border))] min-w-[60px] min-h-[72px]
                        hover:border-[hsl(var(--primary))]/60 transition-colors">
                        {!addVal ? (
                          <>
                            <div className="w-8 h-8 rounded-full border-2 border-dashed border-[hsl(var(--border))]
                              flex items-center justify-center text-[hsl(var(--muted-foreground))]">
                              <Plus className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none">add</span>
                            <select
                              value={addVal}
                              onChange={e => setAdding(prev => ({ ...prev, [slot.weekendStart]: e.target.value }))}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                              <option value="">Selecionar…</option>
                              {avail.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none text-center px-1 truncate max-w-[56px]">
                              {avail.find(e => String(e.id) === addVal)?.name.split(" ")[0]}
                            </span>
                            <button
                              onClick={() => addEditor(slot.weekendStart)}
                              className="h-6 px-2 rounded-lg bg-[hsl(var(--primary))] text-white text-[10px] font-semibold hover:opacity-90">
                              ✓
                            </button>
                            <button
                              onClick={() => setAdding(prev => ({ ...prev, [slot.weekendStart]: "" }))}
                              className="text-[9px] text-[hsl(var(--muted-foreground))] hover:text-destructive">
                              cancelar
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
interface HolidayEntry { dutyDate: string; notes: string | null; editors: UpcomingEditor[]; }
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

function fmtSingleDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const pad = (n: number) => String(n).padStart(2,"0");
  return `${DAY_PT[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
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
        : "border border-[hsl(var(--border))] opacity-50"
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
  const [holidayName,     setHolidayName]     = useState("");
  const [holidayEditorId, setHolidayEditorId] = useState("");
  const [addingName,           setAddingName]           = useState<Record<string, string>>({});
  const [addingHoliday,        setAddingHoliday]        = useState(false);
  const [nationalHolidays,     setNationalHolidays]     = useState<{ date: string; name: string }[]>([]);
  const [selectedHolidayDates, setSelectedHolidayDates] = useState<Set<string>>(new Set());
  const [nationalEditorId,     setNationalEditorId]     = useState("");
  const [fetchingNational,     setFetchingNational]     = useState(false);
  const [importingNational,    setImportingNational]    = useState(false);
  const [resetting,            setResetting]            = useState(false);
  const [confirmReset,         setConfirmReset]         = useState(false);

  // ── Non-admin state ──────────────────────────────────────────────────────────
  const [upcoming,     setUpcoming]     = useState<UpcomingData | null>(null);
  const [upcomingLoad, setUpcomingLoad] = useState(true);

  // ── Admin data loading ───────────────────────────────────────────────────────
  const loadSchedule = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<WeekendSlot[]>(`/api/duty?year=${year}`)
      .then(setSchedule)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => { if (!silent) setLoading(false); });
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
      loadSchedule(true);
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
      await apiPost("/api/duty", { weekendStart: holidayDate, editorId: parseInt(holidayEditorId, 10), notes: holidayName || null });
      toast.success("Feriado adicionado");
      setHolidayDate(""); setHolidayName(""); setHolidayEditorId("");
      loadSchedule(true);
    } catch {
      toast.error("Erro ao adicionar feriado");
    } finally {
      setAddingHoliday(false);
    }
  };

  const removeEntry = async (scheduleId: number) => {
    try {
      await apiDelete(`/api/duty/${scheduleId}`);
      loadSchedule(true);
    } catch {
      toast.error("Erro ao remover");
    }
  };

  const addEditor = async (date: string) => {
    const editorId = adding[date];
    if (!editorId) return;
    const notes = addingName[date] || null;
    try {
      await apiPost("/api/duty", { weekendStart: date, editorId: parseInt(editorId, 10), notes });
      setAdding(prev => { const n = { ...prev }; delete n[date]; return n; });
      setAddingName(prev => { const n = { ...prev }; delete n[date]; return n; });
      loadSchedule(true);
    } catch {
      toast.error("Erro ao adicionar editor");
    }
  };

  const resetAll = async () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setResetting(true);
    try {
      await apiDelete("/api/duty/all");
      toast.success("Escala resetada");
      setSchedule([]);
    } catch {
      toast.error("Erro ao resetar");
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  const fetchNationalHolidays = async () => {
    setFetchingNational(true);
    try {
      const res  = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
      const data: { date: string; name: string }[] = await res.json();
      const filtered = data.filter(h => new Date(h.date + "T12:00:00").getDay() !== 6);
      setNationalHolidays(filtered);
      setSelectedHolidayDates(new Set(filtered.map(h => h.date)));
    } catch {
      toast.error("Erro ao buscar feriados da BrasilAPI");
    } finally {
      setFetchingNational(false);
    }
  };

  const importNationalHolidays = async () => {
    if (!nationalEditorId) { toast.error("Selecione um editor"); return; }
    const toImport = nationalHolidays.filter(h => selectedHolidayDates.has(h.date));
    if (toImport.length === 0) { toast.error("Nenhum feriado selecionado"); return; }
    setImportingNational(true);
    try {
      await Promise.all(toImport.map(h =>
        apiPost("/api/duty", { weekendStart: h.date, editorId: parseInt(nationalEditorId, 10), notes: h.name })
      ));
      toast.success(`${toImport.length} feriado${toImport.length > 1 ? "s" : ""} importado${toImport.length > 1 ? "s" : ""}`);
      setNationalHolidays([]);
      setSelectedHolidayDates(new Set());
      loadSchedule(true);
    } catch {
      toast.error("Erro ao importar feriados");
    } finally {
      setImportingNational(false);
    }
  };

  const toggleHoliday = (date: string) =>
    setSelectedHolidayDates(prev => {
      const n = new Set(prev);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });

  // ── Admin: index slots by month ──────────────────────────────────────────────
  const slotsByMonth = new Map<number, WeekendSlot[]>();
  for (const slot of schedule) {
    const m = monthOf(slot.weekendStart);
    if (!slotsByMonth.has(m)) slotsByMonth.set(m, []);
    slotsByMonth.get(m)!.push(slot);
  }

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

            {/* Upcoming holidays — only this week (Mon–Sun) */}
            {(() => {
              const _t = new Date();
              const _dow = _t.getDay();
              const _mon = new Date(_t); _mon.setDate(_t.getDate() + (_dow === 0 ? -6 : 1 - _dow));
              const _sun = new Date(_mon); _sun.setDate(_mon.getDate() + 6);
              const wkStart = _mon.toISOString().split("T")[0];
              const wkEnd   = _sun.toISOString().split("T")[0];
              const thisWeekHols = (upcoming.upcomingHolidays ?? []).filter(
                h => h.dutyDate >= wkStart && h.dutyDate <= wkEnd
              );
              if (thisWeekHols.length === 0) return null;
              return (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] mb-2 px-1">
                  Feriados / Dias especiais
                </p>
                <div className="rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-900/10 overflow-hidden">
                  {thisWeekHols.map((h, i) => {
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
                          {h.notes && (
                            <p className="text-[10px] text-amber-600/80 dark:text-amber-400/70 font-medium mt-0.5">{h.notes}</p>
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
              );
            })()}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
            Não foi possível carregar a escala.
          </div>
        )}
      </div>
    );
  }

  // ── Admin: slot lookup ──────────────────────────────────────────────────────
  const slotByDate = new Map(schedule.map(s => [s.weekendStart, s]));
  const getSlotOrEmpty = (iso: string): WeekendSlot =>
    slotByDate.get(iso) ?? { weekendStart: iso, editors: [], notes: null };

  // ── Admin: month navigation ──────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // ── Admin: calendar helpers ──────────────────────────────────────────────────
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0 … Sun=6
  const numWeeks       = Math.ceil((firstDayOffset + daysInMonth) / 7);
  const isoDay         = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // ── Admin view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h1 className="text-lg font-bold">Escala de Plantões</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Month navigation */}
          <div className="flex items-center gap-1.5">
            <button onClick={prevMonth}
              className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-center w-32 tabular-nums">
              {MON_PT[month]} {year}
            </span>
            <button onClick={nextMonth}
              className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {/* Reset button */}
          <button
            onClick={resetAll}
            disabled={resetting}
            onBlur={() => setConfirmReset(false)}
            className={`h-8 px-3 rounded-md text-xs font-semibold border transition-colors ${
              confirmReset
                ? "bg-destructive text-white border-destructive hover:opacity-90"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-destructive hover:text-destructive"
            }`}>
            {resetting ? "…" : confirmReset ? "Confirmar reset?" : "Resetar tudo"}
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

      {/* Feriados Nacionais */}
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-900/10 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CalendarPlus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <p className="text-xs font-semibold">Feriados Nacionais — {year}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={nationalEditorId} onChange={e => setNationalEditorId(e.target.value)}
              className="h-8 pl-2.5 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
                bg-[hsl(var(--background))] appearance-none cursor-pointer focus:outline-none focus:border-emerald-500">
              <option value="">Editor…</option>
              {editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <Button onClick={fetchNationalHolidays} disabled={fetchingNational} variant="outline"
              className="h-8 text-xs gap-1.5 border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              <RefreshCw className={`h-3.5 w-3.5 ${fetchingNational ? "animate-spin" : ""}`} />
              {fetchingNational ? "Buscando…" : "Buscar"}
            </Button>
            {nationalHolidays.length > 0 && (
              <Button onClick={importNationalHolidays} disabled={importingNational || selectedHolidayDates.size === 0}
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="h-3.5 w-3.5" />
                {importingNational ? "Importando…" : `Importar ${selectedHolidayDates.size}`}
              </Button>
            )}
          </div>
        </div>

        {nationalHolidays.length > 0 && (
          <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto pr-1">
            {nationalHolidays.map(h => {
              const d   = new Date(h.date + "T12:00:00");
              const sel = selectedHolidayDates.has(h.date);
              return (
                <label key={h.date}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                    sel
                      ? "border-emerald-400/50 bg-emerald-100/50 dark:bg-emerald-900/30"
                      : "border-transparent bg-[hsl(var(--muted))]/30 opacity-50"
                  }`}>
                  <input type="checkbox" checked={sel} onChange={() => toggleHoliday(h.date)}
                    className="accent-emerald-600 shrink-0" />
                  <span className="text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                    {String(d.getDate()).padStart(2,"0")}/{String(d.getMonth()+1).padStart(2,"0")}
                  </span>
                  <span className="text-[10px] font-medium truncate">{h.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Calendário */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
          Carregando…
        </div>
      ) : (
        <div>
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((d, i) => (
              <div key={d} className={`text-center py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-md ${
                i >= 5
                  ? "text-[hsl(var(--primary))]/70 bg-[hsl(var(--primary))]/5"
                  : "text-[hsl(var(--muted-foreground))]"
              }`}>
                {d}
              </div>
            ))}
          </div>

          {/* Week blocks — one card per week */}
          <div className="flex flex-col gap-4">
            {Array.from({ length: numWeeks }).map((_, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7 gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1.5">
                {Array.from({ length: 7 }).map((_, dayIdx) => {
                  const cellIdx   = weekIdx * 7 + dayIdx;
                  const day       = cellIdx - firstDayOffset + 1;

                  if (day < 1 || day > daysInMonth) {
                    return <div key={`e-${cellIdx}`} className="min-h-[130px] rounded-xl" />;
                  }

                  const iso       = isoDay(day);
                  const d         = new Date(iso + "T12:00:00");
                  const dow       = d.getDay();
                  const isSat     = dow === 6;
                  const isSun     = dow === 0;
                  const isWknd    = isSat || isSun;
                  const isTdy     = isToday(iso);
                  const isCurWknd = isSat && isCurrentWeekend(iso);
                  const slot      = getSlotOrEmpty(iso);
                  const hasEditors = slot.editors.length > 0;
                  const avail     = editors.filter(e => !slot.editors.some(se => se.id === e.id));
                  const isAddOpen = iso in adding;
                  const addVal    = adding[iso] ?? "";
                  const addName   = addingName[iso] ?? "";

                  return (
                    <div
                      key={iso}
                      className={`rounded-xl border flex flex-col p-1.5 min-h-[130px] transition-colors ${
                        isCurWknd
                          ? "border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/15"
                          : isWknd
                            ? "border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/8"
                            : hasEditors
                              ? "border-[hsl(var(--border))] bg-[hsl(var(--muted))]"
                              : "border-transparent bg-[hsl(var(--muted))]/20"
                      }`}
                    >
                      {/* Day number + add button */}
                      <div className="flex items-start justify-between mb-1">
                        <span className={`text-xs font-black tabular-nums leading-none ${
                          isTdy
                            ? "text-white bg-[hsl(var(--primary))] rounded-full w-5 h-5 flex items-center justify-center"
                            : isCurWknd
                              ? "text-[hsl(var(--primary))]"
                              : isWknd
                                ? "text-[hsl(var(--foreground))]"
                                : "text-[hsl(var(--muted-foreground))]"
                        }`}>
                          {day}
                        </span>
                        {!isAddOpen && avail.length > 0 && (
                          <button
                            onClick={() => setAdding(prev => ({ ...prev, [iso]: "" }))}
                            className={`h-4 w-4 rounded-full border border-dashed flex items-center justify-center transition-colors ${
                              isWknd
                                ? "border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]/50 hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
                                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-amber-400 hover:text-amber-500"
                            }`}>
                            <Plus className="h-2 w-2" />
                          </button>
                        )}
                      </div>

                      {/* Assigned editors */}
                      <div className="flex flex-col gap-0.5 flex-1">
                        {slot.editors.map(ed => (
                          <div key={ed.scheduleId} className="flex items-center gap-1.5 group">
                            <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={24} />
                            <span className="text-[11px] font-semibold leading-none truncate flex-1">
                              {ed.name.split(" ")[0]}
                            </span>
                            <button
                              onClick={() => removeEntry(ed.scheduleId)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[hsl(var(--muted-foreground))] hover:text-destructive">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                        {slot.notes && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium leading-tight truncate">
                            {slot.notes}
                          </span>
                        )}
                      </div>

                      {/* Inline add form */}
                      {isAddOpen && (
                        <div className="mt-1 flex flex-col gap-1">
                          {!isWknd && (
                            <input
                              type="text"
                              placeholder="Feriado…"
                              value={addName}
                              onChange={e => setAddingName(prev => ({ ...prev, [iso]: e.target.value }))}
                              className="w-full h-5 px-1 text-[9px] rounded border border-amber-300 dark:border-amber-700
                                bg-[hsl(var(--background))] focus:outline-none focus:border-amber-500"
                            />
                          )}
                          <select
                            value={addVal}
                            onChange={e => setAdding(prev => ({ ...prev, [iso]: e.target.value }))}
                            className="w-full h-5 pl-1 text-[9px] rounded border border-[hsl(var(--border))]
                              bg-[hsl(var(--background))] appearance-none cursor-pointer focus:outline-none">
                            <option value="">Editor…</option>
                            {avail.map(e => <option key={e.id} value={e.id}>{e.name.split(" ")[0]}</option>)}
                          </select>
                          <div className="flex gap-1">
                            <button
                              onClick={() => addEditor(iso)}
                              disabled={!addVal}
                              className={`flex-1 h-5 rounded text-[9px] font-bold text-white disabled:opacity-40 ${
                                isWknd ? "bg-[hsl(var(--primary))] hover:opacity-90" : "bg-amber-500 hover:bg-amber-600"
                              }`}>
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setAdding(prev => { const n = { ...prev }; delete n[iso]; return n; });
                                setAddingName(prev => { const n = { ...prev }; delete n[iso]; return n; });
                              }}
                              className="h-5 w-5 shrink-0 rounded flex items-center justify-center border border-[hsl(var(--border))]
                                text-[hsl(var(--muted-foreground))] hover:text-destructive transition-colors">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

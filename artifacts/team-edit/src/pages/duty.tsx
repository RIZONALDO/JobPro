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

function getISOWeek(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}

// ── Weekend Card — championship style (non-admin view) ─────────────────────────

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
  const week     = getISOWeek(weekend.weekendStart);
  const satDay   = pad(sat.getDate());
  const sunDay   = pad(sun.getDate());
  const monthYear = `${MON_PT[sat.getMonth()]} ${sat.getFullYear()}`;

  const cfg = {
    past: {
      strip:      "bg-[hsl(var(--muted))]/60",
      dot:        "bg-[hsl(var(--muted-foreground))]",
      status:     "PASSADO",
      statusCls:  "text-[hsl(var(--muted-foreground))]",
      rdCls:      "text-[hsl(var(--muted-foreground))]",
      wrapCls:    "border-[hsl(var(--border))] opacity-65",
      dateSz:     "text-xl",
      avatarSz:   28 as number,
    },
    current: {
      strip:      "bg-[hsl(var(--primary))]",
      dot:        "bg-green-500 animate-pulse",
      status:     "AO VIVO",
      statusCls:  "text-green-600 dark:text-green-400",
      rdCls:      "text-[hsl(var(--primary))]",
      wrapCls:    "border-[hsl(var(--primary))] border-2 shadow-lg",
      dateSz:     "text-5xl",
      avatarSz:   44 as number,
    },
    next: {
      strip:      "bg-[hsl(var(--primary))]/30",
      dot:        "bg-[hsl(var(--primary))]/70",
      status:     "PRÓXIMO",
      statusCls:  "text-[hsl(var(--primary))]",
      rdCls:      "text-[hsl(var(--primary))]/80",
      wrapCls:    "border-[hsl(var(--border))]",
      dateSz:     "text-3xl",
      avatarSz:   34 as number,
    },
  }[variant];

  return (
    <div className={`rounded-2xl border overflow-hidden bg-[hsl(var(--card))] ${cfg.wrapCls}`}>
      {/* accent strip */}
      <div className={`h-1 ${cfg.strip}`} />

      {/* status bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
          <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${cfg.statusCls}`}>
            {cfg.status}
          </span>
        </div>
        <span className={`text-[11px] font-black tabular-nums ${cfg.rdCls}`}>RD {week}</span>
      </div>

      {/* date display */}
      <div className="px-4 pb-3">
        <div className="flex items-end gap-2.5">
          <div className="flex items-baseline gap-1">
            <span className={`font-black tabular-nums tracking-tight leading-none ${cfg.dateSz}`}>{satDay}</span>
            <span className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-0.5">Sáb</span>
          </div>
          <span className={`text-[hsl(var(--muted-foreground))] font-bold leading-none mb-0.5 ${variant === "current" ? "text-2xl" : "text-sm"}`}>—</span>
          <div className="flex items-baseline gap-1">
            <span className={`font-black tabular-nums tracking-tight leading-none ${cfg.dateSz}`}>{sunDay}</span>
            <span className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-0.5">Dom</span>
          </div>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] font-medium mt-1">{monthYear}</p>
      </div>

      {/* divider */}
      <div className="mx-4 h-px bg-[hsl(var(--border))]" />

      {/* player section */}
      <div className={`px-4 ${variant === "current" ? "pt-4 pb-3" : "pt-3 pb-3"}`}>
        {isEmpty ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))] text-center py-2">
            {variant === "past" ? "Sem editor escalado" : "Nenhum editor escalado ainda"}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {weekend.editors.map(ed => (
              <div
                key={ed.id}
                className={`flex items-center gap-3 ${
                  variant === "current"
                    ? "rounded-xl bg-[hsl(var(--muted))]/30 px-3 py-2.5"
                    : ""
                }`}>
                <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={cfg.avatarSz} />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold leading-tight truncate ${variant === "current" ? "text-sm" : "text-xs"}`}>
                    {ed.name}
                  </p>
                  {variant === "current" && (
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Editor de plantão</p>
                  )}
                </div>
                {ed.id === currentUserId && (
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-[hsl(var(--primary))]">
                    VOCÊ
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* "você está de plantão" banner — current only */}
      {variant === "current" && isOnDuty && (
        <div className="mx-4 mb-4 rounded-xl bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/30 px-3 py-2 flex items-center gap-2">
          <Shield className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
          <span className="text-xs font-black uppercase tracking-wide text-[hsl(var(--primary))]">
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
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bulkEditorIds,   setBulkEditorIds]   = useState<number[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [adding, setAdding] = useState<Record<string, string>>({});

  // Admin holiday add form
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

  const addHolidayEntry = async () => {
    if (!holidayDate || !holidayEditorId) {
      toast.error("Selecione a data e o editor"); return;
    }
    setAddingHoliday(true);
    try {
      await apiPost("/api/duty", { weekendStart: holidayDate, editorId: parseInt(holidayEditorId, 10) });
      toast.success("Editor adicionado ao plantão de feriado");
      setHolidayDate("");
      setHolidayEditorId("");
      loadSchedule();
    } catch {
      toast.error("Erro ao adicionar feriado");
    } finally {
      setAddingHoliday(false);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-bold">Escala de Plantões</h1>
          </div>
          <button
            onClick={loadUpcoming}
            disabled={upcomingLoad}
            className="h-8 w-8 rounded-md border flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${upcomingLoad ? "animate-spin" : ""}`} />
          </button>
        </div>

        {upcomingLoad ? (
          <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
            Carregando…
          </div>
        ) : upcoming ? (
          <div className="flex flex-col gap-4">
            <WeekendCard variant="past"    weekend={upcoming.lastWeekend} currentUserId={user?.id} />
            <WeekendCard variant="current" weekend={upcoming.thisWeekend} currentUserId={user?.id} />
            <WeekendCard variant="next"    weekend={upcoming.nextWeekend} currentUserId={user?.id} />

            {(upcoming.upcomingHolidays ?? []).length > 0 && (
              <div className="mt-1">
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

  // ── Admin view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-6 bg-[hsl(var(--background))]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h1 className="text-lg font-bold">Escala de Plantões</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setYear(y => y - 1)}
            className="h-8 w-8 rounded-md border flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums w-10 text-center">{year}</span>
          <button
            onClick={() => setYear(y => y + 1)}
            className="h-8 w-8 rounded-md border flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bulk generate panel */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-3 card-float">
        <p className="text-sm font-semibold">Gerar escala para {year}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Os editores selecionados se revezam em rodízio — cada um fica de plantão um fim de semana, alternando na ordem escolhida. Após gerar, é possível adicionar editores extras a fins de semana específicos.
        </p>

        {editors.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum editor ativo encontrado.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {editors.map(e => {
              const selected = bulkEditorIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => toggleBulkEditor(e.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selected
                      ? "bg-[hsl(var(--primary))] text-white border-transparent"
                      : "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.5)]"
                  }`}>
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={16} />
                  {e.name.split(" ")[0]}
                  {selected && <span className="ml-0.5 opacity-80">✓</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={e => setReplaceExisting(e.target.checked)}
              className="rounded"
            />
            Substituir fins de semana existentes
          </label>
          <Button
            onClick={generate}
            disabled={generating || bulkEditorIds.length === 0}
            className="h-8 text-xs gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Gerando…" : "Gerar escala"}
          </Button>
        </div>
      </div>

      {/* Holiday / special day panel */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-50/30 dark:bg-amber-900/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-semibold">Feriado / Dia especial</p>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Escale um editor em qualquer data — feriados ou dias avulsos durante a semana.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={holidayDate}
            onChange={e => setHolidayDate(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]
              focus:outline-none focus:border-amber-500 tabular-nums"
          />
          <select
            value={holidayEditorId}
            onChange={e => setHolidayEditorId(e.target.value)}
            className="h-8 pl-2.5 pr-7 text-xs rounded-md border border-[hsl(var(--border))]
              bg-[hsl(var(--background))] appearance-none cursor-pointer
              focus:outline-none focus:border-amber-500">
            <option value="">Selecionar editor…</option>
            {editors.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <Button
            onClick={addHolidayEntry}
            disabled={addingHoliday || !holidayDate || !holidayEditorId}
            variant="outline"
            className="h-8 text-xs gap-1.5 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-900/20">
            <Plus className="h-3.5 w-3.5" />
            {addingHoliday ? "Adicionando…" : "Adicionar"}
          </Button>
        </div>
      </div>

      {/* Schedule grid — 3 months per row */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
          Carregando…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MON_PT.map((monthName, m) => {
            const slots = slotsByMonth.get(m) ?? [];
            return (
              <div key={m} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden card-float flex flex-col">
                {/* Month header */}
                <div className="px-3 py-2 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))] flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                    {monthName}
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">{year}</p>
                </div>

                {/* Slots */}
                <div className="flex-1 divide-y divide-[hsl(var(--border))]">
                  {slots.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground))] text-center">
                      Sem plantões cadastrados
                    </p>
                  ) : slots.map(slot => {
                    const isSat     = isSaturdayDate(slot.weekendStart);
                    const isCurrent = isSat ? isCurrentWeekend(slot.weekendStart) : isToday(slot.weekendStart);
                    const avail     = availableEditors(slot);
                    const addVal    = adding[slot.weekendStart] ?? "";

                    return (
                      <div
                        key={slot.weekendStart}
                        className={`px-3 py-2.5 transition-colors ${
                          !isSat ? "bg-amber-50/50 dark:bg-amber-900/10" : ""
                        } ${isCurrent ? "bg-[hsl(var(--primary)/0.06)]" : ""}`}>

                        {/* Date row */}
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className={`text-xs tabular-nums leading-none ${
                            isCurrent ? "font-bold text-[hsl(var(--primary))]" : "font-semibold"
                          }`}>
                            {isSat ? fmtWeekend(slot.weekendStart) : fmtSingleDate(slot.weekendStart)}
                          </span>
                          {!isSat && (
                            <span className="px-1 py-px rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                              feriado
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-1 py-px rounded text-[9px] font-bold bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] border border-[hsl(var(--primary))]/20">
                              hoje
                            </span>
                          )}
                        </div>

                        {/* Editor cards */}
                        <div className="flex flex-wrap gap-1.5">
                          {slot.editors.map(ed => (
                            <div
                              key={ed.scheduleId}
                              className="relative flex flex-col items-center gap-1.5 px-3 pt-4 pb-2.5 rounded-xl
                                bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]
                                min-w-[56px] hover:border-[hsl(var(--primary))]/40 transition-colors group">
                              <button
                                onClick={() => removeEntry(ed.scheduleId)}
                                className="absolute top-1.5 right-1.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100
                                  text-[hsl(var(--muted-foreground))] hover:text-destructive hover:bg-destructive/10 transition-all">
                                <X className="h-3 w-3" />
                              </button>
                              <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={30} />
                              <span className="text-[11px] font-semibold leading-none text-center">
                                {ed.name.split(" ")[0]}
                              </span>
                            </div>
                          ))}

                          {/* Add editor card */}
                          {avail.length > 0 && (
                            <div className="relative flex flex-col items-center justify-center gap-1 px-2 pt-2 pb-2.5 rounded-xl
                              border border-dashed border-[hsl(var(--border))] min-w-[56px] min-h-[68px]
                              hover:border-[hsl(var(--primary))]/60 transition-colors">
                              {!addVal ? (
                                <>
                                  <div className="w-[30px] h-[30px] rounded-full border-2 border-dashed border-[hsl(var(--border))]
                                    flex items-center justify-center text-[hsl(var(--muted-foreground))]">
                                    <Plus className="h-3.5 w-3.5" />
                                  </div>
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none">add</span>
                                  <select
                                    value={addVal}
                                    onChange={e => setAdding(prev => ({ ...prev, [slot.weekendStart]: e.target.value }))}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                                    <option value="">Selecionar…</option>
                                    {avail.map(e => (
                                      <option key={e.id} value={e.id}>{e.name}</option>
                                    ))}
                                  </select>
                                </>
                              ) : (
                                <>
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none text-center px-1 truncate max-w-[52px]">
                                    {avail.find(e => String(e.id) === addVal)?.name.split(" ")[0]}
                                  </span>
                                  <button
                                    onClick={() => addEditor(slot.weekendStart)}
                                    className="h-6 px-2 rounded-lg bg-[hsl(var(--primary))] text-white text-[10px] font-semibold hover:opacity-90 transition-opacity">
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
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

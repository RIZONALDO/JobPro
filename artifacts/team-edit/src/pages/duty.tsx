import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Trash2, Plus, RefreshCw, Shield } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Editor { id: number; name: string; avatarUrl: string | null; login: string; }
interface ScheduleEditor { id: number; name: string; avatarUrl: string | null; scheduleId: number; }
interface WeekendSlot { weekendStart: string; editors: ScheduleEditor[]; notes: string | null; }

interface UpcomingEditor { id: number; name: string; avatarUrl: string | null; }
interface UpcomingWeekend { weekendStart: string; editors: UpcomingEditor[]; }
interface UpcomingData {
  lastWeekend: UpcomingWeekend;
  thisWeekend: UpcomingWeekend;
  nextWeekend: UpcomingWeekend;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MON_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MON_PT_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function fmtWeekend(satIso: string): string {
  const sat = new Date(satIso + "T12:00:00");
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  return `${fmt(sat)} – ${fmt(sun)}`;
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

function monthOf(satIso: string): number {
  return new Date(satIso + "T12:00:00").getMonth();
}

function isCurrentWeekend(satIso: string): boolean {
  const today = new Date(); today.setHours(0,0,0,0);
  const day = today.getDay();
  const diff = day === 0 ? -1 : 6 - day;
  const thisSat = new Date(today); thisSat.setDate(thisSat.getDate() + diff);
  return thisSat.toISOString().split("T")[0] === satIso;
}

// ── Weekend Card (non-admin view) ──────────────────────────────────────────────

type CardVariant = "past" | "current" | "next";

function WeekendCard({
  variant,
  weekend,
  currentUserId,
}: {
  variant: CardVariant;
  weekend: UpcomingWeekend;
  currentUserId: number | undefined;
}) {
  const { satLabel, sunLabel, month, year } = fmtDay(weekend.weekendStart);
  const isOnDuty = weekend.editors.some(e => e.id === currentUserId);
  const isEmpty = weekend.editors.length === 0;

  const labels: Record<CardVariant, string> = {
    past: "Último fim de semana",
    current: "Este fim de semana",
    next: "Próximo fim de semana",
  };

  if (variant === "past") {
    return (
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 opacity-70">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] mb-3">
          {labels.past}
        </p>
        <div className="flex items-baseline gap-1.5 mb-4">
          <span className="text-xl font-bold tabular-nums">{satLabel}</span>
          <span className="text-sm text-[hsl(var(--muted-foreground))]">–</span>
          <span className="text-xl font-bold tabular-nums">{sunLabel}</span>
          <span className="text-sm text-[hsl(var(--muted-foreground))] ml-1">{month} {year}</span>
        </div>
        {isEmpty ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</p>
        ) : (
          <div className="flex flex-col gap-2">
            {weekend.editors.map(ed => (
              <div key={ed.id} className="flex items-center gap-2.5">
                <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={28} />
                <span className="text-sm font-medium">{ed.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (variant === "current") {
    return (
      <div className="rounded-2xl border-2 border-[hsl(var(--primary))] bg-[hsl(var(--card))] p-6 shadow-lg relative overflow-hidden card-float">
        {/* Accent strip */}
        <div className="absolute inset-x-0 top-0 h-1 bg-[hsl(var(--primary))] rounded-t-2xl" />

        <div className="flex items-start justify-between mb-4 mt-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--primary))]">
            {labels.current}
          </p>
          {isOnDuty && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--primary))] text-white text-[10px] font-bold uppercase tracking-wide">
              <Shield className="h-3 w-3" />
              Você está de plantão
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1.5 mb-6">
          <span className="text-3xl font-extrabold tabular-nums tracking-tight">{satLabel}</span>
          <span className="text-xl text-[hsl(var(--muted-foreground))]">–</span>
          <span className="text-3xl font-extrabold tabular-nums tracking-tight">{sunLabel}</span>
          <span className="text-base text-[hsl(var(--muted-foreground))] ml-1.5 font-medium">{month} {year}</span>
        </div>

        {isEmpty ? (
          <div className="rounded-xl bg-[hsl(var(--muted))]/40 px-4 py-3 text-sm text-[hsl(var(--muted-foreground))] text-center">
            Nenhum editor escalado
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {weekend.editors.map(ed => (
              <div key={ed.id} className="flex items-center gap-3 rounded-xl bg-[hsl(var(--muted))]/30 px-3 py-2.5">
                <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={36} />
                <div>
                  <p className="text-sm font-semibold leading-tight">{ed.name}</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Editor de plantão</p>
                </div>
                {ed.id === currentUserId && (
                  <span className="ml-auto text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-wide">você</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // next
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 card-float">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          {labels.next}
        </p>
        {isOnDuty && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] text-[10px] font-bold uppercase tracking-wide border border-[hsl(var(--primary))]/20">
            <Shield className="h-3 w-3" />
            Você está escalado
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 mb-4">
        <span className="text-2xl font-bold tabular-nums">{satLabel}</span>
        <span className="text-base text-[hsl(var(--muted-foreground))]">–</span>
        <span className="text-2xl font-bold tabular-nums">{sunLabel}</span>
        <span className="text-sm text-[hsl(var(--muted-foreground))] ml-1">{month} {year}</span>
      </div>

      {isEmpty ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum editor escalado ainda</p>
      ) : (
        <div className="flex flex-col gap-2">
          {weekend.editors.map(ed => (
            <div key={ed.id} className="flex items-center gap-2.5">
              <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={32} />
              <div>
                <p className="text-sm font-medium leading-tight">{ed.name}</p>
                {ed.id === currentUserId && (
                  <p className="text-[10px] text-[hsl(var(--primary))] font-semibold">você</p>
                )}
              </div>
            </div>
          ))}
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
  useEffect(() => {
    if (isAdmin) return;
    setUpcomingLoad(true);
    apiFetch<UpcomingData>("/api/duty/upcoming")
      .then(setUpcoming)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => setUpcomingLoad(false));
  }, [isAdmin]);

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

  // ── Admin: group by month ────────────────────────────────────────────────────
  const byMonth: { month: number; slots: WeekendSlot[] }[] = [];
  for (const slot of schedule) {
    const m = monthOf(slot.weekendStart);
    if (!byMonth.length || byMonth[byMonth.length - 1].month !== m) {
      byMonth.push({ month: m, slots: [] });
    }
    byMonth[byMonth.length - 1].slots.push(slot);
  }

  const availableEditors = (slot: WeekendSlot) =>
    editors.filter(e => !slot.editors.some(se => se.id === e.id));

  // ── Non-admin view ───────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h1 className="text-lg font-bold">Escala de Plantões</h1>
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
          Selecione os editores que serão escalados em todos os fins de semana do ano.
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
            Substituir escala existente
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

      {/* Schedule grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
          Carregando…
        </div>
      ) : (
        <div className="space-y-6">
          {byMonth.map(({ month, slots }) => (
            <div key={month}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))] mb-2">
                {MON_PT[month]}
              </p>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden card-float">
                {slots.map((slot, i) => {
                  const isCurrent = isCurrentWeekend(slot.weekendStart);
                  const isEmpty   = slot.editors.length === 0;
                  const avail     = availableEditors(slot);
                  const addVal    = adding[slot.weekendStart] ?? "";

                  return (
                    <div
                      key={slot.weekendStart}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                        i > 0 ? "border-t border-[hsl(var(--border))]" : ""
                      } ${isCurrent ? "bg-[hsl(var(--primary)/0.07)]" : ""}`}>

                      <div className="w-28 shrink-0">
                        <span className={`text-sm tabular-nums ${isCurrent ? "font-bold text-[hsl(var(--primary))]" : "font-medium"}`}>
                          {fmtWeekend(slot.weekendStart)}
                        </span>
                        {isCurrent && (
                          <span className="ml-1.5 text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-wide">
                            hoje
                          </span>
                        )}
                      </div>

                      <div className="flex-1 flex flex-wrap items-center gap-1.5">
                        {isEmpty && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</span>
                        )}
                        {slot.editors.map(ed => (
                          <div
                            key={ed.scheduleId}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--muted))]/50 border border-[hsl(var(--border))] text-xs">
                            <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={16} />
                            <span className="font-medium">{ed.name.split(" ")[0]}</span>
                            <button
                              onClick={() => removeEntry(ed.scheduleId)}
                              className="ml-0.5 text-[hsl(var(--muted-foreground))] hover:text-destructive transition-colors">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}

                        {avail.length > 0 && (
                          <div className="flex items-center gap-1">
                            <select
                              value={addVal}
                              onChange={e => setAdding(prev => ({ ...prev, [slot.weekendStart]: e.target.value }))}
                              className="h-6 pl-2 pr-6 text-xs rounded-md border border-dashed border-[hsl(var(--border))]
                                bg-[hsl(var(--background))] appearance-none cursor-pointer
                                focus:outline-none focus:border-[hsl(var(--primary))]">
                              <option value="">+ Adicionar</option>
                              {avail.map(e => (
                                <option key={e.id} value={e.id}>{e.name.split(" ")[0]}</option>
                              ))}
                            </select>
                            {addVal && (
                              <button
                                onClick={() => addEditor(slot.weekendStart)}
                                className="h-6 w-6 rounded-md bg-[hsl(var(--primary))] text-white flex items-center justify-center hover:opacity-90 transition-opacity">
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

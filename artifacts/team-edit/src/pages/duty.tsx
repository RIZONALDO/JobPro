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

// ── Helpers ────────────────────────────────────────────────────────────────────

const MON_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function fmtWeekend(satIso: string): string {
  const sat = new Date(satIso + "T12:00:00");
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  return `${fmt(sat)} – ${fmt(sun)}`;
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DutyPage() {
  usePageTitle("Plantões");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [year,       setYear]       = useState(new Date().getFullYear());
  const [schedule,   setSchedule]   = useState<WeekendSlot[]>([]);
  const [editors,    setEditors]    = useState<Editor[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);

  // Bulk generate state
  const [bulkEditorIds,  setBulkEditorIds]  = useState<number[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);

  // Inline add-editor state: key = weekendStart, value = selectedEditorId
  const [adding, setAdding] = useState<Record<string, string>>({});

  const loadSchedule = useCallback(() => {
    setLoading(true);
    apiFetch<WeekendSlot[]>(`/api/duty?year=${year}`)
      .then(setSchedule)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<(Editor & { role: string; status: string })[]>("/api/users")
      .then(all => setEditors(all.filter(u => u.role === "editor" && u.status === "active")))
      .catch(() => {});
  }, [isAdmin]);

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

  // Group by month
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

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-6 bg-[hsl(var(--background))]">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
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

      {/* ── Admin: bulk generate panel ─────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-3 card-float">
          <p className="text-sm font-semibold">Gerar escala para {year}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Selecione os editores que serão escalados em todos os fins de semana do ano.
          </p>

          {/* Editor chips */}
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
      )}

      {/* ── Schedule grid ───────────────────────────────────────────────────── */}
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
                  const isCurrent  = isCurrentWeekend(slot.weekendStart);
                  const isEmpty    = slot.editors.length === 0;
                  const avail      = availableEditors(slot);
                  const addVal     = adding[slot.weekendStart] ?? "";

                  return (
                    <div
                      key={slot.weekendStart}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                        i > 0 ? "border-t border-[hsl(var(--border))]" : ""
                      } ${isCurrent ? "bg-[hsl(var(--primary)/0.07)]" : ""}`}>

                      {/* Date */}
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

                      {/* Editors */}
                      <div className="flex-1 flex flex-wrap items-center gap-1.5">
                        {isEmpty && !isAdmin && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</span>
                        )}
                        {slot.editors.map(ed => (
                          <div
                            key={ed.scheduleId}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--muted))]/50 border border-[hsl(var(--border))] text-xs">
                            <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={16} />
                            <span className="font-medium">{ed.name.split(" ")[0]}</span>
                            {isAdmin && (
                              <button
                                onClick={() => removeEntry(ed.scheduleId)}
                                className="ml-0.5 text-[hsl(var(--muted-foreground))] hover:text-destructive transition-colors">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}

                        {/* Admin: inline add */}
                        {isAdmin && avail.length > 0 && (
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

import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { usePageTitle } from "@/lib/use-page-title";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Shield, CalendarPlus, X, MoreHorizontal, Mail, ChevronDown, Shuffle, Pencil } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Editor { id: number; name: string; avatarUrl: string | null; login: string; }
interface ScheduleEditor { id: number; name: string; avatarUrl: string | null; scheduleId: number; slotType: string; }
interface WeekendSlot { weekendStart: string; editors: ScheduleEditor[]; notes: string | null; }

interface UpcomingEditor { id: number; name: string; avatarUrl: string | null; }
interface UpcomingWeekend { weekendStart: string; satEditors: UpcomingEditor[]; sunEditors: UpcomingEditor[]; }
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
  const satEditors = weekend.satEditors ?? [];
  const sunEditors = weekend.sunEditors ?? [];
  const allEditors = [...satEditors, ...sunEditors];
  const isOnDuty = allEditors.some(e => e.id === currentUserId);
  const isEmpty   = satEditors.length === 0 && sunEditors.length === 0;
  const sameEditors =
    satEditors.length > 0 &&
    satEditors.length === sunEditors.length &&
    satEditors.every((e, i) => e.id === sunEditors[i]?.id);
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
        ) : sameEditors ? (
          /* Same editor(s) both days — combined view */
          <div className={`flex w-full justify-center ${c ? "flex-row gap-4" : "flex-col gap-2"}`}>
            {satEditors.map(ed => (
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
        ) : (
          /* Different editors per day — per-day rows */
          <div className="flex flex-col gap-2 w-full">
            {([
              { label: "Sáb", editors: satEditors },
              { label: "Dom", editors: sunEditors },
            ] as const).map(({ label, editors: dayEditors }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`shrink-0 font-bold text-[hsl(var(--muted-foreground))] w-6 text-left ${c ? "text-[9px]" : "text-[8px]"}`}>
                  {label}
                </span>
                {dayEditors.length === 0 ? (
                  <span className={`text-[hsl(var(--muted-foreground))] ${c ? "text-[10px]" : "text-[9px]"}`}>
                    A definir
                  </span>
                ) : dayEditors.map(ed => (
                  <div key={ed.id} className="flex items-center gap-1">
                    <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={c ? 26 : 20} />
                    <div>
                      <p className={`font-semibold leading-none ${c ? "text-[11px]" : "text-[10px]"}`}>
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
  const { settings } = useSettings();
  const appName = settings.company_name || "EditorPro";
  const isAdmin      = ["admin", "supervisor"].includes(user?.role ?? "");
  const isSupervisor = user?.role === "supervisor";

  // ── Admin state ──────────────────────────────────────────────────────────────
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [schedule,   setSchedule]   = useState<WeekendSlot[]>([]);
  const [editors,    setEditors]    = useState<Editor[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [month,           setMonth]           = useState(new Date().getMonth());
  const [sorteando,              setSorteando]              = useState(false);
  const [sorteioEditorIds,       setSorteioEditorIds]       = useState<number[]>([]);
  const [replaceExistingSorteio, setReplaceExistingSorteio] = useState(false);
  const [holidayDate,     setHolidayDate]     = useState("");
  const [holidayName,     setHolidayName]     = useState("");
  const [holidayEditorId, setHolidayEditorId] = useState("");
  const [addingHoliday,        setAddingHoliday]        = useState(false);
  const [addDropdown,    setAddDropdown]    = useState<string | null>(null);
  const [addModal,         setAddModal]         = useState<{ iso: string } | null>(null);
  const [addModalAdding,   setAddModalAdding]   = useState(false);
  const [addModalSelected, setAddModalSelected] = useState<number | null>(null);
  const [eventModal,     setEventModal]     = useState<{ iso: string } | null>(null);
  const [eventModalName, setEventModalName] = useState("");
  const [eventModalSaving, setEventModalSaving] = useState(false);
  const [nationalHolidays,     setNationalHolidays]     = useState<{ date: string; name: string }[]>([]);
  const [selectedHolidayDates, setSelectedHolidayDates] = useState<Set<string>>(new Set());
  const [nationalEditorId,     setNationalEditorId]     = useState("");
  const [fetchingNational,     setFetchingNational]     = useState(false);
  const [importingNational,    setImportingNational]    = useState(false);
  const [resetting,            setResetting]            = useState(false);
  const [confirmReset,         setConfirmReset]         = useState(false);
  const [showMenu,             setShowMenu]             = useState(false);
  const [showTools,            setShowTools]            = useState(false);
  const [supervisorTab,        setSupervisorTab]        = useState<"manage" | "sorteio" | "view" | "email">("manage");
  const [editingNotes,         setEditingNotes]         = useState<{ iso: string; value: string } | null>(null);

  // ── Email config state ───────────────────────────────────────────────────────
  const [emailCfg,        setEmailCfg]        = useState<{ enabled: boolean; recipients: string[]; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; cronDay: number; cronHour: number; cronMinute: number } | null>(null);
  const [emailLoading,    setEmailLoading]    = useState(false);
  const [emailSaving,     setEmailSaving]     = useState(false);
  const [emailSending,    setEmailSending]    = useState(false);
  const [emailPreviewing, setEmailPreviewing] = useState(false);
  const [newEmail,        setNewEmail]        = useState("");
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0);
  const [emailSubTab,      setEmailSubTab]      = useState<"config" | "send" | "history">("config");
  type LogEntry = { id: number; sentAt: string; weekStart: string; weekEnd: string; recipients: string[]; status: string; errorMessage: string | null; trigger: string; senderName: string | null };
  const [logsData,         setLogsData]         = useState<{ logs: LogEntry[]; total: number } | null>(null);
  const [logsLoading,      setLogsLoading]      = useState(false);
  const [logsPage,         setLogsPage]         = useState(1);
  const [logsStatus,       setLogsStatus]       = useState("");
  const [logsTrigger,      setLogsTrigger]      = useState("");
  const [logsClearing,     setLogsClearing]     = useState(false);
  const [logsClearConfirm, setLogsClearConfirm] = useState(false);
  const [smtpOpen,         setSmtpOpen]         = useState(false);
  const [previewHtml,      setPreviewHtml]      = useState<string | null>(null);

  // ── Non-admin state ──────────────────────────────────────────────────────────
  const [upcoming,     setUpcoming]     = useState<UpcomingData | null>(null);
  const [upcomingLoad, setUpcomingLoad] = useState(true);

  // ── Admin data loading ───────────────────────────────────────────────────────
  const loadSchedule = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<WeekendSlot[]>(`/api/duty?year=${year}&month=${month + 1}`)
      .then(setSchedule)
      .catch(() => toast.error("Erro ao carregar escala"))
      .finally(() => { if (!silent) setLoading(false); });
  }, [year, month]);

  // Re-fetch schedule whenever month or year changes
  useEffect(() => {
    if (!isAdmin) return;
    loadSchedule();
  }, [isAdmin, loadSchedule]);

  // Fetch editors once on mount
  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<(Editor & { role: string; status: string })[]>("/api/users")
      .then(all => {
        const active = all.filter(u => u.role === "editor" && u.status === "active");
        setEditors(active);
      })
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
    if (isAdmin && !isSupervisor) return;
    loadUpcoming();
  }, [isAdmin, isSupervisor, loadUpcoming]);

  // Refresh upcoming whenever supervisor switches to the "Editores" tab
  useEffect(() => {
    if (!isSupervisor || supervisorTab !== "view") return;
    loadUpcoming();
  }, [isSupervisor, supervisorTab, loadUpcoming]);

  useEffect(() => {
    if (!isSupervisor || supervisorTab !== "email" || emailSubTab !== "history" || logsData !== null || logsLoading) return;
    setLogsLoading(true);
    apiFetch<{ logs: LogEntry[]; total: number }>("/api/duty/email-logs?page=1&limit=20")
      .then(setLogsData).catch(() => toast.error("Erro ao carregar histórico"))
      .finally(() => setLogsLoading(false));
  }, [isSupervisor, supervisorTab, emailSubTab, logsData, logsLoading]);

  useEffect(() => {
    if (!isSupervisor || supervisorTab !== "email" || emailCfg) return;
    setEmailLoading(true);
    apiFetch<{ enabled: boolean; recipients: string[]; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; cronDay: number; cronHour: number; cronMinute: number }>("/api/duty/email-config")
      .then(setEmailCfg).catch(() => toast.error("Erro ao carregar config de email"))
      .finally(() => setEmailLoading(false));
  }, [isSupervisor, supervisorTab, emailCfg]);

  // ── Admin actions ────────────────────────────────────────────────────────────
  const toggleSorteioEditor = (id: number) =>
    setSorteioEditorIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id)
        : prev.length < 2 ? [...prev, id] : prev
    );

  const sortear = async () => {
    if (sorteioEditorIds.length !== 2) { toast.error("Selecione exatamente 2 editores"); return; }
    setSorteando(true);
    try {
      const { weeks } = await apiPost<{ weeks: number; entries: number }>("/api/duty/sorteio", {
        year, editorIds: sorteioEditorIds, replaceExisting: replaceExistingSorteio,
      });
      toast.success(`Sorteio realizado: ${weeks} fins de semana escalados`);
      loadSchedule(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao realizar sorteio");
    } finally {
      setSorteando(false);
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
    const prevSchedule = schedule;
    setSchedule(s => s.map(slot => ({
      ...slot,
      editors: slot.editors.filter(e => e.scheduleId !== scheduleId),
    })));
    try {
      await apiDelete(`/api/duty/${scheduleId}`);
    } catch {
      setSchedule(prevSchedule);
      toast.error("Erro ao remover");
    }
  };

  const addEditor = async (iso: string, editorId: number, slotType: "normal" | "extra", notes: string | null = null) => {
    const editor = editors.find(e => e.id === editorId);
    if (!editor) return;

    const prevSchedule = schedule;

    const TEMP_ID = -Date.now();
    const newEntry: ScheduleEditor = { id: editorId, name: editor.name, avatarUrl: editor.avatarUrl, scheduleId: TEMP_ID, slotType };

    setSchedule(s => {
      const exists = s.some(slot => slot.weekendStart === iso);
      if (exists) {
        return s.map(slot =>
          slot.weekendStart === iso
            ? { ...slot, notes: notes ?? slot.notes, editors: [...slot.editors, newEntry] }
            : slot
        );
      }
      return [...s, { weekendStart: iso, notes, editors: [newEntry] }];
    });

    try {
      const row = await apiPost<{ id: number; slotType: string } | null>("/api/duty", { weekendStart: iso, editorId, slotType, notes });
      if (!row) { loadSchedule(true); return; }
      setSchedule(s => s.map(slot => ({
        ...slot,
        editors: slot.editors.map(e => e.scheduleId === TEMP_ID ? { ...e, scheduleId: row.id } : e),
      })));
    } catch {
      setSchedule(prevSchedule);
      toast.error("Erro ao adicionar editor");
    }
  };

  const updateEventNotes = async (iso: string, notes: string | null) => {
    const cleanNotes = notes ? notes.trim() || null : null;
    const prevSchedule = schedule;
    setSchedule(s => s.map(slot =>
      slot.weekendStart === iso ? { ...slot, notes: cleanNotes } : slot
    ));
    try {
      await apiPatch("/api/duty/event-name", { weekendStart: iso, notes: cleanNotes });
      loadSchedule(true);
    } catch {
      setSchedule(prevSchedule);
      toast.error("Erro ao atualizar evento");
    }
  };

  const createEvent = async (iso: string, name: string) => {
    const prevSchedule = schedule;
    setEventModal(null);
    setEventModalName("");
    setSchedule(s => {
      const exists = s.some(slot => slot.weekendStart === iso);
      if (exists) return s.map(slot => slot.weekendStart === iso ? { ...slot, notes: name || null } : slot);
      return [...s, { weekendStart: iso, notes: name || null, editors: [] }];
    });
    try {
      await apiPost("/api/duty", { weekendStart: iso, notes: name || null });
      loadSchedule(true);
    } catch {
      setSchedule(prevSchedule);
      toast.error("Erro ao criar evento");
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

  const generateReceipt = async (weekStart: string, weekEnd: string) => {
    setShowMenu(false);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (iso: string) => {
      const d = new Date(iso + "T12:00:00");
      return `${["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
    };

    // Open popup immediately so browser doesn't block it, show loading state
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup bloqueado pelo navegador"); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>Faturamento de Plantões da Edição</title>
      <style>body{font-family:'Segoe UI',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff;color:#999;font-size:14px}</style>
      </head><body>Gerando faturamento…</body></html>`);
    w.document.close();

    try {
      // Fetch only the month(s) the week touches — not the entire year
      const startY = parseInt(weekStart.slice(0, 4), 10);
      const startM = parseInt(weekStart.slice(5, 7), 10);
      const endY   = parseInt(weekEnd.slice(0, 4), 10);
      const endM   = parseInt(weekEnd.slice(5, 7), 10);

      let raw: WeekendSlot[];
      if (startY === endY && startM === endM) {
        raw = await apiFetch<WeekendSlot[]>(`/api/duty?year=${startY}&month=${startM}`);
      } else {
        const [d1, d2] = await Promise.all([
          apiFetch<WeekendSlot[]>(`/api/duty?year=${startY}&month=${startM}`),
          apiFetch<WeekendSlot[]>(`/api/duty?year=${endY}&month=${endM}`),
        ]);
        raw = [...d1, ...d2];
      }

      const slots = raw.filter(s => s.weekendStart >= weekStart && s.weekendStart <= weekEnd);

      // Grupo 1: Plantões Especiais (Sáb+Dom) | Grupo 2: Outros Plantões (Seg–Sex)
      // Cada grupo subdividido em Normal + Extra
      type RDay     = { date: string; event: string | null };
      type REditors = Map<number, { name: string; days: RDay[] }>;
      type RGroup   = { normal: REditors; extra: REditors };

      const weekendGroup: RGroup = { normal: new Map(), extra: new Map() };
      const weekdayGroup: RGroup = { normal: new Map(), extra: new Map() };

      for (const slot of slots) {
        const dow = new Date(slot.weekendStart + "T12:00:00").getDay();
        const grp = (dow === 0 || dow === 6) ? weekendGroup : weekdayGroup;
        for (const ed of (slot.editors ?? [])) {
          const map = ed.slotType === "extra" ? grp.extra : grp.normal;
          if (!map.has(ed.id)) map.set(ed.id, { name: ed.name, days: [] });
          map.get(ed.id)!.days.push({ date: slot.weekendStart, event: slot.notes?.trim() || null });
        }
      }

      const sortMap = (m: REditors) =>
        Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      const countMap = (m: REditors) =>
        Array.from(m.values()).reduce((s, e) => s + e.days.length, 0);

      const totalWeekend = countMap(weekendGroup.normal) + countMap(weekendGroup.extra);
      const totalWeekday = countMap(weekdayGroup.normal) + countMap(weekdayGroup.extra);
      const total        = totalWeekend + totalWeekday;

      const badge = (label: string) =>
        `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:5px;vertical-align:middle">${label}</span>`;

      const buildRows = (m: REditors) =>
        sortMap(m).map(({ name, days }) =>
          `<tr>
            <td>${name}</td>
            <td style="color:#555;font-size:12px;line-height:1.9">${days.map(({ date, event }) =>
              fmt(date) + (event ? badge(event) : "")
            ).join("<br>")}</td>
            <td style="text-align:right;font-weight:700">${days.length}</td>
          </tr>`
        ).join("");

      const secHeader  = (label: string) =>
        `<tr><td colspan="3" style="padding:14px 0 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#111">${label}</td></tr>`;
      const extraHeader = () =>
        `<tr><td colspan="3" style="padding:10px 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#b45309">↳ Extra</td></tr>`;
      const subRow = (val: number) =>
        `<tr><td colspan="2" style="padding:6px 0 10px;font-size:11px;font-weight:600;color:#777">Subtotal</td><td style="padding:6px 0 10px;text-align:right;font-weight:700;color:#555">${val}</td></tr>`;

      const buildGroup = (grp: RGroup, label: string, subtotal: number) => {
        if (countMap(grp.normal) + countMap(grp.extra) === 0) return "";
        return [
          secHeader(label),
          grp.normal.size > 0 ? buildRows(grp.normal) : "",
          grp.extra.size  > 0 ? extraHeader() + buildRows(grp.extra) : "",
          subRow(subtotal),
        ].join("");
      };

      const rows = total === 0
        ? `<tr><td colspan="3" style="padding:20px;text-align:center;color:#999;font-style:italic">Nenhum plantão registrado nesta semana</td></tr>`
        : [
            buildGroup(weekendGroup, "Plantões Especiais", totalWeekend),
            buildGroup(weekdayGroup, "Outros Plantões",    totalWeekday),
          ].join("");

      w.document.open();
      w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
        <meta charset="utf-8">
        <title>${appName} — Faturamento de Plantões da Edição — ${fmt(weekStart).slice(4)} a ${fmt(weekEnd).slice(4)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 48px 56px; max-width: 700px; margin: 0 auto; }
          .logo { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #888; margin-bottom: 32px; }
          h1 { font-size: 26px; font-weight: 900; letter-spacing: -.02em; }
          .period { font-size: 13px; color: #555; margin-top: 6px; }
          .divider { border: none; border-top: 2px solid #111; margin: 28px 0 20px; }
          table { width: 100%; border-collapse: collapse; }
          th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #888; padding: 0 0 10px; text-align: left; border-bottom: 1px solid #e5e5e5; }
          th:nth-child(2) { text-align: center; }
          td { padding: 14px 0; vertical-align: top; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
          td:nth-child(2) { text-align: center; font-size: 22px; font-weight: 900; color: #111; }
          .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 24px; padding-top: 16px; border-top: 2px solid #111; }
          .total-label { font-size: 13px; font-weight: 600; }
          .total-value { font-size: 32px; font-weight: 900; }
          .footer { margin-top: 48px; font-size: 11px; color: #bbb; text-align: center; }
        </style>
      </head><body>
        <div class="logo">${appName}</div>
        <h1>Faturamento de Plantões da Edição</h1>
        <p class="period">Semana de ${fmt(weekStart)} a ${fmt(weekEnd)}</p>
        <hr class="divider">
        <table>
          <thead><tr><th>Editor</th><th>Datas</th><th style="text-align:right">Dias</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total-row">
          <span class="total-label">Total de plantões</span>
          <span class="total-value">${total}</span>
        </div>
        <div class="footer">Gerado em ${new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" })} — ${appName} Escala de Plantões</div>
      </body></html>`);
      w.document.close();
    } catch {
      w.close();
      toast.error("Erro ao gerar faturamento");
    }
  };


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
                    const hEditors = h.editors ?? [];
                    const isOnDuty = hEditors.some(e => e.id === user?.id);
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
                          {hEditors.length === 0 ? (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</span>
                          ) : hEditors.map(ed => (
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

  // ── Supervisor "E-mail" tab ──────────────────────────────────────────────────
  if (isSupervisor && supervisorTab === "email") {
    const recentWeeks = (() => {
      const t = new Date(); const dow = t.getDay();
      const lastMon = new Date(t);
      lastMon.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
      lastMon.setHours(0, 0, 0, 0);
      const p2 = (n: number) => String(n).padStart(2, "0");
      return Array.from({ length: 12 }, (_, i) => {
        const mon = new Date(lastMon.getTime() - i * 7 * 86400000);
        const sun = new Date(mon.getTime() + 6 * 86400000);
        return {
          weekStart: mon.toISOString().split("T")[0],
          weekEnd:   sun.toISOString().split("T")[0],
          label: `${p2(mon.getDate())}/${p2(mon.getMonth()+1)} — ${p2(sun.getDate())}/${p2(sun.getMonth()+1)}/${sun.getFullYear()}`,
          isLast: i === 0,
        };
      });
    })();
    const selWeek = recentWeeks[selectedWeekIdx] ?? recentWeeks[0];
    const DAYS_PT = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];

    const autoSave = async (cfg: NonNullable<typeof emailCfg>) => {
      setEmailSaving(true);
      try {
        const updated = await apiPut<typeof emailCfg>("/api/duty/email-config", cfg);
        setEmailCfg(updated);
      } catch { toast.error("Erro ao salvar configurações"); }
      finally { setEmailSaving(false); }
    };

    const sendNow = async () => {
      if (!selWeek) return;
      setEmailSending(true);
      try {
        await apiPost("/api/duty/email-send", { weekStart: selWeek.weekStart, weekEnd: selWeek.weekEnd });
        toast.success("Relatório enviado!");
        setLogsData(null);
      } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro ao enviar"); }
      finally { setEmailSending(false); }
    };

    const previewEmail = async () => {
      if (!selWeek) return;
      setEmailPreviewing(true);
      try {
        const res = await fetch("/api/duty/email-preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: selWeek.weekStart, weekEnd: selWeek.weekEnd }),
          credentials: "include",
        });
        const html = await res.text();
        setPreviewHtml(html);
      } catch { toast.error("Erro ao gerar prévia"); }
      finally { setEmailPreviewing(false); }
    };

    const loadLogs = (page: number, status: string, trigger: string) => {
      setLogsLoading(true);
      const q = new URLSearchParams({ page: String(page), limit: "20" });
      if (status)  q.set("status",  status);
      if (trigger) q.set("trigger", trigger);
      apiFetch<{ logs: LogEntry[]; total: number }>(`/api/duty/email-logs?${q}`)
        .then(data => { setLogsData(data); setLogsPage(page); })
        .catch(() => toast.error("Erro ao carregar histórico"))
        .finally(() => setLogsLoading(false));
    };

    const clearLogs = async () => {
      setLogsClearing(true);
      try {
        await apiDelete("/api/duty/email-logs");
        setLogsData({ logs: [], total: 0 });
        setLogsClearConfirm(false);
        toast.success("Histórico limpo");
      } catch { toast.error("Erro ao limpar histórico"); }
      finally { setLogsClearing(false); }
    };

    const addEmail = () => {
      const v = newEmail.trim().toLowerCase();
      if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast.error("Email inválido"); return; }
      if (!emailCfg || emailCfg.recipients.includes(v)) { toast.error("Email já cadastrado"); return; }
      const next = { ...emailCfg, recipients: [...emailCfg.recipients, v] };
      setEmailCfg(next);
      setNewEmail("");
      autoSave(next);
    };

    const inputCls = "h-9 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]";
    const selectCls = "h-9 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] cursor-pointer";

    const totalPages = logsData ? Math.max(1, Math.ceil(logsData.total / 20)) : 1;

    return (
      <div className="flex flex-col h-full overflow-y-auto bg-[hsl(var(--background))]">

      {/* Email preview modal */}
      {previewHtml !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm" onClick={() => setPreviewHtml(null)}>
          <div className="flex items-center justify-between px-4 py-2 bg-[hsl(var(--background))] border-b border-[hsl(var(--border))] shrink-0"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold">Pré-visualização do e-mail</p>
            <button onClick={() => setPreviewHtml(null)}
              className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-4" onClick={e => e.stopPropagation()}>
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full rounded-xl border border-[hsl(var(--border))] bg-white"
              sandbox="allow-same-origin"
              title="Pré-visualização do e-mail"
            />
          </div>
        </div>
      )}
        {/* Header + tabs */}
        <div className="px-4 pt-4 pb-0 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-bold">Escala de Plantões</h1>
          </div>

          {/* Parent tab bar */}
          <div className="flex border-b border-[hsl(var(--border))]">
            {(["manage","sorteio","view","email"] as const).map(tab => (
              <button key={tab} onClick={() => setSupervisorTab(tab)}
                className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${supervisorTab === tab ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
                {tab === "manage" ? "Calendário" : tab === "sorteio" ? "Sorteio" : tab === "view" ? "Editores" : "E-mail"}
              </button>
            ))}
          </div>

          {/* Sub-tab pill switcher */}
          <div className="flex gap-0.5 p-1 bg-[hsl(var(--muted))] rounded-xl self-start mt-1">
            {(["config","send","history"] as const).map(st => (
              <button key={st} onClick={() => setEmailSubTab(st)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  emailSubTab === st
                    ? "bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm"
                    : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                }`}>
                {st === "config" ? "Configurações" : st === "send" ? "Enviar" : "Histórico"}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {emailLoading ? (
            <div className="flex items-center justify-center py-20 text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
          ) : emailSubTab === "config" ? (
            emailCfg && (
              <div className="flex flex-col gap-4 max-w-lg">

                {/* Envio automático */}
                <div className={`rounded-xl border bg-[hsl(var(--card))] p-4 flex flex-col gap-3 transition-colors ${emailCfg.enabled ? "border-[hsl(var(--primary))]/40" : "border-[hsl(var(--border))]"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">Envio automático</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Relatório da semana anterior enviado automaticamente</p>
                    </div>
                    <button onClick={() => { const next = { ...emailCfg, enabled: !emailCfg.enabled }; setEmailCfg(next); autoSave(next); }}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${emailCfg.enabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]"}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${emailCfg.enabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>
                  {emailCfg.enabled && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-[hsl(var(--border))]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Agendamento · Brasília (UTC−3)</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select value={emailCfg.cronDay}
                          onChange={e => { const next = { ...emailCfg, cronDay: parseInt(e.target.value, 10) }; setEmailCfg(next); autoSave(next); }}
                          className={selectCls}>
                          {DAYS_PT.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">às</span>
                        <select value={emailCfg.cronHour}
                          onChange={e => { const next = { ...emailCfg, cronHour: parseInt(e.target.value, 10) }; setEmailCfg(next); autoSave(next); }}
                          className={`${selectCls} w-20`}>
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{String(h).padStart(2,"0")}h</option>
                          ))}
                        </select>
                        <select value={emailCfg.cronMinute}
                          onChange={e => { const next = { ...emailCfg, cronMinute: parseInt(e.target.value, 10) }; setEmailCfg(next); autoSave(next); }}
                          className={`${selectCls} w-20`}>
                          {Array.from({ length: 60 }, (_, m) => (
                            <option key={m} value={m}>{String(m).padStart(2,"0")}min</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* SMTP */}
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
                  <button onClick={() => setSmtpOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[hsl(var(--muted))]/40 transition-colors">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Servidor de saída (SMTP)</p>
                      {emailCfg.smtpUser && !smtpOpen && (
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-normal normal-case tracking-normal">
                          · {emailCfg.smtpUser}
                        </span>
                      )}
                    </div>
                    <ChevronDown className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform ${smtpOpen ? "rotate-180" : ""}`} />
                  </button>
                  {smtpOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-3 border-t border-[hsl(var(--border))]">
                      <div className="flex gap-2 pt-3">
                        <input value={emailCfg.smtpHost}
                          onChange={e => setEmailCfg(c => c ? { ...c, smtpHost: e.target.value } : c)}
                          onBlur={e => autoSave({ ...emailCfg, smtpHost: e.target.value })}
                          placeholder="mail.seudominio.com.br"
                          className={`${inputCls} flex-1`} />
                        <input value={emailCfg.smtpPort}
                          onChange={e => setEmailCfg(c => c ? { ...c, smtpPort: parseInt(e.target.value, 10) || 465 } : c)}
                          onBlur={e => autoSave({ ...emailCfg, smtpPort: parseInt(e.target.value, 10) || 465 })}
                          type="number" placeholder="465" className={`${inputCls} w-20`} />
                      </div>
                      <input value={emailCfg.smtpUser}
                        onChange={e => setEmailCfg(c => c ? { ...c, smtpUser: e.target.value } : c)}
                        onBlur={e => autoSave({ ...emailCfg, smtpUser: e.target.value })}
                        placeholder="email@seudominio.com.br" className={`${inputCls} w-full`} />
                      <input value={emailCfg.smtpPass}
                        onChange={e => setEmailCfg(c => c ? { ...c, smtpPass: e.target.value } : c)}
                        onBlur={e => autoSave({ ...emailCfg, smtpPass: e.target.value })}
                        type="password" placeholder="Senha do e-mail" className={`${inputCls} w-full`} />
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        Porta <b>465</b> (SSL) ou <b>587</b> (TLS) — credenciais do cPanel
                      </p>
                    </div>
                  )}
                </div>

                {/* Destinatários */}
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Destinatários</p>
                    {emailCfg.recipients.length > 0 && (
                      <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                        {emailCfg.recipients.length} cadastrado{emailCfg.recipients.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addEmail()}
                      placeholder="email@exemplo.com" className={`${inputCls} flex-1`} />
                    <button onClick={addEmail}
                      className="h-9 px-3 rounded-lg bg-[hsl(var(--primary))] text-white hover:opacity-90 shrink-0">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  {emailCfg.recipients.length === 0 ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] italic text-center py-2">Nenhum destinatário cadastrado</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
                      {emailCfg.recipients.map((r, i) => (
                        <div key={r} className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))]">{r[0]}</span>
                            </div>
                            <span className="text-sm">{r}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {i === 0 && <span className="text-[9px] font-bold uppercase tracking-wide text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 px-1.5 py-0.5 rounded-full">principal</span>}
                            <button onClick={() => { const next = { ...emailCfg, recipients: emailCfg.recipients.filter(x => x !== r) }; setEmailCfg(next); autoSave(next); }}
                              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-colors p-1">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {emailSaving && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] text-center">Salvando…</p>
                )}
              </div>
            )
          ) : emailSubTab === "send" ? (
            emailCfg && (
              <div className="flex flex-col gap-4 max-w-lg">
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Período do faturamento</p>
                  <select value={selectedWeekIdx}
                    onChange={e => setSelectedWeekIdx(parseInt(e.target.value, 10))}
                    className={`${selectCls} w-full`}>
                    {recentWeeks.map((w, i) => (
                      <option key={w.weekStart} value={i}>
                        {w.label}{w.isLast ? " — semana passada" : ""}
                      </option>
                    ))}
                  </select>

                  {emailCfg.recipients.length === 0 ? (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                      <p className="text-xs text-amber-600 font-medium">Nenhum destinatário cadastrado — configure na aba Configurações</p>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-[hsl(var(--muted))]/50 px-3 py-2 flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                        {emailCfg.recipients.join(" · ")}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={previewEmail} disabled={emailPreviewing}
                      className="flex-1 h-10 rounded-lg border border-[hsl(var(--border))] text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {emailPreviewing ? "Gerando…" : "Pré-visualizar"}
                    </button>
                    <button onClick={sendNow} disabled={emailSending || emailCfg.recipients.length === 0}
                      className="flex-1 h-10 rounded-lg bg-[hsl(var(--primary))] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2">
                      <Mail className="h-4 w-4" />
                      {emailSending ? "Enviando…" : "Enviar agora"}
                    </button>
                  </div>
                </div>

                {emailCfg.enabled && (
                  <div className="rounded-xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--card))] px-4 py-3 flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Envio automático ativo — toda <b>{DAYS_PT[emailCfg.cronDay]}</b> às <b>{String(emailCfg.cronHour).padStart(2,"0")}:{String(emailCfg.cronMinute).padStart(2,"0")}</b>
                    </p>
                  </div>
                )}
              </div>
            )
          ) : (
            /* ── Histórico ── */
            <div className="flex flex-col gap-3 max-w-2xl">

              {/* Filtros + ações */}
              <div className="flex items-center gap-2 flex-wrap">
                <select value={logsStatus}
                  onChange={e => { setLogsStatus(e.target.value); loadLogs(1, e.target.value, logsTrigger); }}
                  className={`${selectCls} min-w-[120px]`}>
                  <option value="">Todos status</option>
                  <option value="sent">Enviado</option>
                  <option value="failed">Falhou</option>
                </select>
                <select value={logsTrigger}
                  onChange={e => { setLogsTrigger(e.target.value); loadLogs(1, logsStatus, e.target.value); }}
                  className={`${selectCls} min-w-[130px]`}>
                  <option value="">Todos os tipos</option>
                  <option value="manual">Manual</option>
                  <option value="auto">Automático</option>
                </select>
                <div className="flex-1" />
                <button onClick={() => loadLogs(logsPage, logsStatus, logsTrigger)} disabled={logsLoading}
                  className="h-9 px-3 rounded-lg border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50 flex items-center gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`} />
                  Atualizar
                </button>
                {!logsClearConfirm ? (
                  <button onClick={() => setLogsClearConfirm(true)}
                    className="h-9 px-3 rounded-lg border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] hover:border-[hsl(var(--destructive))]/40 transition-colors">
                    Limpar tudo
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Confirmar?</span>
                    <button onClick={clearLogs} disabled={logsClearing}
                      className="h-9 px-3 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50">
                      {logsClearing ? "…" : "Sim"}
                    </button>
                    <button onClick={() => setLogsClearConfirm(false)}
                      className="h-9 px-3 rounded-lg border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--muted))]">
                      Não
                    </button>
                  </div>
                )}
              </div>

              {/* Lista */}
              {logsLoading ? (
                <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">Carregando…</div>
              ) : logsData === null ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-[hsl(var(--muted-foreground))]">
                  <Mail className="h-8 w-8 opacity-20" />
                  <p className="text-sm">Nenhum dado carregado</p>
                </div>
              ) : logsData.logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-[hsl(var(--muted-foreground))]">
                  <Mail className="h-8 w-8 opacity-20" />
                  <p className="text-sm">Nenhum envio registrado</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))] overflow-hidden">
                    {logsData.logs.map(log => {
                      const d = new Date(log.sentAt);
                      const p2 = (n: number) => String(n).padStart(2, "0");
                      const dateFmt = `${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
                      const s = new Date(log.weekStart + "T12:00:00");
                      const e = new Date(log.weekEnd   + "T12:00:00");
                      const weekFmt = `${p2(s.getDate())}/${p2(s.getMonth()+1)} — ${p2(e.getDate())}/${p2(e.getMonth()+1)}/${e.getFullYear()}`;
                      return (
                        <div key={log.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[hsl(var(--muted))]/30 transition-colors">
                          <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${log.status === "sent" ? "bg-emerald-500" : "bg-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold tabular-nums">{dateFmt}</span>
                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                log.status === "sent" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                              }`}>
                                {log.status === "sent" ? "Enviado" : "Falhou"}
                              </span>
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/60 px-1.5 py-0.5 rounded-full">
                                {log.trigger === "auto" ? "automático" : "manual"}
                              </span>
                            </div>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                              Semana {weekFmt}{log.senderName ? ` · ${log.senderName}` : ""}
                            </p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                              {(log.recipients ?? []).join(", ")}
                            </p>
                            {log.errorMessage && (
                              <p className="text-[11px] text-red-500 mt-1 break-words leading-relaxed">{log.errorMessage}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Paginação */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                      {logsData.total} registro{logsData.total !== 1 ? "s" : ""} · página {logsPage} de {totalPages}
                    </p>
                    <div className="flex gap-1">
                      <button onClick={() => loadLogs(logsPage - 1, logsStatus, logsTrigger)}
                        disabled={logsPage <= 1 || logsLoading}
                        className="h-8 w-8 rounded-lg border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition-colors">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button onClick={() => loadLogs(logsPage + 1, logsStatus, logsTrigger)}
                        disabled={logsPage >= totalPages || logsLoading}
                        className="h-8 w-8 rounded-lg border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition-colors">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Supervisor "Sorteio" tab ─────────────────────────────────────────────────
  if (isSupervisor && supervisorTab === "sorteio") {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-bold">Escala de Plantões</h1>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[hsl(var(--border))] -mt-2">
          {(["manage","sorteio","view","email"] as const).map(tab => (
            <button key={tab} onClick={() => setSupervisorTab(tab)}
              className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${supervisorTab === tab ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
              {tab === "manage" ? "Calendário" : tab === "sorteio" ? "Sorteio" : tab === "view" ? "Editores" : "E-mail"}
            </button>
          ))}
        </div>

        {/* ── Sorteio de Plantonistas ── */}
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <Shuffle className="h-4 w-4 text-[hsl(var(--primary))]" />
              Sorteio de Plantonistas — {year}
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              Selecione <strong>2 editores</strong>. Eles se alternarão: cada um ocupa sábado e domingo em semanas alternadas ao longo do ano.
            </p>
          </div>

          {/* Editor chips */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {editors.map(e => {
              const idx = sorteioEditorIds.indexOf(e.id);
              const sel = idx !== -1;
              const disabled = !sel && sorteioEditorIds.length >= 2;
              return (
                <button key={e.id}
                  onClick={() => toggleSorteioEditor(e.id)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 ${
                    sel
                      ? "bg-[hsl(var(--primary))] text-white border-transparent"
                      : "bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50"
                  }`}>
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={18} />
                  {e.name.split(" ")[0]}
                  {sel && <span className="opacity-90 font-black text-[10px] tabular-nums">{idx + 1}°</span>}
                </button>
              );
            })}
          </div>

          {/* Preview da alternância */}
          {sorteioEditorIds.length === 2 && (() => {
            const edA = editors.find(e => e.id === sorteioEditorIds[0]);
            const edB = editors.find(e => e.id === sorteioEditorIds[1]);
            if (!edA || !edB) return null;
            return (
              <div className="rounded-lg bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/15 px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                <span className="font-bold text-[hsl(var(--foreground))]">{edA.name.split(" ")[0]}</span>
                {" "}&mdash; Sáb + Dom nas semanas 1, 3, 5…
                <br />
                <span className="font-bold text-[hsl(var(--foreground))]">{edB.name.split(" ")[0]}</span>
                {" "}&mdash; Sáb + Dom nas semanas 2, 4, 6…
              </div>
            );
          })()}

          {/* Options + action */}
          <div className="flex items-center gap-3 flex-wrap pt-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={replaceExistingSorteio}
                onChange={e => setReplaceExistingSorteio(e.target.checked)} className="rounded" />
              Substituir fins de semana existentes
            </label>
            <Button
              onClick={sortear}
              disabled={sorteando || sorteioEditorIds.length !== 2}
              className="h-8 text-xs px-4 gap-1.5">
              <Shuffle className={`h-3.5 w-3.5 ${sorteando ? "animate-spin" : ""}`} />
              {sorteando ? "Sorteando…" : "Sortear"}
            </Button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[hsl(var(--border))]" />

        {/* ── Feriados Nacionais ── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <CalendarPlus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Feriados Nacionais — {year}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={nationalEditorId} onChange={e => setNationalEditorId(e.target.value)}
                className="h-8 pl-2.5 pr-7 text-xs rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] appearance-none cursor-pointer focus:outline-none focus:border-emerald-500">
                <option value="">Editor…</option>
                {editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <Button onClick={fetchNationalHolidays} disabled={fetchingNational} variant="outline"
                className="h-8 text-xs gap-1.5 border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                <RefreshCw className={`h-3.5 w-3.5 ${fetchingNational ? "animate-spin" : ""}`} />
                {fetchingNational ? "Buscando…" : "Buscar feriados"}
              </Button>
              {nationalHolidays.length > 0 && selectedHolidayDates.size > 0 && (
                <Button onClick={importNationalHolidays} disabled={importingNational}
                  className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Plus className="h-3.5 w-3.5" />
                  {importingNational ? "Importando…" : `Importar ${selectedHolidayDates.size}`}
                </Button>
              )}
            </div>
          </div>

          {nationalHolidays.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto pr-1">
              {nationalHolidays.map(h => {
                const d   = new Date(h.date + "T12:00:00");
                const sel = selectedHolidayDates.has(h.date);
                return (
                  <label key={h.date}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border transition-colors ${
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

        {/* Divider */}
        <div className="h-px bg-[hsl(var(--border))]" />

        {/* ── Adicionar feriado / dia especial manualmente ── */}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold">Adicionar dia especial manualmente</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Data</label>
              <input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}
                className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs focus:outline-none focus:border-[hsl(var(--primary))]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Nome do evento</label>
              <input type="text" value={holidayName} onChange={e => setHolidayName(e.target.value)}
                placeholder="Ex: Feriado municipal"
                className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs focus:outline-none focus:border-[hsl(var(--primary))]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Editor</label>
              <select value={holidayEditorId} onChange={e => setHolidayEditorId(e.target.value)}
                className="h-8 pl-2 pr-6 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs appearance-none cursor-pointer focus:outline-none focus:border-[hsl(var(--primary))]">
                <option value="">Selecionar…</option>
                {editors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <Button onClick={addHolidayEntry} disabled={addingHoliday || !holidayDate || !holidayEditorId}
              variant="outline" className="h-8 text-xs gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {addingHoliday ? "Adicionando…" : "Adicionar"}
            </Button>
          </div>
        </div>

      </div>
    );
  }

  // ── Supervisor "Editores" tab ────────────────────────────────────────────────
  if (isSupervisor && supervisorTab === "view") {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 gap-5 bg-[hsl(var(--background))]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-bold">Escala de Plantões</h1>
          </div>
          <button onClick={loadUpcoming} disabled={upcomingLoad}
            className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${upcomingLoad ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex border-b border-[hsl(var(--border))] -mt-2">
          {(["manage","sorteio","view","email"] as const).map(tab => (
            <button key={tab} onClick={() => setSupervisorTab(tab)}
              className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${supervisorTab === tab ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
              {tab === "manage" ? "Calendário" : tab === "sorteio" ? "Sorteio" : tab === "view" ? "Editores" : "E-mail"}
            </button>
          ))}
        </div>

        {upcomingLoad ? (
          <div className="flex items-center justify-center py-16 text-sm text-[hsl(var(--muted-foreground))]">
            Carregando…
          </div>
        ) : upcoming ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <WeekendCard variant="past"    weekend={upcoming.lastWeekend} currentUserId={user?.id} />
              <WeekendCard variant="current" weekend={upcoming.thisWeekend} currentUserId={user?.id} />
              <WeekendCard variant="next"    weekend={upcoming.nextWeekend} currentUserId={user?.id} />
            </div>
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
                      const hEditors = h.editors ?? [];
                      return (
                      <div key={h.dutyDate}
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
                          {hEditors.length === 0 ? (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</span>
                          ) : hEditors.map(ed => (
                            <div key={ed.id} className="flex items-center gap-1.5">
                              <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={22} />
                              <span className="text-sm font-medium">{ed.name.split(" ")[0]}</span>
                            </div>
                          ))}
                        </div>
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
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h1 className="text-lg font-bold">Escala de Plantões</h1>
      </div>

      {/* Supervisor tab bar */}
      {isSupervisor && (
        <div className="flex border-b border-[hsl(var(--border))] -mt-2">
          {(["manage","sorteio","view","email"] as const).map(tab => (
            <button key={tab} onClick={() => setSupervisorTab(tab)}
              className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${supervisorTab === tab ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}>
              {tab === "manage" ? "Calendário" : tab === "sorteio" ? "Sorteio" : tab === "view" ? "Editores" : "E-mail"}
            </button>
          ))}
        </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Calendário de Plantões
        </p>
        <div className="flex items-center gap-1.5">
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
          {/* 3-dot menu */}
          {(() => {
            const pad2 = (n: number) => String(n).padStart(2, "0");
            const todayStr = new Date().toISOString().split("T")[0];
            // Last completed week (Mon–Sun)
            const _t = new Date(); const _dow = _t.getDay();
            const _mon = new Date(_t); _mon.setDate(_t.getDate() - (_dow === 0 ? 6 : _dow - 1) - 7);
            _mon.setHours(0,0,0,0);
            const lastWeekStart = _mon.toISOString().split("T")[0];
            const lastWeekEnd   = new Date(_mon.getTime() + 6 * 86400000).toISOString().split("T")[0];
            // Weeks of displayed month
            const monthWeeks = Array.from({ length: numWeeks }, (_, w) => {
              const mon = new Date(year, month, 1 - firstDayOffset + w * 7);
              const sun = new Date(mon.getTime() + 6 * 86400000);
              const ws  = mon.toISOString().split("T")[0];
              const we  = sun.toISOString().split("T")[0];
              return {
                weekStart: ws, weekEnd: we,
                label: `${pad2(mon.getDate())}/${pad2(mon.getMonth()+1)} — ${pad2(sun.getDate())}/${pad2(sun.getMonth()+1)}`,
                isLast: ws === lastWeekStart,
                isPast: we < todayStr,
              };
            });
            return (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(v => !v)}
                  onBlur={() => setTimeout(() => setShowMenu(false), 150)}
                  className="h-8 w-8 rounded-md border border-[hsl(var(--border))] flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg z-50 overflow-hidden">
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      Gerar faturamento
                    </p>
                    {monthWeeks.map((wk, i) => (
                      <button
                        key={wk.weekStart}
                        onMouseDown={() => generateReceipt(wk.weekStart, wk.weekEnd)}
                        disabled={!wk.isPast}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-left disabled:opacity-35 disabled:cursor-not-allowed">
                        <span>Sem. {i + 1} · {wk.label}</span>
                        {wk.isLast && (
                          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                            última
                          </span>
                        )}
                      </button>
                    ))}
                    <div className="h-px bg-[hsl(var(--border))] mx-3 my-1" />
                    <button
                      onMouseDown={() => generateReceipt(lastWeekStart, lastWeekEnd)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-left text-[hsl(var(--muted-foreground))]">
                      Última semana concluída
                    </button>
                    <div className="pb-1" />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
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
                  const slotEditors = slot.editors ?? [];
                  const hasEditors      = slotEditors.length > 0;
                  const avail           = editors.filter(e => !slotEditors.some(se => se.id === e.id));
                  const hasWeekendEntry = slotEditors.some(ed => ed.slotType === "normal");
                  const hasHolidayNote  = !!slot.notes;
                  const isEmpty         = slotEditors.length === 0 && !hasHolidayNote;

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
                      <div className="flex items-start justify-between mb-0.5">
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
                        {(isEmpty || hasHolidayNote || hasEditors) && (avail.length > 0 || isEmpty) && (
                          <div className="relative">
                            <button
                              onClick={() => setAddDropdown(addDropdown === iso ? null : iso)}
                              className={`h-4 w-4 rounded-full border border-dashed flex items-center justify-center transition-colors ${
                                isWknd
                                  ? "border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]/50 hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
                                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-amber-400 hover:text-amber-500"
                              }`}>
                              <Plus className="h-2 w-2" />
                            </button>
                            {addDropdown === iso && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setAddDropdown(null)} />
                                <div className="absolute right-0 top-6 z-50 w-44 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md py-1 text-sm">
                                  {isEmpty && (
                                    <button
                                      onClick={() => { setAddDropdown(null); setEventModal({ iso }); }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors">
                                      Adicionar Evento
                                    </button>
                                  )}
                                  {!isEmpty && !hasHolidayNote && avail.length > 0 && (
                                    <>
                                      <button
                                        onClick={() => { setAddDropdown(null); setEventModal({ iso }); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors">
                                        Adicionar Evento
                                      </button>
                                      <div className="h-px bg-[hsl(var(--border))] my-1" />
                                      <button
                                        onClick={() => { setAddDropdown(null); setAddModal({ iso }); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors">
                                        Adicionar Plantão
                                      </button>
                                    </>
                                  )}
                                  {hasHolidayNote && avail.length > 0 && (
                                    <button
                                      onClick={() => { setAddDropdown(null); setAddModal({ iso }); }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors">
                                      Adicionar Plantão
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Event title — editable */}
                      {slot.notes && (
                        editingNotes?.iso === iso ? (
                          <input
                            autoFocus
                            value={editingNotes.value}
                            onChange={e => setEditingNotes({ iso, value: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === "Enter") { updateEventNotes(iso, editingNotes.value); setEditingNotes(null); }
                              if (e.key === "Escape") setEditingNotes(null);
                            }}
                            onBlur={() => { updateEventNotes(iso, editingNotes.value); setEditingNotes(null); }}
                            className="w-full mb-1 text-[9px] font-bold uppercase tracking-wide bg-transparent border-b border-amber-400 outline-none text-amber-700 dark:text-amber-400 leading-tight px-0.5"
                          />
                        ) : (
                          <div className="flex items-center gap-0.5 mb-1 group/note">
                            <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide leading-tight truncate flex-1 px-0.5">
                              {slot.notes}
                            </p>
                            <button
                              onClick={() => setEditingNotes({ iso, value: slot.notes! })}
                              className="opacity-0 group-hover/note:opacity-100 transition-opacity text-amber-600 hover:text-amber-400 shrink-0 p-0.5">
                              <Pencil className="h-2 w-2" />
                            </button>
                            <button
                              onClick={() => updateEventNotes(iso, null)}
                              className="opacity-0 group-hover/note:opacity-100 transition-opacity text-amber-600 hover:text-red-400 shrink-0 p-0.5">
                              <X className="h-2 w-2" />
                            </button>
                          </div>
                        )
                      )}

                      {/* Assigned editors */}
                      <div className="flex flex-col gap-0.5 flex-1">
                        {slotEditors.map(ed => (
                          <div key={ed.scheduleId} className="flex items-center gap-1.5 group">
                            <AvatarDisplay name={ed.name} avatarUrl={ed.avatarUrl} size={24} />
                            <span className="text-[11px] font-semibold leading-none truncate flex-1">
                              {ed.name.split(" ")[0]}
                            </span>
                            <span className={`shrink-0 text-[8px] font-bold leading-none px-1 py-0.5 rounded group-hover:hidden ${
                              ed.slotType === "normal"
                                ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
                                : "bg-amber-400/15 text-amber-600 dark:text-amber-400"
                            }`}>
                              {ed.slotType === "normal" ? "N" : "E"}
                            </span>
                            <button
                              onClick={() => removeEntry(ed.scheduleId)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[hsl(var(--muted-foreground))] hover:text-destructive">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Evento modal ──────────────────────────────────────────────────── */}
      {eventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setEventModal(null); setEventModalName(""); }} />
          <div className="relative bg-[hsl(var(--card))] rounded-2xl shadow-2xl w-full max-w-xs flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
              <p className="text-xs font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Evento</p>
              <p className="text-sm font-semibold mt-0.5">{fmtSingleDate(eventModal.iso)}</p>
            </div>
            <div className="px-5 py-4">
              <input
                type="text"
                placeholder="Nome do evento…"
                value={eventModalName}
                onChange={e => setEventModalName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !eventModalSaving && createEvent(eventModal.iso, eventModalName)}
                autoFocus
                className="w-full h-9 px-3 text-sm rounded-lg border border-[hsl(var(--border))]
                  bg-[hsl(var(--background))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              />
            </div>
            <div className="px-5 pb-4 flex justify-end gap-2">
              <button
                onClick={() => { setEventModal(null); setEventModalName(""); }}
                className="h-8 px-4 text-xs font-semibold rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                Cancelar
              </button>
              <button
                disabled={eventModalSaving}
                onClick={async () => { setEventModalSaving(true); await createEvent(eventModal.iso, eventModalName); setEventModalSaving(false); }}
                className="h-8 px-4 text-xs font-semibold rounded-lg bg-[hsl(var(--primary))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                {eventModalSaving ? "…" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Adicionar Plantão modal ────────────────────────────────────────── */}
      {addModal && (() => {
        const modalSlot  = getSlotOrEmpty(addModal.iso);
        const modalAvail = editors.filter(e => !modalSlot.editors.some(se => se.id === e.id));
        const close      = () => { setAddModal(null); setAddModalSelected(null); };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/50" onClick={close} />
            <div className="relative bg-[hsl(var(--card))] rounded-2xl shadow-2xl w-full max-w-xs flex flex-col max-h-[70vh] overflow-hidden">

              {/* Colored header band */}
              <div className="bg-[hsl(var(--primary))] px-4 py-4 shrink-0 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Plantonista</p>
                  <p className="text-sm font-bold text-white mt-0.5">{fmtSingleDate(addModal.iso)}</p>
                </div>
                <button onClick={close} className="h-6 w-6 rounded-full bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center mt-0.5">
                  <X className="h-3.5 w-3.5 text-white" />
                </button>
              </div>

              {/* Editor list */}
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[hsl(var(--border))]/60">
                {modalAvail.length === 0 ? (
                  <p className="text-sm text-center py-10 italic text-[hsl(var(--muted-foreground))]">
                    Todos os editores já escalados.
                  </p>
                ) : modalAvail.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={32} />
                    <span className="text-sm font-medium flex-1 truncate">{e.name}</span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        disabled={addModalAdding}
                        onClick={async () => {
                          setAddModalAdding(true);
                          await addEditor(addModal.iso, e.id, "normal", null);
                          setAddModalAdding(false);
                        }}
                        className="h-6 px-2.5 rounded-md text-[10px] font-bold
                          bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]
                          hover:bg-[hsl(var(--primary))]/20 transition-colors disabled:opacity-40">
                        Normal
                      </button>
                      <button
                        disabled={addModalAdding}
                        onClick={async () => {
                          setAddModalAdding(true);
                          await addEditor(addModal.iso, e.id, "extra", null);
                          setAddModalAdding(false);
                        }}
                        className="h-6 px-2.5 rounded-md text-[10px] font-bold
                          bg-amber-400/10 text-amber-600 dark:text-amber-400
                          hover:bg-amber-400/20 transition-colors disabled:opacity-40">
                        Extra
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

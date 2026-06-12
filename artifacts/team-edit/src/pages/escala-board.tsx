import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Plus, X, CalendarOff, ChevronRight } from "lucide-react";
import { apiFetch, apiPut } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { todayStr, parseDate } from "@/lib/date";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface WorkloadEditor {
  id: number; name: string; login: string; avatarUrl: string | null;
  hoursToday: number; dailyCap: number; taskCount: number;
  byStatus: { pending: number; in_progress: number; review: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreInfo(hoursToday: number, dailyCap: number) {
  const cap = dailyCap || 8;
  if (hoursToday === 0)     return { label: "disponível",    color: "hsl(var(--primary))", order: 0 };
  if (hoursToday < cap / 2) return { label: "ocupado",       color: "#facc15",             order: 1 };
  if (hoursToday < cap)     return { label: "muito ocupado", color: "#fb923c",             order: 2 };
  return                           { label: "no limite",     color: "#f87171",             order: 3 };
}

const DOW_PT = ["dom","seg","ter","qua","qui","sex","sáb"];
const MON_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function fmtToday(): string {
  const d = new Date();
  return `${DOW_PT[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}/${MON_PT[d.getMonth()]}`;
}

function fmtHoliday(dateStr: string) {
  const d = parseDate(dateStr);
  return {
    dow:  DOW_PT[d.getDay()],
    day:  String(d.getDate()).padStart(2, "0"),
    mon:  MON_PT[d.getMonth()],
    year: String(d.getFullYear()),
  };
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = 48 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full" />;
  const bg = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0) % 8];
  return (
    <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full"
      style={{ background: bg, fontSize: size * 0.36 }}>{initials}</div>
  );
}

// ── Holiday Panel ─────────────────────────────────────────────────────────────

function HolidayPanel() {
  const [holidays, setHolidays] = useState<string[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [newDate,  setNewDate]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayStr();

  useEffect(() => {
    apiFetch<{ holidays: string[] }>("/api/calendar-config")
      .then(d => setHolidays(d.holidays ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (list: string[]) => {
    setSaving(true);
    try {
      const res = await apiPut<{ holidays: string[] }>("/api/calendar-config", { holidays: list });
      setHolidays(res.holidays);
    } catch {} finally { setSaving(false); }
  };

  const add = async () => {
    if (!newDate || holidays.includes(newDate)) return;
    await save([...holidays, newDate].sort());
    setNewDate("");
    inputRef.current?.focus();
  };

  const future = holidays.filter(h => h >= today).sort();
  const past   = holidays.filter(h => h < today).sort().reverse().slice(0, 5);

  return (
    <div className="mt-14 max-w-sm">
      <div className="flex items-center gap-3 mb-6">
        <CalendarOff className="h-4 w-4" style={{ color: "hsl(var(--muted-foreground))" }} />
        <p className="text-xs font-black uppercase tracking-widest"
          style={{ color: "hsl(var(--muted-foreground))" }}>feriados</p>
        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
          supervisor
        </span>
      </div>

      <div className="flex gap-2 mb-6">
        <input ref={inputRef} type="date" value={newDate}
          onChange={e => setNewDate(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          className="flex-1 h-10 px-3 text-sm rounded-xl focus:outline-none"
          style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
        <button onClick={add} disabled={!newDate || saving}
          className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30"
          style={{ background: "hsl(var(--primary))" }}>
          <Plus className="h-4 w-4 text-white" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: "hsl(var(--muted))" }} />
          ))}
        </div>
      ) : future.length === 0 ? (
        <p className="text-sm" style={{ color: "hsl(var(--muted-foreground)/0.4)" }}>
          nenhum feriado cadastrado.
        </p>
      ) : (
        <div className="space-y-2">
          {future.map(date => {
            const { dow, day, mon, year } = fmtHoliday(date);
            return (
              <div key={date} className="flex items-center gap-3 rounded-xl px-4 py-2.5"
                style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#f59e0b" }} />
                <span className="text-[9px] font-black uppercase tracking-widest w-6"
                  style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>{dow}</span>
                <span className="text-sm font-black tabular-nums flex-1">
                  {day} <span className="font-medium text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {mon}{year !== String(new Date().getFullYear()) ? ` ${year}` : ""}
                  </span>
                </span>
                <button onClick={() => save(holidays.filter(h => h !== date))} disabled={saving}
                  className="h-6 w-6 rounded-lg flex items-center justify-center hover:opacity-60 disabled:opacity-30"
                  style={{ background: "hsl(var(--muted))" }}>
                  <X className="h-3 w-3" style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2"
            style={{ color: "hsl(var(--muted-foreground)/0.3)" }}>anteriores</p>
          {past.map(date => {
            const { dow, day, mon } = fmtHoliday(date);
            return (
              <div key={date} className="flex items-center gap-3 px-3 py-1.5 rounded-lg opacity-35">
                <span className="text-[9px] font-black uppercase tracking-widest w-6"
                  style={{ color: "hsl(var(--muted-foreground))" }}>{dow}</span>
                <span className="text-xs font-bold tabular-nums flex-1">{day} {mon}</span>
                <button onClick={() => save(holidays.filter(h => h !== date))} disabled={saving}
                  className="h-5 w-5 rounded flex items-center justify-center hover:opacity-60">
                  <X className="h-3 w-3" style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function EscalaBoard() {
  usePageTitle("Agenda");
  const [, navigate] = useLocation();
  const { user }     = useAuth();
  const [editors, setEditors] = useState<WorkloadEditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const pageRef = useRef<HTMLDivElement>(null);

  const isSupervisor = user?.role === "supervisor" || user?.role === "admin";

  useEffect(() => {
    let el: HTMLElement | null = pageRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === "auto" || overflowY === "scroll") { el.scrollTop = 0; break; }
      el = el.parentElement;
    }
  }, []);

  useEffect(() => {
    apiFetch<WorkloadEditor[]>("/api/workload")
      .then(setEditors).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = editors
    .filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.login.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => scoreInfo(a.hoursToday, a.dailyCap).order - scoreInfo(b.hoursToday, b.dailyCap).order);

  // Stats
  const stats = {
    disponivel:   editors.filter(e => scoreInfo(e.hoursToday, e.dailyCap).order === 0).length,
    ocupado:      editors.filter(e => scoreInfo(e.hoursToday, e.dailyCap).order === 1).length,
    muitoOcupado: editors.filter(e => scoreInfo(e.hoursToday, e.dailyCap).order === 2).length,
    noLimite:     editors.filter(e => scoreInfo(e.hoursToday, e.dailyCap).order === 3).length,
  };

  return (
    <div ref={pageRef} className="min-h-screen px-6 py-10 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-end justify-between">
          <h1 className="text-7xl font-black tracking-tighter leading-none select-none"
            style={{ letterSpacing: "-0.04em" }}>
            agenda
          </h1>
          <span className="text-sm font-black tabular-nums mb-1"
            style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>
            {fmtToday()}
          </span>
        </div>

        {/* Stats strip */}
        {!loading && (
          <div className="flex flex-wrap gap-2 mt-4">
            {stats.disponivel > 0 && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
                {stats.disponivel} disponível{stats.disponivel !== 1 ? "is" : ""}
              </span>
            )}
            {stats.ocupado > 0 && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "#fef9c320", color: "#ca8a04" }}>
                {stats.ocupado} ocupado{stats.ocupado !== 1 ? "s" : ""}
              </span>
            )}
            {stats.muitoOcupado > 0 && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "#fff7ed40", color: "#ea580c" }}>
                {stats.muitoOcupado} muito ocupado{stats.muitoOcupado !== 1 ? "s" : ""}
              </span>
            )}
            {stats.noLimite > 0 && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "#fef2f220", color: "#dc2626" }}>
                {stats.noLimite} no limite
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
          style={{ color: "hsl(var(--muted-foreground))" }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="buscar editor…"
          className="w-full h-10 pl-11 pr-4 rounded-full text-sm font-medium focus:outline-none"
          style={{
            background: "hsl(var(--muted))",
            border: "1px solid hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        />
      </div>

      {/* ── Lista de editores ── */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "hsl(var(--muted))" }} />
          ))
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            nenhum editor encontrado
          </p>
        ) : (
          filtered.map(editor => {
            const { label, color } = scoreInfo(editor.hoursToday, editor.dailyCap);
            return (
              <button
                key={editor.id}
                onClick={() => navigate(`/agenda/${editor.id}`)}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all duration-150"
                style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = "translateX(4px)";
                  el.style.borderColor = `${color}50`;
                  el.style.background = `hsl(var(--card))`;
                  el.style.boxShadow = `0 2px 16px ${color}18`;
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = "";
                  el.style.borderColor = "hsl(var(--border))";
                  el.style.boxShadow = "";
                }}
              >
                {/* Avatar */}
                <div className="shrink-0" style={{ width: 44, height: 44 }}>
                  <div className="w-full h-full rounded-full overflow-hidden"
                    style={{ boxShadow: `0 0 0 2px ${color}` }}>
                    <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={44} />
                  </div>
                </div>

                {/* Nome + login */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black leading-tight truncate">
                    {editor.name}
                  </p>
                  <p className="text-[11px] font-mono mt-0.5 truncate"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    {editor.login}
                  </p>
                </div>

                {/* Status + breakdown */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ background: `${color}18`, color }}>
                    {label}
                  </span>
                  {editor.taskCount > 0 && (
                    <div className="flex items-center gap-1">
                      {editor.byStatus.pending > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "#fef3c730", color: "#d97706" }}>
                          {editor.byStatus.pending}p
                        </span>
                      )}
                      {editor.byStatus.in_progress > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
                          {editor.byStatus.in_progress}e
                        </span>
                      )}
                      {editor.byStatus.review > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "#f3e8ff30", color: "#9333ea" }}>
                          {editor.byStatus.review}r
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Seta */}
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--muted-foreground)/0.4)" }} />
              </button>
            );
          })
        )}
      </div>

      {/* ── Holiday panel ── */}
      {isSupervisor && <HolidayPanel />}
    </div>
  );
}

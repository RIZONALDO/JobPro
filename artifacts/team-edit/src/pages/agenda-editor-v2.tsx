import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { todayStr, toLocalDateStr, parseDate } from "@/lib/date";
import { usePageTitle } from "@/lib/use-page-title";

interface ScheduleSlot {
  taskId:    number;
  taskTitle: string;
  taskColor: string | null;
  client:    string | null;
  startTime: string | null;
  endTime:   string | null;
  hours:     number | null;
  status:    string;
}
interface ScheduleDay { date: string; slots: ScheduleSlot[]; }
interface EditorInfo   { id: number; name: string; login: string; avatarUrl: string | null; role: string; }

const DOW_PT = ["dom","seg","ter","qua","qui","sex","sáb"];

function fmtHours(h: number): string {
  const t = Math.round(h * 60);
  const hr = Math.floor(t / 60), mn = t % 60;
  if (hr === 0) return `${mn}min`;
  if (mn === 0) return `${hr}h`;
  return `${hr}h${mn}`;
}

function buildDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = parseDate(from);
  while (toLocalDateStr(d) <= to) { dates.push(toLocalDateStr(d)); d.setDate(d.getDate() + 1); }
  return dates;
}

function Avatar({ name, avatarUrl, size = 48 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full" />;
  const bg = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0) % 8];
  return (
    <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full"
      style={{ background: bg, fontSize: size * 0.36 }}>{initials}</div>
  );
}

export default function AgendaEditorV2() {
  const params   = useParams<{ id: string }>();
  const editorId = parseInt(params.id ?? "", 10);
  const [, navigate] = useLocation();

  const [editor,   setEditor]   = useState<EditorInfo | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [loading,  setLoading]  = useState(true);

  const today = todayStr();
  const toStr = toLocalDateStr(new Date(parseDate(today).getTime() + 14 * 86_400_000));

  usePageTitle(editor ? editor.name.split(" ")[0] : "Agenda");

  useEffect(() => {
    if (isNaN(editorId)) return;
    Promise.all([
      apiFetch<EditorInfo[]>("/api/users").then(u => u.find(x => x.id === editorId) ?? null),
      apiFetch<ScheduleDay[]>(`/api/escala/editor/${editorId}/schedule?from=${today}&to=${toStr}`),
    ]).then(([ed, sched]) => { setEditor(ed); setSchedule(sched); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [editorId]);

  const scheduleMap = new Map(schedule.map(d => [d.date, d.slots]));
  const allDates    = buildDateRange(today, toStr);

  // Total horas nos próximos 14 dias
  const totalHours = schedule.reduce((sum, d) => sum + d.slots.reduce((s, sl) => s + (sl.hours ?? 0), 0), 0);
  const busyDays   = schedule.length;

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>

      {/* Top bar */}
      <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between"
        style={{ background: "hsl(var(--background)/0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid hsl(var(--border))" }}>
        <button onClick={() => navigate("/agenda")}
          className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest transition-opacity hover:opacity-50"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <ArrowLeft className="h-3.5 w-3.5" /> agenda
        </button>

        {editor && !loading && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full overflow-hidden">
              <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={28} />
            </div>
            <span className="text-sm font-black">{editor.name.split(" ")[0]}</span>
          </div>
        )}
      </div>

      <div className="px-6 pt-8 pb-16 max-w-2xl mx-auto">

        {/* Stats strip */}
        {!loading && (
          <div className="flex gap-3 mb-10">
            <div className="flex-1 rounded-2xl px-5 py-4"
              style={{ background: "hsl(var(--primary)/0.08)", border: "1px solid hsl(var(--primary)/0.2)" }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1"
                style={{ color: "hsl(var(--primary)/0.7)" }}>horas</p>
              <p className="text-3xl font-black leading-none" style={{ color: "hsl(var(--primary))" }}>
                {fmtHours(totalHours)}
              </p>
              <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>próximos 14 dias</p>
            </div>
            <div className="flex-1 rounded-2xl px-5 py-4"
              style={{ background: "hsl(var(--muted)/0.5)", border: "1px solid hsl(var(--border))" }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}>dias ocupados</p>
              <p className="text-3xl font-black leading-none">{busyDays}</p>
              <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>de 14 disponíveis</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[52px] top-0 bottom-0 w-px"
            style={{ background: "hsl(var(--border))" }} />

          <div className="space-y-1">
            {loading
              ? [...Array(6)].map((_, i) => (
                  <div key={i} className="flex gap-4 py-3">
                    <div className="w-[52px] h-10 rounded-lg animate-pulse shrink-0" style={{ background: "hsl(var(--muted))" }} />
                    <div className="flex-1 h-10 rounded-xl animate-pulse" style={{ background: "hsl(var(--muted))" }} />
                  </div>
                ))
              : allDates.map(date => {
                  const slots   = scheduleMap.get(date) ?? [];
                  const d       = parseDate(date);
                  const isToday = date === today;
                  const dow     = DOW_PT[d.getDay()];
                  const day     = String(d.getDate()).padStart(2, "0");

                  return (
                    <div key={date} className="flex gap-0 items-start py-2">

                      {/* Date label */}
                      <div className="w-[52px] shrink-0 text-right pr-4 pt-1">
                        <p className="text-[9px] font-black uppercase tracking-widest leading-none"
                          style={{ color: isToday ? "hsl(var(--primary))" : "hsl(var(--muted-foreground)/0.5)" }}>
                          {dow}
                        </p>
                        <p className="text-base font-black leading-tight"
                          style={{ color: isToday ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                          {day}
                        </p>
                      </div>

                      {/* Content */}
                      <div className="flex-1 pl-4 space-y-1.5">
                        {slots.length === 0 ? (
                          <div className="h-8 flex items-center">
                            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground)/0.35)" }}>
                              livre
                            </span>
                          </div>
                        ) : (
                          slots.map((slot, i) => {
                            const color = slot.taskColor ?? "hsl(var(--primary))";
                            return (
                              <div key={i}
                                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                                style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>

                                {/* Color dot */}
                                <div className="w-2 h-2 rounded-full shrink-0"
                                  style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />

                                {/* Time */}
                                {slot.startTime && slot.endTime && (
                                  <span className="text-[10px] font-mono font-bold shrink-0"
                                    style={{ color: "hsl(var(--muted-foreground))" }}>
                                    {slot.startTime}–{slot.endTime}
                                  </span>
                                )}

                                {/* Title */}
                                <span className="text-xs font-black flex-1 truncate">{slot.taskTitle}</span>

                                {/* Duration chip */}
                                {slot.hours != null && slot.hours > 0 && (
                                  <span className="text-[9px] font-black font-mono shrink-0 px-1.5 py-0.5 rounded-md"
                                    style={{ background: `${color}18`, color }}>
                                    {fmtHours(slot.hours)}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>
    </div>
  );
}

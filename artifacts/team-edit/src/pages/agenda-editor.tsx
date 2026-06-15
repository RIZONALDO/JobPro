import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Sparkles } from "lucide-react";
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
interface ScheduleDay {
  date:  string;
  slots: ScheduleSlot[];
}
interface EditorInfo {
  id: number;
  name: string;
  login: string;
  avatarUrl: string | null;
  role: string;
}

const DOW_PT = ["dom","seg","ter","qua","qui","sex","sáb"];

function fmtDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "hoje";
  const d = parseDate(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${DOW_PT[d.getDay()]} ${dd}/${mm}`;
}

function fmtHours(h: number): string {
  const total = Math.round(h * 60);
  const hrs = Math.floor(total / 60);
  const min = total % 60;
  if (hrs === 0) return `${min}min`;
  if (min === 0) return `${hrs}h`;
  return `${hrs}h${min}min`;
}

function Avatar({ name, avatarUrl, size = 64 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full" />;
  const colors = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"];
  const bg = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full"
      style={{ background: bg, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}

// Builds the next 14 days as YYYY-MM-DD strings
function buildDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = parseDate(from);
  const end = parseDate(to);
  while (toLocalDateStr(d) <= toLocalDateStr(end)) {
    dates.push(toLocalDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function AgendaEditorPage() {
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
      apiFetch<EditorInfo[]>("/api/users").then(users => users.find(u => u.id === editorId) ?? null),
      apiFetch<ScheduleDay[]>(`/api/escala/editor/${editorId}/schedule?from=${today}&to=${toStr}`),
    ])
      .then(([ed, sched]) => {
        setEditor(ed);
        setSchedule(sched);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [editorId]);

  const scheduleMap = new Map(schedule.map(d => [d.date, d.slots]));
  const allDates    = buildDateRange(today, toStr);

  return (
    <div className="min-h-screen px-6 py-8 max-w-2xl mx-auto">

      {/* Back */}
      <button
        onClick={() => navigate("/agenda")}
        className="flex items-center gap-2 text-sm font-black uppercase tracking-widest mb-10 transition-opacity hover:opacity-60"
        style={{ color: "hsl(var(--muted-foreground))" }}>
        <ArrowLeft className="h-4 w-4" />
        agenda
      </button>

      {/* Editor header */}
      {loading ? (
        <div className="flex items-center gap-5 mb-12">
          <div className="w-16 h-16 rounded-full animate-pulse" style={{ background: "hsl(var(--muted))" }} />
          <div className="space-y-2">
            <div className="h-8 w-40 rounded-lg animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            <div className="h-4 w-20 rounded-lg animate-pulse" style={{ background: "hsl(var(--muted))" }} />
          </div>
        </div>
      ) : editor ? (
        <div className="flex items-center gap-5 mb-12">
          <div className="w-16 h-16 rounded-full overflow-hidden shrink-0"
            style={{ boxShadow: "0 0 0 2.5px hsl(var(--primary))" }}>
            <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={64} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight leading-none lowercase">
              {editor.name.split(" ")[0]}
            </h1>
            <p className="text-xs font-bold uppercase tracking-widest mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}>
              {editor.name.split(" ").slice(1).join(" ") || "editor"}
            </p>
          </div>
        </div>
      ) : null}

      {/* Schedule days */}
      {loading ? (
        <div className="space-y-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 w-24 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
              <div className="h-16 rounded-2xl animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {allDates.map(date => {
            const slots = scheduleMap.get(date) ?? [];
            const label = fmtDayLabel(date, today);
            const isToday = date === today;

            return (
              <div key={date}>
                {/* Day label */}
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-full"
                    style={isToday
                      ? { background: "hsl(var(--primary))", color: "white" }
                      : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                    }>
                    {label}
                  </span>
                </div>

                {slots.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                    style={{ background: "hsl(var(--muted)/0.4)" }}>
                    <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--muted-foreground))" }} />
                    <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                      livre
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {slots.map((slot, i) => {
                      const color = slot.taskColor ?? "#6366f1";
                      return (
                        <div key={i}
                          className="flex items-stretch gap-0 rounded-2xl overflow-hidden"
                          style={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                          }}>
                          {/* Color stripe */}
                          <div className="w-1 shrink-0" style={{ background: color }} />

                          <div className="flex items-center gap-4 px-4 py-3 flex-1 min-w-0">
                            {/* Time */}
                            <div className="shrink-0 text-right">
                              {slot.startTime && slot.endTime ? (
                                <>
                                  <p className="text-xs font-black font-mono leading-tight">{slot.startTime}</p>
                                  <p className="text-[10px] font-mono leading-tight"
                                    style={{ color: "hsl(var(--muted-foreground))" }}>
                                    {slot.endTime}
                                  </p>
                                </>
                              ) : (
                                <p className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>—</p>
                              )}
                            </div>

                            {/* Divider */}
                            <div className="w-px self-stretch" style={{ background: "hsl(var(--border))" }} />

                            {/* Task info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-black truncate">{slot.taskTitle}</p>
                              {slot.client && (
                                <p className="text-[11px] truncate mt-0.5"
                                  style={{ color: "hsl(var(--muted-foreground))" }}>
                                  {slot.client}
                                </p>
                              )}
                            </div>

                            {/* Duration */}
                            {slot.hours != null && slot.hours > 0 && (
                              <span className="shrink-0 text-[10px] font-black font-mono px-2 py-0.5 rounded-md"
                                style={{ background: `${color}18`, color }}>
                                {fmtHours(slot.hours)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

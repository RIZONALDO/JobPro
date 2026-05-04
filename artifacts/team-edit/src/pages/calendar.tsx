import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { toLocalDate } from "@/lib/utils";
import { usePageTitle } from "@/lib/use-page-title";

interface CalendarTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  jobId: number;
  jobName: string | null;
  assignedToId: number | null;
  assigneeName: string | null;
}

const PRIORITY_COLOR: Record<string, string> = {
  low: "border-l-green-400",
  medium: "border-l-amber-400",
  high: "border-l-red-400",
};

const DAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDay(d: Date): string {
  return `${d.getDate()} ${MONTHS_PT[d.getMonth()]}`;
}

export default function Calendar() {
  usePageTitle("Calendário");
  const { user } = useAuth();
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<CalendarTask[]>(`/api/calendar?week=${fmt(weekStart)}`)
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar calendário", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [weekStart]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = toLocalDate(new Date());

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS_PT[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;

  // Compare task dueDate (may be full ISO string) against the column's local date.
  const tasksByDay = (day: Date) =>
    tasks.filter(t => t.dueDate && toLocalDate(new Date(t.dueDate)) === toLocalDate(day));

  const isCoord = user?.role !== "editor";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5 text-[hsl(var(--primary))]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Meu Calendário</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {isCoord ? "Tarefas que você atribuiu" : "Suas tarefas"}
            </p>
          </div>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setWeekStart(d => addDays(d, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">{weekLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setWeekStart(d => addDays(d, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => setWeekStart(getMonday(new Date()))}>
            Hoje
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {weekDays.map((day, i) => {
            const isToday = fmt(day) === today;
            return (
              <div key={i} className={`px-2 py-3 text-center border-r last:border-r-0 ${isToday ? "bg-[hsl(var(--primary))]/5" : "bg-[hsl(var(--muted))]/30"}`}>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  {DAYS_PT[i]}
                </p>
                <p className={`text-lg font-bold mt-0.5 leading-none ${isToday ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
                  {day.getDate()}
                </p>
                {isToday && <div className="h-1 w-1 rounded-full bg-[hsl(var(--primary))] mx-auto mt-1" />}
              </div>
            );
          })}
        </div>

        {/* Task rows */}
        <div className="grid grid-cols-7 min-h-[400px]">
          {weekDays.map((day, i) => {
            const isToday = fmt(day) === today;
            const dayTasks = tasksByDay(day);
            return (
              <div key={i} className={`border-r last:border-r-0 p-2 space-y-1.5 align-top ${isToday ? "bg-[hsl(var(--primary))]/5" : ""}`}>
                {loading ? (
                  <div className="h-8 rounded bg-[hsl(var(--muted))]/50 animate-pulse" />
                ) : dayTasks.length === 0 ? null : dayTasks.map(t => (
                  <div key={t.id}
                    className={`rounded-lg border bg-white px-2 py-1.5 border-l-2 ${PRIORITY_COLOR[t.priority] ?? "border-l-slate-300"} shadow-sm`}>
                    <p className="text-xs font-medium leading-tight line-clamp-2">{t.title}</p>
                    {t.jobName && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{t.jobName}</p>
                    )}
                    <div className="flex items-center justify-between mt-1 gap-1 flex-wrap">
                      <Badge className={`text-[9px] px-1 py-0 leading-4 ${STATUS_CLASS[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      {isCoord && t.assigneeName && (
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                          {t.assigneeName.split(" ")[0]}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

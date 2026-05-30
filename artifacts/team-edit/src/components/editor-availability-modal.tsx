import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { toLocalDate } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";

interface DayData { date: string; score: number; count: number; }

interface Editor { id: number; name: string; avatarUrl?: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editor: Editor | null;
}

function scoreColor(score: number): string {
  if (score === 0)  return "transparent";
  if (score <= 6)   return "#eab308";
  if (score <= 11)  return "#f97316";
  return "#ef4444";
}
function scoreLabel(score: number): string {
  if (score === 0)  return "Livre";
  if (score <= 6)   return "Ocupado";
  if (score <= 11)  return "Muito ocupado";
  return "No limite";
}
function scoreBg(score: number): string {
  if (score === 0)  return "bg-transparent";
  if (score <= 6)   return "bg-yellow-100 dark:bg-yellow-950/50";
  if (score <= 11)  return "bg-orange-100 dark:bg-orange-950/50";
  return "bg-red-100 dark:bg-red-950/50";
}
function scoreText(score: number): string {
  if (score === 0)  return "text-[hsl(var(--muted-foreground))]";
  if (score <= 6)   return "text-yellow-700 dark:text-yellow-400";
  if (score <= 11)  return "text-orange-700 dark:text-orange-400";
  return "text-red-700 dark:text-red-400";
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

export function EditorAvailabilityModal({ open, onOpenChange, editor }: Props) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [days,  setDays]  = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !editor) return;
    setLoading(true);
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    apiFetch<DayData[]>(`/api/workload/calendar?editorId=${editor.id}&month=${monthStr}`)
      .then(setDays)
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [open, editor, year, month]);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = toLocalDate(new Date());

  // Map date string → DayData for quick lookup
  const dayMap = new Map(days.map(d => [d.date, d]));

  // Grid cells: nulls for leading empty days
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <div className="flex items-center gap-3">
            {editor && (
              <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={36} className="shrink-0" />
            )}
            <DialogTitle className="text-base font-semibold">
              {editor?.name ?? "Editor"} — Mapa de disponibilidade
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={prevMonth}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="text-base font-bold">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={nextMonth}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-[hsl(var(--muted-foreground))] py-1.5 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-[hsl(var(--muted))]/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const monthStr = `${year}-${String(month).padStart(2, "0")}`;
                const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
                const data = dayMap.get(dateStr);
                const score = data?.score ?? 0;
                const count = data?.count ?? 0;
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;
                return (
                  <div
                    key={i}
                    title={`${day}/${month}: ${scoreLabel(score)}${count > 0 ? ` (${count} tarefa${count !== 1 ? "s" : ""})` : ""}`}
                    className={`
                      relative flex flex-col items-center justify-center h-16 rounded-xl text-sm font-semibold
                      transition-colors cursor-default select-none
                      ${isPast ? "opacity-35" : ""}
                      ${score > 0 ? scoreBg(score) : "hover:bg-[hsl(var(--muted))]/40"}
                      ${isToday ? "ring-2 ring-[hsl(var(--primary))] ring-offset-2" : ""}
                    `}
                  >
                    <span className={`leading-none ${scoreText(score)}`}>{day}</span>
                    {count > 0 && (
                      <LockKeyhole className={`h-3.5 w-3.5 mt-1 shrink-0 ${scoreText(score)}`} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 pt-1 flex-wrap justify-center">
            {[
              { color: "bg-[hsl(var(--muted))]/50", label: "Livre" },
              { color: "bg-yellow-100 dark:bg-yellow-950/50", label: "Ocupado" },
              { color: "bg-orange-100 dark:bg-orange-950/50", label: "Muito ocupado" },
              { color: "bg-red-100 dark:bg-red-950/50", label: "No limite" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`h-3.5 w-3.5 rounded shrink-0 ${color} border border-[hsl(var(--border))]/40`} />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-[hsl(var(--muted-foreground))]/50 text-center leading-snug pb-1">
            Cadeado = editor com tarefas ativas · baseado em início→prazo de cada tarefa
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

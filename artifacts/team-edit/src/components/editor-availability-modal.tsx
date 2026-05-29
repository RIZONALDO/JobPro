import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DayData { date: string; score: number; count: number; }

interface Editor { id: number; name: string; avatarUrl?: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editor: Editor | null;
}

function scoreColor(score: number): string {
  if (score === 0)  return "transparent";
  if (score <= 6)   return "#22c55e";
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
  if (score <= 6)   return "bg-green-100 dark:bg-green-950/50";
  if (score <= 11)  return "bg-orange-100 dark:bg-orange-950/50";
  return "bg-red-100 dark:bg-red-950/50";
}
function scoreText(score: number): string {
  if (score === 0)  return "text-[hsl(var(--muted-foreground))]";
  if (score <= 6)   return "text-green-700 dark:text-green-400";
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
  const todayStr = new Date().toISOString().split("T")[0];

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
      <DialogContent className="max-w-sm w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <div className="flex items-center gap-2.5">
            {editor && (
              <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={28} className="shrink-0" />
            )}
            <DialogTitle className="text-sm font-semibold">
              {editor?.name ?? "Editor"} — Disponibilidade
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-[hsl(var(--muted-foreground))] py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {loading ? (
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-9 rounded-lg bg-[hsl(var(--muted))]/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-0.5">
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
                      relative flex flex-col items-center justify-center h-9 rounded-lg text-[11px] font-medium
                      transition-colors cursor-default select-none
                      ${isPast ? "opacity-40" : ""}
                      ${score > 0 ? scoreBg(score) : "hover:bg-[hsl(var(--muted))]/40"}
                      ${isToday ? "ring-2 ring-[hsl(var(--primary))] ring-offset-1" : ""}
                    `}
                  >
                    <span className={`leading-none ${scoreText(score)}`}>{day}</span>
                    {count > 0 && (
                      <span className={`text-[8px] leading-none mt-0.5 font-semibold ${scoreText(score)}`}>
                        {count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3 pt-1 flex-wrap justify-center">
            {[
              { color: "bg-[hsl(var(--muted))]/50", label: "Livre" },
              { color: "bg-green-100 dark:bg-green-950/50", label: "Ocupado" },
              { color: "bg-orange-100 dark:bg-orange-950/50", label: "Muito ocupado" },
              { color: "bg-red-100 dark:bg-red-950/50", label: "No limite" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`h-3 w-3 rounded-sm shrink-0 ${color} border border-[hsl(var(--border))]/40`} />
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{label}</span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 text-center leading-snug pb-1">
            Número = tarefas ativas no dia · baseado em início→prazo de cada tarefa
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

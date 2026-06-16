import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { toLocalDate } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DayData { date: string; score: number; count: number; }
interface Editor { id: number; name: string; avatarUrl?: string | null; }
interface Props { open: boolean; onOpenChange: (v: boolean) => void; editor: Editor | null; }

const WEEKDAYS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

export function EditorAvailabilityModal({ open, onOpenChange, editor }: Props) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days,  setDays]  = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !editor) return;
    setLoading(true);
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    apiFetch<DayData[]>(`/api/workload/calendar?editorId=${editor.id}&month=${monthStr}`)
      .then(setDays).catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [open, editor, year, month]);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = toLocalDate(new Date());
  const dayMap = new Map(days.map(d => [d.date, d]));

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <div className="flex items-center gap-3">
            {editor && <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={36} className="shrink-0" />}
            <DialogTitle className="text-base font-semibold">{editor?.name ?? "Editor"} — Disponibilidade</DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={prevMonth}><ChevronLeft className="h-5 w-5" /></Button>
            <span className="text-base font-bold">{MONTH_NAMES[month - 1]} {year}</span>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={nextMonth}><ChevronRight className="h-5 w-5" /></Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-[hsl(var(--muted-foreground))] py-1.5 uppercase tracking-wide">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-[hsl(var(--muted))]/40 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const count = dayMap.get(dateStr)?.count ?? 0;
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;
                const busy = count > 0;
                return (
                  <div key={i}
                    title={busy ? `${count} tarefa${count !== 1 ? "s" : ""}` : "Livre"}
                    className={`relative flex flex-col items-center justify-center h-16 rounded-xl text-sm font-semibold transition-colors cursor-default select-none
                      ${isPast ? "opacity-35" : ""}
                      ${busy ? "bg-[hsl(var(--primary))]/10" : "hover:bg-[hsl(var(--muted))]/40"}
                      ${isToday ? "ring-2 ring-[hsl(var(--primary))] ring-offset-2" : ""}
                    `}
                  >
                    <span className={busy ? "text-[hsl(var(--primary))]" : ""}>{day}</span>
                    {busy && (
                      <span className="text-[10px] font-semibold text-[hsl(var(--primary))]/70 mt-0.5">{count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-4 pt-1 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="h-3.5 w-3.5 rounded bg-[hsl(var(--muted))]/50 border border-[hsl(var(--border))]/40" />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Livre</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3.5 w-3.5 rounded bg-[hsl(var(--primary))]/10 border border-[hsl(var(--border))]/40" />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Com tarefas</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Avisos: só as notificações importantes (`IMPORTANT` em lib/notices.ts), o que pede atenção ou ação. O informativo
 * fica no sininho. Os não vistos vêm primeiro e em destaque; clicar abre o job e marca como visto.
 */
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { apiFetch, apiPut } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useRealtime } from "@/hooks/use-realtime";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { AlertOctagon, Bell, CheckCheck, Eye, HandPalm, RotateCcw, Timer, Undo2, UserPlus, XCircle, AlertTriangle } from "@/lib/icons";
import { IMPORTANT, isImportant, type AppNotification } from "@/lib/notices";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  due_passed: Timer, queue_blocked: HandPalm, queue_escalated: AlertOctagon, task_review: Eye, task_revision: RotateCcw,
  task_reopened: RotateCcw, task_returned: Undo2, task_paused: HandPalm, task_cancelled: XCircle, task_assigned: UserPlus,
};
const TILE = {
  bad: "bg-rose-500/15 text-rose-500",
  warn: "bg-amber-500/15 text-amber-500",
  info: "bg-sky-500/15 text-sky-500",
};

/** "agora", "há 12 min", "há 3h", "ontem 16:20", "qua 22/10" */
function when(iso: string) {
  const d = new Date(iso), m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  if (m < 6 * 60) return `há ${Math.round(m / 60)}h`;
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86_400_000);
  const diff = day(new Date()) - day(d), hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `hoje ${hh}`;
  if (diff === 1) return `ontem ${hh}`;
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}

export function Notices({ className, limit = 8 }: { className?: string; limit?: number }) {
  const { openTask } = useTaskModal();
  const [list, setList] = useState<AppNotification[]>([]);
  const [all, setAll] = useState(false);
  const load = useCallback(() => apiFetch<AppNotification[]>("/api/notifications").then(d => setList(d.filter(isImportant))).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useRealtime({ onTasksChanged: load });
  useEffect(() => {
    const s = getSocket(), on = (n: AppNotification) => { if (isImportant(n)) setList(l => [n, ...l.filter(x => x.id !== n.id)]); };
    s.on("notification:new", on);
    return () => { s.off("notification:new", on); };
  }, []);

  const unread = list.filter(n => !n.read);
  // não vistos primeiro; dentro de cada grupo, do mais novo para o mais antigo
  const sorted = [...unread, ...list.filter(n => n.read)];
  const shown = all ? sorted : sorted.slice(0, limit);
  const seen = async (n: AppNotification) => {
    if (n.read) return;
    setList(l => l.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    await apiPut(`/api/notifications/${n.id}/read`, {}).catch(() => {});
  };
  const seenAll = async () => {
    const ids = unread.map(n => n.id);
    setList(l => l.map(x => ({ ...x, read: true })));
    await Promise.all(ids.map(id => apiPut(`/api/notifications/${id}/read`, {}).catch(() => {})));
  };

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-2xl border bg-[hsl(var(--card))]", className)}>
      <header className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-bold">
          <Bell className="h-4 w-4 text-[hsl(var(--primary))]" />Avisos
          {unread.length > 0 && <span className="rounded-full bg-rose-500/15 px-1.5 text-[11px] font-bold leading-5 tabular-nums text-rose-500">{unread.length}</span>}
        </h2>
        {unread.length > 0 && (
          <button type="button" onClick={seenAll} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]">
            <CheckCheck className="h-3.5 w-3.5" />Marcar como vistos
          </button>
        )}
      </header>
      {shown.length ? (
        <ul className="flex min-h-0 flex-1 flex-col overflow-auto px-1.5 pb-1.5">
          {shown.map(n => {
            const tone = IMPORTANT[n.type] ?? "info", Ico = ICON[n.type] ?? AlertTriangle;
            return (
              <li key={n.id}>
                <button type="button" onClick={() => { seen(n); if (n.taskId) openTask(n.taskId); }}
                  className={cn("group flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[hsl(var(--foreground)/0.05)]", n.read && "opacity-60 hover:opacity-100")}>
                  <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", TILE[tone])}><Ico className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <b className={cn("truncate text-[13px] leading-5", n.read ? "font-medium" : "font-semibold")}>{n.title}</b>
                      <time className="shrink-0 text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">{when(n.createdAt)}</time>
                    </span>
                    <span className="line-clamp-2 text-[12.5px] leading-[18px] text-[hsl(var(--muted-foreground))]">{n.message}</span>
                  </span>
                  {!n.read && <i className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" aria-label="não visto" />}
                </button>
              </li>
            );
          })}
          {sorted.length > limit && (
            <li><button type="button" onClick={() => setAll(v => !v)} className="w-full rounded-lg py-1.5 text-[12px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.05)] hover:text-[hsl(var(--foreground))]">
              {all ? "Mostrar menos" : `Ver todos (${sorted.length})`}
            </button></li>
          )}
        </ul>
      ) : (
        <p className="px-3.5 pb-4 pt-1 text-[13px] text-[hsl(var(--muted-foreground))]">Nada importante agora. O resto fica no sininho.</p>
      )}
    </section>
  );
}

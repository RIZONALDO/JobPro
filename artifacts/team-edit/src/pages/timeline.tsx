import { useEffect, useState, useMemo, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { fmtDate } from "@/lib/utils";
import { usePageTitle } from "@/lib/use-page-title";
import { Tag, Calendar } from "lucide-react";

interface TimelineTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  color: string;
  client: string | null;
  revisionCount: number;
  assignee: { id: number; name: string; avatarUrl: string | null } | null;
  coordinator: { id: number; name: string; avatarUrl: string | null } | null;
  createdAt: string;
}

const COORD_ROLES = ["admin", "supervisor", "coordinator"];

export default function TimelinePage() {
  usePageTitle("Linha do tempo");
  const { toast } = useToast();
  const { openTask } = useTaskModal();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [loading, setLoading] = useState(true);

  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineTask[]>("/api/timeline")
      .then(setTasks)
      .catch(() => toast({ title: "Erro ao carregar linha do tempo", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast, isCoord]);

  useEffect(() => {
    if (!isCoord) { setLoading(false); return; }
    load();
  }, [load, isCoord]);

  useRealtime({ onTasksChanged: load });

  const { series, chartOptions } = useMemo(() => {
    if (tasks.length === 0) return { series: [], chartOptions: {} as ApexOptions };

    const today = Date.now();

    // Group by client (or "Sem cliente")
    const byClient: Record<string, { name: string; color: string; data: object[] }> = {};
    tasks.forEach(t => {
      const key = t.client ?? "Sem cliente";
      if (!byClient[key]) {
        byClient[key] = { name: key, color: t.color, data: [] };
      }
      const start = new Date(t.createdAt).getTime();
      const end = new Date(t.dueDate).getTime();
      byClient[key].data.push({
        x: t.title,
        y: [start, end],
        fillColor: t.status === "completed" ? "#22c55e" : t.color,
        strokeColor: "transparent",
        meta: { taskId: t.id },
      });
    });

    const chartSeries = Object.values(byClient).map(p => ({
      name: p.name,
      data: p.data,
    }));

    const opts: ApexOptions = {
      chart: {
        type: "rangeBar",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: true, speed: 600 },
        events: {
          dataPointSelection: (_e: unknown, _chart: unknown, opts: { seriesIndex: number; dataPointIndex: number; w: { config: { series: { data: { meta?: { taskId: number } }[] }[] } } }) => {
            const d = opts.w.config.series[opts.seriesIndex].data[opts.dataPointIndex] as { meta?: { taskId: number } };
            if (d?.meta?.taskId) openTask(d.meta.taskId);
          },
        },
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 5,
          borderRadiusApplication: "end",
          barHeight: "55%",
        },
      },
      xaxis: {
        type: "datetime",
        labels: {
          datetimeUTC: false,
          style: { fontSize: "10px", colors: Array(20).fill("#94a3b8") },
          datetimeFormatter: { month: "MMM yy", day: "dd/MM" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { fontSize: "10px", colors: Array(60).fill("#64748b") },
          maxWidth: 180,
        },
      },
      grid: {
        borderColor: "#f1f5f9",
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
      },
      dataLabels: { enabled: false },
      legend: {
        show: true, position: "top", horizontalAlign: "left",
        fontSize: "11px", markers: { size: 8 },
      },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex, w }: { seriesIndex: number; dataPointIndex: number; w: { config: { series: { data: { x: string; y: number[] }[] }[] } } }) => {
          const d = w.config.series[seriesIndex].data[dataPointIndex];
          const s = new Date(d.y[0]).toLocaleDateString("pt-BR");
          const e = new Date(d.y[1]).toLocaleDateString("pt-BR");
          return `<div style="padding:10px 12px;font-size:11px;line-height:1.6">
            <div style="font-weight:700;margin-bottom:4px">${d.x}</div>
            <div style="color:#64748b">Início: ${s}</div>
            <div style="color:#64748b">Prazo: ${e}</div>
          </div>`;
        },
      },
    };

    return { series: chartSeries, chartOptions: opts };
  }, [tasks, openTask]);

  if (!isCoord) return <div className="text-[hsl(var(--muted-foreground))] text-sm py-8 text-center">Acesso restrito a coordenadores.</div>;
  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  const chartHeight = Math.max(260, tasks.length * 40 + 80);

  return (
    <div className="space-y-4">

      {/* Gantt */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-5">
        {tasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Nenhuma tarefa com prazo cadastrado ainda.
          </div>
        ) : (
          <ReactApexChart
            type="rangeBar"
            series={series as never}
            options={chartOptions}
            height={chartHeight}
          />
        )}
      </div>

      {/* Task list */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
          <span className="font-semibold text-sm">Todas as tarefas</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{tasks.length}</span>
        </div>
        {tasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa com prazo.</div>
        ) : (
          <div className="divide-y">
            {tasks.map(t => (
              <div key={t.id} role="button" onClick={() => openTask(t.id)}
                className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                style={{ borderLeft: `4px solid ${t.color}88` }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  {t.client && (
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1 truncate">
                      <Tag className="h-3 w-3 shrink-0" />{t.client}
                    </p>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
                  <Calendar className="h-3.5 w-3.5" />
                  {fmtDate(t.dueDate)}
                </div>
                {t.assignee && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 hidden sm:block">{t.assignee.name}</span>
                )}
                <Badge className={`text-[10px] px-1.5 shrink-0 ${STATUS_CLASS[t.status] ?? ""}`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

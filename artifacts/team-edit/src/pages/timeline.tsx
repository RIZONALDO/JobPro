import { useEffect, useState, useMemo, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { apiFetch } from "@/lib/api";
import { useJobModal } from "@/contexts/JobModalContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { JOB_STATUS_LABEL, JOB_STATUS_CLASS } from "@/lib/job-status";
import { usePageTitle } from "@/lib/use-page-title";

interface TimelineJob {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  projectId: number;
  projectName: string;
  projectColor: string;
  taskCount: number;
  completedCount: number;
  projectNumber: number;
  jobNumber: number;
}


const COORD_ROLES = ["admin", "supervisor", "coordinator"];

export default function TimelinePage() {
  usePageTitle("Timeline");
  const { toast } = useToast();
  const { openJob } = useJobModal();
  const { user } = useAuth();
  const [jobs, setJobs] = useState<TimelineJob[]>([]);
  const [loading, setLoading] = useState(true);

  const isCoord = COORD_ROLES.includes(user?.role ?? "");

  const load = useCallback(() => {
    if (!isCoord) return;
    apiFetch<TimelineJob[]>("/api/timeline")
      .then(setJobs)
      .catch(() => toast({ title: "Erro ao carregar linha do tempo", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast, isCoord]);

  useEffect(() => {
    if (!isCoord) { setLoading(false); return; }
    load();
  }, [load, isCoord]);

  useRealtime({ onTasksChanged: load, onJobsChanged: load });

  const { series, chartOptions } = useMemo(() => {
    if (jobs.length === 0) return { series: [], chartOptions: {} as ApexOptions };

    const today = Date.now();

    // Group by project — each project is one series row
    const byProject: Record<number, { name: string; color: string; data: object[] }> = {};
    jobs.forEach(j => {
      if (!byProject[j.projectId]) {
        byProject[j.projectId] = { name: j.projectName, color: j.projectColor, data: [] };
      }
      const start = new Date(j.createdAt).getTime();
      const end = today;
      byProject[j.projectId].data.push({
        x: j.name,
        y: [start, end],
        fillColor: j.status === "entregue" ? "#22c55e" : j.projectColor,
        strokeColor: "transparent",
      });
    });

    const chartSeries = Object.values(byProject).map(p => ({
      name: p.name,
      data: p.data,
    }));

    const opts: ApexOptions = {
      chart: {
        type: "rangeBar",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: true, speed: 600 },
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 5,
          borderRadiusApplication: "end",
          rangeBarGroupRows: false,
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
          maxWidth: 160,
        },
      },
      grid: {
        borderColor: "#f1f5f9",
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
        padding: { left: 0, right: 0 },
      },
      dataLabels: { enabled: false },
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "left",
        fontSize: "11px",
        markers: { size: 8 },
      },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex, w }) => {
          const d = w.config.series[seriesIndex].data[dataPointIndex] as { x: string; y: number[] };
          const s = new Date(d.y[0]).toLocaleDateString("pt-BR");
          const e = new Date(d.y[1]).toLocaleDateString("pt-BR");
          return `
            <div style="padding:10px 12px;font-size:11px;line-height:1.6">
              <div style="font-weight:700;margin-bottom:4px">${d.x}</div>
              <div style="color:#64748b">Início: ${s}</div>
              <div style="color:#64748b">Prazo: ${e}</div>
            </div>`;
        },
      },
    };

    return { series: chartSeries, chartOptions: opts };
  }, [jobs]);

  if (!isCoord) return <div className="text-[hsl(var(--muted-foreground))] text-sm py-8 text-center">Acesso restrito a coordenadores.</div>;
  if (loading) return <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>;

  const chartHeight = Math.max(260, jobs.length * 40 + 80);

  return (
    <div className="space-y-4">

      {/* Gantt */}
      <div className="rounded-2xl border bg-[hsl(var(--card))] card-float p-5">
        {jobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Nenhum job cadastrado ainda.
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

      {/* Lista de jobs */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
          <span className="font-semibold text-sm">Todos os jobs</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{jobs.length}</span>
        </div>
        {jobs.length === 0 ? (
          <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhum job cadastrado.</div>
        ) : (
          <div className="divide-y">
            {jobs.map(j => {
              const pct = j.taskCount > 0 ? Math.round(j.completedCount / j.taskCount * 100) : 0;
              return (
                <div key={j.id} role="button" onClick={() => openJob(j.id)}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                  style={{ borderLeft: `4px solid ${j.projectColor}88` }}
                >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{j.projectNumber}.{j.jobNumber}</span>
                        <p className="text-sm font-medium truncate">{j.name}</p>
                      </div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{j.projectName}</p>
                    </div>

                    {/* Mini progress */}
                    <div className="hidden sm:flex items-center gap-2 w-28 shrink-0">
                      <div className="flex-1 h-1.5 rounded-full bg-[hsl(var(--muted))]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: j.projectColor }}
                        />
                      </div>
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))] w-7 text-right">{pct}%</span>
                    </div>

                    <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 hidden sm:block">
                      {j.completedCount}/{j.taskCount} tarefas
                    </span>

                    <Badge className={`text-[10px] px-1.5 shrink-0 ${JOB_STATUS_CLASS[j.status] ?? ""}`}>
                      {JOB_STATUS_LABEL[j.status] ?? j.status}
                    </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

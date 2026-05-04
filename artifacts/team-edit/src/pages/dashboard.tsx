import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useJobModal } from "@/contexts/JobModalContext";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, ListTodo, ArrowRight, Activity, Users } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { StatusBars } from "@/components/charts/StatusBars";
import { WaffleChart } from "@/components/charts/WaffleChart";
import { ProjectBars, RISK_COLOR, type RiskLevel, type ProjectBarDatum } from "@/components/charts/ProjectBars";
import { useSize } from "@/hooks/use-size";
import { Link } from "wouter";
import { ProjectModal } from "@/components/ProjectModal";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";

interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  jobId: number;
  number?: number;
  jobNumber?: number;
  projectNumber?: number;
  projectClient?: string | null;
}

interface WeekJob {
  id: number;
  name: string;
  projectName: string;
  projectColor: string;
  taskCount: number;
  completedCount: number;
  projectNumber: number;
  jobNumber: number;
}

interface AtRiskTask {
  id: number;
  title: string;
  status: string;
  dueDate: string;
  jobId: number;
  jobName: string;
  projectName: string;
  projectColor: string;
  assigneeName: string | null;
  projectNumber: number;
  jobNumber: number;
  number?: number;
}

interface Project {
  id: number;
  name: string;
  color: string;
  status: string;
  jobCount: number;
  taskCount: number;
  completedCount: number;
  number: number;
}

interface EditorWorkload {
  id: number;
  name: string;
  login: string;
  avatarUrl: string | null;
  taskCount: number;
  score: number;
  byComplexity: { low: number; medium: number; high: number };
  byStatus: { pending: number; in_progress: number; in_revision: number; review: number };
}

interface ActivityEvent {
  id: number;
  taskId: number;
  taskTitle: string;
  jobId: number;
  jobName: string | null;
  fromStatus: string;
  toStatus: string;
  changedByName: string | null;
  createdAt: string;
}

const PRIORITY_COLOR: Record<string, string> = { low: "text-green-600", medium: "text-amber-600", high: "text-red-600" };

function scoreColor(score: number): string {
  if (score === 0)  return "#94a3b8";
  if (score <= 3)   return "#4ade80";
  if (score <= 9)   return "#fbbf24";
  if (score <= 18)  return "#f97316";
  return "#ef4444";
}

function scoreLabel(score: number): string {
  if (score === 0)  return "Livre";
  if (score <= 3)   return "Tranquilo";
  if (score <= 9)   return "Ocupado";
  if (score <= 18)  return "Apertado";
  return "No limite";
}

const BATTERY_SEGS = 5;

function Battery({ score, maxScore, color }: { score: number; maxScore: number; color: string }) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  const filled = Math.round(pct * BATTERY_SEGS);
  const bw = 36; const bh = 16;
  const termW = 3; const termH = 8;
  const gap = 2;
  const segW = (bw - gap * (BATTERY_SEGS - 1) - 4) / BATTERY_SEGS;

  return (
    <svg width={bw + termW + 2} height={bh} viewBox={`0 0 ${bw + termW + 2} ${bh}`} style={{ display: "block" }}>
      {/* Body outline */}
      <rect x={0} y={0} width={bw} height={bh} rx={3} fill="none"
        stroke={color} strokeWidth={1.5} opacity={0.35} />
      {/* Terminal */}
      <rect x={bw + 1} y={(bh - termH) / 2} width={termW} height={termH} rx={1.5}
        fill={color} opacity={0.35} />
      {/* Segments */}
      {Array.from({ length: BATTERY_SEGS }).map((_, i) => (
        <rect
          key={i}
          x={2 + i * (segW + gap)}
          y={2}
          width={segW}
          height={bh - 4}
          rx={1.5}
          fill={color}
          opacity={i < filled ? 0.85 : 0.1}
        />
      ))}
    </svg>
  );
}

function WorkloadCard({ workload }: { workload: EditorWorkload[] }) {
  const sorted = [...workload].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...sorted.map(e => e.score), 1);

  return (
    <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 border-b bg-[hsl(var(--muted))]/30">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-semibold text-sm">Carga dos editores</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{workload.length}</span>
        </div>
        <Link href="/team" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
          Ver todos <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {workload.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhum editor cadastrado.</p>
      ) : (
        <div className="overflow-y-auto divide-y" style={{ maxHeight: 4 * 52 }}>
          {sorted.map(editor => {
            const color = scoreColor(editor.score);
            const initials = editor.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
            const firstName = editor.name.split(" ")[0];
            return (
              <div key={editor.id} className="group relative flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors">
                {/* Avatar */}
                <AvatarDisplay
                  name={editor.name}
                  avatarUrl={editor.avatarUrl}
                  className="h-7 w-7 text-[10px]"
                  style={{ backgroundColor: color + "22", color, border: `1.5px solid ${color}` }}
                />
                {/* Nome */}
                <span className="text-xs font-medium w-16 shrink-0 truncate">{firstName}</span>
                {/* Bateria */}
                <div className="flex-1 flex items-center">
                  <Battery score={editor.score} maxScore={maxScore} color={color} />
                </div>
                {/* Prioridade */}
                <span className="text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: color + "22", color }}>
                  {scoreLabel(editor.score)}
                </span>

                {/* Tooltip hover */}
                <div className="pointer-events-none absolute left-4 top-full mt-1 z-20 hidden group-hover:block
                  rounded-lg border bg-[hsl(var(--card))] shadow-lg p-3 text-xs space-y-1.5 min-w-[170px]">
                  <p className="font-semibold">{editor.name}</p>
                  <p className="text-[hsl(var(--muted-foreground))]">{editor.taskCount} tarefa(s) ativas</p>
                  {((editor.byComplexity?.high   ?? 0) > 0) && <p className="text-red-600">{editor.byComplexity.high} complexa(s)</p>}
                  {((editor.byComplexity?.medium ?? 0) > 0) && <p className="text-amber-600">{editor.byComplexity.medium} moderada(s)</p>}
                  {((editor.byComplexity?.low    ?? 0) > 0) && <p className="text-green-600">{editor.byComplexity.low} simples</p>}
                  {editor.taskCount === 0 && <p className="text-[hsl(var(--muted-foreground))]">Sem tarefas ativas</p>}
                  <div className="border-t pt-1.5 space-y-0.5">
                    {editor.byStatus.pending     > 0 && <p className="text-slate-500">{editor.byStatus.pending} pendente(s)</p>}
                    {editor.byStatus.in_progress > 0 && <p className="text-blue-600">{editor.byStatus.in_progress} em edição</p>}
                    {editor.byStatus.in_revision > 0 && <p className="text-orange-600">{editor.byStatus.in_revision} em alteração</p>}
                    {editor.byStatus.review      > 0 && <p className="text-amber-600">{editor.byStatus.review} para aprovar</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

const STATUS_BAR: Record<string, string> = {
  pending:     "bg-slate-300",
  in_progress: "bg-blue-400",
  in_revision: "bg-orange-400",
  review:      "bg-amber-400",
  completed:   "bg-green-500",
};

interface ActionRow { label: string; count: number; color: string; gradientId?: string; }

function ActionCard({ label, actionCount, total, rows }: {
  label: string; actionCount: number; total: number; rows: ActionRow[];
}) {
  const { ref, w, h } = useSize();
  const visxData = rows.map((r, i) => ({ ...r, gradientId: `sbg-${i}` }));
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-2 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="text-[11px] font-semibold text-[hsl(var(--foreground))]/80 truncate">{label}</p>
        {actionCount > 0
          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 bg-amber-500/10 text-amber-600">Atenção</span>
          : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 bg-green-500/10 text-green-600">Em dia</span>
        }
      </div>
      <div className="flex items-baseline gap-1.5 mt-1 shrink-0">
        <span className={`text-2xl font-bold tabular-nums leading-none ${actionCount > 0 ? "text-amber-500" : "text-green-500"}`}>
          {actionCount}
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {actionCount === 0 ? "tudo em dia" : `de ${total}`}
        </span>
      </div>
      <div ref={ref} className="flex-1 min-h-0 -mx-2">
        <StatusBars data={visxData} width={w} height={h} />
      </div>
    </div>
  );
}

function DeadlineCard({ label, sub, subCls, pill, days, color }: {
  label: string; sub: string; subCls: string;
  pill: { text: string; cls: string } | null;
  days: { day: string; count: number }[];
  color: string;
}) {
  const { ref, w, h } = useSize();
  const data = days.map((d, i) => ({ label: d.day, count: d.count, color, gradientId: `dl-${i}` }));
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="text-[11px] font-semibold text-[hsl(var(--foreground))]/80 truncate">{label}</p>
        {pill && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 ${pill.cls}`}>{pill.text}</span>}
      </div>
      <div ref={ref} className="flex-1 min-h-0 -mx-2 mt-1">
        <StatusBars data={data} width={w} height={h} />
      </div>
      <p className={`text-xs px-1 shrink-0 mt-1 ${subCls}`}>{sub}</p>
    </div>
  );
}

function calcRisk(p: Project): RiskLevel {
  const pct = p.taskCount > 0 ? p.completedCount / p.taskCount : 0;
  if (pct >= 1) return "ok";
  if (pct >= 0.6) return "ok";
  if (pct >= 0.3) return "warning";
  return p.taskCount > 0 ? "critical" : "none";
}

function ProjectHealthCard({ projects }: { projects: Project[] }) {
  const { ref, w, h } = useSize();
  const active = projects.filter(p => p.status === "ativo");

  const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, warning: 1, none: 2, ok: 3 };

  const barData: ProjectBarDatum[] = [...active]
    .sort((a, b) => {
      const ra = RISK_ORDER[calcRisk(a)];
      const rb = RISK_ORDER[calcRisk(b)];
      if (ra !== rb) return ra - rb;
      const pctA = a.taskCount > 0 ? a.completedCount / a.taskCount : 0;
      const pctB = b.taskCount > 0 ? b.completedCount / b.taskCount : 0;
      return pctA - pctB;
    })
    .slice(0, 5)
    .map(p => ({
      name: p.name,
      color: p.color,
      pct: p.taskCount > 0 ? Math.round(p.completedCount / p.taskCount * 100) : 0,
      risk: calcRisk(p),
      daysLeft: null,
    }));

  const critical = active.filter(p => calcRisk(p) === "critical").length;
  const warning  = active.filter(p => calcRisk(p) === "warning").length;
  const ok       = active.filter(p => ["ok", "none"].includes(calcRisk(p))).length;

  return (
    <div className="col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[11px] font-semibold text-[hsl(var(--foreground))]/80">Saúde dos projetos</p>
        <div className="flex items-center gap-1.5">
          {critical > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
              {critical} crítico{critical > 1 ? "s" : ""}
            </span>
          )}
          {warning > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
              {warning} atenção
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-stretch gap-3 mt-1">
        <div ref={ref} className="flex-1 min-w-0 min-h-0">
          {active.length === 0
            ? <p className="text-xs text-[hsl(var(--muted-foreground))] text-center mt-8">Nenhum projeto ativo.</p>
            : <ProjectBars data={barData} width={w} height={h} />
          }
        </div>
        <div className="w-px self-stretch bg-[hsl(var(--border))] shrink-0" />
        <div className="shrink-0 w-[68px] flex flex-col justify-around py-1 text-center">
          <div>
            <p className="text-[20px] font-bold tabular-nums leading-none" style={{ color: RISK_COLOR.critical }}>{critical}</p>
            <p className="text-[8px] text-[hsl(var(--muted-foreground))] mt-0.5">Crítico</p>
          </div>
          <div>
            <p className="text-[20px] font-bold tabular-nums leading-none" style={{ color: RISK_COLOR.warning }}>{warning}</p>
            <p className="text-[8px] text-[hsl(var(--muted-foreground))] mt-0.5">Atenção</p>
          </div>
          <div>
            <p className="text-[20px] font-bold tabular-nums leading-none" style={{ color: RISK_COLOR.ok }}>{ok}</p>
            <p className="text-[8px] text-[hsl(var(--muted-foreground))] mt-0.5">Saudável</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const WAFFLE_STATUSES = [
  { key: "completed",   label: "Concluído", color: "#22c55e" },
  { key: "in_progress", label: "Em edição", color: "#3b82f6" },
  { key: "review",      label: "Aprovar",   color: "#f59e0b" },
  { key: "in_revision", label: "Revisão",   color: "#f97316" },
  { key: "pending",     label: "Pendente",  color: "#94a3b8" },
];

function WaffleCard({ tasks }: { tasks: Task[] }) {
  const { ref, w, h } = useSize();
  const total = tasks.length;

  const counts = WAFFLE_STATUSES.map(s => ({
    ...s,
    count: tasks.filter(t => t.status === s.key).length,
  }));

  const cells: string[] = [];
  counts.forEach(s => {
    const squares = total > 0 ? Math.round((s.count / total) * 100) : 0;
    for (let i = 0; i < squares && cells.length < 100; i++) cells.push(s.color);
  });
  while (cells.length < 100) cells.push("hsl(var(--muted))");

  return (
    <div className="col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[11px] font-semibold text-[hsl(var(--foreground))]/80">Distribuição de tarefas</p>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{total} tarefas · 1 quadrado = 1%</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center gap-4 mt-1.5">
        {/* Waffle grid */}
        <div ref={ref} className="flex-1 min-w-0 min-h-0">
          <WaffleChart cells={cells} width={Math.min(w, h * 1.05)} height={h} />
        </div>
        {/* Legend */}
        <div className="shrink-0 flex flex-col justify-center gap-2">
          {counts.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-[9px] text-[hsl(var(--muted-foreground))] w-16 truncate">{s.label}</span>
              <span className="text-[9px] font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const { openJob } = useJobModal();
  const [openProjectId, setOpenProjectId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [weekJobs, setWeekJobs] = useState<WeekJob[]>([]);
  const [atRisk, setAtRisk] = useState<AtRiskTask[]>([]);

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks").then(setTasks).catch(() => {});
    apiFetch<ActivityEvent[]>("/api/activity").then(setActivity).catch(() => {});
    if (user?.role !== "editor") {
      apiFetch<Project[]>("/api/projects").then(setProjects).catch(() => {});
      apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
      apiFetch<{ weekDeliveries: WeekJob[]; atRisk: AtRiskTask[] }>("/api/dashboard-extras")
        .then(d => { setWeekJobs(d.weekDeliveries); setAtRisk(d.atRisk); })
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useRealtime({
    onTasksChanged: load,
    onJobsChanged:  load,
    onProjectsChanged: load,
  });

  const byStatus = (s: string) => tasks.filter(t => t.status === s).length;
  const openTasks      = tasks.filter(t => t.status !== "completed");
  const activeProjects = projects.filter(p => p.status === "ativo");
  const isEditor       = user?.role === "editor";

  const actionCount    = isEditor
    ? tasks.filter(t => t.status === "pending" || t.status === "in_revision").length
    : byStatus("review");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const inWeek = new Date(todayStart); inWeek.setDate(inWeek.getDate() + 7);
  const overdueCount = tasks.filter(t => {
    if (t.status === "completed" || !t.dueDate) return false;
    const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00");
    return dt < todayStart;
  }).length;
  const dueSoonCount = tasks.filter(t => {
    if (t.status === "completed" || !t.dueDate) return false;
    const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00");
    return dt >= todayStart && dt <= inWeek;
  }).length;
  const deadlineValue = overdueCount > 0 ? overdueCount : dueSoonCount;
  const deadlineLabel = overdueCount > 0 ? "Atrasadas" : dueSoonCount > 0 ? "Vencem esta semana" : "Sem prazo urgente";

  // Card 2 — barras: entregas nos próximos 7 dias
  const duePerDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + i);
    const yy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    const dayStr = `${yy}-${mm}-${dd}`;
    return {
      day: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()],
      count: tasks.filter(t => t.status !== "completed" && t.dueDate?.split("T")[0] === dayStr).length,
    };
  });
  const deadlineBarColor = overdueCount > 0 ? "#ef4444" : dueSoonCount > 0 ? "#f97316" : "#94a3b8";

  const actionRows = [
    { label: "Pendente",  count: byStatus("pending"),     color: "#94a3b8" },
    { label: "Edição",    count: byStatus("in_progress"), color: "#3b82f6" },
    { label: "Revisão",   count: byStatus("in_revision"), color: "#f97316" },
    { label: "Aprovar",   count: byStatus("review"),      color: "#f59e0b" },
    { label: "Feito",     count: byStatus("completed"),   color: "#22c55e" },
  ];
  const actionTotal = actionRows.reduce((s, r) => s + r.count, 0) || 1;

  const deadlinePill = overdueCount > 0 ? { text: "Urgente", cls: "bg-red-500/10 text-red-600" }
    : dueSoonCount > 0 ? { text: "Esta semana", cls: "bg-orange-500/10 text-orange-600" }
    : null;
  const deadlineSubCls = overdueCount > 0 ? "text-red-500" : dueSoonCount > 0 ? "text-orange-500" : "text-[hsl(var(--muted-foreground))]";
  const deadlineSub    = overdueCount > 0 ? "Atenção necessária" : dueSoonCount > 0 ? "Nos próximos 7 dias" : "Sem urgências";

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Olá, {user?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Bem-vindo ao seu painel de controle.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* Card 1 — Visx bar chart */}
        <ActionCard
          label={isEditor ? "Para revisar / alterar" : "Aguardando aprovação"}
          actionCount={actionCount}
          total={tasks.length}
          rows={actionRows}
        />

        {/* Card 2 — deadline Visx */}
        <DeadlineCard
          label={deadlineLabel}
          sub={deadlineSub}
          subCls={deadlineSubCls}
          pill={deadlinePill}
          days={duePerDay}
          color={deadlineBarColor}
        />

        {/* Coord: saúde dos projetos · Editor: distribuição de tarefas */}
        {isEditor
          ? <WaffleCard tasks={tasks} />
          : <ProjectHealthCard projects={projects} />
        }
      </div>

      {/* ── COORDINATOR LAYOUT ──────────────────────────────────── */}
      {!isEditor && (
        <div className="grid gap-5 md:grid-cols-3">

          {/* Projetos ativos */}
          <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[hsl(var(--primary))]" />
                <span className="font-semibold text-sm">Projetos ativos</span>
              </div>
              <Link href="/projects" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {activeProjects.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhum projeto ativo.</p>
              ) : activeProjects.map(p => (
                <button key={p.id} onClick={() => setOpenProjectId(p.id)}
                  className="w-full text-left flex items-center gap-4 py-3 pr-5 hover:bg-[hsl(var(--muted))]/30 transition-colors group"
                  style={{ borderLeft: `6px solid ${p.color}88` }}>
                  <div className="flex-1 min-w-0 pl-4 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{p.number}</span>
                    <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{p.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{p.jobCount} {p.jobCount === 1 ? "job" : "jobs"}</span>
                    <span className="opacity-30">·</span>
                    <span>{p.taskCount} {p.taskCount === 1 ? "tarefa" : "tarefas"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Workload — coluna direita */}
          <WorkloadCard workload={workload} />

          {/* Tarefas */}
          <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-[hsl(var(--primary))]" />
                <span className="font-semibold text-sm">Minhas tarefas em aberto</span>
                {openTasks.length > 0 && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{openTasks.length}</span>
                )}
              </div>
              <Link href="/my-tasks" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {openTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa em aberto.</p>
              ) : openTasks.map(t => (
                <div key={t.id} role="button" onClick={() => openJob(t.jobId)}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {(t.projectNumber && t.jobNumber && t.number) ? (
                        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{t.projectNumber}.{t.jobNumber}.{t.number}</span>
                      ) : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    {t.dueDate && (() => {
                      const h = fmtDateHuman(t.dueDate); const n = fmtDate(t.dueDate);
                      return <>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">Entrega: {h}</p>
                        {h !== n && <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50">{n}</p>}
                      </>;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium ${PRIORITY_COLOR[t.priority] ?? ""}`}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
                    <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Atividade recente */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
              <Activity className="h-4 w-4 text-[hsl(var(--primary))]" />
              <span className="font-semibold text-sm">Atividade recente</span>
            </div>
            <div className="overflow-y-auto max-h-[260px] divide-y font-mono">
              {activity.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8 font-sans">Nenhuma atividade ainda.</p>
              ) : activity.map((e, idx) => (
                <div key={e.id} role="button" onClick={() => openJob(e.jobId)}
                  className="flex items-center gap-4 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 shrink-0 w-28">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-[11px] truncate font-sans">
                    <span className="text-[hsl(var(--foreground))] font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{e.taskTitle}</span>
                    <span className="text-[hsl(var(--muted-foreground))]"> → {STATUS_LABEL[e.toStatus] ?? e.toStatus}</span>
                    {e.changedByName && <span className="text-[hsl(var(--muted-foreground))]/60"> · {e.changedByName.split(" ")[0]}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ENTREGAS DA SEMANA + EM RISCO ──────────────────────── */}
      {!isEditor && (weekJobs.length > 0 || atRisk.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">

          {/* Entregas da semana */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <span className="font-semibold text-sm">Entregas desta semana</span>
                {weekJobs.length > 0 && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{weekJobs.length}</span>
                )}
              </div>
              <Link href="/timeline" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver linha do tempo <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[280px] divide-y">
              {weekJobs.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma entrega esta semana.</p>
              ) : weekJobs.map(j => {
                const pct = j.taskCount > 0 ? Math.round(j.completedCount / j.taskCount * 100) : 0;
                return (
                  <div key={j.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors"
                    style={{ borderLeft: `4px solid ${j.projectColor}88` }}>
                    <div className="flex-1 min-w-0 pl-1">
                      <p className="text-sm font-medium truncate">{j.name}</p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                        <span className="font-mono">{j.projectNumber}.{j.jobNumber}</span> · {j.projectName}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{pct}% concluído</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Em risco */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                <span className="font-semibold text-sm">Em risco</span>
                {atRisk.length > 0 && (
                  <span className="text-[11px] bg-red-500/10 text-red-600 rounded-full px-2 py-0.5">{atRisk.length} atrasada{atRisk.length !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            <div className="overflow-y-auto max-h-[280px] divide-y">
              {atRisk.length === 0 ? (
                <p className="text-sm text-green-600 text-center py-10">Tudo dentro do prazo.</p>
              ) : atRisk.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors"
                  style={{ borderLeft: `4px solid ${t.projectColor}88` }}>
                  <div className="flex-1 min-w-0 pl-1">
                    <div className="flex items-center gap-1.5">
                      {(t.projectNumber && t.jobNumber && t.number) ? (
                        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{t.projectNumber}.{t.jobNumber}.{t.number}</span>
                      ) : null}
                      <p className="text-sm font-medium truncate">{t.title}</p>
                    </div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                      {t.projectName} · {t.jobName}
                      {t.assigneeName && ` · ${t.assigneeName}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-red-500">{fmtDateHuman(t.dueDate)}</p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmtDate(t.dueDate)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── EDITOR LAYOUT ───────────────────────────────────────── */}
      {isEditor && (
        <div className="grid gap-5 md:grid-cols-2">
          {/* Tarefas */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-[hsl(var(--primary))]" />
                <span className="font-semibold text-sm">Minhas tarefas em aberto</span>
                {openTasks.length > 0 && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{openTasks.length}</span>
                )}
              </div>
              <Link href="/my-tasks" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {openTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa em aberto.</p>
              ) : openTasks.map(t => (
                <Link key={t.id} href="/my-tasks"
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {(t.projectNumber && t.jobNumber && t.number) ? (
                        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{t.projectNumber}.{t.jobNumber}.{t.number}</span>
                      ) : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {t.projectClient && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.projectClient}</span>
                      )}
                      {t.dueDate && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {t.projectClient ? "· " : ""}Entrega: {fmtDateHuman(t.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium ${PRIORITY_COLOR[t.priority] ?? ""}`}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
                    <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Atividade recente */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <Activity className="h-4 w-4 text-[hsl(var(--primary))]" />
              <span className="font-semibold text-sm">Atividade recente</span>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y font-mono">
              {activity.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10 font-sans">Nenhuma atividade ainda.</p>
              ) : activity.map((e, idx) => (
                <Link key={e.id} href="/my-tasks"
                  className="flex items-center gap-3 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group">
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 shrink-0 w-24">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-[11px] truncate font-sans">
                    <span className="text-[hsl(var(--foreground))] font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{e.taskTitle}</span>
                    <span className="text-[hsl(var(--muted-foreground))]"> → {STATUS_LABEL[e.toStatus] ?? e.toStatus}</span>
                    {e.changedByName && <span className="text-[hsl(var(--muted-foreground))]/60"> · {e.changedByName.split(" ")[0]}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {openProjectId !== null && (
        <ProjectModal projectId={openProjectId} onClose={() => setOpenProjectId(null)} />
      )}
    </div>
  );
}

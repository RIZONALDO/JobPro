import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useRealtime } from "@/hooks/use-realtime";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, ListTodo, ArrowRight, Activity, Users, Clock, AlertTriangle, CheckCircle2, CalendarClock, Zap, Search, LayoutGrid, MoreHorizontal, Shield } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { StatusBars } from "@/components/charts/StatusBars";
import { WaffleChart } from "@/components/charts/WaffleChart";
import { useSize } from "@/hooks/use-size";
import { Link, useLocation } from "wouter";
import { STATUS_LABEL, STATUS_CLASS, isTerminal } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import { PriorityBadge } from "@/components/ui/priority-badge";

interface Task {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate?: string | null;
  client?: string | null;
  color?: string;
  number?: number;
  createdBy?: { id: number; name: string; avatarUrl: string | null } | null;
  assignedTo?: { id: number; name: string; avatarUrl: string | null } | null;
}

interface AtRiskTask {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  dueDate: string;
  client: string | null;
  color: string;
  assigneeName: string | null;
  assignee?: { id: number; name: string; avatarUrl: string | null } | null;
  number?: number;
}

interface EditorWorkload {
  id: number;
  name: string;
  login: string;
  avatarUrl: string | null;
  taskCount: number;
  scheduledCount?: number;
  score: number;
  scheduledScore?: number;
  projectedScore?: number;
  byComplexity: { low: number; medium: number; high: number };
  byStatus: { pending: number; in_progress: number; in_revision: number; review: number };
}

interface ActivityEvent {
  id: number;
  taskId: number;
  taskCode?: string;
  taskTitle: string;
  taskClient: string | null;
  fromStatus: string;
  toStatus: string;
  taskStatus: string;
  changedByName: string | null;
  createdAt: string;
}

interface AllTask {
  id: number;
  status: string;
  client: string | null;
  priority: string;
  complexity: string;
  dueDate?: string | null;
  title?: string;
  color?: string | null;
  taskNumber?: number;
  taskYear?: number;
  assignedToId?: number | null;
}

interface StatusHistory { dates: string[]; series: Record<string, number[]>; }

interface DeadlineBucket { key: string; label: string; color: string; count: number; }
interface UrgentTask {
  id: number; taskCode?: string; title: string; status: string; priority: string;
  dueDate: string; client: string | null; color: string;
  assigneeName: string | null; bucket: string;
}
interface DeadlineOverview {
  buckets: DeadlineBucket[];
  urgent: UrgentTask[];
  total: number;
  urgentCount: number;
}

// cinza=disponível | verde=ocupado | laranja=muito ocupado | vermelho=no limite
function scoreColor(score: number): string {
  if (score === 0)   return "#94a3b8"; // cinza  — Disponível
  if (score <= 6)    return "#22c55e"; // verde  — Ocupado
  if (score <= 11)   return "#f97316"; // laranja — Muito ocupado
  return "#ef4444";                    // vermelho — No limite
}
function scoreLabel(score: number): string {
  if (score === 0)   return "Disponível";
  if (score <= 6)    return "Ocupado";
  if (score <= 11)   return "Muito ocupado";
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
      <rect x={0} y={0} width={bw} height={bh} rx={3} fill="none"
        stroke={color} strokeWidth={1.5} opacity={0.35} />
      <rect x={bw + 1} y={(bh - termH) / 2} width={termW} height={termH} rx={1.5}
        fill={color} opacity={0.35} />
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

// ── Card swap menu ───────────────────────────────────────────────────────────

interface CardOption { key: string; label: string; }

function CardMenu({ value, options, onChange }: {
  value: string; options: CardOption[]; onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="h-7 w-7 rounded flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--muted-foreground))]"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[101] min-w-[200px] rounded-xl border bg-[hsl(var(--card))] shadow-xl py-1.5 text-left overflow-hidden">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 px-3 pt-1 pb-1.5">
              Trocar card
            </p>
            {options.map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { onChange(opt.key); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-[hsl(var(--muted))]/50 transition-colors flex items-center gap-2 ${value === opt.key ? "text-[hsl(var(--primary))] font-semibold bg-[hsl(var(--primary))]/5" : "text-[hsl(var(--foreground))]"}`}
              >
                <span className="flex-1">{opt.label}</span>
                {value === opt.key && <span className="text-[9px] text-[hsl(var(--muted-foreground))]/60 shrink-0">Ativo</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SLOT1_OPTIONS: CardOption[] = [
  { key: "command_panel", label: "Painel de Comando" },
  { key: "health_score",  label: "Score de Saúde" },
  { key: "bottleneck",    label: "Gargalo Identificado" },
];
const SLOT2_OPTIONS: CardOption[] = [
  { key: "mini_gantt",     label: "Próximas Entregas" },
  { key: "capacity",       label: "Termômetro de Capacidade" },
  { key: "approval_queue", label: "Fila de Aprovação" },
];
const SLOT3_OPTIONS: CardOption[] = [
  { key: "heatmap",       label: "Mapa de Calor Semanal" },
  { key: "client_health", label: "Saúde por Cliente" },
  { key: "client_status", label: "Cliente × Status" },
];
const SLOT5_OPTIONS: CardOption[] = [
  { key: "delivery_projection", label: "Projeção de Entregas" },
  { key: "health_radar",        label: "Radar de Saúde" },
  { key: "kpi_comparison",      label: "KPIs da Equipe" },
];

// ── Alternative slot-1 cards ──────────────────────────────────────────────────

function HealthScoreCard({ allTasks, atRiskCount, menu }: {
  allTasks: AllTask[]; atRiskCount: number; menu?: React.ReactNode;
}) {
  const active    = allTasks.filter(t => !["completed","cancelled"].includes(t.status));
  const completed = allTasks.filter(t => t.status === "completed").length;
  const total     = allTasks.length;
  const review    = active.filter(t => t.status === "review").length;
  const inProgress = active.filter(t => t.status === "in_progress").length;
  const completedPct = total > 0 ? Math.round(completed / total * 100) : 0;
  const overduePenalty = active.length > 0 ? Math.round((atRiskCount / active.length) * 50) : 0;
  const reviewPenalty  = active.length > 0 ? Math.round((review / active.length) * 20) : 0;
  const score = Math.max(0, Math.min(100, completedPct + (inProgress > 0 ? 10 : 0) - overduePenalty - reviewPenalty + 20));
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "Saudável" : score >= 45 ? "Atenção" : "Crítico";

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Activity className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Score de Saúde</span>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none shrink-0"
          style={{ backgroundColor: color + "22", color }}>{label}</span>
        {menu}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 min-h-0">
        <span className="text-5xl font-black tabular-nums leading-none" style={{ color }}>{score}</span>
        <div className="w-full h-2 rounded-full bg-[hsl(var(--muted))]">
          <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        <div className="flex items-center gap-4 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span><strong style={{ color: atRiskCount > 0 ? "#ef4444" : "#94a3b8" }}>{atRiskCount}</strong> atrasadas</span>
          <span><strong style={{ color: review > 0 ? "#f59e0b" : "#94a3b8" }}>{review}</strong> p/ aprovar</span>
          <span><strong className="text-emerald-500">{completedPct}%</strong> concluído</span>
        </div>
      </div>
    </div>
  );
}

function BottleneckCard({ allTasks, workload, menu }: {
  allTasks: AllTask[]; workload: EditorWorkload[]; menu?: React.ReactNode;
}) {
  const active      = allTasks.filter(t => !["completed","cancelled"].includes(t.status));
  const reviewCount = active.filter(t => t.status === "review").length;
  const inRevision  = active.filter(t => t.status === "in_revision").length;
  const pendingCnt  = active.filter(t => t.status === "pending").length;
  const maxLoad     = workload.reduce<EditorWorkload | null>((m, e) => !m || e.score > m.score ? e : m, null);

  const alerts: { text: string; color: string }[] = [];
  if (reviewCount >= 3) alerts.push({ text: `${reviewCount} tarefas aguardam aprovação`, color: "#f59e0b" });
  if (inRevision  >= 2) alerts.push({ text: `${inRevision} tarefas em revisão`,          color: "#f97316" });
  if (pendingCnt  >= 5) alerts.push({ text: `${pendingCnt} tarefas ainda pendentes`,      color: "#94a3b8" });
  if (maxLoad && maxLoad.score > 15) alerts.push({ text: `${maxLoad.name.split(" ")[0]} com maior volume de tarefas (score ${maxLoad.score})`, color: "#f97316" });
  if (alerts.length === 0) alerts.push({ text: "Nenhum gargalo identificado", color: "#22c55e" });

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Search className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Gargalo Identificado</span>
        </div>
        {menu}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-2 px-4">
        {alerts.slice(0, 3).map((a, i) => (
          <div key={i} className="flex items-start gap-2.5 rounded-lg px-3 py-2" style={{ backgroundColor: a.color + "18" }}>
            <div className="w-2 h-2 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: a.color }} />
            <span className="text-xs leading-snug font-medium" style={{ color: a.color }}>{a.text}</span>
          </div>
        ))}
        {alerts.length === 1 && alerts[0].color === "#22c55e" && (
          <p className="text-[10px] text-center text-[hsl(var(--muted-foreground))]/50 mt-1">Equipe fluindo bem</p>
        )}
      </div>
    </div>
  );
}

// ── Alternative slot-2 cards ──────────────────────────────────────────────────

function CapacityCard({ workload, menu }: { workload: EditorWorkload[]; menu?: React.ReactNode }) {
  const sorted = [...workload].sort((a, b) => b.score - a.score).slice(0, 6);
  const maxScore = Math.max(...sorted.map(e => e.score), 1);

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Users className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Distribuição da Equipe</span>
        </div>
        {menu}
      </div>
      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem editores</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-2 px-3.5 py-2">
          {sorted.map(e => {
            const color = scoreColor(e.score);
            const { low, medium, high } = e.byComplexity;
            return (
              <div key={e.id} className="flex items-center gap-2 min-w-0">
                <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={24} className="shrink-0" />
                <span className="text-[10px] font-semibold truncate shrink-0">
                  {e.name.split(" ")[0]}
                </span>
                {/* Breakdown B · M · A */}
                <span className="text-[9px] tabular-nums ml-auto shrink-0 text-[hsl(var(--muted-foreground))]/70 leading-none">
                  {low > 0 && <span>B:{low} </span>}
                  {medium > 0 && <span>M:{medium} </span>}
                  {high > 0 && <span>A:{high}</span>}
                  {low === 0 && medium === 0 && high === 0 && <span>—</span>}
                </span>
              </div>
            );
          })}
          {/* Legenda */}
          <div className="flex items-center gap-2 pt-0.5 border-t border-[hsl(var(--border))]/40">
            <span className="text-[9px] text-[hsl(var(--muted-foreground))]/50">B = baixa · M = média · A = alta</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalQueueCard({ allTasks, onOpenTask, menu }: {
  allTasks: AllTask[]; onOpenTask: (id: number) => void; menu?: React.ReactNode;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parse = (s: string | null | undefined) =>
    s ? new Date(s.includes("T") ? s : s + "T00:00:00") : null;

  const queue = [...allTasks]
    .filter(t => t.status === "review")
    .sort((a, b) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1)
    .slice(0, 5);

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-xs font-semibold">Fila de Aprovação</span>
        </div>
        {queue.length > 0 && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 leading-none shrink-0">
            {queue.length}
          </span>
        )}
        {menu}
      </div>
      {queue.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-[hsl(var(--muted-foreground))]">
          <CheckCircle2 className="h-8 w-8 opacity-15" />
          <p className="text-xs">Nada para aprovar</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden divide-y divide-[hsl(var(--border))]/60">
          {queue.map(t => {
            const d = parse(t.dueDate);
            const overdue = d !== null && d < today;
            const label = t.title ?? t.client ?? "Tarefa";
            const code  = t.taskNumber && t.taskYear
              ? `${String(t.taskNumber).padStart(3, "0")}.${t.taskYear}`
              : undefined;
            return (
              <button key={t.id} type="button" onClick={() => onOpenTask(t.id)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-amber-500/[0.04] transition-colors group min-w-0">
                <div className="flex-1 min-w-0">
                  {code && <span className="text-[8px] font-mono font-bold text-[hsl(var(--muted-foreground))]/40 block leading-none">{code}</span>}
                  <p className="text-[11px] font-semibold truncate leading-tight group-hover:text-amber-600 transition-colors">{label}</p>
                </div>
                {d && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 ${overdue ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-600"}`}>
                    {overdue ? "Atrasada" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Alternative slot-3 cards (col-span-2) ────────────────────────────────────

function ClientHealthCard({ allTasks, menu }: { allTasks: AllTask[]; menu?: React.ReactNode }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const clientMap = new Map<string, { active: number; done: number; overdue: number }>();

  for (const t of allTasks) {
    const key = t.client ?? "Sem cliente";
    if (!clientMap.has(key)) clientMap.set(key, { active: 0, done: 0, overdue: 0 });
    const c = clientMap.get(key)!;
    if (t.status === "completed") { c.done++; }
    else {
      c.active++;
      if (t.dueDate) {
        const d = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
        if (d < today) c.overdue++;
      }
    }
  }

  const clients = [...clientMap.entries()]
    .map(([name, v]) => ({ name, ...v, total: v.active + v.done }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return (
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Saúde por Cliente</span>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">{clients.length} clientes</span>
        {menu}
      </div>
      {clients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem dados</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-1.5 px-4 py-2">
          {clients.map(c => {
            const donePct = c.total > 0 ? Math.round(c.done / c.total * 100) : 0;
            return (
              <div key={c.name} className="flex items-center gap-2.5 min-w-0">
                <div className="w-28 shrink-0">
                  <p className="text-[10px] font-medium truncate text-[hsl(var(--muted-foreground))]">{c.name}</p>
                </div>
                <div className="flex-1 h-2.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                  <div className="h-2.5 rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${donePct}%` }} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0 w-24 justify-end">
                  <span className="text-[9px] tabular-nums text-emerald-600 font-bold">{donePct}%</span>
                  {c.overdue > 0 && (
                    <span className="text-[9px] font-bold tabular-nums text-red-500 bg-red-500/10 px-1 py-0.5 rounded">
                      {c.overdue}↑
                    </span>
                  )}
                  <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{c.total}t</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STATUS_COLS = [
  { key: "pending",     label: "Pend.",  color: "#94a3b8" },
  { key: "in_progress", label: "Edição", color: "#3b82f6" },
  { key: "in_revision", label: "Revis.", color: "#f97316" },
  { key: "review",      label: "Aprov.", color: "#f59e0b" },
  { key: "completed",   label: "Feito",  color: "#22c55e" },
];

function ClientStatusCard({ allTasks, menu }: { allTasks: AllTask[]; menu?: React.ReactNode }) {
  const clientMap = new Map<string, Record<string, number>>();
  for (const t of allTasks) {
    const key = t.client ?? "Sem cliente";
    if (!clientMap.has(key)) clientMap.set(key, Object.fromEntries(STATUS_COLS.map(s => [s.key, 0])));
    const row = clientMap.get(key)!;
    if (row[t.status] !== undefined) row[t.status]++;
  }
  const clients = [...clientMap.entries()]
    .map(([name, counts]) => ({ name, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return (
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Cliente × Status</span>
        </div>
        {menu}
      </div>
      {clients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem dados</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 py-1.5 gap-0.5">
          <div className="flex items-center shrink-0 pb-1">
            <div className="w-28 shrink-0" />
            {STATUS_COLS.map(s => (
              <div key={s.key} className="flex-1 flex justify-center">
                <span className="text-[8px] font-bold leading-none" style={{ color: s.color }}>{s.label}</span>
              </div>
            ))}
          </div>
          {clients.map(c => (
            <div key={c.name} className="flex items-center gap-0 flex-1 min-h-0">
              <div className="w-28 shrink-0 pr-2">
                <p className="text-[10px] font-medium truncate text-[hsl(var(--muted-foreground))]">{c.name}</p>
              </div>
              {STATUS_COLS.map(s => {
                const count = c.counts[s.key] ?? 0;
                const intensity = c.total > 0 ? count / c.total : 0;
                const alpha = count > 0 ? (0.18 + intensity * 0.72) : 0;
                return (
                  <div key={s.key} className="flex-1 flex items-center justify-center h-full min-h-[18px] max-h-[26px] rounded mx-0.5 transition-colors"
                    style={{ backgroundColor: count > 0 ? s.color + Math.round(alpha * 255).toString(16).padStart(2, "0") : "transparent" }}>
                    <span className="text-[9px] font-bold tabular-nums"
                      style={{ color: count > 0 ? (intensity > 0.45 ? "#fff" : s.color) : "transparent" }}>
                      {count > 0 ? count : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Alternative slot-5 cards (coordinator bottom section) ────────────────────

function HealthRadarCard({ allTasks, atRisk, workload, menu }: {
  allTasks: AllTask[]; atRisk: AtRiskTask[]; workload: EditorWorkload[]; menu?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const active     = allTasks.filter(t => !["completed","cancelled"].includes(t.status));
  const completed  = allTasks.filter(t => t.status === "completed").length;
  const total      = allTasks.length;
  const reviewCnt  = active.filter(t => t.status === "review").length;
  const inProgress = active.filter(t => t.status === "in_progress").length;

  const pontualidade = active.length > 0 ? Math.round((1 - atRisk.length / active.length) * 100) : 100;
  const fluxo        = active.length > 0 ? Math.min(100, Math.round((inProgress / active.length) * 200)) : 0;
  const conclusao    = total > 0 ? Math.round(completed / total * 100) : 0;
  const scores       = workload.map(e => e.score);
  const avg          = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const variance     = scores.length > 0 ? scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length : 0;
  const equilibrio   = Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(variance) * 4)));
  const aprovacao    = active.length > 0 ? Math.round((1 - reviewCnt / active.length) * 100) : 100;

  const muted = isDark ? "rgba(148,163,184,0.45)" : "rgba(100,116,139,0.45)";
  const chartOption = {
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 600,
    radar: {
      indicator: [
        { name: "Pontualidade", max: 100 },
        { name: "Fluxo",        max: 100 },
        { name: "Conclusão",    max: 100 },
        { name: "Equilíbrio",   max: 100 },
        { name: "Aprovação",    max: 100 },
      ],
      radius: "68%",
      center: ["50%", "55%"],
      nameGap: 6,
      name: { color: muted, fontSize: 9, fontFamily: "inherit" },
      splitNumber: 4,
      axisLine:  { lineStyle: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" } },
      splitLine: { lineStyle: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" } },
      splitArea: { show: false },
    },
    series: [{
      type: "radar",
      data: [{
        value: [pontualidade, fluxo, conclusao, equilibrio, aprovacao],
        areaStyle: { color: "rgba(99,102,241,0.14)" },
        lineStyle:  { color: "#6366f1", width: 2 },
        itemStyle:  { color: "#6366f1" },
        symbol: "circle", symbolSize: 5,
      }],
    }],
    tooltip: {
      trigger: "item",
      backgroundColor: isDark ? "#1e293b" : "#fff",
      borderColor: isDark ? "#334155" : "#e2e8f0",
      textStyle: { fontSize: 11, color: isDark ? "#e2e8f0" : "#1e293b", fontFamily: "inherit" },
    },
  };

  return (
    <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <Activity className="h-4 w-4 text-[hsl(var(--primary))]" />
        <span className="font-semibold text-sm">Radar de Saúde</span>
        <div className="ml-auto">{menu}</div>
      </div>
      <ReactECharts
        option={chartOption}
        style={{ height: 248, width: "100%" }}
        opts={{ renderer: "canvas", devicePixelRatio: window.devicePixelRatio || 1 }}
        lazyUpdate
      />
    </div>
  );
}

function KPIComparisonCard({ allTasks, history, menu }: {
  allTasks: AllTask[]; history: StatusHistory | null; menu?: React.ReactNode;
}) {
  const active     = allTasks.filter(t => !["completed","cancelled"].includes(t.status));
  const review     = active.filter(t => t.status === "review").length;
  const inProgress = active.filter(t => t.status === "in_progress").length;
  const pending    = active.filter(t => t.status === "pending").length;

  const comp = history?.series["completed"] ?? [];
  const len  = comp.length;
  const thisWeek = len >= 1 ? Math.max(0, (comp[len - 1] ?? 0) - (comp[Math.max(0, len - 8)] ?? 0)) : 0;
  const lastWeek = len >= 8 ? Math.max(0, (comp[Math.max(0, len - 8)] ?? 0) - (comp[Math.max(0, len - 15)] ?? 0)) : 0;

  const kpis = [
    { label: "Em edição",    value: inProgress, prev: null as number | null, color: "#3b82f6" },
    { label: "Para aprovar", value: review,      prev: null as number | null, color: "#f59e0b" },
    { label: "Pendentes",    value: pending,     prev: null as number | null, color: "#94a3b8" },
    { label: "Concluídas/sem", value: thisWeek, prev: lastWeek,              color: "#22c55e" },
  ];

  return (
    <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <Zap className="h-4 w-4 text-[hsl(var(--primary))]" />
        <span className="font-semibold text-sm">KPIs da Equipe</span>
        <div className="ml-auto">{menu}</div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 md:grid-cols-4 divide-x divide-y" style={{ minHeight: 248 }}>
        {kpis.map(kpi => {
          const diff = kpi.prev !== null ? kpi.value - kpi.prev : null;
          return (
            <div key={kpi.label} className="flex flex-col justify-center items-center gap-1.5 px-4 py-6">
              <span className="text-3xl font-black tabular-nums leading-none"
                style={{ color: kpi.value > 0 ? kpi.color : "hsl(var(--muted-foreground)/40%)" }}>
                {kpi.value}
              </span>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] text-center leading-tight">{kpi.label}</span>
              {diff !== null && (
                <span className={`text-[9px] font-semibold ${diff > 0 ? "text-emerald-500" : diff < 0 ? "text-red-500" : "text-[hsl(var(--muted-foreground))]"}`}>
                  {diff > 0 ? `+${diff}` : diff === 0 ? "= ant." : `${diff}`} vs semana ant.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Delivery Projection Card ──────────────────────────────────────────────────

function DeliveryProjectionCard({
  allTasks,
  history,
  menu,
}: {
  allTasks: { status: string; dueDate?: string | null }[];
  history: StatusHistory | null;
  menu?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

  const parse = (s: string | null | undefined): Date | null => {
    if (!s) return null;
    return new Date(s.includes("T") ? s : s + "T00:00:00");
  };

  const activeTasks = allTasks.filter(t => !["completed", "cancelled"].includes(t.status));
  const total = allTasks.length;
  const completedCount = allTasks.filter(t => t.status === "completed").length;
  const completionPct = total > 0 ? Math.round(completedCount / total * 100) : 0;

  const buckets = [
    { key: "overdue", label: "Atrasadas", color: "#ef4444", count: activeTasks.filter(t => { const d = parse(t.dueDate); return d !== null && d < today; }).length },
    { key: "week1",   label: "Esta sem.", color: "#f97316", count: activeTasks.filter(t => { const d = parse(t.dueDate); return d !== null && d >= today && d < inDays(7); }).length },
    { key: "week2",   label: "Próxima",   color: "#f59e0b", count: activeTasks.filter(t => { const d = parse(t.dueDate); return d !== null && d >= inDays(7) && d < inDays(14); }).length },
    { key: "week3",   label: "Sem. +2",   color: "#3b82f6", count: activeTasks.filter(t => { const d = parse(t.dueDate); return d !== null && d >= inDays(14) && d < inDays(21); }).length },
    { key: "later",   label: "Depois",    color: "#94a3b8", count: activeTasks.filter(t => { const d = parse(t.dueDate); return d === null || d >= inDays(21); }).length },
  ];

  let velocity = 0;
  if (history?.series["completed"]) {
    const comp = history.series["completed"];
    const len = comp.length;
    if (len >= 2) velocity = Math.max(0, (comp[len - 1] ?? 0) - (comp[Math.max(0, len - 8)] ?? 0));
  }

  const overdueCount = buckets[0].count;
  const thisWeekCount = buckets[1].count;
  const inProgress = activeTasks.filter(t => ["in_progress", "in_revision", "review"].includes(t.status)).length;
  const onTrack = overdueCount === 0 && (velocity >= thisWeekCount || thisWeekCount === 0);

  const mutedColor = isDark ? "rgba(148,163,184,0.55)" : "rgba(100,116,139,0.55)";
  const gridLine   = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";

  const chartOption = {
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 700,
    animationEasing: "cubicOut",
    grid: { top: 20, bottom: 42, left: 8, right: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: buckets.map(b => b.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: mutedColor, fontFamily: "inherit", margin: 8 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: mutedColor, fontFamily: "inherit" },
      splitLine: { lineStyle: { color: gridLine, type: "dashed" } },
      minInterval: 1,
    },
    series: [{
      type: "bar",
      data: buckets.map(b => ({
        value: b.count,
        itemStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: b.color + "cc" },
              { offset: 1, color: b.color + "33" },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barMaxWidth: 48,
      label: {
        show: true,
        position: "top",
        fontSize: 11,
        fontWeight: "bold",
        fontFamily: "inherit",
        color: mutedColor,
        formatter: (p: any) => p.value > 0 ? String(p.value) : "",
      },
    }],
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1e293b" : "#ffffff",
      borderColor: isDark ? "#334155" : "#e2e8f0",
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: isDark ? "#e2e8f0" : "#1e293b", fontSize: 12, fontFamily: "inherit" },
      formatter: (params: any[]) => {
        const p = params[0];
        if (!p) return "";
        const b = buckets[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${b.label}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${b.color};display:inline-block"></span>
            ${p.value} tarefa${p.value !== 1 ? "s" : ""}
          </div>`;
      },
    },
    legend: { show: false },
  };

  const statusRows = [
    { key: "in_progress", label: "Editando",  color: "#3b82f6" },
    { key: "in_revision", label: "Revisando", color: "#f97316" },
    { key: "review",      label: "Aprovar",   color: "#f59e0b" },
    { key: "pending",     label: "Pendente",  color: "#94a3b8" },
  ];

  return (
    <div className="h-full rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <CalendarClock className="h-4 w-4 text-[hsl(var(--primary))]" />
        <span className="font-semibold text-sm">Projeção de entregas</span>
        {activeTasks.length > 0 && (
          <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
            {activeTasks.length} ativas
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {onTrack
            ? <span className="text-green-600 font-semibold">No prazo</span>
            : <span className="text-red-500 font-semibold">{overdueCount > 0 ? `${overdueCount} atrasada${overdueCount !== 1 ? "s" : ""}` : "Atenção"}</span>
          }
          <span className="text-[hsl(var(--muted-foreground))]"><strong className="text-emerald-500">{completionPct}%</strong> concluídas</span>
        </div>
        {menu}
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Bar chart */}
        <div className="flex-1 min-w-0 relative" style={{ minHeight: 248 }}>
          {activeTasks.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
              <CalendarClock className="h-10 w-10 opacity-15" />
              <p className="text-sm">Nenhuma tarefa ativa</p>
            </div>
          ) : (
            <ReactECharts
              option={chartOption}
              style={{ height: "100%", width: "100%", minHeight: 248 }}
              opts={{ renderer: "canvas", devicePixelRatio: window.devicePixelRatio || 1 }}
              lazyUpdate
            />
          )}
        </div>

        {/* Right panel — hidden on mobile */}
        <div className="hidden sm:flex w-44 shrink-0 border-l flex-col">
          <div className="px-4 py-4 flex flex-col gap-2.5 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-0.5">
              Ritmo · 7 dias
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums">{velocity}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">concluídas</span>
            </div>

            <div className="border-t pt-2.5 mt-0.5 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mb-0.5">
                Por status
              </p>
              {statusRows.map(s => {
                const count = activeTasks.filter(t => t.status === s.key).length;
                return (
                  <div key={s.key} className="flex items-center gap-2 min-w-0">
                    <div className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: count > 0 ? s.color : "hsl(var(--muted-foreground)/40%)" }} />
                    <span className="text-xs text-[hsl(var(--muted-foreground))] flex-1 truncate leading-none">{s.label}</span>
                    <span className="text-xs font-bold tabular-nums leading-none"
                      style={{ color: count > 0 ? s.color : "hsl(var(--muted-foreground)/40%)" }}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-4 py-3 border-t shrink-0">
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${onTrack ? "text-green-600" : overdueCount > 0 ? "text-red-500" : "text-amber-500"}`}>
              {onTrack
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              }
              <span>{onTrack ? "Ritmo saudável" : overdueCount > 0 ? "Tarefas atrasadas" : "Ritmo baixo"}</span>
            </div>
            {thisWeekCount > 0 && (
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                {thisWeekCount} entrega{thisWeekCount !== 1 ? "s" : ""} esta semana
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t bg-[hsl(var(--muted))]/10 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[hsl(var(--muted-foreground))] shrink-0">
        <span><strong className="text-emerald-600">{completedCount}</strong> concluídas no total</span>
        {inProgress > 0 && <span><strong className="text-blue-500">{inProgress}</strong> em andamento</span>}
        {velocity > 0 && <span>ritmo: <strong className="text-[hsl(var(--foreground))]">{velocity}/sem</strong></span>}
        <Link href="/tasks?tab=timeline" className="ml-auto text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
          Ver timeline <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function WorkloadCard({ workload }: { workload: EditorWorkload[] }) {
  const sorted = [...workload].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...sorted.map(e => e.score), 1);
  const [tip, setTip] = useState<{ x: number; y: number; editor: EditorWorkload } | null>(null);

  return (
    <div className="rounded-xl border bg-[hsl(var(--card))] card-float h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-semibold text-sm">Editores</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{workload.length}</span>
        </div>
        <Link href="/team" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
          Ver todos <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {workload.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10 flex-1">Nenhum editor cadastrado.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y">
          {sorted.map(editor => {
            const color = scoreColor(editor.score);
            const firstName = editor.name.split(" ")[0];
            return (
              <div
                key={editor.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors cursor-default"
                onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY, editor })}
                onMouseMove={e => setTip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setTip(null)}
              >
                <AvatarDisplay name={editor.name} avatarUrl={editor.avatarUrl} size={32} style={{ borderColor: color, borderWidth: 2 }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{firstName}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {editor.taskCount === 0 ? "disponível" : `${editor.taskCount} ativa${editor.taskCount !== 1 ? "s" : ""}`}
                    {(editor.scheduledCount ?? 0) > 0 && (
                      <span className="ml-1 text-sky-500">+{editor.scheduledCount} agend.</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>
                    {scoreLabel(editor.score)}
                  </span>
                  {(editor.scheduledScore ?? 0) > 0 && (
                    <span className="text-[8px] text-sky-500 leading-none">
                      +{editor.scheduledScore}pts agend.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tip && createPortal(
        <div
          className="pointer-events-none fixed z-[99999] rounded-lg border bg-[hsl(var(--card))] shadow-xl p-3 text-xs space-y-1.5 min-w-[170px]"
          style={{ left: tip.x + 14, top: tip.y - 8 }}
        >
          <p className="font-semibold">{tip.editor.name}</p>
          <p className="text-[hsl(var(--muted-foreground))]">{tip.editor.taskCount} tarefa(s) ativa(s) · score {tip.editor.score}pts</p>
          {(tip.editor.scheduledCount ?? 0) > 0 && (
            <p className="text-sky-500">{tip.editor.scheduledCount} agendada(s) · +{tip.editor.scheduledScore}pts → projetado {tip.editor.projectedScore}pts</p>
          )}
          {((tip.editor.byComplexity?.high   ?? 0) > 0) && <p className="text-[hsl(var(--muted-foreground))]">Alta: {tip.editor.byComplexity.high}</p>}
          {((tip.editor.byComplexity?.medium ?? 0) > 0) && <p className="text-[hsl(var(--muted-foreground))]">Média: {tip.editor.byComplexity.medium}</p>}
          {((tip.editor.byComplexity?.low    ?? 0) > 0) && <p className="text-[hsl(var(--muted-foreground))]">Baixa: {tip.editor.byComplexity.low}</p>}
          {tip.editor.taskCount === 0 && (tip.editor.scheduledCount ?? 0) === 0 && <p className="text-[hsl(var(--muted-foreground))]">Sem tarefas ativas</p>}
          <div className="border-t pt-1.5 space-y-0.5">
            {tip.editor.byStatus.pending     > 0 && <p className="text-slate-500">{tip.editor.byStatus.pending} pendente(s)</p>}
            {tip.editor.byStatus.in_progress > 0 && <p className="text-blue-600">{tip.editor.byStatus.in_progress} em edição</p>}
            {tip.editor.byStatus.in_revision > 0 && <p className="text-orange-600">{tip.editor.byStatus.in_revision} em alteração</p>}
            {tip.editor.byStatus.review      > 0 && <p className="text-amber-600">{tip.editor.byStatus.review} para aprovar</p>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const STATUS_BAR: Record<string, string> = {
  pending:     "bg-slate-300",
  in_progress: "bg-blue-400",
  in_revision: "bg-orange-400",
  review:      "bg-amber-400",
  completed:   "bg-green-500",
};

// ── Command Panel Card (coordinator only) ────────────────────────────────────

function CommandPanelCard({ tasks, allTasks, atRiskCount, menu }: {
  tasks: Task[];
  allTasks: AllTask[];
  atRiskCount: number;
  menu?: React.ReactNode;
}) {
  const reviewCount    = tasks.filter(t => t.status === "review").length;
  const inRevisionCount = tasks.filter(t => t.status === "in_revision").length;
  const inProgressCount = tasks.filter(t => t.status === "in_progress").length;
  const completedAll   = tasks.filter(t => t.status === "completed").length;
  const completionPct  = tasks.length > 0 ? Math.round(completedAll / tasks.length * 100) : 0;

  const urgentCount = reviewCount + atRiskCount;
  const hasAlert    = urgentCount > 0;

  const kpis = [
    { label: "Aprovar",   value: reviewCount,     color: "#f59e0b", alert: reviewCount > 0 },
    { label: "Atrasadas", value: atRiskCount,     color: "#ef4444", alert: atRiskCount > 0 },
    { label: "Edição",    value: inProgressCount, color: "#3b82f6", alert: false },
    { label: "Concluídas", value: `${completionPct}%`, color: "#22c55e", alert: false },
  ];

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Zap className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Painel de Comando</span>
        </div>
        {hasAlert
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none bg-amber-500/10 text-amber-600 shrink-0">Ação</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none bg-green-500/10 text-green-600 shrink-0">Em dia</span>
        }
        {menu}
      </div>

      {/* 2×2 KPI grid — borders applied per-index to avoid divide-x/y grid bug */}
      <div className="flex-1 min-h-0 grid grid-cols-2">
        {kpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className={[
              "flex flex-col justify-center px-3.5 py-2 gap-0.5 min-w-0",
              i % 2 === 1 ? "border-l border-[hsl(var(--border))]/60" : "",
              i >= 2      ? "border-t border-[hsl(var(--border))]/60" : "",
            ].join(" ")}
          >
            <span
              className="text-2xl font-bold tabular-nums leading-none"
              style={{ color: (typeof kpi.value === "number" ? kpi.value : parseFloat(kpi.value)) > 0 ? kpi.color : "hsl(var(--muted-foreground)/50%)" }}
            >
              {kpi.value}
            </span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium leading-none mt-0.5">
              {kpi.label}
            </span>
            {kpi.alert && (
              <div className="w-1.5 h-1.5 rounded-full mt-1" style={{ backgroundColor: kpi.color }} />
            )}
          </div>
        ))}
      </div>

      {/* Alert footer */}
      <div className={`px-3.5 py-2 border-t shrink-0 flex items-center gap-1.5 text-[10px] font-semibold ${hasAlert ? "bg-amber-500/5 text-amber-600" : "text-[hsl(var(--muted-foreground))]"}`}>
        {hasAlert
          ? <><AlertTriangle className="h-3 w-3 shrink-0" />{urgentCount} precisam de ação</>
          : <><CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />Tudo sob controle</>
        }
        {inRevisionCount > 0 && (
          <span className="ml-auto text-orange-500">{inRevisionCount} em revisão</span>
        )}
      </div>
    </div>
  );
}

// ── Editor: Painel de controle ───────────────────────────────────────────────
function EditorPanelCard({ tasks, overdueCount }: { tasks: Task[]; overdueCount: number }) {
  const inRevisionCount = tasks.filter(t => t.status === "in_revision").length;
  const pendingCount    = tasks.filter(t => t.status === "pending").length;
  const inProgressCount = tasks.filter(t => t.status === "in_progress").length;
  const completed       = tasks.filter(t => t.status === "completed").length;
  const completionPct   = tasks.length > 0 ? Math.round(completed / tasks.length * 100) : 0;
  const hasAlert = inRevisionCount > 0 || overdueCount > 0;
  const kpis = [
    { label: "Alterar",    value: inRevisionCount, color: "#f97316", alert: inRevisionCount > 0 },
    { label: "Atrasadas",  value: overdueCount,    color: "#ef4444", alert: overdueCount > 0 },
    { label: "Em edição",  value: inProgressCount, color: "#3b82f6", alert: false },
    { label: "Concluídas", value: `${completionPct}%`, color: "#22c55e", alert: false },
  ];
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Zap className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Painel de controle</span>
        </div>
        {hasAlert
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none bg-amber-500/10 text-amber-600 shrink-0">Ação</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none bg-green-500/10 text-green-600 shrink-0">Em dia</span>
        }
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2">
        {kpis.map((kpi, i) => (
          <div key={kpi.label} className={["flex flex-col justify-center px-3.5 py-2 gap-0.5 min-w-0", i % 2 === 1 ? "border-l border-[hsl(var(--border))]/60" : "", i >= 2 ? "border-t border-[hsl(var(--border))]/60" : ""].join(" ")}>
            <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: (typeof kpi.value === "number" ? kpi.value : parseFloat(kpi.value)) > 0 ? kpi.color : "hsl(var(--muted-foreground)/50%)" }}>
              {kpi.value}
            </span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium leading-none mt-0.5">{kpi.label}</span>
            {kpi.alert && <div className="w-1.5 h-1.5 rounded-full mt-1" style={{ backgroundColor: kpi.color }} />}
          </div>
        ))}
      </div>
      <div className={`px-3.5 py-2 border-t shrink-0 flex items-center gap-1.5 text-[10px] font-semibold ${hasAlert ? "bg-amber-500/5 text-amber-600" : "text-[hsl(var(--muted-foreground))]"}`}>
        {hasAlert
          ? <><AlertTriangle className="h-3 w-3 shrink-0" />{inRevisionCount + overdueCount} precisam de atenção</>
          : <><CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />Tudo sob controle</>
        }
        {pendingCount > 0 && <span className="ml-auto text-slate-500">{pendingCount} pendente{pendingCount !== 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}

// ── Editor: Minha Semana (heatmap pessoal) ───────────────────────────────────
function EditorWeekCard({ tasks }: { tasks: Task[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  type HeatTask = { title: string; client?: string | null };
  const [tip, setTip] = useState<{ x: number; y: number; tasks: HeatTask[] } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const activeTasks = tasks.filter(t => !["completed", "cancelled", "rascunho"].includes(t.status) && t.dueDate);
  const cells = days.map(d => activeTasks.filter(t => t.dueDate?.split("T")[0] === dayKey(d)));
  const maxCount = Math.max(...cells.map(c => c.length), 1);
  const totalDue = cells.flat().length;

  const STATUS_LEGEND = [
    { label: "Pendentes",    status: "pending",     color: "#64748b" },
    { label: "Em edição",    status: "in_progress", color: "#3b82f6" },
    { label: "Em alteração", status: "in_revision", color: "#f97316" },
    { label: "Em revisão",   status: "review",      color: "#f59e0b" },
  ];

  const cellStyle = (count: number): React.CSSProperties => {
    if (count === 0) return { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" };
    const intensity = Math.min(count / Math.max(maxCount, 2), 1);
    return { backgroundColor: `rgba(99,102,241,${(0.15 + intensity * 0.75).toFixed(2)})` };
  };
  const textColor = (count: number) =>
    count === 0 ? "transparent" : count >= Math.ceil(maxCount * 0.6) ? "#fff" : isDark ? "#c7d2fe" : "#3730a3";

  return (
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0 rounded-t-2xl">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Minha Semana</span>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
          {totalDue > 0
            ? <><strong className="text-[hsl(var(--foreground))]">{totalDue}</strong> entrega{totalDue !== 1 ? "s" : ""} esta semana</>
            : "Sem entregas nos próximos 7 dias"
          }
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 py-2.5 gap-2">
        {/* Day headers */}
        <div className="flex items-center shrink-0">
          <div className="w-20 shrink-0" />
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              <span className={`text-[8px] font-bold leading-none ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/50"}`}>{DAY_ABBR[d.getDay()]}</span>
              <span className={`text-[8px] leading-none mt-0.5 tabular-nums ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/40"}`}>{d.getDate()}</span>
            </div>
          ))}
        </div>
        {/* Single row */}
        <div className="flex items-center gap-1 flex-1 min-h-0">
          <div className="w-20 shrink-0 pr-1.5">
            <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Entregas</p>
          </div>
          {cells.map((dayTasks, i) => {
            const count = dayTasks.length;
            return (
              <div
                key={i}
                className="flex-1 h-full rounded flex items-center justify-center min-h-[22px] max-h-[36px] transition-colors cursor-default"
                style={cellStyle(count)}
                onMouseEnter={count > 0 ? e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, tasks: dayTasks.map(t => ({ title: t.title, client: t.client })) }); } : undefined}
                onMouseLeave={count > 0 ? () => setTip(null) : undefined}
              >
                <span className="text-[11px] font-bold tabular-nums" style={{ color: textColor(count) }}>{count > 0 ? count : ""}</span>
              </div>
            );
          })}
        </div>
        {/* Status legend */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {STATUS_LEGEND.map(s => {
            const cnt = tasks.filter(t => t.status === s.status).length;
            return cnt > 0 ? (
              <div key={s.status} className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{cnt} {s.label}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>
      {tip && createPortal(
        <div className="pointer-events-none fixed z-[99999] rounded-lg border bg-[hsl(var(--card))] shadow-xl p-2.5 space-y-1.5 w-max max-w-[200px]" style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}>
          {tip.tasks.map((t, ti) => (
            <div key={ti} className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold leading-snug">{t.title}</p>
              {t.client && <p className="text-[10px] text-muted-foreground">{t.client}</p>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

interface ActionRow { label: string; count: number; color: string; gradientId?: string; }

function ActionCard({ label, actionCount, total, rows }: {
  label: string; actionCount: number; total: number; rows: ActionRow[];
}) {
  const { ref, w, h } = useSize();
  const visxData = rows.map((r, i) => ({ ...r, gradientId: `sbg-${i}` }));
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-2 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="text-xs font-semibold text-[hsl(var(--foreground))]/80 truncate">{label}</p>
        {actionCount > 0
          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 bg-amber-500/10 text-amber-600">Atenção</span>
          : <span className="text-xs font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 bg-green-500/10 text-green-600">Em dia</span>
        }
      </div>
      <div className="flex items-baseline gap-1.5 mt-1 shrink-0">
        <span className={`text-2xl font-bold tabular-nums leading-none ${actionCount > 0 ? "text-amber-500" : "text-green-500"}`}>
          {actionCount}
        </span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
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
        <p className="text-xs font-semibold text-[hsl(var(--foreground))]/80 truncate">{label}</p>
        {pill && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 ${pill.cls}`}>{pill.text}</span>}
      </div>
      <div ref={ref} className="flex-1 min-h-0 -mx-2 mt-1">
        <StatusBars data={data} width={w} height={h} />
      </div>
      <p className={`text-xs px-1 shrink-0 mt-1 ${subCls}`}>{sub}</p>
    </div>
  );
}

/* ── Mini Gantt 7 dias ──────────────────────────────────────────── */
interface GanttItem {
  id: number;
  title?: string;
  status: string;
  dueDate?: string | null;
  color?: string | null;
  client?: string | null;
  taskCode?: string;
}

const DAY_ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function MiniGanttCard({ items, onOpenTask, menu }: {
  items: GanttItem[];
  onOpenTask: (id: number) => void;
  menu?: React.ReactNode;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const parse = (s: string) => new Date(s.includes("T") ? s : s + "T00:00:00");

  const due = items
    .filter(t => {
      if (!t.dueDate || ["completed", "cancelled"].includes(t.status)) return false;
      const d = parse(t.dueDate);
      return d >= today && d < new Date(today.getTime() + 7 * 86400000);
    })
    .sort((a, b) => parse(a.dueDate!).getTime() - parse(b.dueDate!).getTime());

  const dayIdx = (dueDate: string) =>
    Math.round((parse(dueDate).getTime() - today.getTime()) / 86400000);

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Próximas entregas</span>
        </div>
        <span className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full leading-none shrink-0 ${due.length > 0 ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
          {due.length} em 7 dias
        </span>
        {menu}
      </div>

      {due.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-[hsl(var(--muted-foreground))]">
          <CalendarClock className="h-8 w-8 opacity-15" />
          <p className="text-xs">Sem entregas nos próximos 7 dias</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* Day headers — fixed, não scrollam */}
          <div className="flex items-end px-2.5 pt-2 pb-1.5 shrink-0 border-b border-[hsl(var(--border))]/40">
            <div className="w-[88px] shrink-0" />
            {days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <span className={`text-[8px] font-semibold leading-none ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/50"}`}>
                  {DAY_ABBR[d.getDay()]}
                </span>
                <span className={`text-[9px] font-bold leading-none tabular-nums ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/40"}`}>
                  {d.getDate()}
                </span>
              </div>
            ))}
          </div>

          {/* Task rows — scrollável */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-[hsl(var(--border))]/40">
            {due.map(t => {
              const idx    = dayIdx(t.dueDate!);
              const accent = t.color ?? "#6366f1";
              const label  = t.title ?? t.client ?? "Tarefa";
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  className="w-full flex items-center px-2.5 py-1.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group min-w-0"
                >
                  <div className="w-[88px] shrink-0 pr-2 text-left min-w-0">
                    {t.taskCode && (
                      <span className="text-[8px] font-mono font-bold text-[hsl(var(--muted-foreground))]/45 block leading-none mb-0.5">
                        {t.taskCode}
                      </span>
                    )}
                    <p className="text-[10px] font-semibold truncate leading-tight group-hover:text-[hsl(var(--primary))] transition-colors">
                      {label}
                    </p>
                  </div>
                  {days.map((_, i) => (
                    <div key={i} className="flex-1 flex justify-center items-center">
                      {i === idx ? (
                        <div
                          className="w-2.5 h-2.5 rounded-full shadow-sm ring-2 ring-offset-1"
                          style={{ backgroundColor: accent, ringColor: accent + "44" }}
                        />
                      ) : (
                        <div className="w-px h-3 bg-[hsl(var(--border))]/30 rounded-full" />
                      )}
                    </div>
                  ))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Overdue Card (shared between coordinator and editor) ───────── */
function daysLate(dueDate: string): string {
  const parsed = new Date(dueDate.includes("T") ? dueDate : dueDate + "T00:00:00");
  const diff = Math.floor((Date.now() - parsed.getTime()) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "1 dia";
  if (diff < 7)  return `${diff} dias`;
  if (diff < 14) return "1 semana";
  return `${Math.floor(diff / 7)} sem.`;
}

interface OverdueItem {
  id: number;
  taskCode?: string;
  title: string;
  dueDate: string;
  client?: string | null;
  color?: string | null;
  assigneeName?: string | null;
  assigneeAvatarUrl?: string | null;
}

interface OverdueEmptyStats {
  active: number;
  completedPct: number;
  nextDueIn: number | null;
}

const OVERDUE_SHOW = 5;

function OverdueCard({ items, onOpenTask, emptyStats }: {
  items: OverdueItem[];
  onOpenTask: (id: number) => void;
  emptyStats?: OverdueEmptyStats;
}) {
  const count   = items.length;
  const visible = items.slice(0, OVERDUE_SHOW);
  const extra   = count - OVERDUE_SHOW;

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${count > 0 ? "text-red-500" : "text-green-500"}`} />
          <span className="text-xs font-semibold">Atrasadas</span>
        </div>
        {count > 0
          ? <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 leading-none">{count}</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 leading-none">Em dia</span>
        }
      </div>

      {count === 0 ? (
        <div className="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-3">
          {/* Big zero — mirrors ActionCard */}
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-3xl font-bold tabular-nums leading-none text-green-500">0</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">atrasadas</span>
          </div>
          <p className="text-[11px] font-semibold text-green-600 mt-0.5 shrink-0">Tudo dentro do prazo</p>

          {emptyStats && emptyStats.active > 0 && (
            <div className="flex-1 min-h-0 flex flex-col justify-end gap-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[hsl(var(--muted-foreground))]">{emptyStats.active} ativas</span>
                <span className="font-semibold text-green-600">{emptyStats.completedPct}% concluídas</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[hsl(var(--muted))]">
                <div className="h-1.5 rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: `${emptyStats.completedPct}%` }} />
              </div>
              {emptyStats.nextDueIn !== null && (
                <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                  <CalendarClock className="h-3 w-3 shrink-0" />
                  <span>
                    {emptyStats.nextDueIn <= 0 ? "Entrega hoje"
                      : emptyStats.nextDueIn === 1 ? "Próxima entrega amanhã"
                      : `Próxima entrega em ${emptyStats.nextDueIn} dias`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Task rows */}
          <div className="flex-1 min-h-0 overflow-hidden divide-y divide-[hsl(var(--border))]/60">
            {visible.map(t => {
              const accent = t.color ?? "#ef4444";
              const sub = [t.assigneeName?.split(" ")[0], t.client].filter(Boolean).join(" · ");
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 hover:bg-red-500/[0.04] transition-colors group min-w-0"
                  style={{ borderLeft: `2.5px solid ${accent}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1 min-w-0">
                      {t.taskCode && (
                        <span className="text-sm font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span>
                      )}
                      <p className="text-[11px] font-semibold truncate leading-snug group-hover:text-red-600 transition-colors">
                        {t.title}
                      </p>
                    </div>
                    {sub && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))]/60 truncate leading-none mt-0.5">{sub}</p>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5">
                    {t.assigneeName && (
                      <AvatarDisplay
                        name={t.assigneeName}
                        avatarUrl={t.assigneeAvatarUrl ?? null}
                        size={30}
                      />
                    )}
                    <span className="text-[10px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full leading-none tabular-nums whitespace-nowrap">
                      {daysLate(t.dueDate)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {extra > 0 && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-1.5 border-t bg-red-500/[0.03]">
              <span className="text-[10px] text-red-500/80 font-medium">
                +{extra} tarefa{extra !== 1 ? "s" : ""} atrasada{extra !== 1 ? "s" : ""}
              </span>
              <Link href="/tasks?tab=lista" className="text-[10px] text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 font-medium">
                Ver todas <ArrowRight className="h-2.5 w-2.5" />
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Weekly Heatmap Card (opção J — Mapa de Calor Semanal) ─────── */
function WeeklyHeatmapCard({ heatmapTasks, workload, menu }: {
  heatmapTasks: { assignedToId: number | null; dueDate: string | null; status: string; title: string; client?: string | null }[];
  workload: EditorWorkload[];
  menu?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  type HeatTask = { title: string; client?: string | null };
  const [tip, setTip] = useState<{ x: number; y: number; tasks: HeatTask[] } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const activeTasks = heatmapTasks;

  const editors = workload.slice(0, 7);

  const heatmap = editors.map(editor => ({
    editor,
    cells: days.map(d =>
      activeTasks.filter(t =>
        t.assignedToId === editor.id &&
        t.dueDate?.split("T")[0] === dayKey(d)
      )
    ),
  }));

  const maxCount = Math.max(...heatmap.flatMap(r => r.cells.map(c => c.length)), 1);

  const totalDue = activeTasks.filter(t => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
    return d >= today && d < new Date(today.getTime() + 7 * 86400000);
  }).length;

  const cellStyle = (count: number): React.CSSProperties => {
    if (count === 0) return { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" };
    const intensity = Math.min(count / Math.max(maxCount, 2), 1);
    const alpha = 0.15 + intensity * 0.75;
    return { backgroundColor: `rgba(99,102,241,${alpha.toFixed(2)})` };
  };

  const textColor = (count: number) =>
    count === 0 ? "transparent" : count >= Math.ceil(maxCount * 0.6) ? "#fff" : isDark ? "#c7d2fe" : "#3730a3";

  return (
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float flex flex-col min-w-0 h-[200px] md:h-[220px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-[hsl(var(--muted))]/30 shrink-0 rounded-t-2xl">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold">Mapa de Calor Semanal</span>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
          {totalDue > 0
            ? <><strong className="text-[hsl(var(--foreground))]">{totalDue}</strong> entrega{totalDue !== 1 ? "s" : ""} esta semana</>
            : "Sem entregas nos próximos 7 dias"
          }
        </span>
        {menu}
      </div>

      {editors.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem editores cadastrados</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 py-1.5 gap-1">

          {/* Day headers */}
          <div className="flex items-center shrink-0">
            <div className="w-16 shrink-0" />
            {days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <span className={`text-[8px] font-bold leading-none ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/50"}`}>
                  {DAY_ABBR[d.getDay()]}
                </span>
                <span className={`text-[8px] leading-none mt-0.5 tabular-nums ${i === 0 ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]/40"}`}>
                  {d.getDate()}
                </span>
              </div>
            ))}
          </div>

          {/* Editor rows */}
          {heatmap.map(({ editor, cells }) => (
            <div key={editor.id} className="flex items-center gap-1 flex-1 min-h-0">
              <div className="w-16 shrink-0 pr-1.5">
                <p className="text-[10px] font-medium truncate text-[hsl(var(--muted-foreground))]">
                  {editor.name.split(" ")[0]}
                </p>
              </div>
              {cells.map((tasks, i) => {
                const count = tasks.length;
                return (
                  <div
                    key={i}
                    className="flex-1 h-full rounded flex items-center justify-center min-h-[18px] max-h-[26px] transition-colors cursor-default"
                    style={cellStyle(count)}
                    onMouseEnter={count > 0 ? e => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTip({ x: r.left + r.width / 2, y: r.top, tasks });
                    } : undefined}
                    onMouseLeave={count > 0 ? () => setTip(null) : undefined}
                  >
                    <span className="text-[9px] font-bold tabular-nums" style={{ color: textColor(count) }}>
                      {count > 0 ? count : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Portal tooltip — renders in document.body, immune to transform/overflow ancestors */}
      {tip && createPortal(
        <div
          className="pointer-events-none fixed z-[99999] rounded-lg border bg-[hsl(var(--card))] shadow-xl p-2.5 space-y-1.5 w-max max-w-[200px]"
          style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}
        >
          {tip.tasks.map((t, ti) => (
            <div key={ti} className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold leading-snug text-[hsl(var(--foreground))]">{t.title}</p>
              {t.client && (
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none">{t.client}</p>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── Task Deadline Card (replaces Saúde dos projetos) ──────────── */
const BUCKET_COLOR: Record<string, string> = {
  overdue: "#ef4444",
  today:   "#f97316",
  in3days: "#f59e0b",
  week:    "#22c55e",
  later:   "#94a3b8",
};

function TaskDeadlineCard({ data, onOpenJob }: {
  data: DeadlineOverview | null;
  onOpenTask: (taskId: number) => void;
}) {
  const { ref, w, h } = useSize();

  const barData = data
    ? data.buckets.map((b, i) => ({ label: b.label, count: b.count, color: b.color, gradientId: `tdl-${i}` }))
    : [];

  const hasUrgent = (data?.urgentCount ?? 0) > 0;

  return (
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
          <p className="text-xs font-semibold text-[hsl(var(--foreground))]/80">Prazos das tarefas</p>
          {data && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{data.total} com prazo</span>
          )}
        </div>
        {!data ? null : hasUrgent ? (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
            {data.urgentCount} urgente{data.urgentCount > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600">Em dia</span>
        )}
      </div>

      {/* ── Empty state ── */}
      {data && data.total === 0 && (
        <div className="flex-1 min-h-0 flex items-center gap-4 px-1 pt-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums leading-none text-[hsl(var(--muted-foreground))]/30">0</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]/60">prazos definidos</span>
            </div>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60 mt-2 leading-snug">
              Defina prazos nas tarefas<br />para ver a distribuição aqui.
            </p>
          </div>
          {/* Ghost bars */}
          <div className="shrink-0 flex items-end gap-1.5 h-16 pr-2 opacity-[0.07]">
            {[40, 70, 25, 90, 55].map((pct, i) => (
              <div key={i} className="w-5 rounded-t-sm bg-[hsl(var(--foreground))]" style={{ height: `${pct}%` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Has data ── */}
      {(!data || data.total > 0) && (
        <div className="flex-1 min-h-0 flex items-stretch gap-2 mt-1">
          {/* Bar chart */}
          <div ref={ref} className="flex-1 min-w-0 min-h-0">
            {!data ? (
              <div className="h-full flex items-center justify-center">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Carregando…</span>
              </div>
            ) : (
              <StatusBars data={barData} width={w} height={h} />
            )}
          </div>

          {/* Right panel */}
          {data && (
            <>
              <div className="w-px self-stretch bg-[hsl(var(--border))] shrink-0" />
              {hasUrgent ? (
                /* Urgent task list */
                <div className="shrink-0 w-[132px] flex flex-col gap-0.5 overflow-hidden pt-0.5">
                  <p className="text-[8px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-1">Mais urgentes</p>
                  {data.urgent.slice(0, 4).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="text-left flex items-start gap-1.5 group hover:bg-[hsl(var(--muted))]/40 rounded px-1 py-0.5 -mx-1 transition-colors min-w-0"
                    >
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                        style={{ backgroundColor: BUCKET_COLOR[t.bucket] ?? "#94a3b8" }} />
                      <div className="flex-1 min-w-0">
                        {t.taskCode && <span className="text-sm font-bold font-mono block text-[hsl(var(--muted-foreground))]">{t.taskCode}</span>}
                        <p className="text-xs font-medium truncate leading-tight group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                          {t.assigneeName ? t.assigneeName.split(" ")[0] : (t.client ?? "")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                /* All on time */
                <div className="shrink-0 w-[120px] flex flex-col justify-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <p className="text-[11px] font-semibold text-green-600">Tudo no prazo</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {data.buckets.filter(b => b.count > 0).map(b => (
                      <div key={b.key} className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] flex-1 truncate">{b.label}</span>
                        <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: b.color }}>{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Waffle Card (editors only) ─────────────────────────────────── */
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
    <div className="col-span-1 sm:col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-xs font-semibold text-[hsl(var(--foreground))]/80">Distribuição de tarefas</p>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{total} tarefas · 1 quadrado = 1%</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center gap-4 mt-1.5">
        <div ref={ref} className="flex-1 min-w-0 min-h-0">
          <WaffleChart cells={cells} width={Math.min(w, h * 1.05)} height={h} />
        </div>
        <div className="shrink-0 flex flex-col justify-center gap-2">
          {counts.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-[hsl(var(--muted-foreground))] w-16 truncate">{s.label}</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
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
  const [, navigate] = useLocation();
  const goToTask = (id: number) => navigate(`/tasks?tab=lista&highlight=${id}`);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [workload, setWorkload] = useState<EditorWorkload[]>([]);
  const [atRisk, setAtRisk] = useState<AtRiskTask[]>([]);
  const [deadlineData, setDeadlineData] = useState<DeadlineOverview | null>(null);
  const [allTasks, setAllTasks]         = useState<AllTask[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistory | null>(null);
  const [heatmapTasks, setHeatmapTasks] = useState<{ assignedToId: number | null; dueDate: string | null; status: string; title: string; client?: string | null }[]>([]);
  const [dutyData, setDutyData] = useState<{
    lastWeekend: { weekendStart: string; satEditors: { id: number; name: string; avatarUrl: string | null }[]; sunEditors: { id: number; name: string; avatarUrl: string | null }[] };
    thisWeekend: { weekendStart: string; satEditors: { id: number; name: string; avatarUrl: string | null }[]; sunEditors: { id: number; name: string; avatarUrl: string | null }[] };
    nextWeekend: { weekendStart: string; satEditors: { id: number; name: string; avatarUrl: string | null }[]; sunEditors: { id: number; name: string; avatarUrl: string | null }[] };
  } | null>(null);
  const [cardPrefs, setCardPrefs] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("jobpro_dash_prefs") ?? "{}"); }
    catch { return {}; }
  });
  const setCardPref = useCallback((slot: string, key: string) => {
    setCardPrefs(prev => {
      const next = { ...prev, [slot]: key };
      localStorage.setItem("jobpro_dash_prefs", JSON.stringify(next));
      return next;
    });
  }, []);

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks").then(setTasks).catch(() => {});
    apiFetch<ActivityEvent[]>("/api/activity").then(setActivity).catch(() => {});
    apiFetch<DeadlineOverview>("/api/deadline-overview").then(setDeadlineData).catch(() => {});
    if (user?.role !== "editor") {
      apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
      apiFetch<AllTask[]>("/api/timeline").then(setAllTasks).catch(() => {});
      apiFetch<StatusHistory>("/api/tasks/status-history").then(setStatusHistory).catch(() => {});
      apiFetch<{ atRisk: AtRiskTask[] }>("/api/dashboard-extras")
        .then(d => { setAtRisk(d.atRisk); })
        .catch(() => {});
      apiFetch<{ assignedToId: number | null; dueDate: string | null; status: string; title: string; client?: string | null }[]>("/api/tasks/heatmap")
        .then(setHeatmapTasks).catch(() => {});
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<typeof dutyData>("/api/duty/upcoming").then(setDutyData).catch(() => {});
  }, []);

  useRealtime({ onTasksChanged: load });

  const byStatus = (s: string) => tasks.filter(t => t.status === s).length;
  const openTasks      = tasks.filter(t => !["completed", "cancelled", "rascunho"].includes(t.status));

  // Tarefas do dia: ativas (sem pausadas/concluídas) e não agendadas para o futuro
  const TODAY_DASH_STR = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const ACTIVE_STATUSES_DASH = new Set(["pending", "in_progress", "in_revision", "review"]);
  const isScheduledDash = (t: Task) => {
    const ref = t.startDate ?? (t.status === "pending" ? t.dueDate : null);
    if (!ref) return false;
    return ref.split("T")[0] > TODAY_DASH_STR;
  };
  const todayTasks = tasks.filter(t => ACTIVE_STATUSES_DASH.has(t.status) && !isScheduledDash(t));

  const isEditor       = user?.role === "editor";

  const actionCount = isEditor
    ? tasks.filter(t => t.status === "pending" || t.status === "in_revision").length
    : byStatus("review");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const editorOverdue: OverdueItem[] = tasks
    .filter(t => {
      if (["completed", "cancelled", "paused", "rascunho"].includes(t.status) || !t.dueDate) return false;
      const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
      return dt < todayStart;
    })
    .map(t => ({ id: t.id, taskCode: t.taskCode, title: t.title, dueDate: t.dueDate!, client: t.client, color: t.color }));

  const coordOverdue: OverdueItem[] = tasks
    .filter(t => {
      if (["completed", "cancelled", "paused", "rascunho"].includes(t.status) || !t.dueDate) return false;
      const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
      return dt < todayStart;
    })
    .map(t => ({
      id: t.id, taskCode: t.taskCode, title: t.title, dueDate: t.dueDate!,
      client: t.client, color: t.color,
      assigneeName: t.assignedTo?.name ?? null, assigneeAvatarUrl: t.assignedTo?.avatarUrl ?? null,
    }));

  // Empty-state stats for OverdueCard
  const editorActive       = openTasks.filter(t => !["cancelled","paused"].includes(t.status)).length;
  const editorCompleted    = tasks.filter(t => t.status === "completed").length;
  const editorCompletedPct = tasks.length > 0 ? Math.round(editorCompleted / tasks.length * 100) : 0;
  const editorNextDue      = tasks
    .filter(t => !["completed","cancelled","paused"].includes(t.status) && t.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0]?.dueDate ?? null;
  const editorNextDueIn    = editorNextDue
    ? Math.ceil((new Date(editorNextDue.includes("T") ? editorNextDue : editorNextDue + "T00:00:00").getTime() - Date.now()) / 86400000)
    : null;

  const coordActive        = allTasks.filter(t => !["completed","cancelled"].includes(t.status)).length;
  const coordCompleted     = allTasks.filter(t => t.status === "completed").length;
  const coordCompletedPct  = allTasks.length > 0 ? Math.round(coordCompleted / allTasks.length * 100) : 0;

  const editorEmptyStats: OverdueEmptyStats = { active: editorActive, completedPct: editorCompletedPct, nextDueIn: editorNextDueIn };
  const coordEmptyStats: OverdueEmptyStats  = { active: coordActive,  completedPct: coordCompletedPct,  nextDueIn: null };
  const inWeek = new Date(todayStart); inWeek.setDate(inWeek.getDate() + 7);
  const overdueCount = tasks.filter(t => {
    if (isTerminal(t.status) || !t.dueDate) return false;
    const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00");
    return dt < todayStart;
  }).length;
  const dueSoonCount = tasks.filter(t => {
    if (isTerminal(t.status) || !t.dueDate) return false;
    const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00");
    return dt >= todayStart && dt <= inWeek;
  }).length;
  const deadlineValue = overdueCount > 0 ? overdueCount : dueSoonCount;
  const deadlineLabel = overdueCount > 0 ? "Atrasadas" : dueSoonCount > 0 ? "Vencem esta semana" : "Sem prazo urgente";

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

  const deadlinePill = overdueCount > 0 ? { text: "Urgente", cls: "bg-red-500/10 text-red-600" }
    : dueSoonCount > 0 ? { text: "Esta semana", cls: "bg-orange-500/10 text-orange-600" }
    : null;
  const deadlineSubCls = overdueCount > 0 ? "text-red-500" : dueSoonCount > 0 ? "text-orange-500" : "text-[hsl(var(--muted-foreground))]";
  const deadlineSub    = overdueCount > 0 ? "Atenção necessária" : dueSoonCount > 0 ? "Nos próximos 7 dias" : "Sem urgências";

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <motion.h1 className="text-[28px] font-semibold tracking-tight" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.18,ease:[0.25,0.1,0.25,1]}}>Olá, {user?.name?.split(" ")[0]}</motion.h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Bem-vindo ao seu painel de controle.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">

        {/* Card 1 — editor: painel de controle | coordinator: personalizável (slot1) */}
        {isEditor ? (
          <EditorPanelCard tasks={tasks} overdueCount={editorOverdue.length} />
        ) : (() => {
          const slot1 = cardPrefs.slot1 ?? "command_panel";
          const menu1 = <CardMenu value={slot1} options={SLOT1_OPTIONS} onChange={v => setCardPref("slot1", v)} />;
          if (slot1 === "health_score")
            return <HealthScoreCard allTasks={allTasks} atRiskCount={coordOverdue.length} menu={menu1} />;
          if (slot1 === "bottleneck")
            return <BottleneckCard allTasks={allTasks} workload={workload} menu={menu1} />;
          return <CommandPanelCard tasks={tasks} allTasks={allTasks} atRiskCount={coordOverdue.length} menu={menu1} />;
        })()}

        {/* Card 2 — editor: mini gantt | coordinator: personalizável (slot2) */}
        {isEditor ? (
          <MiniGanttCard
            items={tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, color: t.color, client: t.client, taskCode: t.taskCode }))}
            onOpenTask={goToTask}
          />
        ) : (() => {
          const slot2 = cardPrefs.slot2 ?? "mini_gantt";
          const menu2 = <CardMenu value={slot2} options={SLOT2_OPTIONS} onChange={v => setCardPref("slot2", v)} />;
          if (slot2 === "capacity")
            return <CapacityCard workload={workload} menu={menu2} />;
          if (slot2 === "approval_queue")
            return <ApprovalQueueCard allTasks={allTasks} onOpenTask={goToTask} menu={menu2} />;
          return (
            <MiniGanttCard
              items={tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, color: t.color, client: t.client, taskCode: t.taskCode }))}
              onOpenTask={goToTask}
              menu={menu2}
            />
          );
        })()}

        {/* Card 3+4 — editor: minha semana | coordinator: personalizável (slot3) */}
        {isEditor ? (
          <EditorWeekCard tasks={tasks} />
        ) : (() => {
          const slot3 = cardPrefs.slot3 ?? "heatmap";
          const menu3 = <CardMenu value={slot3} options={SLOT3_OPTIONS} onChange={v => setCardPref("slot3", v)} />;
          if (slot3 === "client_health")
            return <ClientHealthCard allTasks={allTasks} menu={menu3} />;
          if (slot3 === "client_status")
            return <ClientStatusCard allTasks={allTasks} menu={menu3} />;
          return <WeeklyHeatmapCard heatmapTasks={heatmapTasks} workload={workload} menu={menu3} />;
        })()}
      </div>

      {/* ── COORDINATOR LAYOUT ──────────────────────────────────── */}
      {!isEditor && (
        <div className="grid gap-5 md:grid-cols-4">

          {/* Slot 5 — order-last on mobile so tarefas appear first */}
          <div className="order-last md:order-first md:col-span-3">
            {(() => {
              const slot5 = cardPrefs.slot5 ?? "delivery_projection";
              const menu5 = <CardMenu value={slot5} options={SLOT5_OPTIONS} onChange={v => setCardPref("slot5", v)} />;
              if (slot5 === "health_radar")
                return <HealthRadarCard allTasks={allTasks} atRisk={atRisk} workload={workload} menu={menu5} />;
              if (slot5 === "kpi_comparison")
                return <KPIComparisonCard allTasks={allTasks} history={statusHistory} menu={menu5} />;
              return <DeliveryProjectionCard allTasks={tasks} history={statusHistory} menu={menu5} />;
            })()}
          </div>

          {/* Workload — coluna direita */}
          <WorkloadCard workload={workload} />

          {/* Tarefas */}
          <div className="md:col-span-3 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-[hsl(var(--primary))]" />
                <span className="font-semibold text-sm">Tarefas do dia</span>
                {todayTasks.length > 0 && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{todayTasks.length}</span>
                )}
              </div>
              <Link href="/tasks?tab=lista" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {todayTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa para hoje.</p>
              ) : todayTasks.map(t => (
                <div key={t.id} role="button" onClick={() => goToTask(t.id)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {t.taskCode ? <span className="text-xs font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span> : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    {t.dueDate && (() => {
                      const h = fmtDateHuman(t.dueDate); const n = fmtDate(t.dueDate);
                      return <>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">Entrega: {h}</p>
                        {h !== n && <p className="text-[9px] text-[hsl(var(--muted-foreground))]/40">{n}</p>}
                      </>;
                    })()}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 shrink-0">
                    <div className="hidden sm:flex items-center gap-2">
                      {t.assignedTo && (
                        <AvatarDisplay name={t.assignedTo.name} avatarUrl={t.assignedTo.avatarUrl} size={30} />
                      )}
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <Badge className={`text-[10px] px-1.5 py-0.5 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
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
                <div key={e.id} role="button" onClick={() => goToTask(e.taskId)}
                  className="flex items-center gap-3 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))]/60 shrink-0 w-20">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-xs truncate font-sans min-w-0">
                    {e.taskCode && <span className="font-mono font-bold text-sm text-[hsl(var(--primary))] mr-1">{e.taskCode}</span>}
                    <span className="text-[hsl(var(--foreground))] font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{e.taskTitle}</span>
                    <span className="text-[hsl(var(--muted-foreground))]/60"> · {STATUS_LABEL[e.toStatus] ?? e.toStatus}</span>
                    {e.changedByName && <span className="text-[hsl(var(--muted-foreground))]/40"> · {e.changedByName.split(" ")[0]}</span>}
                  </span>
                  {e.taskStatus !== e.toStatus && (
                    <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${STATUS_CLASS[e.taskStatus] ?? ""}`}>
                      {STATUS_LABEL[e.taskStatus] ?? e.taskStatus}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ENTREGAS DA SEMANA + EM RISCO ──────────────────────── */}
      {!isEditor && (coordOverdue.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">

          {/* Entregas da semana */}
          {(() => {
            const in7 = new Date(todayStart); in7.setDate(in7.getDate() + 7);
            const weekTasks = tasks
              .filter(t => {
                if (!t.dueDate || ["completed","cancelled","paused","rascunho"].includes(t.status)) return false;
                const d = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
                return d >= todayStart && d < in7;
              })
              .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
            return (
              <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <span className="font-semibold text-sm">Entregas previstas esta semana</span>
                    {weekTasks.length > 0 && (
                      <span className="text-xs bg-blue-500/10 text-blue-600 rounded-full px-2 py-0.5">{weekTasks.length}</span>
                    )}
                  </div>
                  <Link href="/tasks?tab=timeline" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                    Ver linha do tempo <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="overflow-y-auto max-h-[280px] divide-y">
                  {weekTasks.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma entrega esta semana.</p>
                  ) : weekTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                      style={{ borderLeft: `4px solid ${t.color ?? "#6366f1"}88` }}
                      onClick={() => goToTask(t.id)}>
                      <div className="flex-1 min-w-0 pl-1">
                        <div className="flex items-center gap-1.5">
                          {t.taskCode && <span className="text-xs font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span>}
                          <p className="text-sm font-medium truncate">{t.title}</p>
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.client ?? ""}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-semibold text-blue-500">{fmtDateHuman(t.dueDate!)}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{fmtDate(t.dueDate!)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Em risco */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                <span className="font-semibold text-sm">Em risco</span>
                {coordOverdue.length > 0 && (
                  <span className="text-xs bg-red-500/10 text-red-600 rounded-full px-2 py-0.5">{coordOverdue.length} atrasada{coordOverdue.length !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            <div className="overflow-y-auto max-h-[280px] divide-y">
              {coordOverdue.length === 0 ? (
                <p className="text-sm text-green-600 text-center py-10">Tudo dentro do prazo.</p>
              ) : coordOverdue.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors cursor-pointer"
                  style={{ borderLeft: `4px solid ${t.color ?? "#6366f1"}88` }}
                  onClick={() => goToTask(t.id)}>
                  <div className="flex-1 min-w-0 pl-1">
                    <div className="flex items-center gap-1.5">
                      {t.taskCode ? <span className="text-sm font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span> : null}
                      <p className="text-sm font-medium truncate">{t.title}</p>
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                      {t.client ?? ""}
                      {t.assigneeName && ` · ${t.assigneeName}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-red-500">{fmtDateHuman(t.dueDate)}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{fmtDate(t.dueDate)}</p>
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
                <span className="font-semibold text-sm">Tarefas do dia</span>
                {todayTasks.length > 0 && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{todayTasks.length}</span>
                )}
              </div>
              <Link href="/tasks?tab=lista" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {todayTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa para hoje.</p>
              ) : todayTasks.map(t => (
                <div key={t.id} role="button" onClick={() => goToTask(t.id)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {t.taskCode ? <span className="text-xs font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span> : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {t.client && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.client}</span>
                      )}
                      {t.dueDate && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap shrink-0">
                          Entrega: {fmtDateHuman(t.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-48 flex items-center justify-end gap-2 shrink-0">
                    {t.createdBy && (
                      <AvatarDisplay name={t.createdBy.name} avatarUrl={t.createdBy.avatarUrl} size={30} />
                    )}
                    <PriorityBadge priority={t.priority} />
                    <Badge className={`text-[10px] px-1.5 py-0.5 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>
                </div>
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
                <div key={e.id} role="button" onClick={() => goToTask(e.taskId)}
                  className="flex items-center gap-3 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))]/60 shrink-0 w-20">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-xs truncate font-sans min-w-0">
                    {e.taskCode && <span className="font-mono font-bold text-sm text-[hsl(var(--primary))] mr-1">{e.taskCode}</span>}
                    <span className="text-[hsl(var(--foreground))] font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{e.taskTitle}</span>
                    <span className="text-[hsl(var(--muted-foreground))]/60"> · {STATUS_LABEL[e.toStatus] ?? e.toStatus}</span>
                    {e.changedByName && <span className="text-[hsl(var(--muted-foreground))]/40"> · {e.changedByName.split(" ")[0]}</span>}
                  </span>
                  {e.taskStatus !== e.toStatus && (
                    <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${STATUS_CLASS[e.taskStatus] ?? ""}`}>
                      {STATUS_LABEL[e.taskStatus] ?? e.taskStatus}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Duty card — visible to all roles ──────────────────────── */}
      {dutyData && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] card-float overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b bg-[hsl(var(--muted))]/30">
            <Shield className="h-4 w-4 text-[hsl(var(--primary))]" />
            <span className="font-semibold text-sm">Plantão</span>
            <Link href="/duty" className="ml-auto text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5">
              Ver escala <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[hsl(var(--border))]">
            {([
              { label: "Este fim de semana", data: dutyData.thisWeekend },
              { label: "Próximo",            data: dutyData.nextWeekend },
            ] as const).map(({ label, data }) => {
              const sat = new Date(data.weekendStart + "T12:00:00");
              const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
              const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
              const allEditors = [...(data.satEditors ?? []), ...(data.sunEditors ?? [])];
              const uniqueEditors = allEditors.filter((e, i) => allEditors.findIndex(x => x.id === e.id) === i);
              const isOnDuty = uniqueEditors.some(e => e.id === user?.id);
              return (
                <div key={data.weekendStart} className="px-5 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{label}</p>
                    <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">{fmt(sat)} – {fmt(sun)}</span>
                  </div>
                  {uniqueEditors.length === 0 ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">Sem editor escalado</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {uniqueEditors.map(e => (
                        <div key={e.id} className="flex items-center gap-1.5">
                          <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={24} />
                          <span className="text-sm font-medium">{e.name.split(" ")[0]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {isOnDuty && label === "Este fim de semana" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] uppercase tracking-wide">
                      <Shield className="h-2.5 w-2.5" /> Você está de plantão
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

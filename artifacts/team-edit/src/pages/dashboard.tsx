import { motion } from "framer-motion";
import { staggerContainer, staggerItem, staggerRow } from "@/lib/motion";
import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { fmtDate, fmtDateHuman, fmtShort } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, ListTodo, ArrowRight, Activity, Users, Clock, BarChart2, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { StatusBars } from "@/components/charts/StatusBars";
import { WaffleChart } from "@/components/charts/WaffleChart";
import { useSize } from "@/hooks/use-size";
import { Link, useLocation } from "wouter";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import { usePageTitle } from "@/lib/use-page-title";
import { PriorityBadge } from "@/components/ui/priority-badge";

interface Task {
  id: number;
  taskCode?: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  client?: string | null;
  color?: string;
  number?: number;
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
  score: number;
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
  changedByName: string | null;
  createdAt: string;
}

interface AllTask {
  id: number;
  status: string;
  client: string | null;
  priority: string;
  complexity: string;
}

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

// ── Production Overview Card ──────────────────────────────────────────────────

const PROD_STATUS = [
  { key: "pending",     label: "Pendente",    color: "#94a3b8" },
  { key: "in_progress", label: "Em edição",   color: "#3b82f6" },
  { key: "in_revision", label: "Em revisão",  color: "#f97316" },
  { key: "review",      label: "Aprovar",     color: "#f59e0b" },
  { key: "completed",   label: "Concluídas",  color: "#22c55e" },
  { key: "paused",      label: "Pausadas",    color: "#a855f7" },
  { key: "cancelled",   label: "Canceladas",  color: "#ef4444" },
];

function DonutRing({ segs }: { segs: Array<{ color: string; pct: number }> }) {
  const R = 38; const cx = 50; const cy = 50; const SW = 16;
  const nonZero = segs.filter(s => s.pct > 0);
  if (nonZero.length === 0)
    return <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}><circle cx={cx} cy={cy} r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth={SW} /></svg>;
  if (nonZero.length === 1)
    return <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}><circle cx={cx} cy={cy} r={R} fill="none" stroke={nonZero[0].color} strokeWidth={SW} /></svg>;
  let angle = -90;
  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
      {segs.map((seg, i) => {
        if (seg.pct === 0) return null;
        const sweep = seg.pct * 360;
        const startRad = (angle * Math.PI) / 180;
        angle += sweep;
        const endRad = ((angle - 0.01) * Math.PI) / 180;
        const x1 = cx + R * Math.cos(startRad); const y1 = cy + R * Math.sin(startRad);
        const x2 = cx + R * Math.cos(endRad);   const y2 = cy + R * Math.sin(endRad);
        return (
          <path key={i}
            d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${sweep > 180 ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)}`}
            fill="none" stroke={seg.color} strokeWidth={SW} strokeLinecap="butt" />
        );
      })}
    </svg>
  );
}

function ProductionCard({ allTasks, onOpenTask }: { allTasks: AllTask[]; onOpenTask: (id: number) => void }) {
  const total  = allTasks.length;
  const active = allTasks.filter(t => !["completed", "cancelled", "paused"].includes(t.status)).length;

  const counts = PROD_STATUS.map(s => ({
    ...s,
    count: allTasks.filter(t => t.status === s.key).length,
  }));
  const segs = counts.map(c => ({ color: c.color, pct: total > 0 ? c.count / total : 0 }));

  const completedCount = counts.find(c => c.key === "completed")?.count ?? 0;
  const revisionCount  = counts.find(c => c.key === "in_revision")?.count ?? 0;
  const reviewCount    = counts.find(c => c.key === "review")?.count ?? 0;
  const completionPct  = total > 0 ? Math.round(completedCount / total * 100) : 0;

  const clientMap = new Map<string, number>();
  allTasks.filter(t => !["completed", "cancelled"].includes(t.status) && t.client).forEach(t => {
    const k = t.client!;
    clientMap.set(k, (clientMap.get(k) ?? 0) + 1);
  });
  const topClients = [...clientMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxClientCount = topClients[0]?.[1] ?? 1;

  return (
    <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
        <BarChart2 className="h-4 w-4 text-[hsl(var(--primary))]" />
        <span className="font-semibold text-sm">Visão geral da produção</span>
        <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">
          {total} tarefa{total !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 divide-x">
        {/* Donut + legend */}
        <div className="flex items-center gap-5 px-5 py-4 flex-1 min-w-0">
          <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
            <DonutRing segs={segs} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold leading-none tabular-nums">{active}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))] leading-tight">ativas</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {counts.map(s => (
              <div key={s.key} className="flex items-center gap-2 min-w-0">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-xs text-[hsl(var(--muted-foreground))] flex-1 truncate">{s.label}</span>
                <span className="text-xs font-bold tabular-nums ml-auto" style={{ color: s.count > 0 ? s.color : "hsl(var(--muted-foreground))" }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top clients */}
        {topClients.length > 0 && (
          <div className="shrink-0 w-[170px] px-4 py-4 flex flex-col gap-1">
            <p className="text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))]/60 mb-2">Clientes com tarefas ativas</p>
            {topClients.map(([client, count]) => (
              <div key={client} className="flex items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{client}</p>
                  <div className="mt-0.5 h-1.5 rounded-full bg-[hsl(var(--muted))]">
                    <div className="h-1.5 rounded-full bg-[hsl(var(--primary))]/50 transition-all"
                      style={{ width: `${Math.round(count / maxClientCount * 100)}%` }} />
                  </div>
                </div>
                <span className="text-xs font-bold tabular-nums shrink-0 text-[hsl(var(--muted-foreground))]">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-2 border-t bg-[hsl(var(--muted))]/10 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[hsl(var(--muted-foreground))] shrink-0">
        <span><strong className="text-green-600">{completionPct}%</strong> concluídas</span>
        {revisionCount > 0 && <span><strong className="text-orange-500">{revisionCount}</strong> em revisão</span>}
        {reviewCount > 0 && <span><strong className="text-amber-500">{reviewCount}</strong> aguardando aprovação</span>}
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

  return (
    <div className="rounded-xl border bg-[hsl(var(--card))] card-float">
      <div className="flex items-center justify-between px-4 py-3.5 border-b bg-[hsl(var(--muted))]/30">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-semibold text-sm">Carga dos editores</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{workload.length}</span>
        </div>
        <Link href="/team" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
          Ver todos <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {workload.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhum editor cadastrado.</p>
      ) : (
        <div className="divide-y">
          {sorted.map(editor => {
            const color = scoreColor(editor.score);
            const firstName = editor.name.split(" ")[0];
            return (
              <div key={editor.id} className="group relative flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors">
                <AvatarDisplay
                  name={editor.name}
                  avatarUrl={editor.avatarUrl}
                  size={32}
                  fallbackColor={color}
                />
                <span className="text-xs font-medium w-16 shrink-0 truncate">{firstName}</span>
                <div className="flex-1 flex items-center">
                  <Battery score={editor.score} maxScore={maxScore} color={color} />
                </div>
                <span className="text-xs font-semibold shrink-0 px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: color + "22", color }}>
                  {scoreLabel(editor.score)}
                </span>
                <div className="pointer-events-none absolute left-4 top-full mt-1 z-[9999] hidden group-hover:block
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
                        size={26}
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
    <div className="col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
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
    <div className="col-span-2 rounded-2xl border bg-[hsl(var(--card))] card-float px-4 pt-4 pb-3 flex flex-col min-w-0 h-[200px] md:h-[220px] overflow-hidden">
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

  const load = useCallback(() => {
    apiFetch<Task[]>("/api/my-tasks").then(setTasks).catch(() => {});
    apiFetch<ActivityEvent[]>("/api/activity").then(setActivity).catch(() => {});
    apiFetch<DeadlineOverview>("/api/deadline-overview").then(setDeadlineData).catch(() => {});
    if (user?.role !== "editor") {
      apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
      apiFetch<AllTask[]>("/api/timeline").then(setAllTasks).catch(() => {});
      apiFetch<{ atRisk: AtRiskTask[] }>("/api/dashboard-extras")
        .then(d => { setAtRisk(d.atRisk); })
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useRealtime({ onTasksChanged: load });

  const byStatus = (s: string) => tasks.filter(t => t.status === s).length;
  const openTasks      = tasks.filter(t => t.status !== "completed");
  const isEditor       = user?.role === "editor";

  const actionCount = isEditor
    ? tasks.filter(t => t.status === "pending" || t.status === "in_revision").length
    : byStatus("review");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const editorOverdue: OverdueItem[] = tasks
    .filter(t => {
      if (["completed", "cancelled", "paused"].includes(t.status) || !t.dueDate) return false;
      const dt = new Date(t.dueDate.includes("T") ? t.dueDate : t.dueDate + "T00:00:00");
      return dt < todayStart;
    })
    .map(t => ({ id: t.id, taskCode: t.taskCode, title: t.title, dueDate: t.dueDate!, client: t.client, color: t.color }));

  const coordOverdue: OverdueItem[] = atRisk.map(t => ({
    id: t.id, taskCode: t.taskCode, title: t.title, dueDate: t.dueDate,
    client: t.client, color: t.color,
    assigneeName: t.assigneeName, assigneeAvatarUrl: t.assignee?.avatarUrl ?? null,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* Card 1 — status distribution */}
        <ActionCard
          label={isEditor ? "Para revisar / alterar" : "Aguardando aprovação"}
          actionCount={actionCount}
          total={tasks.length}
          rows={actionRows}
        />

        {/* Card 2 — overdue tasks list for both roles */}
        <OverdueCard
          items={isEditor ? editorOverdue : coordOverdue}
          onOpenTask={goToTask}
          emptyStats={isEditor ? editorEmptyStats : coordEmptyStats}
        />

        {/* Card 3+4 — urgency deadline chart (all tasks, col-span-2) */}
        <TaskDeadlineCard data={deadlineData} onOpenTask={goToTask} />
      </div>

      {/* ── COORDINATOR LAYOUT ──────────────────────────────────── */}
      {!isEditor && (
        <div className="grid gap-5 md:grid-cols-3">

          <ProductionCard allTasks={allTasks} onOpenTask={goToTask} />

          {/* Workload — coluna direita */}
          <WorkloadCard workload={workload} />

          {/* Tarefas */}
          <div className="md:col-span-2 rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-[hsl(var(--primary))]" />
                <span className="font-semibold text-sm">Minhas tarefas em aberto</span>
                {openTasks.length > 0 && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{openTasks.length}</span>
                )}
              </div>
              <Link href="/tasks?tab=board" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {openTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa em aberto.</p>
              ) : openTasks.map(t => (
                <div key={t.id} role="button" onClick={() => goToTask(t.id)}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.taskCode ? <span className="text-sm font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span> : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    {t.dueDate && (() => {
                      const h = fmtDateHuman(t.dueDate); const n = fmtDate(t.dueDate);
                      return <>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">Entrega: {h}</p>
                        {h !== n && <p className="text-xs text-[hsl(var(--muted-foreground))]/50">{n}</p>}
                      </>;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge priority={t.priority} />
                    <Badge className={`text-xs px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
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
                  className="flex items-center gap-4 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/60 shrink-0 w-24">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-xs truncate font-sans">
                    {e.taskCode && <span className="font-mono font-bold text-sm text-[hsl(var(--primary))] mr-1">{e.taskCode}</span>}
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
      {!isEditor && (atRisk.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">

          {/* Entregas da semana */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <span className="font-semibold text-sm">Entregas desta semana</span>
                
              </div>
              <Link href="/tasks?tab=timeline" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver linha do tempo <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[280px] divide-y">
              {[].length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma entrega esta semana.</p>
              ) : [].map(j => {
                const pct = j.taskCount > 0 ? Math.round(j.completedCount / j.taskCount * 100) : 0;
                return (
                  <div key={j.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors"
                    style={{ borderLeft: `4px solid ${j.color ?? "#6366f1"}88` }}>
                    <div className="flex-1 min-w-0 pl-1">
                      <p className="text-sm font-medium truncate">{j.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                        {j.taskClient ?? j.taskTitle}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">{pct}% concluído</p>
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
                  <span className="text-xs bg-red-500/10 text-red-600 rounded-full px-2 py-0.5">{atRisk.length} atrasada{atRisk.length !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            <div className="overflow-y-auto max-h-[280px] divide-y">
              {atRisk.length === 0 ? (
                <p className="text-sm text-green-600 text-center py-10">Tudo dentro do prazo.</p>
              ) : atRisk.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors"
                  style={{ borderLeft: `4px solid ${t.color ?? "#6366f1"}88` }}>
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
                <span className="font-semibold text-sm">Minhas tarefas em aberto</span>
                {openTasks.length > 0 && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{openTasks.length}</span>
                )}
              </div>
              <Link href="/tasks?tab=board" className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5 shrink-0">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-y-auto max-h-[340px] divide-y">
              {openTasks.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-10">Nenhuma tarefa em aberto.</p>
              ) : openTasks.map(t => (
                <div key={t.id} role="button" onClick={() => goToTask(t.id)}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[hsl(var(--muted))]/30 transition-colors group cursor-pointer">
                  <div className={`w-0.5 h-8 rounded-full shrink-0 ${STATUS_BAR[t.status] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.taskCode ? <span className="text-sm font-bold font-mono shrink-0 text-[hsl(var(--muted-foreground))]">{t.taskCode}</span> : null}
                      <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{t.title}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {t.client && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{t.client}</span>
                      )}
                      {t.dueDate && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          Entrega: {fmtDateHuman(t.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge priority={t.priority} />
                    <Badge className={`text-xs px-1.5 ${STATUS_CLASS[t.status] ?? ""}`}>
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
                <Link key={e.id} href="/my-tasks"
                  className="flex items-center gap-3 px-5 py-2 hover:bg-[hsl(var(--muted))]/30 transition-colors group">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/40 w-5 shrink-0 text-right select-none">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]/60 shrink-0 w-24">
                    {fmtShort(e.createdAt)}
                  </span>
                  <span className="flex-1 text-xs truncate font-sans">
                    {e.taskCode && <span className="font-mono font-bold text-sm text-[hsl(var(--primary))] mr-1">{e.taskCode}</span>}
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

    </div>
  );
}

// LifecycleFlow.tsx — task lifecycle modal using @xyflow/react + dagre layout
import { useCallback, useMemo } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
  Handle, Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
import {
  Play, Pencil, Send, MessageSquare, CheckCircle2, Clock, ArrowRight, Tag, X, ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person { id: number; name: string; role: string; avatarUrl: string | null }

interface LifecycleStep {
  type: "created" | "status_change";
  at: string;
  by: Person | null;
  meta: {
    fromStatus?: string; toStatus?: string;
    title?: string; client?: string; priority?: string; color?: string;
    revisionComment?: string; revisionNumber?: number;
  };
}

interface LifecycleTask {
  id: number; title: string; status: string; priority: string;
  complexity: string; dueDate: string | null; color: string;
  client: string | null; revisionCount: number;
  assignee: Person | null; coordinator: Person | null;
}

interface LifecycleData {
  task: LifecycleTask;
  steps: LifecycleStep[];
}

// ── Node style config ─────────────────────────────────────────────────────────

const STEP_CONFIG: Record<string, { bg: string; border: string; text: string; icon: JSX.Element; label: string }> = {
  created:     { bg: "#eef2ff", border: "#818cf8", text: "#4338ca", icon: <Play      className="h-3.5 w-3.5" />, label: "Criação"                },
  pending:     { bg: "#f8fafc", border: "#94a3b8", text: "#475569", icon: <Clock     className="h-3.5 w-3.5" />, label: "Pendente"               },
  in_progress: { bg: "#eff6ff", border: "#60a5fa", text: "#1d4ed8", icon: <Pencil    className="h-3.5 w-3.5" />, label: "Em edição"              },
  review:      { bg: "#fffbeb", border: "#fbbf24", text: "#b45309", icon: <Send      className="h-3.5 w-3.5" />, label: "Enviado p/ aprovação"   },
  in_revision: { bg: "#fff7ed", border: "#fb923c", text: "#c2410c", icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Alteração solicitada" },
  completed:   { bg: "#f0fdf4", border: "#4ade80", text: "#15803d", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Aprovada"             },
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", coordinator: "Coordenador", supervisor: "Supervisor", editor: "Editor",
};

// ── Custom node ───────────────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H_BASE = 120; // grows with revision comment

function StepNode({ data }: NodeProps) {
  const d = data as {
    step: LifecycleStep; index: number; cfg: typeof STEP_CONFIG[string];
  };
  const { step, index, cfg } = d;

  const actorInitials = step.by
    ? step.by.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : null;

  return (
    <div
      className="rounded-xl shadow-md flex flex-col overflow-hidden select-none"
      style={{
        width: NODE_W,
        border: `2px solid ${cfg.border}`,
        background: cfg.bg,
        fontFamily: "inherit",
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: cfg.border + "44" }}>
        <span style={{ color: cfg.text }}>{cfg.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: cfg.text }}>{cfg.label}</span>
        <span className="ml-auto text-[9px] font-semibold rounded-full px-1.5 py-0.5" style={{ background: cfg.border + "22", color: cfg.text }}>
          #{index + 1}
        </span>
      </div>

      {/* From → To (status changes) */}
      {step.type === "status_change" && step.meta.fromStatus && (
        <div className="flex items-center gap-1 px-3 py-1.5 text-[10px]" style={{ color: cfg.text }}>
          <span className="opacity-50 line-through">{STATUS_LABEL[step.meta.fromStatus] ?? step.meta.fromStatus}</span>
          <ArrowRight className="h-2.5 w-2.5 shrink-0 opacity-60" />
          <span className="font-semibold">{STATUS_LABEL[step.meta.toStatus!] ?? step.meta.toStatus}</span>
        </div>
      )}

      {/* Creation meta */}
      {step.type === "created" && step.meta.client && (
        <div className="flex items-center gap-1 px-3 py-1 text-[10px] text-slate-500">
          <Tag className="h-2.5 w-2.5" />{step.meta.client}
        </div>
      )}

      {/* Actor */}
      {step.by && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          {step.by.avatarUrl
            ? <img src={step.by.avatarUrl} className="h-5 w-5 rounded-full object-cover shrink-0" />
            : <div className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[8px] font-bold"
                style={{ background: cfg.border + "33", color: cfg.text }}>
                {actorInitials}
              </div>
          }
          <div className="min-w-0">
            <p className="text-[10px] font-semibold leading-tight truncate" style={{ color: cfg.text }}>{step.by.name}</p>
            <p className="text-[9px] text-slate-400">{ROLE_LABEL[step.by.role] ?? step.by.role}</p>
          </div>
        </div>
      )}

      {/* Revision comment */}
      {step.meta.revisionComment && (
        <div className="mx-2 mb-2 mt-1 rounded-lg p-2 text-[10px] leading-snug"
          style={{ background: "#fed7aa55", border: "1px solid #fb923c44", color: "#9a3412" }}>
          <span className="font-bold block mb-0.5">Revisão #{step.meta.revisionNumber}</span>
          <span className="leading-relaxed">{step.meta.revisionComment}</span>
        </div>
      )}

      {/* Timestamp */}
      <div className="px-3 py-1.5 mt-auto text-[9px] text-slate-400 border-t" style={{ borderColor: cfg.border + "33" }}>
        {format(parseISO(step.at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
      </div>
    </div>
  );
}

const nodeTypes = { step: StepNode };

// ── Dagre layout helper ───────────────────────────────────────────────────────

function layoutNodes(steps: LifecycleStep[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });

  steps.forEach((step, i) => {
    const hasRevision = !!step.meta.revisionComment;
    const h = NODE_H_BASE + (hasRevision ? 60 : 0) + (step.type === "status_change" && step.meta.fromStatus ? 20 : 0);
    g.setNode(String(i), { width: NODE_W, height: h });
  });

  steps.forEach((_, i) => {
    if (i > 0) g.setEdge(String(i - 1), String(i));
  });

  dagre.layout(g);

  return steps.map((step, i) => {
    const node = g.node(String(i));
    const cfg = step.type === "created"
      ? STEP_CONFIG.created
      : STEP_CONFIG[step.meta.toStatus ?? "pending"] ?? STEP_CONFIG.pending;

    return {
      id: String(i),
      type: "step",
      position: { x: node.x - NODE_W / 2, y: node.y - node.height / 2 },
      data: { step, index: i, cfg },
      draggable: false,
    } satisfies Node;
  });
}

function buildEdges(steps: LifecycleStep[]): Edge[] {
  return steps.slice(1).map((_, i) => ({
    id: `e${i}-${i + 1}`,
    source: String(i),
    target: String(i + 1),
    type: "smoothstep",
    animated: i === steps.length - 2, // animate last edge
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#6366f1" },
    style: { stroke: "#6366f155", strokeWidth: 2 },
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LifecycleFlow({
  data, onClose, onOpen,
}: {
  data: LifecycleData;
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const { task, steps } = data;

  const initialNodes = useMemo(() => layoutNodes(steps), [steps]);
  const initialEdges = useMemo(() => buildEdges(steps), [steps]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const isOverdue = task.dueDate
    && task.status !== "completed"
    && new Date(task.dueDate) < new Date();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative flex flex-col rounded-2xl border bg-[hsl(var(--card))] shadow-2xl overflow-hidden"
        style={{ width: "min(96vw, 1500px)", height: "min(90vh, 840px)", minWidth: 340, minHeight: 420 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b bg-[hsl(var(--muted))]/20 shrink-0">
          <div className="h-3 w-3 rounded-full shrink-0" style={{ background: task.color }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{task.title}</p>
            {task.client && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                <Tag className="h-3 w-3" />{task.client}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Badge className={`text-[10px] px-1.5 ${STATUS_CLASS[task.status] ?? ""}`}>
              {STATUS_LABEL[task.status] ?? task.status}
            </Badge>
            {task.dueDate && (
              <span className={`text-[11px] font-medium ${isOverdue ? "text-red-600" : "text-[hsl(var(--muted-foreground))]"}`}>
                Prazo: {format(parseISO(task.dueDate), "dd/MM/yy", { locale: ptBR })}
              </span>
            )}
            <button
              onClick={() => onOpen(task.id)}
              className="text-[11px] text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5"
            >
              Abrir <ExternalLink className="h-3 w-3" />
            </button>
            <button onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Sub-info bar ── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2 border-b bg-[hsl(var(--muted))]/10 text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
          <span>Coordenador: <strong className="text-[hsl(var(--foreground))]">{task.coordinator?.name ?? "—"}</strong></span>
          <span>Editor: <strong className="text-[hsl(var(--foreground))]">{task.assignee?.name ?? "—"}</strong></span>
          <span>{task.revisionCount} revisão{task.revisionCount !== 1 ? "ões" : ""}</span>
          <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]/60 hidden sm:block">
            Arraste para explorar · scroll para zoom · clique num nó para mover o foco
          </span>
        </div>

        {/* ── Flow canvas ── */}
        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
            minZoom={0.2}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e2e8f0" gap={20} size={1} />
            <Controls
              showInteractive={false}
              className="!shadow-md !rounded-lg !border !border-[hsl(var(--border))]"
            />
            <MiniMap
              nodeColor={n => {
                const step = (n.data as { step: LifecycleStep }).step;
                const key = step.type === "created" ? "created" : step.meta.toStatus ?? "pending";
                return STEP_CONFIG[key]?.border ?? "#94a3b8";
              }}
              maskColor="rgba(0,0,0,0.06)"
              className="!rounded-lg !border !border-[hsl(var(--border))] !shadow-sm"
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

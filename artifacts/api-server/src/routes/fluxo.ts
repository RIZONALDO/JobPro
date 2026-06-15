/**
 * FLUXO — Máquina de estados do ciclo de vida das tarefas
 *
 * Endpoints:
 *   POST /api/fluxo/task/:id/transition  — executa transição com validação de regras
 *   GET  /api/fluxo/task/:id/actions     — transições disponíveis para o usuário atual
 */

import { Router } from "express";
import {
  db, tasksTable, taskAllocationsTable, taskEditorsTable, taskEventsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { notify } from "../lib/notify.js";

const router = Router();

type Role = "admin" | "coordinator" | "editor";

interface Rule {
  from:         string[];
  to:           string;
  roles:        Role[];
  assignedOnly: boolean;
  label:        string;
  check?:       (task: any, allocs: any[]) => { ok: boolean; reason?: string };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── Máquina de estados ────────────────────────────────────────────────────────

const RULES: Rule[] = [
  // ── Editor ───────────────────────────────────────────────────────────────
  {
    from: ["pending"], to: "in_progress",
    roles: ["editor", "coordinator", "admin"], assignedOnly: true,
    label: "Iniciar edição",
    check(task, allocs) {
      const today = todayStr();
      if (task.effortHours != null) {
        if (!allocs.some(a => a.workDate === today))
          return { ok: false, reason: "Nenhuma sessão agendada para hoje" };
      } else {
        const start = task.startDate ? String(task.startDate).slice(0, 10) : null;
        if (start && start > today)
          return { ok: false, reason: "Tarefa ainda não chegou à data de início" };
      }
      return { ok: true };
    },
  },
  {
    from: ["reopened"], to: "in_progress",
    roles: ["editor", "coordinator", "admin"], assignedOnly: true,
    label: "Retomar edição",
  },
  {
    from: ["in_progress"], to: "review",
    roles: ["editor", "coordinator", "admin"], assignedOnly: true,
    label: "Enviar para aprovação",
    check(task, allocs) {
      if (task.effortHours == null) return { ok: true };
      const confirmed = allocs
        .filter(a => a.execStatus === "done" || a.execStatus === "partial")
        .reduce((s, a) => s + (a.actualHours ?? a.allocatedHours ?? 0), 0);
      if (confirmed < task.effortHours * 0.9) {
        const rem = Math.round((task.effortHours * 0.9 - confirmed) * 10) / 10;
        return { ok: false, reason: `Faltam ${rem}h de sessões confirmadas antes de enviar` };
      }
      return { ok: true };
    },
  },
  {
    from: ["pending", "in_progress"], to: "pending",
    roles: ["editor"], assignedOnly: true,
    label: "Devolver ao coordenador",
  },

  // ── Coordenador ───────────────────────────────────────────────────────────
  {
    from: ["review"], to: "completed",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Aprovar",
  },
  {
    from: ["review"], to: "reopened",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Solicitar alteração",
  },
  {
    from: ["pending", "in_progress", "review", "reopened"], to: "paused",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Pausar",
  },
  {
    from: ["paused"], to: "in_progress",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Retomar",
  },
  {
    from: ["pending", "in_progress", "review", "reopened", "paused"], to: "cancelled",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Cancelar",
  },
  {
    from: ["rascunho"], to: "pending",
    roles: ["coordinator", "admin"], assignedOnly: false,
    label: "Publicar",
  },
];

// ── POST /api/fluxo/task/:id/transition ──────────────────────────────────────

router.post("/fluxo/task/:id/transition", requireAuth, async (req: any, res: any): Promise<void> => {
  const taskId   = Number(req.params.id);
  const { to, comment } = req.body ?? {};
  const userId   = req.session.userId!  as number;
  const userRole = req.session.userRole as Role;

  if (!to) { res.status(400).json({ error: "Campo 'to' obrigatório" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task)   { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const from = task.status;

  const rule = RULES.find(r =>
    r.from.includes(from) && r.to === to && r.roles.includes(userRole)
  );
  if (!rule) {
    res.status(422).json({ error: `Transição '${from} → ${to}' não permitida` });
    return;
  }

  // Verifica atribuição para ações do editor
  if (rule.assignedOnly && userRole === "editor") {
    if (task.assignedToId !== userId) {
      const [extra] = await db.select().from(taskEditorsTable)
        .where(and(eq(taskEditorsTable.taskId, taskId), eq(taskEditorsTable.userId, userId)));
      if (!extra) {
        res.status(403).json({ error: "Você não está atribuído a esta tarefa" });
        return;
      }
    }
  }

  // Carrega alocações só quando necessário
  const allocs = task.effortHours != null
    ? await db.select().from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId))
    : [];

  // Condição de negócio
  if (rule.check) {
    const check = rule.check(task, allocs);
    if (!check.ok) {
      res.status(422).json({ error: check.reason ?? "Condição não satisfeita" });
      return;
    }
  }

  // Executa
  const now = new Date();
  const update: Record<string, any> = { status: to, updatedAt: now };
  if (to === "review") update.reviewedAt = now;

  await db.update(tasksTable).set(update).where(eq(tasksTable.id, taskId));

  // Log
  await db.insert(taskEventsTable).values({
    taskId, fromStatus: from, toStatus: to,
    changedById: userId,
    meta: comment ? JSON.stringify({ comment }) : null,
    createdAt: now,
  }).catch(() => {});

  // Notificações
  const t = task.title;
  if (to === "review"    && task.createdById)   await notify(task.createdById,   "task_review",    taskId, `"${t}" enviada para aprovação`);
  if (to === "reopened"  && task.assignedToId)  await notify(task.assignedToId,  "task_reopened",  taskId, `"${t}" devolvida para alteração`);
  if (to === "completed" && task.assignedToId)  await notify(task.assignedToId,  "task_completed", taskId, `"${t}" foi aprovada!`);
  if (to === "pending" && from !== "rascunho" && task.createdById)
    await notify(task.createdById, "task_returned", taskId, `"${t}" foi devolvida pelo editor`);

  broadcastTaskChange();

  res.json({ ok: true, taskId, from, to });
});

// ── GET /api/fluxo/task/:id/actions ──────────────────────────────────────────

router.get("/fluxo/task/:id/actions", requireAuth, async (req: any, res: any): Promise<void> => {
  const taskId   = Number(req.params.id);
  const userRole = req.session.userRole as Role;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task)   { res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  const allocs = task.effortHours != null
    ? await db.select().from(taskAllocationsTable).where(eq(taskAllocationsTable.taskId, taskId))
    : [];

  const actions = RULES
    .filter(r => r.from.includes(task.status) && r.roles.includes(userRole))
    .map(r => {
      const check = r.check ? r.check(task, allocs) : { ok: true as const };
      return { to: r.to, label: r.label, allowed: check.ok, reason: (check as any).reason };
    });

  res.json({ taskId, currentStatus: task.status, actions });
});

export default router;

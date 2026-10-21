import { pgTable, text, serial, timestamp, integer, smallint, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const tasksTable = pgTable("te_tasks", {
  id: serial("id").primaryKey(),
  taskNumber: integer("task_number").notNull().default(0),
  taskYear: smallint("task_year").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  client: text("client"),
  color: text("color").notNull().default("#6366f1"),
  notes: text("notes"),
  // Fila em horas: startDate = "não começar antes de" (opcional); dueDate = prazo prometido ao cliente.
  // O início e o fim previstos NÃO são gravados: são calculados pela fila (lib/queue.ts).
  startDate: timestamp("start_date", { withTimezone: true }),
  lockReason: text("lock_reason"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  dueDateOriginal: timestamp("due_date_original", { withTimezone: true }), // prazo antes de ser empurrado
  estMinutes: integer("est_minutes").notNull().default(0),                 // horas de trabalho estimadas (minutos)
  workedMinutes: integer("worked_minutes").notNull().default(0),           // horas trabalhadas até a última pausa
  playingSince: timestamp("playing_since", { withTimezone: true }),        // ▶ em execução desde (null = parado)
  queueOrder: doublePrecision("queue_order").notNull().default(0),         // ordem na fila do editor
  queueHold: boolean("queue_hold").notNull().default(false),               // fora da fila aguardando aprovação de prioridade
  estConfirmed: boolean("est_confirmed").notNull().default(true),          // editor conferiu a estimativa
  estCoordMinutes: integer("est_coord_minutes"),                           // estimativa do coordenador quando o editor contestou
  estEditorMinutes: integer("est_editor_minutes"),                         // estimativa do editor
  estDisputeOpen: boolean("est_dispute_open").notNull().default(false),
  estOwnerId: integer("est_owner_id"),                                     // de quem é a estimativa que vale
  estExpiredAt: timestamp("est_expired_at", { withTimezone: true }),       // quando as horas estimadas acabaram (aviso enviado)
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  revisionCount: integer("revision_count").notNull().default(0),
  folderUrl: text("folder_url"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;

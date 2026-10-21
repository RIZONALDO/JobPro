import { pgTable, serial, integer, text, timestamp, boolean, jsonb, date } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

/** Pedidos de mudança na fila que dependem de aprovação (troca, subir/descer, prioridade de job novo). */
export const queueRequestsTable = pgTable("te_queue_requests", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),                 // 'first' (editor pede para fazer antes) | 'swap' (coordenador sobe/desce) | 'insert' (job novo com prioridade)
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  swapWithId: integer("swap_with_id").references(() => tasksTable.id, { onDelete: "cascade" }),
  targetOrder: integer("target_order"),         // reservado
  newOrder: text("new_order"),                  // queue_order proposto (texto para não perder precisão)
  editorId: integer("editor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  approverId: integer("approver_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pendente"), // 'pendente' | 'aprovado' | 'recusado' | 'cancelado'
  impacts: jsonb("impacts").$type<string[]>().notNull().default([]),
  passed: integer("passed").notNull().default(0), // jobs de outros coordenadores que ficariam para trás
  escalated: boolean("escalated").notNull().default(false),
  decidedById: integer("decided_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Registro de tudo que mexe na fila: quem fez, por quê. Base dos contadores de responsabilidade. */
export const queueEventsTable = pgTable("te_queue_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  // 'created' | 'play' | 'pause' | 'sent' | 'blocked' | 'unblocked' | 'inform' | 'est_confirm' | 'est_contest' | 'est_keep' | 'est_use'
  // 'reorder' | 'furou' | 'reneg' | 'assign' | 'reassign' | 'client_change' | 'client_ok' | 'request' | 'decide' | 'idle_alert' | 'est_expired'
  kind: text("kind").notNull(),
  text: text("text"),
  coordId: integer("coord_id"),   // coordenador dono do job no momento (para os contadores)
  editorId: integer("editor_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Feriados: dia sem expediente para todos. */
export const holidaysTable = pgTable("te_holidays", {
  day: date("day").primaryKey(),
  name: text("name").notNull(),
});

export type QueueRequest = typeof queueRequestsTable.$inferSelect;
export type QueueEvent = typeof queueEventsTable.$inferSelect;


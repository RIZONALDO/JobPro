import { pgTable, serial, integer, varchar, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const contestationsTable = pgTable("te_contestations", {
  id:                  serial("id").primaryKey(),
  requesterId:         integer("requester_id").notNull().references(() => usersTable.id),
  targetCoordinatorId: integer("target_coordinator_id").notNull().references(() => usersTable.id),
  editorId:            integer("editor_id").notNull().references(() => usersTable.id),
  displacedTaskId:     integer("displaced_task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  displacedTaskTitle:  varchar("displaced_task_title", { length: 255 }).notNull(),
  displacedTaskColor:  varchar("displaced_task_color", { length: 20 }),
  editorName:          varchar("editor_name", { length: 255 }).notNull(),
  originalSlots:       jsonb("original_slots").notNull(),   // HourSlot[] — slots atuais
  proposedSlots:       jsonb("proposed_slots").notNull(),   // HourSlot[] — onde vai mover
  status:              varchar("status", { length: 20 }).notNull().default("pending"),
  refusalReason:       text("refusal_reason"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt:         timestamp("responded_at", { withTimezone: true }),
});

export type Contestation    = typeof contestationsTable.$inferSelect;
export type InsertContestation = typeof contestationsTable.$inferInsert;

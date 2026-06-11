import { pgTable, text, serial, timestamp, integer, smallint, boolean, real, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  startDate: timestamp("start_date", { withTimezone: true }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  complexity: text("complexity").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  revisionCount: integer("revision_count").notNull().default(0),
  folderUrl: text("folder_url"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  // Multi-task hierarchy
  taskType: text("task_type").notNull().default("task"), // 'task' | 'multi_task' | 'subtask'
  parentTaskId: integer("parent_task_id").references((): AnyPgColumn => tasksTable.id, { onDelete: "cascade" }),
  subtaskOrder: integer("subtask_order").notNull().default(0),
  editorComplexitySet: boolean("editor_complexity_set").notNull().default(false),
  effortHours:         real("effort_hours"),
  editorEstimateHours: real("editor_estimate_hours"),  // ajuste do editor ao aceitar a tarefa
  editorAcceptedAt:    timestamp("editor_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;

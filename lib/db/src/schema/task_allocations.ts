import { pgTable, serial, integer, date, timestamp, real, varchar, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const taskAllocationsTable = pgTable("te_task_allocations", {
  id:        serial("id").primaryKey(),
  taskId:    integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  editorId:  integer("editor_id").notNull().references(() => usersTable.id),
  workDate:       date("work_date").notNull(),
  allocatedHours: real("allocated_hours"),   // preenchido apenas no modelo v2 (horas)
  startTime:      varchar("start_time", { length: 5 }),  // "HH:MM" — horário de início no dia
  endTime:        varchar("end_time",   { length: 5 }),  // "HH:MM" — horário de fim no dia
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uniqTaskDate:    uniqueIndex("uq_task_alloc_task_date").on(t.taskId, t.workDate),
  idxEditorDate:   index("idx_task_alloc_editor_date").on(t.editorId, t.workDate),
}));

export type TaskAllocation    = typeof taskAllocationsTable.$inferSelect;
export type InsertTaskAllocation = typeof taskAllocationsTable.$inferInsert;

import { pgTable, serial, integer, date, timestamp, real, varchar, text, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const taskAllocationsTable = pgTable("te_task_allocations", {
  id:        serial("id").primaryKey(),
  taskId:    integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  editorId:  integer("editor_id").notNull().references(() => usersTable.id),
  workDate:       date("work_date").notNull(),
  allocatedHours: real("allocated_hours"),
  startTime:      varchar("start_time", { length: 5 }),
  endTime:        varchar("end_time",   { length: 5 }),
  // ── Execução (MONITOR) ────────────────────────────────────────────────────
  execStatus:     varchar("exec_status", { length: 20 }).notNull().default("scheduled"),
  // 'scheduled' | 'done' | 'partial' | 'missed'
  actualHours:    real("actual_hours"),        // horas efetivamente trabalhadas
  execNote:       text("exec_note"),           // motivo de missed / observação
  confirmedAt:    timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy:    integer("confirmed_by").references(() => usersTable.id),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uniqTaskDate:    uniqueIndex("uq_task_alloc_task_date").on(t.taskId, t.workDate),
  idxEditorDate:   index("idx_task_alloc_editor_date").on(t.editorId, t.workDate),
}));

export type TaskAllocation    = typeof taskAllocationsTable.$inferSelect;
export type InsertTaskAllocation = typeof taskAllocationsTable.$inferInsert;

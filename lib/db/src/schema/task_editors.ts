import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const taskEditorsTable = pgTable("te_task_editors", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedById: integer("assigned_by_id").references(() => usersTable.id),
}, (t) => [unique("te_task_editors_unique").on(t.taskId, t.userId)]);

export type TaskEditor = typeof taskEditorsTable.$inferSelect;

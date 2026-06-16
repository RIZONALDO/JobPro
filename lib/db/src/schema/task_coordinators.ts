import { pgTable, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const taskCoordinatorsTable = pgTable("te_task_coordinators", {
  taskId:  integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  userId:  integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskCoordinator = typeof taskCoordinatorsTable.$inferSelect;

import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

/** Gestores que acompanham um job sem serem os donos dele: veem em "Meus jobs" e recebem os avisos importantes. */
export const taskFollowersTable = pgTable("te_task_followers", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  addedById: integer("added_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("te_task_followers_unique").on(t.taskId, t.userId)]);

export type TaskFollower = typeof taskFollowersTable.$inferSelect;

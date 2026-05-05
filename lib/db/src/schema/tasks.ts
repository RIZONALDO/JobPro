import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const tasksTable = pgTable("te_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  client: text("client"),
  color: text("color").notNull().default("#6366f1"),
  notes: text("notes"),
  dueDate: date("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  complexity: text("complexity").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  revisionCount: integer("revision_count").notNull().default(0),
  folderUrl: text("folder_url"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;

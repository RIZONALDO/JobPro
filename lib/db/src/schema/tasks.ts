import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

export const tasksTable = pgTable("te_tasks", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'review' | 'completed'
  priority: text("priority").notNull().default("medium"), // 'low' | 'medium' | 'high'
  complexity: text("complexity").notNull().default("medium"), // 'low' | 'medium' | 'high'
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  revisionCount: integer("revision_count").notNull().default(0),
  folderUrl: text("folder_url"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;

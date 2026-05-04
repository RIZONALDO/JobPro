import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const projectsTable = pgTable("te_projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  client: text("client"),
  description: text("description"),
  status: text("status").notNull().default("ativo"), // 'ativo' | 'pausado' | 'concluido' | 'arquivado'
  color: text("color").notNull().default("#6366f1"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;

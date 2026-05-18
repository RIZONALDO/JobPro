import { pgTable, serial, integer, date, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const dutySchedulesTable = pgTable("te_duty_schedules", {
  id: serial("id").primaryKey(),
  weekendStart: date("weekend_start").notNull(),
  editorId: integer("editor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique("te_duty_weekend_editor_uniq").on(t.weekendStart, t.editorId),
}));

export type DutySchedule = typeof dutySchedulesTable.$inferSelect;
export type InsertDutySchedule = typeof dutySchedulesTable.$inferInsert;

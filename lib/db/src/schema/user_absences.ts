import { pgTable, serial, integer, date, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userAbsencesTable = pgTable("te_user_absences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  type: text("type").notNull().default("vacation"), // 'vacation' | 'leave' | 'medical' | 'day_off' | 'other'
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("idx_user_absences_user").on(t.userId),
  rangeIdx: index("idx_user_absences_range").on(t.startDate, t.endDate),
}));

export type UserAbsence = typeof userAbsencesTable.$inferSelect;
export type InsertUserAbsence = typeof userAbsencesTable.$inferInsert;

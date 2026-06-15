import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("te_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("editor"), // 'admin' | 'coordinator' | 'editor'
  status: text("status").notNull().default("active"), // 'active' | 'inactive'
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  jobTitle: text("job_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  theme: text("theme").notNull().default("dark"),
  profileColor: text("profile_color"),  // cor pessoal do usuário (hex), usada para organização visual
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;

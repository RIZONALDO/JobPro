import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("te_clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

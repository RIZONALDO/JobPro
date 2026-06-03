import { pgTable, text, serial, timestamp, integer, bigint } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const taskFilesTable = pgTable("te_task_files", {
  id:             serial("id").primaryKey(),
  taskId:         integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  fileName:       text("file_name").notNull(),
  fileSize:       bigint("file_size", { mode: "number" }),
  mimeType:       text("mime_type"),
  storagePath:    text("storage_path").notNull(),
  publicToken:    text("public_token").unique(),
  uploadedById:   integer("uploaded_by_id").references(() => usersTable.id),
  revisionNumber: integer("revision_number").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

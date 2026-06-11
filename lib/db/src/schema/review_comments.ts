import { pgTable, serial, integer, text, timestamp, real, unique } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { taskFilesTable } from "./task_files";
import { usersTable } from "./users";

export const reviewCommentsTable = pgTable("te_review_comments", {
  id:              serial("id").primaryKey(),
  taskId:          integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  taskFileId:      integer("task_file_id").references(() => taskFilesTable.id, { onDelete: "set null" }),
  parentId:        integer("parent_id"),                                         // self-ref FK enforced in SQL
  userId:          integer("user_id").notNull().references(() => usersTable.id),
  timestampSec:    real("timestamp_sec"),
  frameThumbnail:  text("frame_thumbnail"),
  annotations:     text("annotations"),           // JSON: AnnotationShape[] (coords 0-1)
  body:            text("body").notNull(),
  resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
  resolvedById:    integer("resolved_by_id").references(() => usersTable.id),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tracks when each user last read the review comments for a task
export const reviewReadsTable = pgTable("te_review_reads", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  taskId:     integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.taskId) }));

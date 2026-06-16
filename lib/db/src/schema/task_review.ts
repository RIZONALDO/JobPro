import { pgTable, serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { taskFilesTable } from "./task_files";
import { usersTable } from "./users";

export const taskReviewBatchesTable = pgTable("te_task_review_batches", {
  id:             serial("id").primaryKey(),
  taskId:         integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  taskFileId:     integer("task_file_id").references(() => taskFilesTable.id, { onDelete: "set null" }),
  revisionNumber: integer("revision_number").notNull(),
  submittedById:  integer("submitted_by_id").references(() => usersTable.id),
  commentCount:   integer("comment_count").notNull().default(0),
  submittedAt:    timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskFrameCommentsTable = pgTable("te_task_frame_comments", {
  id:             serial("id").primaryKey(),
  batchId:        integer("batch_id").notNull().references(() => taskReviewBatchesTable.id, { onDelete: "cascade" }),
  taskId:         integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  timestampSec:   real("timestamp_sec").notNull(),
  orderIndex:     integer("order_index").notNull(),
  frameThumbnail: text("frame_thumbnail"),
  body:           text("body").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

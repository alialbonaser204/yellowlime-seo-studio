import { customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Small uploaded files (profile images). An upload is reserved first with the
 * expected size and content type, then filled exactly once by the PUT request.
 */
export const uploadsTable = pgTable("uploads", {
  id: uuid("id").primaryKey(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  data: bytea("data"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
});

export type Upload = typeof uploadsTable.$inferSelect;

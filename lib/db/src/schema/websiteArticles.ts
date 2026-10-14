import { index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";

/**
 * Articles that are published on a partner's own website, found by scanning
 * its sitemap, RSS feed or blog pages. Used to avoid writing about a topic the
 * partner already covers.
 */
export const websiteArticlesTable = pgTable(
  "website_articles",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    headings: jsonb("headings").$type<string[]>().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    wordCount: integer("word_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("website_articles_partner_url_unique").on(table.partnerId, table.url),
    index("website_articles_partner_idx").on(table.partnerId),
  ],
);

/** One run of the website scanner for a partner. */
export const websiteScansTable = pgTable(
  "website_scans",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    /** running | completed | failed */
    status: text("status").notNull(),
    /** sitemap | rss | crawl */
    source: text("source"),
    pagesChecked: integer("pages_checked").notNull().default(0),
    articlesFound: integer("articles_found").notNull().default(0),
    message: text("message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("website_scans_partner_idx").on(table.partnerId)],
);

export type WebsiteArticle = typeof websiteArticlesTable.$inferSelect;
export type WebsiteScan = typeof websiteScansTable.$inferSelect;

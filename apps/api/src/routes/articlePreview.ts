/**
 * Preview of a written article in the partner's own style: fonts, colour and
 * logo from the partner's website, and a photo per section (first the
 * partner's own photos, else free stock photos from Pexels).
 */
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { articleGenerationsTable, db, partnersTable } from "@yellowlime/db";
import { bestPartnerImage, loadBrandStyle, type BrandStyle } from "../services/brandStyle";
import { pexelsConfigured, searchStockPhotos } from "../services/stockPhotos";
import { defaultClaudeTextRunner } from "../services/claudeRunner";

const router: IRouter = Router();

export interface PreviewPhoto {
  /** Heading the photo belongs under; null = the top of the article. */
  heading: string | null;
  url: string;
  alt: string;
  source: "partner" | "pexels";
  credit?: { name: string; url: string; pageUrl: string };
}

const previews = new Map<string, { style: BrandStyle | null; photos: PreviewPhoto[]; stockPhotos: boolean; styleMessage: string | null }>();

/** Short English search terms per heading (stock photo sites search best in English). */
async function photoQueries(title: string, keyword: string, headings: string[]): Promise<string[]> {
  const fallback = [keyword, ...headings.map(() => keyword)];
  try {
    const raw = await defaultClaudeTextRunner(
      [
        "Geef voor een stockfotosite (Pexels) per kop een korte Engelse zoekterm van 2 tot 4 woorden die een passende, realistische foto oplevert. Geen merknamen, geen tekst in de foto.",
        `Artikel: ${title} (zoekwoord: ${keyword})`,
        `Koppen (de eerste is de bovenkant van het artikel): ${JSON.stringify([title, ...headings])}`,
        `Geef uitsluitend een JSON-array met precies ${headings.length + 1} strings terug.`,
      ].join("\n"),
      60_000,
    );
    const start = raw.indexOf("["), end = raw.lastIndexOf("]");
    const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw) as unknown;
    if (Array.isArray(parsed) && parsed.length === headings.length + 1 && parsed.every((q) => typeof q === "string")) return parsed;
  } catch { /* use the keyword */ }
  return fallback;
}

router.get("/article-generations/:id/preview", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Ongeldig artikel." }); return; }
  const [gen] = await db.select().from(articleGenerationsTable).where(eq(articleGenerationsTable.id, id));
  if (!gen || !gen.fullArticle) { res.status(404).json({ error: "Dit artikel is nog niet geschreven." }); return; }
  const [partner] = await db.select({ websiteUrl: partnersTable.websiteUrl, companyName: partnersTable.companyName }).from(partnersTable).where(eq(partnersTable.id, gen.partnerId));

  const cacheKey = `${id}`;
  const fresh = req.query.refresh === "1";
  let preview = fresh ? undefined : previews.get(cacheKey);
  if (!preview) {
    let style: BrandStyle | null = null;
    let styleMessage: string | null = null;
    if (partner?.websiteUrl) {
      try { style = await loadBrandStyle(partner.websiteUrl); }
      catch { styleMessage = "De stijl van de website kon niet worden gelezen. Je ziet een neutrale stijl."; }
    }

    // Only main sections get a photo, not the questions in the FAQ.
    const headings = [...gen.fullArticle.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).filter((h) => !/veelgestelde vragen/i.test(h)).slice(0, 6);
    const used = new Set<string>();
    const photos: PreviewPhoto[] = [];
    const slots: (string | null)[] = [null, ...headings];
    const needStock: number[] = [];
    // Only free stock photos for now (choice of the team); partner photos via
    // bestPartnerImage can be switched on later.
    slots.forEach((_heading, i) => needStock.push(i));
    void used; void bestPartnerImage;
    if (needStock.length && pexelsConfigured()) {
      const queries = await photoQueries(gen.title, gen.primaryKeyword, headings);
      const usedStock = new Set<string>();
      for (const i of needStock) {
        try {
          const found = await searchStockPhotos(queries[i] ?? gen.primaryKeyword, 5);
          const pick = found.find((p) => !usedStock.has(p.url));
          if (!pick) continue;
          usedStock.add(pick.url);
          photos[i] = { heading: slots[i], url: pick.url, alt: pick.alt || (slots[i] ?? gen.title), source: "pexels", credit: { name: pick.photographer, url: pick.photographerUrl, pageUrl: pick.pageUrl } };
        } catch { /* no photo for this section */ }
      }
    }
    preview = { style, photos: photos.filter(Boolean), stockPhotos: pexelsConfigured(), styleMessage };
    previews.set(cacheKey, preview);
  }

  res.json({
    partnerName: partner?.companyName ?? "",
    websiteUrl: partner?.websiteUrl ?? null,
    title: gen.title,
    metaTitle: gen.metaTitle,
    metaDescription: gen.metaDescription,
    fullArticle: gen.fullArticle,
    ...preview,
  });
});

export default router;

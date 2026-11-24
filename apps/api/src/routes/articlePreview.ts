/**
 * Concept page of a written article in the partner's own style.
 *
 * 1. The partner's website is opened in a real browser (Cloudflare Browser
 *    Rendering): the styles a visitor sees are read and screenshots are taken
 *    of the home page and of one of their own blog articles.
 * 2. An AI "art director" looks at those screenshots and the measured styles
 *    and decides the design (fonts, colours, buttons) and where photos belong.
 * 3. Placeholder stock photos are fetched for the chosen places.
 * Without the browser, the CSS of the site is read as text instead.
 */
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { articleGenerationsTable, db, partnersTable } from "@yellowlime/db";
import { loadBrandStyle, type BrandStyle } from "../services/brandStyle";
import { searchStockPhotos } from "../services/stockPhotos";
import { claudeWithImages } from "../services/claudeRunner";
import { renderPartnerSite, type RenderedStyle } from "../services/siteRender";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export interface PreviewPhoto {
  /** Heading the photo belongs under; null = the top of the article. */
  heading: string | null;
  url: string;
  alt: string;
  source: "partner" | "pexels";
  credit?: { name: string; url: string; pageUrl: string };
  reason?: string;
}

export interface ConceptDesign {
  headingFont: string | null;
  bodyFont: string | null;
  headingColor: string | null;
  textColor: string | null;
  linkColor: string | null;
  accentColor: string | null;
  buttonBg: string | null;
  buttonText: string | null;
  buttonRadius: string | null;
  headingWeight: string | null;
  h1Size: string | null;
  h2Size: string | null;
  contentWidth: number | null;
  logoUrl: string | null;
  summaryStyle: "box" | "line" | "none";
  fontCssUrls: string[];
}

interface PhotoPlanItem { heading: string | null; query: string; alt: string; reason: string }

const previews = new Map<string, unknown>();

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const color = (v: unknown) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : null);
const text = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const size = (v: unknown) => (typeof v === "string" && /^\d+(\.\d+)?(px|rem|em)$/.test(v.trim()) ? v.trim() : null);

function artDirectorPrompt(input: {
  partner: string;
  rendered: { home: RenderedStyle; article: RenderedStyle | null } | null;
  css: BrandStyle | null;
  title: string;
  headings: string[];
  intro: string;
  screenshots: number;
}): string {
  return [
    `Je bent art director bij een webbureau. Je maakt een conceptpagina voor een nieuw blogartikel van ${input.partner}. De pagina moet zo veel mogelijk lijken op een echte blogpagina op hun eigen website.`,
    input.screenshots
      ? `Je ziet ${input.screenshots} screenshot(s): eerst de homepage, daarna (als die er is) een bestaand blogartikel van de partner. Kijk goed: welke lettertypes, kleuren van koppen en tekst, knoppen, witruimte en hoe ze foto's in artikelen gebruiken.`
      : "Er zijn geen screenshots; gebruik de gemeten stijlen en CSS hieronder.",
    "Belangrijk: kies de stijl die de partner echt voor tekst en koppen gebruikt. Een kleur die alleen voor een sale-label, foutmelding, chatknop (WhatsApp-groen) of keurmerk wordt gebruikt is NIET de huiskleur. Zijn de koppen op de site zwart, maak ze dan zwart. Neem de knopkleur van hun belangrijkste knoppen (bijvoorbeeld 'Bestel nu' of 'Plan een afspraak').",
    input.rendered ? `Gemeten in de browser (computed styles):\nHomepage: ${JSON.stringify(input.rendered.home)}\nBlogartikel: ${JSON.stringify(input.rendered.article)}` : "",
    input.css?.clues ? `CSS van de website (uittreksel):\n${input.css.clues}` : "",
    input.css ? `Gevonden logo-kandidaat: ${input.css.logoUrl ?? "geen"}` : "",
    "",
    "Bepaal ook waar foto's moeten komen in het NIEUWE artikel (de foto's zijn tijdelijke stockfoto's, later vervangt de partner ze door eigen foto's):",
    "- Volg hoe de partner zelf foto's in artikelen gebruikt (staat er een grote foto bovenaan? foto's tussen de tekst?).",
    "- Een foto alleen waar hij iets toevoegt: bij een product, een type, een situatie of een plek. Geen foto bij prijzen, garantie, voorwaarden, stappenplannen met alleen tekst of de veelgestelde vragen.",
    "- Maximaal 1 foto bovenaan (heading null) en 2 tot 4 in de tekst, nooit twee secties achter elkaar.",
    "- Per foto een Engelse zoekterm van 2 tot 5 woorden voor een stockfotosite (concreet en realistisch, geen merknamen, geen tekst), een Nederlandse alt-tekst die beschrijft wat de partnerfoto straks moet laten zien, en een korte reden.",
    `Titel: ${input.title}`,
    `Inleiding: ${input.intro.slice(0, 600)}`,
    `H2-koppen van het artikel (gebruik ze letterlijk): ${JSON.stringify(input.headings)}`,
    "",
    "Geef UITSLUITEND dit JSON terug:",
    `{"design":{"headingFont":"","bodyFont":"","headingColor":"#hex","textColor":"#hex","linkColor":"#hex","accentColor":"#hex","buttonBg":"#hex","buttonText":"#hex","buttonRadius":"5px","headingWeight":"500","h1Size":"40px","h2Size":"28px","contentWidth":760,"logoUrl":"https://... of null","summaryStyle":"box|line|none"},"photos":[{"heading":null,"query":"","alt":"","reason":""}]}`,
  ].filter((l) => l !== null).join("\n");
}

function parseDirector(raw: string, headings: string[]): { design: Partial<ConceptDesign>; photos: PhotoPlanItem[] } | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as { design?: Record<string, unknown>; photos?: Record<string, unknown>[] };
    const d = data.design ?? {};
    const logo = text(d.logoUrl, 600);
    const design: Partial<ConceptDesign> = {
      headingFont: text(d.headingFont), bodyFont: text(d.bodyFont),
      headingColor: color(d.headingColor), textColor: color(d.textColor), linkColor: color(d.linkColor), accentColor: color(d.accentColor),
      buttonBg: color(d.buttonBg), buttonText: color(d.buttonText), buttonRadius: size(d.buttonRadius),
      headingWeight: typeof d.headingWeight === "string" || typeof d.headingWeight === "number" ? String(d.headingWeight).replace(/\D/g, "").slice(0, 3) || null : null,
      h1Size: size(d.h1Size), h2Size: size(d.h2Size),
      contentWidth: typeof d.contentWidth === "number" && d.contentWidth >= 480 && d.contentWidth <= 1200 ? Math.round(d.contentWidth) : null,
      logoUrl: logo && /^https:\/\//.test(logo) ? logo : null,
      summaryStyle: d.summaryStyle === "line" || d.summaryStyle === "none" ? d.summaryStyle : "box",
    };
    const known = new Set(headings);
    const photos = (data.photos ?? [])
      .map((p) => ({ heading: p.heading === null ? null : text(p.heading, 200), query: text(p.query, 60) ?? "", alt: text(p.alt, 200) ?? "", reason: text(p.reason, 200) ?? "" }))
      .filter((p) => p.query && (p.heading === null || known.has(p.heading)))
      .slice(0, 5);
    return { design, photos };
  } catch {
    return null;
  }
}

router.get("/article-generations/:id/preview", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Ongeldig artikel." }); return; }
  const [gen] = await db.select().from(articleGenerationsTable).where(eq(articleGenerationsTable.id, id));
  if (!gen || !gen.fullArticle) { res.status(404).json({ error: "Dit artikel is nog niet geschreven." }); return; }
  const [partner] = await db.select({ websiteUrl: partnersTable.websiteUrl, companyName: partnersTable.companyName }).from(partnersTable).where(eq(partnersTable.id, gen.partnerId));

  const cacheKey = `${id}`;
  const cached = req.query.refresh === "1" ? undefined : previews.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const headings = [...gen.fullArticle.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).filter((h) => !/veelgestelde vragen/i.test(h));
  const intro = gen.fullArticle.split(/\n## /)[0].replace(/^# .*$/m, "").trim();

  let css: BrandStyle | null = null;
  let rendered: Awaited<ReturnType<typeof renderPartnerSite>> = null;
  const notes: string[] = [];
  if (partner?.websiteUrl) {
    [css, rendered] = await Promise.all([
      loadBrandStyle(partner.websiteUrl).catch(() => null),
      renderPartnerSite(partner.websiteUrl).catch((error) => {
        logger.warn({ code: "site_render_failed", errorType: error instanceof Error ? error.message.slice(0, 200) : typeof error }, "Website kon niet in de browser worden geopend");
        return null;
      }),
    ]);
  }
  if (!rendered) notes.push("De website kon niet in een echte browser worden bekeken; de stijl is uit de CSS afgeleid en kan meer afwijken.");

  let plan = null as ReturnType<typeof parseDirector>;
  try {
    const raw = await claudeWithImages(
      artDirectorPrompt({ partner: partner?.companyName ?? "de partner", rendered, css, title: gen.title, headings, intro, screenshots: rendered?.screenshots.length ?? 0 }),
      rendered?.screenshots ?? [],
    );
    plan = parseDirector(raw, headings);
  } catch (error) {
    logger.warn({ code: "art_director_failed", errorType: error instanceof Error ? error.message : typeof error }, "Ontwerpkeuze door de AI mislukt");
  }
  if (!plan) notes.push("De AI kon het ontwerp niet bepalen; je ziet de stijl die automatisch is gevonden.");

  const measured = rendered?.article ?? rendered?.home ?? null;
  const design: ConceptDesign = {
    headingFont: plan?.design.headingFont ?? measured?.fonts.heading ?? css?.headingFont ?? null,
    bodyFont: plan?.design.bodyFont ?? measured?.fonts.body ?? css?.bodyFont ?? null,
    headingColor: plan?.design.headingColor ?? measured?.colors.heading ?? "#111111",
    textColor: plan?.design.textColor ?? measured?.colors.text ?? "#222222",
    linkColor: plan?.design.linkColor ?? measured?.colors.link ?? null,
    accentColor: plan?.design.accentColor ?? measured?.buttons[0]?.bg ?? null,
    buttonBg: plan?.design.buttonBg ?? measured?.buttons[0]?.bg ?? null,
    buttonText: plan?.design.buttonText ?? measured?.buttons[0]?.color ?? null,
    buttonRadius: plan?.design.buttonRadius ?? measured?.buttons[0]?.radius ?? null,
    headingWeight: plan?.design.headingWeight ?? measured?.weights.h1 ?? null,
    h1Size: plan?.design.h1Size ?? measured?.sizes.h1 ?? null,
    h2Size: plan?.design.h2Size ?? measured?.sizes.h2 ?? null,
    contentWidth: plan?.design.contentWidth ?? (measured?.sizes.contentWidth && measured.sizes.contentWidth >= 480 ? measured.sizes.contentWidth : null),
    logoUrl: plan?.design.logoUrl ?? rendered?.home.logo ?? css?.logoUrl ?? null,
    summaryStyle: plan?.design.summaryStyle ?? "box",
    fontCssUrls: css?.fontCssUrls ?? [],
  };

  // Photos where the art director wants them; without a plan, one at the top.
  const wanted: PhotoPlanItem[] = plan?.photos.length ? plan.photos : [{ heading: null, query: gen.primaryKeyword, alt: gen.title, reason: "" }];
  const photos: PreviewPhoto[] = [];
  const used = new Set<string>();
  for (const item of wanted) {
    try {
      const found = await searchStockPhotos(item.query, 6);
      const pick = found.find((p) => !used.has(p.url));
      if (!pick) continue;
      used.add(pick.url);
      photos.push({ heading: item.heading, url: pick.url, alt: item.alt || pick.alt, source: "pexels", reason: item.reason, credit: { name: pick.photographer, url: pick.photographerUrl, pageUrl: pick.pageUrl } });
    } catch { /* no photo here */ }
  }

  const body = {
    partnerName: partner?.companyName ?? "",
    websiteUrl: partner?.websiteUrl ?? null,
    title: gen.title,
    metaTitle: gen.metaTitle,
    metaDescription: gen.metaDescription,
    fullArticle: gen.fullArticle,
    design,
    // Kept for the in-app preview page.
    style: { headingFont: design.headingFont, bodyFont: design.bodyFont, fontCssUrls: design.fontCssUrls, primaryColor: design.accentColor, logoUrl: design.logoUrl, siteName: css?.siteName ?? null },
    photos,
    stockPhotos: true,
    styleMessage: notes.join(" ") || null,
    lookedAtBrowser: Boolean(rendered),
  };
  previews.set(cacheKey, body);
  res.json(body);
});

export default router;

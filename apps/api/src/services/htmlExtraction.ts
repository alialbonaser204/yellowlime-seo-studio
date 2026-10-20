import { load } from "cheerio";

export interface ExtractedPage {
  url: string;
  title: string;
  text: string;
  links: string[];
  /** Contact details that are removed from `text`: footer, <address> and schema.org data. */
  contactText: string;
}

/** Address, phone and name from schema.org JSON-LD (Organization, LocalBusiness, ...). */
function structuredContact(json: unknown, out: string[], depth = 0): void {
  if (!json || typeof json !== "object" || depth > 5) return;
  if (Array.isArray(json)) {
    for (const item of json) structuredContact(item, out, depth + 1);
    return;
  }
  const node = json as Record<string, unknown>;
  const address = node.address;
  const fmt = (a: unknown): string | null => {
    if (typeof a === "string") return a;
    if (a && typeof a === "object") {
      const r = a as Record<string, unknown>;
      return [r.streetAddress, r.postalCode, r.addressLocality, r.addressRegion, r.addressCountry]
        .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : ""))
        .filter(Boolean).join(", ");
    }
    return null;
  };
  const addresses = (Array.isArray(address) ? address : [address]).map(fmt).filter((a): a is string => Boolean(a));
  if (addresses.length) {
    const name = typeof node.name === "string" ? `${node.name}: ` : "";
    out.push(`${name}${addresses.join(" | ")}${typeof node.telephone === "string" ? ` (tel. ${node.telephone})` : ""}`);
  }
  if (typeof node.areaServed === "string") out.push(`Werkgebied: ${node.areaServed}`);
  for (const value of Object.values(node)) if (value && typeof value === "object") structuredContact(value, out, depth + 1);
}

function isHidden(_index: number, element: { attribs?: Record<string, string> }): boolean {
  const node = element;
  const attrs = node.attribs ?? {};
  const style = attrs.style?.toLowerCase() ?? "";
  return "hidden" in attrs ||
    attrs["aria-hidden"]?.toLowerCase() === "true" ||
    /(?:^|;)\s*(?:display|visibility)\s*:\s*none/.test(style);
}

export function normalizeText(text: string, maxChars = 40_000): string {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const output: string[] = [];
  let length = 0;
  for (const line of lines) {
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const nextLength = length + (output.length ? 1 : 0) + line.length;
    if (nextLength > maxChars) {
      output.push(line.slice(0, Math.max(0, maxChars - length - (output.length ? 1 : 0))));
      break;
    }
    output.push(line);
    length = nextLength;
  }
  return output.join(" ").slice(0, maxChars).trim();
}

export function extractHtmlPage(url: string, html: string): ExtractedPage {
  const $ = load(html);
  const title = normalizeText($("title").first().text(), 500);
  const links = $("a[href]").map((_index, element) => $(element).attr("href") ?? "").get();

  // Contact details live in the footer, <address> and JSON-LD, which are removed below.
  const contact: string[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      structuredContact(JSON.parse($(el).text()), contact);
    } catch {
      // ignore broken JSON-LD
    }
  });
  $("footer, address, [class*='footer' i], [id*='footer' i], [itemtype*='PostalAddress' i]").each((_i, el) => {
    const clone = $(el).clone();
    clone.find("script, style, noscript, svg, form, button, input, select, textarea, img").remove();
    const html = clone.html() ?? "";
    contact.push(normalizeText(html.replace(/<\/(?:address|br|div|dd|dt|h[1-6]|li|p|section|span|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "), 3_000));
  });
  const contactText = normalizeText([...new Set(contact.filter(Boolean))].join("\n"), 4_000);

  const body = $("body").first();
  body.find("script, style, noscript, svg, canvas, iframe, form, nav, header, footer, aside, template, input, button, select, textarea, option, img, video, audio, source").remove();
  body.find("*").filter(isHidden).remove();
  body.find('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="advert" i], [id*="advert" i], [class*="banner" i], [id*="banner" i]').remove();

  const content = body.html() ?? "";
  const text = normalizeText(
    content
      .replace(/<\/(?:address|article|blockquote|br|dd|div|dl|dt|h[1-6]|li|main|p|pre|section|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return { url, title, text, links, contactText };
}

export function priorityForPath(pathname: string): number {
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  const value = segments.join(" ");
  const priorityWords = [
    "about", "over-ons", "over", "wie-zijn-wij", "ons-verhaal", "services", "service", "diensten",
    "products", "product", "producten", "assortiment", "aanbod", "werkwijze", "voor-wie", "contact",
    "vestiging", "locatie", "winkels", "showroom", "route", "openingstijden",
  ];
  const index = priorityWords.findIndex((word) => value.includes(word));
  return index === -1 ? 100 : index;
}
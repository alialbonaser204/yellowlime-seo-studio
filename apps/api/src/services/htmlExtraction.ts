import { load } from "cheerio";

export interface ExtractedPage {
  url: string;
  title: string;
  text: string;
  links: string[];
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
  return { url, title, text, links };
}

export function priorityForPath(pathname: string): number {
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  const value = segments.join(" ");
  const priorityWords = [
    "about", "over-ons", "over", "wie-zijn-wij", "ons-verhaal", "services", "service", "diensten",
    "products", "product", "producten", "assortiment", "aanbod", "werkwijze", "voor-wie", "contact",
  ];
  const index = priorityWords.findIndex((word) => value.includes(word));
  return index === -1 ? 100 : index;
}
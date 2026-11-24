/**
 * Reads the look of a partner's website (fonts, main colour, logo, photos) so
 * an article can be previewed in the partner's own style. Pure parsing helpers
 * are exported for tests; `loadBrandStyle` fetches the home page and CSS.
 */
import { fetchSafe, type SafeResponse } from "./safeHttp";

export interface BrandStyle {
  headingFont: string | null;
  bodyFont: string | null;
  /** Google Fonts stylesheet the site links to, if any. */
  fontCssUrls: string[];
  primaryColor: string | null;
  textColor: string | null;
  headingColor?: string | null;
  linkColor?: string | null;
  buttonBg?: string | null;
  buttonText?: string | null;
  buttonRadius?: string | null;
  /** Raw material for the AI design check (not sent to the browser). */
  clues?: string;
  logoUrl: string | null;
  siteName: string | null;
  images: { url: string; alt: string }[];
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "inherit", "initial", "-apple-system", "blinkmacsystemfont", "cursive", "ui-sans-serif", "ui-serif"]);

/** First real font name of a CSS font-family value. */
export function firstFont(value: string): string | null {
  for (const raw of value.split(",")) {
    const name = raw.trim().replace(/^['"]|['"]$/g, "").trim();
    if (!name || name.startsWith("var(") || GENERIC.has(name.toLowerCase())) continue;
    if (/icon|awesome|dashicons|glyph|elementor|eicons/i.test(name)) continue;
    return name;
  }
  return null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

const abs = (url: string | null, base: string): string | null => {
  if (!url || url.startsWith("data:")) return null;
  try { const u = new URL(url.replace(/&amp;/g, "&"), base); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
};

/** All CSS custom properties (--name: value) in the stylesheet text. */
export function cssVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  return vars;
}

/** Replaces var(--x) with its value (a few levels deep). */
export function resolveVars(value: string, vars: Map<string, string>): string {
  let out = value;
  for (let i = 0; i < 4 && out.includes("var("); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name: string, fb?: string) => vars.get(name) ?? fb ?? "");
  }
  return out;
}

/** Short, readable facts about the site's look for the AI design check. */
export function styleClues(css: string, html: string): string {
  const vars = cssVariables(css);
  const varLines = [...vars].filter(([k]) => /font|color|colour|accent|primary|button|btn|brand|heading|text|link|background|bg/i.test(k)).slice(0, 80).map(([k, v]) => `${k}: ${v}`);
  const rules: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel.length > 120 || !/(^|[\s,])(body|h1|h2|h3|a|button)([\s,.:]|$)|\.btn|\.button|button--primary|header|\.rte|article/i.test(sel)) continue;
    const decl = m[2].split(";").map((d) => d.trim()).filter((d) => /^(font-family|color|background(-color)?|border-radius|font-weight|text-transform|letter-spacing)\s*:/i.test(d));
    if (decl.length) rules.push(`${sel} { ${decl.map((d) => resolveVars(d, vars)).join("; ")} }`);
    if (rules.length >= 60) break;
  }
  const header = (html.match(/<header\b[\s\S]{0,4000}?<\/header>/i)?.[0] ?? "").replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "").replace(/\s+/g, " ").slice(0, 1500);
  return [`CSS-variabelen:\n${varLines.join("\n")}`, `CSS-regels:\n${rules.join("\n")}`, `Begin van de header-HTML:\n${header}`].join("\n\n").slice(0, 12_000);
}

/** Most used font for headings and for body text in a stylesheet. */
export function fontsFromCss(css: string): { heading: string | null; body: string | null } {
  const vars = cssVariables(css);
  const fromVar = (re: RegExp) => { for (const [k, v] of vars) if (re.test(k)) { const f = firstFont(resolveVars(v, vars)); if (f) return f; } return null; };
  const varHeading = fromVar(/^--font-?(heading|headings|h1|title|display)[\w-]*family/i) ?? fromVar(/heading[\w-]*font|font-?heading/i);
  const varBody = fromVar(/^--font-?(body|base|text|primary)[\w-]*family/i) ?? fromVar(/body[\w-]*font|font-?body|font-?base/i);
  const count = (selectorTest: (s: string) => boolean) => {
    const tally = new Map<string, number>();
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].toLowerCase();
      if (!selectorTest(selector)) continue;
      const decl = m[2].match(/font-family\s*:\s*([^;]+)/i);
      const font = decl ? firstFont(resolveVars(decl[1], vars)) : null;
      if (font) tally.set(font, (tally.get(font) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const body = varBody ?? count((s) => /(^|[\s,])(body|html|p)([\s,.:]|$)/.test(s)) ?? count((s) => s.includes(":root"));
  const heading = varHeading ?? count((s) => /(^|[\s,])h[1-3]([\s,.:]|$)/.test(s)) ?? body;
  return { heading, body };
}

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The most used colourful (not grey, not near-white/black) hex colour. */
export function primaryColorFromCss(css: string): string | null {
  const tally = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const rgb = hexToRgb(m[1]);
    if (!rgb) continue;
    const max = Math.max(...rgb), min = Math.min(...rgb);
    if (max - min < 40 || max < 40 || min > 225) continue; // grey, black or pastel-white
    const key = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Logo, site name, theme colour, stylesheets and photos from the HTML. */
export function parseHomePage(html: string, baseUrl: string) {
  const tags = (name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
  const metas = tags("meta");
  const meta = (key: string) => {
    const tag = metas.find((t) => (attr(t, "name") ?? attr(t, "property") ?? "").toLowerCase() === key);
    return tag ? attr(tag, "content") : null;
  };
  const links = tags("link");
  const stylesheets = links.filter((t) => /stylesheet/i.test(attr(t, "rel") ?? "")).map((t) => abs(attr(t, "href"), baseUrl)).filter((u): u is string => !!u);
  const fontCssUrls = stylesheets.filter((u) => /fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net/.test(u));
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");

  const imgs = tags("img");
  const headerHtml = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const isLogo = (t: string) => /logo/i.test(`${attr(t, "class") ?? ""} ${attr(t, "src") ?? ""} ${attr(t, "alt") ?? ""} ${attr(t, "id") ?? ""}`) && !/keurmerk|thuiswinkel|trustpilot|kiyoh|payment|betaal|review/i.test(attr(t, "src") ?? "");
  const headerImgs = [...headerHtml.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const logoTag = headerImgs.find(isLogo) ?? headerImgs[0] ?? imgs.find(isLogo);
  const logoUrl = abs(logoTag ? attr(logoTag, "src") ?? attr(logoTag, "data-src") : null, baseUrl);

  const seen = new Set<string>();
  const images: { url: string; alt: string }[] = [];
  const og = abs(meta("og:image"), baseUrl);
  for (const t of imgs) {
    const srcset = attr(t, "srcset") ?? attr(t, "data-srcset");
    const largest = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).pop() ?? null;
    const url = abs(largest ?? attr(t, "data-src") ?? attr(t, "src"), baseUrl);
    if (!url || seen.has(url) || url === logoUrl) continue;
    if (/\.svg(\?|$)|logo|icon|sprite|pixel|placeholder|avatar|badge|flag|payment|keurmerk|rating/i.test(url)) continue;
    const width = Number(attr(t, "width") ?? "0");
    if (width && width < 300) continue;
    seen.add(url);
    images.push({ url, alt: (attr(t, "alt") ?? "").trim() });
  }
  if (og && !seen.has(og)) images.unshift({ url: og, alt: meta("og:image:alt") ?? "" });

  return {
    siteName: meta("og:site_name"),
    themeColor: meta("theme-color"),
    logoUrl,
    stylesheets: stylesheets.filter((u) => !fontCssUrls.includes(u)),
    fontCssUrls,
    inlineCss,
    images: images.slice(0, 40),
  };
}

const cache = new Map<string, { at: number; value: BrandStyle }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function loadBrandStyle(
  websiteUrl: string,
  fetcher: (url: string, o?: Parameters<typeof fetchSafe>[1]) => Promise<SafeResponse> = fetchSafe,
): Promise<BrandStyle> {
  const hit = cache.get(websiteUrl);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const home = await fetcher(websiteUrl, { timeoutMs: 12_000 });
  const page = parseHomePage(home.body, home.url || websiteUrl);
  const cssParts = [page.inlineCss];
  for (const href of page.stylesheets.slice(0, 6)) {
    try {
      const r = await fetcher(href, { timeoutMs: 8_000, accept: "text/css,*/*;q=0.5", maxBytes: 1024 * 1024 });
      if (r.status < 400) cssParts.push(r.body);
    } catch { /* another domain (CDN) or slow: skip */ }
  }
  const css = cssParts.join("\n");
  const fonts = fontsFromCss(css);
  const theme = page.themeColor && /^#[0-9a-f]{3,6}$/i.test(page.themeColor) ? page.themeColor : null;
  const value: BrandStyle = {
    headingFont: fonts.heading,
    bodyFont: fonts.body,
    fontCssUrls: page.fontCssUrls,
    primaryColor: primaryColorFromCss(css) ?? theme,
    textColor: null,
    clues: styleClues(css, home.body),
    logoUrl: page.logoUrl,
    siteName: page.siteName,
    images: page.images,
  };
  cache.set(websiteUrl, { at: Date.now(), value });
  return value;
}

/** Words that say something about a photo (no stop words). */
export function words(text: string): string[] {
  const stop = new Set(["de", "het", "een", "en", "van", "voor", "met", "op", "in", "je", "jouw", "uw", "bij", "wat", "hoe", "welke", "is", "zijn", "of", "te", "aan", "dat", "die", "kies", "kiezen"]);
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !stop.has(w));
}

/** The partner photo whose alt text fits a heading best, or null. */
export function bestPartnerImage(heading: string, images: { url: string; alt: string }[], used: Set<string>) {
  const want = new Set(words(heading));
  let best: { url: string; alt: string } | null = null, score = 0;
  for (const img of images) {
    if (used.has(img.url) || !img.alt) continue;
    const s = words(img.alt).filter((w) => want.has(w)).length;
    if (s > score) { score = s; best = img; }
  }
  return best;
}

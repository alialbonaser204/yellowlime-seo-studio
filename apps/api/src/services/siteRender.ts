/**
 * Opens a partner's website in a real browser (Cloudflare Browser Rendering)
 * to read the styles as the visitor sees them and to take screenshots for the
 * AI. Needs the BROWSER binding in wrangler.jsonc; without it this returns null.
 */
let browserBinding: unknown = null;

export function setBrowserBinding(binding: unknown): void {
  if (binding) browserBinding = binding;
}

export function browserAvailable(): boolean {
  return Boolean(browserBinding);
}

export interface RenderedStyle {
  url: string;
  fonts: { heading: string; body: string; button: string };
  colors: { text: string; heading: string; link: string; background: string };
  sizes: { h1: string; h2: string; body: string; contentWidth: number };
  weights: { h1: string; h2: string };
  buttons: { text: string; bg: string; color: string; radius: string }[];
  logo: string | null;
  articleImages: { src: string; width: number; height: number; afterHeading: string | null }[];
}

/** Runs in the page: what the visitor really sees. */
const READ_STYLES = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const first = (sel) => document.querySelector(sel);
  const main = first('article') || first('main') || document.body;
  const h1 = main.querySelector('h1') || first('h1');
  const h2 = main.querySelector('h2') || first('h2');
  const p = [...main.querySelectorAll('p')].find((e) => e.textContent.trim().length > 80) || first('p');
  const a = p && p.querySelector('a') || main.querySelector('p a, li a') || first('main a');
  const clean = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim();
  const buttons = [...document.querySelectorAll('a, button')].map((e) => ({ e, c: getComputedStyle(e) }))
    .filter(({ e, c }) => c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'rgb(255, 255, 255)' && e.textContent.trim().length > 2 && e.offsetWidth > 60 && !/chat|whatsapp|cookie|winkelwagen|cart/i.test(e.textContent))
    .slice(0, 10).map(({ e, c }) => ({ text: e.textContent.trim().slice(0, 30), bg: c.backgroundColor, color: c.color, radius: c.borderRadius }));
  const header = first('header') || document.body;
  const logoImg = [...header.querySelectorAll('img, svg')].find((i) => i.getBoundingClientRect().width > 40);
  const logo = logoImg && logoImg.tagName === 'IMG' ? (logoImg.currentSrc || logoImg.src) : null;
  const heads = [...main.querySelectorAll('h2')];
  const articleImages = [...main.querySelectorAll('img')].filter((i) => i.naturalWidth > 300 || i.width > 300).slice(0, 12).map((i) => {
    const prev = heads.filter((h) => h.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    return { src: i.currentSrc || i.src, width: Math.round(i.getBoundingClientRect().width), height: Math.round(i.getBoundingClientRect().height), afterHeading: prev ? prev.textContent.trim().slice(0, 80) : null };
  });
  const width = p ? Math.round(p.getBoundingClientRect().width) : 0;
  return {
    url: location.href,
    fonts: { heading: clean(cs(h1 || h2)?.fontFamily), body: clean(cs(p || document.body).fontFamily), button: buttons[0] ? '' : '' },
    colors: { text: cs(p || document.body).color, heading: cs(h1 || h2)?.color || '', link: cs(a)?.color || '', background: cs(document.body).backgroundColor },
    sizes: { h1: cs(h1)?.fontSize || '', h2: cs(h2)?.fontSize || '', body: cs(p || document.body).fontSize, contentWidth: width },
    weights: { h1: cs(h1)?.fontWeight || '', h2: cs(h2)?.fontWeight || '' },
    buttons, logo, articleImages,
  };
})()`;

/** Finds a blog article link on the home page (to read the article layout). */
const FIND_ARTICLE = `(() => {
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin));
  const post = links.find((h) => /\\/(blog|blogs|nieuws|news|artikel|kennisbank|tips)\\/[^/?#]+\\/[^/?#]+/i.test(h) || /\\/(blog|artikel|kennisbank)\\/[^/?#]{8,}/i.test(h));
  const list = links.find((h) => /\\/(blog|blogs|nieuws|news|kennisbank)(\\/[^/?#]*)?\\/?$/i.test(h));
  return { post: post || null, list: list || null };
})()`;

export async function renderPartnerSite(websiteUrl: string): Promise<{ home: RenderedStyle; article: RenderedStyle | null; screenshots: string[] } | null> {
  if (!browserBinding) return null;
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const browser = await puppeteer.launch(browserBinding as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(websiteUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    // Close cookie banners that hide the page, if there is an obvious button.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find((e) => /^(akkoord|accepteren|alles accepteren|accept|ok|sluiten)$/i.test(e.textContent.trim())); b && b.click(); })()`).catch(() => undefined);
    const home = (await page.evaluate(READ_STYLES)) as RenderedStyle;
    const screenshots = [(await page.screenshot({ type: "jpeg", quality: 60 })) as Buffer].map((b) => Buffer.from(b).toString("base64"));
    let article: RenderedStyle | null = null;
    const links = (await page.evaluate(FIND_ARTICLE)) as { post: string | null; list: string | null };
    let postUrl = links.post;
    if (!postUrl && links.list) {
      await page.goto(links.list, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => undefined);
      postUrl = ((await page.evaluate(FIND_ARTICLE).catch(() => null)) as { post: string | null } | null)?.post ?? null;
    }
    if (postUrl) {
      await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => undefined);
      article = (await page.evaluate(READ_STYLES).catch(() => null)) as RenderedStyle | null;
      const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
      if (shot) screenshots.push(Buffer.from(shot as Buffer).toString("base64"));
      await page.evaluate("window.scrollTo(0, 900)").catch(() => undefined);
      const shot2 = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
      if (shot2) screenshots.push(Buffer.from(shot2 as Buffer).toString("base64"));
    }
    return { home, article, screenshots };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

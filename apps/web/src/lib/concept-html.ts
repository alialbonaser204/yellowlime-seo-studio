/**
 * Builds a standalone HTML page (one file, inline CSS) of an article in the
 * partner's style, with placeholder stock photos clearly marked as such.
 */
export interface ConceptPhoto { heading: string | null; url: string; alt: string; credit?: { name: string; url: string; pageUrl: string } }
export interface ConceptData {
  partnerName: string;
  websiteUrl: string | null;
  title: string;
  metaTitle: string;
  metaDescription: string;
  fullArticle: string;
  style: { headingFont: string | null; bodyFont: string | null; fontCssUrls: string[]; primaryColor: string | null; logoUrl: string | null } | null;
  photos: ConceptPhoto[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : '#');

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
}

function photoHtml(p: ConceptPhoto): string {
  return `<figure class="photo"><div class="frame"><img src="${safeUrl(p.url)}" alt="${esc(p.alt)}" loading="lazy"><span class="badge">Voorbeeldfoto · vervangen door foto van de partner</span></div>${p.credit ? `<figcaption>Foto: <a href="${safeUrl(p.credit.pageUrl)}">${esc(p.credit.name)}</a></figcaption>` : ''}</figure>`;
}

export function articleHtml(markdown: string, photos: ConceptPhoto[]): string {
  const byHeading = new Map(photos.filter((p) => p.heading).map((p) => [p.heading!, p]));
  const top = photos.find((p) => p.heading === null);
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;
  const flush = () => {
    if (list) { const tag = list.ordered ? 'ol' : 'ul'; out.push(`<${tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`); list = null; }
    if (quote) { out.push(`<div class="summary">${quote.map((q) => `<p>${q.startsWith('- ') ? '• ' + inline(q.slice(2)) : inline(q)}</p>`).join('')}</div>`); quote = null; }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('>')) { if (list) flush(); (quote ??= []).push(line.replace(/^>\s?/, '')); continue; }
    const li = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (li) { if (quote) flush(); const ordered = Boolean(li[2]); if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push(li[3]); continue; }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith('# ')) { out.push(`<h1>${inline(line.slice(2))}</h1>`); if (top) out.push(photoHtml(top)); continue; }
    if (line.startsWith('## ')) { const h = line.slice(3).trim(); out.push(`<h2>${inline(h)}</h2>`); const p = byHeading.get(h); if (p) out.push(photoHtml(p)); continue; }
    if (line.startsWith('### ')) { out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}

export function buildConceptHtml(d: ConceptData): string {
  const s = d.style;
  const accent = s?.primaryColor && /^#[0-9a-f]{3,8}$/i.test(s.primaryColor) ? s.primaryColor : '#2f6b3a';
  const fam = (f: string | null | undefined) => (f ? `'${f.replace(/['"\\<>]/g, '')}', ` : '');
  const families = [...new Set([s?.headingFont, s?.bodyFont].filter((f): f is string => !!f))];
  const fontLinks = [
    ...(s?.fontCssUrls ?? []),
    ...(families.length ? [`https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f)}:wght@400;600;700`).join('&')}&display=swap`] : []),
  ].map((u) => `<link rel="stylesheet" href="${safeUrl(u)}">`).join('\n');
  let host = '';
  try { host = d.websiteUrl ? new URL(d.websiteUrl).hostname.replace(/^www\./, '') : ''; } catch { /* no host */ }

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(d.metaTitle || d.title)}</title>
<meta name="description" content="${esc(d.metaDescription)}">
${fontLinks}
<style>
:root{--accent:${accent};--heading:${fam(s?.headingFont)}system-ui,-apple-system,"Segoe UI",sans-serif;--body:${fam(s?.bodyFont)}system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#222;font-family:var(--body);font-size:17px;line-height:1.7}
.notice{background:#fff4d6;border-bottom:1px solid #f0c95a;color:#5c4300;padding:12px 16px;font:14px/1.5 system-ui,sans-serif;text-align:center}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px max(16px,calc((100% - 1100px)/2));border-bottom:3px solid var(--accent)}
header img{max-height:48px;max-width:220px;object-fit:contain}
header strong{font-family:var(--heading);font-size:22px}
header span{font-size:13px;color:#777}
main{max-width:740px;margin:0 auto;padding:40px 16px 64px}
h1,h2,h3{font-family:var(--heading);line-height:1.25;color:#111}
h1{font-size:clamp(28px,5vw,40px);margin:0 0 22px}
h2{font-size:clamp(22px,3.4vw,28px);margin:44px 0 12px;color:var(--accent)}
h3{font-size:20px;margin:28px 0 8px}
p{margin:0 0 14px}
a{color:var(--accent)}
ul,ol{padding-left:22px;margin:0 0 16px}
.summary{border-left:4px solid var(--accent);background:#f6f6f6;padding:14px 18px;margin:18px 0 26px;border-radius:0 8px 8px 0}
.summary p{margin:0 0 6px}
.photo{margin:16px 0 24px}
.frame{position:relative}
.photo img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block;background:#eee}
.badge{position:absolute;left:10px;top:10px;background:rgba(92,67,0,.9);color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:6px}
figcaption{font-size:12px;color:#777;margin-top:6px}
footer{border-top:1px solid #eee;padding:20px 16px;text-align:center;font-size:13px;color:#888}
</style>
</head>
<body>
<div class="notice"><strong>Conceptpagina van ${esc(d.partnerName)}.</strong> De foto's zijn tijdelijke voorbeeldfoto's en moeten vóór publicatie worden vervangen door foto's van de partner. Lettertype en kleuren zijn van de website gelezen en kunnen iets afwijken.</div>
<header>${s?.logoUrl ? `<img src="${safeUrl(s.logoUrl)}" alt="${esc(d.partnerName)}">` : `<strong>${esc(d.partnerName)}</strong>`}<span>${esc(host)}</span></header>
<main>
${articleHtml(d.fullArticle, d.photos)}
</main>
<footer>Concept · ${esc(d.partnerName)} · niet gepubliceerd</footer>
</body>
</html>`;
}

/** Opens the concept in a new tab; returns false when the browser blocked the tab. */
export function openConcept(html: string, tab: Window | null): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  if (tab && !tab.closed) { tab.location.href = url; return true; }
  return Boolean(window.open(url, '_blank'));
}

export function downloadConcept(html: string, title: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `concept-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artikel'}.html`;
  a.click();
}

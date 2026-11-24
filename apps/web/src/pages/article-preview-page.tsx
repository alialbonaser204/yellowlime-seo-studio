import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, RefreshCw, TriangleAlert } from 'lucide-react';

interface Photo { heading: string | null; url: string; alt: string; source: 'partner' | 'pexels'; credit?: { name: string; url: string; pageUrl: string } }
interface Preview {
  partnerName: string;
  websiteUrl: string | null;
  title: string;
  metaTitle: string;
  metaDescription: string;
  fullArticle: string;
  style: { headingFont: string | null; bodyFont: string | null; fontCssUrls: string[]; primaryColor: string | null; logoUrl: string | null; siteName: string | null } | null;
  photos: Photo[];
  stockPhotos: boolean;
  styleMessage: string | null;
}

/** Bold and [links](url) inside a line. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={k++}>{m[1]}</strong> : <a key={k++} href={m[3]} target="_blank" rel="noreferrer noopener">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function PhotoBlock({ photo }: { photo: Photo }) {
  return (
    <figure className="pv-photo">
      <div className="pv-photo-frame">
        <img src={photo.url} alt={photo.alt} loading="lazy" />
        <span className="pv-photo-badge">Voorbeeldfoto · vervangen door foto van de partner</span>
      </div>
      {photo.credit && <figcaption>Foto: <a href={photo.credit.pageUrl} target="_blank" rel="noreferrer noopener">{photo.credit.name}</a></figcaption>}
    </figure>
  );
}

/** Renders the article's markdown with a photo under the title and under each H2. */
function ArticleBody({ markdown, photos }: { markdown: string; photos: Photo[] }) {
  const byHeading = new Map(photos.filter((p) => p.heading).map((p) => [p.heading!, p]));
  const top = photos.find((p) => p.heading === null);
  const lines = markdown.split('\n');
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;
  const flush = () => {
    if (list) { const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>); out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>); list = null; }
    if (quote) { out.push(<div className="pv-summary" key={out.length}>{quote.map((q, i) => q.startsWith('- ') ? <p key={i}>• {inline(q.slice(2))}</p> : <p key={i}>{inline(q)}</p>)}</div>); quote = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('>')) { if (list) flush(); (quote ??= []).push(line.replace(/^>\s?/, '')); continue; }
    const li = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (li) { if (quote) flush(); const ordered = Boolean(li[2]); if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push(li[3]); continue; }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith('# ')) { out.push(<h1 key={out.length}>{inline(line.slice(2))}</h1>); if (top) out.push(<PhotoBlock key={out.length} photo={top} />); continue; }
    if (line.startsWith('## ')) { const h = line.slice(3).trim(); out.push(<h2 key={out.length}>{inline(h)}</h2>); const p = byHeading.get(h); if (p) out.push(<PhotoBlock key={out.length} photo={p} />); continue; }
    if (line.startsWith('### ')) { out.push(<h3 key={out.length}>{inline(line.slice(4))}</h3>); continue; }
    out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <>{out}</>;
}

export function ArticlePreviewPage() {
  const { genId } = useParams<{ genId: string }>();
  const q = useQuery({
    queryKey: ['article-preview', genId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/article-generations/${genId}/preview`, { credentials: 'include', signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Het voorbeeld kon niet worden geladen.');
      return body as Preview;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Load the partner's fonts (Google Fonts / Typekit links from their site,
  // plus Google Fonts by name as a fallback).
  const style = q.data?.style;
  useEffect(() => {
    if (!style) return;
    const urls = [...style.fontCssUrls];
    const families = [style.headingFont, style.bodyFont].filter((f): f is string => !!f);
    if (families.length) urls.push(`https://fonts.googleapis.com/css2?${[...new Set(families)].map((f) => `family=${encodeURIComponent(f)}:wght@400;600;700`).join('&')}&display=swap`);
    const links = urls.map((href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); return l; });
    return () => links.forEach((l) => l.remove());
  }, [style]);

  if (q.isLoading) return <div className="card empty-state"><RefreshCw size={26} className="animate-spin" /><h3>Voorbeeld wordt gemaakt</h3><p>De stijl van de website wordt gelezen en er worden foto’s gezocht. Dit kan even duren.</p></div>;
  if (q.isError || !q.data) return <div className="card empty-state"><TriangleAlert size={26} /><h3>Geen voorbeeld</h3><p>{(q.error as Error)?.message}</p></div>;

  const d = q.data;
  const accent = style?.primaryColor ?? '#2f6b3a';
  const vars = {
    '--pv-accent': accent,
    '--pv-heading': style?.headingFont ? `'${style.headingFont}', system-ui, sans-serif` : 'system-ui, sans-serif',
    '--pv-body': style?.bodyFont ? `'${style.bodyFont}', system-ui, sans-serif` : 'system-ui, sans-serif',
  } as CSSProperties;
  const host = d.websiteUrl ? new URL(d.websiteUrl).hostname.replace(/^www\./, '') : '';

  return (
    <div className="pv-wrap">
      <div className="pv-toolbar">
        <button type="button" className="button button-ghost button-small" onClick={() => history.back()}><ArrowLeft size={14} /> Terug</button>
        <span>Voorbeeld in de stijl van <strong>{d.partnerName}</strong>. Lettertype en kleur zijn van de website gelezen en kunnen iets afwijken.</span>
      </div>
      <div className="pv-warning" role="note">
        <TriangleAlert size={16} />
        <span><strong>Let op: dit is een conceptpagina.</strong> De foto’s zijn tijdelijke stockfoto’s om een beeld te geven van de pagina. Vervang ze vóór publicatie door foto’s van {d.partnerName}.</span>
      </div>
      {d.styleMessage && <p className="pv-note">{d.styleMessage}</p>}
      

      <div className="pv-google">
        <small>{host} › blog</small>
        <strong>{d.metaTitle}</strong>
        <p>{d.metaDescription}</p>
      </div>

      <div className="pv-site" style={vars}>
        <header className="pv-header">
          {style?.logoUrl ? <img src={style.logoUrl} alt={d.partnerName} /> : <strong>{d.partnerName}</strong>}
          <span>{host}</span>
        </header>
        <article className="pv-article"><ArticleBody markdown={d.fullArticle} photos={d.photos} /></article>
      </div>
      <p className="pv-note"><Link href="/">Terug naar de werkruimte</Link></p>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, ExternalLink, FilePlus2, RefreshCw, TrendingDown, TriangleAlert, Wand2 } from 'lucide-react';
import { useListPartners } from '@yellowlime/api-client-react';
import { articleHtml } from '../lib/concept-html';
import { ProgressPanel, useEstimatedProgress } from '../components/progress-panel';
import { notifyTaskDone, prepareTaskNotifications } from '../lib/task-notify';

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Laden mislukt.');
  return body as T;
};
const nf = (n: number) => Math.round(n).toLocaleString('nl-NL');

interface Reason { code: string; text: string }
interface Candidate {
  url: string; title: string | null; clicks: number; previousClicks: number; impressions: number; ctr: number; position: number;
  wordCount: number | null; publishedAt: string | null; reasons: Reason[];
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
}
interface Change { type: string; section: string | null; before: string | null; after: string | null; reason: string }
interface Optimization {
  id: number; partnerId: number; partnerName: string; url: string; status: 'bezig' | 'klaar' | 'mislukt'; error: string | null;
  analysis: Candidate; createdAt: string;
  original: { title: string; metaTitle: string; metaDescription: string; fullArticle: string; wordCount: number } | null;
  result: { title: string; metaTitle: string; metaDescription: string; fullArticle: string } | null;
  overview: { diagnosis: string; mainKeyword: string; changes: Change[]; expectedEffect: string; checkBeforePublishing: string[] } | null;
}

const REASON_LABEL: Record<string, string> = { daling: 'Minder klikken', pagina2: 'Net niet op pagina 1', lage_ctr: 'Weinig klikken', onzichtbaar: 'Bijna onzichtbaar', verouderd: 'Oud', dun: 'Kort artikel' };
const CHANGE_LABEL: Record<string, string> = { titel: 'Titel', meta: 'Metatekst', inleiding: 'Inleiding', structuur: 'Opbouw', inhoud: 'Inhoud', zoekwoorden: 'Zoekwoorden', verwijderd: 'Verwijderd', toegevoegd: 'Toegevoegd', actualiteit: 'Actueel gemaakt', leesbaarheid: 'Leesbaarheid', overig: 'Overig' };
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '');

/** "Nieuw artikel": first choose between writing a new one and optimising an existing one. */
export function NewArticleChooser({ newArticle }: { newArticle: ReactNode }) {
  const [, setLocation] = useLocation();
  // useSearch re-renders when only the ?soort= part changes.
  const mode = new URLSearchParams(useSearch()).get('soort');
  if (mode === 'nieuw') return <>{newArticle}</>;
  if (mode === 'optimaliseren') return <OptimizeCandidatesPage />;
  return (
    <>
      <div className="page-header"><div><div className="eyebrow">Nieuw artikel</div><h1>Wat wil je doen?</h1><p>Schrijf een nieuw artikel, of verbeter een artikel dat al op de website van de partner staat maar slecht presteert.</p></div></div>
      <div className="opt-choice">
        <button type="button" className="opt-door" onClick={() => setLocation('/assignments/new?soort=nieuw')} data-testid="choice-new">
          <span className="opt-door-icon"><FilePlus2 size={26} /></span>
          <h3>Nieuw artikel schrijven</h3>
          <p>Kies een onderwerp of laat de AI er een voorstellen. De AI doet SEO-onderzoek en schrijft het artikel.</p>
          <span className="opt-door-go">Nieuw schrijven <ArrowRight size={16} /></span>
        </button>
        <button type="button" className="opt-door dark-door" onClick={() => setLocation('/assignments/new?soort=optimaliseren')} data-testid="choice-optimize">
          <span className="opt-door-icon"><Wand2 size={26} /></span>
          <h3>Bestaand artikel optimaliseren</h3>
          <p>De AI zoekt de 5 slechtst presterende artikelen van de partner, legt uit waarom, en verbetert het artikel dat jij kiest.</p>
          <span className="opt-door-go">Artikelen analyseren <ArrowRight size={16} /></span>
        </button>
      </div>
    </>
  );
}

function OptimizeCandidatesPage() {
  const [, setLocation] = useLocation();
  const { data: partners = [] } = useListPartners();
  const [partnerId, setPartnerId] = useState<string>(() => new URLSearchParams(window.location.search).get('partner') ?? '');
  useEffect(() => { if (!partnerId && partners.length) setPartnerId(String(partners[0].id)); }, [partners, partnerId]);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['optimize-candidates', partnerId],
    queryFn: () => getJson<{ status: string; message: string | null; candidates: Candidate[] }>(`/api/partners/${partnerId}/optimize/candidates`),
    enabled: Boolean(partnerId),
    staleTime: 10 * 60_000,
  });
  const progress = useEstimatedProgress(q.isFetching, 20_000);

  const start = async (c: Candidate) => {
    setStarting(c.url); setError(null);
    prepareTaskNotifications();
    try {
      // The server keeps working on the job; we only wait for its id.
      const res = await fetch(`/api/partners/${partnerId}/optimize`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysis: c }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Starten mislukt.');
      setLocation(`/optimaliseren/${body.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Starten mislukt.'); setStarting(null); }
  };

  return (
    <>
      <Link href="/assignments/new" className="button button-ghost button-small" style={{ marginBottom: 12, width: 'fit-content' }}><ArrowLeft size={14} /> Terug</Link>
      <div className="page-header"><div><div className="eyebrow">Bestaand artikel optimaliseren</div><h1>De 5 slechtst presterende artikelen</h1><p>Op basis van Google Search Console van de afgelopen 90 dagen. Kies er één: de AI verbetert het en laat precies zien wat hij veranderde.</p></div></div>
      <div className="opt-partner">
        <label htmlFor="opt-partner">Partner</label>
        <select id="opt-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
        </select>
      </div>
      {error && <p className="rq-error" style={{ marginBottom: 12 }}>{error}</p>}
      {q.isFetching && !q.data ? (
        <ProgressPanel title="Artikelen worden geanalyseerd" subtitle="Dit kan even duren" pct={progress} steps={[{ label: 'Search Console-cijfers ophalen', at: 0 }, { label: 'Artikelen vergelijken', at: 40 }, { label: 'Oorzaken bepalen', at: 75 }]} />
      ) : q.isError ? (
        <div className="card empty-state"><TriangleAlert size={24} /><p>{(q.error as Error).message}</p></div>
      ) : q.data && !q.data.candidates.length ? (
        <div className="card empty-state"><TrendingDown size={26} /><h3>Geen artikelen gevonden</h3><p>{q.data.message}</p></div>
      ) : (
        <div className="opt-list">
          {q.data?.candidates.map((c, i) => (
            <article key={c.url} className="opt-card" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="opt-rank">{i + 1}</div>
              <div className="opt-body">
                <h3>{c.title ?? shortUrl(c.url)}</h3>
                <a href={c.url} target="_blank" rel="noreferrer noopener" className="opt-url">{shortUrl(c.url)} <ExternalLink size={12} /></a>
                <div className="opt-stats">
                  <span><strong>{nf(c.clicks)}</strong> klikken{c.previousClicks ? ` (was ${nf(c.previousClicks)})` : ''}</span>
                  <span><strong>{nf(c.impressions)}</strong> keer getoond</span>
                  <span><strong>{c.position ? c.position.toLocaleString('nl-NL') : '—'}</strong> gem. positie</span>
                  <span><strong>{(c.ctr * 100).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%</strong> klikt</span>
                </div>
                <div className="opt-why">
                  <strong>Waarom presteert het slecht?</strong>
                  <ul>{c.reasons.map((r) => <li key={r.code}><span className={`opt-tag t-${r.code}`}>{REASON_LABEL[r.code] ?? r.code}</span>{r.text}</li>)}</ul>
                </div>
                {c.topQueries.length > 0 && <div className="opt-queries"><small>Zoekopdrachten:</small> {c.topQueries.slice(0, 4).map((t) => <span key={t.query}>{t.query}</span>)}</div>}
              </div>
              <div className="opt-actions">
                <button type="button" className="button button-primary opt-go" onClick={() => start(c)} disabled={starting !== null} data-testid={`optimize-${i}`}>
                  {starting === c.url ? <RefreshCw size={15} className="animate-spin" /> : <Wand2 size={15} />} Optimaliseren
                </button>
                <a href={c.url} target="_blank" rel="noreferrer noopener" className="button button-ghost opt-go" data-testid={`visit-${i}`}>
                  <ExternalLink size={15} /> Pagina bezoeken
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function OptimizationResultPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'overzicht' | 'nieuw' | 'oud'>('overzicht');
  const [copied, setCopied] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['optimization', id],
    queryFn: () => getJson<Optimization>(`/api/optimizations/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'bezig' ? 4000 : false),
  });
  const busy = q.data?.status === 'bezig';
  const progress = useEstimatedProgress(Boolean(busy), 180_000);
  // Only notify when the job finishes while this page is open.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (q.data?.status === 'bezig') wasBusy.current = true;
    else if (wasBusy.current && q.data) {
      wasBusy.current = false;
      notifyTaskDone({ title: q.data.status === 'klaar' ? 'Optimalisatie klaar' : 'Optimalisatie mislukt', body: q.data.result?.title ?? q.data.error ?? '', ok: q.data.status === 'klaar' });
    }
  }, [q.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (label: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1800); } catch { /* no clipboard */ } };

  if (q.isLoading) return <div className="card empty-state"><RefreshCw size={24} className="animate-spin" /></div>;
  if (q.isError || !q.data) return <div className="card empty-state"><TriangleAlert size={24} /><p>{(q.error as Error)?.message}</p></div>;
  const o = q.data;
  const ov = o.overview;
  const counts = ov ? Object.entries(ov.changes.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.type]: (acc[c.type] ?? 0) + 1 }), {})) : [];

  return (
    <>
      <Link href={`/assignments/new?soort=optimaliseren&partner=${o.partnerId}`} className="button button-ghost button-small" style={{ marginBottom: 12, width: 'fit-content' }}><ArrowLeft size={14} /> Terug naar de artikelen</Link>
      <div className="page-header"><div><div className="eyebrow">Optimalisatie · {o.partnerName}</div><h1>{o.result?.title ?? o.original?.title ?? shortUrl(o.url)}</h1><p><a href={o.url} target="_blank" rel="noreferrer noopener" className="opt-url">{shortUrl(o.url)} <ExternalLink size={12} /></a></p></div></div>

      {busy ? (
        <>
          <ProgressPanel title="De AI optimaliseert het artikel" subtitle="Dit kan even duren" pct={progress} steps={[{ label: 'Artikel lezen', at: 0 }, { label: 'Top 5 bekijken', at: 20 }, { label: 'Verbeteren', at: 45 }, { label: 'Overzicht maken', at: 85 }]} />
          <div className="opt-steps card">
            <p><strong>Wat de AI nu doet:</strong></p>
            <ol>
              <li className={o.original ? 'done' : ''}>Het artikel van de website lezen{o.original ? ` (${nf(o.original.wordCount)} woorden)` : ''}</li>
              <li>De top 5 in Google bekijken voor het hoofdzoekwoord</li>
              <li>Uitzoeken waarom het slecht presteert</li>
              <li>Het artikel verbeteren in de stijl van {o.partnerName}</li>
              <li>Elke wijziging met reden vastleggen</li>
            </ol>
            <p className="opt-muted">Je kunt deze pagina sluiten; je krijgt een melding als het klaar is.</p>
          </div>
        </>
      ) : o.status === 'mislukt' ? (
        <div className="card empty-state"><TriangleAlert size={24} /><h3>Het optimaliseren is mislukt</h3><p>{o.error}</p></div>
      ) : ov && o.result && (
        <>
          <div className="opt-summary">
            <div className="opt-summary-main">
              <span className="opt-ok"><CheckCircle2 size={18} /> Klaar: {ov.changes.length} wijzigingen</span>
              <h2>Waarom presteerde het slecht?</h2>
              <p>{ov.diagnosis}</p>
              {ov.expectedEffect && <p className="opt-muted"><strong>Verwacht effect:</strong> {ov.expectedEffect}</p>}
            </div>
            <div className="opt-summary-side">
              {ov.mainKeyword && <div><small>Hoofdzoekwoord</small><strong>{ov.mainKeyword}</strong></div>}
              <div><small>Lengte</small><strong>{nf(o.original?.wordCount ?? 0)} → {nf(o.result.fullArticle.split(/\s+/).filter(Boolean).length)} woorden</strong></div>
              <div className="opt-counts">{counts.map(([t, n]) => <span key={t}>{CHANGE_LABEL[t] ?? t} · {n}</span>)}</div>
            </div>
          </div>

          {ov.checkBeforePublishing.length > 0 && (
            <div className="rq-edit-hint" style={{ marginTop: 14 }}><strong>Controleer vóór publicatie:</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{ov.checkBeforePublishing.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}

          <div className="rq-tabs" role="tablist" style={{ marginTop: 18 }}>
            {(['overzicht', 'nieuw', 'oud'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'overzicht' ? 'Overzicht van wijzigingen' : t === 'nieuw' ? 'Nieuwe versie' : 'Oude versie'}</button>)}
          </div>

          {tab === 'overzicht' && (
            <div className="opt-changes">
              <div className="opt-meta card">
                <h3>Google-weergave</h3>
                <div className="opt-meta-grid">
                  <div><small>Nu</small><div className="rq-google"><strong>{o.original?.metaTitle || '—'}</strong><p>{o.original?.metaDescription || '—'}</p></div></div>
                  <div><small>Nieuw</small><div className="rq-google"><strong>{o.result.metaTitle}</strong><p>{o.result.metaDescription}</p></div></div>
                </div>
              </div>
              {ov.changes.map((c, i) => (
                <div key={i} className="opt-change card" style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}>
                  <div className="opt-change-head"><span className={`opt-ctype c-${c.type}`}>{CHANGE_LABEL[c.type] ?? c.type}</span>{c.section && <span className="opt-muted">{c.section}</span>}</div>
                  <p className="opt-reason">{c.reason}</p>
                  {(c.before || c.after) && (
                    <div className="opt-diff">
                      {c.before && <div className="lw-old">{c.before}</div>}
                      {c.after && <div className="lw-new">{c.after}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab !== 'overzicht' && (
            <article className="card article-paper rq-article">
              <div className="opt-copy">
                <button type="button" className="button button-ghost button-small" onClick={() => copy('tekst', tab === 'nieuw' ? o.result!.fullArticle : o.original?.fullArticle ?? '')}><Copy size={14} /> {copied === 'tekst' ? 'Gekopieerd' : 'Tekst kopiëren'}</button>
                {tab === 'nieuw' && <button type="button" className="button button-ghost button-small" onClick={() => copy('meta', `${o.result!.metaTitle}\n${o.result!.metaDescription}`)}><Copy size={14} /> {copied === 'meta' ? 'Gekopieerd' : 'Metateksten kopiëren'}</button>}
              </div>
              {/* articleHtml escapes all text; only http(s) links become <a>. */}
              <div className="article-body" dangerouslySetInnerHTML={{ __html: articleHtml(tab === 'nieuw' ? o.result.fullArticle : o.original?.fullArticle ?? '', []) }} />
            </article>
          )}
        </>
      )}
    </>
  );
}

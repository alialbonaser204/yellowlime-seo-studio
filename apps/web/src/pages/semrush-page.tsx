import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useListPartners } from '@yellowlime/api-client-react';
import { BarChart3, ExternalLink, Lightbulb, RefreshCw, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ProgressPanel, useEstimatedProgress } from '../components/progress-panel';
import { notifyTaskDone, prepareTaskNotifications } from '../lib/task-notify';

interface Analysis {
  domain: string;
  database: string;
  overview: { rank: number | null; keywords: number; traffic: number; trafficValue: number; positions: { top3: number; top10: number; top20: number; top100: number } };
  history: { month: string; keywords: number; traffic: number }[];
  keywords: { keyword: string; position: number; previousPosition: number | null; volume: number; url: string; trafficShare: number; difficulty: number | null; intent: string | null; branded: boolean }[];
  opportunities: { keyword: string; position: number; volume: number; url: string; difficulty: number | null }[];
  pages: { url: string; keywords: number; traffic: number; trafficShare: number }[];
  competitors: { domain: string; relevance: number; commonKeywords: number; keywords: number; traffic: number }[];
  insights: { tone: 'goed' | 'let-op' | 'kans'; text: string }[];
  unitsEstimate: number;
}

interface SavedAnalysis { id: number; domain: string; createdAt: string; analysis: Analysis }

const nf = (n: number) => Math.round(n).toLocaleString('nl-NL');
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || '/';
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} '${m.slice(2, 4)}`;

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === 'string' ? data.error : 'Er ging iets mis. Probeer het opnieuw.';
}

const queryKey = (partnerId: number) => ['semrush-analysis', partnerId];

export function SemrushPage() {
  const { data: partners = [], isLoading: partnersLoading } = useListPartners();
  const [partnerId, setPartnerId] = useState<number | null>(() => {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('partner'));
    return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : null;
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const pct = useEstimatedProgress(running, 25_000);

  // Remember the chosen partner in the address, so a refresh keeps it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (partnerId) url.searchParams.set('partner', String(partnerId)); else url.searchParams.delete('partner');
    window.history.replaceState(null, '', url);
    setError(null);
  }, [partnerId]);

  const saved = useQuery({
    queryKey: queryKey(partnerId ?? 0),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<SavedAnalysis | null> => {
      const res = await fetch(`/api/partners/${partnerId}/semrush-analysis`);
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
  });

  const partner = partners.find((p) => p.id === partnerId);

  const run = async () => {
    if (!partnerId || running) return;
    prepareTaskNotifications();
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${partnerId}/semrush-analysis`, { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as SavedAnalysis;
      queryClient.setQueryData(queryKey(partnerId), data);
      notifyTaskDone({ title: 'Semrush-analyse is klaar', body: `De analyse van ${data.domain} staat klaar.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Er ging iets mis.';
      setError(message);
      notifyTaskDone({ title: 'Semrush-analyse is mislukt', body: message, ok: false });
    } finally {
      setRunning(false);
    }
  };

  const data = saved.data?.analysis;

  return (
    <>
      <div className="page-header fade-up">
        <div>
          <div className="eyebrow">Semrush</div>
          <h1>Analyse per partner</h1>
          <p>Hoe zichtbaar is de website van een partner in Google? Kies een partner en zie de cijfers, de trend, de kansen en de concurrenten.</p>
        </div>
      </div>

      <div className="card semrush-picker">
        <label htmlFor="semrush-partner">Partner</label>
        <select id="semrush-partner" className="input" value={partnerId ?? ''} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : null)} disabled={partnersLoading} data-testid="select-semrush-partner">
          <option value="">{partnersLoading ? 'Partners laden…' : 'Kies een partner'}</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
        </select>
        {partner && saved.data && !running && (
          <div className="semrush-meta">
            <span>{saved.data.domain} · Google Nederland · bijgewerkt op {new Date(saved.data.createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <button type="button" className="button button-ghost button-small" onClick={run} data-testid="button-semrush-refresh"><RefreshCw size={13} /> Vernieuwen</button>
          </div>
        )}
      </div>

      {error && <div className="semrush-error" role="alert" data-testid="semrush-error"><TriangleAlert size={16} /> {error}</div>}

      {running && (
        <ProgressPanel
          title={`Analyse van ${partner?.companyName ?? 'de partner'}`}
          subtitle="Semrush-gegevens ophalen · dit duurt meestal een halve minuut"
          pct={pct}
          steps={[
            { label: 'Zichtbaarheid en trend', at: 0 },
            { label: 'Zoekwoorden en pagina’s', at: 30 },
            { label: 'Kansen op pagina 2', at: 55 },
            { label: 'Concurrenten', at: 75 },
          ]}
          testId="semrush-progress"
        />
      )}

      {!partnerId && !running && (
        <div className="empty-state card"><BarChart3 size={28} /><h3>Kies een partner</h3><p>Daarna zie je hier de Semrush-analyse van de website.</p></div>
      )}

      {partnerId && !running && saved.isLoading && <div className="empty-state card"><RefreshCw size={24} className="animate-spin" /><h3>Laden…</h3></div>}

      {partnerId && !running && saved.isError && <div className="empty-state card"><TriangleAlert size={24} /><h3>De analyse kon niet worden geladen</h3><p>{(saved.error as Error).message}</p></div>}

      {partnerId && !running && saved.isSuccess && !saved.data && (
        <div className="empty-state card" data-testid="semrush-empty">
          <BarChart3 size={28} />
          <h3>Nog geen analyse voor {partner?.companyName}</h3>
          <p>De analyse haalt zes rapporten op uit Semrush en kost ongeveer 800 Semrush-eenheden. Hij wordt bewaard, dus later opnieuw bekijken kost niets.</p>
          <button type="button" className="button button-primary" onClick={run} data-testid="button-semrush-run">Analyse maken</button>
        </div>
      )}

      {data && !running && <AnalysisView data={data} />}
    </>
  );
}

function AnalysisView({ data }: { data: Analysis }) {
  const { overview, history } = data;
  const lastTwo = history.slice(-2);
  const change = lastTwo.length === 2 && lastTwo[0].traffic > 0 ? Math.round(((lastTwo[1].traffic - lastTwo[0].traffic) / lastTwo[0].traffic) * 100) : null;
  const totalPositions = overview.positions.top3 + overview.positions.top10 + overview.positions.top20 + overview.positions.top100;
  const chart = useMemo(() => history.map((h) => ({ ...h, label: monthLabel(h.month) })), [history]);

  if (overview.keywords === 0 && history.length === 0) {
    return <div className="empty-state card"><BarChart3 size={28} /><h3>Semrush heeft geen gegevens voor {data.domain}</h3><p>De website staat nog niet (of nauwelijks) in de Nederlandse Google-resultaten die Semrush bijhoudt.</p></div>;
  }

  return (
    <div className="semrush-view" data-testid="semrush-analysis">
      <div className="semrush-kpis">
        <Kpi label="Bezoekers per maand uit Google" value={nf(overview.traffic)} note={change === null ? 'geschat door Semrush' : <>{change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {change >= 0 ? '+' : ''}{change}% t.o.v. vorige maand</>} />
        <Kpi label="Zoekwoorden in de top 100" value={nf(overview.keywords)} note={`${nf(overview.positions.top3)} in de top 3`} />
        <Kpi label="Waarde van dat verkeer" value={`€ ${nf(overview.trafficValue)}`} note="wat dit aan Google Ads zou kosten, per maand" />
        <Kpi label="Semrush Rank (NL)" value={overview.rank ? nf(overview.rank) : '—'} note="lager is beter" />
      </div>

      {data.insights.length > 0 && (
        <section className="card semrush-section">
          <h2><Lightbulb size={16} /> Wat valt op</h2>
          <ul className="semrush-insights">
            {data.insights.map((i) => <li key={i.text} className={`is-${i.tone}`}><span>{i.tone === 'goed' ? 'Goed' : i.tone === 'kans' ? 'Kans' : 'Let op'}</span>{i.text}</li>)}
          </ul>
        </section>
      )}

      <div className="semrush-grid">
        {chart.length > 1 && (
          <section className="card semrush-section">
            <h2>Verkeer uit Google, afgelopen {chart.length} maanden</h2>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => nf(v)} />
                  <Tooltip formatter={(v: number, name: string) => [nf(v), name === 'traffic' ? 'Bezoekers' : 'Zoekwoorden']} labelStyle={{ color: '#16362f' }} />
                  <Line type="monotone" dataKey="traffic" stroke="#16362f" strokeWidth={2.5} dot={{ r: 3, fill: '#16362f' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
        <section className="card semrush-section">
          <h2>Posities in Google</h2>
          <div className="semrush-bars">
            {[
              ['Top 3', overview.positions.top3],
              ['Plek 4–10', overview.positions.top10],
              ['Plek 11–20', overview.positions.top20],
              ['Plek 21–100', overview.positions.top100],
            ].map(([label, value]) => (
              <div key={label as string} className="semrush-bar">
                <span>{label}</span>
                <div><i style={{ width: `${totalPositions ? Math.max(2, ((value as number) / totalPositions) * 100) : 0}%` }} /></div>
                <strong>{nf(value as number)}</strong>
              </div>
            ))}
          </div>
          <p className="semrush-note">Alleen de top 10 staat op de eerste pagina van Google.</p>
        </section>
      </div>

      {data.opportunities.length > 0 && (
        <section className="card semrush-section">
          <h2>Kansen: bijna op pagina 1</h2>
          <p className="semrush-note">Zoekwoorden op positie 11–20. Een betere of nieuwe pagina kan ze naar de eerste pagina van Google brengen.</p>
          <Table head={['Zoekwoord', 'Positie', 'Zoekvolume', 'Moeilijkheid', 'Pagina']}>
            {data.opportunities.map((o) => (
              <tr key={o.keyword}><td><strong>{o.keyword}</strong></td><td>{o.position}</td><td>{nf(o.volume)}</td><td>{o.difficulty ?? '—'}</td><td><PageLink url={o.url} /></td></tr>
            ))}
          </Table>
        </section>
      )}

      {data.keywords.length > 0 && (
        <section className="card semrush-section">
          <h2>Zoekwoorden die het meeste verkeer brengen</h2>
          <Table head={['Zoekwoord', 'Positie', 'Zoekvolume', 'Aandeel verkeer', 'Zoekintentie', 'Pagina']}>
            {data.keywords.map((k) => (
              <tr key={k.keyword}>
                <td><strong>{k.keyword}</strong>{k.branded && <span className="semrush-tag">merknaam</span>}</td>
                <td>{k.position}{k.previousPosition && k.previousPosition !== k.position && <small className={k.previousPosition > k.position ? 'up' : 'down'}> {k.previousPosition > k.position ? '▲' : '▼'}{Math.abs(k.previousPosition - k.position)}</small>}</td>
                <td>{nf(k.volume)}</td>
                <td>{k.trafficShare.toLocaleString('nl-NL')}%</td>
                <td>{k.intent ?? '—'}</td>
                <td><PageLink url={k.url} /></td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      <div className="semrush-grid">
        {data.pages.length > 0 && (
          <section className="card semrush-section">
            <h2>Pagina’s met het meeste verkeer</h2>
            <Table head={['Pagina', 'Zoekwoorden', 'Bezoekers', 'Aandeel']}>
              {data.pages.map((p) => <tr key={p.url}><td><PageLink url={p.url} /></td><td>{nf(p.keywords)}</td><td>{nf(p.traffic)}</td><td>{p.trafficShare.toLocaleString('nl-NL')}%</td></tr>)}
            </Table>
          </section>
        )}
        {data.competitors.length > 0 && (
          <section className="card semrush-section">
            <h2>Concurrenten in Google</h2>
            <Table head={['Website', 'Gedeelde zoekwoorden', 'Bezoekers']}>
              {data.competitors.map((c) => <tr key={c.domain}><td><a href={`https://${c.domain}`} target="_blank" rel="noreferrer noopener">{c.domain}</a></td><td>{nf(c.commonKeywords)}</td><td>{nf(c.traffic)}</td></tr>)}
            </Table>
          </section>
        )}
      </div>
      <p className="semrush-note">Bron: Semrush, database Google Nederland. Bezoekersaantallen zijn schattingen van Semrush, geen gemeten bezoeken. Deze analyse kostte ongeveer {nf(data.unitsEstimate)} Semrush-eenheden.</p>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return <div className="card semrush-kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="semrush-table-wrap">
      <table className="semrush-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function PageLink({ url }: { url: string }) {
  if (!url) return <>—</>;
  return <a href={url} target="_blank" rel="noreferrer noopener" className="semrush-url" title={url}><span>{shortUrl(url)}</span><ExternalLink size={11} /></a>;
}

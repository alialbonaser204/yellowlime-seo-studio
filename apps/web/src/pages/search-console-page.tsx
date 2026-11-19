import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useListPartners } from '@yellowlime/api-client-react';
import { ExternalLink, Lightbulb, RefreshCw, Search, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { connectHref } from '../components/search-console';

interface Totals { clicks: number; impressions: number; ctr: number; position: number }
interface MetricRow extends Totals { key: string }
interface Report {
  totals: Totals;
  previousTotals: Totals;
  daily: (Totals & { date: string })[];
  devices: (Totals & { device: string })[];
  topQueries: MetricRow[];
  topPages: MetricRow[];
  opportunities: MetricRow[];
  lowCtr: (MetricRow & { groupCtr: number })[];
  decliningPages: { page: string; clicks: number; previousClicks: number; change: number }[];
  brand: { clicks: number; share: number } | null;
  insights: { tone: 'goed' | 'let-op' | 'kans'; text: string }[];
}
interface PageData {
  status: 'not_configured' | 'not_connected' | 'no_property' | 'ok' | 'error';
  account: string | null;
  shared: boolean;
  property: string | null;
  message: string | null;
  days: number;
  period: { startDate: string; endDate: string; previousStartDate: string; previousEndDate: string } | null;
  report: Report | null;
}

const nf = (n: number) => Math.round(n).toLocaleString('nl-NL');
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('nl-NL')}%`;
const pos = (n: number) => (Math.round(n * 10) / 10).toLocaleString('nl-NL');
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || '/';
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });

function change(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}

export function SearchConsolePage() {
  const { data: partners = [], isLoading: partnersLoading } = useListPartners();
  const params = new URLSearchParams(window.location.search);
  const [partnerId, setPartnerId] = useState<number | null>(() => {
    const id = Number(params.get('partner'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [days, setDays] = useState<number>(() => ([7, 28, 90].includes(Number(params.get('days'))) ? Number(params.get('days')) : 28));
  const [refresh, setRefresh] = useState(0);
  const googleResult = params.get('google');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (partnerId) url.searchParams.set('partner', String(partnerId)); else url.searchParams.delete('partner');
    url.searchParams.set('days', String(days));
    url.searchParams.delete('google');
    window.history.replaceState(null, '', url);
  }, [partnerId, days]);

  const report = useQuery({
    queryKey: ['search-console-page', partnerId, days, refresh],
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<PageData> => {
      const res = await fetch(`/api/partners/${partnerId}/search-console/report?days=${days}${refresh ? '&refresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Search Console kon niet worden geladen.');
      return data as PageData;
    },
    staleTime: 5 * 60_000,
  });

  const data = report.data;

  return (
    <>
      <div className="page-header fade-up">
        <div>
          <div className="eyebrow">Google Search Console</div>
          <h1>Prestaties in Google</h1>
          <p>Echte cijfers uit Google: hoe vaak een partner wordt getoond, hoe vaak erop wordt geklikt en op welke zoekopdrachten. Kies een partner en een periode.</p>
        </div>
      </div>

      {googleResult === 'connected' && <div className="gsc-banner is-ok" data-testid="gsc-connected">Je Google-account is gekoppeld.</div>}
      {googleResult === 'denied' && <div className="gsc-banner" role="alert">Het koppelen is geannuleerd of door Google geweigerd.</div>}

      <div className="card semrush-picker">
        <div className="gsc-controls">
          <div className="gsc-field">
            <label htmlFor="gsc-partner">Partner</label>
            <select id="gsc-partner" className="input" value={partnerId ?? ''} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : null)} disabled={partnersLoading} data-testid="select-gsc-partner">
              <option value="">{partnersLoading ? 'Partners laden…' : 'Kies een partner'}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
            </select>
          </div>
          <div className="gsc-field">
            <span className="gsc-label">Periode</span>
            <div className="gsc-periods" role="group" aria-label="Periode">
              {[7, 28, 90].map((d) => (
                <button key={d} type="button" className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => setDays(d)} data-testid={`gsc-days-${d}`}>{d} dagen</button>
              ))}
            </div>
          </div>
        </div>
        {data?.status === 'ok' && data.period && (
          <div className="semrush-meta">
            <span>{data.property?.replace('sc-domain:', '')} · {day(data.period.startDate)} t/m {day(data.period.endDate)} · via {data.account}{data.shared ? ' (account van een collega)' : ''}</span>
            <button type="button" className="button button-ghost button-small" onClick={() => setRefresh(Date.now())} disabled={report.isFetching} data-testid="button-gsc-refresh"><RefreshCw size={13} className={report.isFetching ? 'animate-spin' : ''} /> Vernieuwen</button>
          </div>
        )}
      </div>

      {!partnerId && <div className="empty-state card"><Search size={28} /><h3>Kies een partner</h3><p>Daarna zie je hier de cijfers uit Google Search Console.</p></div>}
      {partnerId && report.isLoading && <div className="empty-state card"><RefreshCw size={24} className="animate-spin" /><h3>Gegevens ophalen bij Google…</h3></div>}
      {partnerId && report.isError && <div className="empty-state card"><TriangleAlert size={24} /><h3>Search Console kon niet worden geladen</h3><p>{(report.error as Error).message}</p></div>}
      {partnerId && data && data.status !== 'ok' && <NotReady data={data} />}
      {partnerId && data?.status === 'ok' && data.report && <ReportView report={data.report} days={data.days} />}
    </>
  );
}

function NotReady({ data }: { data: PageData }) {
  const canConnect = data.status === 'not_connected';
  const title = {
    not_configured: 'De Google-koppeling is nog niet ingesteld',
    not_connected: 'Koppel je Google-account',
    no_property: 'Geen toegang tot deze website in Search Console',
    error: 'Search Console gaf een fout',
    ok: '',
  }[data.status];
  return (
    <div className="empty-state card" data-testid={`gsc-status-${data.status}`}>
      <Search size={28} />
      <h3>{title}</h3>
      <p>{data.message}</p>
      {data.status === 'no_property' && <p>Vraag iemand met toegang tot deze website in Search Console (bijvoorbeeld Thijs) om zijn Google-account te koppelen via het menu, of om jouw account toegang te geven.</p>}
      {canConnect && <a className="button button-primary" href={connectHref()} data-testid="gsc-connect">Google-account koppelen</a>}
    </div>
  );
}

function Delta({ now, before, lowerIsBetter = false, asPoints = false, unit = '' }: { now: number; before: number; lowerIsBetter?: boolean; asPoints?: boolean; unit?: string }) {
  if (before <= 0) return <>geen vergelijking</>;
  const diff = asPoints ? Math.round((now - before) * 10) / 10 : change(now, before);
  if (diff === null || diff === 0) return <>gelijk aan de periode ervoor</>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={better ? 'gsc-up' : 'gsc-down'}>
      {diff > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {diff > 0 ? '+' : ''}{asPoints ? `${diff.toLocaleString('nl-NL')}${unit}` : `${diff}%`} t.o.v. de periode ervoor
    </span>
  );
}

function ReportView({ report, days }: { report: Report; days: number }) {
  const { totals, previousTotals } = report;
  const chart = useMemo(() => report.daily.map((d) => ({ ...d, label: day(d.date) })), [report.daily]);
  const deviceTotal = report.devices.reduce((s, d) => s + d.clicks, 0);

  if (totals.impressions === 0) {
    return <div className="empty-state card"><Search size={28} /><h3>Geen gegevens in deze periode</h3><p>Google heeft de website de afgelopen {days} dagen niet getoond in de zoekresultaten, of de gegevens zijn nog niet beschikbaar.</p></div>;
  }

  return (
    <div className="semrush-view" data-testid="gsc-report">
      <div className="semrush-kpis">
        <Kpi label="Klikken" value={nf(totals.clicks)} note={<Delta now={totals.clicks} before={previousTotals.clicks} />} />
        <Kpi label="Vertoningen" value={nf(totals.impressions)} note={<Delta now={totals.impressions} before={previousTotals.impressions} />} />
        <Kpi label="Klikratio (CTR)" value={pct(totals.ctr)} note={<Delta now={totals.ctr * 100} before={previousTotals.ctr * 100} asPoints unit=" procentpunt" />} />
        <Kpi label="Gemiddelde positie" value={pos(totals.position)} note={<Delta now={totals.position} before={previousTotals.position} lowerIsBetter asPoints unit=" plek" />} />
      </div>

      {report.insights.length > 0 && (
        <section className="card semrush-section">
          <h2><Lightbulb size={16} /> Wat valt op</h2>
          <ul className="semrush-insights">
            {report.insights.map((i) => <li key={i.text} className={`is-${i.tone}`}><span>{i.tone === 'goed' ? 'Goed' : i.tone === 'kans' ? 'Kans' : 'Let op'}</span>{i.text}</li>)}
          </ul>
        </section>
      )}

      <div className="semrush-grid">
        {chart.length > 1 && (
          <section className="card semrush-section">
            <h2>Klikken per dag</h2>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [nf(v), 'Klikken']} labelStyle={{ color: '#16362f' }} />
                  <Line type="monotone" dataKey="clicks" stroke="#16362f" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
        <section className="card semrush-section">
          <h2>Apparaten</h2>
          <div className="semrush-bars">
            {report.devices.map((d) => (
              <div key={d.device} className="semrush-bar">
                <span style={{ textTransform: 'capitalize' }}>{d.device}</span>
                <div><i style={{ width: `${deviceTotal ? Math.max(2, (d.clicks / deviceTotal) * 100) : 0}%` }} /></div>
                <strong>{deviceTotal ? Math.round((d.clicks / deviceTotal) * 100) : 0}%</strong>
              </div>
            ))}
          </div>
          {report.brand && <p className="semrush-note">{Math.round(report.brand.share * 100)}% van de klikken komt van zoekopdrachten op de bedrijfsnaam.</p>}
        </section>
      </div>

      {report.opportunities.length > 0 && (
        <section className="card semrush-section">
          <h2>Kansen: zoekopdrachten op positie 4–20</h2>
          <p className="semrush-note">Google toont de website al, maar net niet bovenaan. Een betere of nieuwe pagina kan hier veel klikken opleveren.</p>
          <Table head={['Zoekopdracht', 'Positie', 'Vertoningen', 'Klikken', 'CTR']}>
            {report.opportunities.map((q) => <tr key={q.key}><td><strong>{q.key}</strong></td><td>{pos(q.position)}</td><td>{nf(q.impressions)}</td><td>{nf(q.clicks)}</td><td>{pct(q.ctr)}</td></tr>)}
          </Table>
        </section>
      )}

      {report.lowCtr.length > 0 && (
        <section className="card semrush-section">
          <h2>Goed zichtbaar, weinig klikken</h2>
          <p className="semrush-note">Deze zoekopdrachten staan in de top 10, maar krijgen minder dan de helft van de klikken die de website gemiddeld op die positie krijgt. Vaak helpt een duidelijkere titel of metabeschrijving.</p>
          <Table head={['Zoekopdracht', 'Positie', 'Vertoningen', 'CTR', 'Gemiddeld op die positie']}>
            {report.lowCtr.map((q) => <tr key={q.key}><td><strong>{q.key}</strong></td><td>{pos(q.position)}</td><td>{nf(q.impressions)}</td><td>{pct(q.ctr)}</td><td>{pct(q.groupCtr)}</td></tr>)}
          </Table>
        </section>
      )}

      <section className="card semrush-section">
        <h2>Zoekopdrachten met de meeste klikken</h2>
        <Table head={['Zoekopdracht', 'Klikken', 'Vertoningen', 'CTR', 'Positie']}>
          {report.topQueries.map((q) => <tr key={q.key}><td><strong>{q.key}</strong></td><td>{nf(q.clicks)}</td><td>{nf(q.impressions)}</td><td>{pct(q.ctr)}</td><td>{pos(q.position)}</td></tr>)}
        </Table>
      </section>

      <div className="semrush-grid">
        <section className="card semrush-section">
          <h2>Pagina’s met de meeste klikken</h2>
          <Table head={['Pagina', 'Klikken', 'Vertoningen', 'Positie']}>
            {report.topPages.map((p) => <tr key={p.key}><td><PageLink url={p.key} /></td><td>{nf(p.clicks)}</td><td>{nf(p.impressions)}</td><td>{pos(p.position)}</td></tr>)}
          </Table>
        </section>
        {report.decliningPages.length > 0 && (
          <section className="card semrush-section">
            <h2>Pagina’s die klikken verloren</h2>
            <Table head={['Pagina', 'Nu', 'Ervoor', 'Verschil']}>
              {report.decliningPages.map((p) => <tr key={p.page}><td><PageLink url={p.page} /></td><td>{nf(p.clicks)}</td><td>{nf(p.previousClicks)}</td><td className="gsc-down">{nf(p.change)}</td></tr>)}
            </Table>
          </section>
        )}
      </div>
      <p className="semrush-note">Bron: Google Search Console. Google houdt de cijfers ongeveer drie dagen achter; de vergelijking is met de {days} dagen daarvoor.</p>
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
  return <a href={url} target="_blank" rel="noreferrer noopener" className="semrush-url" title={url}><span>{shortUrl(url)}</span><ExternalLink size={11} /></a>;
}

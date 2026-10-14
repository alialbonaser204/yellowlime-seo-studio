import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ExternalLink, LogOut, RefreshCw, TrendingDown, TriangleAlert } from 'lucide-react';
import {
  getGetGoogleStatusQueryKey,
  getGetPartnerSearchConsoleQueryKey,
  useDisconnectGoogle,
  useGetPartnerSearchConsole,
  type SearchConsoleMetricRow,
} from '@yellowlime/api-client-react';

const GOOGLE_RESULT: Record<string, string> = {
  connected: 'Google is verbonden. Search Console-gegevens worden nu opgehaald.',
  denied: 'Je hebt geen toestemming gegeven bij Google. Er is niets verbonden.',
  missing_scope: 'Google gaf geen toegang tot Search Console. Vink bij het verbinden de Search Console-toestemming aan.',
  not_configured: 'De Google-koppeling is nog niet ingesteld: zet GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in Railway.',
  invalid_state: 'Het verbinden is verlopen. Probeer het opnieuw.',
  error: 'Verbinden met Google is mislukt. Probeer het opnieuw.',
};

const nf = new Intl.NumberFormat('nl-NL');
const pct = (value: number) => `${(value * 100).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`;
const pos = (value: number) => value.toLocaleString('nl-NL', { maximumFractionDigits: 1 });

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname) || '/';
  } catch {
    return url;
  }
}

/** Reads (and removes) the ?google= result that the OAuth callback adds to the URL. */
function useGoogleResultMessage(): string | null {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (!result) return;
    setMessage(GOOGLE_RESULT[result] ?? GOOGLE_RESULT.error);
    params.delete('google');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  return message;
}

function connectHref(): string {
  return `/api/google/connect?returnTo=${encodeURIComponent(window.location.pathname)}`;
}

function MetricTable({ rows, kind }: { rows: SearchConsoleMetricRow[]; kind: 'query' | 'page' }) {
  if (!rows.length) return <p className="text-muted-foreground" style={{ fontSize: 12, padding: '10px 2px' }}>Geen gegevens in deze periode.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'hsl(var(--muted-foreground))' }}>
            <th style={{ padding: '6px 4px', fontWeight: 600 }}>{kind === 'query' ? 'Zoekwoord' : 'Pagina'}</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Klikken</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Vertoningen</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>CTR</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Positie</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderTop: '1px solid hsl(var(--border))' }}>
              <td style={{ padding: '7px 4px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {kind === 'page' ? (
                  <a href={row.key} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {pathOf(row.key)} <ExternalLink size={10} />
                  </a>
                ) : (
                  row.key
                )}
              </td>
              <td style={{ padding: '7px 4px', textAlign: 'right' }}>{nf.format(row.clicks)}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right' }}>{nf.format(row.impressions)}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right' }}>{pct(row.ctr)}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right' }}>{pos(row.position)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tab = 'opportunities' | 'queries' | 'pages' | 'declining';
const TABS: { id: Tab; label: string; help: string }[] = [
  { id: 'opportunities', label: 'Kansen', help: 'Zoekwoorden waarvoor de website al wordt getoond, maar net buiten de top 3 staat (positie 4–20). Een artikel of update hierover levert het snelst extra bezoekers op.' },
  { id: 'queries', label: 'Top zoekwoorden', help: 'Waarmee mensen de website nu vinden.' },
  { id: 'pages', label: 'Top pagina’s', help: 'De pagina’s die de meeste bezoekers uit Google halen.' },
  { id: 'declining', label: 'Dalende pagina’s', help: 'Pagina’s die klikken verliezen ten opzichte van de periode ervoor. Kandidaten voor een update.' },
];

/** Partner page: Search Console data for the partner's website. */
export function SearchConsoleSection({ partnerId }: { partnerId: number }) {
  const queryClient = useQueryClient();
  const resultMessage = useGoogleResultMessage();
  const [days, setDays] = useState(90);
  const [tab, setTab] = useState<Tab>('opportunities');
  const params = { days };
  const { data, isLoading, isFetching, refetch } = useGetPartnerSearchConsole(partnerId, params, {
    query: { queryKey: getGetPartnerSearchConsoleQueryKey(partnerId, params), staleTime: 5 * 60_000 },
  });
  const disconnect = useDisconnectGoogle();

  const refresh = async () => {
    await fetch(`/api/partners/${partnerId}/search-console?days=${days}&refresh=1`);
    refetch();
  };
  const onDisconnect = () =>
    disconnect.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartnerSearchConsoleQueryKey(partnerId) });
      },
    });

  const status = data?.status;
  const subtitle =
    status === 'ok' && data?.period
      ? `${data.property?.replace('sc-domain:', '')} · ${data.period.startDate} t/m ${data.period.endDate} · via ${data.account}`
      : 'Hoe de website nu presteert in Google';

  return (
    <div className="card" style={{ padding: 20, marginTop: 20 }} data-testid="search-console">
      <div className="section-title">
        <div>
          <h2>Google Search Console</h2>
          <p>{subtitle}</p>
        </div>
        {status === 'ok' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[28, 90, 180].map((value) => (
              <button
                key={value}
                className={`button button-small ${days === value ? 'button-primary' : 'button-ghost'}`}
                onClick={() => setDays(value)}
                data-testid={`gsc-days-${value}`}
              >
                {value} dagen
              </button>
            ))}
            <button className="button button-ghost button-small" onClick={refresh} disabled={isFetching} title="Opnieuw ophalen">
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {resultMessage && (
        <div className="callout" style={{ marginBottom: 14 }} data-testid="google-result">
          <span>{resultMessage}</span>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground" style={{ fontSize: 12 }}>Search Console-gegevens ophalen…</p>
      ) : !data ? (
        <p className="text-muted-foreground" style={{ fontSize: 12 }}>Search Console kon niet worden geladen.</p>
      ) : status === 'ok' && data.totals ? (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="card stat-card"><span className="stat-label">Klikken</span><div className="stat-value">{nf.format(data.totals.clicks)}</div></div>
            <div className="card stat-card"><span className="stat-label">Vertoningen</span><div className="stat-value">{nf.format(data.totals.impressions)}</div></div>
            <div className="card stat-card"><span className="stat-label">Gem. CTR</span><div className="stat-value">{pct(data.totals.ctr)}</div></div>
            <div className="card stat-card"><span className="stat-label">Gem. positie</span><div className="stat-value">{pos(data.totals.position)}</div></div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {TABS.map((item) => (
              <button
                key={item.id}
                className={`button button-small ${tab === item.id ? 'button-primary' : 'button-ghost'}`}
                onClick={() => setTab(item.id)}
                data-testid={`gsc-tab-${item.id}`}
              >
                {item.id === 'declining' && <TrendingDown size={12} />}
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground" style={{ fontSize: 11, margin: '0 0 8px' }}>{TABS.find((item) => item.id === tab)?.help}</p>
          {tab === 'opportunities' && <MetricTable rows={data.opportunities} kind="query" />}
          {tab === 'queries' && <MetricTable rows={data.topQueries.slice(0, 25)} kind="query" />}
          {tab === 'pages' && <MetricTable rows={data.topPages} kind="page" />}
          {tab === 'declining' &&
            (data.decliningPages.length ? (
              <div style={{ display: 'grid' }}>
                {data.decliningPages.map((row) => (
                  <div key={row.page} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 4px', borderTop: '1px solid hsl(var(--border))', fontSize: 12 }}>
                    <a href={row.page} target="_blank" rel="noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pathOf(row.page)}</a>
                    <span style={{ whiteSpace: 'nowrap' }}>{nf.format(row.previousClicks)} → {nf.format(row.clicks)} klikken <strong style={{ color: 'hsl(0 72% 51%)' }}>({nf.format(row.change)})</strong></span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground" style={{ fontSize: 12, padding: '10px 2px' }}>Geen pagina’s die duidelijk klikken verliezen.</p>
            ))}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="button button-ghost button-small" onClick={onDisconnect} disabled={disconnect.isPending} data-testid="google-disconnect">
              <LogOut size={12} /> Google ontkoppelen
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state" style={{ padding: '26px 20px' }}>
          {status === 'error' || status === 'no_property' ? <TriangleAlert size={26} /> : <BarChart3 size={26} />}
          <h3>
            {status === 'not_configured'
              ? 'Google-koppeling nog niet ingesteld'
              : status === 'no_property'
                ? 'Geen toegang tot deze website'
                : status === 'error'
                  ? 'Search Console niet bereikbaar'
                  : 'Verbind met Google'}
          </h3>
          <p>
            {status === 'not_connected' && !data.message?.includes('verlopen')
              ? 'Verbind één keer het Google-account waarmee je Search Console bekijkt. Limey ziet dan voor elke partner welke zoekwoorden en pagina’s goed presteren.'
              : data.message}
          </p>
          {status === 'not_connected' && (
            <a className="button button-primary" href={connectHref()} data-testid="google-connect">
              Verbinden met Google
            </a>
          )}
          {status === 'no_property' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <a className="button button-ghost button-small" href={connectHref()}>Ander Google-account verbinden</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

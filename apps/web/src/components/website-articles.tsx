import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import {
  getListWebsiteArticlesQueryKey,
  useCheckTopic,
  useListWebsiteArticles,
  useScanWebsiteArticles,
  type TopicCheckResult,
} from '@yellowlime/api-client-react';

const SOURCE_LABEL: Record<string, string> = { sitemap: 'sitemap', rss: 'RSS-feed', crawl: 'blogpagina’s' };

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
}

/** Partner page: the articles that are published on the partner's own website. */
export function WebsiteArticlesSection({ partnerId }: { partnerId: number }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useListWebsiteArticles(partnerId, {
    query: {
      queryKey: getListWebsiteArticlesQueryKey(partnerId),
      refetchInterval: (query) => ((query.state.data as { scan?: { status?: string } } | undefined)?.scan?.status === 'running' ? 3000 : false),
    },
  });
  const scanMutation = useScanWebsiteArticles();
  const scan = data?.scan ?? null;
  const articles = data?.articles ?? [];
  const running = scan?.status === 'running' || scanMutation.isPending;

  const startScan = () =>
    scanMutation.mutate(
      { partnerId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWebsiteArticlesQueryKey(partnerId) }) },
    );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? articles.filter((a) => a.title.toLowerCase().includes(needle) || a.headings.some((h) => h.toLowerCase().includes(needle)))
      : articles;
    return showAll || needle ? list : list.slice(0, 15);
  }, [articles, filter, showAll]);

  const subtitle = running
    ? 'Yellowlime AI Agent leest de website…'
    : scan?.status === 'completed'
      ? `${articles.length} artikelen · laatst gescand ${formatDate(scan.finishedAt)} via ${SOURCE_LABEL[scan.source ?? ''] ?? 'de website'}`
      : articles.length
        ? `${articles.length} artikelen bekend`
        : 'Nog niet gescand';

  return (
    <div className="card" style={{ padding: 20, marginTop: 20 }} data-testid="website-articles">
      <div className="section-title">
        <div>
          <h2>Gepubliceerde artikelen op de website</h2>
          <p>{subtitle}</p>
        </div>
        <button className="button button-ghost button-small" onClick={startScan} disabled={running} data-testid="scan-website">
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Bezig met scannen…' : scan ? 'Opnieuw scannen' : 'Website scannen'}
        </button>
      </div>

      {scan?.status === 'failed' && !running && (
        <div className="callout" style={{ marginBottom: 14 }} data-testid="scan-failed">
          <TriangleAlert size={16} />
          <span>{scan.message ?? 'De website kon niet worden gescand.'}{articles.length ? ' De vorige lijst blijft bewaard.' : ''}</span>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground" style={{ fontSize: 12 }}>Laden…</p>
      ) : articles.length === 0 ? (
        <div className="empty-state" style={{ padding: '30px 20px' }}>
          {running ? <RefreshCw size={26} className="animate-spin" /> : <Globe size={26} />}
          <h3>{running ? 'Yellowlime AI Agent leest de website' : 'Nog geen artikelen bekend'}</h3>
          <p>
            {running
              ? 'Yellowlime AI Agent zoekt via de sitemap, RSS-feed of blogpagina’s naar gepubliceerde artikelen. Dit kan een paar minuten duren.'
              : 'Scan de website, zodat Yellowlime AI Agent kan voorkomen dat je over een onderwerp schrijft dat al op de website staat.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 12, color: 'hsl(var(--muted-foreground))' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Zoek in titels en tussenkoppen"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="filter-website-articles"
            />
          </div>
          <div style={{ display: 'grid' }}>
            {visible.map((article) => (
              <div key={article.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 2px', borderTop: '1px solid hsl(var(--border))' }}>
                <FileText size={15} style={{ marginTop: 2, flex: '0 0 auto', color: 'hsl(var(--muted-foreground))' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <a href={article.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    {article.title} <ExternalLink size={11} />
                  </a>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pathOf(article.url)}
                    {article.headings.length > 0 && ` · ${article.headings.slice(0, 4).join(' · ')}`}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>{formatDate(article.publishedAt)}</span>
              </div>
            ))}
          </div>
          {!filter && articles.length > 15 && (
            <button className="button button-ghost button-small" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Minder tonen' : `Alle ${articles.length} artikelen tonen`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<TopicCheckResult['verdict'], { label: string; className: string; icon: typeof CheckCircle2 }> = {
  new: { label: 'Nieuw onderwerp', className: 'status-approved', icon: CheckCircle2 },
  related: { label: 'Raakt aan bestaande artikelen', className: 'status-review', icon: TriangleAlert },
  duplicate: { label: 'Bestaat al op de website', className: 'status-rejected', icon: XCircle },
  unknown: { label: 'Niet te controleren', className: '', icon: HelpCircle },
};

/** Result of a topic check: verdict, matching articles and alternative angles. */
export function TopicCheckCard({
  result,
  partnerId,
  acknowledged,
  onAcknowledge,
  onUseAlternative,
}: {
  result: TopicCheckResult;
  partnerId: number;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onUseAlternative: (subject: string) => void;
}) {
  const style = VERDICT_STYLE[result.verdict];
  const Icon = style.icon;
  return (
    <div className="card" style={{ padding: 16, marginTop: 4, background: 'hsl(var(--background) / .55)' }} data-testid="topic-check-result" data-verdict={result.verdict}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className={`status-pill ${style.className}`}><Icon size={12} />{style.label}</span>
        {result.googleRanking && (
          <span className="status-pill status-review" data-testid="google-ranking">Google: positie {result.googleRanking.position ?? '?'}</span>
        )}
        {result.searchConsole && (
          <span className="status-pill" data-testid="search-console-checked" title={result.searchConsole.property}>Gecontroleerd met Search Console</span>
        )}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 10px' }}>{result.explanation}</p>

      {result.verdict === 'unknown' && (
        <Link className="button button-ghost button-small" href={`/partners/${partnerId}`} data-testid="link-scan-website">
          <Globe size={14} /> Naar de partnerpagina om de website te scannen
        </Link>
      )}

      {result.matches.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {result.matches.map((match) => (
            <div key={match.url} style={{ borderLeft: `3px solid ${match.relation === 'duplicate' ? 'hsl(0 84% 60%)' : 'hsl(40 90% 55%)'}`, paddingLeft: 10 }}>
              <a href={match.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                {match.title} <ExternalLink size={11} />
              </a>
              <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{match.reason}</div>
            </div>
          ))}
        </div>
      )}

      {result.alternatives.length > 0 && (
        <div style={{ marginBottom: result.verdict === 'duplicate' ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
            {result.verdict === 'new' ? 'Of kies een van deze invalshoeken:' : 'Invalshoeken die nog niet op de website staan:'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {result.alternatives.map((alternative) => (
              <button
                key={alternative}
                type="button"
                className="button button-ghost button-small"
                style={{ height: 'auto', padding: '6px 10px', textAlign: 'left', whiteSpace: 'normal' }}
                onClick={() => onUseAlternative(alternative)}
                data-testid="use-alternative"
              >
                <Sparkles size={12} /> {alternative}
              </button>
            ))}
          </div>
        </div>
      )}

      {result.verdict === 'duplicate' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} data-testid="acknowledge-duplicate" />
          Ik weet het, ik wil toch over dit onderwerp schrijven (bijvoorbeeld als bewuste update).
        </label>
      )}
    </div>
  );
}

/** State and actions for checking a topic in the new-assignment form. */
export function useTopicCheck() {
  const mutation = useCheckTopic();
  const [state, setState] = useState<{ key: string; result: TopicCheckResult } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const keyOf = (partnerId: string, subject: string) => `${partnerId}::${subject.trim().toLowerCase()}`;

  const run = (partnerId: string, subject: string, contentGoal: string) =>
    new Promise<TopicCheckResult | null>((resolve) => {
      mutation.mutate(
        { partnerId: Number(partnerId), data: { subject: subject.trim(), ...(contentGoal.trim() ? { contentGoal: contentGoal.trim() } : {}) } },
        {
          onSuccess: (result) => {
            setState({ key: keyOf(partnerId, subject), result });
            setAcknowledged(false);
            resolve(result);
          },
          onError: () => resolve(null),
        },
      );
    });

  return {
    run,
    isChecking: mutation.isPending,
    failed: mutation.isError,
    acknowledged,
    setAcknowledged,
    /** The result for exactly this partner + subject, or null when it changed since. */
    resultFor: (partnerId: string, subject: string) => (state && state.key === keyOf(partnerId, subject) ? state.result : null),
  };
}

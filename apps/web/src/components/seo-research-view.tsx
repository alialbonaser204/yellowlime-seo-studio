import { ExternalLink, HelpCircle, Search, TrendingUp } from 'lucide-react';

interface Keyword { keyword: string; searchVolume: number | null; keywordDifficulty?: number | null }
interface Question { question: string; searchVolume?: number | null }
interface Competitor { position?: number | null; domain: string; url: string }

export interface ResearchData {
  originalSubject?: string | null;
  selectedMainKeyword: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
  trend: string | null;
  secondaryKeywords?: Keyword[] | null;
  relevantQuestions?: Question[] | null;
  organicCompetitors?: Competitor[] | null;
  createdAt?: string | null;
}

const nf = (n: number) => n.toLocaleString('nl-NL');
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const INTENTS: Record<string, string> = { '0': 'Commercieel', '1': 'Informatief', '2': 'Navigatie', '3': 'Transactie' };
const INTENT_HELP: Record<string, string> = {
  Commercieel: 'mensen vergelijken opties voordat ze kiezen',
  Informatief: 'mensen zoeken uitleg of antwoord op een vraag',
  Navigatie: 'mensen zoeken een bepaalde website of bedrijf',
  Transactie: 'mensen willen iets kopen of regelen',
};

/** Semrush's own scale for keyword difficulty. */
export function difficultyLabel(kd: number): string {
  if (kd < 15) return 'Heel makkelijk';
  if (kd < 30) return 'Makkelijk';
  if (kd < 50) return 'Haalbaar';
  if (kd < 70) return 'Moeilijk';
  if (kd < 85) return 'Zwaar';
  return 'Heel zwaar';
}

export function intentLabels(raw: string | null): string[] {
  if (!raw) return [];
  const known = raw.split(',').map((c) => INTENTS[c.trim()]).filter(Boolean);
  if (known.length) return [...new Set(known)];
  // Already a word (older research): show as is.
  return raw.trim() ? [raw.trim()] : [];
}

/** Semrush gives 12 relative values for the last 12 months, ending last month. */
export function parseTrend(raw: string | null, createdAt?: string | null): { values: number[]; peakMonth: string | null } {
  const values = (raw ?? '').split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (values.length < 3) return { values: [], peakMonth: null };
  const end = createdAt ? new Date(createdAt) : new Date();
  const lastMonth = (end.getMonth() + 11) % 12; // the month before the research
  const peakIndex = values.indexOf(Math.max(...values));
  const monthOfPeak = (lastMonth - (values.length - 1 - peakIndex) + 120) % 12;
  return { values, peakMonth: MONTHS[monthOfPeak] };
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120, h = 34, max = Math.max(...values, 0.0001);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="seo-spark">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function SeoResearchView({ research }: { research: ResearchData }) {
  const intents = intentLabels(research.searchIntent);
  const trend = parseTrend(research.trend, research.createdAt);
  const keywords = [...(research.secondaryKeywords ?? [])]
    .filter((k) => k.keyword && k.keyword !== research.selectedMainKeyword)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 8);
  const questions = (research.relevantQuestions ?? []).filter((q) => q.question).slice(0, 6);
  const competitors = (research.organicCompetitors ?? []).filter((c) => c.domain).slice(0, 5);
  const subjectDiffers = research.originalSubject && research.selectedMainKeyword
    && research.originalSubject.trim().toLowerCase() !== research.selectedMainKeyword.trim().toLowerCase();

  return (
    <div className="seo-view" data-testid="research-status-success">
      <section className="seo-hero">
        <div className="eyebrow">Hoofdzoekwoord</div>
        <h2 data-testid="research-main-keyword">{research.selectedMainKeyword ?? 'Geen zoekwoord gevonden'}</h2>
        {subjectDiffers && <p className="seo-hero-note">Het artikel gaat over “{research.originalSubject}”. Dit is waar mensen in Google op zoeken.</p>}
        <div className="seo-metrics">
          <div>
            <strong>{research.searchVolume != null ? nf(research.searchVolume) : '—'}</strong>
            <span>zoekopdrachten per maand</span>
          </div>
          <div>
            <strong>{research.keywordDifficulty != null ? difficultyLabel(research.keywordDifficulty) : '—'}</strong>
            <span>{research.keywordDifficulty != null ? `moeilijkheid ${research.keywordDifficulty}/100` : 'moeilijkheid'}</span>
          </div>
          <div>
            <strong>{intents.length ? intents.join(' · ') : '—'}</strong>
            <span>{intents.length === 1 && INTENT_HELP[intents[0]] ? INTENT_HELP[intents[0]] : 'zoekintentie'}</span>
          </div>
          {trend.values.length > 0 && (
            <div className="seo-trend">
              <Sparkline values={trend.values} />
              <span>afgelopen 12 maanden{trend.peakMonth ? ` · drukst in ${trend.peakMonth}` : ''}</span>
            </div>
          )}
        </div>
      </section>

      {(keywords.length > 0 || questions.length > 0) && (
        <div className="seo-grid">
          {keywords.length > 0 && (
            <section className="seo-card">
              <h3><TrendingUp size={15} /> Verwante zoekwoorden</h3>
              <p className="seo-sub">De AI verwerkt deze waar ze passen.</p>
              <ul className="seo-keywords" data-testid="research-list-secondary">
                {keywords.map((k) => (
                  <li key={k.keyword}><span>{k.keyword}</span><small>{k.searchVolume != null ? `${nf(k.searchVolume)}/mnd` : '—'}</small></li>
                ))}
              </ul>
            </section>
          )}
          {questions.length > 0 && (
            <section className="seo-card">
              <h3><HelpCircle size={15} /> Vragen die mensen stellen</h3>
              <p className="seo-sub">Goede kandidaten voor de veelgestelde vragen.</p>
              <ul className="seo-questions" data-testid="research-list-questions">
                {questions.map((q) => <li key={q.question}>{q.question}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {competitors.length > 0 && (
        <section className="seo-card">
          <h3><Search size={15} /> Top 5 in Google</h3>
          <p className="seo-sub">Hier moet het artikel tegenop. De AI bekijkt deze pagina’s voor de opzet en de lengte.</p>
          <ol className="seo-serp" data-testid="research-list-competitors">
            {competitors.map((c, i) => (
              <li key={`${c.domain}-${i}`}>
                <span className="seo-pos">{c.position ?? i + 1}</span>
                <a href={c.url} target="_blank" rel="noreferrer noopener" title={c.url}>
                  <strong>{c.domain.replace(/^www\./, '')}</strong>
                  <small>{c.url.replace(/^https?:\/\/(www\.)?[^/]+/, '') || '/'}</small>
                </a>
                <ExternalLink size={12} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

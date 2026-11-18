import { useEffect, useState } from 'react';
import { notifyTaskDone, prepareTaskNotifications } from '../lib/task-notify';
import { ArrowLeft, Check, ChevronDown, ExternalLink, Lightbulb, PenLine, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import {
  getGetTopicThemesQueryKey,
  useGetTopicIdeas,
  useGetTopicThemes,
  type TopicIdea,
  type TopicIdeasResult,
} from '@yellowlime/api-client-react';
import { ProgressPanel, useEstimatedProgress } from './progress-panel';

/**
 * Choosing a topic: two doors. "Ik heb een onderwerp" goes to the topic field
 * (with its check); "Verras me" asks the Yellowlime AI Agent for the five
 * strongest opportunities right now, each with its reasoning, the data behind
 * it and how the score is built up.
 */

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return (error as { data?: { error?: string } } | null)?.data?.error ?? 'Yellowlime AI Agent kon geen voorstellen maken. Probeer het opnieuw.';
}

export function contentGoalFor(idea: TopicIdea): string {
  return [
    idea.angle,
    `Hoofdzoekwoord: ${idea.keyword}`,
    idea.supportingKeywords.length ? `Verwerk ook: ${idea.supportingKeywords.join(', ')}` : '',
    idea.type === 'update' && idea.updateUrl ? `Dit is een update van de bestaande pagina ${idea.updateUrl}` : '',
  ].filter(Boolean).join('\n');
}

const IDEA_STEPS = [
  { label: 'Search Console en Semrush ophalen', at: 0 },
  { label: 'Zoekwoorden scoren', at: 30 },
  { label: 'Vergelijken met de website', at: 50 },
  { label: 'Beste onderwerpen kiezen en onderbouwen', at: 65 },
  { label: 'Cijfers controleren', at: 90 },
];

function sourceList(idea: TopicIdea, extra: { profile: boolean; scan: boolean }): string {
  const names = new Set(idea.sources.map((s) => (s.startsWith('Semrush') ? 'Semrush' : s)));
  if (extra.profile) names.add('partnerprofiel');
  if (extra.scan) names.add('websitescan');
  return [...names].join(' · ');
}

function Badges({ idea }: { idea: TopicIdea }) {
  return (
    <div className="idea-badges">
      {idea.kind && <span className="idea-badge idea-kind">{idea.kind}</span>}
      <span className={`idea-badge ${idea.type === 'update' ? 'idea-update' : 'idea-new'}`}>{idea.type === 'update' ? 'Bestaande pagina bijwerken' : 'Nieuw artikel'}</span>
    </div>
  );
}

function ScoreParts({ idea }: { idea: TopicIdea }) {
  return (
    <div className="idea-score" data-testid="idea-score">
      <span className="idea-score-label">Kansscore</span>
      <div className="idea-score-total"><strong>{idea.score}</strong><span>/ 100</span></div>
      <div className="idea-parts">
        {idea.scoreParts.map((part) => (
          <div key={part.label} className="idea-part">
            <div><span>{part.label}</span><span>{part.points > 0 && part.max === 0 ? `+${part.points}` : part.max > 0 ? `${part.points} / ${part.max}` : part.points}</span></div>
            {part.max > 0 && <div className="idea-part-bar"><span style={{ width: `${Math.max(0, Math.min(100, (part.points / part.max) * 100))}%` }} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function UpdateLink({ idea }: { idea: TopicIdea }) {
  if (idea.type !== 'update' || !idea.updateUrl) return null;
  return <a className="idea-update-link" href={idea.updateUrl} target="_blank" rel="noreferrer">Bijwerken: {pathOf(idea.updateUrl)} <ExternalLink size={10} /></a>;
}

function TopIdea({ idea, sources, onChoose, onMore, busy }: { idea: TopicIdea; sources: string; onChoose: () => void; onMore: () => void; busy: boolean }) {
  return (
    <article className="idea-top" data-testid="topic-idea">
      <div className="idea-top-main">
        <Badges idea={idea} />
        <h3>{idea.title}</h3>
        <div className="idea-keyword">Hoofdzoekwoord: <strong>{idea.keyword}</strong></div>
        <UpdateLink idea={idea} />
        {idea.angle && <p className="idea-angle">{idea.angle}</p>}
        <div className="idea-why">
          <strong>Waarom de AI Agent dit kiest</strong>
          {idea.why.length ? <ol>{idea.why.map((w) => <li key={w}>{w}</li>)}</ol> : <p>Geen onderbouwing ontvangen; zie de cijfers hieronder.</p>}
        </div>
        <details className="idea-evidence">
          <summary>De cijfers ({idea.evidence.length})</summary>
          <ul data-testid="idea-evidence">{idea.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
        <span className="idea-sources">Bronnen: {sources}</span>
      </div>
      <div className="idea-top-side">
        <ScoreParts idea={idea} />
        <button type="button" className="button button-primary" onClick={onChoose} data-testid="choose-idea"><Check size={15} /> Schrijf dit</button>
        <button type="button" className="button button-ghost button-small" onClick={onMore} disabled={busy} data-testid="more-like-this"><Sparkles size={13} /> Meer zoals deze</button>
      </div>
    </article>
  );
}

function SmallIdea({ idea, onChoose, onMore, busy }: { idea: TopicIdea; onChoose: () => void; onMore: () => void; busy: boolean }) {
  return (
    <article className="idea-small" data-testid="topic-idea">
      <div className="idea-small-head"><Badges idea={idea} /><strong className="idea-small-score" title="Kansscore">{idea.score}</strong></div>
      <h3>{idea.title}</h3>
      <div className="idea-keyword">Hoofdzoekwoord: <strong>{idea.keyword}</strong></div>
      <UpdateLink idea={idea} />
      {idea.why.length > 0 && <ol className="idea-why-small">{idea.why.map((w) => <li key={w}>{w}</li>)}</ol>}
      <details className="idea-evidence">
        <summary>Cijfers en score</summary>
        <ul>{idea.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        <p className="idea-parts-inline">{idea.scoreParts.map((p) => `${p.label} ${p.points}${p.max ? `/${p.max}` : ''}`).join(' · ')}</p>
      </details>
      <div className="idea-actions">
        <button type="button" className="button button-primary button-small" onClick={onChoose} data-testid="choose-idea"><Check size={13} /> Schrijf dit</button>
        <button type="button" className="button button-ghost button-small" onClick={onMore} disabled={busy}><Sparkles size={13} /> Meer zoals deze</button>
      </div>
    </article>
  );
}

export function TopicWizard({ partnerId, onChoose, onDecide }: { partnerId: string; onChoose: (subject: string, contentGoal: string) => void; onDecide?: () => void }) {
  const id = Number(partnerId);
  const [mode, setMode] = useState<'start' | 'surprise' | 'closed'>('start');
  const [theme, setTheme] = useState('');
  const [result, setResult] = useState<TopicIdeasResult | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [chosen, setChosen] = useState<TopicIdea | null>(null);
  const [error, setError] = useState<string | null>(null);

  const themes = useGetTopicThemes(id, { query: { queryKey: getGetTopicThemesQueryKey(id), enabled: Boolean(id), staleTime: 10 * 60_000 } });
  const ideas = useGetTopicIdeas();
  const pct = useEstimatedProgress(ideas.isPending, 60_000);
  const available = themes.data?.available;

  useEffect(() => {
    setMode('start'); setTheme(''); setResult(null); setShown([]); setChosen(null); setError(null);
  }, [partnerId]);

  const fetchIdeas = (opts: { like?: string; direction?: 'specifieker' | 'breder'; fresh?: boolean } = {}) => {
    setMode('surprise');
    setError(null);
    const exclude = opts.fresh ? [] : shown;
    prepareTaskNotifications();
    ideas.mutate(
      { partnerId: id, data: { goal: 'mix', theme: theme.trim() || null, exclude, like: opts.like ?? null, direction: opts.direction ?? null } },
      {
        onSuccess: (data) => {
          notifyTaskDone({ title: 'Onderwerpen zijn klaar', body: `${data.ideas.length} voorstellen staan klaar om uit te kiezen.` });
          setResult(data);
          setShown((prev) => [...new Set([...(opts.fresh ? [] : prev), ...data.ideas.map((i) => i.keyword)])]);
        },
        onError: (e) => {
          setError(errorMessage(e));
          notifyTaskDone({ title: 'Onderwerpen zoeken is mislukt', body: errorMessage(e), ok: false });
        },
      },
    );
  };

  const choose = (idea: TopicIdea) => {
    setChosen(idea);
    setMode('closed');
    onChoose(idea.title, contentGoalFor(idea));
    onDecide?.();
  };

  const ownTopic = () => {
    setMode('closed');
    onDecide?.();
    // The fields appear after this click; wait for them to render.
    setTimeout(() => {
      const input = document.getElementById('subject') as HTMLInputElement | null;
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => input?.focus(), 250);
    }, 50);
  };

  if (!id) return null;

  if (mode === 'closed') {
    return (
      <div className="card topic-collapsed" data-testid="topic-wizard-collapsed">
        <span><Lightbulb size={14} /> {chosen ? <>Gekozen met Yellowlime AI Agent: <strong>{chosen.title}</strong></> : 'Je schrijft over een eigen onderwerp.'}</span>
        <button type="button" className="button button-ghost button-small" onClick={() => setMode(result ? 'surprise' : 'start')} data-testid="topic-wizard-open">
          <ChevronDown size={13} /> {result ? 'Terug naar de voorstellen' : 'Toch een voorstel van de AI Agent'}
        </button>
      </div>
    );
  }

  if (mode === 'start') {
    return (
      <div className="topic-doors" data-testid="topic-wizard">
        <div className="topic-door">
          <span className="topic-door-icon"><PenLine size={22} /></span>
          <h3>Ik heb een onderwerp</h3>
          <p>Je typt zelf het onderwerp in. De AI Agent controleert of het al bestaat, hoeveel er op gezocht wordt en of er een beter alternatief is.</p>
          <button type="button" className="button button-ghost" onClick={ownTopic} data-testid="door-own">Naar het onderwerp</button>
        </div>
        <div className="topic-door topic-door-dark">
          <span className="topic-door-icon"><Sparkles size={22} /></span>
          <h3>Verras me</h3>
          <p>De AI Agent zoekt in Semrush{available?.searchConsole ? ' en Search Console' : ''} naar de sterkste kansen van dit moment en stelt er vijf voor, elk met zijn redenering.</p>
          <label htmlFor="surprise-theme" className="topic-door-label">Thema (optioneel)</label>
          <input id="surprise-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder={themes.data?.themes?.[0]?.label ? `Bijvoorbeeld: ${themes.data.themes[0].label}` : 'Laat leeg voor alle thema’s'} data-testid="surprise-theme" />
          <button type="button" className="button button-primary" onClick={() => fetchIdeas({ fresh: true })} data-testid="door-surprise"><Sparkles size={15} /> Toon 5 voorstellen</button>
          {available && !available.searchConsole && <small className="topic-door-hint">Tip: koppel Search Console op de partnerpagina voor voorstellen op basis van je eigen posities in Google.</small>}
        </div>
      </div>
    );
  }

  const [top, ...rest] = result?.ideas ?? [];
  const sources = (idea: TopicIdea) => sourceList(idea, { profile: Boolean(available?.profile), scan: Boolean(available?.websiteArticles) });
  return (
    <div className="topic-surprise" data-testid="topic-wizard">
      <div className="topic-surprise-head">
        <div>
          <h3>{ideas.isPending ? 'De AI Agent zoekt de sterkste kansen' : `${result?.ideas.length ?? 0} onderwerpen die nu kansrijk zijn`}</h3>
          {result && !ideas.isPending && <p data-testid="ideas-summary">{result.candidatesConsidered} zoekwoorden bekeken{result.theme ? ` · thema: ${result.theme}` : ''}</p>}
        </div>
        <div className="topic-surprise-actions">
          <button type="button" className="button button-ghost button-small" onClick={() => setMode('start')} disabled={ideas.isPending}><ArrowLeft size={13} /> Terug</button>
          <button type="button" className="button button-ghost button-small" onClick={() => fetchIdeas({ direction: 'specifieker' })} disabled={ideas.isPending}>Specifieker</button>
          <button type="button" className="button button-ghost button-small" onClick={() => fetchIdeas({ direction: 'breder' })} disabled={ideas.isPending}>Breder</button>
          <button type="button" className="button button-ink button-small" onClick={() => fetchIdeas()} disabled={ideas.isPending} data-testid="other-ideas"><RefreshCw size={13} /> Andere 5</button>
        </div>
      </div>
      {ideas.isPending && <ProgressPanel title="Voorstellen worden gezocht" subtitle="Duurt ongeveer een minuut" steps={IDEA_STEPS} pct={pct} testId="ideas-loading" />}
      {error && !ideas.isPending && <div className="callout"><TriangleAlert size={16} /><span>{error}</span></div>}
      {result && !ideas.isPending && (
        <>
          {result.notes.map((n) => <p key={n} className="topic-note">{n}</p>)}
          {top ? (
            <>
              <TopIdea idea={top} sources={sources(top)} busy={ideas.isPending} onChoose={() => choose(top)} onMore={() => fetchIdeas({ like: `${top.title} (${top.keyword})` })} />
              {rest.length > 0 && (
                <div className="idea-grid">
                  {rest.map((idea) => <SmallIdea key={idea.keyword} idea={idea} busy={ideas.isPending} onChoose={() => choose(idea)} onMore={() => fetchIdeas({ like: `${idea.title} (${idea.keyword})` })} />)}
                </div>
              )}
              <p className="topic-note">Alle getallen komen uit Semrush en Search Console; zinnen met getallen die niet in de data staan, worden weggelaten.</p>
            </>
          ) : (
            <p className="topic-note">Geen onderwerpen gevonden. Probeer een ander thema of "Breder".</p>
          )}
        </>
      )}
    </div>
  );
}

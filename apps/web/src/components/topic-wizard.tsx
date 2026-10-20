import { useEffect, useState } from 'react';
import {
  ArrowLeft, BarChart3, CalendarClock, Check, ChevronDown, ChevronUp, ExternalLink, Lightbulb, Package,
  RefreshCw, Rocket, Sparkles, TrendingDown, TrendingUp, TriangleAlert,
} from 'lucide-react';
import {
  getGetTopicThemesQueryKey,
  useGetTopicIdeas,
  useGetTopicThemes,
  type TopicGoal,
  type TopicIdea,
  type TopicIdeasResult,
} from '@yellowlime/api-client-react';

const GOALS: Array<{ id: TopicGoal; label: string; text: string; icon: typeof Rocket; needsGsc?: boolean }> = [
  { id: 'kansen', label: 'Bijna-toppers naar de top', text: 'Zoekwoorden waarop de partner al op plek 4–20 staat. Snelste winst.', icon: TrendingUp, needsGsc: true },
  { id: 'verkeer', label: 'Meer bezoekers', text: 'Nieuwe onderwerpen met veel zoekvraag die nog niet op de website staan.', icon: Rocket },
  { id: 'opfrissen', label: 'Dalende pagina’s opfrissen', text: 'Pagina’s die klikken verliezen, bijwerken met de juiste zoekwoorden.', icon: TrendingDown, needsGsc: true },
  { id: 'product', label: 'Product of dienst promoten', text: 'Informatieve artikelen rond een product of dienst van de partner.', icon: Package },
  { id: 'seizoen', label: 'Inspelen op het seizoen', text: 'Onderwerpen waarvan de zoekvraag de komende 1–3 maanden piekt.', icon: CalendarClock },
];

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return (error as { data?: { error?: string } } | null)?.data?.error ?? 'Limey kon geen ideeën maken. Probeer het opnieuw.';
}

export function contentGoalFor(idea: TopicIdea): string {
  return [
    idea.angle,
    `Hoofdzoekwoord: ${idea.keyword}`,
    idea.supportingKeywords.length ? `Verwerk ook: ${idea.supportingKeywords.join(', ')}` : '',
    idea.type === 'update' && idea.updateUrl ? `Dit is een update van de bestaande pagina ${idea.updateUrl}` : '',
  ].filter(Boolean).join('\n');
}

function IdeaCard({ idea, onChoose, onMore, busy }: { idea: TopicIdea; onChoose: () => void; onMore: () => void; busy: boolean }) {
  return (
    <article className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="topic-idea">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`status-pill ${idea.type === 'update' ? 'status-review' : 'status-approved'}`}>
          {idea.type === 'update' ? 'Update bestaande pagina' : 'Nieuw artikel'}
        </span>
        <span className="status-pill" title="Kansscore op basis van zoekvolume, moeilijkheid en huidige positie" data-testid="idea-score">
          <BarChart3 size={11} /> Kans {idea.score}/100
        </span>
      </div>
      <h3 style={{ margin: 0, fontSize: 15, lineHeight: 1.35 }}>{idea.title}</h3>
      <div style={{ fontSize: 12 }}>
        <span className="text-muted-foreground">Hoofdzoekwoord: </span><strong>{idea.keyword}</strong>
        {idea.type === 'update' && idea.updateUrl && (
          <div style={{ marginTop: 2 }}>
            <span className="text-muted-foreground">Bijwerken: </span>
            <a href={idea.updateUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>{pathOf(idea.updateUrl)} <ExternalLink size={10} /></a>
          </div>
        )}
      </div>
      {idea.angle && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{idea.angle}</p>}
      {idea.why.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Waarom nu?</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.5, listStyle: 'disc' }}>{idea.why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <div style={{ background: 'hsl(var(--background) / .6)', border: '1px solid hsl(var(--border))', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>De cijfers</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.55, color: 'hsl(var(--muted-foreground))', listStyle: 'disc' }} data-testid="idea-evidence">
          {idea.evidence.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </div>
      {idea.supportingKeywords.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 11 }}>
          <span className="text-muted-foreground">Ook verwerken:</span>
          {idea.supportingKeywords.map((k) => <span key={k} className="status-pill" style={{ fontSize: 10 }}>{k}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        <button type="button" className="button button-primary button-small" onClick={onChoose} data-testid="choose-idea"><Check size={13} /> Kies dit onderwerp</button>
        <button type="button" className="button button-ghost button-small" onClick={onMore} disabled={busy} data-testid="more-like-this"><Sparkles size={13} /> Meer zoals deze</button>
      </div>
    </article>
  );
}

/** Step-by-step topic choice with data from Search Console and Semrush. */
export function TopicWizard({ partnerId, onChoose }: { partnerId: string; onChoose: (subject: string, contentGoal: string) => void }) {
  const id = Number(partnerId);
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [goal, setGoal] = useState<TopicGoal | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [customTheme, setCustomTheme] = useState('');
  const [result, setResult] = useState<TopicIdeasResult | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [chosen, setChosen] = useState<TopicIdea | null>(null);
  const [error, setError] = useState<string | null>(null);

  const themes = useGetTopicThemes(id, { query: { queryKey: getGetTopicThemesQueryKey(id), enabled: Boolean(id), staleTime: 10 * 60_000 } });
  const ideas = useGetTopicIdeas();
  const available = themes.data?.available;

  // Start over when another partner is selected.
  useEffect(() => {
    setStep(1); setGoal(null); setTheme(null); setCustomTheme(''); setResult(null); setShown([]); setChosen(null); setError(null); setOpen(true);
  }, [partnerId]);

  const fetchIdeas = (opts: { like?: string; direction?: 'specifieker' | 'breder'; fresh?: boolean } = {}) => {
    if (!goal) return;
    setStep(3);
    setError(null);
    // Ideas that were already shown are excluded, except when starting over.
    const exclude = opts.fresh ? [] : shown;
    ideas.mutate(
      { partnerId: id, data: { goal, theme: theme ?? null, exclude, like: opts.like ?? null, direction: opts.direction ?? null } },
      {
        onSuccess: (data) => {
          setResult(data);
          setShown((prev) => [...new Set([...(opts.fresh ? [] : prev), ...data.ideas.map((i) => i.keyword)])]);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const choose = (idea: TopicIdea) => {
    setChosen(idea);
    setOpen(false);
    onChoose(idea.title, contentGoalFor(idea));
  };

  if (!id) return null;

  if (!open) {
    return (
      <div className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'hsl(var(--primary) / .08)' }} data-testid="topic-wizard-collapsed">
        <span style={{ fontSize: 12.5 }}>
          <Lightbulb size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {chosen ? <>Gekozen met Limey: <strong>{chosen.title}</strong></> : 'Hulp nodig bij het kiezen van een onderwerp?'}
        </span>
        <button type="button" className="button button-ghost button-small" onClick={() => setOpen(true)} data-testid="topic-wizard-open">
          <ChevronDown size={13} /> {chosen ? 'Ander onderwerp kiezen' : 'Kies samen met Limey'}
        </button>
      </div>
    );
  }

  const stepLabel = (n: number, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: step === n ? 700 : 500, opacity: step >= n ? 1 : 0.5 }}>
      <span className="progress-node" style={{ width: 20, height: 20, fontSize: 10 }}>{step > n ? <Check size={10} /> : n}</span>{label}
    </span>
  );

  return (
    <div className="card" style={{ padding: 18, border: '1px solid hsl(var(--primary) / .5)' }} data-testid="topic-wizard">
      <div className="section-title" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Sparkles size={16} /> Kies samen met Limey een onderwerp</h2>
          <p>Elke suggestie is onderbouwd met cijfers uit Google Search Console en Semrush.</p>
        </div>
        <button type="button" className="button button-ghost button-small" onClick={() => setOpen(false)} data-testid="topic-wizard-close">
          <ChevronUp size={13} /> Ik weet al wat ik wil schrijven
        </button>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {stepLabel(1, 'Doel')}{stepLabel(2, 'Thema')}{stepLabel(3, 'Onderwerp')}
      </div>
      {available && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, fontSize: 11 }} data-testid="topic-sources">
          <span className={`status-pill ${available.searchConsole ? 'status-approved' : ''}`}>Search Console {available.searchConsole ? '✓' : '– niet gekoppeld'}</span>
          <span className={`status-pill ${available.semrush ? 'status-approved' : ''}`}>Semrush {available.semrush ? '✓' : '– niet ingesteld'}</span>
          <span className={`status-pill ${available.profile ? 'status-approved' : ''}`}>Partnerprofiel {available.profile ? '✓' : '– ontbreekt'}</span>
          <span className={`status-pill ${available.websiteArticles ? 'status-approved' : ''}`}>{available.websiteArticles} website-artikelen</span>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {GOALS.map((g) => {
            const blocked = g.needsGsc && available && !available.searchConsole;
            const Icon = g.icon;
            return (
              <button
                key={g.id}
                type="button"
                className="card"
                disabled={Boolean(blocked)}
                onClick={() => { setGoal(g.id); setStep(2); }}
                style={{ textAlign: 'left', padding: 14, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1, border: goal === g.id ? '1px solid hsl(var(--primary))' : undefined, background: 'hsl(var(--card))' }}
                data-testid={`goal-${g.id}`}
              >
                <Icon size={18} color="hsl(var(--primary))" />
                <div style={{ fontWeight: 600, fontSize: 13, margin: '6px 0 4px' }}>{g.label}</div>
                <div style={{ fontSize: 11.5, color: 'hsl(var(--muted-foreground))', lineHeight: 1.45 }}>{blocked ? 'Koppel eerst Google Search Console op de partnerpagina.' : g.text}</div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && goal && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>Over welk thema wil je schrijven? Thema’s komen uit het partnerprofiel en uit waar de website nu al op gevonden wordt.</p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button type="button" className={`button button-small ${theme === null && !customTheme ? 'button-primary' : 'button-ghost'}`} onClick={() => { setTheme(null); setCustomTheme(''); }} data-testid="theme-all">Alle thema’s</button>
            {themes.isLoading && <span className="text-muted-foreground" style={{ fontSize: 12 }}>Thema’s laden…</span>}
            {(themes.data?.themes ?? []).map((t) => (
              <button key={t.label} type="button" className={`button button-small ${theme === t.label ? 'button-primary' : 'button-ghost'}`} onClick={() => { setTheme(t.label); setCustomTheme(''); }} title={t.source === 'profiel' ? 'Uit het partnerprofiel' : 'Uit Search Console'} data-testid="theme-chip">
                {t.label}{t.source === 'search-console' && <BarChart3 size={11} />}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" style={{ maxWidth: 280 }} placeholder="Of typ zelf een thema" value={customTheme} onChange={(e) => { setCustomTheme(e.target.value); setTheme(e.target.value.trim() || null); }} data-testid="theme-custom" />
          </div>
          {goal === 'product' && !theme && <span style={{ fontSize: 11.5, color: 'hsl(var(--muted-foreground))' }}>Tip: kies het product of de dienst die je wilt promoten.</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="button button-ghost button-small" onClick={() => setStep(1)}><ArrowLeft size={13} /> Terug</button>
            <button type="button" className="button button-primary button-small" onClick={() => fetchIdeas({ fresh: true })} data-testid="find-ideas"><Sparkles size={13} /> Zoek onderwerpen</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {ideas.isPending && (
            <div className="empty-state" style={{ padding: '28px 18px' }} data-testid="ideas-loading">
              <RefreshCw size={24} className="animate-spin" />
              <h3>Limey zoekt de beste onderwerpen</h3>
              <p>Hij haalt zoekwoorden, posities en zoekvolumes op uit Search Console en Semrush, vergelijkt ze met de artikelen die al op de website staan en kiest de sterkste. Dit duurt ongeveer een minuut.</p>
            </div>
          )}
          {error && !ideas.isPending && (
            <div className="callout"><TriangleAlert size={16} /><span>{error}</span></div>
          )}
          {result && !ideas.isPending && (
            <>
              <div style={{ fontSize: 11.5, color: 'hsl(var(--muted-foreground))' }} data-testid="ideas-summary">
                {result.candidatesConsidered} zoekwoorden bekeken
                {result.usedSearchConsole && ' · Search Console'}
                {result.usedSemrush && ' · Semrush'}
                {result.theme && ` · thema: ${result.theme}`}
              </div>
              {result.notes.map((n) => <div key={n} className="callout" style={{ fontSize: 12 }}><TriangleAlert size={14} /><span>{n}</span></div>)}
              {result.ideas.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
                  {result.ideas.map((idea) => (
                    <IdeaCard key={idea.keyword} idea={idea} busy={ideas.isPending} onChoose={() => choose(idea)} onMore={() => fetchIdeas({ like: `${idea.title} (${idea.keyword})` })} />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12.5, margin: 0 }}>Geen onderwerpen gevonden. Kies een ander doel of thema.</p>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button-ghost button-small" onClick={() => setStep(2)} disabled={ideas.isPending}><ArrowLeft size={13} /> Ander thema</button>
            <button type="button" className="button button-ghost button-small" onClick={() => fetchIdeas()} disabled={ideas.isPending} data-testid="other-ideas"><RefreshCw size={13} /> Andere ideeën</button>
            <button type="button" className="button button-ghost button-small" onClick={() => fetchIdeas({ direction: 'specifieker' })} disabled={ideas.isPending}>Specifieker</button>
            <button type="button" className="button button-ghost button-small" onClick={() => fetchIdeas({ direction: 'breder' })} disabled={ideas.isPending}>Breder</button>
          </div>
        </div>
      )}
    </div>
  );
}

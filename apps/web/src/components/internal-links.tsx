import { useState } from 'react';
import { Check, ExternalLink, Info, Link2, LockKeyhole, RefreshCw, X } from 'lucide-react';
import { useSuggestInternalLinks, type InternalLinkSuggestion, type InternalLinksResult } from '@yellowlime/api-client-react';

/**
 * After approval: words in the article that are exactly the same as the main
 * keyword or title of an existing page on the partner's website. Each match can
 * be turned into a markdown link (the words themselves stay the same) or skipped.
 */

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Same rules as the server: a paragraph, whole words, not inside an existing link. */
export function findAnchor(content: string, anchor: string): number {
  let index = content.indexOf(anchor);
  while (index >= 0) {
    const lineStart = content.lastIndexOf('\n', index - 1) + 1;
    const before = content.slice(lineStart, index);
    const inHeading = /^\s*#/.test(content.slice(lineStart, index + 1));
    const opened = (before.match(/\[/g) ?? []).length > (before.match(/\]/g) ?? []).length;
    const inLinkTarget = /\]\([^)]*$/.test(before);
    if (!inHeading && !opened && !inLinkTarget && !isWordChar(content[index - 1]) && !isWordChar(content[index + anchor.length])) return index;
    index = content.indexOf(anchor, index + 1);
  }
  return -1;
}

export function applyInternalLink(content: string, anchor: string, url: string): string | null {
  const index = findAnchor(content, anchor);
  if (index < 0) return null;
  return `${content.slice(0, index)}[${anchor}](${url})${content.slice(index + anchor.length)}`;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return (error as { data?: { error?: string } } | null)?.data?.error ?? 'Er konden geen interne links worden voorgesteld. Probeer het opnieuw.';
}

type Decision = 'added' | 'skipped' | 'missing';

export function InternalLinksCard({ partnerId, subject, content, onApply, approved }: {
  partnerId: number | null;
  approved: boolean;
  subject: string;
  content: string;
  onApply: (next: string) => void;
}) {
  const suggest = useSuggestInternalLinks();
  const [result, setResult] = useState<InternalLinksResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  if (!approved) {
    return (
      <section className="card section-card" data-testid="internal-links">
        <div className="section-title"><div><h2 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Link2 size={16} /> Interne links</h2><p>Na de goedkeuring controleert de Yellowlime AI Agent of er woorden in het artikel staan die precies hetzelfde zijn als een bestaande pagina op de website.</p></div><span className="status-pill"><LockKeyhole size={12} /> Na goedkeuring</span></div>
      </section>
    );
  }

  if (partnerId === null) {
    return (
      <section className="card section-card" data-testid="internal-links">
        <div className="section-title"><div><h2 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Link2 size={16} /> Interne links</h2><p>Alleen beschikbaar voor partners uit de database.</p></div></div>
      </section>
    );
  }

  const run = () => {
    setDecisions({});
    suggest.mutate({ partnerId, data: { subject, content } }, { onSuccess: (data) => setResult(data) });
  };

  const add = (s: InternalLinkSuggestion) => {
    const next = applyInternalLink(content, s.anchor, s.url);
    if (next === null) { setDecisions((d) => ({ ...d, [s.url]: 'missing' })); return; }
    onApply(next);
    setDecisions((d) => ({ ...d, [s.url]: 'added' }));
  };

  const addAll = () => {
    if (!result) return;
    let next = content;
    const updates: Record<string, Decision> = {};
    for (const s of result.suggestions) {
      if (decisions[s.url] === 'added' || decisions[s.url] === 'skipped') continue;
      const applied = applyInternalLink(next, s.anchor, s.url);
      if (applied === null) { updates[s.url] = 'missing'; continue; }
      next = applied;
      updates[s.url] = 'added';
    }
    onApply(next);
    setDecisions((d) => ({ ...d, ...updates }));
  };

  const open = result?.suggestions.filter((s) => !decisions[s.url] || decisions[s.url] === 'missing').length ?? 0;
  const added = Object.values(decisions).filter((d) => d === 'added').length;

  return (
    <section className="card section-card" data-testid="internal-links">
      <div className="section-title">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Link2 size={16} /> Interne links</h2>
          <p>Woorden in het goedgekeurde artikel die precies hetzelfde zijn als het hoofdzoekwoord of de titel van een bestaande pagina. De tekst zelf verandert niet; alleen die woorden worden een link.</p>
        </div>
        <button type="button" className={`button ${result ? 'button-ghost' : 'button-primary'} button-small`} onClick={run} disabled={suggest.isPending || content.trim().length < 50} data-testid="button-suggest-links">
          {suggest.isPending ? <><RefreshCw size={13} className="animate-spin" /> Controleren…</> : result ? <><RefreshCw size={13} /> Opnieuw controleren</> : <><Link2 size={13} /> Controleer interne links</>}
        </button>
      </div>

      {suggest.isError && <div className="callout" style={{ marginTop: 6 }}><Info size={15} /><span>{errorMessage(suggest.error)}</span></div>}

      {result && !suggest.isPending && (
        <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
          <p className="text-muted-foreground" style={{ fontSize: 11, margin: 0 }}>
            {result.articlesKnown} pagina’s op de website bekend · {result.candidatesConsidered} met een bruikbaar hoofdzoekwoord vergeleken · {result.suggestions.length} exacte match{result.suggestions.length === 1 ? '' : 'es'}
            {added > 0 && <> · <strong>{added} toegevoegd</strong></>}
          </p>
          {result.message && <div className="callout"><Info size={15} /><span>{result.message}</span></div>}
          {open > 1 && <div><button type="button" className="button button-ghost button-small" onClick={addAll} data-testid="button-add-all-links"><Check size={13} /> Alle {open} toevoegen</button></div>}
          {result.suggestions.map((s) => {
            const decision = decisions[s.url];
            const done = decision === 'added' || decision === 'skipped';
            return (
              <article key={s.url} className="card" style={{ padding: 12, display: 'grid', gap: 6, opacity: done ? 0.55 : 1 }} data-testid="internal-link-suggestion">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 13 }}>
                    <span className="text-muted-foreground">Link </span><strong>“{s.anchor}”</strong>
                    <span className="text-muted-foreground"> naar </span>
                    <a href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{s.title}</a>
                    <ExternalLink size={11} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'baseline' }} />
                  </div>
                  {s.gsc && <span className="status-pill" style={{ fontSize: 10, whiteSpace: 'nowrap' }} title="Search Console, laatste 90 dagen">pos. {s.gsc.position.toLocaleString('nl-NL')} · {s.gsc.clicks} klikken</span>}
                </div>
                <div style={{ fontSize: 11 }} className="text-muted-foreground">{pathOf(s.url)}</div>
                <blockquote style={{ margin: 0, padding: '6px 10px', borderLeft: '3px solid hsl(var(--primary))', fontSize: 12, background: 'hsl(var(--muted) / .5)', borderRadius: 4 }}>
                  {s.context.split(s.anchor).map((part, i, arr) => <span key={i}>{part}{i < arr.length - 1 && <mark style={{ background: 'hsl(var(--primary) / .35)', padding: '0 2px', borderRadius: 2 }}>{s.anchor}</mark>}</span>)}
                </blockquote>
                {s.reason && <p style={{ fontSize: 12, margin: 0 }}>{s.reason}</p>}
                {decision === 'missing' && <p style={{ fontSize: 11, margin: 0, color: 'hsl(var(--destructive))' }}>Deze woorden staan niet meer (los) in de tekst. Controleer opnieuw.</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  {decision === 'added' ? <span className="status-pill status-approved"><Check size={12} /> Toegevoegd</span>
                    : decision === 'skipped' ? <span className="status-pill">Overgeslagen</span>
                    : <>
                        <button type="button" className="button button-primary button-small" onClick={() => add(s)} data-testid="button-add-link"><Check size={13} /> Toevoegen</button>
                        <button type="button" className="button button-ghost button-small" onClick={() => setDecisions((d) => ({ ...d, [s.url]: 'skipped' }))} data-testid="button-skip-link"><X size={13} /> Overslaan</button>
                      </>}
                </div>
              </article>
            );
          })}
          {result.suggestions.length > 0 && open === 0 && <p className="text-muted-foreground" style={{ fontSize: 11, margin: 0 }}>Klaar. Klik op “Menselijke bewerking opslaan” om de links te bewaren.</p>}
        </div>
      )}
    </section>
  );
}

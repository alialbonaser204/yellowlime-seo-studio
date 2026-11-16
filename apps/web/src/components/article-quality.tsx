import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, XCircle } from 'lucide-react';
import { rateArticle, type QualityInput } from '../lib/article-quality';

/**
 * Live quality score on the review page. Recalculated on every edit, so the
 * reviewer sees right away what a change does. Advice only: the reviewer
 * still decides.
 */
export function ArticleQualityCard(props: QualityInput) {
  const result = useMemo(() => rateArticle(props), [props.content, props.primaryKeyword, props.metaTitle, props.metaDescription]);
  const [open, setOpen] = useState(true);
  const tone = result.score >= 70 ? 'good' : result.score >= 55 ? 'ok' : 'bad';
  const todo = result.checks.filter((c) => c.status !== 'pass').length;
  return <section className="card section-card quality-card" data-testid="article-quality">
    <button type="button" className="quality-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`quality-score quality-${tone}`} data-testid="quality-score">{result.score}</span>
      <span className="quality-title"><b>Kwaliteitsscore · {result.grade}</b>
        <small>{todo ? `${todo} punt${todo === 1 ? '' : 'en'} om te verbeteren` : 'Alle controles in orde'} · {result.stats.words} woorden · hoofdzoekwoord "{props.primaryKeyword}"</small></span>
      <ChevronDown size={16} className={`quality-chevron ${open ? 'open' : ''}`} />
    </button>
    {open && <ul className="quality-list">
      {[...result.checks].sort((a, b) => rank(a.status) - rank(b.status)).map((c) => <li key={c.id} className={`quality-item q-${c.status}`} data-testid={`quality-${c.id}`}>
        {c.status === 'pass' ? <CheckCircle2 size={15} /> : c.status === 'warn' ? <CircleAlert size={15} /> : <XCircle size={15} />}
        <div><strong>{c.label}</strong><p>{c.detail}</p></div>
        <span className="quality-points">{c.points}/{c.max}</span>
      </li>)}
    </ul>}
    {open && <p className="quality-note">Vaste controle zonder AI: dezelfde tekst krijgt altijd dezelfde score. De score helpt bij het beoordelen; de beslissing blijft bij jou.</p>}
  </section>;
}

function rank(status: string) { return status === 'fail' ? 0 : status === 'warn' ? 1 : 2; }

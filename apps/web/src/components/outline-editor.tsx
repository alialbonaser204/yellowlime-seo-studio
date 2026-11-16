import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ArticleOutline, ArticleOutlineSection } from '@yellowlime/api-client-react';

const TYPES: Array<{ value: ArticleOutlineSection['type']; label: string }> = [
  { value: 'uitleg', label: 'Uitleg' },
  { value: 'stappenplan', label: 'Stappenplan' },
  { value: 'vergelijking', label: 'Vergelijking' },
  { value: 'lijst', label: 'Lijst' },
  { value: 'voorbeeld', label: 'Voorbeeld' },
];

/**
 * Edit Claude's proposed outline before the article is written: change
 * headings, level, type, length and angle, reorder, remove or add sections.
 */
export function OutlineEditor({ outline, onChange, onApprove, onRedo, busy }: {
  outline: ArticleOutline;
  onChange: (next: ArticleOutline) => void;
  onApprove: () => void;
  onRedo: () => void;
  busy: boolean;
}) {
  const sections = outline.sections;
  const set = (index: number, patch: Partial<ArticleOutlineSection>) =>
    onChange({ ...outline, sections: sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const move = (index: number, by: number) => {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange({ ...outline, sections: next });
  };
  const remove = (index: number) => onChange({ ...outline, sections: sections.filter((_, i) => i !== index) });
  const add = () => onChange({ ...outline, sections: [...sections, { heading: '', level: 'H2', type: 'uitleg', words: 200, angle: '', keywords: [], questions: [] }] });
  const total = sections.reduce((n, s) => n + (Number(s.words) || 0), 0);
  const valid = outline.title.trim() !== '' && sections.length > 0 && sections.every((s) => s.heading.trim() !== '');

  return <div className="outline" data-testid="outline-editor">
    <div className="field">
      <label htmlFor="outline-title">Titel (H1)</label>
      <input id="outline-title" className="input" value={outline.title} onChange={(e) => onChange({ ...outline, title: e.target.value })} data-testid="outline-title" />
    </div>
    <p className="outline-fixed">Vast in elk artikel: inleiding met direct antwoord · <b>In het kort</b> · jouw secties hieronder · <b>Veelgestelde vragen</b> · conclusie.</p>
    <ol className="outline-list">
      {sections.map((section, index) => <li key={index} className={`outline-item ${section.level === 'H3' ? 'is-h3' : ''}`} data-testid={`outline-section-${index}`}>
        <div className="outline-row">
          <select className="select outline-level" value={section.level} onChange={(e) => set(index, { level: e.target.value as ArticleOutlineSection['level'] })} aria-label="Niveau">
            <option value="H2">H2</option><option value="H3">H3</option>
          </select>
          <input className="input outline-heading" value={section.heading} placeholder="Kop van de sectie" onChange={(e) => set(index, { heading: e.target.value })} aria-label="Kop" />
          <div className="outline-buttons">
            <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Omhoog"><ArrowUp /></button>
            <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === sections.length - 1} aria-label="Omlaag"><ArrowDown /></button>
            <button type="button" className="icon-button" onClick={() => remove(index)} aria-label="Verwijderen"><Trash2 /></button>
          </div>
        </div>
        <div className="outline-row outline-meta">
          <select className="select" value={section.type} onChange={(e) => set(index, { type: e.target.value as ArticleOutlineSection['type'] })} aria-label="Soort sectie">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="outline-words"><input className="input" type="number" min={60} max={800} step={10} value={section.words} onChange={(e) => set(index, { words: Number(e.target.value) })} aria-label="Aantal woorden" /> woorden</label>
          <input className="input outline-angle" value={section.angle} placeholder="Invalshoek: wat levert deze sectie de lezer op?" onChange={(e) => set(index, { angle: e.target.value })} aria-label="Invalshoek" />
        </div>
        {(section.keywords.length > 0 || section.questions.length > 0) && <div className="outline-tags">
          {section.keywords.map((k) => <span className="tag" key={`k${k}`}>{k}</span>)}
          {section.questions.map((q) => <span className="tag outline-question" key={`q${q}`}>{q}</span>)}
        </div>}
      </li>)}
    </ol>
    <div className="outline-foot">
      <button type="button" className="button button-ghost button-small" onClick={add}><Plus size={14} />Sectie toevoegen</button>
      <span className="outline-total">{sections.length} secties · ± {total} woorden (plus inleiding, FAQ en conclusie)</span>
    </div>
    <div className="form-actions">
      <button type="button" className="button button-ghost" onClick={onRedo} disabled={busy} data-testid="outline-redo"><RefreshCw size={15} />Nieuwe opzet</button>
      <button type="button" className="button button-primary" onClick={onApprove} disabled={busy || !valid} data-testid="outline-approve"><Check size={15} />Opzet goedkeuren en artikel schrijven</button>
    </div>
  </div>;
}

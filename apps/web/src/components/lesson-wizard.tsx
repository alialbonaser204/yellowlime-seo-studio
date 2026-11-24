import { useEffect, useState } from 'react';
import { ArrowRight, Check, RefreshCw, Sparkles, X } from 'lucide-react';

interface Lesson { rule: string; explanation: string; before: string | null; after: string | null; suggestedScope: 'partner' | 'algemeen' | 'eenmalig'; reason: string }
type Scope = 'partner' | 'algemeen' | 'niet';

/**
 * After a check: the AI compares the versions, then asks per lesson whether it
 * applies to this partner only or to all partners (one lesson at a time).
 */
export function LessonWizard({ genId, partnerName, onClose }: { genId: number; partnerName: string; onClose: () => void }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<Scope[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ saved: number; total: number } | null>(null);

  const analyse = async () => {
    setError(null); setLessons(null);
    try {
      const res = await fetch(`/api/review-queue/${genId}/lessons/analyse`, { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'De AI kon de versies niet vergelijken.');
      setLessons(body.lessons ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'De AI kon de versies niet vergelijken.'); }
  };
  useEffect(() => { void analyse(); }, [genId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (scope: Scope) => {
    const next = [...choices]; next[step] = scope; setChoices(next);
    if (lessons && step + 1 < lessons.length) { setStep(step + 1); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/review-queue/${genId}/lessons`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choices: next.map((s, index) => ({ index, scope: s })).filter((c) => c.scope !== 'niet') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Opslaan mislukt.');
      setDone({ saved: body.saved ?? 0, total: body.totalForPartner ?? 0 });
    } catch (e) { setError(e instanceof Error ? e.message : 'Opslaan mislukt.'); }
    finally { setSaving(false); }
  };

  const lesson = lessons?.[step];
  return (
    <div className="lw-backdrop" role="dialog" aria-modal="true" aria-label="Wat leert de AI van jouw controle?">
      <div className="lw-modal">
        <button type="button" className="lw-close" onClick={onClose} aria-label="Sluiten"><X size={18} /></button>

        {error ? (
          <div className="lw-center">
            <p className="lw-error">{error}</p>
            <button type="button" className="button button-primary" onClick={() => (lessons ? setError(null) : void analyse())}>Opnieuw proberen</button>
          </div>
        ) : done ? (
          <div className="lw-center lw-in">
            <span className="lw-badge"><Sparkles size={26} /></span>
            <h2>De AI is weer wat slimmer</h2>
            <p>{done.saved ? `${done.saved} ${done.saved === 1 ? 'les is' : 'lessen zijn'} opgeslagen.` : 'Er is niets opgeslagen.'} Bij het volgende artikel voor {partnerName} houdt de AI hier rekening mee{done.total ? `: hij kent nu ${done.total} lessen voor deze partner` : ''}.</p>
            <p className="lw-why">Hoe meer controles, hoe minder jij hoeft te verbeteren.</p>
            <button type="button" className="button button-primary" onClick={onClose}>Klaar</button>
          </div>
        ) : !lessons ? (
          <div className="lw-center">
            <RefreshCw size={30} className="animate-spin lw-spin" />
            <h2>De AI vergelijkt de versies…</h2>
            <p>Hij legt zijn eigen tekst naast jouw verbeterde versie en zoekt uit wát je veranderde en waaróm.</p>
            <div className="lw-why-box">
              <strong>Waarom doen we dit?</strong>
              <span>Zo leert de Yellowlime AI Agent van jou. Wat jij vandaag verbetert, doet hij de volgende keer zelf goed. Elke controle maakt hem slimmer en jouw werk lichter.</span>
            </div>
          </div>
        ) : !lessons.length ? (
          <div className="lw-center lw-in">
            <span className="lw-badge"><Check size={26} /></span>
            <h2>Niets nieuws te leren</h2>
            <p>Je hebt het artikel (bijna) niet aangepast. Dat betekent dat de AI het al goed deed.</p>
            <button type="button" className="button button-primary" onClick={onClose}>Klaar</button>
          </div>
        ) : lesson && (
          <div className="lw-step" key={step}>
            <div className="lw-progress" aria-hidden="true">{lessons.map((_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
            <div className="lw-count">Les {step + 1} van {lessons.length}</div>
            {step === 0 && <p className="lw-intro">De AI heeft jouw versie vergeleken met de zijne. Hier is wat hij ervan leert. Vertel hem voor wie het geldt, dan doet hij het de volgende keer meteen goed.</p>}
            <div className="lw-card">
              <h2>{lesson.rule}</h2>
              <p className="lw-expl">{lesson.explanation}</p>
              {(lesson.before || lesson.after) && (
                <div className="lw-diff">
                  {lesson.before && <span className="lw-old">{lesson.before}</span>}
                  {lesson.before && lesson.after && <ArrowRight size={18} />}
                  {lesson.after && <span className="lw-new">{lesson.after}</span>}
                </div>
              )}
              {lesson.reason && <p className="lw-ai">De AI denkt: {lesson.suggestedScope === 'algemeen' ? 'geldt voor alle partners' : lesson.suggestedScope === 'partner' ? `geldt alleen voor ${partnerName}` : 'misschien eenmalig'}. {lesson.reason}</p>}
              <div className="lw-q">Voor wie geldt dit?</div>
              <div className="lw-choices">
                <button type="button" className={`lw-big ${lesson.suggestedScope === 'partner' ? 'suggested' : ''}`} onClick={() => choose('partner')} disabled={saving}>Alleen {partnerName}<small>Past bij de stijl of feiten van deze partner</small></button>
                <button type="button" className={`lw-big dark ${lesson.suggestedScope === 'algemeen' ? 'suggested' : ''}`} onClick={() => choose('algemeen')} disabled={saving}>Alle partners<small>Geldt voor elk artikel dat de AI schrijft</small></button>
              </div>
              <button type="button" className="lw-skip" onClick={() => choose('niet')} disabled={saving}>Overslaan, niet onthouden</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

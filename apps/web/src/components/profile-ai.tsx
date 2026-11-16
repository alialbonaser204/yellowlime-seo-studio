import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import {
  useGeneratePartnerProfileFields,
  type GeneratableProfileField,
  type GeneratedProfileField,
  type GeneratedProfileResult,
} from '@yellowlime/api-client-react';

/** Profile fields that Yellowlime AI Agent can fill in from the partner's website. */
export const AI_FIELDS: GeneratableProfileField[] = [
  'companyName', 'companyDescription', 'products', 'services', 'targetAudience',
  'toneOfVoice', 'writingStyle', 'importantFacts', 'locations',
];

const LABELS: Record<string, string> = {
  companyName: 'Bedrijfsnaam', companyDescription: 'Bedrijfsomschrijving', products: 'Producten', services: 'Diensten',
  targetAudience: 'Doelgroep', toneOfVoice: 'Tone of Voice', writingStyle: 'Schrijfstijl', importantFacts: 'Belangrijke feiten', locations: 'Locaties',
};

type Draft = Record<string, any>;
type Info = Pick<GeneratedProfileField, 'evidence' | 'confidence' | 'note'>;

function errorMessage(error: unknown): string {
  const data = (error as { data?: { error?: string } } | null)?.data;
  return data?.error ?? 'Yellowlime AI Agent kon dit niet invullen. Probeer het opnieuw.';
}

function isFilled(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0;
}

function applyResult(draft: Draft, result: GeneratedProfileResult, all: boolean): Draft {
  const next: Draft = { ...draft };
  for (const field of result.fields) {
    next[field.field] = field.field === 'companyName' || field.field === 'companyDescription' ? field.text : field.items;
    // Keep the existing company name when nothing better was found.
    if (field.field === 'companyName' && !field.text) next.companyName = draft.companyName;
  }
  const urls = new Set<string>([...(all ? [] : draft.sourceUrls ?? []), ...result.sourceUrls]);
  if (urls.size) next.sourceUrls = [...urls];
  if (all) {
    next.missingInformation = result.missingInformation;
  } else {
    // Drop the "not found" note of a field that is now filled, add one for a field that stays empty.
    const missing: string[] = [...(draft.missingInformation ?? [])];
    for (const field of result.fields) {
      const label = LABELS[field.field].toLowerCase();
      const rest = missing.filter((line) => !line.toLowerCase().startsWith(label));
      missing.splice(0, missing.length, ...rest);
      if (!isFilled(next[field.field])) missing.push(`${LABELS[field.field]}: niet op de website gevonden.`);
    }
    next.missingInformation = missing;
  }
  return next;
}

/** Where filling the whole profile is: real steps from the server, used for the percentage. */
type Phase = { step: 'pages' | 'fields' | 'retry' | 'done'; read: number; max: number; since: number };

export const PROFILE_STEPS = [
  { label: 'Website lezen', at: 0 },
  { label: 'Bedrijf, producten en diensten invullen', at: 35 },
  { label: 'Doelgroep, toon en schrijfstijl invullen', at: 58 },
  { label: 'Lege vakjes opnieuw proberen', at: 85 },
];

function phasePct(phase: Phase | null, now: number): number {
  if (!phase) return 0;
  const t = now - phase.since;
  if (phase.step === 'done') return 100;
  // Pages read is a real count; the AI step is estimated (about 45 seconds).
  if (phase.step === 'pages') return 3 + 32 * Math.min(1, phase.read / Math.max(1, phase.max));
  if (phase.step === 'fields') return 35 + 50 * (1 - Math.exp((-1.6 * t) / 45_000));
  return 85 + 10 * (1 - Math.exp((-1.6 * t) / 20_000));
}

/** Fills the whole profile, reading progress lines from the server while it works. */
async function generateAllWithProgress(partnerId: number, refresh: boolean, onPhase: (phase: Phase) => void): Promise<GeneratedProfileResult> {
  const response = await fetch(`/api/partners/${partnerId}/profile/generate?stream=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(refresh ? { refresh: true } : {}),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw { data: { error: data?.error } };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GeneratedProfileResult | null = null;
  let failure: string | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; step?: Phase['step']; read?: number; max?: number; data?: GeneratedProfileResult; error?: string };
    if (event.type === 'step' && event.step) onPhase({ step: event.step, read: event.read ?? 0, max: event.max ?? 16, since: Date.now() });
    if (event.type === 'result' && event.data) result = event.data;
    if (event.type === 'error') failure = event.error ?? null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      handle(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
    if (done) break;
  }
  handle(buffer);
  if (failure || !result) throw { data: { error: failure ?? undefined } };
  return result;
}

/** State and actions for filling the partner profile with AI, per field or all at once. */
export function useProfileAi(partnerId: number, onError: (message: string) => void) {
  const mutation = useGeneratePartnerProfileFields();
  const [busy, setBusy] = useState<'all' | GeneratableProfileField | null>(null);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [pagesUsed, setPagesUsed] = useState<GeneratedProfileResult['pagesUsed']>([]);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [now, setNow] = useState(Date.now());
  const pagesSeen = useRef(0);

  // Let the estimated part of the percentage move while the AI writes.
  useEffect(() => {
    if (busy !== 'all') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [busy]);

  const applyAll = (result: GeneratedProfileResult, setDraft: (update: (d: Draft) => Draft) => void, all: boolean) => {
    setDraft((current) => applyResult(current ?? {}, result, all));
    setInfo((prev) => {
      const next = all ? {} : { ...prev };
      for (const f of result.fields) next[f.field] = { evidence: f.evidence, confidence: f.confidence, note: f.note };
      return next;
    });
    setPagesUsed(result.pagesUsed);
  };

  const generate = (fields: GeneratableProfileField[] | 'all', setDraft: (update: (d: Draft) => Draft) => void, refresh = false) => {
    const all = fields === 'all';
    setBusy(all ? 'all' : fields[0]);
    if (all) {
      pagesSeen.current = 0;
      setPhase({ step: 'pages', read: 0, max: 16, since: Date.now() });
      generateAllWithProgress(partnerId, refresh, (next) => {
        // Page events keep the time the pages step started; other steps start their own clock.
        setPhase((prev) => (prev && prev.step === next.step && next.step === 'pages' ? { ...next, since: prev.since } : next));
      })
        .then((result) => {
          setPhase({ step: 'done', read: 0, max: 0, since: Date.now() });
          applyAll(result, setDraft, true);
        })
        .catch((error) => onError(errorMessage(error)))
        .finally(() => { setBusy(null); setTimeout(() => setPhase(null), 600); });
      return;
    }
    mutation.mutate(
      { partnerId, data: { fields, ...(refresh ? { refresh: true } : {}) } },
      {
        onSuccess: (result) => applyAll(result, setDraft, false),
        onError: (error) => onError(errorMessage(error)),
        onSettled: () => setBusy(null),
      },
    );
  };

  const progress = phase ? { pct: phasePct(phase, now), done: phase.step === 'done', pagesRead: phase.step === 'pages' ? phase.read : null } : null;
  return { generate, busy, info, pagesUsed, progress };
}

/** Small "AI" button next to a field label. */
export function AiFieldButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="button button-ghost button-small"
      style={{ minHeight: 26, padding: '0 8px', fontSize: 11 }}
      onClick={onClick}
      disabled={disabled}
      title="Laat Yellowlime AI Agent dit vakje invullen op basis van de website"
      data-testid="ai-field"
    >
      {busy ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {busy ? 'Leest website…' : 'AI'}
    </button>
  );
}

const CONFIDENCE: Record<string, { label: string; className: string }> = {
  hoog: { label: 'Zeker', className: 'status-approved' },
  middel: { label: 'Afgeleid', className: 'status-review' },
  laag: { label: 'Onzeker', className: 'status-rejected' },
};

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** Shows what an AI answer is based on: quotes from the website and how sure Yellowlime AI Agent is. */
export function AiEvidence({ info }: { info?: Info }) {
  if (!info) return null;
  const c = CONFIDENCE[info.confidence];
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'hsl(var(--muted-foreground))', display: 'grid', gap: 4 }} data-testid="ai-evidence">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`status-pill ${c.className}`} style={{ fontSize: 10 }}>{c.label}</span>
        {info.evidence.length > 0 && <span>Gebaseerd op de website:</span>}
        {info.note && <span>{info.note}</span>}
      </div>
      {info.evidence.map((e, i) => (
        <div key={i} style={{ borderLeft: '2px solid hsl(var(--primary))', paddingLeft: 8 }}>
          “{e.quote}”{' '}
          <a href={e.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {pathOf(e.url)} <ExternalLink size={9} />
          </a>
        </div>
      ))}
    </div>
  );
}

export function AiPagesUsed({ pages }: { pages: GeneratedProfileResult['pagesUsed'] }) {
  if (!pages.length) return null;
  return (
    <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: '0 0 12px' }} data-testid="ai-pages">
      Yellowlime AI Agent las {pages.length} pagina’s: {pages.map((p) => pathOf(p.url)).join(', ')}
    </p>
  );
}

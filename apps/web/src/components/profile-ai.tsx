import { useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import {
  useGeneratePartnerProfileFields,
  type GeneratableProfileField,
  type GeneratedProfileField,
  type GeneratedProfileResult,
} from '@yellowlime/api-client-react';

/** Profile fields that Limey can fill in from the partner's website. */
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
  return data?.error ?? 'Limey kon dit niet invullen. Probeer het opnieuw.';
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

/** State and actions for filling the partner profile with AI, per field or all at once. */
export function useProfileAi(partnerId: number, onError: (message: string) => void) {
  const mutation = useGeneratePartnerProfileFields();
  const [busy, setBusy] = useState<'all' | GeneratableProfileField | null>(null);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [pagesUsed, setPagesUsed] = useState<GeneratedProfileResult['pagesUsed']>([]);

  const generate = (fields: GeneratableProfileField[] | 'all', setDraft: (update: (d: Draft) => Draft) => void, refresh = false) => {
    const all = fields === 'all';
    setBusy(all ? 'all' : fields[0]);
    mutation.mutate(
      { partnerId, data: { ...(all ? {} : { fields }), ...(refresh ? { refresh: true } : {}) } },
      {
        onSuccess: (result) => {
          setDraft((current) => applyResult(current ?? {}, result, all));
          setInfo((prev) => {
            const next = all ? {} : { ...prev };
            for (const f of result.fields) next[f.field] = { evidence: f.evidence, confidence: f.confidence, note: f.note };
            return next;
          });
          setPagesUsed(result.pagesUsed);
        },
        onError: (error) => onError(errorMessage(error)),
        onSettled: () => setBusy(null),
      },
    );
  };

  return { generate, busy, info, pagesUsed };
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
      title="Laat Limey dit vakje invullen op basis van de website"
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

/** Shows what an AI answer is based on: quotes from the website and how sure Limey is. */
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
      Limey las {pages.length} pagina’s: {pages.map((p) => pathOf(p.url)).join(', ')}
    </p>
  );
}

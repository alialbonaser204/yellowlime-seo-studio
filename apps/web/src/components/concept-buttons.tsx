import { useState } from 'react';
import { Download, Eye, RefreshCw } from 'lucide-react';
import { buildConceptHtml, downloadConcept, openConcept, type ConceptData } from '../lib/concept-html';

async function loadConcept(genId: number): Promise<ConceptData> {
  const res = await fetch(`/api/article-generations/${genId}/preview`, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'De conceptpagina kon niet worden gemaakt.');
  return body as ConceptData;
}

/** "Conceptpagina" opens a separate HTML page of the article in the partner's style. */
export function ConceptButtons({ genId, onError }: { genId: number; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<'open' | 'download' | null>(null);
  const run = async (mode: 'open' | 'download') => {
    // Open the tab right away (in the click), so the browser does not block it.
    const tab = mode === 'open' ? window.open('', '_blank') : null;
    if (tab) tab.document.write('<p style="font:16px system-ui;padding:24px">Conceptpagina wordt gemaakt… dit kan even duren.</p>');
    setBusy(mode);
    try {
      const data = await loadConcept(genId);
      const html = buildConceptHtml(data);
      if (mode === 'open') { if (!openConcept(html, tab)) onError('Je browser blokkeerde het nieuwe tabblad. Sta pop-ups toe voor deze site.'); }
      else downloadConcept(html, data.title);
    } catch (error) {
      tab?.close();
      onError(error instanceof Error ? error.message : 'De conceptpagina kon niet worden gemaakt.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button type="button" className="button button-primary" onClick={() => run('open')} disabled={busy !== null} data-testid="button-concept-open" style={{ justifyContent: 'center' }}>
        {busy === 'open' ? <RefreshCw size={15} className="animate-spin" /> : <Eye size={15} />} Conceptpagina openen
      </button>
      <button type="button" className="button button-ghost" onClick={() => run('download')} disabled={busy !== null} data-testid="button-concept-download" style={{ justifyContent: 'center' }}>
        {busy === 'download' ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />} Download als HTML
      </button>
    </div>
  );
}

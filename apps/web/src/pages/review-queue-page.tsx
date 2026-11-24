import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Check, ClipboardCheck, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { articleHtml } from '../lib/concept-html';
import { ConceptButtons } from '../components/concept-buttons';

interface QueueItem {
  id: number; title: string; subject: string; versionNumber: number; partnerName: string;
  createdByName: string | null; reviewerName: string | null; generatedAt: string | null;
  status: 'wacht' | 'goedgekeurd' | 'afgekeurd' | 'vervangen'; reviewedByName: string | null; reviewedAt: string | null;
}
interface QueueArticle {
  id: number; title: string; fullArticle: string; metaTitle: string; metaDescription: string; primaryKeyword: string;
  versionNumber: number; partnerName: string; createdByName: string | null; reviewerName: string | null;
  generatedAt: string | null; reviewDecision: 'goedgekeurd' | 'afgekeurd' | null; reviewNote: string | null;
}

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Laden mislukt.');
  return body as T;
};

/** Number of AI articles that still wait for a human check (for the menu). */
export function useReviewCount(): number {
  const q = useQuery({ queryKey: ['review-count'], queryFn: () => getJson<{ waiting: number }>('/api/review-queue/count'), refetchInterval: 60_000, staleTime: 30_000 });
  return q.data?.waiting ?? 0;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS: Record<QueueItem['status'], { label: string; cls: string }> = {
  wacht: { label: 'Wacht op controle', cls: 'rq-wait' },
  goedgekeurd: { label: 'Goedgekeurd', cls: 'rq-ok' },
  afgekeurd: { label: 'Afgekeurd', cls: 'rq-no' },
  vervangen: { label: 'Oudere versie', cls: 'rq-old' },
};

export function ReviewQueuePage() {
  const [filter, setFilter] = useState<'wacht' | 'alle'>('wacht');
  const q = useQuery({ queryKey: ['review-queue'], queryFn: () => getJson<QueueItem[]>('/api/review-queue'), refetchInterval: 60_000 });
  const items = (q.data ?? []).filter((i) => filter === 'alle' || i.status === 'wacht');
  const waiting = (q.data ?? []).filter((i) => i.status === 'wacht').length;
  return (
    <>
      <div className="page-header"><div><div className="eyebrow">Menselijke controle</div><h1>Controle</h1><p>Alle artikelen die de AI heeft geschreven. Een Yellowlimer controleert elk artikel voordat het naar de partner gaat.</p></div></div>
      <div className="rq-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={filter === 'wacht'} className={filter === 'wacht' ? 'on' : ''} onClick={() => setFilter('wacht')}>Wacht op controle ({waiting})</button>
        <button type="button" role="tab" aria-selected={filter === 'alle'} className={filter === 'alle' ? 'on' : ''} onClick={() => setFilter('alle')}>Alle AI-artikelen ({q.data?.length ?? 0})</button>
      </div>
      {q.isLoading ? <div className="card empty-state"><RefreshCw size={24} className="animate-spin" /><p>Laden…</p></div>
        : q.isError ? <div className="card empty-state"><TriangleAlert size={24} /><p>{(q.error as Error).message}</p></div>
        : !items.length ? <div className="card empty-state"><ClipboardCheck size={26} /><h3>{filter === 'wacht' ? 'Niets te controleren' : 'Nog geen AI-artikelen'}</h3><p>{filter === 'wacht' ? 'Alle artikelen zijn gecontroleerd.' : 'Zodra de AI een artikel schrijft, staat het hier.'}</p></div>
        : (
          <div className="card rq-list">
            {items.map((i) => (
              <Link key={i.id} href={`/controle/${i.id}`} className="rq-row" data-testid={`review-row-${i.id}`}>
                <div className="rq-main">
                  <strong>{i.title || i.subject}</strong>
                  <span>{i.partnerName} · v{i.versionNumber} · {when(i.generatedAt)}</span>
                </div>
                <div className="rq-people">
                  <span><small>Gemaakt door</small>{i.createdByName ?? 'onbekend'}</span>
                  <span><small>Controleur</small>{i.reviewerName ?? '—'}</span>
                </div>
                <span className={`rq-status ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
              </Link>
            ))}
          </div>
        )}
    </>
  );
}

export function ReviewArticlePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['review-article', id], queryFn: () => getJson<QueueArticle>(`/api/review-queue/${id}`) });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const decide = async (decision: 'goedgekeurd' | 'afgekeurd' | null) => {
    setBusy(true); setMessage(null);
    try {
      const res = await fetch(`/api/review-queue/${id}/decision`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Opslaan mislukt.');
      await Promise.all(['review-article', 'review-queue', 'review-count'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Opslaan mislukt.'); }
    finally { setBusy(false); }
  };

  if (q.isLoading) return <div className="card empty-state"><RefreshCw size={24} className="animate-spin" /><p>Laden…</p></div>;
  if (q.isError || !q.data) return <div className="card empty-state"><TriangleAlert size={24} /><p>{(q.error as Error)?.message}</p></div>;
  const a = q.data;
  return (
    <>
      <Link href="/controle" className="button button-ghost button-small" style={{ marginBottom: 12, width: 'fit-content' }}><ArrowLeft size={14} /> Terug naar controle</Link>
      <div className="article-layout">
        <article className="card article-paper rq-article">
          <div className="rq-google"><strong>{a.metaTitle}</strong><p>{a.metaDescription}</p></div>
          {/* articleHtml escapes all text; only links with http(s) become <a>. */}
          <div className="article-body" dangerouslySetInnerHTML={{ __html: articleHtml(a.fullArticle, []) }} />
        </article>
        <aside className="side-stack">
          <div className="card rq-side">
            <div><small>Partner</small><strong>{a.partnerName}</strong></div>
            <div><small>Gemaakt door</small><strong>{a.createdByName ?? 'onbekend'}</strong></div>
            <div><small>Controleur</small><strong>{a.reviewerName ?? '—'}</strong></div>
            <div><small>Geschreven</small><strong>{when(a.generatedAt)} · v{a.versionNumber}</strong></div>
            <div><small>Hoofdzoekwoord</small><strong>{a.primaryKeyword}</strong></div>
          </div>
          <ConceptButtons genId={a.id} onError={setMessage} />
          <div className="card rq-side">
            {a.reviewDecision ? (
              <>
                <span className={`rq-status ${a.reviewDecision === 'goedgekeurd' ? 'rq-ok' : 'rq-no'}`}>{a.reviewDecision === 'goedgekeurd' ? 'Goedgekeurd' : 'Afgekeurd'}</span>
                {a.reviewNote && <p style={{ margin: 0, fontSize: 13 }}>{a.reviewNote}</p>}
                <button type="button" className="button button-ghost button-small" onClick={() => decide(null)} disabled={busy}>Beslissing terugdraaien</button>
              </>
            ) : (
              <>
                <label className="rq-note">Opmerking (optioneel)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Bijvoorbeeld wat er nog aangepast moet worden" /></label>
                <button type="button" className="button button-primary" onClick={() => decide('goedgekeurd')} disabled={busy} data-testid="button-review-approve"><Check size={15} /> Goedkeuren</button>
                <button type="button" className="button button-ghost" onClick={() => decide('afgekeurd')} disabled={busy} data-testid="button-review-reject"><X size={15} /> Afkeuren</button>
              </>
            )}
            {message && <p className="rq-error">{message}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

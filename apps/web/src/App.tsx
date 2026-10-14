import { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react';
import brandLogo from './assets/yellowlime-primary-logo.png';
import type { ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileEdit,
  FileText,
  History,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NotFound from '@/pages/not-found';
import { YellowlimersPage } from './pages/yellowlimers-page';
import { TopicCheckCard, WebsiteArticlesSection, useTopicCheck } from './components/website-articles';
import { ICONS } from './pages/yellowlimers-page';
import { UserCircle } from 'lucide-react';

const failedInlineAvatarImages = new Set<string>();

function InlineAvatar({ type, value }: { type: string, value: string }) {
  const [imageFailed, setImageFailed] = useState(() => failedInlineAvatarImages.has(value));
  if (type === 'image' && !imageFailed) return <img src={`/api/storage${value}`} alt="" onError={() => { failedInlineAvatarImages.add(value); setImageFailed(true); }} style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} />;
  return <div style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: 'hsl(var(--primary)/.2)', color: 'hsl(80 48% 28%)', borderRadius: 4 }}>{value === 'Sparkles' ? <Sparkles size={10} /> : value === 'BookOpen' ? <BookOpen size={10} /> : value === 'Users' ? <Users size={10} /> : <UserCircle size={10} />}</div>;
}
import { 
  useListPartners, 
  useCreatePartner, 
  getListPartnersQueryKey, 
  useCreateBriefing, 
  useListBriefings, 
  getListBriefingsQueryKey,
  useListYellowlimers,
  useCreateArticle,
  useListArticleReviews,
  useCreateArticleReview,
  useGetSeoResearch,
  getGetSeoResearchQueryKey,
  useRunSeoResearch,
  useGetPartnerProfile,
  getGetPartnerProfileQueryKey,
  useAnalyzePartnerWebsite,
  useGeneratePartnerProfileDraft,
  useSavePartnerProfileReview,
  useApprovePartnerProfile,
  useRejectPartnerProfile,
  useListArticleGenerations,
  getListArticleGenerationsQueryKey,
  useGenerateArticleGeneration
} from '@yellowlime/api-client-react';

type Status = 'draft' | 'brief_ready' | 'in_review' | 'approved' | 'rejected' | 'ready';
type Partner = {
  id: string; companyName: string; websiteUrl: string; description: string; products: string;
  services: string; targetAudience: string; toneOfVoice: string; writingGuidelines: string;
  useWords: string; avoidWords: string; importantFacts: string; location: string;
  wordpressUrl: string; semrushProject: string; createdAt: string; updatedAt: string;
  profileStatus?: string;
};
type SEOBriefing = {
  primaryKeyword: string; searchVolume: string; relatedKeywords: string[]; intent: string;
  competitors: string[]; recommendedStructure: string[];
};
type ArticleVersion = {
  id: string; versionNumber: number; content: string; metaTitle: string; metaDescription: string;
  authorType: 'claude' | 'human'; reason: string; createdAt: string; modelName: string; promptVersion: string;
};
type CheckType = { label: string; status: 'pass' | 'warn'; score: string; detail: string };
type AgentLog = { id: string; step: string; status: string; detail: string; createdAt: string };
type Assignment = {
  id: string; partnerId: string; reviewerId?: number; subject: string; contentGoal: string; targetAudience: string;
  pageType: string; instructions: string; status: Status; createdAt: string; updatedAt: string;
  seoBriefing?: SEOBriefing; article?: ArticleVersion; articleDbId?: number; versions: ArticleVersion[]; checks: CheckType[];
  review?: { status: 'pending' | 'approved' | 'rejected'; feedback: string; reviewedAt?: string };
  logs: AgentLog[];
  briefingDbId?: number;
  seoResearchStatus?: 'pending' | 'success' | 'failed';
};
type StudioData = { partners: Partner[]; assignments: Assignment[] };

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat('nl-NL', { month: 'short', day: 'numeric' }).format(new Date(value));
const dateTimeLabel = (value: string) => new Intl.DateTimeFormat('nl-NL', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

function getPartnerName(localPartners: Partner[], dbPartners: { id: number; companyName: string }[], partnerId: string | number) {
  const dbPartner = dbPartners.find(p => String(p.id) === String(partnerId));
  if (dbPartner) return dbPartner.companyName;
  const localPartner = localPartners.find(p => String(p.id) === String(partnerId));
  if (localPartner) return localPartner.companyName;
  return 'Onbekende partner';
}

const seedPartner: Partner = {
  id: 'partner-northstar', companyName: 'Northstar Footwear', websiteUrl: 'northstarfootwear.co',
  description: 'A Copenhagen-rooted footwear studio making everyday shoes from low-impact materials.',
  products: 'Recycled-knit trainers, algae foam sandals, vegetable-tanned leather boots',
  services: 'Direct-to-consumer footwear, repair program, fit consultations',
  targetAudience: 'Design-conscious commuters, practical travelers, and low-impact shoppers',
  toneOfVoice: 'Warm, clear, quietly optimistic. Never preachy.',
  writingGuidelines: 'Prefer concrete material details and useful care advice. Make sustainability specific.',
  useWords: 'considered, low-impact, made to last, traceable',
  avoidWords: 'eco-friendly, guilt-free, revolutionary, greenwashing',
  importantFacts: 'The studio offers free repairs for 24 months. Shoes are designed in Copenhagen and assembled in Portugal.',
  location: 'Copenhagen, Denmark', wordpressUrl: 'https://northstarfootwear.co/wp-admin',
  semrushProject: 'Northstar / Organic Growth', createdAt: '2025-01-12T10:00:00.000Z', updatedAt: now(),
};

const seedArticle = (subject: string, version = 1): ArticleVersion => ({
  id: `version-${subject.slice(0, 4)}-${version}`, versionNumber: version,
  content: `Choosing a pair of everyday shoes is a small decision with a long tail. The right pair should feel good on a Monday commute, hold up through a wet weekend, and make sense for the way it was made.\n\n## Start with the material story\n\nLook beyond a single sustainability claim. Recycled knit can reduce demand for virgin fibers, while algae-based foam gives a fast-growing material a useful second life. What matters is the full picture: where materials come from, how the shoe is assembled, and what happens when it reaches the end of its first chapter.\n\n## Match the shoe to the way you move\n\nA thoughtful choice starts with an honest inventory of your week. If you walk between meetings, prioritize a stable sole and a breathable upper. If travel is the brief, choose a pair that dries quickly and can be repaired rather than replaced.\n\n## Care is part of the purchase\n\nA few minutes of care goes a long way. Brush away surface dirt, air shoes naturally, and follow the maker's specific guidance for the upper. When a sole or stitch eventually needs attention, a repair service can keep a favorite pair in rotation.\n\nNorthstar Footwear designs everyday pairs in Copenhagen and assembles them in Portugal, with a 24-month repair promise to help each pair go further.`, 
  metaTitle: `${subject} | Northstar Footwear`, metaDescription: 'A practical guide to choosing everyday footwear with considered materials, a comfortable fit, and a longer life.',
  authorType: version === 1 ? 'claude' : 'human', reason: version === 1 ? 'Initial mock Claude generation' : 'Improvement pass', createdAt: now(),
  modelName: 'claude-3-5-sonnet (mock)', promptVersion: 'yl-seo-brief-v2',
});

const makeBrief = (subject: string): SEOBriefing => ({
  primaryKeyword: subject.toLowerCase().replace(/[?!]/g, ''),
  searchVolume: '1,900 / mo',
  relatedKeywords: ['best everyday walking shoes', 'sustainable footwear guide', 'how to choose comfortable shoes', 'shoes that last'],
  intent: 'Informational with a light commercial investigation. Readers want practical buying guidance before choosing a pair.',
  competitors: ['Good On You', 'The Good Trade', 'REI Co-op Journal'],
  recommendedStructure: ['Define the decision in plain language', 'Compare materials and construction', 'Give a use-case buying framework', 'Close with care and repair advice'],
});

const seedAssignments: Assignment[] = [
  {
    id: 'assignment-materials', partnerId: seedPartner.id, subject: 'How to choose everyday shoes that last',
    contentGoal: 'Help readers make a confident footwear decision while showing the value of durable, considered materials.',
    targetAudience: 'Design-conscious commuters comparing their next everyday pair', pageType: 'Editorial guide',
    instructions: 'Keep claims specific. Include a useful care section and do not use the phrase “eco-friendly”.',
    status: 'in_review', createdAt: '2025-02-18T09:20:00.000Z', updatedAt: '2025-02-21T14:10:00.000Z',
    seoBriefing: makeBrief('How to choose everyday shoes that last'), article: seedArticle('How to choose everyday shoes that last'),
    versions: [seedArticle('How to choose everyday shoes that last')],
    checks: [
      { label: 'Primary keyword in title', status: 'pass', score: '100', detail: 'The title aligns with the assigned primary keyword.' },
      { label: 'Reading ease', status: 'pass', score: '78', detail: 'Short paragraphs and concrete language keep the article skimmable.' },
      { label: 'Brand vocabulary', status: 'pass', score: '96', detail: 'Preferred language is present and restricted phrases are absent.' },
      { label: 'Citation opportunity', status: 'warn', score: '—', detail: 'Consider adding one source for material durability claims.' },
    ],
    review: { status: 'pending', feedback: '' },
    logs: [
      { id: 'log-1', step: 'Brief reviewed', status: 'complete', detail: 'Semrush topic and competitor signals accepted.', createdAt: '2025-02-18T09:25:00.000Z' },
      { id: 'log-2', step: 'Article generated', status: 'complete', detail: 'Mock Claude generated version 1 from the briefing.', createdAt: '2025-02-18T09:31:00.000Z' },
      { id: 'log-3', step: 'Awaiting human review', status: 'current', detail: 'The publication gate is held for a Yellowlime editor.', createdAt: '2025-02-21T14:10:00.000Z' },
    ],
  },
  {
    id: 'assignment-sandals', partnerId: seedPartner.id, subject: 'Algae foam sandals: what to know before buying',
    contentGoal: 'Turn material curiosity into clear product understanding.', targetAudience: 'Summer travelers and light-footprint shoppers',
    pageType: 'Buying guide', instructions: 'Lead with the reader question. Keep the science useful, not overly technical.',
    status: 'brief_ready', createdAt: '2025-02-20T11:00:00.000Z', updatedAt: '2025-02-20T11:18:00.000Z',
    seoBriefing: makeBrief('Algae foam sandals: what to know before buying'), versions: [], checks: [], logs: [
      { id: 'log-4', step: 'SEO briefing ready', status: 'current', detail: 'Mock Semrush data is ready for editorial review.', createdAt: '2025-02-20T11:18:00.000Z' },
    ],
  },
  {
    id: 'assignment-repair', partnerId: seedPartner.id, subject: 'When to repair your shoes instead of replacing them',
    contentGoal: 'Make Northstar’s repair promise tangible with practical signals readers can use.', targetAudience: 'Existing customers with worn everyday shoes',
    pageType: 'Advice article', instructions: '', status: 'approved', createdAt: '2025-02-16T13:40:00.000Z', updatedAt: '2025-02-19T16:20:00.000Z',
    seoBriefing: makeBrief('When to repair your shoes instead of replacing them'), article: seedArticle('When to repair your shoes instead of replacing them'),
    versions: [seedArticle('When to repair your shoes instead of replacing them')], checks: [
      { label: 'Primary keyword in title', status: 'pass', score: '100', detail: 'Title is aligned.' }, { label: 'Reading ease', status: 'pass', score: '82', detail: 'Clear and useful.' },
    ], review: { status: 'approved', feedback: 'Ready to move to publication preview.', reviewedAt: '2025-02-19T16:20:00.000Z' }, logs: [
      { id: 'log-5', step: 'Human approved', status: 'complete', detail: 'Approved by the assigned Yellowlimer after editorial review.', createdAt: '2025-02-19T16:20:00.000Z' },
    ],
  },
];

const initialData: StudioData = { partners: [seedPartner], assignments: seedAssignments };

type StudioContextValue = {
  data: StudioData; updatePartner: (partner: Partner) => void; deletePartner: (partnerId: string) => void;
  addAssignment: (assignment: Assignment) => void; updateAssignment: (assignment: Assignment) => void;
  addToast: (message: string) => void; toast: string;
};
const StudioContext = createContext<StudioContextValue | null>(null);
export const useStudio = () => {
  const context = useContext(StudioContext);
  if (!context) throw new Error('Studio context is missing');
  return context;
};
const appQueryClient = new QueryClient();

function App() {
  const [data, setData] = useState<StudioData>(() => {
    try { const saved = localStorage.getItem('yellowlime-studio'); return saved ? JSON.parse(saved) : initialData; } catch { return initialData; }
  });
  const [toast, setToast] = useState('');
  useEffect(() => { localStorage.setItem('yellowlime-studio', JSON.stringify(data)); }, [data]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3000); return () => window.clearTimeout(timer); }, [toast]);
  const value = useMemo<StudioContextValue>(() => ({
    data, toast, addToast: setToast,
    updatePartner: (partner) => setData((current) => ({ ...current, partners: current.partners.some((item) => item.id === partner.id) ? current.partners.map((item) => item.id === partner.id ? partner : item) : [...current.partners, partner] })),
    deletePartner: (partnerId) => setData((current) => ({ ...current, partners: current.partners.filter((item) => item.id !== partnerId) })),
    addAssignment: (assignment) => setData((current) => ({ ...current, assignments: [assignment, ...current.assignments] })),
    updateAssignment: (assignment) => setData((current) => ({ ...current, assignments: current.assignments.map((item) => item.id === assignment.id ? assignment : item) })),
  }), [data, toast]);
  return <QueryClientProvider client={appQueryClient}><TooltipProvider><StudioContext.Provider value={value}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedApp /></WouterRouter>{toast && <div className="toast" data-testid="toast-message">{toast}</div>}<Toaster /></StudioContext.Provider></TooltipProvider></QueryClientProvider>;
}

function RoutedApp() {
  return <Shell><ErrorBoundary resetKey={window.location.pathname}><Switch>
    <Route path="/" component={DashboardPage} />
    <Route path="/partners" component={PartnersPage} />
    <Route path="/partners/:id" component={PartnerDetailPage} />
    <Route path="/yellowlimers" component={YellowlimersPage} />
    <Route path="/assignments/new" component={NewAssignmentPage} />
    <Route path="/assignments/:id/brief" component={BriefPage} />
    <Route path="/assignments/:id/article" component={ArticlePage} />
    <Route path="/assignments/:id/review" component={ReviewPage} />
    <Route path="/history" component={HistoryPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary></Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const nav = [{ href: '/', label: 'Overzicht', icon: LayoutDashboard }, { href: '/partners', label: 'Partners', icon: Users }, { href: '/yellowlimers', label: 'Beheer Yellowlimers', icon: Users }, { href: '/history', label: 'Geschiedenis', icon: History }];
  const title = location === '/' ? 'Overzicht' : location.startsWith('/partners') ? 'Partners' : location.startsWith('/yellowlimers') ? 'Beheer Yellowlimers' : location.startsWith('/history') ? 'Geschiedenis' : location.includes('/brief') ? 'SEO-briefing' : location.includes('/article') ? 'Gegenereerd artikel' : location.includes('/review') ? 'Menselijke beoordeling' : 'Nieuwe opdracht';
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><img src={brandLogo} alt="Yellowlime SEO Studio" className="brand-logo" /></div>
      <div className="side-section eyebrow">Werkruimte</div>
      <nav className="side-nav">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`side-link ${location === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`} onClick={() => setOpen(false)}><Icon /><span>{label}</span></Link>)}</nav>
      <div className="side-section eyebrow" style={{ marginTop: 21 }}>Werkstroom</div>
      <div className="side-nav"><Link href="/assignments/new" className="side-link" data-testid="link-new-assignment"><Plus /><span>Nieuwe opdracht</span></Link></div>
    </aside>
    <div className="main"><header className="topbar"><button className="mobile-menu" onClick={() => setOpen((value) => !value)} data-testid="button-mobile-menu"><Menu size={20} /></button><div className="breadcrumb"><span>Werkruimte</span><ChevronRight size={13} /><strong>{title}</strong></div><div className="top-actions"><span className="eyebrow" style={{ color: 'hsl(var(--muted-foreground))' }}>Lokale werkruimte</span><Link href="/assignments/new" className="button button-primary button-small" data-testid="button-top-new"><Plus size={14} /><span>Nieuwe opdracht</span></Link></div></header><main className="main-content">{children}</main></div>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header fade-up"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}


function PartnerStatusBadge({ status }: { status?: string }) {
  if (!status || status === 'Nog niet opgebouwd') return <span className="status-pill" data-testid="profile-status" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}><i className="status-dot" style={{ background: 'currentColor' }} />Nog niet opgebouwd</span>;
  if (status === 'Wordt opgebouwd') return <span className="status-pill status-draft" data-testid="profile-status"><i className="status-dot" />Wordt opgebouwd</span>;
  if (status === 'Wacht op controle') return <span className="status-pill status-review" data-testid="profile-status"><i className="status-dot" />Wacht op controle</span>;
  if (status === 'Goedgekeurd') return <span className="status-pill status-approved" data-testid="profile-status"><i className="status-dot" />Goedgekeurd</span>;
  if (status === 'Afgekeurd') return <span className="status-pill status-rejected" data-testid="profile-status"><i className="status-dot" />Afgekeurd</span>;
  if (status === 'Analyse mislukt') return <span className="status-pill status-rejected" data-testid="profile-status" style={{ background: 'hsl(var(--destructive) / 0.1)', color: 'hsl(var(--destructive))' }}><i className="status-dot" style={{ background: 'currentColor' }} />Analyse mislukt</span>;
  return null;
}

function StatusPill({ status }: { status: Status }) {
  const labels: Record<Status, string> = { draft: 'Concept', brief_ready: 'Briefing klaar', in_review: 'In beoordeling', approved: 'Goedgekeurd', rejected: 'Aanpassingen nodig', ready: 'Klaar voor publicatie' };
  return <span className={`status-pill status-${status === 'brief_ready' ? 'brief' : status}`} data-testid={`status-${status}`}><i className="status-dot" />{labels[status]}</span>;
}

function SectionCard({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return <section className={`card section-card ${className}`}><div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>;
}

function getPartner(data: StudioData, partnerId: string) { return data.partners.find((partner) => partner.id === partnerId); }

function DashboardPage() {
  const { data } = useStudio();
  const { data: dbPartners = [] } = useListPartners();
  const counts = { active: data.assignments.filter((item) => ['draft', 'brief_ready', 'in_review'].includes(item.status)).length, review: data.assignments.filter((item) => item.status === 'in_review').length, approved: data.assignments.filter((item) => ['approved', 'ready'].includes(item.status)).length };
  const activities = data.assignments.flatMap((item) => item.logs.map((log) => ({ ...log, subject: item.subject }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return <><PageHeader eyebrow="Redactionele operaties / Maandag, 09:42" title="Hoi beste yellowlimer!" description="Ik ben Limey, jouw slimme schrijfhulp. Geef mij een briefing, dan help ik je stap voor stap naar een sterk SEO-artikel." action={<Link href="/assignments/new" className="button button-primary" data-testid="button-create-assignment"><Plus size={16} />Opdracht aanmaken</Link>} />
    <div className="stat-grid fade-up delay-1">
      <div className="card stat-card"><div className="eyebrow">Actieve opdrachten</div><div className="stat-value" data-testid="metric-active">{counts.active}</div><div className="stat-label">In de studiowachtrij</div></div>
      <div className="card stat-card"><div className="eyebrow">Wacht op beoordeling</div><div className="stat-value" data-testid="metric-review">{counts.review}</div><div className="stat-label">Menselijke goedkeuring vereist</div></div>
      <div className="card stat-card"><div className="eyebrow">Goedgekeurd</div><div className="stat-value" data-testid="metric-approved">{counts.approved}</div><div className="stat-label">Klaar voor publicatiepoort</div></div>
      <div className="card stat-card"><div className="eyebrow">Partners</div><div className="stat-value" data-testid="metric-partners">{dbPartners.length}</div><div className="stat-label">Opgeslagen contextprofielen</div></div>
    </div>
    <div className="dashboard-grid fade-up delay-2">
      <SectionCard title="Opdrachtenwachtrij" subtitle="Het meest recente werk in elke redactionele fase"><div className="assignment-list">{data.assignments.length ? data.assignments.map((assignment) => <Link href={`/assignments/${assignment.id}/${assignment.status === 'brief_ready' ? 'brief' : assignment.status === 'in_review' || assignment.status === 'approved' || assignment.status === 'ready' ? 'review' : 'brief'}`} className="assignment-row" key={assignment.id} data-testid={`row-assignment-${assignment.id}`}><div><p className="assignment-title">{assignment.subject}</p><span className="assignment-meta">{getPartnerName(data.partners, dbPartners, assignment.partnerId)} · bijgewerkt {dateLabel(assignment.updatedAt)}</span></div><span className="assignment-meta">{assignment.pageType}</span><StatusPill status={assignment.status} /><ChevronRight size={15} color="hsl(var(--muted-foreground))" /></Link>) : <div className="empty-state"><FileText size={25} /><h3>Wachtrij is leeg</h3><p>Maak de eerste opdracht aan om een nieuwe redactionele ronde te starten.</p><Link className="button button-primary" href="/assignments/new" data-testid="button-empty-assignment">Opdracht aanmaken</Link></div>}</div></SectionCard>
      <div className="side-stack"><SectionCard title="Snelle acties" subtitle="Houd de werkstroom in beweging"><div className="quick-grid"><Link href="/assignments/new" className="quick-action" data-testid="quick-new-assignment"><div><Plus /><span>Start een opdracht<small>Maak een briefing voor een nieuw partnerverhaal</small></span></div><ArrowRight /></Link><Link href="/partners" className="quick-action" data-testid="quick-partners"><div><Users /><span>Beheer partners<small>Bekijk merkcontext</small></span></div><ArrowRight /></Link><Link href="/history" className="quick-action" data-testid="quick-history"><div><History /><span>Open activiteitengeschiedenis<small>Volg elke stap van de agent</small></span></div><ArrowRight /></Link></div></SectionCard>
        <SectionCard title="Recente activiteit" subtitle="Een korte operationele puls"><div className="activity-list">{activities.map((item) => <div className="activity-item" key={item.id}><div className="activity-marker" /><div><p><strong>{item.step}</strong> · {item.subject}</p><time>{dateTimeLabel(item.createdAt)}</time></div></div>)}</div></SectionCard></div>
    </div>
  </>;
}

function PartnerModal({ onClose }: { onClose: () => void }) {
  const { addToast } = useStudio();
  const queryClient = useQueryClient();
  const createPartner = useCreatePartner();
  
  const [form, setForm] = useState({ companyName: '', websiteUrl: '' });
  const [errors, setErrors] = useState({ companyName: '', websiteUrl: '' });

  const validateUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const newErrors = { companyName: '', websiteUrl: '' };
    let isValid = true;
    
    if (!form.companyName.trim()) { newErrors.companyName = 'Partnernaam is verplicht.'; isValid = false; }
    if (!form.websiteUrl.trim()) { newErrors.websiteUrl = 'Website URL is verplicht.'; isValid = false; } 
    else if (!validateUrl(form.websiteUrl)) { newErrors.websiteUrl = 'Voer een geldige absolute URL in (bijv. https://voorbeeld.nl).'; isValid = false; }
    
    setErrors(newErrors);
    if (!isValid) return;

    createPartner.mutate({ data: { companyName: form.companyName, websiteUrl: form.websiteUrl } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        addToast('Partner is succesvol toegevoegd.');
        onClose();
      },
      onError: () => {
        addToast('Er is een fout opgetreden bij het toevoegen van de partner.');
      }
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form className="modal" onSubmit={submit} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Partner context</div>
            <h2>Partner toevoegen</h2>
            <p>Deze context blijft gescheiden van de artikelwerkstroom en informeert elke briefing.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-partner-modal"><X /></button>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="field full">
            <label htmlFor="companyName">Partnernaam <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <input id="companyName" className="input" value={form.companyName} placeholder="Bijv. Northstar Footwear" onChange={(event) => setForm(current => ({ ...current, companyName: event.target.value }))} data-testid="input-partner-companyName" />
            {errors.companyName && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-partner-companyName">{errors.companyName}</span>}
          </div>
          <div className="field full">
            <label htmlFor="websiteUrl">Website URL <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <input id="websiteUrl" className="input" value={form.websiteUrl} placeholder="https://northstarfootwear.co" onChange={(event) => setForm(current => ({ ...current, websiteUrl: event.target.value }))} data-testid="input-partner-websiteUrl" />
            {errors.websiteUrl && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-partner-websiteUrl">{errors.websiteUrl}</span>}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-partner">Annuleren</button>
          <button type="submit" className="button button-primary" data-testid="button-save-partner" disabled={createPartner.isPending}>
            {createPartner.isPending ? 'Bezig met toevoegen...' : <><Check size={15} /> Partner toevoegen</>}
          </button>
        </div>
      </form>
    </div>
  );
}


function PartnersPage() {
  const { data: dbPartners = [], isLoading, isError } = useListPartners();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  
  const partners = dbPartners.filter((partner) => partner.companyName.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader eyebrow="Contextbibliotheek" title="Partners" description="Houd de feiten, taal en richtlijnen van elk merk zichtbaar — en gescheiden — voordat enige AI-stap begint." action={<button className="button button-primary" onClick={() => setAdding(true)} data-testid="button-add-partner"><Plus size={16} />Partner toevoegen</button>} />
      
      <div className="card" style={{ padding: '11px 13px', marginBottom: 17, display: 'flex', alignItems: 'center', gap: 9, maxWidth: 420 }}>
        <Search size={15} color="hsl(var(--muted-foreground))" />
        <input className="input" style={{ border: 0, padding: 0, background: 'transparent' }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek partnerprofielen" data-testid="input-search-partners" />
      </div>
      
      {isLoading ? (
        <div className="empty-state card">
          <RefreshCw size={28} className="animate-spin" />
          <h3>Partners laden...</h3>
        </div>
      ) : isError ? (
        <div className="empty-state card">
          <TriangleAlert size={28} color="hsl(var(--destructive))" />
          <h3>Fout bij laden</h3>
          <p>Kan partners niet ophalen.</p>
        </div>
      ) : partners.length ? (
        <div className="partner-grid">
          {partners.map((partner) => (
            <Link href={`/partners/${partner.id}`} className="card partner-card block" key={partner.id} data-testid={`card-partner-${partner.id}`} style={{ display: 'flex', flexDirection: 'column', color: 'inherit', textDecoration: 'none' }}>
              <div className="partner-top">
                <div className="partner-symbol">{partner.companyName.slice(0, 1).toUpperCase() || 'P'}</div>
                <PartnerStatusBadge status={partner.profileStatus} />
              </div>
              <h3>{partner.companyName || 'Naamloze partner'}</h3>
              <div className="card-foot" style={{ marginTop: 'auto', paddingTop: 17, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid hsl(var(--border))' }}>
                <span className="link-muted" style={{ wordBreak: 'break-all' }}>{partner.websiteUrl || 'Geen URL'}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state card">
          <Users size={28} />
          <h3>Geen partnerprofielen</h3>
          <p>Partnercontext is de eerste bron van waarheid. Voeg een profiel toe voordat je een inhoudsopdracht aanmaakt.</p>
          <button className="button button-primary" onClick={() => setAdding(true)} data-testid="button-empty-partner">Partner toevoegen</button>
        </div>
      )}
      
      {adding && <PartnerModal onClose={() => setAdding(false)} />}
    </>
  );
}



const PROFILE_FIELDS = [
  { key: 'companyName', label: 'Bedrijfsnaam', type: 'text' },
  { key: 'companyDescription', label: 'Bedrijfsomschrijving', type: 'textarea' },
  { key: 'products', label: 'Producten', type: 'array' },
  { key: 'services', label: 'Diensten', type: 'array' },
  { key: 'targetAudience', label: 'Doelgroep', type: 'textarea' },
  { key: 'toneOfVoice', label: 'Tone of Voice', type: 'textarea' },
  { key: 'writingStyle', label: 'Schrijfstijl', type: 'textarea' },
  { key: 'importantFacts', label: 'Belangrijke feiten', type: 'array' },
  { key: 'locations', label: 'Locaties', type: 'array' },
  { key: 'sourceUrls', label: 'Bron URL\'s', type: 'array' },
  { key: 'missingInformation', label: 'Ontbrekende informatie', type: 'array' },
];

const getFieldValue = (obj: any, key: string, type: string) => {
  if (!obj || !obj[key]) return '';
  if (type === 'array' && Array.isArray(obj[key])) return obj[key].join('\n');
  return obj[key] || '';
};

function PartnerDetailPage() {
  const { id } = useParams();
  const { data: partners = [] } = useListPartners();
  const partner = partners.find(p => String(p.id) === String(id));
  const queryClient = useQueryClient();
  const { addToast } = useStudio();
  const [_, setLocation] = useLocation();

  const isBuilding = partner?.profileStatus === 'Wordt opgebouwd';

  const { data: profile, isLoading, error } = useGetPartnerProfile(Number(id), {
    query: {
      enabled: !!id,
      queryKey: getGetPartnerProfileQueryKey(Number(id)),
      refetchInterval: (query) => {
        const queryData = query.state.data as any;
        return (partner?.profileStatus === 'Wordt opgebouwd' || queryData?.profileStatus === 'Wordt opgebouwd') ? 2000 : false;
      }
    }
  });

  const analyzeMutation = useAnalyzePartnerWebsite();
  const generateDraftMutation = useGeneratePartnerProfileDraft();
  const saveMutation = useSavePartnerProfileReview();
  const approveMutation = useApprovePartnerProfile();
  const rejectMutation = useRejectPartnerProfile();
  
  const { data: yellowlimers = [] } = useListYellowlimers();
  const [reviewerId, setReviewerId] = useState<string>('');
  const [draft, setDraft] = useState<any>(null);
  const initializedFor = useRef<number | null>(null);

  useEffect(() => {
    if (profile && initializedFor.current !== Number(id) && !isBuilding) {
      const source = profile.reviewProfile || profile.approvedProfile || profile.claudeProfile;
      if (source) {
        setDraft(source);
        initializedFor.current = Number(id);
      }
    }
  }, [profile, id, isBuilding]);

  useEffect(() => {
    if (profile && profile.profileStatus !== 'Wordt opgebouwd') {
      queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
    }
  }, [profile?.profileStatus, queryClient]);

  const handleDraftChange = (key: string, type: string, value: string) => {
    setDraft((prev: any) => {
      if (!prev) return prev;
      return { ...prev, [key]: type === 'array' ? value.split('\n').filter(Boolean) : value };
    });
  };

  const handleAnalyze = () => {
    analyzeMutation.mutate({ partnerId: Number(id) }, {
      onSuccess: () => {
        addToast('Website analyse gestart...');
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey(Number(id)) });
      }
    });
  };

  const handleReanalyze = () => {
    if (window.confirm("Weet je zeker dat je de website opnieuw wilt analyseren? Dit kost Claude credits.")) {
      initializedFor.current = null;
      handleAnalyze();
    }
  };

  const handleGenerateDraft = () => {
    generateDraftMutation.mutate({ partnerId: Number(id) }, {
      onSuccess: () => {
        initializedFor.current = null;
        addToast('Sonnet maakt een veilig profielconcept.');
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey(Number(id)) });
      },
      onError: () => addToast('Het AI-concept kon niet worden gestart.'),
    });
  };

  const handleSave = () => {
    if (!draft) return;
    saveMutation.mutate({ partnerId: Number(id), data: { profile: draft, reviewerId: Number(reviewerId) } }, {
      onSuccess: () => {
        addToast('Wijzigingen opgeslagen.');
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey(Number(id)) });
      }
    });
  };

  const handleApprove = () => {
    if (!draft || !reviewerId) { addToast('Selecteer een reviewer voordat je goedkeurt.'); return; }
    approveMutation.mutate({ partnerId: Number(id), data: { profile: draft, reviewerId: Number(reviewerId) } }, {
      onSuccess: () => {
        addToast('Profiel goedgekeurd.');
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey(Number(id)) });
      }
    });
  };

  const handleReject = () => {
    if (!draft || !reviewerId) { addToast('Selecteer een reviewer voordat je afkeurt.'); return; }
    rejectMutation.mutate({ partnerId: Number(id), data: { profile: draft, reviewerId: Number(reviewerId) } }, {
      onSuccess: () => {
        addToast('Profiel afgekeurd.');
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey(Number(id)) });
      }
    });
  };

  if (!partner) return <div className="main-content"><div className="empty-state card"><h3>Partner niet gevonden</h3><button onClick={() => setLocation('/partners')} className="button button-primary">Terug naar partners</button></div></div>;

  const showDraft = ['Wacht op controle', 'Afgekeurd'].includes(partner.profileStatus || '');
  const showApproved = partner.profileStatus === 'Goedgekeurd';
  const showContent = (showDraft || showApproved || partner.profileStatus === 'Afgekeurd' || partner.profileStatus === 'Wacht op controle' || (profile && profile.claudeProfile));

  return (
    <>
      <PageHeader 
        eyebrow="Partner Profiel" 
        title={partner.companyName} 
        description={partner.websiteUrl} 
        action={
          <div className="flex items-center gap-3">
            <PartnerStatusBadge status={partner.profileStatus} />
            {partner.profileStatus === 'Goedgekeurd' && (
              <button className="button button-ghost" onClick={handleReanalyze} data-testid="reanalyze">Website opnieuw analyseren</button>
            )}
            {partner.profileStatus === 'Afgekeurd' && (
              <button className="button button-ghost" onClick={handleReanalyze} data-testid="reanalyze">Website opnieuw analyseren</button>
            )}
          </div>
        } 
      />

      <div className="fade-up">
        {isBuilding && (
          <div className="empty-state card" data-testid="profile-loading" style={{ margin: '40px 0' }}>
            <RefreshCw size={28} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} />
            <h3 style={{ marginTop: 15 }}>Limey onderzoekt de website van deze partner.</h3>
            <p>Dit kan even duren. De status wordt automatisch bijgewerkt.</p>
          </div>
        )}

        {partner.profileStatus === 'Analyse mislukt' && (
          <div className="empty-state card" style={{ margin: '40px 0' }}>
            <TriangleAlert size={28} color="hsl(var(--destructive))" />
            <h3 style={{ color: 'hsl(var(--destructive))', marginTop: 15 }}>Analyse mislukt</h3>
            <p>{profile?.failureMessage || (error ? "Er is een fout opgetreden bij de API." : "De website-analyse is mislukt.")}</p>
            <button className="button button-danger" onClick={handleReanalyze} data-testid="reanalyze">Website opnieuw analyseren</button>
          </div>
        )}

        {(partner.profileStatus === 'Nog niet opgebouwd' || !partner.profileStatus) && !isBuilding && (
          <div className="empty-state card" style={{ margin: '40px 0' }}>
            <Search size={28} color="hsl(var(--muted-foreground))" />
            <h3 style={{ marginTop: 15 }}>Geen profiel gevonden</h3>
            <p>Start de analyse om een AI-gegenereerd profiel voor deze partner te maken.</p>
            <button className="button button-primary" onClick={handleAnalyze} data-testid="build-profile">Partnerprofiel opbouwen</button>
          </div>
        )}

        {showContent && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {profile?.failureMessage && showDraft && (
              <div className="callout" style={{ gridColumn: '1 / -1' }} data-testid="profile-manual-fallback">
                <TriangleAlert size={16} />
                <span>{profile.failureMessage}</span>
              </div>
            )}
            <div className="card form-card" style={{ maxWidth: '100%', padding: 20 }} data-testid="claude-profile">
              <div className="section-title">
                <h2>{profile?.claudeProfile ? 'Door Claude gemaakt profiel' : 'Automatische analyse niet beschikbaar'}</h2>
                <p>{profile?.claudeProfile ? 'Oorspronkelijke output (alleen-lezen)' : 'Vul het profiel handmatig aan in het formulier hiernaast'}</p>
              </div>
              <div style={{ display: 'grid', gap: 14 }}>
                {PROFILE_FIELDS.map(field => (
                  <div key={`claude-${field.key}`} className="field full">
                    <label>{field.label}</label>
                    <div style={{ fontSize: 13, background: 'hsl(var(--background) / 0.5)', padding: '10px 11px', borderRadius: 7, border: '1px solid hsl(var(--border))', minHeight: field.type === 'textarea' || field.type === 'array' ? 80 : 38, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {profile?.claudeProfile ? getFieldValue(profile.claudeProfile, field.key, field.type) || <span className="text-muted-foreground">Geen gegevens</span> : 'Geen gegevens'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card form-card" style={{ maxWidth: '100%', padding: 20, position: 'relative' }} data-testid="profile-form">
              <div className="section-title">
                <div>
                  <h2>{showApproved ? "Door medewerker goedgekeurd profiel" : "Review & Bewerken"}</h2>
                  <p>{showApproved ? "Huidige goedgekeurde versie" : "Beoordeel en pas aan"}</p>
                </div>
                {!showApproved && (
                  <button
                    className="button button-ghost button-small"
                    onClick={handleGenerateDraft}
                    disabled={generateDraftMutation.isPending || isBuilding}
                    data-testid="generate-profile-draft"
                  >
                    <Sparkles size={14} />
                    {generateDraftMutation.isPending || isBuilding ? 'Sonnet werkt...' : 'Met Sonnet invullen'}
                  </button>
                )}
              </div>
              
              {!showApproved && (
                <div className="field full" style={{ marginBottom: 16 }}>
                  <label>Gecontroleerd door <span className="text-destructive">verplicht voor goedkeuren/afkeuren</span></label>
                  <Select value={reviewerId} onValueChange={setReviewerId}>
                    <SelectTrigger><SelectValue placeholder="Kies medewerker" /></SelectTrigger>
                    <SelectContent>
                      {yellowlimers.map(y => (
                        <SelectItem key={y.id} value={String(y.id)}>{y.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div style={{ display: 'grid', gap: 14 }}>
                {PROFILE_FIELDS.map(field => (
                  <div key={`draft-${field.key}`} className="field full">
                    <label>{field.label}</label>
                    {showApproved ? (
                       <div data-testid="approved-profile" style={{ fontSize: 13, background: 'hsl(var(--background) / 0.5)', padding: '10px 11px', borderRadius: 7, border: '1px solid hsl(var(--border))', minHeight: field.type === 'textarea' || field.type === 'array' ? 80 : 38, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                         {profile?.approvedProfile ? getFieldValue(profile.approvedProfile, field.key, field.type) || <span className="text-muted-foreground">Geen gegevens</span> : 'Geen gegevens'}
                       </div>
                    ) : (
                      field.type === 'textarea' || field.type === 'array' ? (
                        <textarea 
                          className="textarea" 
                          value={draft ? getFieldValue(draft, field.key, field.type) : ''} 
                          onChange={e => handleDraftChange(field.key, field.type, e.target.value)} 
                        />
                      ) : (
                        <input 
                          className="input" 
                          value={draft ? getFieldValue(draft, field.key, field.type) : ''} 
                          onChange={e => handleDraftChange(field.key, field.type, e.target.value)} 
                        />
                      )
                    )}
                  </div>
                ))}
              </div>

              {!showApproved && draft && (
                <div className="form-actions" style={{ position: 'sticky', bottom: -20, background: 'hsl(var(--card))', padding: '15px 20px', borderTop: '1px solid hsl(var(--border))', margin: '20px -20px -20px', borderRadius: '0 0 11px 11px', zIndex: 5 }}>
                  <button className="button button-ghost" onClick={handleSave} disabled={!reviewerId || saveMutation.isPending}>Wijzigingen opslaan</button>
                  <button className="button button-danger" onClick={handleReject} disabled={!reviewerId || rejectMutation.isPending} data-testid="reject">Profiel afkeuren</button>
                  <button className="button button-primary" onClick={handleApprove} disabled={!reviewerId || approveMutation.isPending} data-testid="approve"><Check size={16} /> Profiel goedkeuren</button>
                </div>
              )}
            </div>
          </div>
        )}
        <WebsiteArticlesSection partnerId={Number(id)} />
      </div>
    </>
  );
}


function NewAssignmentPage() {
  const { addAssignment, addToast } = useStudio();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createBriefing = useCreateBriefing();
  const { data: dbPartners = [], isLoading, isError } = useListPartners();
  const { data: yellowlimers = [], isLoading: isLoadingYellowlimers } = useListYellowlimers();
  const activeYellowlimers = yellowlimers.filter(y => y.active);
  
  const [form, setForm] = useState({ partnerId: '', reviewerId: '', subject: '', contentGoal: '' });
  const [errors, setErrors] = useState({ partnerId: '', reviewerId: '', subject: '', contentGoal: '' });

  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const topicCheck = useTopicCheck();
  const topicResult = form.partnerId && form.subject.trim().length >= 3 ? topicCheck.resultFor(form.partnerId, form.subject) : null;
  const runTopicCheck = () => topicCheck.run(form.partnerId, form.subject, form.contentGoal);
  
  useEffect(() => {
    if (dbPartners.length > 0 && !form.partnerId) {
      setForm(f => ({ ...f, partnerId: String(dbPartners[0].id) }));
    }
    if (activeYellowlimers.length > 0 && !form.reviewerId) {
      setForm(f => ({ ...f, reviewerId: String(activeYellowlimers[0].id) }));
    }
  }, [dbPartners, activeYellowlimers, form.partnerId, form.reviewerId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const newErrors = { partnerId: '', reviewerId: '', subject: '', contentGoal: '' };
    let isValid = true;
    
    if (!form.partnerId) { newErrors.partnerId = 'Partner is verplicht.'; isValid = false; }
    if (!form.reviewerId) { newErrors.reviewerId = 'Controleur is verplicht.'; isValid = false; }
    if (!form.subject.trim()) { newErrors.subject = 'Onderwerp van het artikel is verplicht.'; isValid = false; }
    if (!form.contentGoal.trim()) { newErrors.contentGoal = 'Contentdoel is verplicht.'; isValid = false; }
    
    setErrors(newErrors);
    if (!isValid) return;

    // Check the topic against the partner's published articles first.
    let check = topicResult;
    if (!check && form.subject.trim().length >= 3) {
      check = await runTopicCheck();
      if (check && (check.verdict === 'related' || check.verdict === 'duplicate')) {
        addToast('Limey vond overlap met bestaande artikelen. Bekijk het resultaat en klik opnieuw om door te gaan.');
        return;
      }
    }
    if (check?.verdict === 'duplicate' && !topicCheck.acknowledged) {
      setErrors((current) => ({ ...current, subject: 'Dit onderwerp staat al op de website. Kies een andere invalshoek of bevestig dat je toch wilt doorgaan.' }));
      return;
    }

    createBriefing.mutate({
      data: {
        partnerId: Number(form.partnerId),
        reviewerId: Number(form.reviewerId),
        subject: form.subject,
        contentGoal: form.contentGoal
      }
    }, {
      onSuccess: (briefing) => {
        const assignment: Assignment = {
          id: `assignment-${briefing.id}`, 
          partnerId: String(briefing.partnerId),
          reviewerId: Number(form.reviewerId),
          subject: briefing.subject,
          contentGoal: briefing.contentGoal,
          targetAudience: '',
          pageType: 'Artikel',
          instructions: '',
          status: 'draft',
          createdAt: now(),
          updatedAt: now(),
          versions: [],
          checks: [],
          logs: [
            { id: `log-s-${Date.now()}`, step: 'SEO onderzoek bezig', status: 'current', detail: 'De SEO agent zoekt naar zoekwoorden en concurrenten.', createdAt: now() },
            { id: id('log'), step: 'Briefing aangemaakt', status: 'complete', detail: 'De lokale context is ingesteld.', createdAt: now() }
          ],
          briefingDbId: briefing.id,
          seoResearchStatus: 'pending'
        };
        addAssignment(assignment);
        queryClient.invalidateQueries({ queryKey: getListBriefingsQueryKey() });
        addToast('Opdracht aangemaakt. Klaar voor de SEO-briefing.');
        setLocation(`/assignments/${assignment.id}/brief`);
      },
      onError: () => {
        addToast('Er is een fout opgetreden bij het aanmaken van de briefing.');
      }
    });
  };

  if (isLoading) {
    return (
      <>
        <PageHeader eyebrow="Nieuwe werkstroom" title="Brief een verhaal" description="Geef de redactionele agent een duidelijke opdracht." />
        <div className="empty-state card">
          <RefreshCw size={28} className="animate-spin" />
          <h3>Partners laden...</h3>
        </div>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader eyebrow="Nieuwe werkstroom" title="Brief een verhaal" description="Geef de redactionele agent een duidelijke opdracht." />
        <div className="empty-state card">
          <TriangleAlert size={28} color="hsl(var(--destructive))" />
          <h3>Fout bij laden partners</h3>
        </div>
      </>
    );
  }

  if (dbPartners.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Nieuwe werkstroom" title="Brief een verhaal" description="Geef de redactionele agent een duidelijke opdracht." />
        <div className="empty-state card">
          <Users size={28} />
          <h3>Geen partners gevonden</h3>
          <p data-testid="error-no-partners">Voeg eerst een partner toe voordat je een briefing maakt.</p>
          <Link href="/partners" className="button button-primary" style={{ marginTop: 17 }}>Naar partners</Link>
        </div>
      </>
    );
  }

  if (activeYellowlimers.length === 0 && !isLoadingYellowlimers) {
    return (
      <>
        <PageHeader eyebrow="Nieuwe werkstroom" title="Brief een verhaal" description="Geef de redactionele agent een duidelijke opdracht." />
        <div className="empty-state card">
          <Users size={28} />
          <h3>Geen controleurs beschikbaar</h3>
          <p data-testid="error-no-yellowlimers">Voeg eerst een Yellowlimer toe voordat je een briefing maakt.</p>
          <Link href="/yellowlimers" className="button button-primary" style={{ marginTop: 17 }}>Naar Yellowlimers</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Nieuwe werkstroom" title="Brief een verhaal" description="Geef de redactionele agent een duidelijke opdracht. Partnercontext blijft beschikbaar, maar wordt nooit per ongeluk in de briefing gemengd." />
      <div className="progress-rail">
        <div className="progress-step current"><span className="progress-node">01</span><span className="progress-label">Opdracht</span></div><div className="progress-line" />
        <div className="progress-step"><span className="progress-node">02</span><span className="progress-label">SEO-briefing</span></div><div className="progress-line" />
        <div className="progress-step"><span className="progress-node">03</span><span className="progress-label">Artikel</span></div><div className="progress-line" />
        <div className="progress-step"><span className="progress-node">04</span><span className="progress-label">Menselijke beoordeling</span></div>
      </div>
      <form className="card form-card" onSubmit={submit}>
        <div className="section-title">
          <div>
            <h2>Opdrachtdetails</h2>
            <p>Specifieke input zorgt voor een meer verantwoorde eerste versie.</p>
          </div>
          <FileEdit size={20} color="hsl(var(--primary))" />
        </div>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="partner">Partner <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <select id="partner" className="select" value={form.partnerId} onChange={(event) => change('partnerId', event.target.value)} data-testid="select-assignment-partner">
              <option value="" disabled>Selecteer een partner</option>
              {dbPartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.companyName}</option>)}
            </select>
            {errors.partnerId && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-assignment-partner">{errors.partnerId}</span>}
          </div>
          
          <div className="field full">
            <label htmlFor="reviewer">Controleur <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <Select value={form.reviewerId} onValueChange={(val) => change('reviewerId', val)}>
              <SelectTrigger id="reviewer" className="select" data-testid="select-assignment-reviewer" style={{ height: 'auto', minHeight: 39 }}>
                <SelectValue placeholder="Selecteer een controleur" />
              </SelectTrigger>
              <SelectContent>
                {activeYellowlimers.map((yellowlimer) => (
                  <SelectItem key={yellowlimer.id} value={String(yellowlimer.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <InlineAvatar type={yellowlimer.avatarType} value={yellowlimer.avatarValue} />
                      {yellowlimer.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.reviewerId && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-assignment-reviewer">{errors.reviewerId}</span>}
          </div>

          <div className="field full">
            <label htmlFor="subject">Onderwerp van het artikel <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <input id="subject" className="input" value={form.subject} onChange={(event) => change('subject', event.target.value)} placeholder="bijv. Hoe kies je alledaagse schoenen die lang meegaan" data-testid="input-assignment-subject" />
            {errors.subject && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-assignment-subject">{errors.subject}</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => { void runTopicCheck(); }}
                disabled={!form.partnerId || form.subject.trim().length < 3 || topicCheck.isChecking}
                data-testid="check-topic"
              >
                {topicCheck.isChecking ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                {topicCheck.isChecking ? 'Limey vergelijkt met de website…' : 'Controleer of dit onderwerp al bestaat'}
              </button>
              {topicCheck.failed && !topicCheck.isChecking && <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>De controle lukte niet. Je kunt gewoon doorgaan.</span>}
            </div>
            {topicResult && (
              <TopicCheckCard
                result={topicResult}
                partnerId={Number(form.partnerId)}
                acknowledged={topicCheck.acknowledged}
                onAcknowledge={topicCheck.setAcknowledged}
                onUseAlternative={(subject) => { change('subject', subject); setErrors((current) => ({ ...current, subject: '' })); }}
              />
            )}
          </div>
          <div className="field full">
            <label htmlFor="goal">Contentdoel <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <textarea id="goal" className="textarea" value={form.contentGoal} onChange={(event) => change('contentGoal', event.target.value)} placeholder="Wat moet de lezer begrijpen of doen na het lezen?" data-testid="input-assignment-goal" />
            {errors.contentGoal && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-assignment-goal">{errors.contentGoal}</span>}
          </div>
        </div>
        <div className="form-actions">
          <Link href="/" className="button button-ghost" data-testid="button-cancel-assignment">Annuleren</Link>
          <button type="submit" className="button button-primary" data-testid="button-submit-assignment" disabled={createBriefing.isPending || topicCheck.isChecking}>
            {createBriefing.isPending ? 'Bezig met aanmaken...' : topicCheck.isChecking ? 'Limey controleert het onderwerp…' : <><ArrowRight size={15} /> Briefing aanmaken</>}
          </button>
        </div>
      </form>
    </>
  );
}

function WorkflowHeader({ assignment, step }: { assignment: Assignment; step: number }) {
  const steps = [{ label: 'Opdracht', href: `/assignments/${assignment.id}/brief` }, { label: 'SEO-briefing', href: `/assignments/${assignment.id}/brief` }, { label: 'Artikel', href: `/assignments/${assignment.id}/article` }, { label: 'Menselijke beoordeling', href: `/assignments/${assignment.id}/review` }];
  return <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 15, marginBottom: 19 }}><Link href="/" className="link-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} data-testid="link-back-overview"><ArrowLeft size={14} />Terug naar overzicht</Link><StatusPill status={assignment.status} /></div><div className="progress-rail">{steps.map((item, index) => <div className={`progress-step ${index < step ? 'done' : ''} ${index === step ? 'current' : ''}`} key={item.label}><Link href={item.href} className="progress-node" data-testid={`link-workflow-step-${index}`}>{index < step ? <Check size={12} /> : `0${index + 1}`}</Link><span className="progress-label">{item.label}</span>{index < steps.length - 1 && <div className="progress-line" />}</div>)}</div></>;
}

function BriefPage() {
  const { id: assignmentId } = useParams<{ id: string }>();
  const { data, updateAssignment, addToast } = useStudio();
  const { data: dbPartners = [] } = useListPartners();
  const [, setLocation] = useLocation();
  const createArticle = useCreateArticle();
  const queryClient = useQueryClient();
  
  const assignment = data.assignments.find((item) => item.id === assignmentId);
  const partnerName = assignment ? getPartnerName(data.partners, dbPartners, assignment.partnerId) : undefined;
  
  const briefingDbId = assignment?.briefingDbId;
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;

  const { data: seoResearch } = useGetSeoResearch(briefingDbId!, {
    query: {
      enabled: !!briefingDbId,
      queryKey: getGetSeoResearchQueryKey(briefingDbId!),
      refetchInterval: (query) => {
        const d = query.state.data;
        return (!d || d.apiStatus === 'pending') ? 2000 : false;
      }
    }
  });

  const runSeoResearch = useRunSeoResearch();

  const apiStatus = seoResearch?.apiStatus;
  const seoMessage = seoResearch?.message;

  useEffect(() => {
    const currAssignment = assignmentRef.current;
    if (!currAssignment || !apiStatus || currAssignment.seoResearchStatus === apiStatus) return;
    
    const newLogs = [...currAssignment.logs];
    const logId = id('log-seo');
    
    if (apiStatus === 'pending') {
      newLogs.unshift({ id: logId, step: 'SEO onderzoek bezig', status: 'current', detail: 'De SEO agent zoekt naar zoekwoorden en concurrenten.', createdAt: now() });
    } else if (apiStatus === 'success') {
      newLogs.unshift({ id: logId, step: 'SEO onderzoek voltooid', status: 'complete', detail: 'Semrush gegevens zijn succesvol opgehaald.', createdAt: now() });
    } else if (apiStatus === 'failed') {
      newLogs.unshift({ id: logId, step: 'SEO onderzoek mislukt', status: 'warn', detail: seoMessage || 'Er is een fout opgetreden bij het ophalen.', createdAt: now() });
    }
    
    updateAssignment({ ...currAssignment, seoResearchStatus: apiStatus, logs: newLogs, updatedAt: now() });
  }, [apiStatus, seoMessage, updateAssignment]);

  const handleRerunSeoResearch = () => {
    if (!briefingDbId) return;
    if (window.confirm('Weet je zeker dat je het SEO onderzoek opnieuw wilt uitvoeren? Elke uitvoering kost Semrush API eenheden.')) {
       const currAssignment = assignmentRef.current;
       if (currAssignment) {
         updateAssignment({
           ...currAssignment,
           seoResearchStatus: 'pending',
           logs: [{ id: id('log-rerun'), step: 'SEO onderzoek bezig', status: 'current', detail: 'Onderzoek wordt opnieuw uitgevoerd.', createdAt: now() }, ...currAssignment.logs],
           updatedAt: now()
         });
       }

       runSeoResearch.mutate({ briefingId: briefingDbId }, {
         onSuccess: () => {
           queryClient.invalidateQueries({ queryKey: getGetSeoResearchQueryKey(briefingDbId) });
         }
       });
    }
  };

  if (!assignment || !partnerName) return <MissingState />;
  const briefing = assignment.seoBriefing;
  const generateBrief = () => { const next = { ...assignment, seoBriefing: makeBrief(assignment.subject), status: 'brief_ready' as Status, updatedAt: now(), logs: [...assignment.logs, { id: id('log'), step: 'SEO-briefing gegenereerd', status: 'complete', detail: 'Mock Semrush onderwerp, intentie en concurrent signalen zijn klaar.', createdAt: now() }] }; updateAssignment(next); addToast('Mock Semrush briefing gegenereerd.'); };
  


  return <><WorkflowHeader assignment={assignment} step={1} /><PageHeader eyebrow={`SEO inlichtingen / ${partnerName}`} title="Zoekbriefing" description="Een mock Semrush uitlezing om de schrijvende agent een gefocust, transparant startpunt te geven." action={<span className="status-pill status-brief"><BarChart3 size={12} />Mock Semrush data</span>} />
    {!briefing ? <div className="card empty-state"><BarChart3 size={30} /><h3>Briefing nog niet gegenereerd</h3><p>Genereer een mock Semrush briefing. Deze blijft in het dossier van deze opdracht en kan opnieuw gegenereerd worden voordat het artikel bestaat.</p><button className="button button-primary" onClick={generateBrief} data-testid="button-generate-brief"><Sparkles size={15} />Mock briefing genereren</button></div> : <>
      <div className="brief-grid"><div className="keyword-hero"><div className="eyebrow">Doelzoekwoord</div><h2 data-testid="text-primary-keyword">{briefing.primaryKeyword}</h2><div className="keyword-metrics"><div><strong>{briefing.searchVolume}</strong><span>zoekvolume</span></div><div><strong>Informatief</strong><span>intentie</span></div></div></div><SectionCard title="Zoekintentie" subtitle="Wat de lezer probeert op te lossen"><div className="intent-line"><span className="intent-dot" /><span>{briefing.intent}</span></div></SectionCard><SectionCard title="Gerelateerde signalen" subtitle="Onderwerpgebied om te dekken"><div className="tag-list">{briefing.relatedKeywords.map((keyword) => <span className="tag" key={keyword} data-testid={`tag-keyword-${keyword}`}>{keyword}</span>)}</div></SectionCard><SectionCard title="Aanbevolen structuur" subtitle="Een nuttig pad, geen rigide opzet"><ol className="bullet-list">{briefing.recommendedStructure.map((item) => <li key={item}>{item}</li>)}</ol></SectionCard></div>
      
      <div className="card brief-block" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 15, fontSize: 16 }}>SEO onderzoek</h3>
        {!briefingDbId ? (
          <p className="link-muted" style={{ fontSize: 13 }}>Dit is een verouderde opdracht zonder API-koppeling. SEO onderzoek is niet beschikbaar.</p>
        ) : (!seoResearch || seoResearch.apiStatus === 'pending') ? (
          <div className="empty-state" data-testid="research-status-pending">
            <RefreshCw size={28} className="animate-spin" style={{ color: 'hsl(var(--primary))', marginBottom: 10, marginInline: 'auto' }} />
            <p>Limey onderzoekt de zoekmogelijkheden.</p>
          </div>
        ) : seoResearch.apiStatus === 'failed' ? (
          <div className="empty-state" data-testid="research-status-failed" style={{ borderColor: 'hsl(var(--destructive)/.5)' }}>
            <TriangleAlert size={28} color="hsl(var(--destructive))" style={{ marginBottom: 10, marginInline: 'auto' }} />
            <p>{seoResearch.message || 'Er is een fout opgetreden bij het SEO onderzoek.'}</p>
            <button className="button button-danger" onClick={handleRerunSeoResearch} data-testid="button-rerun-research" style={{ marginTop: 15 }} disabled={runSeoResearch.isPending}>
              SEO onderzoek opnieuw uitvoeren
            </button>
          </div>
        ) : seoResearch.apiStatus === 'success' ? (
          <div data-testid="research-status-success">
            <div className="callout" style={{ marginBottom: 20, background: 'hsl(var(--primary)/.15)', color: 'hsl(81 50% 28%)' }}>
              <CheckCircle2 size={16} /> 
              <p>Het SEO onderzoek is afgerond.</p>
            </div>
            
            {seoResearch.selectedMainKeyword ? (
              <div className="keyword-hero" style={{ marginBottom: 24 }}>
                <div className="eyebrow">Hoofdzoekwoord</div>
                <h2 data-testid="research-main-keyword">{seoResearch.selectedMainKeyword}</h2>
                <div className="keyword-metrics">
                  <div><strong>{seoResearch.searchVolume ?? '—'}</strong><span>Zoekvolume</span></div>
                  <div><strong>{seoResearch.keywordDifficulty ?? '—'}/100</strong><span>Keyword difficulty</span></div>
                </div>
                <div className="keyword-metrics" style={{ marginTop: 15 }}>
                  <div><strong>{seoResearch.searchIntent || '—'}</strong><span>Zoekintentie</span></div>
                  <div><strong>{seoResearch.trend || '—'}</strong><span>Trend</span></div>
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '20px 10px', marginBottom: 24 }}>
                <p>Er is geen geschikt alternatief zoekwoord gevonden.</p>
              </div>
            )}

            {seoResearch.secondaryKeywords && seoResearch.secondaryKeywords.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Aanvullende zoekwoorden</div>
                <div className="tag-list" data-testid="research-list-secondary">
                  {seoResearch.secondaryKeywords.map((kw, i) => (
                    <span key={i} className="tag">{kw.keyword} <small style={{ opacity: 0.6 }}>({kw.searchVolume || 0})</small></span>
                  ))}
                </div>
              </div>
            )}

            {seoResearch.relevantQuestions && seoResearch.relevantQuestions.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Relevante vragen</div>
                <ul className="bullet-list" data-testid="research-list-questions">
                  {seoResearch.relevantQuestions.map((q, i) => (
                    <li key={i}>{q.question}</li>
                  ))}
                </ul>
              </div>
            )}

            {seoResearch.organicCompetitors && seoResearch.organicCompetitors.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Organische concurrenten</div>
                <div style={{ display: 'grid', gap: '8px' }} data-testid="research-list-competitors">
                  {seoResearch.organicCompetitors.map((comp, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', background: 'hsl(var(--muted)/.4)', padding: '9px 12px', borderRadius: '6px' }}>
                      <strong style={{ width: '22px', color: 'hsl(var(--muted-foreground))', fontSize: '12px' }}>#{comp.position || '?'}</strong>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: '2px' }}>{comp.domain}</div>
                        <a href={comp.url} target="_blank" rel="noreferrer" className="link-muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.url}</a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 18, marginTop: 10 }}>
              <button className="button button-ghost button-small" onClick={handleRerunSeoResearch} data-testid="button-rerun-research" disabled={runSeoResearch.isPending}>
                <RefreshCw size={14} className={runSeoResearch.isPending ? 'animate-spin' : ''} /> SEO onderzoek opnieuw uitvoeren
              </button>
            </div>
          </div>
        ) : null}
      </div>
      
      <div className="card brief-block" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 15 }}><div><div className="eyebrow">Redactionele context</div><h3 style={{ margin: '8px 0 5px' }}>{assignment.subject}</h3><p className="assignment-meta" style={{ maxWidth: 620 }}>Merkrichtlijnen van <strong>{partnerName}</strong> worden toegepast in de volgende stap. Dit is onderzoeksondersteuning, geen publicatiebeslissing.</p></div><Link className="button button-primary" href={`/assignments/${assignment.id}/article`} data-testid="button-goto-article-generation"><ArrowRight size={15} /> Door naar artikel</Link></div></>}
  </>;
}
function ArticlePage() {
  const { id: assignmentId } = useParams<{ id: string }>();
  const { data, updateAssignment, addToast } = useStudio();
  const { data: dbPartners = [] } = useListPartners();
  const { data: yellowlimers = [] } = useListYellowlimers();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const assignment = data.assignments.find((item) => item.id === assignmentId);
  const partnerName = assignment ? getPartnerName(data.partners, dbPartners, assignment.partnerId) : undefined;
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;

  const briefingDbId = assignment?.briefingDbId;
  const partnerId = assignment?.partnerId && !assignment.partnerId.startsWith('partner-') ? Number(assignment.partnerId) : undefined;
  
  const { data: profile } = useGetPartnerProfile(partnerId!, {
    query: { enabled: !!partnerId, queryKey: getGetPartnerProfileQueryKey(partnerId!) }
  });
  
  const { data: seoResearch } = useGetSeoResearch(briefingDbId!, {
    query: { enabled: !!briefingDbId, queryKey: getGetSeoResearchQueryKey(briefingDbId!) }
  });

  const { data: generations = [] } = useListArticleGenerations(briefingDbId!, {
    query: {
      enabled: !!briefingDbId,
      queryKey: getListArticleGenerationsQueryKey(briefingDbId!),
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d && d.length > 0 && d[0].articleStatus === 'Artikel wordt geschreven') return 2000;
        return false;
      }
    }
  });

  const generateMutation = useGenerateArticleGeneration();
  
  const latestGen = generations[0];
  const lastLoggedStatus = useRef<string | null>(null);

  useEffect(() => {
    if (!latestGen || !assignmentRef.current) return;
    const current = assignmentRef.current;
    
    if (lastLoggedStatus.current !== latestGen.articleStatus) {
      lastLoggedStatus.current = latestGen.articleStatus;
      
      let nextStatus = current.status;
      let logStep = '';
      let logStatus = '';
      let logDetail = '';
      
      if (latestGen.articleStatus === 'Artikel wordt geschreven') {
        logStep = 'Artikel wordt geschreven';
        logStatus = 'current';
        logDetail = 'Limey schrijft het conceptartikel.';
      } else if (latestGen.articleStatus === 'Wacht op controle' || latestGen.articleStatus === 'Concept gereed') {
        nextStatus = 'in_review';
        logStep = 'Wacht op controle';
        logStatus = 'complete';
        logDetail = 'Het conceptartikel is klaar voor controle.';
      } else if (latestGen.articleStatus === 'Generatie mislukt') {
        logStep = 'Generatie mislukt';
        logStatus = 'warn';
        logDetail = latestGen.failureMessage || 'Er is een fout opgetreden bij het genereren.';
      }
      
      if (logStep) {
        updateAssignment({
          ...current,
          status: nextStatus,
          updatedAt: now(),
          logs: [{ id: id('log-gen'), step: logStep, status: logStatus, detail: logDetail, createdAt: now() }, ...current.logs]
        });
      }
    }
  }, [latestGen, updateAssignment]);

  if (!assignment || !partnerName) return <MissingState />;
  
  if (!briefingDbId) {
    const article = assignment.article;
    const improve = () => { if (!article || assignment.versions.length >= 3) return; const improved = { ...article, id: id('version'), versionNumber: assignment.versions.length + 1, authorType: 'claude' as const, reason: `Verbeteringsronde ${assignment.versions.length}`, createdAt: now(), content: `${article.content}\n\n## Een notitie over kiezen met vertrouwen\n\nHet beste paar is niet degene met de grootste belofte. Het is degene waarvan de materialen, pasvorm en onderhoudsplan logisch zijn voor jouw daadwerkelijke week.` }; updateAssignment({ ...assignment, article: improved, versions: [improved, ...assignment.versions], updatedAt: now(), logs: [...assignment.logs, { id: id('log'), step: `Verbeteringsronde ${assignment.versions.length}`, status: 'complete', detail: 'Legatum structuur en details toegevoegd.', createdAt: now() }] }); addToast(`Verbeteringsronde ${assignment.versions.length} voltooid.`); };
    return <><WorkflowHeader assignment={assignment} step={2} /><PageHeader eyebrow={`Gegenereerd artikel (Legacy) / ${partnerName}`} title={assignment.subject} description="Een legacy gegenereerd concept. Niets wordt gepubliceerd zonder menselijke beslissing." action={<span className="status-pill status-review"><Sparkles size={12} />Legacy</span>} />
      {!article ? <div className="card empty-state"><Sparkles size={30} /><h3>Nog geen artikel concept</h3></div> : <div className="article-layout"><article className="card article-paper"><div className="article-kicker">Northstar redactioneel / conceptversie · v{article.versionNumber}</div><h1 data-testid="text-article-title">{assignment.subject}</h1><p className="article-dek">{article.metaDescription}</p><div className="article-body" data-testid="content-article-body">{article.content.split('\n').map((paragraph, index) => paragraph.startsWith('## ') ? <h2 key={index}>{paragraph.replace('## ', '')}</h2> : <p key={index}>{paragraph}</p>)}</div></article><aside className="side-stack"><SectionCard title="Eerdere versies" subtitle={`${assignment.versions.length} opgeslagen versie${assignment.versions.length === 1 ? '' : 's'}`}><div className="version-list">{assignment.versions.map((version) => <div className="version-row" key={version.id}><div><strong>v{version.versionNumber} · {version.authorType === 'claude' ? 'Claude' : 'Yellowlimer'}</strong><span>{version.reason}</span></div><span>{dateLabel(version.createdAt)}</span></div>)}</div></SectionCard><div style={{ display: 'grid', gap: 8 }}><button className="button button-ghost" disabled={assignment.versions.length >= 3} onClick={improve}><RefreshCw size={15} />Start verbeteringsronde</button><button className="button button-primary" onClick={() => setLocation(`/assignments/${assignment.id}/review`)}><ClipboardCheck size={15} />Open menselijke beoordeling</button></div></aside></div>}
    </>;
  }

  const isProfileApproved = profile?.profileStatus === 'Goedgekeurd' && !!profile?.approvedProfile;
  const isSeoSuccess = seoResearch?.apiStatus === 'success';
  const hasReviewer = !!assignment.reviewerId;
  const hasContent = !!assignment.subject && !!assignment.contentGoal;
  
  const canGenerate = isProfileApproved && hasReviewer && hasContent;
  const isPending = latestGen?.articleStatus === 'Artikel wordt geschreven' || generateMutation.isPending;

  const handleGenerate = () => {
    if (!canGenerate || isPending) return;
    generateMutation.mutate({ briefingId: briefingDbId }, {
      onSuccess: () => {
        addToast('Artikel generatie gestart.');
        queryClient.invalidateQueries({ queryKey: getListArticleGenerationsQueryKey(briefingDbId) });
      },
      onError: () => {
        addToast('Fout bij het starten van de generatie.');
      }
    });
  };

  const safeRender = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((paragraph, index) => {
      if (paragraph.trim().startsWith('### ')) return <h3 key={index} style={{fontSize: '18px', fontWeight: 600, margin: '20px 0 10px'}}>{paragraph.replace('### ', '')}</h3>;
      if (paragraph.trim().startsWith('## ')) return <h2 key={index}>{paragraph.replace('## ', '')}</h2>;
      if (paragraph.trim().startsWith('# ')) return <h1 key={index} style={{fontSize:'24px', fontWeight: 700, margin:'24px 0 12px'}}>{paragraph.replace('# ', '')}</h1>;
      if (paragraph.trim() === '') return <br key={index} />;
      return <p key={index}>{paragraph}</p>;
    });
  };

  return (
    <>
      <WorkflowHeader assignment={assignment} step={2} />
      <PageHeader 
        eyebrow={`Gegenereerd artikel / ${partnerName}`} 
        title={assignment.subject} 
        description="Een AI gegenereerd concept gebaseerd op de briefing en goedgekeurde partnercontext." 
        action={<span className="status-pill status-review"><Sparkles size={12} />Limey Generatie</span>} 
      />

      <div className="article-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {(!latestGen || latestGen.articleStatus === 'Generatie mislukt') && (
            <div className="card section-card">
              <div className="section-title">
                <div>
                  <h2>Conceptartikel</h2>
                  <p>Klik om een nieuw artikel te genereren op basis van de huidige briefing en partner context.</p>
                </div>
              </div>

              {!isSeoSuccess && (
                <div className="callout" data-testid="seo-optional-notice" style={{ marginBottom: 20 }}>
                  <TriangleAlert size={16} />
                  <p>SEO-onderzoek is niet beschikbaar. Je kunt doorgaan; het onderwerp van de briefing wordt als hoofdzoekwoord gebruikt.</p>
                </div>
              )}
              
              {!canGenerate && (
                <div style={{ marginBottom: '20px', padding: '15px', background: 'hsl(var(--destructive)/.1)', borderRadius: '8px', border: '1px solid hsl(var(--destructive)/.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--destructive))', fontWeight: 600, marginBottom: '10px' }}>
                    <TriangleAlert size={16} /> Voorwaarden voor generatie
                  </div>
                  <ul className="bullet-list" style={{ color: 'hsl(var(--destructive))' }}>
                    {!isProfileApproved && <li data-testid="prerequisite-profile">Keur eerst het partnerprofiel goed.</li>}
                    {!hasReviewer && <li data-testid="prerequisite-reviewer">Er is geen controleur (reviewer) toegewezen.</li>}
                    {!hasContent && <li data-testid="prerequisite-content">Onderwerp en contentdoel moeten ingevuld zijn.</li>}
                  </ul>
                </div>
              )}

              {latestGen?.articleStatus === 'Generatie mislukt' && (
                <div className="empty-state" data-testid="article-generation-error" style={{ borderColor: 'hsl(var(--destructive)/.5)', marginBottom: 20 }}>
                  <TriangleAlert size={28} color="hsl(var(--destructive))" style={{ marginBottom: 10, marginInline: 'auto' }} />
                  <p>{latestGen.failureMessage || 'Er is een fout opgetreden bij de generatie.'}</p>
                </div>
              )}

              <button 
                className="button button-primary" 
                onClick={handleGenerate} 
                disabled={!canGenerate || isPending} 
                data-testid="generate-article"
              >
                <Sparkles size={15} /> Conceptartikel genereren
              </button>
            </div>
          )}

          {isPending && (
            <div className="card empty-state" data-testid="article-generation-loading">
              <RefreshCw size={28} className="animate-spin" style={{ color: 'hsl(var(--primary))', marginBottom: 10, marginInline: 'auto' }} />
              <p>Limey schrijft het conceptartikel.</p>
            </div>
          )}

          {!isPending && (latestGen?.articleStatus === 'Wacht op controle' || latestGen?.articleStatus === 'Concept gereed') && (
            <article className="card article-paper" data-testid="generated-article">
              <div className="callout" style={{ marginBottom: 20, background: 'hsl(var(--primary)/.15)', color: 'hsl(81 50% 28%)' }}>
                <CheckCircle2 size={16} /> 
                <p>Het conceptartikel is klaar voor controle.</p>
              </div>
              
              <div className="article-kicker">
                {partnerName} redactioneel · Gegenereerd op {dateTimeLabel(latestGen.generatedAt)}
              </div>
              <h1 data-testid="article-title">{latestGen.title || assignment.subject}</h1>
              <p className="article-dek">{latestGen.metaDescription}</p>
              
              <div className="article-body" data-testid="article-full-content" style={{ marginTop: '24px' }}>
                {safeRender(latestGen.fullArticle)}
              </div>
            </article>
          )}
        </div>

        <aside className="side-stack">
          {latestGen && (
            <SectionCard title="Generatie Details" subtitle="Metadata van deze versie">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' }}>
                <div>
                  <strong style={{ display: 'block', color: 'hsl(var(--muted-foreground))' }}>Model</strong>
                  <div>{latestGen.claudeModelName || 'Onbekend'}</div>
                </div>
                <div>
                  <strong style={{ display: 'block', color: 'hsl(var(--muted-foreground))' }}>Primaire Zoekwoord</strong>
                  <div>{latestGen.primaryKeyword || '—'}</div>
                </div>
                <div>
                  <strong style={{ display: 'block', color: 'hsl(var(--muted-foreground))' }}>Meta Titel</strong>
                  <div>{latestGen.metaTitle || '—'}</div>
                </div>
                <div>
                  <strong style={{ display: 'block', color: 'hsl(var(--muted-foreground))' }}>Toegewezen aan</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    {yellowlimers.find(y => y.id === latestGen.yellowlimerId)?.name || 'Onbekend'}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {generations.length > 0 && (
            <SectionCard title="Versiegeschiedenis" subtitle={`${generations.length} gegenereerde versie${generations.length === 1 ? '' : 's'}`}>
              <div className="version-list">
                {generations.map((gen, idx) => (
                  <div className="version-row" key={gen.id}>
                    <div>
                      <strong>v{generations.length - idx} · Limey AI</strong>
                      <span>{gen.articleStatus}</span>
                    </div>
                    <span>{dateLabel(gen.generatedAt)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <div className="callout">
            <ShieldCheck size={16} />
            <span>Dit gegenereerde artikel is in leesmodus. De latere review flow staat bewerkingen toe.</span>
          </div>

          {(!isPending && (latestGen?.articleStatus === 'Wacht op controle' || latestGen?.articleStatus === 'Concept gereed')) && (
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="button button-primary" onClick={() => setLocation(`/assignments/${assignment.id}/review`)} data-testid="button-open-review">
                <ClipboardCheck size={15} /> Door naar menselijke beoordeling
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function ReviewPage() {
  const { id: assignmentId } = useParams<{ id: string }>();
  const { data, updateAssignment, addToast } = useStudio();
  const { data: dbPartners = [] } = useListPartners();
  const { data: yellowlimers = [] } = useListYellowlimers();
  const [location, setLocation] = useLocation();
  const createArticleReview = useCreateArticleReview();
  const queryClient = useQueryClient();
  
  const assignment = data.assignments.find((item) => item.id === assignmentId);
  const partnerName = assignment ? getPartnerName(data.partners, dbPartners, assignment.partnerId) : undefined;
  const partner = assignment ? getPartner(data, assignment.partnerId) : undefined;
  const reviewer = yellowlimers.find(y => y.id === assignment?.reviewerId);
  
  const [content, setContent] = useState(assignment?.article?.content ?? '');
  const [feedback, setFeedback] = useState(assignment?.review?.feedback ?? '');
  useEffect(() => { if (assignment?.article?.content && !content) setContent(assignment.article.content); }, [assignment?.article?.content, content]);
  if (!assignment || !partnerName) return <MissingState />;
  
  const saveEdit = () => { if (!assignment.article) return; const edited = { ...assignment.article, id: id('version'), versionNumber: assignment.versions.length + 1, content, authorType: 'human' as const, reason: 'Menselijke redactionele bewerking', createdAt: now() }; updateAssignment({ ...assignment, article: edited, versions: [edited, ...assignment.versions], updatedAt: now(), logs: [...assignment.logs, { id: id('log'), step: 'Menselijke bewerking opgeslagen', status: 'complete', detail: 'Het concept is bewerkt door de redacteur.', createdAt: now() }] }); addToast('Menselijke bewerking opgeslagen als een nieuwe versie.'); };
  
  const decide = (decision: 'approved' | 'rejected') => { 
    if (!assignment.article) return; 
    
    // Save to database if we have an article DB ID
    if (assignment.articleDbId) {
      createArticleReview.mutate({
        data: {
          articleId: assignment.articleDbId,
          correctedTitle: assignment.article.metaTitle, // in a real app this might be editable
          correctedContent: content,
          correctedMetaTitle: assignment.article.metaTitle,
          correctedMetaDescription: assignment.article.metaDescription,
          reviewerExplanation: feedback || null,
          reviewStatus: decision
        }
      }, {
        onSuccess: () => {
          // invalidate reviews query
          queryClient.invalidateQueries({ queryKey: ['/api/article-reviews'] }); // the generated key is getListArticleReviewsQueryKey()
        }
      });
    }

    const next: Assignment = { ...assignment, status: decision === 'approved' ? 'approved' : 'rejected', review: { status: decision, feedback, reviewedAt: now() }, updatedAt: now(), logs: [...assignment.logs, { id: id('log'), step: decision === 'approved' ? 'Menselijk goedgekeurd' : 'Aanpassingen aangevraagd', status: 'complete', detail: feedback || (decision === 'approved' ? 'Goedgekeurd voor de publicatiepoort.' : 'Afgewezen in afwachting van redactionele wijzigingen.'), createdAt: now() }] }; 
    updateAssignment(next); 
    addToast(decision === 'approved' ? 'Goedgekeurd. Publicatievoorbeeld is nu ontgrendeld.' : 'Aanpassingen aangevraagd. De publicatiepoort blijft gesloten.'); 
  };
  
  const makeReady = () => { if (assignment.review?.status !== 'approved') return; updateAssignment({ ...assignment, status: 'ready', updatedAt: now(), logs: [...assignment.logs, { id: id('log'), step: 'Gemarkeerd als klaar', status: 'complete', detail: 'Menselijke goedkeuring bevestigd; WordPress voorbeeld kan geopend worden.', createdAt: now() }] }); addToast('Opdracht gemarkeerd als klaar voor publicatie.'); };
  const previewUnlocked = assignment.review?.status === 'approved' || assignment.status === 'ready';
  
  return <><WorkflowHeader assignment={assignment} step={3} /><PageHeader eyebrow={`Menselijke poort / ${partnerName}`} title="Maak de beslissing" description="Lees het artikel als editor, maak eventuele laatste wijzigingen, en keur expliciet goed voordat het publicatievoorbeeld geopend kan worden." action={<span className="status-pill status-review"><ShieldCheck size={12} />Menselijk gecontroleerde poort</span>} />
    {!assignment.article ? <div className="card empty-state"><ClipboardCheck size={30} /><h3>Nog niets te beoordelen</h3><p>Genereer eerst een artikel. De beoordelingspoort opent alleen voor een echt concept.</p><Link className="button button-primary" href={`/assignments/${assignment.id}/brief`} data-testid="button-review-return-brief">Terug naar briefing</Link></div> : <div className="review-layout"><section className="card section-card"><div className="section-title"><div><h2>Redactioneel canvas</h2><p>Bewerk direct. Opslaan creëert een menselijk geschreven versie.</p></div><span className="eyebrow">v{assignment.article.versionNumber} · {assignment.article.authorType === 'human' ? 'menselijk' : 'claude'}</span></div><textarea className="textarea editor" value={content} onChange={(event) => setContent(event.target.value)} data-testid="textarea-review-article" /><div className="form-actions" style={{ marginTop: 14 }}><button className="button button-ghost" onClick={saveEdit} data-testid="button-save-review-edit"><FileEdit size={15} />Menselijke bewerking opslaan</button></div></section><aside className="card gate-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: 12, background: 'hsl(var(--muted))', borderRadius: 8 }}>
        {reviewer ? (
          <>
            <InlineAvatar type={reviewer.avatarType} value={reviewer.avatarValue} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toegewezen controleur</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{reviewer.name}</div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Geen controleur toegewezen of controleur verwijderd.</div>
        )}
      </div>
      <div className="eyebrow">Publicatiepoort</div><h2 style={{ fontSize: 20, margin: '8px 0 0' }}>Menselijke goedkeuring vereist</h2><div className={`gate-state ${previewUnlocked ? 'unlocked' : 'locked'}`} data-testid="status-publication-gate">{previewUnlocked ? <strong><CheckCircle2 size={16} />Voorbeeld ontgrendeld</strong> : <strong><LockKeyhole size={16} />Voorbeeld gesloten</strong>}<p>{previewUnlocked ? 'Dit artikel heeft een expliciete menselijke goedkeuring. Je kan het mock WordPress voorbeeld inspecteren.' : 'Automatische controles en AI-generatie zijn geen goedkeuring. Beoordeel en keur dit artikel goed om verder te gaan.'}</p></div><div className="field"><label htmlFor="feedback">Beoordelingsnotitie <span>optioneel</span></label><textarea id="feedback" className="textarea" style={{ minHeight: 78 }} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Wat heb je besloten, en waarom?" data-testid="textarea-review-feedback" /></div><div className="gate-actions" style={{ marginTop: 15 }}><button className="button button-primary" onClick={() => decide('approved')} disabled={assignment.status === 'approved' || assignment.status === 'ready' || createArticleReview.isPending} data-testid="button-approve-article"><CheckCircle2 size={15} />Artikel goedkeuren</button><button className="button button-danger" onClick={() => decide('rejected')} disabled={createArticleReview.isPending} data-testid="button-reject-article"><XCircle size={15} />Aanpassingen aanvragen</button>{assignment.review?.status === 'approved' && assignment.status !== 'ready' && <button className="button button-ink" onClick={makeReady} data-testid="button-mark-ready"><Send size={15} />Markeren als klaar voor publicatie</button>}<button className="button button-ghost" disabled={!previewUnlocked} onClick={() => setLocation(`${location}?preview=1`)} data-testid="button-wordpress-preview"><LockKeyhole size={14} />WordPress publicatievoorbeeld</button></div>{location.includes('?preview=1') && previewUnlocked && <div className="callout" style={{ marginTop: 14 }}><BookOpen size={15} /><span><strong>Mock WordPress voorbeeld</strong><br />Alleen een voorbeeld — er is geen artikel gepubliceerd. Bestemming: {partner?.wordpressUrl || 'WordPress URL niet geconfigureerd'}.</span></div>}<div className="callout" style={{ marginTop: 14 }}><Info size={15} /><span>Yellowlime is de eindverantwoordelijke. Een voldoende score is bewijs, geen toestemming.</span></div></aside></div>}
  </>;
}

function HistoryPage() {
  const { data } = useStudio();
  const { data: dbPartners = [] } = useListPartners();
  const { data: yellowlimers = [] } = useListYellowlimers();
  const { data: dbReviews = [], isLoading: isLoadingReviews } = useListArticleReviews();
  
  const allEvents = data.assignments.flatMap((assignment) => assignment.logs.map((log) => ({ ...log, subject: assignment.subject, assignmentId: assignment.id, partnerId: assignment.partnerId }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const versions = data.assignments.flatMap((assignment) => assignment.versions.map((version) => ({ ...version, subject: assignment.subject }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  return <><PageHeader eyebrow="Traceerbaarheid" title="Geschiedenis" description="Een onveranderlijk verslag van agent stappen, opgeslagen versies en statuswijzigingen in de werkruimte." /><div className="dashboard-grid"><SectionCard title="Agent stappen & statuswijzigingen" subtitle={`${allEvents.length} geregistreerde gebeurtenissen`}><div className="history-list">{allEvents.length ? allEvents.map((event) => <div className="history-item" key={event.id}><div className="history-dot" /><div><strong>{event.step}</strong><p>{getPartnerName(data.partners, dbPartners, event.partnerId)} · {event.subject} · {event.detail}</p></div><time>{dateTimeLabel(event.createdAt)}</time></div>) : <div className="empty-state"><History size={26} /><h3>Nog geen activiteit</h3><p>Werkstroom gebeurtenissen verschijnen hier naarmate opdrachten door de studio bewegen.</p></div>}</div></SectionCard><div className="side-stack"><SectionCard title="Versiegeschiedenis (Database)" subtitle="Opgeslagen artikel correcties en beoordelingen">
    {isLoadingReviews ? (
      <div style={{ textAlign: 'center', padding: 20 }}><RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto' }} /></div>
    ) : dbReviews.length > 0 ? (
      <div className="history-list">
        {dbReviews.map(review => {
          const yellowlimer = yellowlimers.find(y => y.id === review.yellowlimerId);
          return (
            <div className="history-item" key={review.id}>
              <div className="history-dot" />
              <div>
                <strong>{review.originalTitle}</strong>
                <p>AI versie gegenereerd: {dateTimeLabel(review.aiVersionCreatedAt)}</p>
                <p>Versie na menselijke correctie: {dateTimeLabel(review.humanVersionCreatedAt)}</p>
                <p>Controleur: {yellowlimer?.name || 'Onbekend'}</p>
                <p>Status: {review.reviewStatus === 'approved' ? 'Goedgekeurd' : 'Afgewezen'}</p>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="empty-state"><FileText size={26} /><h3>Nog geen database versies</h3><p>Voltooi een review om deze op te slaan in de database.</p></div>
    )}
  </SectionCard><SectionCard title="Lokale conceptversies" subtitle="Tijdelijke versies in deze browser"><div className="history-list">{versions.length ? versions.map((version) => <div className="history-item" key={version.id}><div className="history-dot" /><div><strong>v{version.versionNumber} · {version.authorType === 'claude' ? 'Mock Claude' : 'Yellowlimer'}</strong><p>{version.subject} · {version.reason}</p></div><time>{dateTimeLabel(version.createdAt)}</time></div>) : <div className="empty-state"><FileText size={26} /><h3>Nog geen versies</h3><p>Genereer een artikel om het versieverslag te starten.</p></div>}</div></SectionCard></div></div></>;
}

function MissingState() {
  return <div className="card empty-state"><AlertCircle size={30} /><h3>Opdracht niet gevonden</h3><p>Dit lokale record is mogelijk verwijderd of de link is niet meer actueel.</p><Link href="/" className="button button-primary" data-testid="button-missing-return">Terug naar overzicht</Link></div>;
}

export default App;
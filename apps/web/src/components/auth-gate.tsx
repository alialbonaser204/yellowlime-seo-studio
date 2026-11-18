import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import brandMark from '../assets/yellowlime-mark.png';
import brandWordmark from '../assets/yellowlime-wordmark.png';

export interface AuthUser { id: number; email: string; name: string }

interface AuthContextValue { user: AuthUser; logout: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth needs AuthGate');
  return value;
}

/** Fired by the API client when the server answers 401 (session ended). */
export const UNAUTHORIZED_EVENT = 'yl:unauthorized';

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Er ging iets mis. Probeer het opnieuw.');
  return data as { user: AuthUser };
}

/** Shows the login page until someone is logged in; then renders the app. */
export function AuthGate({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'out'; domains: string[] } | { status: 'in'; user: AuthUser }>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me').then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      setState(res.ok && data.user ? { status: 'in', user: data.user } : { status: 'out', domains: data.domains ?? ['yellowlime.nl'] });
    }).catch(() => { if (!cancelled) setState({ status: 'out', domains: ['yellowlime.nl'] }); });
    const onUnauthorized = () => setState((s) => (s.status === 'in' ? { status: 'out', domains: ['yellowlime.nl'] } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { cancelled = true; window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, []);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    onLogout?.();
    setState({ status: 'out', domains: ['yellowlime.nl'] });
  }, [onLogout]);

  if (state.status === 'loading') {
    return <div className="auth-page" aria-busy="true"><img src={brandMark} alt="" className="auth-loading-mark" /></div>;
  }
  if (state.status === 'out') {
    return <LoginPage domains={state.domains} onDone={(user) => setState({ status: 'in', user })} />;
  }
  return <AuthContext.Provider value={{ user: state.user, logout }}>{children}</AuthContext.Provider>;
}

function LoginPage({ domains, onDone }: { domains: string[]; onDone: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const domainText = domains.map((d) => `@${d}`).join(' of ');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = mode === 'login'
        ? await post('/api/auth/login', { email, password })
        : await post('/api/auth/register', { name, email, password });
      onDone(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Er ging iets mis.');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next: 'login' | 'register') => { setMode(next); setError(''); };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={brandMark} alt="" className="auth-mark" />
          <div><img src={brandWordmark} alt="Yellowlime" className="auth-wordmark" /><span>AI Agent</span></div>
        </div>
        <h1>{mode === 'login' ? 'Welkom terug' : 'Account maken'}</h1>
        <p className="auth-lead">{mode === 'login' ? 'Log in om verder te gaan.' : `Alleen voor collega's met een ${domainText}-adres.`}</p>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')} data-testid="tab-login">Inloggen</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchTo('register')} data-testid="tab-register">Account maken</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label>Naam<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} data-testid="input-name" /></label>
          )}
          <label>E-mailadres<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={`naam${domains[0] ? `@${domains[0]}` : ''}`} required data-testid="input-email" /></label>
          <label>Wachtwoord<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 10 : 1} data-testid="input-password" />
            {mode === 'register' && <small>Minstens 10 tekens.</small>}
          </label>
          {error && <p className="auth-error" role="alert" data-testid="auth-error">{error}</p>}
          <button type="submit" className="auth-submit" disabled={busy} data-testid="button-auth-submit">
            {busy ? 'Even geduld…' : mode === 'login' ? 'Inloggen' : 'Account maken'}
          </button>
        </form>
      </div>
    </div>
  );
}

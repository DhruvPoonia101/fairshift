import { ApiError, api } from './api.js';
import './pwa.js';
import { applyTranslations, initI18n, mountLanguageSwitcher, setSector } from './i18n.js';
import { createTour, tourStorage } from './tour.js';
import { toast } from './dom.js';
import { t } from './i18n.js';

const SESSION_COPY = 'fairshift.session.worker';

/**
 * The worker app must open with no signal, so the last session answer is kept on the phone (name, site,
 * the sector's report categories). It holds no password or token: the sign-in itself is an httpOnly cookie.
 */
const sessionCopy = {
  save(session) {
    try {
      localStorage.setItem(SESSION_COPY, JSON.stringify(session));
    } catch {
      // Private window: the app then needs a signal to open, as before.
    }
  },
  read() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_COPY));
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_COPY);
    } catch {
      // Nothing to clear.
    }
  },
};

/**
 * Common start-up for the worker and employer apps: language, session check, logout button.
 * Returns the session, or null after redirecting to the sign-in choices on the landing page.
 * @param {'worker' | 'admin'} role
 */
export async function bootApp(role) {
  await initI18n();
  mountLanguageSwitcher(document.getElementById('lang'));
  let session = null;
  try {
    session = await api('/me');
    if (role === 'worker' && session?.user.role === 'worker') sessionCopy.save(session);
  } catch (error) {
    // No signal (not an answer from the server): open from the saved copy. The server's own "no" (401) is not that.
    const saved = role === 'worker' && !(error instanceof ApiError) ? sessionCopy.read() : null;
    session = saved?.user?.role === 'worker' ? { ...saved, offline: true } : null;
  }
  if (session?.user.role !== role) {
    if (role === 'worker') sessionCopy.clear();
    location.replace(`/?need=${role}`);
    return null;
  }
  setSector(session.org.sector);
  applyTranslations();
  document.getElementById('org-name').textContent = session.org.name;
  document.getElementById('logout').addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        toast(t('common.logoutNeedsSignal'), 'alert'); // the cookie can only be cleared by the server
        return;
      }
    }
    sessionCopy.clear();
    location.assign('/');
  });
  // A running judge tour shows its guide panel on every real screen; the panel code loads only then.
  if (createTour(tourStorage()).isActive()) import('./tour-ui.js').then((tourUi) => tourUi.mountTour());
  return session;
}

/** Hash-based router: calls `render(name)` on load and whenever the hash or language changes. */
export function startRouter(views, defaultView, render) {
  const current = () => {
    const name = location.hash.slice(1);
    return name in views ? name : defaultView;
  };
  const run = () => render(current());
  window.addEventListener('hashchange', run);
  document.addEventListener('langchange', run);
  run();
}

import { api } from './api.js';
import './pwa.js';
import { applyTranslations, initI18n, mountLanguageSwitcher, setSector } from './i18n.js';

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
  } catch {
    session = null;
  }
  if (session?.user.role !== role) {
    location.replace(`/?need=${role}`);
    return null;
  }
  setSector(session.org.sector);
  applyTranslations();
  document.getElementById('org-name').textContent = session.org.name;
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    location.assign('/');
  });
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

export class ApiError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Which app this page is, so the server picks the matching session cookie (worker and employer can both be signed in). */
const APP = location.pathname.startsWith('/admin') ? 'admin' : 'worker';
const IN_APP = location.pathname.startsWith('/admin') || location.pathname.startsWith('/worker');

/**
 * Same-origin JSON call. The session cookie is httpOnly, so the script never sees a token.
 * @param {string} path path under /api
 * @param {{ method?: string, body?: unknown }} [options]
 */
export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-fairshift-app': APP, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (response.status === 401 && IN_APP) {
    // The session ended (expired or signed out elsewhere): go back to sign-in instead of showing errors.
    location.replace(`/?need=${APP}`);
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? 'server_error', data?.error?.details);
  }
  return data;
}

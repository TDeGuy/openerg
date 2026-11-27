/** Shared OAuth bits for Strava and Concept2. Pure (fetch only), unit tested. */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

export const REFRESH_SKEW_MS = 5 * 60_000;

export function formBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** A random value sent with each sign-in link; the service must send it back unchanged. */
export const newState = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Pulls `code` out of the redirect URL, or throws a readable error. `state` is the value sent with the link. */
export function parseRedirect(url: string, state: string): string {
  const q = url.split('#')[0].split('?')[1] ?? '';
  const p = new URLSearchParams(q);
  const err = p.get('error');
  if (err) throw new Error(err === 'access_denied' ? 'Access was denied.' : `Authorisation failed: ${err}`);
  if (p.get('state') !== state) throw new Error('The sign-in did not match this request. Try again.');
  const code = p.get('code');
  if (!code) throw new Error('The service did not return an authorisation code.');
  return code;
}

/** Returns the tokens untouched while still valid, otherwise refreshes them. */
export async function freshTokens(
  tokens: Tokens,
  refresh: (refreshToken: string) => Promise<Tokens>,
  now = Date.now(),
): Promise<Tokens> {
  return tokens.expiresAt - now > REFRESH_SKEW_MS ? tokens : refresh(tokens.refreshToken);
}

export async function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody(params),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) throw new Error(`Token request failed (${res.status}). ${String(json.message ?? json.error_description ?? json.error ?? '').slice(0, 200)}`.trim());
  return json;
}

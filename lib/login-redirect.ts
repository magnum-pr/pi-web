/**
 * Validation for the post-login redirect target.
 *
 * Unauthenticated requests carry a `next=` parameter so the user lands back
 * where they were. That parameter is attacker-controllable, so it must only ever
 * resolve to a path **on this origin** — otherwise `/login` becomes an open
 * redirect, which is a phishing primitive (a real-looking PiWeb URL that bounces
 * to somewhere hostile).
 *
 * Rules, each closing a known bypass:
 *   - must start with a single `/` (rejects absolute URLs like `https://evil`)
 *   - must NOT start with `//` or `/\` (protocol-relative: `//evil.com` is a
 *     valid absolute URL to a browser)
 *   - must not contain a backslash anywhere (browsers normalise `\` to `/`, so
 *     `/\evil.com` can behave like `//evil.com`)
 *   - must not contain control characters or whitespace
 *   - falls back to `/` for anything that fails
 */
export const DEFAULT_POST_LOGIN_PATH = "/";

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_POST_LOGIN_PATH;
  // Reject control chars and whitespace anywhere.
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return DEFAULT_POST_LOGIN_PATH;
  // ANY backslash, not just a leading one: browsers normalise `\` to `/`, so
  // `/path\to` becomes `/path/to` and `\/evil.com` behaves like `//evil.com`.
  if (raw.includes("\\")) return DEFAULT_POST_LOGIN_PATH;
  // Reject protocol-relative before the prefix check, since "//evil.com" does
  // start with "/".
  if (raw.startsWith("//")) return DEFAULT_POST_LOGIN_PATH;
  if (!raw.startsWith("/")) return DEFAULT_POST_LOGIN_PATH;
  // A bare "/" is fine; anything deeper is still a path on this origin.
  return raw;
}

/** Build the `/login` URL that preserves where the user was heading. */
export function loginUrlFor(pathWithQuery: string): string {
  const next = safeNextPath(pathWithQuery);
  if (next === DEFAULT_POST_LOGIN_PATH) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * ============================================================================
 * DEV-ONLY storefront-password cookie shim — NEVER SHIP TO PRODUCTION.
 * ============================================================================
 *
 * The dev store `theme-evolution-os2-hydrogen.myshopify.com` has the Liquid
 * storefront password enabled, and it cannot be disabled on a dev store
 * (platform constraint). Every /api/ucp/mcp request 302s to /password unless
 * a valid session cookie from a successful password submission is attached.
 * This module submits the password once, caches the resulting cookie, and
 * hands it back to app/lib/mcp.server.js as a `Cookie` header string.
 *
 * PROBED (2026-07-08, live dev store, plan §9.1 step 1a / AL-UCP-2 / AL-UCP-3):
 * - GET /password renders a form with:
 *     <input type="hidden" name="authenticity_token" value="...">
 *     <input type="password" name="password">
 *   action="/password" (POST, form-encoded).
 * - A correct POST returns HTTP 302 (Location: /) and sets a fresh
 *   `_shopify_essential` cookie (HttpOnly, Secure, SameSite=Lax, Max-Age=1y).
 *   CORRECTION vs the plan's assumption: there is NO cookie literally named
 *   `storefront_digest`. The session cookie that clears the gate is
 *   `_shopify_essential` (Shopify's standard essential-cookie bucket). The
 *   plan's `ensureStorefrontDigest()` name is kept for API stability with the
 *   rest of the migration, but the cookie it mints/caches is `_shopify_essential`.
 * - Attaching that cookie to POST /api/ucp/mcp yields HTTP 200/422 (i.e. the
 *   password gate is cleared — 422 in that probe was a *request-shape* error
 *   from an incomplete body, not a 302). This confirms AL-UCP-3: the shim
 *   DOES clear the 302. Full probe record: docs/plans/ucp-migration-impl-notes.md.
 * - Getting a fresh authenticity_token requires a prior GET /password (the
 *   token is single-use / tied to that page load's session). The shim
 *   therefore performs GET /password → parse token → POST /password on every
 *   (re)mint, not just a bare POST.
 *
 * Logging discipline (G4): never log the password, the cookie value, or the
 * authenticity_token. Log only coarse outcome (minted / cache-hit / failed).
 *
 * Gating (§3.4): this module activates ONLY when `env.DEV_STOREFRONT_PASSWORD`
 * is present. In a production build (no password env var) with no signed-
 * request signer configured, `ensureStorefrontDigest` raises a loud
 * `McpError('config_error', ...)` rather than allowing a caller to silently
 * loop against a 302.
 *
 * DEV-ENV FIX (2026-07-08, docs/bugs/ucp-dev-env-issue2-fix-notes.md — Issue #2):
 * CONFIRMED ROOT CAUSE via a repro that ran this exact GET/POST sequence
 * under both plain Node fetch and MiniOxygen's workerd sandbox, first
 * against a local mock and then against the live dev store: `redirect:
 * 'manual'` and `Headers.getSetCookie()` both behave IDENTICALLY in workerd
 * and Node — that was NOT the bug. The actual cause is that the live dev
 * store's bot-protection layer returns HTTP 403 "Access denied" to requests
 * with no `User-Agent` header. Node's native `fetch()` silently sends
 * `User-Agent: node` by default, which passes; workerd's native `fetch()`
 * sends no User-Agent at all, which the store blocks — before the password
 * form is ever reached. Fix: send an explicit browser-like `User-Agent`
 * (`DEV_SHIM_USER_AGENT`, app/lib/const.js) on both the GET and POST below.
 */

import {DEV_SHIM_USER_AGENT} from './const.js';
import {McpError} from './mcp-error.server.js';

const PASSWORD_PAGE_PATH = '/password';
const ESSENTIAL_COOKIE_NAME = '_shopify_essential';

/** @type {{cookie: string, mintedAt: number} | null} */
let cachedCookie = null;

/** @type {Promise<string> | null} */
let inFlightPromise = null;

// Soft TTL — best-effort only (AL-UCP-9: exact server-side lifetime unknown).
// The invalidate-on-302 re-mint path is the authoritative recovery mechanism;
// this TTL just avoids holding a very stale cookie indefinitely across a long
// -running dev server process.
const SOFT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Extracts the authenticity_token hidden-input value from the /password page HTML.
 *
 * @param {string} html
 * @returns {string | null}
 */
function extractAuthenticityToken(html) {
  const match = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Extracts a single named cookie's value from a Set-Cookie response header set.
 *
 * @param {Headers} headers
 * @param {string} name
 * @returns {string | null}
 */
function extractSetCookie(headers, name) {
  // The Fetch API's Headers.get('set-cookie') only returns the FIRST value in
  // most runtimes; getSetCookie() (where available, e.g. Node 18.14+/Oxygen)
  // returns all of them. Prefer getSetCookie when present.
  const raw =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);

  for (const entry of raw) {
    if (!entry) continue;
    const match = entry.match(new RegExp(`${name}=([^;]+)`));
    if (match) return `${name}=${match[1]}`;
  }
  return null;
}

/**
 * Performs the actual GET /password → POST /password round trip and returns
 * a `Cookie` header value string. Not single-flight-guarded itself — callers
 * (ensureStorefrontDigest) are responsible for the single-flight wrapper.
 *
 * @param {{storeDomain: string, password: string, fetchImpl: typeof fetch}} opts
 * @returns {Promise<string>}
 */
async function mintCookie({storeDomain, password, fetchImpl}) {
  const passwordPageUrl = `https://${storeDomain}${PASSWORD_PAGE_PATH}`;

  const pageRes = await fetchImpl(passwordPageUrl, {
    method: 'GET',
    // See DEV-ENV FIX banner at top of file: the store's bot-protection
    // layer 403s requests with no User-Agent, which workerd's fetch omits
    // by default (unlike Node's fetch, which sends "User-Agent: node").
    headers: {'User-Agent': DEV_SHIM_USER_AGENT},
  });
  if (!pageRes.ok) {
    throw new McpError('config_error', {
      reason: 'password_page_unreachable',
      status: pageRes.status,
    });
  }
  const html = await pageRes.text();
  const authenticityToken = extractAuthenticityToken(html);
  if (!authenticityToken) {
    throw new McpError('config_error', {
      reason: 'authenticity_token_not_found',
    });
  }

  const body = new URLSearchParams({
    form_type: 'storefront_password',
    authenticity_token: authenticityToken,
    password,
  });

  const postRes = await fetchImpl(passwordPageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // See DEV-ENV FIX banner at top of file — same 403-without-UA cause
      // applies to the POST leg.
      'User-Agent': DEV_SHIM_USER_AGENT,
    },
    body: body.toString(),
    redirect: 'manual',
  });

  // A correct password yields a 302 redirect + Set-Cookie. An incorrect
  // password re-renders the form (200) with no fresh essential cookie set.
  const cookie = extractSetCookie(postRes.headers, ESSENTIAL_COOKIE_NAME);
  if (!cookie) {
    throw new McpError('config_error', {
      reason: 'password_rejected_or_cookie_not_set',
      status: postRes.status,
    });
  }

  return cookie;
}

/**
 * Returns a `Cookie` header string that clears the storefront password gate
 * on /api/ucp/mcp. Mints once, caches in-memory, and single-flights
 * concurrent callers so a burst of requests after a cold start (or after an
 * invalidation) issues exactly ONE /password POST (AL-UCP-10, firm
 * requirement — required change #6).
 *
 * DEV-ONLY hard gate: throws a loud config_error if `password` is absent.
 * The caller (mcp.server.js) is responsible for deciding whether to call
 * this at all — see the production gate note in mcp.server.js.
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   fetchImpl?: typeof fetch,
 *   forceRemint?: boolean,
 * }} opts
 * @returns {Promise<string>} a `Cookie` header value, e.g. "_shopify_essential=..."
 * @throws {McpError} code 'config_error' when the password is absent or minting fails
 */
export async function ensureStorefrontDigest({
  storeDomain,
  password,
  fetchImpl = fetch,
  forceRemint = false,
}) {
  if (!password) {
    // Hard gate (§3.4): never silently no-op. The caller must have already
    // decided the shim should run (password env var present) before calling
    // this function; reaching here with no password is a config error, not
    // a soft fallback.
    throw new McpError('config_error', {
      reason: 'dev_storefront_password_missing',
    });
  }

  if (forceRemint) {
    cachedCookie = null;
  }

  const isFresh =
    cachedCookie && Date.now() - cachedCookie.mintedAt < SOFT_TTL_MS;
  if (isFresh) {
    return cachedCookie.cookie;
  }

  // Single-flight: if a mint is already in progress, await the same promise
  // instead of issuing a second /password POST.
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const cookie = await mintCookie({storeDomain, password, fetchImpl});
      cachedCookie = {cookie, mintedAt: Date.now()};
      return cookie;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

/**
 * Invalidates the cached cookie so the next `ensureStorefrontDigest()` call
 * re-mints. Called by mcp.server.js when a /api/ucp/mcp request 302s (cookie
 * rejected/expired) — the bounded single re-mint-and-retry path (AL-UCP-9).
 */
export function invalidateStorefrontDigest() {
  cachedCookie = null;
}

// Test-only reset hook — not used by production code paths.
export function __resetForTests() {
  cachedCookie = null;
  inFlightPromise = null;
}

/**
 * Unit tests for app/lib/ucp-auth.server.js — the DEV-ONLY storefront-password
 * cookie shim.
 *
 * Run: node --test app/lib/ucp-auth.server.test.js
 *   or: npm run test:unit (see package.json)
 *
 * Covers (plan §4 / §9.1 step 4 / §10.4, required change #6):
 *   (a) cookie parsed from Set-Cookie
 *   (b) second call does not re-POST (cache hit)
 *   (c) invalidate-and-re-mint-once path
 *   (d) single-flight concurrency — two concurrent callers with no cached
 *       cookie trigger exactly ONE /password POST and both receive the same
 *       cookie.
 *
 * Also covers the dev-env Issue #2 fix (docs/bugs/ucp-dev-env-issue2-fix-notes.md):
 *   (e) the shim sends a non-empty User-Agent header on both the GET and the
 *       POST — the CONFIRMED root cause was that MiniOxygen's workerd fetch
 *       sends no User-Agent by default, and the live dev store's
 *       bot-protection layer 403s User-Agent-less requests (Node's fetch
 *       silently sends "User-Agent: node", masking the issue there).
 *   (f) a workerd-style 403-with-no-Set-Cookie response (simulating the
 *       bot-protection block) surfaces as the same loud config_error as any
 *       other rejected mint — regression guard for the exact failure mode
 *       observed in MiniOxygen.
 */

import {test, describe, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureStorefrontDigest,
  invalidateStorefrontDigest,
  __resetForTests,
} from './ucp-auth.server.js';
import {McpError} from './mcp-error.server.js';

const PASSWORD_PAGE_HTML = `
<form action="/password" method="post">
  <input type="hidden" name="authenticity_token" value="test-token-123">
  <input type="password" name="password">
</form>
`;

/**
 * Builds a fake fetchImpl that serves GET /password with a token page and
 * POST /password with a 302 + Set-Cookie response, tracking call counts and
 * (for test (e)) the headers each request carried.
 *
 * @param {{cookieValue?: string, rejectPassword?: boolean}} [opts]
 */
function makeFakeFetch(opts = {}) {
  const {cookieValue = 'abc123', rejectPassword = false} = opts;
  const calls = {get: 0, post: 0};
  /** @type {Array<{method: string, userAgent: string | null}>} */
  const requestLog = [];

  const fetchImpl = async (url, init) => {
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers ?? {});
    const userAgent = headers.get('User-Agent');
    requestLog.push({method, userAgent});

    if (method === 'GET') {
      calls.get += 1;
      return new Response(PASSWORD_PAGE_HTML, {status: 200});
    }
    // POST
    calls.post += 1;
    if (rejectPassword) {
      // Incorrect password: form re-renders, no fresh essential cookie.
      return new Response(PASSWORD_PAGE_HTML, {status: 200});
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': `_shopify_essential=${cookieValue}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  };

  return {fetchImpl, calls, requestLog};
}

describe('ensureStorefrontDigest', () => {
  beforeEach(() => {
    __resetForTests();
  });

  test('(a) parses the cookie from Set-Cookie and returns it as a Cookie header value', async () => {
    const {fetchImpl} = makeFakeFetch({cookieValue: 'xyz789'});

    const cookie = await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });

    assert.equal(cookie, '_shopify_essential=xyz789');
  });

  test('(b) second call does not re-POST (cache hit)', async () => {
    const {fetchImpl, calls} = makeFakeFetch();

    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });
    assert.equal(calls.post, 1, 'first call mints once');

    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });
    assert.equal(calls.post, 1, 'second call must be a cache hit, no re-POST');
  });

  test('(c) invalidateStorefrontDigest() forces exactly one re-mint on the next call', async () => {
    const {fetchImpl, calls} = makeFakeFetch();

    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });
    assert.equal(calls.post, 1);

    invalidateStorefrontDigest();

    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });
    assert.equal(
      calls.post,
      2,
      'invalidation must trigger exactly one re-mint',
    );

    // Cache hit again afterwards — no further POSTs.
    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });
    assert.equal(calls.post, 2, 'post-remint call must be a cache hit');
  });

  test('(d) single-flight concurrency: two concurrent callers with no cached cookie trigger exactly ONE /password POST and both receive the same cookie', async () => {
    const {fetchImpl, calls} = makeFakeFetch({cookieValue: 'shared-cookie'});

    const [cookieA, cookieB] = await Promise.all([
      ensureStorefrontDigest({
        storeDomain: 'example.myshopify.com',
        password: 'sekrit',
        fetchImpl,
      }),
      ensureStorefrontDigest({
        storeDomain: 'example.myshopify.com',
        password: 'sekrit',
        fetchImpl,
      }),
    ]);

    assert.equal(
      calls.post,
      1,
      'exactly one /password POST for two concurrent callers',
    );
    assert.equal(cookieA, '_shopify_essential=shared-cookie');
    assert.equal(cookieB, '_shopify_essential=shared-cookie');
    assert.equal(
      cookieA,
      cookieB,
      'both concurrent callers receive the same cookie',
    );
  });

  test('raises a loud config_error McpError when the password is absent (hard gate, §3.4)', async () => {
    const {fetchImpl} = makeFakeFetch();

    await assert.rejects(
      () =>
        ensureStorefrontDigest({
          storeDomain: 'example.myshopify.com',
          password: undefined,
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'dev_storefront_password_missing');
        return true;
      },
    );
  });

  test('raises a loud config_error McpError when the password is rejected (no fresh cookie set)', async () => {
    const {fetchImpl} = makeFakeFetch({rejectPassword: true});

    await assert.rejects(
      () =>
        ensureStorefrontDigest({
          storeDomain: 'example.myshopify.com',
          password: 'wrong-password',
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'config_error');
        return true;
      },
    );
  });

  test('(e) sends a non-empty User-Agent header on both the GET and the POST (dev-env Issue #2 regression guard)', async () => {
    const {fetchImpl, requestLog} = makeFakeFetch({cookieValue: 'ua-check'});

    await ensureStorefrontDigest({
      storeDomain: 'example.myshopify.com',
      password: 'sekrit',
      fetchImpl,
    });

    assert.equal(requestLog.length, 2, 'expected exactly one GET + one POST');
    const [getReq, postReq] = requestLog;
    assert.equal(getReq.method, 'GET');
    assert.equal(postReq.method, 'POST');
    assert(
      typeof getReq.userAgent === 'string' && getReq.userAgent.length > 0,
      'GET /password must carry a non-empty User-Agent header — its absence ' +
        'is the confirmed root cause of the workerd 403 (docs/bugs/ucp-dev-env-issue2-fix-notes.md)',
    );
    assert(
      typeof postReq.userAgent === 'string' && postReq.userAgent.length > 0,
      'POST /password must carry a non-empty User-Agent header — its absence ' +
        'is the confirmed root cause of the workerd 403 (docs/bugs/ucp-dev-env-issue2-fix-notes.md)',
    );
  });

  test('(f) a workerd-style bot-protection 403 (no Set-Cookie at all) surfaces as a loud config_error, not a silent failure', async () => {
    // Simulates the CONFIRMED workerd failure mode isolated by the repro:
    // a User-Agent-less request gets a 403 with zero Set-Cookie headers on
    // both legs. This test exercises that response shape directly (rather
    // than depending on the shim's own User-Agent behavior) so it remains a
    // regression guard even if a future change alters how the header is
    // sent: the store rejecting the GET must still surface as a loud
    // config_error, never a silent failure.
    const blockingFetchImpl = async () =>
      new Response('Access denied', {status: 403});

    await assert.rejects(
      () =>
        ensureStorefrontDigest({
          storeDomain: 'example.myshopify.com',
          password: 'sekrit',
          fetchImpl: blockingFetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'password_page_unreachable');
        return true;
      },
    );
  });
});

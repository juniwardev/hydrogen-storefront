/**
 * Unit tests for mcp.server.js (callTool) — UCP MCP envelope + rate-limit handling.
 * Uses Node's built-in test runner — zero new dependencies.
 *
 * Run: node --test app/lib/mcp.server.test.js
 *   or: npm run test:unit
 *
 * Mandatory coverage per plan (§9.1 step 9, §10.4, required changes #5):
 *   - structuredContent (primary) envelope parse
 *   - content[0].text defensive fallback parse
 *   - HTTP 429 + Retry-After → rate_limited
 *   - JSON-RPC -32000-in-a-200-body + Retry-After → rate_limited (this is the
 *     gap the retired /api/mcp callTool had: it threw on HTTP 429 BEFORE
 *     parsing the body, so a -32000 rate-limit body would have been
 *     mis-mapped as a generic rpc_error)
 *   - tool_error (business outcome, result.isError true)
 *
 * callTool now requires storeDomain/password/profileUrl (UCP Component
 * Contract + DEV-ONLY shim) in addition to name/args, so every fixture below
 * supplies a fake fetchImpl that ALSO serves the ucp-auth.server.js
 * GET/POST /password round trip the shim performs internally.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {UCP_AUTH_MODES} from './const.js';
import {
  callTool,
  createCart,
  updateCart,
  createCheckout,
  McpError,
} from './mcp.server.js';
import {__resetForTests} from './ucp-auth.server.js';

const FAKE_PASSWORD_PAGE = `
<form action="/password" method="post">
  <input type="hidden" name="authenticity_token" value="test-token">
  <input type="password" name="password">
</form>
`;

/**
 * Builds a fetchImpl that transparently serves the /password shim round trip
 * (GET page + POST mint) and delegates any other request to `handleMcpCall`.
 *
 * @param {(url: string, init: object) => Promise<Response>} handleMcpCall
 */
function withPasswordShim(handleMcpCall) {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    if (typeof url === 'string' && url.includes('/password')) {
      if (method === 'GET') {
        return new Response(FAKE_PASSWORD_PAGE, {status: 200});
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie':
            '_shopify_essential=fake-cookie; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
      });
    }
    return handleMcpCall(url, init);
  };
}

/**
 * Builds a fetchImpl for `authMode:'none'` cases with NO `/password`
 * handling at all — deliberately plain, unlike `withPasswordShim`. If the
 * `none` path ever accidentally invokes the shim, any GET/POST to
 * `/password` falls through to this fetchImpl's own request log rather than
 * being silently served, making "the shim was never called" a structural
 * assertion (§7b test 2) instead of an inference.
 *
 * @param {(url: string, init: object) => Promise<Response>} handleMcpCall
 * @param {{calls: Array<{url: string, init: object}>}} [log] optional shared
 *   array the caller can inspect after the fact
 */
function plainFetch(handleMcpCall, log) {
  return async (url, init) => {
    if (log) log.calls.push({url, init});
    return handleMcpCall(url, init);
  };
}

const BASE_OPTS = {
  storeDomain: 'example.myshopify.com',
  password: 'dev-password',
  profileUrl:
    'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json',
  name: 'search_catalog',
  args: {catalog: {query: 'snowboard'}},
};

describe('callTool — config gate', () => {
  test('throws config_error McpError when password is absent (DEV-ONLY hard gate)', async () => {
    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          fetchImpl: withPasswordShim(
            async () => new Response(null, {status: 200}),
          ),
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        return true;
      },
    );
  });
});

describe('callTool — UCP envelope parsing', () => {
  test('__resetForTests before each envelope test', () => {
    __resetForTests();
  });

  test('parses result.structuredContent as the primary payload', async () => {
    __resetForTests();
    const successPayload = {
      products: [{id: 'gid://shopify/Product/1', title: 'Test'}],
    };
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              structuredContent: successPayload,
              content: [{type: 'text', text: JSON.stringify(successPayload)}],
              isError: false,
            },
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    const result = await callTool({...BASE_OPTS, fetchImpl});
    assert.deepEqual(result, successPayload);
  });

  test('falls back to content[0].text when structuredContent is absent', async () => {
    __resetForTests();
    const successPayload = {products: []};
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [{type: 'text', text: JSON.stringify(successPayload)}],
              isError: false,
            },
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    const result = await callTool({...BASE_OPTS, fetchImpl});
    assert.deepEqual(result, successPayload);
  });

  test('throws tool_error McpError when result.isError is true (business outcome)', async () => {
    __resetForTests();
    const errorPayload = {
      ucp: {status: 'error'},
      messages: [{type: 'error', code: 'invalid_cart_id', content: 'bad id'}],
    };
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              structuredContent: errorPayload,
              isError: true,
            },
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, name: 'update_cart', fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'tool_error');
        assert.deepEqual(err.detail.payload, errorPayload);
        return true;
      },
    );
  });

  test('injects meta.ucp-agent.profile into the tools/call request body', async () => {
    __resetForTests();
    let capturedBody;
    const fetchImpl = withPasswordShim(async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {structuredContent: {products: []}, isError: false},
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    await callTool({...BASE_OPTS, fetchImpl});

    assert.equal(
      capturedBody.params.arguments.meta['ucp-agent'].profile,
      BASE_OPTS.profileUrl,
    );
  });

  test('attaches the shim Cookie header to the /api/ucp/mcp request', async () => {
    __resetForTests();
    let capturedHeaders;
    const fetchImpl = withPasswordShim(async (url, init) => {
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {structuredContent: {products: []}, isError: false},
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    await callTool({...BASE_OPTS, fetchImpl});

    assert.equal(capturedHeaders.Cookie, '_shopify_essential=fake-cookie');
  });
});

describe('callTool — rate-limit handling (required change #5)', () => {
  test('HTTP 429 path: throws rate_limited McpError with retryAfterMs in ms', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(null, {
          status: 429,
          headers: new Headers({'Retry-After': '2'}),
        }),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.detail.retryAfterMs, 2000);
        return true;
      },
    );
  });

  test('HTTP 429 path: retryAfterMs defaults to 0 when Retry-After header is absent', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () => new Response(null, {status: 429}),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.detail.retryAfterMs, 0);
        return true;
      },
    );
  });

  test('-32000-in-body path (MANDATORY, change #5): a 200 response with a JSON-RPC -32000 error AND a Retry-After header maps to rate_limited with retryAfterMs, NOT a generic rpc_error', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {code: -32000, message: 'Rate limit exceeded'},
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '5',
            },
          },
        ),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(
          err.code,
          'rate_limited',
          'a -32000 body must map to rate_limited, not rpc_error — this is the exact gap the retired /api/mcp callTool had',
        );
        assert.equal(
          err.detail.retryAfterMs,
          5000,
          'Retry-After must be honored in the -32000-in-body path too, not just the HTTP-429 path',
        );
        return true;
      },
    );
  });

  test('-32000-in-body path: retryAfterMs defaults to 0 when Retry-After header is absent', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {code: -32000, message: 'Rate limit exceeded'},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.detail.retryAfterMs, 0);
        return true;
      },
    );
  });

  test('non-rate-limit JSON-RPC error (e.g. -32603) still maps to generic rpc_error', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {code: -32603, message: 'Internal error'},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'rpc_error');
        return true;
      },
    );
  });

  test('non-429 HTTP error status throws http_error McpError', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () => new Response(null, {status: 503}),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'http_error');
        assert.equal(err.detail.status, 503);
        return true;
      },
    );
  });
});

describe('callTool — 302 password-gate retry', () => {
  test('a 302 response triggers exactly one invalidate-and-remint retry, then succeeds', async () => {
    __resetForTests();
    let mcpCallCount = 0;
    const fetchImpl = withPasswordShim(async () => {
      mcpCallCount += 1;
      if (mcpCallCount === 1) {
        return new Response(null, {
          status: 302,
          headers: {Location: '/password'},
        });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {structuredContent: {products: []}, isError: false},
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    const result = await callTool({...BASE_OPTS, fetchImpl});
    assert.deepEqual(result, {products: []});
    assert.equal(mcpCallCount, 2, 'must retry exactly once after a 302');
  });

  test('a persistent 302 after the bounded retry throws config_error (not an infinite loop)', async () => {
    __resetForTests();
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(null, {status: 302, headers: {Location: '/password'}}),
    );

    await assert.rejects(
      () => callTool({...BASE_OPTS, fetchImpl}),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        return true;
      },
    );
  });
});

/**
 * §7b (docs/plans/ucp-no-auth-mode.md) — auth-mode coverage for the
 * UCP_AUTH_MODE seam. `none` cases use `plainFetch` (no `/password`
 * handling) so "the shim was never invoked" is a structural property, not an
 * inference from a passing assertion elsewhere.
 */
describe('callTool — auth modes', () => {
  test('1. authMode:none with password:undefined succeeds and returns structuredContent', async () => {
    __resetForTests();
    const successPayload = {products: [{id: 'gid://shopify/Product/1'}]};
    const fetchImpl = plainFetch(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {structuredContent: successPayload, isError: false},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    const result = await callTool({
      ...BASE_OPTS,
      password: undefined,
      authMode: UCP_AUTH_MODES.NONE,
      fetchImpl,
    });
    assert.deepEqual(result, successPayload);
  });

  test('2. authMode:none never invokes the /password shim', async () => {
    __resetForTests();
    const log = {calls: []};
    const fetchImpl = plainFetch(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {structuredContent: {products: []}, isError: false},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
      log,
    );

    await callTool({
      ...BASE_OPTS,
      password: undefined,
      authMode: UCP_AUTH_MODES.NONE,
      fetchImpl,
    });

    assert.equal(log.calls.length, 1, 'exactly one request: the MCP call');
    assert(
      !log.calls.some(({url}) => String(url).includes('/password')),
      'no GET/POST /password request — the shim must never be invoked on none',
    );
  });

  test('3. authMode:none sends no Cookie header and a non-empty User-Agent', async () => {
    __resetForTests();
    let capturedHeaders;
    const fetchImpl = plainFetch(async (url, init) => {
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {structuredContent: {products: []}, isError: false},
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    await callTool({
      ...BASE_OPTS,
      password: undefined,
      authMode: UCP_AUTH_MODES.NONE,
      fetchImpl,
    });

    assert.equal(
      'Cookie' in capturedHeaders,
      false,
      'no Cookie header key at all — never Cookie: undefined',
    );
    assert(
      typeof capturedHeaders['User-Agent'] === 'string' &&
        capturedHeaders['User-Agent'].length > 0,
      'a non-empty User-Agent header is present (AL-2 precautionary guard)',
    );
  });

  test('4. authMode:none against a gated store (302) throws config_error auth_mode_none_but_store_gated with no remint retry', async () => {
    __resetForTests();
    let callCount = 0;
    const fetchImpl = plainFetch(async () => {
      callCount += 1;
      return new Response(null, {status: 302, headers: {Location: '/'}});
    });

    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          authMode: UCP_AUTH_MODES.NONE,
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'auth_mode_none_but_store_gated');
        return true;
      },
    );
    assert.equal(
      callCount,
      1,
      'the tool endpoint is called exactly once — no remint retry on none',
    );
  });

  test('5. authMode:none still injects meta.ucp-agent.profile into the request body', async () => {
    __resetForTests();
    let capturedBody;
    const fetchImpl = plainFetch(async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {structuredContent: {products: []}, isError: false},
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    await callTool({
      ...BASE_OPTS,
      password: undefined,
      authMode: UCP_AUTH_MODES.NONE,
      fetchImpl,
    });

    assert.equal(
      capturedBody.params.arguments.meta['ucp-agent'].profile,
      BASE_OPTS.profileUrl,
    );
  });

  test('6. authMode:none still maps HTTP 429 to rate_limited with retryAfterMs (shared envelope logic not bypassed)', async () => {
    __resetForTests();
    const fetchImpl = plainFetch(
      async () =>
        new Response(null, {
          status: 429,
          headers: new Headers({'Retry-After': '3'}),
        }),
    );

    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          authMode: UCP_AUTH_MODES.NONE,
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.detail.retryAfterMs, 3000);
        return true;
      },
    );
  });

  test('7. authMode:signed throws config_error signed_mode_not_implemented with no network call', async () => {
    __resetForTests();
    const log = {calls: []};
    const fetchImpl = plainFetch(async () => {
      throw new Error('network call must not happen for signed mode');
    }, log);

    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          authMode: UCP_AUTH_MODES.SIGNED,
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'signed_mode_not_implemented');
        return true;
      },
    );
    assert.equal(log.calls.length, 0, 'no network call for the signed stub');
  });

  test('8. an unrecognized authMode throws config_error unknown_auth_mode with no network call', async () => {
    __resetForTests();
    const log = {calls: []};
    const fetchImpl = plainFetch(async () => {
      throw new Error('network call must not happen for an unknown mode');
    }, log);

    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          authMode: 'unknown',
          fetchImpl,
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'unknown_auth_mode');
        return true;
      },
    );
    assert.equal(log.calls.length, 0, 'no network call for an unknown mode');
  });

  test('9. authMode:dev-cookie explicit (password present) behaves identically to the omitted-default case', async () => {
    __resetForTests();
    const successPayload = {products: []};
    const fetchImpl = withPasswordShim(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {structuredContent: successPayload, isError: false},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );

    const result = await callTool({
      ...BASE_OPTS,
      authMode: UCP_AUTH_MODES.DEV_COOKIE,
      fetchImpl,
    });
    assert.deepEqual(result, successPayload);
  });

  test('10. authMode:dev-cookie with password:undefined still throws dev_storefront_password_missing, with a hint mentioning UCP_AUTH_MODE=none', async () => {
    await assert.rejects(
      () =>
        callTool({
          ...BASE_OPTS,
          password: undefined,
          authMode: UCP_AUTH_MODES.DEV_COOKIE,
          fetchImpl: withPasswordShim(
            async () => new Response(null, {status: 200}),
          ),
        }),
      (err) => {
        assert(err instanceof McpError);
        assert.equal(err.code, 'config_error');
        assert.equal(err.detail.reason, 'dev_storefront_password_missing');
        assert(
          err.detail.hint.includes('UCP_AUTH_MODE=none'),
          'the hint must lead with the UCP_AUTH_MODE=none remedy (Revision 2 Change 2)',
        );
        return true;
      },
    );
  });
});

/**
 * docs/plans/fix-ucp-cart-create-flat-shape.md §8 — createCart/updateCart
 * return-shape coverage. Pins the bug: a successful create_cart/update_cart
 * response is FLAT at structuredContent (no nested `.cart` key), live-probed
 * against ashford-quantum.myshopify.com
 * (docs/bugs/ucp-cart-create-flat-shape-investigation.md). Cases 1 and 3 fail
 * against the pre-fix `payload.cart ?? null` code and pass after the fix.
 * Cases 2 and 4 guard against the tempting-but-wrong bare `payload ?? null`
 * mis-fix, which would fabricate a truthy cart from a soft-error envelope.
 */
describe('createCart / updateCart — flat UCP cart payload', () => {
  const FLAT_CART_PAYLOAD = {
    id: 'gid://shopify/Cart/hWNEWlsFaRz4?key=abc',
    line_items: [{id: 'gid://shopify/CartLine/1', quantity: 1}],
    currency: 'USD',
    totals: [
      {type: 'subtotal', amount: 72995, display_text: 'Subtotal'},
      {type: 'total', amount: 72995, display_text: 'Total'},
    ],
    continue_url:
      'https://ashford-quantum.myshopify.com/cart/c/hWNEWlsFaRz4?key=abc',
    messages: [],
  };

  const SOFT_ERROR_PAYLOAD = {
    ucp: {status: 'error'},
    messages: [
      {type: 'error', code: 'some_soft_error', content: 'soft failure'},
    ],
  };

  /**
   * @param {object} fixture
   */
  function successFetch(fixture) {
    return plainFetch(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {structuredContent: fixture, isError: false},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );
  }

  test('1. createCart success (flat payload) returns a non-null cart carrying id/line_items/continue_url', async () => {
    __resetForTests();
    const result = await createCart({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 1}],
      fetchImpl: successFetch(FLAT_CART_PAYLOAD),
    });

    assert.notEqual(
      result.cart,
      null,
      'a successful create_cart must not yield cart:null',
    );
    assert.equal(result.cart.id, FLAT_CART_PAYLOAD.id);
    assert.equal(result.cart.continue_url, FLAT_CART_PAYLOAD.continue_url);
    assert.deepEqual(result.messages, []);
  });

  test('2. createCart soft-error payload (no id/cart fields) returns cart:null', async () => {
    __resetForTests();
    const result = await createCart({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 1}],
      fetchImpl: successFetch(SOFT_ERROR_PAYLOAD),
    });

    assert.equal(result.cart, null);
    assert.deepEqual(result.messages, SOFT_ERROR_PAYLOAD.messages);
  });

  test('3. updateCart success (flat payload) returns a non-null cart with id', async () => {
    __resetForTests();
    const result = await updateCart({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      cartId: FLAT_CART_PAYLOAD.id,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 2}],
      fetchImpl: successFetch(FLAT_CART_PAYLOAD),
    });

    assert.notEqual(
      result.cart,
      null,
      'a successful update_cart must not yield cart:null',
    );
    assert.equal(result.cart.id, FLAT_CART_PAYLOAD.id);
  });

  test('4. updateCart soft-error payload (no id/cart fields) returns cart:null', async () => {
    __resetForTests();
    const result = await updateCart({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      cartId: FLAT_CART_PAYLOAD.id,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 2}],
      fetchImpl: successFetch(SOFT_ERROR_PAYLOAD),
    });

    assert.equal(result.cart, null);
    assert.deepEqual(result.messages, SOFT_ERROR_PAYLOAD.messages);
  });
});

/**
 * docs/plans/fix-create-checkout-soft-error-gap.md §7 — createCheckout
 * soft-error guard coverage. Checkout is already flat (no `.checkout`
 * wrapper to unwrap, unlike the pre-fix cart bug), so case 1 (success)
 * passes even before the fix; case 2 (soft-error) is the pin — it fails
 * against the pre-fix `payload ?? null` and passes after
 * `payload?.id ? payload : null`.
 */
describe('createCheckout — soft-error guard', () => {
  const FLAT_CHECKOUT_PAYLOAD = {
    id: 'gid://shopify/Checkout/hWNEWo17abc',
    status: 'open',
    line_items: [{id: 'gid://shopify/CheckoutLine/1', quantity: 1}],
    totals: [{type: 'total', amount: 72995, display_text: 'Total'}],
    continue_url:
      'https://ashford-quantum.myshopify.com/checkout/c/hWNEWo17abc',
    messages: [],
  };

  const SOFT_ERROR_CHECKOUT_PAYLOAD = {
    continue_url: 'https://ashford-quantum.myshopify.com/',
    messages: [
      {
        type: 'error',
        code: 'invalid',
        content:
          'The merchandise with id gid://shopify/ProductVariant/99999999999999 does not exist.',
        severity: 'unrecoverable',
      },
    ],
    ucp: {status: 'error'},
  };

  /**
   * @param {object} fixture
   */
  function successFetch(fixture) {
    return plainFetch(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {structuredContent: fixture, isError: false},
          }),
          {status: 200, headers: {'Content-Type': 'application/json'}},
        ),
    );
  }

  test('1. createCheckout success (flat payload) returns a non-null checkout carrying id/continue_url', async () => {
    __resetForTests();
    const result = await createCheckout({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 1}],
      fetchImpl: successFetch(FLAT_CHECKOUT_PAYLOAD),
    });

    assert.notEqual(
      result.checkout,
      null,
      'a successful create_checkout must not yield checkout:null',
    );
    assert.equal(result.checkout.id, FLAT_CHECKOUT_PAYLOAD.id);
    assert.equal(
      result.checkout.continue_url,
      FLAT_CHECKOUT_PAYLOAD.continue_url,
    );
    assert.deepEqual(result.messages, []);
  });

  test('2. createCheckout soft-error payload (isError:false, no id) returns checkout:null', async () => {
    __resetForTests();
    const result = await createCheckout({
      storeDomain: BASE_OPTS.storeDomain,
      password: undefined,
      profileUrl: BASE_OPTS.profileUrl,
      authMode: UCP_AUTH_MODES.NONE,
      lineItems: [{variantId: 'gid://shopify/ProductVariant/1', quantity: 1}],
      fetchImpl: successFetch(SOFT_ERROR_CHECKOUT_PAYLOAD),
    });

    assert.equal(result.checkout, null);
    assert.deepEqual(result.messages, SOFT_ERROR_CHECKOUT_PAYLOAD.messages);
  });
});

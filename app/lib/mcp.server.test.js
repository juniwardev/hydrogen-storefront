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

import {callTool, McpError} from './mcp.server.js';
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

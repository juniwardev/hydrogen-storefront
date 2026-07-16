/**
 * UCP MCP client — SERVER ONLY.
 *
 * The .server.js suffix is mandatory: Remix/Vite never bundles this module
 * into the client graph. All calls originate from route actions/loaders.
 * Never import this file from a React component.
 *
 * Endpoint: https://{storeDomain}/api/ucp/mcp (migrated from the deprecated
 * /api/mcp per docs/plans/ucp-migration.md). PROBED live 2026-07-08:
 * search_catalog returns HTTP 200 with `result.structuredContent.products[]`
 * once the DEV-ONLY cookie shim (./ucp-auth.server.js) clears the storefront
 * password's 302 redirect. Full probe record: docs/plans/ucp-migration-impl-notes.md.
 *
 * Every request carries the UCP Component Contract: `meta.ucp-agent.profile`.
 * The profile URL is read from `context.env.PUBLIC_UCP_AGENT_PROFILE_URL`
 * (operator clarification on plan §5.2 — env var, not a hardcoded const),
 * mirroring how PUBLIC_STORE_DOMAIN / PUBLIC_STOREFRONT_API_TOKEN are read
 * elsewhere in this codebase.
 *
 * Logging discipline (G4): never log the raw user query, the storefront
 * password, the session cookie, or full MCP request/response payloads. Log
 * only coarse error category + status code on error paths to avoid PII leakage.
 */

import {
  MCP_TIMEOUT_MS,
  UCP_AUTH_MODES,
  UCP_CLIENT_USER_AGENT,
  UCP_DEFAULT_AUTH_MODE,
  UCP_MCP_PATH,
} from './const.js';
import {McpError} from './mcp-error.server.js';
import {
  ensureStorefrontDigest,
  invalidateStorefrontDigest,
} from './ucp-auth.server.js';

// Re-exported for backward-compatible imports (routes import McpError from
// here, matching the pre-migration API surface).
export {McpError};

/**
 * @param {{storeDomain: string}} opts
 * @returns {string}
 */
function mcpEndpoint({storeDomain}) {
  return `https://${storeDomain}${UCP_MCP_PATH}`;
}

/**
 * Builds the `meta.ucp-agent.profile` Component Contract object required on
 * every Phase-1 tool call (plan §5.1). `profileUrl` is read by the caller
 * from `context.env.PUBLIC_UCP_AGENT_PROFILE_URL` — this function does not
 * read env itself so it stays a pure helper.
 *
 * @param {string} profileUrl
 * @returns {{'ucp-agent': {profile: string}}}
 */
function buildMeta(profileUrl) {
  return {'ucp-agent': {profile: profileUrl}};
}

/**
 * Low-level JSON-RPC tools/call against /api/ucp/mcp with the DEV-ONLY cookie
 * shim, timeout, and full rate-limit + envelope handling.
 *
 * Envelope (§6.2, PROBED): success payload lives in `result.structuredContent`
 * (primary); `result.content[0].text` may also be present as a stringified
 * text mirror and is used only as a defensive fallback if structuredContent
 * is absent. Protocol errors are a top-level JSON-RPC `error` object (code
 * -32000/-32001/-32603 observed live). Business-outcome errors are a
 * *successful* result whose `structuredContent.messages[]` contains
 * type:"error" entries (e.g. invalid cart_id) — those are NOT thrown here;
 * callers inspect `messages[]` / `ucp.status` themselves (PROBED).
 *
 * Rate-limit coverage (§6.5, AL-UCP-13, required change #5): a rate limit can
 * arrive as a raw HTTP 429 OR as a JSON-RPC `-32000` error in a 200 body.
 * Both paths read the `Retry-After` header and map to
 * `McpError('rate_limited', {retryAfterMs})`.
 *
 * `fetchImpl` is injectable so both branches are unit-testable without a
 * live network (§10.4).
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   profileUrl: string,
 *   name: string,
 *   args: object,
 *   authMode?: 'none' | 'dev-cookie' | 'signed',
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   _isRetry?: boolean,
 * }} opts
 * @returns {Promise<object>} parsed structuredContent payload
 * @throws {McpError}
 */
export async function callTool({
  storeDomain,
  password,
  profileUrl,
  name,
  args,
  authMode = UCP_DEFAULT_AUTH_MODE,
  timeoutMs = MCP_TIMEOUT_MS,
  fetchImpl = fetch,
  _isRetry = false,
}) {
  const endpoint = mcpEndpoint({storeDomain});

  // Auth-mode switch (docs/plans/ucp-no-auth-mode.md §4): selects the
  // credential strategy BEFORE the shared envelope/rate-limit/timeout logic
  // below, which is identical for every mode. `cookie` stays undefined for
  // `none` — the headers builder below omits the Cookie header entirely
  // rather than sending `Cookie: undefined`.
  let cookie;
  if (authMode === UCP_AUTH_MODES.DEV_COOKIE) {
    // DEV-ONLY shim gate (§3.4): the shim runs only when the password env
    // var is present. If it is absent, there is no signer configured in
    // Phase 1 (Signed/Token tiers are Phase 2 — §4.4), so raise a loud
    // config error instead of attempting an unauthenticated call that will
    // 302-loop.
    if (!password) {
      const reason = 'dev_storefront_password_missing';
      console.error(`[mcp] config_error reason=${reason} tool=${name}`); // eslint-disable-line no-console
      throw new McpError('config_error', {
        reason,
        hint: 'Set UCP_AUTH_MODE=none for a public (password-disabled) storefront; or set DEV_STOREFRONT_PASSWORD in .env.local for a password-gated dev store; or configure a Signed-tier request signer (Phase 2, §4.4).',
      });
    }

    cookie = await ensureStorefrontDigest({
      storeDomain,
      password,
      fetchImpl,
    });
  } else if (authMode === UCP_AUTH_MODES.NONE) {
    // No shim, no Cookie header. `ucp-auth.server.js` is never touched on
    // this path (G2 by construction, §4).
  } else if (authMode === UCP_AUTH_MODES.SIGNED) {
    const reason = 'signed_mode_not_implemented';
    console.error(`[mcp] config_error reason=${reason} tool=${name}`); // eslint-disable-line no-console
    throw new McpError('config_error', {reason});
  } else {
    // `mode` is operator-set env, never a secret or user input, so it is
    // safe to include in `detail` for debugging a typo (§4.1). It is
    // intentionally left out of the console line to keep that line within
    // the project's line-length convention; `detail.mode` carries it instead.
    const reason = 'unknown_auth_mode';
    console.error(`[mcp] config_error reason=${reason} tool=${name}`); // eslint-disable-line no-console
    throw new McpError('config_error', {reason, mode: authMode});
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const headers = {'Content-Type': 'application/json'};
    if (authMode === UCP_AUTH_MODES.DEV_COOKIE) {
      headers.Cookie = cookie;
    } else if (authMode === UCP_AUTH_MODES.NONE) {
      // Precautionary belt-and-suspenders (AL-2/AL-7) — see
      // UCP_CLIENT_USER_AGENT's JSDoc in const.js for why this is not a
      // proven requirement for the cookieless MCP POST.
      headers['User-Agent'] = UCP_CLIENT_USER_AGENT;
    }

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name,
          arguments: {meta: buildMeta(profileUrl), ...args},
        },
      }),
    });

    // A 302 means the auth was rejected. Handling is mode-specific:
    // - dev-cookie: the cookie was rejected/expired (password gate
    //   re-engaged). Invalidate and retry ONCE with a freshly minted cookie
    //   (bounded retry, AL-UCP-9). A second 302 after a fresh mint is a
    //   genuine config/auth failure, not a loop candidate.
    // - none: the storefront is gated despite a `none` declaration. There is
    //   nothing to remint, so this is a config_error on the first 302 — no
    //   retry (docs/plans/ucp-no-auth-mode.md §4).
    if (res.status === 302 || res.status === 301) {
      if (authMode === UCP_AUTH_MODES.NONE) {
        const reason = 'auth_mode_none_but_store_gated';
        console.error(`[mcp] config_error reason=${reason} tool=${name}`); // eslint-disable-line no-console
        throw new McpError('config_error', {reason});
      }
      if (_isRetry) {
        const reason = 'password_gate_persists_after_remint';
        console.error(`[mcp] config_error reason=${reason} tool=${name}`); // eslint-disable-line no-console
        throw new McpError('config_error', {reason});
      }
      invalidateStorefrontDigest();
      return callTool({
        storeDomain,
        password,
        profileUrl,
        name,
        args,
        authMode,
        timeoutMs,
        fetchImpl,
        _isRetry: true,
      });
    }

    if (res.status === 429) {
      // Retry-After is in SECONDS (HTTP convention); convert to ms.
      const retryAfterSec = Number(res.headers.get('Retry-After') ?? 0);
      throw new McpError('rate_limited', {retryAfterMs: retryAfterSec * 1000});
    }

    if (!res.ok) {
      // Log only the status code, not the body (G4 — avoid PII/payload logging).
      console.error(`[mcp] http_error status=${res.status} tool=${name}`); // eslint-disable-line no-console
      throw new McpError('http_error', {status: res.status});
    }

    const data = await res.json();

    if (data.error) {
      // Rate-limit-as-protocol-error path (change #5, AL-UCP-13): UCP can
      // surface rate limiting as a JSON-RPC -32000 error in a 200 body while
      // ALSO honoring the HTTP Retry-After header. This branch MUST read
      // Retry-After here too, not just in the HTTP-429 branch above.
      if (data.error.code === -32000) {
        const retryAfterSec = Number(res.headers.get('Retry-After') ?? 0);
        throw new McpError('rate_limited', {
          retryAfterMs: retryAfterSec * 1000,
        });
      }
      console.error(`[mcp] rpc_error tool=${name} code=${data.error?.code}`); // eslint-disable-line no-console
      throw new McpError('rpc_error', {detail: data.error});
    }

    const result = data.result;
    if (!result) {
      throw new McpError('empty_result', {});
    }

    // structuredContent is authoritative (§6.2). Fall back defensively to
    // content[0].text only if structuredContent is absent.
    let payload = result.structuredContent;
    if (!payload) {
      if (Array.isArray(result.content) && result.content[0]?.text) {
        try {
          payload = JSON.parse(result.content[0].text);
        } catch {
          throw new McpError('rpc_error', {
            detail: 'invalid JSON in content[0].text fallback',
          });
        }
      } else {
        throw new McpError('empty_result', {});
      }
    }

    if (result.isError) {
      // tool_error: payload carries structuredContent.messages[] with
      // type:"error" entries (PROBED) for business-outcome failures like an
      // invalid/stale cart_id or an invalid variant GID.
      throw new McpError('tool_error', {payload});
    }

    return payload;
  } catch (e) {
    if (e instanceof McpError) throw e;
    if (e.name === 'AbortError') throw new McpError('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the UCP product catalog using free-text query.
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   profileUrl: string,
 *   query: string,
 *   context?: {address_country: string, language?: string, currency?: string},
 *   limit?: number,
 *   authMode?: 'none' | 'dev-cookie' | 'signed',
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{products: object[], pagination?: object}>}
 */
export async function searchCatalog({
  storeDomain,
  password,
  profileUrl,
  query,
  context,
  limit = 8,
  authMode,
  fetchImpl,
}) {
  const callOpts = {
    storeDomain,
    password,
    profileUrl,
    authMode,
    name: 'search_catalog',
    args: {
      catalog: {
        query,
        context: context ?? {address_country: 'US'},
        pagination: {limit},
      },
    },
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  return {
    products: payload.products ?? [],
    pagination: payload.pagination,
  };
}

/**
 * Creates a new assistant cart with the given line items.
 *
 * UCP `create_cart` argument shape (§5.3): `cart.line_items[].item.id` is the
 * variant GID — a different nested shape from the retired /api/mcp
 * `add_items[].product_variant_id`.
 *
 * Response shape (PROBED live 2026-07-15 against ashford-quantum.myshopify.com,
 * UCP no-auth mode): a successful create_cart payload is FLAT at
 * `structuredContent` — cart fields (`id`, `line_items`, `totals`,
 * `continue_url`, `messages`) sit at the top level, exactly like
 * search_catalog and create_checkout. There is NO nested `.cart` key. The
 * earlier "nested at structuredContent.cart" claim was inferred from Dev MCP
 * schema docs against the old dev store, where create_cart always crashed
 * upstream (-32603) so no successful response was ever observed. The flat
 * shape is the live-verified truth and matches the mcp-normalize.test.js
 * fixtures.
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   profileUrl: string,
 *   lineItems: Array<{variantId: string, quantity: number}>,
 *   authMode?: 'none' | 'dev-cookie' | 'signed',
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{cart: object | null, messages: object[]}>}
 */
export async function createCart({
  storeDomain,
  password,
  profileUrl,
  lineItems,
  authMode,
  fetchImpl,
}) {
  const callOpts = {
    storeDomain,
    password,
    profileUrl,
    authMode,
    name: 'create_cart',
    args: {
      cart: {
        line_items: lineItems.map(({variantId, quantity}) => ({
          item: {id: variantId},
          quantity,
        })),
      },
    },
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  // Success: the payload IS the flat cart object (id/line_items/totals/
  // continue_url/messages at top level) — mirror createCheckout, which unwraps
  // the whole payload. Guard on the cart's identifying `id` so a NON-thrown
  // soft business-outcome payload (isError:false with error messages[] and no
  // cart fields — see callTool's business-error contract) still yields
  // cart:null, preserving the route's defensive cart-presence check.
  return {
    cart: payload?.id ? payload : null,
    messages: payload?.messages ?? [],
  };
}

/**
 * Full-replace update of an existing assistant cart's line items (§6.4).
 * UCP `update_cart` is full-replace: callers MUST pass the entire desired
 * line-item set (existing lines + any new one), not just a delta — this
 * function does not do that carrying-forward itself; the route action is
 * responsible for assembling the full set before calling this.
 *
 * Cart ID goes on the top-level `id` argument (sibling of `meta`/`cart`),
 * per the schema (`required: ["meta","cart","id"]`) and Dev MCP examples.
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   profileUrl: string,
 *   cartId: string,
 *   lineItems: Array<{variantId: string, quantity: number}>,
 *   authMode?: 'none' | 'dev-cookie' | 'signed',
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{cart: object | null, messages: object[]}>}
 */
export async function updateCart({
  storeDomain,
  password,
  profileUrl,
  cartId,
  lineItems,
  authMode,
  fetchImpl,
}) {
  const callOpts = {
    storeDomain,
    password,
    profileUrl,
    authMode,
    name: 'update_cart',
    args: {
      id: cartId,
      cart: {
        line_items: lineItems.map(({variantId, quantity}) => ({
          item: {id: variantId},
          quantity,
        })),
      },
    },
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  // Same flat shape as create_cart (see createCart above): the payload IS the
  // cart object; there is no nested `.cart` key. Guard on `id` so a soft
  // business-outcome payload (no cart fields) still yields cart:null.
  return {
    cart: payload?.id ? payload : null,
    messages: payload?.messages ?? [],
  };
}

/**
 * Converts a cart into a checkout to obtain a checkout URL — FALLBACK ONLY
 * (§3.5): used when the cart response does not expose a usable
 * `continue_url` directly.
 *
 * AL-UCP-7 resolution (PROBED live, corrects the Dev MCP docs' prose): the
 * *captured tool schema* (`ucp-tools-list.json`) requires `checkout` with
 * `checkout.line_items` REGARDLESS of whether `cart_id` is supplied — the
 * live server enforces that schema literally ("Invalid arguments: object at
 * `/checkout` is missing required properties: line_items" when `checkout`
 * was omitted or empty, even with a top-level `cart_id` present). The docs'
 * claim that "checkout itself becomes optional" when `cart_id` is provided
 * did NOT hold against this store's live schema validation. Given the
 * primary handoff path is the cart's own `continue_url` (§3.5) and this
 * fallback only fires when that's absent, Phase 1 always resends
 * `checkout.line_items` rather than relying on `cart_id`-only conversion.
 * `cart_id`, when present, is still sent (nested in `checkout`, matching the
 * schema's only documented property path) as a hint for cart/checkout
 * association, but line_items are the load-bearing field.
 *
 * @param {{
 *   storeDomain: string,
 *   password: string | undefined,
 *   profileUrl: string,
 *   cartId?: string,
 *   lineItems: Array<{variantId: string, quantity: number}>,
 *   authMode?: 'none' | 'dev-cookie' | 'signed',
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{checkout: object | null, messages: object[]}>}
 */
export async function createCheckout({
  storeDomain,
  password,
  profileUrl,
  cartId,
  lineItems,
  authMode,
  fetchImpl,
}) {
  const checkout = {
    line_items: lineItems.map(({variantId, quantity}) => ({
      item: {id: variantId},
      quantity,
    })),
  };
  if (cartId) checkout.cart_id = cartId;

  const callOpts = {
    storeDomain,
    password,
    profileUrl,
    authMode,
    name: 'create_checkout',
    args: {checkout},
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  // Success: checkout fields are FLAT at structuredContent (id, status,
  // messages, continue_url, totals[], line_items[]) — the same flat shape as
  // the cart tools (create_cart / update_cart) and search_catalog. There is no
  // .checkout wrapper to unwrap. Guard on the checkout's identifying `id` so a
  // NON-thrown soft business-outcome payload (isError:false with error
  // messages[] and no checkout fields — top-level keys continue_url/messages/
  // ucp, no id, PROBED live) yields checkout:null instead of a junk checkout,
  // mirroring createCart/updateCart's identity guard.
  return {
    checkout: payload?.id ? payload : null,
    messages: payload?.messages ?? [],
  };
}

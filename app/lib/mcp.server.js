/**
 * MCP client — SERVER ONLY.
 *
 * The .server.js suffix is mandatory: Remix/Vite never bundles this module
 * into the client graph. All calls originate from route actions/loaders.
 * Never import this file from a React component.
 *
 * Single endpoint: https://{storeDomain}/api/mcp (PROBED, §0.1).
 * No agent profile, no auth token required for the tools in scope.
 *
 * Logging discipline (G4): never log the raw user query or full MCP
 * request/response payloads. Log only coarse error category + status code
 * on error paths to avoid PII leakage.
 */

import {MCP_TIMEOUT_MS} from './const.js';

const MCP_PATH = '/api/mcp';

/**
 * @param {{storeDomain: string}} opts
 * @returns {string}
 */
function mcpEndpoint({storeDomain}) {
  return `https://${storeDomain}${MCP_PATH}`;
}

/**
 * Typed error for all MCP failure modes.
 *
 * @typedef {'rate_limited' | 'http_error' | 'rpc_error' | 'tool_error' | 'empty_result' | 'timeout' | 'config_error'} McpErrorCode
 */
export class McpError extends Error {
  /**
   * @param {McpErrorCode} code
   * @param {object} [detail]
   */
  constructor(code, detail = {}) {
    super(code);
    this.name = 'McpError';
    /** @type {McpErrorCode} */
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Low-level JSON-RPC tools/call with timeout, 429/Retry-After handling, and
 * error mapping. Parses result.content[0].text (stringified JSON per PROBED
 * envelope) and honors the boolean result.isError flag.
 *
 * `fetchImpl` is injectable so the 429/Retry-After branch is unit-testable
 * without a live network (required change #3 / §8.4).
 *
 * @param {{
 *   endpoint: string,
 *   name: string,
 *   args: object,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<object>} parsed content[0].text payload
 * @throws {McpError}
 */
export async function callTool({
  endpoint,
  name,
  args,
  timeoutMs = MCP_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {name, arguments: args},
      }),
    });

    if (res.status === 429) {
      // Retry-After is in SECONDS (HTTP convention, AL-14); convert to ms.
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
      console.error(`[mcp] rpc_error tool=${name} code=${data.error?.code}`); // eslint-disable-line no-console
      throw new McpError('rpc_error', {detail: data.error});
    }

    const result = data.result;
    if (!result || !Array.isArray(result.content) || !result.content[0]) {
      throw new McpError('empty_result', {});
    }

    // PROBED: payload is stringified JSON in content[0].text.
    // content[1].text is a deprecation notice — ignore it.
    let payload;
    try {
      payload = JSON.parse(result.content[0].text);
    } catch {
      throw new McpError('rpc_error', {
        detail: 'invalid JSON in content[0].text',
      });
    }

    if (result.isError) {
      // tool_error: payload may carry .errors[] with field/message for stale-cart detection
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
 * Search the MCP product catalog using free-text query.
 *
 * @param {{
 *   storeDomain: string,
 *   query: string,
 *   context?: {address_country: string, language?: string, currency?: string},
 *   limit?: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{products: object[], pagination?: object}>}
 */
export async function searchCatalog({
  storeDomain,
  query,
  context,
  limit = 8,
  fetchImpl,
}) {
  const endpoint = mcpEndpoint({storeDomain});
  const callOpts = {
    endpoint,
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
 * Get detailed product information by GID.
 *
 * @param {{
 *   storeDomain: string,
 *   productId: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<object>} raw product detail object
 */
export async function getProductDetails({storeDomain, productId, fetchImpl}) {
  const endpoint = mcpEndpoint({storeDomain});
  const callOpts = {
    endpoint,
    name: 'get_product_details',
    // PROBED: flat argument `product_id`, NOT a catalog.id wrapper (probe 4)
    args: {product_id: productId},
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  // PROBED: response shape is {product: {...}}
  return payload.product ?? payload;
}

/**
 * Add items to a cart (or create a new cart when cartId is omitted).
 *
 * @param {{
 *   storeDomain: string,
 *   cartId?: string,
 *   addItems: Array<{product_variant_id: string, quantity: number}>,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{cart: object, errors: object[]}>}
 */
export async function updateCart({storeDomain, cartId, addItems, fetchImpl}) {
  const endpoint = mcpEndpoint({storeDomain});
  // PROBED: array key is `add_items`, line-item field is `product_variant_id` (probe 5)
  const args = {add_items: addItems};
  if (cartId) args.cart_id = cartId;

  const callOpts = {endpoint, name: 'update_cart', args};
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  return {
    cart: payload.cart ?? null,
    errors: payload.errors ?? [],
  };
}

/**
 * Retrieve the current state of a cart.
 *
 * @param {{
 *   storeDomain: string,
 *   cartId: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{cart: object, errors: object[]}>}
 */
export async function getCart({storeDomain, cartId, fetchImpl}) {
  const endpoint = mcpEndpoint({storeDomain});
  const callOpts = {
    endpoint,
    name: 'get_cart',
    args: {cart_id: cartId},
  };
  if (fetchImpl) callOpts.fetchImpl = fetchImpl;

  const payload = await callTool(callOpts);
  return {
    cart: payload.cart ?? null,
    errors: payload.errors ?? [],
  };
}

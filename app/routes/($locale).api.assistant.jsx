import {json} from '@shopify/remix-oxygen';

import {ASSISTANT_RESULT_LIMIT, UCP_DEFAULT_AUTH_MODE} from '~/lib/const';
import {
  McpError,
  createCart,
  createCheckout,
  searchCatalog,
  updateCart,
} from '~/lib/mcp.server';
import {
  normalizeCart,
  normalizeCatalogProducts,
  normalizeCheckout,
} from '~/lib/mcp-normalize';

/** @typedef {import('@shopify/remix-oxygen').ActionFunctionArgs} ActionFunctionArgs */

/**
 * POST /api/assistant (and locale-prefixed equivalents).
 *
 * Request (form-encoded): {intent, message?, variantId?, cartId?}
 *
 * Response (JSON):
 *   {reply: string, products?: AssistantProduct[],
 *    cart?: AssistantCart, cartReset?: boolean, error?: {type, message, retryAfterMs?}}
 *
 * Design constraints:
 * - ALL MCP calls are server-side only. The browser never receives endpoint URLs,
 *   the storefront password, the session cookie, or raw MCP payloads.
 * - `error` is returned ONLY for genuine failures. A successful search that
 *   returns zero products yields {products: []} with NO error (required change #2).
 *   Empty results and error states are never conflated.
 * - Stale-cart path (required change #4): if createCart/updateCart fails with a
 *   cart_id error, the action clears the stored cartId and retries once without it
 *   (fresh cart via createCart), then sets cartReset:true so the UI can show
 *   "started a new cart".
 * - "detail" intent removed in the UCP migration (plan §9.1 step 7a, §6.7a):
 *   the retired /api/mcp get_product_details tool has no UCP Phase-1 equivalent
 *   wired here (UCP's get_product is a Phase-2 candidate). A client that still
 *   POSTs intent:"detail" falls through to the default/unknown-intent branch.
 *
 * @param {ActionFunctionArgs}
 */
export async function action({request, params, context}) {
  // 1. Locale guard — mirrors ($locale).api.newsletter.jsx verbatim (AL-17)
  const {language, country} = context.storefront.i18n;
  if (
    params.locale &&
    params.locale.toLowerCase() !== `${language}-${country}`.toLowerCase()
  ) {
    throw new Response(null, {status: 404});
  }

  // 2. Config guard — read PUBLIC_STORE_DOMAIN and the UCP config from
  // context.env, not a global. Per the operator clarification on plan §5.2,
  // the agent profile URL is an env var (PUBLIC_UCP_AGENT_PROFILE_URL), read
  // the same way PUBLIC_STORE_DOMAIN / PUBLIC_STOREFRONT_API_TOKEN are read
  // elsewhere. DEV_STOREFRONT_PASSWORD is DEV-ONLY and may be legitimately
  // absent in production (§3.4) — its absence is handled inside
  // mcp.server.js's callTool() as a loud config_error, not here.
  // UCP_AUTH_MODE (docs/plans/ucp-no-auth-mode.md) declares the credential
  // strategy: 'none' (public storefront), 'dev-cookie' (password-gated dev
  // store, the default), or 'signed' (Phase-2 seam, not implemented).
  // Validated inside callTool(), not here (AL-6) — an unrecognized value
  // throws a loud config_error at request time.
  const storeDomain = context.env.PUBLIC_STORE_DOMAIN;
  const profileUrl = context.env.PUBLIC_UCP_AGENT_PROFILE_URL;
  const password = context.env.DEV_STOREFRONT_PASSWORD;
  const authMode = context.env.UCP_AUTH_MODE || UCP_DEFAULT_AUTH_MODE;

  if (!storeDomain || !profileUrl) {
    return json(
      {
        error: {
          type: 'config_error',
          message: 'The shopping assistant is not configured.',
        },
      },
      {status: 500},
    );
  }

  // 3. Parse and validate form data
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');
  // Cap message length at 500 chars; never interpolate into endpoint URLs.
  const message = String(formData.get('message') ?? '')
    .trim()
    .slice(0, 500);
  const variantId = String(formData.get('variantId') ?? '');
  // Treat empty string as "no cartId" — only pass a truthy cartId to MCP.
  const cartId = String(formData.get('cartId') ?? '') || null;

  const mcpBase = {storeDomain, password, profileUrl, authMode};

  try {
    switch (intent) {
      case 'search': {
        // search_catalog's `catalog` object has no schema-required fields
        // (neither `query` nor `filters` is schema-required — the server
        // enforces "at least one" at runtime, not via schema validation).
        // This guard remains necessary: schema validation will NOT catch an
        // empty query for us (plan §5.3 change #4 note).
        if (!message) {
          return json({
            error: {
              type: 'validation_error',
              message: 'Please enter a search query.',
            },
          });
        }

        const result = await searchCatalog({
          ...mcpBase,
          query: message,
          limit: ASSISTANT_RESULT_LIMIT,
        });

        const products = normalizeCatalogProducts(result.products);

        // IMPORTANT: empty products array is NOT an error (required change #2).
        // "shirt" against a snowboard-only store legitimately returns 0 results.
        // Return {products: []} with no error field; the UI renders the empty state.
        return json({
          reply:
            products.length > 0
              ? `Found ${products.length} product${
                  products.length !== 1 ? 's' : ''
                }.`
              : 'No matches found for that search.',
          products,
        });
      }

      case 'add': {
        if (!variantId) {
          return json({
            error: {
              type: 'validation_error',
              message: 'Variant ID is required.',
            },
          });
        }

        const newLine = {variantId, quantity: 1};

        try {
          const result = cartId
            ? // Full-replace semantics (§6.4): update_cart replaces the
              // ENTIRE line-item set. Phase 1 keeps the assistant cart
              // simple (typically one item at a time via this flow), but
              // if a future turn tracks multiple lines client-side they
              // MUST be carried forward here alongside newLine, or they
              // will be silently dropped by the full-replace semantics.
              await updateCart({
                ...mcpBase,
                cartId,
                lineItems: [newLine],
              })
            : await createCart({...mcpBase, lineItems: [newLine]});

          const cart = result.cart ? normalizeCart(result.cart) : null;
          if (!cart) {
            // Business-outcome failure without a thrown tool_error (defensive —
            // not observed live, but the messages[] contract allows it).
            return json({
              error: {
                type: 'tool_error',
                message: 'The assistant ran into a problem. Please try again.',
              },
            });
          }

          const reply = 'Added to your assistant cart — checkout here.';

          // Handoff URL: prefer the cart's own continue_url (§3.5, AL-UCP-6).
          // Only call create_checkout as a fallback when the cart response
          // does not expose a usable checkoutUrl.
          if (cart.checkoutUrl) {
            return json({reply, cart});
          }

          const checkoutResult = await createCheckout({
            ...mcpBase,
            cartId: cart.id,
            lineItems: [newLine],
          });
          const checkout = checkoutResult.checkout
            ? normalizeCheckout(checkoutResult.checkout)
            : null;

          return json({
            reply,
            cart: {...cart, checkoutUrl: checkout?.checkoutUrl},
          });
        } catch (addErr) {
          // Stale-cart path (required change #4): if the submitted cartId
          // caused a tool_error referencing an invalid/stale cart_id, clear
          // it and create a fresh cart by retrying without cart_id.
          if (
            addErr instanceof McpError &&
            addErr.code === 'tool_error' &&
            cartId &&
            isCartIdError(addErr)
          ) {
            const retryResult = await createCart({
              ...mcpBase,
              lineItems: [newLine],
            });
            const cart = retryResult.cart
              ? normalizeCart(retryResult.cart)
              : null;
            if (!cart) {
              return json({
                error: {
                  type: 'tool_error',
                  message:
                    'The assistant ran into a problem. Please try again.',
                },
              });
            }

            if (cart.checkoutUrl) {
              return json({
                reply: 'Started a new cart and added the item — checkout here.',
                cart,
                cartReset: true,
              });
            }

            const checkoutResult = await createCheckout({
              ...mcpBase,
              cartId: cart.id,
              lineItems: [newLine],
            });
            const checkout = checkoutResult.checkout
              ? normalizeCheckout(checkoutResult.checkout)
              : null;

            return json({
              reply: 'Started a new cart and added the item — checkout here.',
              cart: {...cart, checkoutUrl: checkout?.checkoutUrl},
              cartReset: true,
            });
          }
          // Not a stale-cart error — re-throw to the outer catch
          throw addErr;
        }
      }

      default: {
        return json({
          error: {
            type: 'validation_error',
            message: `Unknown intent: ${intent}`,
          },
        });
      }
    }
  } catch (err) {
    if (err instanceof McpError) {
      return json({error: mapMcpError(err)});
    }
    // Unexpected server error — log only the message, not the full payload (G4)
    // eslint-disable-next-line no-console
    console.error(
      '[assistant] unexpected error:',
      err instanceof Error ? err.message : String(err),
    );
    return json(
      {
        error: {
          type: 'server_error',
          message: 'Something went wrong. Please try again.',
        },
      },
      {status: 500},
    );
  }
}

/**
 * Detects whether an McpError is caused by a stale or invalid cart_id.
 * PROBED live (2026-07-08): UCP business errors surface as
 * `structuredContent.messages[]` entries, e.g.
 *   {type:"error", code:"invalid_cart_id", content:"Invalid id format. Expected
 *    a Shopify Cart GID...", severity:"unrecoverable"}
 * for both a malformed GID and (per Dev MCP) a well-formed-but-nonexistent one.
 *
 * @param {McpError} mcpError
 * @returns {boolean}
 */
function isCartIdError(mcpError) {
  const payload = mcpError.detail?.payload;
  if (!payload) return false;

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return messages.some((m) => {
    const code = String(m.code ?? '').toLowerCase();
    const content = String(m.content ?? '').toLowerCase();
    return (
      code.includes('cart_id') ||
      content.includes('cart_id') ||
      content.includes('cart gid') ||
      content.includes('does not exist')
    );
  });
}

/**
 * Maps an McpError to the user-facing error shape.
 *
 * Rate-limit handling (§6.5, AL-UCP-13, required change #5): retryAfterMs is
 * surfaced regardless of whether the -32000-in-body path or the HTTP-429
 * path produced the McpError — both paths populate err.detail.retryAfterMs
 * identically in mcp.server.js's callTool().
 *
 * @param {McpError} err
 * @returns {{type: string, message: string, retryAfterMs?: number}}
 */
function mapMcpError(err) {
  switch (err.code) {
    case 'rate_limited':
      return {
        type: 'rate_limited',
        message: 'Too many requests — please wait a moment.',
        retryAfterMs: err.detail?.retryAfterMs ?? 0,
      };
    case 'timeout':
      return {
        type: 'timeout',
        message: 'That took too long. Please try again.',
      };
    case 'tool_error':
      return {
        type: 'tool_error',
        message: 'The assistant ran into a problem. Please try again.',
      };
    case 'http_error':
      return {
        type: 'http_error',
        message: 'Unable to reach the shopping service.',
      };
    case 'config_error':
      return {
        type: 'config_error',
        message: 'The shopping assistant is not configured.',
      };
    default:
      return {type: err.code, message: 'An error occurred. Please try again.'};
  }
}

// GET → null no-op, matching api.newsletter / api.countries pattern.
export default function AssistantApiRoute() {
  return null;
}

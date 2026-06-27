import {json} from '@shopify/remix-oxygen';

import {ASSISTANT_RESULT_LIMIT} from '~/lib/const';
import {
  McpError,
  getProductDetails,
  searchCatalog,
  updateCart,
} from '~/lib/mcp.server';
import {
  normalizeCatalogProducts,
  normalizeCart,
  normalizeProductDetail,
} from '~/lib/mcp-normalize';

/** @typedef {import('@shopify/remix-oxygen').ActionFunctionArgs} ActionFunctionArgs */

/**
 * POST /api/assistant (and locale-prefixed equivalents).
 *
 * Request (form-encoded): {intent, message?, productId?, variantId?, cartId?}
 *
 * Response (JSON):
 *   {reply: string, products?: AssistantProduct[], productDetail?: AssistantProduct,
 *    cart?: AssistantCart, cartReset?: boolean, error?: {type, message, retryAfterMs?}}
 *
 * Design constraints:
 * - ALL MCP calls are server-side only. The browser never receives endpoint URLs
 *   or raw MCP payloads.
 * - `error` is returned ONLY for genuine failures. A successful search that
 *   returns zero products yields {products: []} with NO error (required change #2).
 *   Empty results and error states are never conflated.
 * - Stale-cart path (required change #4): if updateCart fails with a cart_id error,
 *   the action clears the stored cartId and retries once without it (fresh cart),
 *   then sets cartReset:true so the UI can show "started a new cart".
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

  // 2. Config guard — read PUBLIC_STORE_DOMAIN from context.env, not a global.
  const storeDomain = context.env.PUBLIC_STORE_DOMAIN;
  if (!storeDomain) {
    return json(
      {
        error: {
          type: 'config_error',
          message: 'Store domain is not configured.',
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
  const productId = String(formData.get('productId') ?? '');
  const variantId = String(formData.get('variantId') ?? '');
  // Treat empty string as "no cartId" — only pass a truthy cartId to MCP.
  const cartId = String(formData.get('cartId') ?? '') || null;

  try {
    switch (intent) {
      case 'search': {
        if (!message) {
          return json({
            error: {
              type: 'validation_error',
              message: 'Please enter a search query.',
            },
          });
        }

        const result = await searchCatalog({
          storeDomain,
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

      case 'detail': {
        if (!productId) {
          return json({
            error: {
              type: 'validation_error',
              message: 'Product ID is required.',
            },
          });
        }

        const raw = await getProductDetails({storeDomain, productId});
        return json({
          reply: 'Here are the product details.',
          productDetail: normalizeProductDetail(raw),
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

        const addItems = [{product_variant_id: variantId, quantity: 1}];

        try {
          const result = await updateCart({
            storeDomain,
            cartId: cartId ?? undefined,
            addItems,
          });
          const cart = normalizeCart(result.cart);
          return json({
            reply: 'Added to your assistant cart — checkout here.',
            cart,
          });
        } catch (addErr) {
          // Stale-cart path (required change #4, PROBED probe 6):
          // If the submitted cartId caused a tool_error referencing cart_id,
          // clear it and create a fresh cart by retrying without cart_id.
          if (
            addErr instanceof McpError &&
            addErr.code === 'tool_error' &&
            cartId &&
            isCartIdError(addErr)
          ) {
            const retryResult = await updateCart({
              storeDomain,
              cartId: undefined,
              addItems,
            });
            const cart = normalizeCart(retryResult.cart);
            return json({
              reply: 'Started a new cart and added the item — checkout here.',
              cart,
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
 * PROBED probe 6: two failure shapes —
 *   - Invalid GID format → payload is a string containing "cart_id"
 *   - Valid but non-existent → payload.errors[].field includes "cart_id"
 *
 * @param {McpError} mcpError
 * @returns {boolean}
 */
function isCartIdError(mcpError) {
  const payload = mcpError.detail?.payload;
  if (!payload) return false;

  // String payload (e.g. "Invalid cart_id format...")
  if (typeof payload === 'string') {
    const lower = payload.toLowerCase();
    return lower.includes('cart_id') || lower.includes('does not exist');
  }

  // Object payload with errors[] (e.g. {errors: [{field: ['cart_id'], message: '...'}]})
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  return errors.some((e) => {
    const fields = Array.isArray(e.field) ? e.field : [String(e.field ?? '')];
    const msg = String(e.message ?? '').toLowerCase();
    return (
      fields.some((f) => String(f).includes('cart_id')) ||
      msg.includes('does not exist') ||
      msg.includes('invalid cart_id')
    );
  });
}

/**
 * Maps an McpError to the user-facing error shape.
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
    default:
      return {type: err.code, message: 'An error occurred. Please try again.'};
  }
}

// GET → null no-op, matching api.newsletter / api.countries pattern.
export default function AssistantApiRoute() {
  return null;
}

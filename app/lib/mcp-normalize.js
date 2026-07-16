/**
 * UCP MCP response normalization — pure functions, no network, no side effects.
 *
 * Single price path (§6.5 — UCP simplification over the retired /api/mcp
 * two-path divergence): every UCP amount is an INTEGER MINOR CURRENCY UNIT
 * (PROBED live, e.g. search_catalog price_range.min.amount = 69995 for
 * $699.95), uniformly across catalog, cart, and checkout. Every Money-like
 * source uses the key `currency` (not `currencyCode`); normalizers rename it
 * to `currencyCode` so <Money> receives the correct shape.
 *
 * @module mcp-normalize
 */

/**
 * @typedef {{amount: string, currencyCode: string}} Money
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   vendor: string,
 *   descriptionHtml?: string,
 *   priceRange: {min: Money, max: Money},
 *   image?: {url: string, altText: string},
 *   firstVariantId?: string,
 *   firstVariantTitle: string,
 *   available: boolean,
 * }} AssistantProduct
 *
 * @typedef {{
 *   id: string,
 *   totalAmount: Money,
 *   lineCount: number,
 *   checkoutUrl?: string,
 * }} AssistantCart
 *
 * @typedef {{
 *   id: string,
 *   checkoutUrl?: string,
 * }} AssistantCheckout
 */

// Zero-decimal currencies (ISO 4217 subset). For these, the integer amount
// is already in major units — no division needed.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'HUF',
  'IDR',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/**
 * Converts an integer minor-unit amount to a decimal string in major units.
 * This is the SOLE price path under UCP (§6.5) — used for catalog, cart, and
 * checkout amounts alike.
 *
 * Examples:
 *   minorUnitsToDecimalString(94995, 'USD') → '949.95'
 *   minorUnitsToDecimalString(1000,  'JPY') → '1000'
 *
 * @param {number} amount - integer minor units
 * @param {string} currencyCode - ISO 4217 code e.g. "USD", "JPY"
 * @returns {string} decimal string in major units
 */
export function minorUnitsToDecimalString(amount, currencyCode) {
  if (ZERO_DECIMAL_CURRENCIES.has(currencyCode)) {
    // No division — these currencies have no decimal subunit.
    return String(amount);
  }
  // Default: 2 decimal places (USD, EUR, GBP, etc.)
  return (amount / 100).toFixed(2);
}

/**
 * Normalizes any UCP Money object ({amount: number, currency: string}) to
 * the shared Money shape. Applies uniformly to catalog, cart, and checkout
 * amounts (§6.5 simplification — UCP has no decimal-string price path).
 *
 * Example: {amount: 1999, currency: "USD"} → {amount: "19.99", currencyCode: "USD"}
 *
 * @param {{amount: number, currency: string}} raw
 * @returns {Money}
 */
export function normalizeUcpMoney(raw) {
  const currencyCode = raw.currency;
  return {
    amount: minorUnitsToDecimalString(raw.amount, currencyCode),
    currencyCode,
  };
}

/**
 * Extracts the best image from a UCP catalog product.
 * Product-level media has alt_text; variant-level media does not (PROBED).
 *
 * @param {object} rawProduct - raw search_catalog product
 * @returns {{url: string, altText: string} | undefined}
 */
function extractCatalogImage(rawProduct) {
  const media = rawProduct.media;
  if (Array.isArray(media) && media.length > 0) {
    const first = media[0];
    if (first && first.url) {
      return {
        url: first.url,
        // PROBED: field is alt_text (not altText); variant media has no alt_text
        altText: first.alt_text || rawProduct.title || '',
      };
    }
  }
  return undefined;
}

/**
 * Normalizes one raw search_catalog product to AssistantProduct.
 * Uses the single UCP minor-units price path (PROBED live: amount is 69995
 * for $699.95).
 *
 * @param {object} rawProduct - one element from search_catalog structuredContent.products[]
 * @returns {AssistantProduct}
 */
export function normalizeCatalogProduct(rawProduct) {
  const priceMin = rawProduct.price_range?.min;
  const priceMax = rawProduct.price_range?.max;

  const firstVariant = Array.isArray(rawProduct.variants)
    ? rawProduct.variants[0]
    : null;
  const firstVariantId = firstVariant?.id ?? undefined;
  // Map variant title for the Analytics Contract.
  // PROBED: search_catalog variants[0].title = "Ice" / "Default Title" is present.
  // Hydrogen validates: if (!product.variantTitle) { ... return false; }
  // Source: @shopify/hydrogen/dist/development/index.js:572
  // Use || (not ??) so empty string also falls back — empty string is falsy and would
  // fail the Hydrogen truthy check just as undefined would.
  const firstVariantTitle = firstVariant?.title || 'Default Title';
  // Availability from first variant; default true if absent
  const available = firstVariant?.availability?.available ?? true;

  return {
    id: rawProduct.id,
    title: rawProduct.title,
    // UCP search_catalog does not expose a vendor field (PROBED).
    // 'Unknown' is truthy — Hydrogen Analytics validates with `if (!product.vendor)`
    // (source: @shopify/hydrogen/dist/development/index.js:564), so an empty string
    // would still silently drop the event. 'Unknown' is semantically honest (UCP
    // genuinely omits vendor) and avoids inventing a plausible-but-wrong real name.
    vendor: 'Unknown',
    descriptionHtml: rawProduct.description?.html,
    priceRange: {
      min: priceMin
        ? normalizeUcpMoney(priceMin)
        : {amount: '0.00', currencyCode: 'USD'},
      max: priceMax
        ? normalizeUcpMoney(priceMax)
        : {amount: '0.00', currencyCode: 'USD'},
    },
    image: extractCatalogImage(rawProduct),
    firstVariantId,
    firstVariantTitle,
    available,
  };
}

/**
 * Normalizes an array of raw search_catalog products to AssistantProduct[].
 *
 * @param {object[]} rawProducts
 * @returns {AssistantProduct[]}
 */
export function normalizeCatalogProducts(rawProducts) {
  if (!Array.isArray(rawProducts)) return [];
  return rawProducts.map(normalizeCatalogProduct);
}

/**
 * Normalizes a raw UCP cart object (from create_cart / update_cart, whose
 * payload is the flat `structuredContent` cart object — no `.cart` wrapper)
 * to AssistantCart.
 *
 * UCP cart total shape (§6.5, AL-UCP-5, required change #7 — REWRITE from
 * the retired `rawCart.cost.total_amount` path, which does not exist in
 * UCP): pricing lives in `rawCart.totals[]`, an array of
 * `{type, amount, display_text}` minor-unit entries. The grand total is the
 * entry with `type === "total"`. Per the UCP printer contract, the array is
 * NOT reordered/recomputed/filtered/aggregated here — this normalizer only
 * SELECTS the "total" entry for the single-total Phase-1 UI; it does not
 * rebuild the array.
 *
 * @param {object} rawCart - the flat structuredContent cart object
 * @returns {AssistantCart}
 */
export function normalizeCart(rawCart) {
  const totals = Array.isArray(rawCart.totals) ? rawCart.totals : [];
  const totalEntry = totals.find((t) => t.type === 'total');
  const currencyCode = rawCart.currency ?? totalEntry?.currency ?? 'USD';

  return {
    id: rawCart.id,
    totalAmount: totalEntry
      ? normalizeUcpMoney({amount: totalEntry.amount, currency: currencyCode})
      : // Anti-Stubbing: this is a genuine "no total available" state (the
        // totals[] array had no "total" entry), not fabricated data.
        {amount: '0.00', currencyCode},
    lineCount: Array.isArray(rawCart.line_items)
      ? rawCart.line_items.reduce(
          (sum, line) => sum + (Number(line.quantity) || 0),
          0,
        )
      : 0,
    checkoutUrl: rawCart.continue_url ?? undefined,
  };
}

/**
 * Normalizes a raw UCP checkout object (from create_checkout
 * `structuredContent`, which IS the checkout object — no nested `.checkout`
 * key) to AssistantCheckout. Used only on the fallback handoff path (§3.5),
 * when the cart's own `continue_url` is absent.
 *
 * @param {object} rawCheckout - structuredContent (flat checkout shape)
 * @returns {AssistantCheckout}
 */
export function normalizeCheckout(rawCheckout) {
  return {
    id: rawCheckout.id,
    checkoutUrl: rawCheckout.continue_url ?? undefined,
  };
}

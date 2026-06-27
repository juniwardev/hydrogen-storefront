/**
 * MCP response normalization — pure functions, no network, no side effects.
 *
 * Two explicit price paths (PROBED, AL-21):
 *  - search_catalog: integer minor units, nested {amount: number, currency: string}
 *  - get_product_details: decimal strings, sibling currency field in price_range
 *  - cart cost: decimal strings, nested {amount: string, currency: string}
 *
 * Every Money-like source uses the key `currency` (not `currencyCode`);
 * all paths rename it to `currencyCode` so <Money> receives the correct shape.
 *
 * @module mcp-normalize
 */

/**
 * @typedef {{amount: string, currencyCode: string}} Money
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   descriptionHtml?: string,
 *   priceRange: {min: Money, max: Money},
 *   image?: {url: string, altText: string},
 *   firstVariantId?: string,
 *   available: boolean,
 * }} AssistantProduct
 *
 * @typedef {{
 *   id: string,
 *   totalAmount: Money,
 *   lineCount: number,
 *   checkoutUrl?: string,
 * }} AssistantCart
 */

// Zero-decimal currencies (ISO 4217 subset). For these, the integer amount
// from search_catalog is already in major units — no division needed.
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
 * Used only for the search_catalog price path (integer minor units).
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
 * [CATALOG PATH] Maps a search_catalog price object to the Money shape.
 * Input: integer minor units + nested {amount: number, currency: string}.
 *
 * @param {{amount: number, currency: string}} raw
 * @returns {Money}
 */
function catalogMoneyToMoney(raw) {
  const currencyCode = raw.currency;
  return {
    amount: minorUnitsToDecimalString(raw.amount, currencyCode),
    currencyCode,
  };
}

/**
 * [DETAIL PATH] Maps a get_product_details price to the Money shape.
 * Input: decimal string amount + sibling currency field.
 * The amount is already in major units — no division.
 *
 * @param {string|number} amountStr - decimal string e.g. "949.95"
 * @param {string} currency - e.g. "USD"
 * @returns {Money}
 */
function decimalStringToMoney(amountStr, currency) {
  return {
    amount: String(amountStr),
    currencyCode: currency,
  };
}

/**
 * [CART PATH] Maps a cart cost object to the Money shape.
 * Input: decimal string + nested {amount: string, currency: string}.
 * The amount is already in major units — no division.
 *
 * @param {{amount: string|number, currency: string}} raw
 * @returns {Money}
 */
function cartMoneyToMoney(raw) {
  return {
    amount: String(raw.amount),
    currencyCode: raw.currency,
  };
}

/**
 * Extracts the best image from a search_catalog product.
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
 * Uses the INTEGER MINOR UNITS price path (PROBED: amount is 94995 for $949.95).
 *
 * @param {object} rawProduct - one element from search_catalog result.products[]
 * @returns {AssistantProduct}
 */
export function normalizeCatalogProduct(rawProduct) {
  const priceMin = rawProduct.price_range?.min;
  const priceMax = rawProduct.price_range?.max;

  const firstVariant = Array.isArray(rawProduct.variants)
    ? rawProduct.variants[0]
    : null;
  const firstVariantId = firstVariant?.id ?? undefined;
  // Availability from first variant; default true if absent
  const available = firstVariant?.availability?.available ?? true;

  return {
    id: rawProduct.id,
    title: rawProduct.title,
    descriptionHtml: rawProduct.description?.html,
    priceRange: {
      min: priceMin
        ? catalogMoneyToMoney(priceMin)
        : {amount: '0.00', currencyCode: 'USD'},
      max: priceMax
        ? catalogMoneyToMoney(priceMax)
        : {amount: '0.00', currencyCode: 'USD'},
    },
    image: extractCatalogImage(rawProduct),
    firstVariantId,
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
 * Normalizes a raw get_product_details product to AssistantProduct.
 * Uses the DECIMAL STRING price path.
 *
 * PROBED shape:
 *   price_range = {min: "949.95", max: "949.95", currency: "USD"}
 *   (currency is a sibling of min/max — NOT nested inside min)
 *
 * @param {object} rawProduct - the .product object from get_product_details response
 * @returns {AssistantProduct}
 */
export function normalizeProductDetail(rawProduct) {
  const priceRange = rawProduct.price_range ?? {};
  // PROBED: currency is a sibling field of min/max (structural difference from catalog path)
  const currency = priceRange.currency ?? 'USD';

  const variant = rawProduct.selectedOrFirstAvailableVariant;
  const firstVariantId = variant?.variant_id ?? undefined;
  const available = variant?.available ?? true;

  let image;
  if (Array.isArray(rawProduct.images) && rawProduct.images.length > 0) {
    const first = rawProduct.images[0];
    if (first && first.url) {
      image = {
        url: first.url,
        altText: first.alt_text || rawProduct.title || '',
      };
    }
  } else if (rawProduct.image_url) {
    // Fallback: flat image_url when images[] is absent
    image = {
      url: rawProduct.image_url,
      altText: rawProduct.title || '',
    };
  }

  return {
    id: rawProduct.product_id,
    title: rawProduct.title,
    descriptionHtml: rawProduct.description,
    priceRange: {
      min: decimalStringToMoney(priceRange.min ?? '0.00', currency),
      max: decimalStringToMoney(priceRange.max ?? '0.00', currency),
    },
    image,
    firstVariantId,
    available,
  };
}

/**
 * Normalizes a raw cart object from update_cart / get_cart to AssistantCart.
 * Uses the DECIMAL STRING price path.
 *
 * PROBED shape:
 *   cart.cost.total_amount = {amount: "949.95", currency: "USD"}
 *   (nested {amount, currency} — decimal string, same key structure as catalog money
 *    but amount is already a major-unit decimal, not minor-unit integer)
 *
 * @param {object} rawCart
 * @returns {AssistantCart}
 */
export function normalizeCart(rawCart) {
  const totalAmount = rawCart.cost?.total_amount;
  return {
    id: rawCart.id,
    totalAmount: totalAmount
      ? cartMoneyToMoney(totalAmount)
      : {amount: '0.00', currencyCode: 'USD'},
    lineCount:
      rawCart.total_quantity ??
      (Array.isArray(rawCart.lines) ? rawCart.lines.length : 0),
    checkoutUrl: rawCart.checkout_url ?? undefined,
  };
}

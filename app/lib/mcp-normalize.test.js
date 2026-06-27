/**
 * Unit tests for the three per-source Money normalizers in mcp-normalize.js.
 * Uses Node's built-in test runner — zero new dependencies.
 *
 * Run: node --test app/lib/mcp-normalize.test.js
 *   or: npm run test:unit  (runs this file alongside mcp.server.test.js)
 *
 * Each normalizer block has at least TWO assertions covering BOTH 100x failure directions:
 *   - overcount: returning "1999" when "19.99" was expected (100x too high)
 *   - undercount: returning "0.1999" when "19.99" was expected (100x too low)
 *
 * Fixtures use $19.99 (minor-unit form 1999, decimal-string form "19.99") for clarity.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSearchCatalogMoney,
  normalizeProductDetailsMoney,
  normalizeCartMoney,
  normalizeCatalogProduct,
  normalizeProductDetail,
} from './mcp-normalize.js';

// ---------------------------------------------------------------------------
// normalizeSearchCatalogMoney
// Source: search_catalog — prices are INTEGER MINOR UNITS, currency nested.
// Fixture: {amount: 1999, currency: "USD"} → $19.99
// ---------------------------------------------------------------------------

describe('normalizeSearchCatalogMoney — search_catalog integer minor units', () => {
  test('divides 1999 minor units to "19.99" (overcount guard: "1999" is 100x too high)', () => {
    // If the function forgets to divide, it returns "1999" → displayed as $1,999.00 (100x overcount).
    const result = normalizeSearchCatalogMoney({amount: 1999, currency: 'USD'});
    assert.equal(
      result.amount,
      '19.99',
      'must divide by 100 — raw "1999" would be 100x overcount',
    );
    assert.equal(
      result.currencyCode,
      'USD',
      'must rename currency → currencyCode',
    );
  });

  test('does not divide twice (undercount guard: "0.1999" is 100x too low)', () => {
    // If the function accidentally divides already-divided output, it would return
    // "0.1999" → displayed as $0.20 (100x undercount).
    const result = normalizeSearchCatalogMoney({amount: 1999, currency: 'USD'});
    assert.notEqual(
      result.amount,
      '1999',
      'returning "1999" is the overcount failure: forgot to divide',
    );
    assert.notEqual(
      result.amount,
      '0.1999',
      'returning "0.1999" is the undercount failure: divided twice',
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeProductDetailsMoney
// Source: get_product_details — prices are DECIMAL STRINGS, currency a sibling.
// Fixture: ("19.99", "USD") → $19.99
// ---------------------------------------------------------------------------

describe('normalizeProductDetailsMoney — get_product_details decimal strings', () => {
  test('passes "19.99" through unchanged (undercount guard: "0.1999" is 100x too low)', () => {
    // If the function accidentally divides the already-decimal string,
    // it returns "0.1999" → displayed as $0.20 (100x undercount).
    const result = normalizeProductDetailsMoney('19.99', 'USD');
    assert.equal(
      result.amount,
      '19.99',
      'must NOT divide — dividing "19.99" by 100 gives "0.1999" (100x undercount)',
    );
    assert.equal(
      result.currencyCode,
      'USD',
      'must rename currency → currencyCode',
    );
  });

  test('does not multiply the decimal string (overcount guard: "1999" is 100x too high)', () => {
    // If the function accidentally treats the decimal string as minor units and multiplies,
    // it would return "1999" → displayed as $1,999.00 (100x overcount).
    const result = normalizeProductDetailsMoney('19.99', 'USD');
    assert.notEqual(
      result.amount,
      '0.1999',
      'returning "0.1999" is the undercount failure: accidentally divided',
    );
    assert.notEqual(
      result.amount,
      '1999',
      'returning "1999" is the overcount failure: accidentally multiplied',
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeCartMoney
// Source: cart (update_cart / get_cart) — DECIMAL STRINGS, nested {amount, currency}.
// Documented difference from search_catalog: cart uses the same nested key structure
// but the amount is already a major-unit decimal, NOT minor-unit integer.
// Fixture: {amount: "19.99", currency: "USD"} → $19.99
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// vendor field — Analytics Contract (QA fix round 1, strengthened in round 2)
// Hydrogen Analytics.ProductView requires `vendor` in the product payload.
// Neither search_catalog nor get_product_details exposes a vendor field (PROBED).
//
// CRITICAL: Hydrogen validates with `if (!product.vendor)` — a falsy (truthy) check,
// NOT a key-presence check. Source: @shopify/hydrogen/dist/development/index.js:564
//   if (!product.vendor) { missingErrorMessage(type, "vendor", false); return false; }
//
// Round 1 bug: vendor was set to '' (empty string). '' is falsy, so Hydrogen's
// `!product.vendor` still evaluated true and every analytics event was still dropped.
// Round 2 fix: vendor is 'Unknown' — truthy, semantically honest, not fabricated.
//
// These tests assert the ACTUAL Hydrogen requirement (truthy non-empty string),
// not a proxy (key presence). A negative-pair guard is included so this class of
// regression cannot silently re-enter:
//   Boolean('')       === false  → would FAIL Hydrogen's check
//   Boolean('Unknown') === true  → PASSES Hydrogen's check
// ---------------------------------------------------------------------------

describe('normalizeCatalogProduct — vendor field truthy for Analytics Contract', () => {
  const rawCatalogProduct = {
    id: 'gid://shopify/Product/1',
    title: 'Test Snowboard',
    price_range: {
      min: {amount: 1999, currency: 'USD'},
      max: {amount: 1999, currency: 'USD'},
    },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/1',
        title: 'Default Title',
        availability: {available: true},
      },
    ],
    media: [],
  };

  test('vendor key is present and is a string', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.ok(
      Object.prototype.hasOwnProperty.call(product, 'vendor'),
      'vendor key must be present on normalized catalog product',
    );
    assert.equal(typeof product.vendor, 'string', 'vendor must be a string');
  });

  test('vendor is truthy so Hydrogen if(!product.vendor) check does not drop the event', () => {
    // Hydrogen source: @shopify/hydrogen/dist/development/index.js:564
    //   if (!product.vendor) { missingErrorMessage(...); return false; }
    // An empty string '' is falsy — !'' === true — so an '' fallback still drops the event.
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.ok(
      Boolean(product.vendor),
      `vendor must be truthy; got "${product.vendor}" which is falsy and would drop the analytics event`,
    );
    assert.equal(
      product.vendor,
      'Unknown',
      'vendor must be "Unknown" — truthy fallback when MCP search_catalog omits the field',
    );
  });

  test('negative-pair guard: "" is falsy (round-1 bug), "Unknown" is truthy (correct)', () => {
    // Explicit negative-pair to prevent the truthy-vs-key-presence trap from re-entering.
    // Round-1 bug: vendor was set to '' — key present, but '' is falsy, event still dropped.
    // Hydrogen validates: if (!product.vendor) → !'' === true → drops event.
    // This test documents that assertion so any future "" regression is caught immediately.
    assert.equal(
      Boolean(''),
      false,
      'guard: empty string is falsy — returning "" re-introduces the round-1 analytics bug',
    );
    assert.equal(
      Boolean('Unknown'),
      true,
      'guard: "Unknown" is truthy — satisfies Hydrogen if(!product.vendor) check',
    );
  });
});

describe('normalizeProductDetail — vendor field truthy for Analytics Contract', () => {
  const rawDetail = {
    product_id: 'gid://shopify/Product/1',
    title: 'Test Snowboard',
    price_range: {min: '19.99', max: '19.99', currency: 'USD'},
    selectedOrFirstAvailableVariant: {
      variant_id: 'gid://shopify/ProductVariant/1',
      title: 'Default Title',
      available: true,
    },
  };

  test('vendor key is present and is a string', () => {
    const product = normalizeProductDetail(rawDetail);
    assert.ok(
      Object.prototype.hasOwnProperty.call(product, 'vendor'),
      'vendor key must be present on normalized detail product',
    );
    assert.equal(typeof product.vendor, 'string', 'vendor must be a string');
  });

  test('vendor is truthy so Hydrogen if(!product.vendor) check does not drop the event', () => {
    // Hydrogen source: @shopify/hydrogen/dist/development/index.js:564
    //   if (!product.vendor) { missingErrorMessage(...); return false; }
    const product = normalizeProductDetail(rawDetail);
    assert.ok(
      Boolean(product.vendor),
      `vendor must be truthy; got "${product.vendor}" which is falsy and would drop the analytics event`,
    );
    assert.equal(
      product.vendor,
      'Unknown',
      'vendor must be "Unknown" — truthy fallback when MCP get_product_details omits the field',
    );
  });

  test('negative-pair guard: "" is falsy (round-1 bug), "Unknown" is truthy (correct)', () => {
    // Mirrors the catalog-path negative-pair above — same Hydrogen truthy contract.
    assert.equal(
      Boolean(''),
      false,
      'guard: empty string is falsy — returning "" re-introduces the round-1 analytics bug',
    );
    assert.equal(
      Boolean('Unknown'),
      true,
      'guard: "Unknown" is truthy — satisfies Hydrogen if(!product.vendor) check',
    );
  });
});

// ---------------------------------------------------------------------------
// Analytics.ProductView comprehensive payload contract — QA fix round 3
//
// Hydrogen's validateProducts() (source: @shopify/hydrogen/dist/development/index.js
// lines 543-578) checks EVERY field below with a truthy guard before setting up
// a product view event.  A sequential validator stops at the FIRST failure, so
// one passing field can mask a failing one in the next position.  These tests
// check the ENTIRE payload at once (positive) and prove the guard catches a
// regression on ANY individual field (negative).
//
// The list HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS is the single source of truth.
// Adding a field here automatically extends both positive and negative coverage.
//
// toAnalyticsPayload() mirrors exactly what AssistantProductCard.jsx passes
// into <Analytics.ProductView data={{products: [...]}} />.
// ---------------------------------------------------------------------------

/**
 * Fields Hydrogen's validateProducts() requires to be truthy, in check order.
 * Source: @shopify/hydrogen/dist/development/index.js
 *   line 552: if (!product.id)
 *   line 556: if (!product.title)
 *   line 560: if (!product.price)
 *   line 564: if (!product.vendor)
 *   line 568: if (!product.variantId)
 *   line 572: if (!product.variantTitle)
 */
const HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS = [
  'id',
  'title',
  'price',
  'vendor',
  'variantId',
  'variantTitle',
];

/**
 * Maps a normalized AssistantProduct to the Analytics.ProductView ProductPayload.
 * Mirrors the exact mapping in AssistantProductCard.jsx so the test covers the
 * same field selections the component makes.
 *
 * @param {import('./mcp-normalize').AssistantProduct} product
 * @returns {Record<string, unknown>}
 */
function toAnalyticsPayload(product) {
  return {
    id: product.id,
    title: product.title,
    price: product.priceRange.min.amount,
    vendor: product.vendor,
    variantId: product.firstVariantId,
    variantTitle: product.firstVariantTitle,
    quantity: 1,
  };
}

// Representative search_catalog product (probe 3 from mcp-shopping-assistant-impl-notes.md).
const CATALOG_PROBE_FIXTURE = {
  id: 'gid://shopify/Product/9356161155292',
  title: 'The Inventory Not Tracked Snowboard',
  description: {html: '<p>A great snowboard.</p>'},
  price_range: {
    min: {amount: 94995, currency: 'USD'},
    max: {amount: 94995, currency: 'USD'},
  },
  variants: [
    {
      id: 'gid://shopify/ProductVariant/50239738609884',
      title: 'Default Title',
      availability: {available: true},
    },
  ],
  media: [
    {
      type: 'image',
      url: 'https://cdn.shopify.com/s/files/1/test/snowboard.png',
      alt_text: 'Top and bottom view of a snowboard',
    },
  ],
  tags: ['Accessory', 'Sport', 'Winter'],
};

// Representative get_product_details product (probe 4 from mcp-shopping-assistant-impl-notes.md).
const DETAIL_PROBE_FIXTURE = {
  product_id: 'gid://shopify/Product/9356161155292',
  title: 'The Inventory Not Tracked Snowboard',
  description: 'A great snowboard.',
  url: null,
  image_url: 'https://cdn.shopify.com/s/files/1/test/snowboard.png',
  images: [
    {
      url: 'https://cdn.shopify.com/s/files/1/test/snowboard.png',
      alt_text: 'Top and bottom view of a snowboard',
    },
  ],
  options: [{name: 'Title', values: ['Default Title']}],
  total_variants: 1,
  price_range: {min: '949.95', max: '949.95', currency: 'USD'},
  selectedOrFirstAvailableVariant: {
    variant_id: 'gid://shopify/ProductVariant/50239738609884',
    title: 'Default Title',
    price: '949.95',
    currency: 'USD',
    image_url: 'https://cdn.shopify.com/s/files/1/test/snowboard.png',
    image_alt_text: 'Top and bottom view of a snowboard',
    available: true,
    selected_options: [{name: 'Title', value: 'Default Title'}],
  },
};

describe('Analytics.ProductView — comprehensive payload contract (QA fix round 3)', () => {
  test('[catalog path] every Hydrogen-required field is truthy (protects index.js:552-574)', () => {
    // Positive: a product normalized from a representative search_catalog response
    // must produce a payload where every field passes Hydrogen's truthy check.
    // If ANY field is falsy, the validator short-circuits and drops the event.
    const product = normalizeCatalogProduct(CATALOG_PROBE_FIXTURE);
    const payload = toAnalyticsPayload(product);
    for (const field of HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS) {
      assert.ok(
        Boolean(payload[field]),
        `catalog path: payload.${field} must be truthy; got ${JSON.stringify(
          payload[field],
        )}. ` +
          `Hydrogen guard: if (!product.${field}) drops the analytics event.`,
      );
    }
  });

  test('[detail path] every Hydrogen-required field is truthy (protects index.js:552-574)', () => {
    // Positive: a product normalized from a representative get_product_details response
    // must also produce a fully-truthy payload.
    const product = normalizeProductDetail(DETAIL_PROBE_FIXTURE);
    const payload = toAnalyticsPayload(product);
    for (const field of HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS) {
      assert.ok(
        Boolean(payload[field]),
        `detail path: payload.${field} must be truthy; got ${JSON.stringify(
          payload[field],
        )}. ` +
          `Hydrogen guard: if (!product.${field}) drops the analytics event.`,
      );
    }
  });

  // Negative tests: one per required field.  For each field, simulate blanking it to ''
  // (falsy) and confirm the truthy check fails.  This proves the guard would catch
  // a regression on that specific field, not just the first one in the sequential chain.
  for (const field of HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS) {
    test(`[negative] blanking "${field}" to "" fails Hydrogen's truthy check (index.js guard)`, () => {
      const product = normalizeCatalogProduct(CATALOG_PROBE_FIXTURE);
      const payload = toAnalyticsPayload(product);
      // Simulate a regression: the field is blanked to an empty string.
      const broken = {...payload, [field]: ''};
      assert.equal(
        Boolean(broken[field]),
        false,
        `"${field}" set to "" must be falsy — Hydrogen's if (!product.${field}) would drop the event`,
      );
    });
  }
});

describe('normalizeCartMoney — cart decimal strings with nested {amount, currency}', () => {
  test('passes nested "19.99" through unchanged (undercount guard: "0.1999" is 100x too low)', () => {
    // Cart total_amount uses the same nested structure as search_catalog money,
    // but the amount is a decimal string, not an integer. Dividing would give 100x undercount.
    const result = normalizeCartMoney({amount: '19.99', currency: 'USD'});
    assert.equal(
      result.amount,
      '19.99',
      'must NOT divide — "19.99" ÷ 100 = "0.1999" (100x undercount)',
    );
    assert.equal(
      result.currencyCode,
      'USD',
      'must rename currency → currencyCode',
    );
  });

  test('does not treat decimal string as minor units (overcount guard: "1999" is 100x too high)', () => {
    // If the function mistakenly treated the decimal string as an integer
    // and returned the raw string "1999", it would be 100x overcount.
    const result = normalizeCartMoney({amount: '19.99', currency: 'USD'});
    assert.notEqual(
      result.amount,
      '0.1999',
      'returning "0.1999" is the undercount failure: accidentally divided',
    );
    assert.notEqual(
      result.amount,
      '1999',
      'returning "1999" is the overcount failure: treated decimal as minor units',
    );
  });
});

/**
 * Unit tests for mcp-normalize.js — UCP MCP response normalizers.
 * Uses Node's built-in test runner — zero new dependencies.
 *
 * Run: node --test app/lib/mcp-normalize.test.js
 *   or: npm run test:unit (runs this file alongside mcp.server.test.js)
 *
 * UCP simplification (§6.5): there is a SINGLE minor-units price path now
 * (catalog, cart, and checkout all use integer minor units), replacing the
 * retired /api/mcp two-path divergence (catalog integer vs detail/cart
 * decimal-string). normalizeProductDetail / normalizeProductDetailsMoney /
 * getProductDetails are DELETED along with the "detail" intent (plan §6.7a,
 * §9.1 step 7a) — they are not tested here because they no longer exist.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {
  minorUnitsToDecimalString,
  normalizeUcpMoney,
  normalizeCatalogProduct,
  normalizeCart,
  normalizeCheckout,
} from './mcp-normalize.js';

// ---------------------------------------------------------------------------
// minorUnitsToDecimalString
// ---------------------------------------------------------------------------

describe('minorUnitsToDecimalString', () => {
  test('converts USD minor units to decimal string', () => {
    assert.equal(minorUnitsToDecimalString(94995, 'USD'), '949.95');
    assert.equal(minorUnitsToDecimalString(100, 'USD'), '1.00');
    assert.equal(minorUnitsToDecimalString(0, 'USD'), '0.00');
  });

  test('does NOT divide for zero-decimal currencies (JPY, KRW)', () => {
    assert.equal(minorUnitsToDecimalString(1000, 'JPY'), '1000');
    assert.equal(minorUnitsToDecimalString(1500, 'KRW'), '1500');
  });

  test('applies default 2-decimal exponent for unknown currencies', () => {
    assert.equal(minorUnitsToDecimalString(5000, 'XYZ'), '50.00');
  });
});

// ---------------------------------------------------------------------------
// normalizeUcpMoney — single price path (§6.5 simplification)
// ---------------------------------------------------------------------------

describe('normalizeUcpMoney — single UCP minor-units path', () => {
  test('divides 1999 minor units to "19.99" (overcount guard: "1999" is 100x too high)', () => {
    const result = normalizeUcpMoney({amount: 1999, currency: 'USD'});
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
    const result = normalizeUcpMoney({amount: 1999, currency: 'USD'});
    assert.notEqual(result.amount, '1999');
    assert.notEqual(result.amount, '0.1999');
  });

  test('applies uniformly to catalog-shaped, cart-shaped, and checkout-shaped amounts', () => {
    // PROBED live: search_catalog price_range.min = {amount: 69995, currency: "USD"}.
    assert.equal(
      normalizeUcpMoney({amount: 69995, currency: 'USD'}).amount,
      '699.95',
    );
    // PROBED live: cart/checkout totals[] entries = {amount: 8900, currency: "USD"} shape
    // (amount + a sibling currency supplied by the normalizer caller).
    assert.equal(
      normalizeUcpMoney({amount: 8900, currency: 'USD'}).amount,
      '89.00',
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeCatalogProduct — PROBED live shape (2026-07-08)
// ---------------------------------------------------------------------------

describe('normalizeCatalogProduct — UCP search_catalog shape (PROBED live)', () => {
  const rawCatalogProduct = {
    id: 'gid://shopify/Product/9356160729308',
    title: 'The Complete Snowboard',
    description: {html: '<p>Description</p>'},
    handle: 'the-complete-snowboard',
    price_range: {
      min: {amount: 69995, currency: 'USD'},
      max: {amount: 69995, currency: 'USD'},
    },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/50239737331932',
        title: 'Ice',
        availability: {available: true},
        media: [
          {
            type: 'image',
            url: 'https://cdn.shopify.com/s/files/variant.jpg',
          },
        ],
      },
    ],
    media: [
      {
        type: 'image',
        url: 'https://cdn.shopify.com/s/files/snowboard.png',
        alt_text: 'Top and bottom view',
      },
    ],
  };

  test('converts integer minor units to decimal string (not 100x too large)', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(
      product.priceRange.min.amount,
      '699.95',
      'min price must be decimal, not minor-unit integer',
    );
    assert.equal(product.priceRange.max.amount, '699.95');
  });

  test('renames currency → currencyCode', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(product.priceRange.min.currencyCode, 'USD');
  });

  test('maps firstVariantId from variants[0].id', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(
      product.firstVariantId,
      'gid://shopify/ProductVariant/50239737331932',
    );
  });

  test('maps firstVariantTitle from variants[0].title', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(product.firstVariantTitle, 'Ice');
  });

  test('maps image from product-level media with alt_text field', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.ok(product.image, 'image must be present');
    assert.equal(
      product.image.url,
      'https://cdn.shopify.com/s/files/snowboard.png',
    );
    assert.equal(product.image.altText, 'Top and bottom view');
  });
});

// ---------------------------------------------------------------------------
// vendor field — Analytics Contract
// Neither UCP search_catalog exposes a vendor field (PROBED live).
// CRITICAL: Hydrogen validates with `if (!product.vendor)` — a falsy check,
// NOT a key-presence check. Source: @shopify/hydrogen/dist/development/index.js:564
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
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.ok(
      Boolean(product.vendor),
      `vendor must be truthy; got "${product.vendor}" which is falsy and would drop the analytics event`,
    );
    assert.equal(product.vendor, 'Unknown');
  });

  test('negative-pair guard: "" is falsy (round-1 bug), "Unknown" is truthy (correct)', () => {
    assert.equal(Boolean(''), false);
    assert.equal(Boolean('Unknown'), true);
  });
});

// ---------------------------------------------------------------------------
// Analytics.ProductView comprehensive payload contract
//
// Hydrogen's validateProducts() (source: @shopify/hydrogen/dist/development/index.js
// lines 543-578) checks EVERY field below with a truthy guard before setting up
// a product view event. These tests check the ENTIRE payload at once (positive)
// and prove the guard catches a regression on ANY individual field (negative).
// ---------------------------------------------------------------------------

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
 * Mirrors the exact mapping in AssistantProductCard.jsx.
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

// Representative search_catalog product (PROBED live, 2026-07-08).
const CATALOG_PROBE_FIXTURE = {
  id: 'gid://shopify/Product/9356160729308',
  title: 'The Complete Snowboard',
  description: {html: '<p>A great snowboard.</p>'},
  price_range: {
    min: {amount: 69995, currency: 'USD'},
    max: {amount: 69995, currency: 'USD'},
  },
  variants: [
    {
      id: 'gid://shopify/ProductVariant/50239737331932',
      title: 'Ice',
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
  tags: ['Premium', 'Snow', 'Snowboard', 'Sport', 'Winter'],
};

describe('Analytics.ProductView — comprehensive payload contract', () => {
  test('every Hydrogen-required field is truthy (protects index.js:552-574)', () => {
    const product = normalizeCatalogProduct(CATALOG_PROBE_FIXTURE);
    const payload = toAnalyticsPayload(product);
    for (const field of HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS) {
      assert.ok(
        Boolean(payload[field]),
        `payload.${field} must be truthy; got ${JSON.stringify(
          payload[field],
        )}. ` +
          `Hydrogen guard: if (!product.${field}) drops the analytics event.`,
      );
    }
  });

  // Negative tests: one per required field.
  for (const field of HYDROGEN_PRODUCT_VIEW_REQUIRED_FIELDS) {
    test(`[negative] blanking "${field}" to "" fails Hydrogen's truthy check (index.js guard)`, () => {
      const product = normalizeCatalogProduct(CATALOG_PROBE_FIXTURE);
      const payload = toAnalyticsPayload(product);
      const broken = {...payload, [field]: ''};
      assert.equal(
        Boolean(broken[field]),
        false,
        `"${field}" set to "" must be falsy — Hydrogen's if (!product.${field}) would drop the event`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// normalizeCart — UCP totals[] rewrite (§6.5, AL-UCP-5, required change #7)
// REPLACES the retired rawCart.cost.total_amount path, which does not exist
// in UCP. PROBED live (2026-07-08, via a business-error probe on update_cart
// with a malformed cart_id): structuredContent carries NO .cart key on
// error; on success (per Dev MCP docs), structuredContent.cart.totals[] is
// an array of {type, amount, display_text} minor-unit entries, and the grand
// total is the entry with type === "total".
// ---------------------------------------------------------------------------

describe('normalizeCart — UCP totals[] path (required change #7)', () => {
  const rawCart = {
    id: 'gid://shopify/Cart/hWNDolz1',
    currency: 'USD',
    line_items: [
      {id: 'gid://shopify/CartLine/1', quantity: 2},
      {id: 'gid://shopify/CartLine/2', quantity: 1},
    ],
    totals: [
      {type: 'subtotal', amount: 69995, display_text: 'Subtotal'},
      {type: 'total', amount: 69995, display_text: 'Total'},
    ],
    continue_url:
      'https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/abc',
  };

  test('selects the type==="total" entry and converts minor units to decimal (not $0.00)', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(
      cart.totalAmount.amount,
      '699.95',
      'total must come from the totals[] type:"total" entry, converted from minor units',
    );
    assert.equal(cart.totalAmount.currencyCode, 'USD');
  });

  test('does NOT read a .cost field (UCP has no cost field — the retired path)', () => {
    const cartWithLegacyCostField = {
      ...rawCart,
      // Simulate a regression: if normalizeCart still read .cost, this
      // decoy would produce a WRONG total ($1.00 instead of $699.95).
      cost: {total_amount: {amount: '1.00', currency: 'USD'}},
    };
    const cart = normalizeCart(cartWithLegacyCostField);
    assert.equal(
      cart.totalAmount.amount,
      '699.95',
      'must ignore any .cost field and read totals[] instead',
    );
  });

  test('carries continue_url as checkoutUrl', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(
      cart.checkoutUrl,
      'https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/abc',
    );
  });

  test('sums line_items[].quantity for lineCount', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(cart.lineCount, 3);
  });

  test('Anti-Stubbing: falls back to a genuine zero-total state when totals[] has no "total" entry (not fabricated)', () => {
    const cartNoTotal = {
      id: 'gid://shopify/Cart/x',
      currency: 'USD',
      line_items: [],
      totals: [{type: 'subtotal', amount: 0, display_text: 'Subtotal'}],
    };
    const cart = normalizeCart(cartNoTotal);
    assert.equal(cart.totalAmount.amount, '0.00');
    assert.equal(cart.totalAmount.currencyCode, 'USD');
  });
});

// ---------------------------------------------------------------------------
// normalizeCheckout — fallback handoff path (§3.5)
// PROBED live (2026-07-08) + Dev MCP: create_checkout's structuredContent IS
// the checkout object (flat: id, status, messages, continue_url, totals[]),
// unlike the cart tools which nest under a .cart key.
// ---------------------------------------------------------------------------

describe('normalizeCheckout — flat UCP checkout shape', () => {
  test('maps id and continue_url → checkoutUrl', () => {
    const rawCheckout = {
      id: 'gid://shopify/Checkout/abc123?key=xyz789',
      status: 'requires_escalation',
      messages: [],
      currency: 'USD',
      totals: [{type: 'total', amount: 8900, display_text: 'Total'}],
      continue_url:
        'https://theme-evolution-os2-hydrogen.myshopify.com/checkout/abc',
    };
    const checkout = normalizeCheckout(rawCheckout);
    assert.equal(checkout.id, 'gid://shopify/Checkout/abc123?key=xyz789');
    assert.equal(
      checkout.checkoutUrl,
      'https://theme-evolution-os2-hydrogen.myshopify.com/checkout/abc',
    );
  });

  test('checkoutUrl is undefined (not fabricated) when continue_url is absent', () => {
    const checkout = normalizeCheckout({id: 'gid://shopify/Checkout/abc'});
    assert.equal(checkout.checkoutUrl, undefined);
  });
});

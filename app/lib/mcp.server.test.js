/**
 * Unit tests for mcp.server.js (callTool) and mcp-normalize.js (normalizers).
 * Uses Node's built-in test runner — zero new dependencies.
 *
 * Run: node --test app/lib/mcp.server.test.js
 *
 * The 429/Retry-After test is MANDATORY per reviewer (required change #3 / §8.4).
 * The two-path normalizer test is also MANDATORY per reviewer (AL-21).
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {callTool, McpError} from './mcp.server.js';
import {
  minorUnitsToDecimalString,
  normalizeCatalogProduct,
  normalizeProductDetail,
  normalizeCart,
} from './mcp-normalize.js';

// ---------------------------------------------------------------------------
// callTool — 429 / Retry-After branch (MANDATORY, §8.4)
// ---------------------------------------------------------------------------

describe('callTool 429 / rate-limit handling', () => {
  test('throws rate_limited McpError with retryAfterMs in ms when Retry-After header is present', async () => {
    const fakeFetch = async () =>
      new Response(null, {
        status: 429,
        headers: new Headers({'Retry-After': '2'}),
      });

    await assert.rejects(
      () =>
        callTool({
          endpoint: 'https://example.com/api/mcp',
          name: 'search_catalog',
          args: {},
          fetchImpl: fakeFetch,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'rate_limited');
        // Retry-After: 2 seconds → retryAfterMs: 2000
        assert.equal(
          err.detail.retryAfterMs,
          2000,
          'seconds must be converted to ms',
        );
        return true;
      },
    );
  });

  test('throws rate_limited McpError with retryAfterMs=0 when Retry-After header is absent', async () => {
    const fakeFetch = async () =>
      new Response(null, {
        status: 429,
        // No Retry-After header
      });

    await assert.rejects(
      () =>
        callTool({
          endpoint: 'https://example.com/api/mcp',
          name: 'search_catalog',
          args: {},
          fetchImpl: fakeFetch,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'rate_limited');
        assert.equal(
          err.detail.retryAfterMs,
          0,
          'missing Retry-After must default to 0ms',
        );
        return true;
      },
    );
  });

  test('throws http_error McpError for non-200 non-429 status', async () => {
    const fakeFetch = async () => new Response(null, {status: 503});

    await assert.rejects(
      () =>
        callTool({
          endpoint: 'https://example.com/api/mcp',
          name: 'search_catalog',
          args: {},
          fetchImpl: fakeFetch,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'http_error');
        assert.equal(err.detail.status, 503);
        return true;
      },
    );
  });

  test('returns parsed payload for a successful 200 response', async () => {
    const successPayload = {
      products: [{id: 'gid://shopify/Product/1', title: 'Test'}],
    };
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{text: JSON.stringify(successPayload)}],
            isError: false,
          },
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );

    const result = await callTool({
      endpoint: 'https://example.com/api/mcp',
      name: 'search_catalog',
      args: {},
      fetchImpl: fakeFetch,
    });

    assert.deepEqual(result, successPayload);
  });

  test('throws tool_error McpError when result.isError is true', async () => {
    const toolErrorPayload = {
      errors: [{field: ['cart_id'], message: 'does not exist'}],
    };
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{text: JSON.stringify(toolErrorPayload)}],
            isError: true,
          },
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );

    await assert.rejects(
      () =>
        callTool({
          endpoint: 'https://example.com/api/mcp',
          name: 'update_cart',
          args: {},
          fetchImpl: fakeFetch,
        }),
      (err) => {
        assert(err instanceof McpError, 'error must be an McpError');
        assert.equal(err.code, 'tool_error');
        assert.deepEqual(err.detail.payload, toolErrorPayload);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// minorUnitsToDecimalString — unit helper for the catalog price path
// ---------------------------------------------------------------------------

describe('minorUnitsToDecimalString', () => {
  test('converts USD minor units to decimal string', () => {
    assert.equal(minorUnitsToDecimalString(94995, 'USD'), '949.95');
    assert.equal(minorUnitsToDecimalString(100, 'USD'), '1.00');
    assert.equal(minorUnitsToDecimalString(0, 'USD'), '0.00');
  });

  test('does NOT divide for zero-decimal currencies (JPY, KRW)', () => {
    // 1000 JPY should stay 1000, not become 10.00
    assert.equal(minorUnitsToDecimalString(1000, 'JPY'), '1000');
    assert.equal(minorUnitsToDecimalString(1500, 'KRW'), '1500');
  });

  test('applies default 2-decimal exponent for unknown currencies', () => {
    // Unknown currency defaults to 2 decimal places
    assert.equal(minorUnitsToDecimalString(5000, 'XYZ'), '50.00');
  });
});

// ---------------------------------------------------------------------------
// TWO-PATH PRICE NORMALIZATION (MANDATORY per reviewer, AL-21)
// Catalog integer path vs. detail/cart decimal-string path must NOT cross-contaminate.
// A wrong branch renders prices 100x off (e.g. $949.95 as $94,995.00 or $9.50).
// ---------------------------------------------------------------------------

describe('normalizeCatalogProduct — integer minor units path (PROBED probe 3)', () => {
  const rawCatalogProduct = {
    id: 'gid://shopify/Product/9356161155292',
    title: 'The Inventory Not Tracked Snowboard',
    description: {html: '<p>Description</p>'},
    price_range: {
      // PROBED: integer minor units, nested {amount, currency}
      min: {amount: 94995, currency: 'USD'},
      max: {amount: 94995, currency: 'USD'},
    },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/50239738609884',
        availability: {available: true},
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
    // 94995 minor units → "949.95" major units
    assert.equal(
      product.priceRange.min.amount,
      '949.95',
      'min price must be decimal, not minor-unit integer',
    );
    assert.equal(product.priceRange.max.amount, '949.95');
  });

  test('renames currency → currencyCode', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(product.priceRange.min.currencyCode, 'USD');
  });

  test('maps firstVariantId from variants[0].id', () => {
    const product = normalizeCatalogProduct(rawCatalogProduct);
    assert.equal(
      product.firstVariantId,
      'gid://shopify/ProductVariant/50239738609884',
    );
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

describe('normalizeProductDetail — decimal string path (PROBED probe 4)', () => {
  const rawDetail = {
    product_id: 'gid://shopify/Product/9356161155292',
    title: 'The Inventory Not Tracked Snowboard',
    description: 'A description',
    url: null,
    image_url: 'https://cdn.shopify.com/s/files/snowboard.png',
    images: [
      {
        url: 'https://cdn.shopify.com/s/files/snowboard.png',
        alt_text: 'Top and bottom',
      },
    ],
    price_range: {
      // PROBED: decimal strings, currency is a SIBLING of min/max (not nested)
      min: '949.95',
      max: '949.95',
      currency: 'USD',
    },
    selectedOrFirstAvailableVariant: {
      variant_id: 'gid://shopify/ProductVariant/50239738609884',
      price: '949.95',
      currency: 'USD',
      available: true,
    },
  };

  test('passes decimal string amount through unchanged (no division)', () => {
    const product = normalizeProductDetail(rawDetail);
    // "949.95" must stay "949.95", not become "9.4995" (÷100) or "94995" (×100)
    assert.equal(
      product.priceRange.min.amount,
      '949.95',
      'decimal string must not be divided',
    );
    assert.equal(product.priceRange.max.amount, '949.95');
  });

  test('renames currency → currencyCode', () => {
    const product = normalizeProductDetail(rawDetail);
    assert.equal(product.priceRange.min.currencyCode, 'USD');
  });

  test('maps product id from product_id field (not id)', () => {
    const product = normalizeProductDetail(rawDetail);
    assert.equal(product.id, 'gid://shopify/Product/9356161155292');
  });

  test('maps firstVariantId from selectedOrFirstAvailableVariant.variant_id', () => {
    const product = normalizeProductDetail(rawDetail);
    assert.equal(
      product.firstVariantId,
      'gid://shopify/ProductVariant/50239738609884',
    );
  });

  test('maps image from images[] array with alt_text field', () => {
    const product = normalizeProductDetail(rawDetail);
    assert.ok(product.image, 'image must be present');
    assert.equal(product.image.altText, 'Top and bottom');
  });
});

describe('normalizeCart — cart decimal string path (PROBED probe 5)', () => {
  const rawCart = {
    id: 'gid://shopify/Cart/hWNDolz1',
    lines: [{id: 'gid://shopify/CartLine/1', quantity: 1}],
    cost: {
      // PROBED: nested {amount: "949.95", currency: "USD"} — decimal string
      total_amount: {amount: '949.95', currency: 'USD'},
    },
    total_quantity: 1,
    checkout_url:
      'https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/abc',
  };

  test('passes cart total amount through as decimal string (no division)', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(
      cart.totalAmount.amount,
      '949.95',
      'cart total must not be divided',
    );
    assert.equal(cart.totalAmount.currencyCode, 'USD');
  });

  test('carries checkout_url', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(
      cart.checkoutUrl,
      'https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/abc',
    );
  });

  test('uses total_quantity for lineCount', () => {
    const cart = normalizeCart(rawCart);
    assert.equal(cart.lineCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Cross-path isolation — confirm catalog path and detail path don't cross-wire
// ---------------------------------------------------------------------------

describe('price path isolation — catalog vs detail must not cross-contaminate', () => {
  test('catalog product at $949.95 renders as "949.95", not "94995.00" or "9.50"', () => {
    const catalogRaw = {
      id: 'gid://shopify/Product/1',
      title: 'Test',
      price_range: {
        min: {amount: 94995, currency: 'USD'},
        max: {amount: 94995, currency: 'USD'},
      },
      variants: [],
      media: [],
    };
    const product = normalizeCatalogProduct(catalogRaw);
    // NOT "94995.00" (forgot to divide) or "9.50" (divided again)
    assert.equal(product.priceRange.min.amount, '949.95');
  });

  test('detail product at "949.95" renders as "949.95", not "9.4995" or "94995"', () => {
    const detailRaw = {
      product_id: 'gid://shopify/Product/1',
      title: 'Test',
      price_range: {min: '949.95', max: '949.95', currency: 'USD'},
      selectedOrFirstAvailableVariant: {
        variant_id: 'gid://shopify/ProductVariant/1',
        available: true,
      },
    };
    const product = normalizeProductDetail(detailRaw);
    // NOT "9.4995" (÷100 applied to decimal string) or "94995" (treated as integer)
    assert.equal(product.priceRange.min.amount, '949.95');
  });
});

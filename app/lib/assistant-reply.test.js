/**
 * Unit tests for assistant-reply.js — composeAddReply() checkout-CTA gating.
 * Uses Node's built-in test runner — zero new dependencies.
 *
 * Run: node --test app/lib/assistant-reply.test.js
 *   or: npm run test:unit (runs this file alongside the other app/lib suites)
 *
 * Primary guard for the fix-assistant-checkout-null-dangling-cta bug: the route
 * (`($locale).api.assistant.jsx`) previously emitted a hardcoded "checkout here"
 * CTA regardless of whether `cart.checkoutUrl` was truthy, producing a dangling
 * CTA with no link. These cases pin the invariant "CTA phrase iff checkoutUrl is
 * truthy" so a future edit cannot reintroduce the mismatch.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {composeAddReply} from './assistant-reply.js';

describe('composeAddReply — healthy path (checkoutUrl truthy)', () => {
  test('primary add: reproduces the current copy byte-for-byte', () => {
    assert.equal(
      composeAddReply({checkoutUrl: 'https://example.com/checkout/abc'}),
      'Added to your assistant cart — checkout here.',
    );
  });

  test('stale-cart retry: reproduces the current copy byte-for-byte', () => {
    assert.equal(
      composeAddReply({
        checkoutUrl: 'https://example.com/checkout/abc',
        cartReset: true,
      }),
      'Started a new cart and added the item — checkout here.',
    );
  });
});

describe('composeAddReply — no usable checkout URL (falsy checkoutUrl)', () => {
  test('primary add, checkoutUrl undefined: graceful fallback, no "checkout here"', () => {
    const reply = composeAddReply({checkoutUrl: undefined});
    assert.equal(
      reply,
      "Added to your assistant cart — I couldn't start checkout just now, but it's saved.",
    );
    assert.ok(!reply.includes('checkout here'));
  });

  test('stale-cart retry, checkoutUrl undefined: graceful fallback, no "checkout here"', () => {
    const reply = composeAddReply({checkoutUrl: undefined, cartReset: true});
    assert.equal(
      reply,
      "Started a new cart and added the item — I couldn't start checkout just now, but it's saved.",
    );
    assert.ok(!reply.includes('checkout here'));
  });

  test('checkoutUrl null: falls back the same as undefined', () => {
    const reply = composeAddReply({checkoutUrl: null});
    assert.equal(
      reply,
      "Added to your assistant cart — I couldn't start checkout just now, but it's saved.",
    );
    assert.ok(!reply.includes('checkout here'));
  });

  test('checkoutUrl empty string: falls back (guards an empty-string URL slipping a CTA through)', () => {
    const reply = composeAddReply({checkoutUrl: ''});
    assert.equal(
      reply,
      "Added to your assistant cart — I couldn't start checkout just now, but it's saved.",
    );
    assert.ok(!reply.includes('checkout here'));
  });
});

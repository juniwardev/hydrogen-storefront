/**
 * Composes the add-to-cart assistant reply, gating the "checkout here" CTA copy
 * on a usable checkout URL so the reply never promises a link that will not render.
 *
 * Pure: no side effects, no I/O. The CTA phrase appears if and only if `checkoutUrl`
 * is truthy — the same field the frontend (ChatAssistant.jsx) gates the "Go to
 * checkout →" link on, keeping reply text and link in agreement in every state.
 *
 * @param {object} opts
 * @param {string|undefined|null} opts.checkoutUrl - resolved checkout URL, if any
 * @param {boolean} [opts.cartReset=false] - true on the stale-cart retry path
 * @returns {string}
 */
export function composeAddReply({checkoutUrl, cartReset = false}) {
  const base = cartReset
    ? 'Started a new cart and added the item'
    : 'Added to your assistant cart';
  return checkoutUrl
    ? `${base} — checkout here.`
    : `${base} — I couldn't start checkout just now, but it's saved.`;
}

import {json} from '@shopify/remix-oxygen';

/** @typedef {import('@shopify/remix-oxygen').ActionFunctionArgs} ActionFunctionArgs */

/**
 * @param {ActionFunctionArgs}
 */
export async function action({request, params, context}) {
  // 1. Locale guard — same shape as ($locale)._index.jsx lines 36–43.
  const {language, country} = context.storefront.i18n;
  if (
    params.locale &&
    params.locale.toLowerCase() !== `${language}-${country}`.toLowerCase()
  ) {
    throw new Response(null, {status: 404});
  }

  const formData = await request.formData();

  // 2. Honeypot check — if a bot filled `_gotcha`, return a fake success.
  const honeypot = String(formData.get('_gotcha') ?? '');
  if (honeypot.trim() !== '') {
    return json({ok: true, message: 'Thanks for subscribing.'});
  }

  // 3. Validate email.
  const email = String(formData.get('email') ?? '').trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!email || !emailOk) {
    return json(
      {ok: false, message: 'Please enter a valid email address.'},
      {status: 400},
    );
  }

  // TODO: integrate with email provider.
  // NOTE: Do NOT add unconditional `console.log` here. If you need debug
  // observability during QA, wrap it explicitly:
  //
  //   if (process.env.NODE_ENV !== 'production') {
  //     console.log('[newsletter] submission accepted');
  //   }
  //
  // Even then, treat any such logging as a temporary dev/QA aid that should
  // be removed (or migrated to a proper logger) when the real provider
  // integration lands. Never log the email itself (PII).
  return json({ok: true, message: 'Thanks for subscribing.'});
}

// This route handles POST only. A direct browser GET to /api/newsletter will
// render nothing inside the layout — this is intentional (matching the
// ($locale).api.countries.jsx pattern). Do not chase the empty GET response
// as a bug.
export default function NewsletterApiRoute() {
  return null;
}

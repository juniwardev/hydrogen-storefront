import {redirect} from '@shopify/remix-oxygen';

// fallback wild card for all unauthenticated routes in account section
/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({context, params}) {
  await context.customerAccount.handleAuthStatus();

  const locale = params.locale;
  return redirect(locale ? `/${locale}/account` : '/account');
}

/** @typedef {import('@shopify/remix-oxygen').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

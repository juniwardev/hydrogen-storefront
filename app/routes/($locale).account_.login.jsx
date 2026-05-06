/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({params, request, context}) {
  return context.customerAccount.login();
}

/** @typedef {import('@shopify/remix-oxygen').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

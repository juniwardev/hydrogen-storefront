/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({context, params}) {
  return context.customerAccount.authorize();
}

/** @typedef {import('@shopify/remix-oxygen').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

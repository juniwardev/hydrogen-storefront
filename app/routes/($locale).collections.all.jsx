import {redirect} from '@shopify/remix-oxygen';

/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({params}) {
  return redirect(params?.locale ? `${params.locale}/products` : '/products');
}

/** @typedef {import('@shopify/remix-oxygen').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

export async function loader() {
  throw new Response('Not found', {status: 404});
}

export default function Component() {
  return null;
}

/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

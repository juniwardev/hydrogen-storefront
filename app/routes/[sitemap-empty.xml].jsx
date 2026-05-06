/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({request}) {
  const url = new URL(request.url);
  const baseUrl = url.origin;

  return new Response(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${baseUrl}/</loc></url>
</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': `max-age=${60 * 60 * 24}`,
      },
    },
  );
}

/** @typedef {import('@remix-run/server-runtime').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

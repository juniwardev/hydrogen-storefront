import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import invariant from 'tiny-invariant';
import {getSeoMeta} from '@shopify/hydrogen';

import {PageHeader, Section, Heading} from '~/components/Text';
import {Link} from '~/components/Link';
import {routeHeaders} from '~/data/cache';
import {seoPayload} from '~/lib/seo.server';

export const headers = routeHeaders;

/**
 * @param {LoaderFunctionArgs}
 */
export async function loader({request, context: {storefront}}) {
  const data = await storefront.query(POLICIES_QUERY);

  invariant(data, 'No data returned from Shopify API');
  const policies = Object.values(data.shop).filter(Boolean);

  if (policies.length === 0) {
    throw new Response('Not found', {status: 404});
  }

  const seo = seoPayload.policies({policies, url: request.url});

  return json({
    policies,
    seo,
  });
}

/**
 * @param {Class<loader>>}
 */
export const meta = ({matches}) => {
  return getSeoMeta(...matches.map((match) => match.data.seo));
};

export default function Policies() {
  /** @type {LoaderReturnData} */
  const {policies} = useLoaderData();

  return (
    <>
      <PageHeader heading="Policies" />
      <Section padding="x" className="mb-24">
        {policies.map((policy) => {
          return (
            policy && (
              <Heading className="font-normal text-heading" key={policy.id}>
                <Link to={`/policies/${policy.handle}`}>{policy.title}</Link>
              </Heading>
            )
          );
        })}
      </Section>
    </>
  );
}

const POLICIES_QUERY = `#graphql
  fragment PolicyIndex on ShopPolicy {
    id
    title
    handle
  }

  query PoliciesIndex {
    shop {
      privacyPolicy {
        ...PolicyIndex
      }
      shippingPolicy {
        ...PolicyIndex
      }
      termsOfService {
        ...PolicyIndex
      }
      refundPolicy {
        ...PolicyIndex
      }
      subscriptionPolicy {
        id
        title
        handle
      }
    }
  }
`;

/** @typedef {import('@shopify/remix-oxygen').MetaArgs} MetaArgs */
/** @typedef {import('@shopify/remix-oxygen').LoaderFunctionArgs} LoaderFunctionArgs */
/** @typedef {import('~/lib/type').NonNullableFields} NonNullableFields */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */

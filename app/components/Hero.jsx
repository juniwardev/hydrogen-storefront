import clsx from 'clsx';
import {Image} from '@shopify/hydrogen';

import {Heading, Text} from '~/components/Text';
import {Link} from '~/components/Link';

/**
 * Hero component that renders metafields attached to collection resources
 * @param {HeroProps}
 */
export function Hero({
  title,
  description,
  image,
  cta,
  handle,
  height,
  loading,
  top,
}) {
  return (
    <Link to={`/collections/${handle}`} prefetch="viewport">
      <section
        className={clsx(
          'relative justify-end flex flex-col w-full',
          top && '-mt-nav',
          height === 'full'
            ? 'h-screen'
            : 'aspect-[4/5] sm:aspect-square md:aspect-[5/4] lg:aspect-[3/2] xl:aspect-[2/1]',
        )}
      >
        <div className="absolute inset-0 grid flex-grow grid-flow-col pointer-events-none auto-cols-fr -z-10 content-stretch overflow-clip">
          {image && (
            <div>
              <SpreadMedia sizes="100vw" data={image} loading={loading} />
            </div>
          )}
        </div>
        <div className="flex flex-col items-baseline justify-between gap-4 px-6 py-8 sm:px-8 md:px-12 bg-gradient-to-t dark:from-contrast/60 dark:text-primary from-primary/60 text-contrast">
          {title && (
            <Heading format as="h2" size="display" className="max-w-md">
              {title}
            </Heading>
          )}
          {description && (
            <Text format width="narrow" as="p" size="lead">
              {description}
            </Text>
          )}
          {cta?.value && <Text size="lead">{cta.value}</Text>}
        </div>
      </section>
    </Link>
  );
}

/**
 * @param {SpreadMediaProps}
 */
function SpreadMedia({data, loading, sizes}) {
  return (
    <Image
      data={data}
      className="block object-cover w-full h-full"
      loading={loading}
      sizes={sizes}
      alt={data.altText || data.alt || ''}
    />
  );
}

/**
 * @typedef {{
 *   height?: 'full';
 *   top?: boolean;
 *   loading?: HTMLImageElement['loading'];
 * }} HeroProps
 */
/**
 * @typedef {{
 *   data: Image;
 *   loading?: HTMLImageElement['loading'];
 *   sizes: string;
 * }} SpreadMediaProps
 */

/** @typedef {import('@shopify/hydrogen/storefront-api-types').Image} Image */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Media} Media */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Video} Video */

import {Analytics, Money} from '@shopify/hydrogen';

/**
 * Renders one normalized MCP product card in the shopping assistant panel.
 *
 * Design decisions (per plan §3.5, §5.3):
 * - Image: plain <img loading="lazy"> (no Hydrogen <Image>) because MCP media
 *   provides no width/height (PROBED, AL-22). No fabricated dimensions are passed.
 *   The image directive in CLAUDE.md binds GraphQL queries, not MCP JSON.
 * - Price: <Money data={priceRange.min}> — receives the normalized {amount, currencyCode}
 *   shape from mcp-normalize.js (correct for both catalog and detail paths).
 * - No PDP <Link>: search_catalog products carry no handle/url (PROBED, AL-18/OQ-8).
 *   The sole product destination is the cart checkout_url after add-to-cart.
 * - Analytics: <Analytics.ProductView> with {products: [ProductPayload]} when
 *   firstVariantId is present (required change #7 / G2 / AL-19). ProductPayload.price
 *   is the amount STRING — not the Money object (reviewer note, §0, rev-3).
 *
 * @param {{
 *   product: import('~/lib/mcp-normalize').AssistantProduct,
 *   onAddToCart: (variantId: string) => void,
 * }} props
 */
export function AssistantProductCard({product, onAddToCart}) {
  const {id, title, priceRange, image, firstVariantId, available} = product;

  return (
    <div className="border border-primary/10 rounded-lg overflow-hidden bg-contrast text-primary">
      {/* Product image — plain <img>, no fabricated dimensions (AL-22) */}
      {image ? (
        <div className="aspect-[4/3] overflow-hidden bg-primary/5">
          <img
            src={image.url}
            alt={image.altText || title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}

      <div className="p-3 space-y-2">
        {/* Product title */}
        <h3 className="font-medium text-sm leading-tight">{title}</h3>

        {/* Price — uses the normalized Money shape {amount: string, currencyCode: string} */}
        <p className="text-sm text-primary/80">
          <Money data={priceRange.min} />
        </p>

        {/* Add to cart — disabled when variant is unavailable */}
        {firstVariantId ? (
          <button
            type="button"
            disabled={!available}
            onClick={() => onAddToCart(firstVariantId)}
            className={`w-full text-sm font-medium py-1.5 px-3 rounded transition-colors ${
              available
                ? 'bg-primary text-contrast hover:bg-primary/90'
                : 'bg-primary/20 text-primary/40 cursor-not-allowed'
            }`}
          >
            {available ? 'Add to cart' : 'Sold out'}
          </button>
        ) : null}
      </div>

      {/*
       * Analytics Contract (CLAUDE.md, AL-19 rev-2, required change #7 / G2):
       * Fire Analytics.ProductView per card when firstVariantId is present.
       * ProductPayload.price must be the amount STRING, not the Money object.
       * This card renders inside <Analytics.Provider> via PageLayout → root.jsx.
       * Per-card exemption applies only when firstVariantId is absent (safety net).
       */}
      {firstVariantId ? (
        <Analytics.ProductView
          data={{
            products: [
              {
                id,
                title,
                price: priceRange.min.amount,
                variantId: firstVariantId,
                variantTitle: '',
                quantity: 1,
              },
            ],
          }}
        />
      ) : null}
    </div>
  );
}

# Data Layer Architecture: Storefront API Integration

This document outlines the standard patterns for fetching data from the Shopify Storefront API within the Remix loaders. It defines the GraphQL queries and strict TypeScript interfaces for core routes.

## 1. Homepage (Featured Collection)

**Route:** `app/routes/_index.tsx`

### TypeScript Interfaces

```typescript
import type {
  Collection,
  Product,
  Image,
  MoneyV2,
} from '@shopify/hydrogen/storefront-api-types';

export interface FeaturedCollectionData {
  featuredCollection: Pick<Collection, 'id' | 'title' | 'handle' | 'description'> & {
    products: {
      nodes: Array<
        Pick<Product, 'id' | 'title' | 'handle'> & {
          featuredImage: Pick<Image, 'url' | 'altText' | 'width' | 'height'> | null;
          priceRange: {
            minVariantPrice: Pick<MoneyV2, 'amount' | 'currencyCode'>;
          };
        }
      >;
    };
  };
}
```

### GraphQL Query

```graphql
const FEATURED_COLLECTION_QUERY = `#graphql
  fragment MoneyProductItem on MoneyV2 {
    amount
    currencyCode
  }
  fragment ProductItem on Product {
    id
    title
    handle
    featuredImage {
      url
      altText
      width
      height
    }
    priceRange {
      minVariantPrice {
        ...MoneyProductItem
      }
    }
  }
  query FeaturedCollection($handle: String!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    featuredCollection: collection(handle: $handle) {
      id
      title
      handle
      description
      products(first: 8) {
        nodes {
          ...ProductItem
        }
      }
    }
  }
`;
```

### Remix Loader

```typescript
import {json, type LoaderFunctionArgs} from '@shopify/remix-oxygen';

export async function loader({context}: LoaderFunctionArgs) {
  const {storefront} = context;
  const {featuredCollection} = await storefront.query(FEATURED_COLLECTION_QUERY, {
    variables: {
      handle: 'featured', // Standard handle for featured products
    },
  });

  if (!featuredCollection) {
    throw new Response('Featured Collection Not Found', {status: 404});
  }

  return json({featuredCollection});
}
```

---

## 2. Product Detail Page (PDP)

**Route:** `app/routes/products.$handle.tsx`

### TypeScript Interfaces

```typescript
import type {
  Product,
  ProductVariant,
  Image,
  SelectedOption,
} from '@shopify/hydrogen/storefront-api-types';

export interface ProductData {
  product: Pick<Product, 'id' | 'title' | 'handle' | 'descriptionHtml'> & {
    selectedVariant: Pick<ProductVariant, 'id' | 'availableForSale' | 'sku' | 'title'> & {
      image: Pick<Image, 'url' | 'altText' | 'width' | 'height'> | null;
      price: Pick<MoneyV2, 'amount' | 'currencyCode'>;
      compareAtPrice: Pick<MoneyV2, 'amount' | 'currencyCode'> | null;
      selectedOptions: Array<Pick<SelectedOption, 'name' | 'value'>>;
    };
    variants: {
      nodes: Array<Pick<ProductVariant, 'id' | 'title' | 'availableForSale'>>;
    };
    options: Array<{
      name: string;
      values: string[];
    }>;
  };
}
```

### GraphQL Query

```graphql
const PRODUCT_QUERY = `#graphql
  fragment ProductVariant on ProductVariant {
    id
    availableForSale
    sku
    title
    image {
      url
      altText
      width
      height
    }
    price {
      amount
      currencyCode
    }
    compareAtPrice {
      amount
      currencyCode
    }
    selectedOptions {
      name
      value
    }
  }
  query Product(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
      title
      handle
      descriptionHtml
      options {
        name
        values
      }
      selectedVariant: variantBySelectedOptions(selectedOptions: $selectedOptions) {
        ...ProductVariant
      }
      variants(first: 1) {
        nodes {
          ...ProductVariant
        }
      }
    }
  }
`;
```

### Remix Loader

```typescript
import {json, type LoaderFunctionArgs} from '@shopify/remix-oxygen';
import {getSelectedProductOptions} from '@shopify/hydrogen';

export async function loader({params, request, context}: LoaderFunctionArgs) {
  const {handle} = params;
  const {storefront} = context;

  const selectedOptions = getSelectedProductOptions(request);

  const {product} = await storefront.query(PRODUCT_QUERY, {
    variables: {
      handle,
      selectedOptions,
    },
  });

  if (!product) {
    throw new Response('Product Not Found', {status: 404});
  }

  // Fallback to the first variant if no variant is selected
  const selectedVariant = product.selectedVariant || product.variants.nodes[0];

  return json({
    product,
    selectedVariant,
  });
}
```

## Global Standards
1. **Typing:** Use `@shopify/hydrogen/storefront-api-types` for all base types.
2. **Fragments:** Use GraphQL fragments for repetitive structures like Money and Image objects.
3. **Context:** Always include `@inContext(country: $country, language: $language)` to support localization and internationalization.
4. **Error Handling:** Loaders must explicitly check for the existence of the returned resource and throw a 404 Response if not found.

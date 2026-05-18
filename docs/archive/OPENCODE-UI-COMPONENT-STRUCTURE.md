# UI Component Structure: Homepage and Product Detail Page

This document outlines the UI component hierarchy, local state management, and Tailwind CSS conventions for the Homepage and Product Detail Page (PDP) to assist QA Engineers in understanding the DOM structure.

---

## 1. Homepage UI Components

**Route:** `app/routes/($locale)._index.jsx`

### Component Hierarchy

The `Homepage` component serves as the entry point and orchestrates the display of various sections.

-   **`Homepage`**
    -   `Hero` (for `primaryHero`, `secondaryHero`, `tertiaryHero`)
    -   `ProductSwimlane` (for `featuredCollectionData`)
    -   `FeaturedCollections`

### Local State Management

The `Homepage` component primarily relies on data loaded via the Remix `loader` function and managed by `useLoaderData()`. Data is asynchronously resolved using `Suspense` and `Await`. There is minimal local UI state management within this component itself.

-   **`useLoaderData()`**: Fetches `primaryHero`, `secondaryHero`, `tertiaryHero`, `featuredCollections`, and `featuredCollectionData` (which contains the featured products).
-   **`Suspense` and `Await`**: Used for handling asynchronous data loading for deferred components, preventing render-blocking.

### Tailwind Styling Conventions

Tailwind CSS utility classes are applied directly within the JSX of components.

-   **`Hero`**: Likely uses classes for layout (`height="full"`), positioning (`top`), and responsive behavior.
-   **`ProductSwimlane`**: Contains styling for horizontal scrolling, product card layout, and responsive grids.
-   **`FeaturedCollections`**: Manages the grid layout for displaying collections and their individual styling.

---

## 2. Product Detail Page (PDP) UI Components

**Route:** `app/routes/($locale).products.$productHandle.jsx`

### Component Hierarchy

The `Product` component handles the display of a single product's details, media, options, and purchase actions.

-   **`Product`**
    -   `ProductGallery` (displays product images/media)
    -   `ProductForm` (handles variant selection, add to cart, and buy now)
        -   `ProductOptionSwatch` (if product options have swatches)
        -   `Listbox` (from Headless UI, for options with many values)
        -   `Link` (for individual option values)
        -   `Button` (for add to cart/sold out)
        -   `AddToCartButton`
        -   `ShopPayButton`
    -   `ProductDetail` (for product description, shipping, refund policies)
    -   `ProductSwimlane` (for related/recommended products)

### Local State Management

The PDP component relies heavily on data from the Remix `loader` function, which determines the `selectedVariant`. User interaction with product options triggers navigation that updates the URL, causing the loader to re-run and select a new variant.

-   **`useLoaderData()`**: Fetches `product` (including `id`, `title`, `vendor`, `handle`, `descriptionHtml`, `selectedVariant`, `options`, `media`), `shop` (policies), `recommended` products, and `storeDomain`.
-   **Variant Selection Logic**:
    -   `selectedVariant`: This is determined in the `loader` function. If a `variantBySelectedOptions` is found based on URL parameters, it's used; otherwise, the first variant (`product.variants.nodes[0]`) is used as a fallback.
    -   `getProductOptions()`: Helper function to process the `product.options` and `selectedVariant` to provide structured data for rendering product option selectors (`ProductForm`).
    -   **URL-driven State**: Changing product options (`Listbox` or `Link` elements within `ProductForm`) modifies the URL's query parameters, which in turn triggers a re-run of the loader, effectively updating the `selectedVariant` and re-rendering the component with the new product data. This ensures the UI state is always synchronized with the URL.

### Tailwind Styling Conventions

Tailwind CSS utility classes are extensively used throughout the PDP components for layout, typography, spacing, and responsive design.

-   **Layout**: Flexbox and Grid utilities (`flex`, `grid`, `gap-*`, `md:grid-cols-2`, `lg:col-span-2`, `sticky`, `md:top-nav`, `md:-translate-y-nav`).
-   **Spacing**: Padding and margin utilities (`p-*`, `px-*`, `py-*`, `gap-*`).
-   **Typography**: Font sizes (`text-lead`), weights (`font-medium`), and colors (`opacity-50`).
-   **Borders & Backgrounds**: (`border`, `border-primary`, `bg-contrast`, `rounded`).
-   **Responsive Design**: Prefixes like `md:` and `lg:` are used for applying styles at different breakpoints.
-   **Specific Components**:
    -   `ProductGallery`: Manages image display and potentially a carousel/slider.
    -   `ProductForm`: Styles for option selectors (`Listbox`), buttons, and price display.
    -   `ProductDetail`: Uses `Disclosure` from Headless UI for expandable sections and `prose` for markdown rendering.
    -   `ProductOptionSwatch`: Styles for color or image swatches.

---
This documentation provides a high-level overview. For detailed DOM structure and class usage, inspect the browser's developer tools on the respective pages.

import {CartForm} from '@shopify/hydrogen';

import {Button} from '~/components/Button';

/**
 * @param {{
 *   children: React.ReactNode;
 *   lines: Array<OptimisticCartLineInput>;
 *   className?: string;
 *   variant?: 'primary' | 'secondary' | 'inline';
 *   width?: 'auto' | 'full';
 *   disabled?: boolean;
 *   [key: string]: any;
 * }}
 */
export function AddToCartButton({
  children,
  lines,
  className = '',
  variant = 'primary',
  width = 'full',
  disabled,
  ...props
}) {
  return (
    <CartForm
      route="/cart"
      inputs={{
        lines,
      }}
      action={CartForm.ACTIONS.LinesAdd}
    >
      {(fetcher) => {
        return (
          <>
            <Button
              as="button"
              type="submit"
              width={width}
              variant={variant}
              className={className}
              disabled={disabled ?? fetcher.state !== 'idle'}
              {...props}
            >
              {children}
            </Button>
          </>
        );
      }}
    </CartForm>
  );
}

/** @typedef {import('@shopify/hydrogen').OptimisticCartLineInput} OptimisticCartLineInput */
/** @typedef {import('@remix-run/react').FetcherWithComponents} FetcherWithComponents */

import {useEffect, useRef, useState} from 'react';
import {useFetcher, useRouteLoaderData} from '@remix-run/react';
import {Money} from '@shopify/hydrogen';

import {AssistantProductCard} from '~/components/AssistantProductCard';
import {useIsHydrated} from '~/hooks/useIsHydrated';

/**
 * Floating shopping assistant chat panel.
 *
 * Architecture notes:
 * - This component is browser-only (gated by useIsHydrated) to avoid
 *   SSR/hydration mismatches — no window/document access at render time.
 * - All MCP calls are server-side: this component only POSTs to /api/assistant.
 *   The browser never sees the MCP endpoint URL or raw MCP payloads.
 * - Action URL is a plain string derived from pathPrefix (NOT routed through
 *   <Link>) to avoid the double-prefix pitfall (same pattern as footer newsletter).
 * - The "assistant cart" is separate from the site's Hydrogen cart (OQ-1).
 *   The UI calls this out explicitly per plan §3.5 / §6 dual-cart caveat.
 * - Error state and empty state are visually distinct (required change #2, §3.5):
 *   - Empty: neutral styling, Send stays enabled.
 *   - Error: warning styling, Send may be disabled during rate-limit cool-down.
 */
export function ChatAssistant() {
  const isHydrated = useIsHydrated();

  // Panel open/close state — only relevant after hydration
  const [panelOpen, setPanelOpen] = useState(false);

  // Conversation messages: [{role:'user'|'assistant', ...fields}]
  const [messages, setMessages] = useState([]);

  // The MCP cart id — stored client-side across turns; cleared on cartReset
  const [cartId, setCartId] = useState(null);

  // Controlled input
  const [inputValue, setInputValue] = useState('');

  // Rate-limit cool-down: Send is disabled until this clears
  const [isCoolingDown, setIsCoolingDown] = useState(false);

  const fetcher = useFetcher();
  const isLoading = fetcher.state !== 'idle';

  // Scroll anchor at the bottom of the message list
  const bottomRef = useRef(null);

  // Track processed fetcher.data to avoid double-processing on re-renders
  const processedDataRef = useRef(null);

  // Monotonically increasing message ID so we never use array index as key
  const msgIdRef = useRef(0);

  // NOTE: action URL is a plain string — never pass through ~/components/Link,
  // which would prepend pathPrefix again producing /en-ca/en-ca/api/assistant.
  const pathPrefix =
    useRouteLoaderData('root')?.selectedLocale?.pathPrefix ?? '';
  const assistantAction = `${pathPrefix}/api/assistant`;

  // Process fetcher response when the fetch completes (state transitions to idle)
  useEffect(() => {
    if (
      fetcher.state === 'idle' &&
      fetcher.data &&
      fetcher.data !== processedDataRef.current
    ) {
      processedDataRef.current = fetcher.data;
      const data = fetcher.data;

      // Update stored cartId from the response
      if (data.cart?.id) {
        setCartId(data.cart.id);
      }
      // cartReset means the stale cartId was cleared server-side; clear it here too
      if (data.cartReset) {
        // cart.id from the response IS the new cart — already set above
      }

      // Rate-limit cool-down
      if (data.error?.type === 'rate_limited' && data.error.retryAfterMs > 0) {
        setIsCoolingDown(true);
        setTimeout(() => setIsCoolingDown(false), data.error.retryAfterMs);
      }

      setMessages((prev) => [
        ...prev,
        {_id: ++msgIdRef.current, role: 'assistant', ...data},
      ]);
    }
  }, [fetcher.state, fetcher.data]);

  // Auto-scroll to the latest message
  useEffect(() => {
    if (panelOpen) {
      bottomRef.current?.scrollIntoView({behavior: 'smooth'});
    }
  }, [messages, panelOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading || isCoolingDown) return;

    // Add user message immediately for responsive UX
    setMessages((prev) => [
      ...prev,
      {_id: ++msgIdRef.current, role: 'user', content: trimmed},
    ]);
    setInputValue('');

    fetcher.submit(
      {intent: 'search', message: trimmed},
      {method: 'POST', action: assistantAction},
    );
  };

  const handleAddToCart = (variantId) => {
    if (isLoading) return;
    const formData = {intent: 'add', variantId};
    if (cartId) formData.cartId = cartId;

    fetcher.submit(formData, {method: 'POST', action: assistantAction});
  };

  // SSR / pre-hydration: render nothing so SSR and first client render agree.
  if (!isHydrated) return null;

  const sendDisabled = isLoading || isCoolingDown || !inputValue.trim();

  return (
    <>
      {/* Floating launcher button (bottom-right corner) */}
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        aria-label={
          panelOpen ? 'Close shopping assistant' : 'Open shopping assistant'
        }
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-contrast shadow-lg flex items-center justify-center hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {/* Chat bubble icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-6 h-6"
          aria-hidden="true"
        >
          {panelOpen ? (
            /* Close X */
            <path
              fillRule="evenodd"
              d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          ) : (
            /* Chat bubble */
            <path
              fillRule="evenodd"
              d="M4.804 21.644A6.707 6.707 0 006 21.75a6.721 6.721 0 003.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 01-.814 1.686.75.75 0 00.44 1.223 6.98 6.98 0 003-.344z"
              clipRule="evenodd"
            />
          )}
        </svg>
      </button>

      {/* Chat panel — bespoke lightweight panel (OQ-2: not the full-screen Drawer) */}
      {panelOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 bg-contrast border border-primary/10 rounded-xl shadow-2xl flex flex-col"
          style={{height: '480px'}}
          role="dialog"
          aria-label="Shopping assistant"
          aria-modal="false"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10 flex-shrink-0">
            <div>
              <h2 className="font-semibold text-primary text-sm">
                Shopping Assistant
              </h2>
              <p className="text-xs text-primary/50 leading-none">
                Ask about our products
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Close assistant"
              className="text-primary/50 hover:text-primary p-1 rounded"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Welcome prompt when empty */}
            {messages.length === 0 && (
              <p className="text-center text-primary/40 text-xs py-8">
                Ask about our products — e.g. &ldquo;show me snowboards&rdquo;
              </p>
            )}

            {messages.map((msg) => (
              <MessageItem
                key={msg._id}
                message={msg}
                onAddToCart={handleAddToCart}
              />
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex items-center gap-2 text-primary/50 text-xs py-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0.15s]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0.3s]" />
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-primary/10 px-3 py-3 flex-shrink-0">
            {isCoolingDown && (
              <p className="text-xs text-amber-600 mb-2">
                One moment — rate limit reached. Send will re-enable shortly.
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about our products…"
                maxLength={500}
                disabled={isLoading}
                className="flex-1 border border-primary/20 rounded-lg px-3 py-2 text-sm text-primary bg-contrast placeholder-primary/30 focus:outline-none focus:border-primary/40 disabled:opacity-50"
                aria-label="Message to shopping assistant"
              />
              <button
                type="submit"
                disabled={sendDisabled}
                className="bg-primary text-contrast px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Renders a single message bubble (user or assistant).
 *
 * @param {{
 *   message: object,
 *   onAddToCart: (variantId: string) => void,
 * }} props
 */
function MessageItem({message, onAddToCart}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-primary text-contrast rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message — may carry reply text, products, cart, cartReset, or error
  const {reply, products, productDetail, cart, cartReset, error} = message;

  return (
    <div className="flex flex-col gap-2">
      {/* Reply text */}
      {reply && (
        <div className="max-w-[85%] bg-primary/5 text-primary rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
          {reply}
        </div>
      )}

      {/*
       * EMPTY STATE — visually distinct from error (required change #2, §3.5):
       * products is an array (not undefined) and it's empty → zero results,
       * neutral styling, no error icon, Send stays enabled.
       */}
      {Array.isArray(products) && products.length === 0 && !error && (
        <div className="bg-primary/5 text-primary/70 rounded-xl px-3 py-2 text-xs">
          No matches found — try different words.
        </div>
      )}

      {/* Product cards */}
      {Array.isArray(products) && products.length > 0 && (
        <div className="space-y-2">
          {products.map((product) => (
            <AssistantProductCard
              key={product.id}
              product={product}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      )}

      {/* Product detail card */}
      {productDetail && (
        <AssistantProductCard
          product={productDetail}
          onAddToCart={onAddToCart}
        />
      )}

      {/* Cart summary after add-to-cart */}
      {cart && (
        <div className="bg-primary/5 rounded-xl px-3 py-2 text-xs space-y-1">
          {cartReset && (
            <p className="text-amber-600 font-medium">
              Started a new assistant cart.
            </p>
          )}
          {/* <Money> renders a <div>; wrapping in <p> causes validateDOMNesting error */}
          <div className="text-primary/70">
            {/* Dual-cart caveat (OQ-1, §6): this is an assistant cart separate from the site cart. */}
            Assistant cart — {cart.lineCount}{' '}
            {cart.lineCount === 1 ? 'item' : 'items'} ·{' '}
            <Money data={cart.totalAmount} />
          </div>
          {cart.checkoutUrl && (
            <a
              href={cart.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-medium text-primary underline hover:no-underline"
            >
              Go to checkout →
            </a>
          )}
        </div>
      )}

      {/*
       * ERROR STATE — visually and behaviorally distinct from empty (required change #2, §3.5):
       * Warning styling, error icon, copy names the failure class.
       * Never rendered for a zero-results search (that uses the empty state above).
       */}
      {error && (
        <div
          className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-xs"
          role="alert"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error.message}</span>
        </div>
      )}
    </div>
  );
}

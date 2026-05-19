import {useFetcher, useRouteLoaderData} from '@remix-run/react';

import {Link} from '~/components/Link';
import {Heading, Text, Section} from '~/components/Text';
import {Button} from '~/components/Button';
import {CountrySelector} from '~/components/CountrySelector';
import {
  IconInstagram,
  IconTwitterX,
  IconFacebook,
  IconTikTok,
} from '~/components/Icon';
import {SOCIAL_LINKS} from '~/lib/const';
import {useIsHydrated} from '~/hooks/useIsHydrated';

// Map platform identifiers to their icon components.
const ICON_MAP = {
  instagram: IconInstagram,
  'twitter-x': IconTwitterX,
  facebook: IconFacebook,
  tiktok: IconTikTok,
};

/**
 * @param {FooterProps}
 */
export function Footer({menu}) {
  // NOTE: optional chaining is mandatory on every dereference of rootData.
  // The root loader may be undefined on the first transitional render.
  const rootData = useRouteLoaderData('root');
  const year = new Date().getFullYear();
  const shopName = rootData?.layout?.shop?.name;
  const copyright = shopName ? `© ${year} ${shopName}` : `© ${year}`;

  return (
    <Section
      as="footer"
      display="flex"
      className="bg-primary dark:bg-contrast text-contrast dark:text-primary flex-col"
    >
      {/* Row 1: three equal columns. The grid contains exactly these three children. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
        <FooterNavColumn menu={menu} />
        <FooterSocialColumn />
        <FooterNewsletterColumn />
      </div>

      {/* Row 2: full-width sibling row for the CountrySelector. NOT inside the grid above. */}
      <div className="pt-8 border-t border-contrast/20">
        <CountrySelector />
      </div>

      {/* Row 3: full-width sibling row for the copyright line. */}
      <div className="text-sm opacity-70">{copyright}</div>
    </Section>
  );
}

/**
 * @param {{menu?: EnhancedMenu | null}}
 */
function FooterNavColumn({menu}) {
  return (
    <div>
      <Heading as="h3" size="lead">
        Navigation
      </Heading>
      <nav>
        <ul className="mt-4 grid gap-2">
          {(menu?.items || []).map((item) => (
            <li key={item.id}>
              {item.to.startsWith('http') ? (
                <a
                  href={item.to}
                  target={item.target}
                  rel="noopener noreferrer"
                >
                  {item.title}
                </a>
              ) : (
                <Link to={item.to} target={item.target} prefetch="intent">
                  {item.title}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/**
 * Renders social channel icon links sourced from SOCIAL_LINKS constant.
 * Links with empty `href` values are not rendered (they are operator placeholders).
 */
function FooterSocialColumn() {
  return (
    <div>
      <Heading as="h3" size="lead">
        Follow Us
      </Heading>
      <div className="mt-4 flex gap-4">
        {SOCIAL_LINKS.map(({platform, href, label}) => {
          // Skip rendering links with empty hrefs — they are operator placeholders.
          if (!href) return null;
          const SocialIcon = ICON_MAP[platform];
          if (!SocialIcon) return null;
          return (
            <a
              key={platform}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SocialIcon viewBox="0 0 24 24" />
              <span className="sr-only">{label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Newsletter signup column using useFetcher for inline POST without page reload.
 * The form requires JavaScript — the submit button is disabled until hydration
 * completes to avoid the no-JS broken state (raw JSON on white page).
 */
function FooterNewsletterColumn() {
  const fetcher = useFetcher();
  // NOTE: optional chaining is mandatory on every dereference of rootData.
  // See plan Section 3 "Coding notes" — the root loader may be undefined on the
  // first transitional render.
  const pathPrefix =
    useRouteLoaderData('root')?.selectedLocale?.pathPrefix ?? '';
  // The action URL is a plain string derived manually from pathPrefix.
  // It MUST NOT be run through ~/components/Link or any locale-prefixing
  // helper — Link.jsx already prepends pathPrefix internally, which would
  // produce double-prefixed paths like /en-ca/en-ca/api/newsletter.
  const newsletterAction = `${pathPrefix}/api/newsletter`;
  const isHydrated = useIsHydrated();
  const submitting = fetcher.state !== 'idle';

  return (
    <div>
      <Heading as="h3" size="lead">
        Newsletter
      </Heading>
      <Text as="p" className="mt-2">
        Subscribe for updates.
      </Text>
      <fetcher.Form method="post" action={newsletterAction} className="mt-4">
        {/*
          Honeypot — visually hidden via off-screen positioning (NOT
          display:none). Keeping the field in the rendered layout means
          bots that respect `display:none` still encounter it. This is a
          basic trap, not a complete bot defense — see plan Section 6 Risks.
        */}
        <input
          type="text"
          name="_gotcha"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-9999px',
            width: '1px',
            height: '1px',
          }}
        />
        <div className="flex gap-2">
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            disabled={!isHydrated || submitting}
            className="flex-1 px-3 py-2 rounded border border-contrast/30 bg-transparent text-contrast dark:text-primary"
          />
          <Button type="submit" disabled={!isHydrated || submitting}>
            {submitting ? 'Submitting...' : 'Subscribe'}
          </Button>
        </div>
      </fetcher.Form>
      {fetcher.data ? (
        <p role={fetcher.data.ok ? 'status' : 'alert'} className="mt-2 text-sm">
          {fetcher.data.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * @typedef {{
 *   menu?: EnhancedMenu | null;
 * }} FooterProps
 */

/** @typedef {import('~/lib/utils').EnhancedMenu} EnhancedMenu */

export const PAGINATION_SIZE = 8;
export const DEFAULT_GRID_IMG_LOAD_EAGER_COUNT = 4;
export const ATTR_LOADING_EAGER = 'eager';

// AI shopping assistant constants
export const ASSISTANT_RESULT_LIMIT = 8;
export const MCP_TIMEOUT_MS = 10_000;

// UCP MCP endpoint (plan: docs/plans/ucp-migration.md).
// The agent profile URL is NOT hardcoded here — per the operator clarification on
// plan §5.2, it is read from context.env.PUBLIC_UCP_AGENT_PROFILE_URL (same pattern
// as PUBLIC_STORE_DOMAIN / PUBLIC_STOREFRONT_API_TOKEN) so it can be operator-managed
// and swapped without a code change. See app/lib/mcp.server.js.
export const UCP_MCP_PATH = '/api/ucp/mcp';

// DEV-ONLY: User-Agent sent by the storefront-password cookie shim
// (app/lib/ucp-auth.server.js). CONFIRMED ROOT CAUSE (docs/bugs/ucp-dev-env-issue2-fix-notes.md):
// the dev store's bot-protection layer returns HTTP 403 "Access denied" to
// requests with no User-Agent header. Node's native fetch() silently sends
// "User-Agent: node", which passes; workerd's native fetch() (MiniOxygen)
// sends none, which is blocked. This constant restores a browser-like UA on
// the shim's GET/POST /password requests so both runtimes succeed alike.
export const DEV_SHIM_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// UCP auth modes (docs/plans/ucp-no-auth-mode.md, §3/§6/AL-4). Single source
// of truth for app/lib/mcp.server.js's callTool() switch and the
// ($locale).api.assistant.jsx route's env read — avoids inline string
// literals for a security-sensitive selector (zero-hardcoding directive).
export const UCP_AUTH_MODES = {
  NONE: 'none',
  DEV_COOKIE: 'dev-cookie',
  SIGNED: 'signed',
};

// Default when the operator leaves UCP_AUTH_MODE unset. MUST stay
// DEV_COOKIE (not NONE): this reproduces today's behavior exactly, keeps the
// existing dev-cookie unit suite green with zero edits, and never makes
// "skip auth" reachable by omission (docs/plans/ucp-no-auth-mode.md §3).
export const UCP_DEFAULT_AUTH_MODE = UCP_AUTH_MODES.DEV_COOKIE;

// User-Agent sent on the UCP_AUTH_MODE='none' (cookieless) /api/ucp/mcp
// POST. PRECAUTIONARY, not a proven requirement (AL-2/AL-7,
// docs/plans/ucp-no-auth-mode.md §8): the /password shim legs are CONFIRMED
// to need a UA (see DEV_SHIM_USER_AGENT above), but the existing dev-cookie
// MCP POST (mcp.server.js) sends no UA and is probe-confirmed 200, so a
// UA-less cookieless POST is not proven to 403. Kept as a cheap,
// belt-and-suspenders hedge against workerd's no-UA-by-default fetch();
// see the §10.4a probe result in docs/plans/ucp-no-auth-mode-impl-notes.md
// for whether this has since been confirmed necessary. Intentionally a
// separate constant from DEV_SHIM_USER_AGENT: that constant is documented
// as DEV-ONLY / shim-specific, and the `none` path is explicitly not
// dev-only or shim-mediated.
export const UCP_CLIENT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const SOCIAL_LINKS = [
  {
    platform: 'instagram',
    href: 'https://www.instagram.com/shopify',
    label: 'Instagram',
  },
  {platform: 'twitter-x', href: 'https://x.com/shopify', label: 'Twitter / X'},
  {
    platform: 'facebook',
    href: 'https://www.facebook.com/shopify',
    label: 'Facebook',
  },
  {
    platform: 'tiktok',
    href: 'https://www.tiktok.com/@shopify',
    label: 'TikTok',
  },
  // TODO: replace placeholder hrefs with actual store social profile URLs before production.
];

/**
 * @param {number} index
 */
export function getImageLoadingPriority(
  index,
  maxEagerLoadCount = DEFAULT_GRID_IMG_LOAD_EAGER_COUNT,
) {
  return index < maxEagerLoadCount ? ATTR_LOADING_EAGER : undefined;
}

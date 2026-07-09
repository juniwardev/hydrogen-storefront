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

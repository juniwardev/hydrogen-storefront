export const PAGINATION_SIZE = 8;
export const DEFAULT_GRID_IMG_LOAD_EAGER_COUNT = 4;
export const ATTR_LOADING_EAGER = 'eager';

export const SOCIAL_LINKS = [
  {platform: 'instagram', href: 'https://www.instagram.com/shopify', label: 'Instagram'},
  {platform: 'twitter-x', href: 'https://x.com/shopify', label: 'Twitter / X'},
  {platform: 'facebook', href: 'https://www.facebook.com/shopify', label: 'Facebook'},
  {platform: 'tiktok', href: 'https://www.tiktok.com/@shopify', label: 'TikTok'},
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

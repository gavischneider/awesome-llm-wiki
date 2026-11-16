/**
 * Generates the web app manifest (name, colours and icons) so the site can be
 * pinned to a home screen with the brand logo.
 */
import type { APIRoute } from 'astro';
import { BRAND_LAVENDER, SITE_NAME, href } from '../lib/site';

/**
 * Builds the manifest JSON at build time.
 * @returns JSON response.
 */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: SITE_NAME,
      short_name: 'LLM Wiki',
      start_url: href(),
      display: 'minimal-ui',
      background_color: BRAND_LAVENDER,
      theme_color: BRAND_LAVENDER,
      icons: [192, 512].map((size) => ({
        src: href(`icons/icon-${size}.png`),
        sizes: `${size}x${size}`,
        type: 'image/png',
      })),
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );

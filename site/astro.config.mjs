/**
 * Astro configuration for the Awesome LLM Wiki website.
 *
 * The public address is controlled by two environment variables so the same
 * build works on GitHub Pages today and on a custom domain later:
 *   SITE_URL  - origin of the site (default: https://gavischneider.github.io)
 *   BASE_PATH - path prefix (default: /awesome-llm-wiki; use "/" on a custom domain)
 */
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL ?? 'https://gavischneider.github.io';
const base = process.env.BASE_PATH ?? '/awesome-llm-wiki';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: {
    // Small stylesheets are inlined to avoid a render-blocking request.
    inlineStylesheets: 'auto',
  },
  vite: {
    server: {
      // README.md and CONTRIBUTING.md live one level above the site project.
      fs: { allow: ['..'] },
    },
  },
});

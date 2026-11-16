/**
 * Site-wide constants and URL helpers.
 *
 * Everything that names the repository or builds an internal link lives here,
 * so moving to a custom domain or a renamed repository is a one-file change.
 */

/** GitHub repository that holds the canonical README. */
export const REPO_URL = 'https://github.com/gavischneider/awesome-llm-wiki';

/** Where contributors read the rules and open pull requests. */
export const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;
export const EDIT_README_URL = `${REPO_URL}/edit/main/README.md`;

/** Community link taken from the README's badges. */
export const REDDIT_URL = 'https://reddit.com/r/LLM_Wiki';

export const SITE_NAME = 'Awesome LLM Wiki';

/** Brand colours sampled from the supplied artwork. */
export const BRAND_LAVENDER = '#8878ff';
/** Page background of the dark theme, used for the browser chrome colour. */
export const BRAND_NIGHT = '#130e29';

/**
 * Builds an internal link that respects the configured base path
 * (for example "/awesome-llm-wiki/" on GitHub Pages).
 *
 * @param path Site-relative path without the base, e.g. "search/" or "videos/#some-entry".
 * @returns Absolute path including the base.
 */
export function href(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

/**
 * Extracts a short display host from an outbound URL, e.g.
 * "https://www.github.com/a/b" becomes "github.com".
 *
 * @param url Absolute URL.
 * @returns Host without a leading "www.", or an empty string if the URL cannot be parsed.
 */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

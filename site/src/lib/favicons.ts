/**
 * Knows which site icons (favicons) are available to show next to entries.
 *
 * Icons are downloaded into public/favicons/ by `npm run favicons`
 * (scripts/fetch-favicons.mjs). This module only reports what is on disk, so
 * a build without icons still works and shows letter tiles instead.
 */
import { existsSync, readdirSync } from 'node:fs';
import { displayHost, href } from './site';

const DIRECTORY = new URL('public/favicons/', `file://${process.cwd()}/`);

/** Hosts that have a downloaded icon, e.g. "github.com". */
export const iconHosts: string[] = existsSync(DIRECTORY)
  ? readdirSync(DIRECTORY)
      .filter((name) => name.endsWith('.png'))
      .map((name) => name.slice(0, -4))
      .sort()
  : [];

const available = new Set(iconHosts);

/**
 * Finds the icon to show for an outbound link.
 *
 * @param url Entry URL.
 * @returns The icon's site path when one was downloaded, and the letter to show otherwise.
 */
export function iconFor(url: string): { src: string | null; letter: string } {
  const host = displayHost(url);
  return {
    src: available.has(host) ? href(`favicons/${host}.png`) : null,
    letter: (host[0] ?? '?').toUpperCase(),
  };
}

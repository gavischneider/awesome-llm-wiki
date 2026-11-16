/**
 * Downloads a small site icon (favicon) for every website the README links to.
 *
 * What it does: reads ../README.md with the site's parser, collects the host
 * of each entry's main link (e.g. "github.com", "youtube.com"), and saves a
 * 32x32 PNG per host into public/favicons/. The build then shows that icon
 * next to each entry, and a letter tile for any host without one.
 *
 * Icons are fetched once here, at build time, so visitors' browsers never
 * contact a third-party icon service. Hosts that already have an icon are
 * skipped. A subdomain without its own icon uses its parent domain's icon. A host whose icon cannot be fetched is reported and skipped; the
 * script still exits successfully so a flaky network never blocks a deploy.
 *
 * How to run (from the site/ directory):
 *   npm run favicons               Fetch icons for hosts that have none yet.
 *   npm run favicons -- --refresh  Re-download every icon.
 *   npm run favicons -- --source "https://example.com/icon?host={host}"
 *                                  Use a different icon service; {host} is replaced.
 *
 * First-time setup: `npm install` inside site/. Needs internet access.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseReadme } from '../src/lib/readme-parser.mjs';

/** Icon service used by default. Returns a PNG for a domain; {host} is replaced. */
export const DEFAULT_SOURCE = 'https://www.google.com/s2/favicons?domain={host}&sz=64';

/** Edge length, in pixels, of the saved icons (shown at 16px, so sharp on high-density screens). */
const ICON_SIZE = 32;
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;

/**
 * Reduces an entry URL to the host used as its icon key, without "www.".
 * Must stay in step with displayHost() in src/lib/site.ts.
 *
 * @param {string} url Absolute URL.
 * @returns {string | null} Host, or null if it is not a plain hostname safe to use as a file name.
 */
export function iconHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Lists the distinct hosts of every entry's main link, in README order.
 *
 * @param {string} markdown Contents of README.md.
 * @returns {string[]} Unique hosts.
 */
export function hostsFromReadme(markdown) {
  const catalog = parseReadme(markdown);
  const hosts = new Set();
  for (const section of catalog.sections) {
    for (const entry of [...section.entries, ...section.subsections.flatMap((sub) => sub.entries)]) {
      const host = iconHost(entry.url);
      if (host) hosts.add(host);
    }
  }
  return [...hosts];
}

/**
 * Downloads one host's icon and converts it to a square PNG.
 *
 * @param {string} host Host to fetch the icon for.
 * @param {string} source URL template containing "{host}".
 * @returns {Promise<Buffer>} PNG image data.
 * @throws {Error} When the request fails, times out, or does not return a usable image.
 */
export async function fetchIcon(host, source = DEFAULT_SOURCE) {
  const response = await fetch(source.replace('{host}', encodeURIComponent(host)), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'no content type'})`);
  const original = Buffer.from(await response.arrayBuffer());
  // Re-encoding through sharp validates the bytes and normalises size and format.
  return sharp(original)
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Lists the names to ask the icon service about for a host: the host itself,
 * then its parent domain when it is a subdomain. Personal subdomains such as
 * "someone.substack.com" or "someone.medium.com" often have no icon of their
 * own, and the platform's icon is the next best thing.
 *
 * @param {string} host Host from an entry URL.
 * @returns {string[]} Candidates in the order to try them.
 */
export function iconCandidates(host) {
  const labels = host.split('.');
  return labels.length > 2 ? [host, labels.slice(1).join('.')] : [host];
}

/**
 * Downloads a host's icon, falling back to its parent domain's icon.
 *
 * @param {string} host Host to fetch the icon for.
 * @param {string} source URL template containing "{host}".
 * @returns {Promise<Buffer>} PNG image data.
 * @throws {Error} The failure for the host itself, when no candidate has an icon.
 */
export async function fetchIconWithFallback(host, source = DEFAULT_SOURCE) {
  /** @type {unknown} */
  let firstError;
  for (const candidate of iconCandidates(host)) {
    try {
      return await fetchIcon(candidate, source);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

/**
 * Fetches icons for every host that does not have one yet.
 *
 * @param {object} options
 * @param {string[]} options.hosts Hosts that need an icon.
 * @param {string} options.directory Folder to write "<host>.png" files into.
 * @param {string} [options.source] URL template containing "{host}".
 * @param {boolean} [options.refresh] Re-download icons that already exist.
 * @returns {Promise<{ saved: string[], skipped: string[], failed: { host: string, reason: string }[] }>}
 */
export async function fetchMissingIcons({ hosts, directory, source = DEFAULT_SOURCE, refresh = false }) {
  await mkdir(directory, { recursive: true });
  const existing = new Set((await readdir(directory)).filter((name) => name.endsWith('.png')).map((name) => name.slice(0, -4)));
  const queue = hosts.filter((host) => refresh || !existing.has(host));
  const skipped = hosts.filter((host) => !queue.includes(host));
  /** @type {string[]} */
  const saved = [];
  /** @type {{ host: string, reason: string }[]} */
  const failed = [];

  /** Takes hosts off the shared queue until it is empty. */
  const worker = async () => {
    for (let host = queue.shift(); host !== undefined; host = queue.shift()) {
      try {
        await writeFile(`${directory}/${host}.png`, await fetchIconWithFallback(host, source));
        saved.push(host);
      } catch (error) {
        failed.push({ host, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { saved, skipped, failed };
}

/** Command-line entry point: parses flags, runs the fetch and prints a summary. */
async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const source = sourceIndex >= 0 ? args[sourceIndex + 1] : DEFAULT_SOURCE;
  if (!source || !source.includes('{host}')) {
    console.error('--source needs a URL containing {host}');
    process.exit(1);
  }
  const markdown = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const directory = fileURLToPath(new URL('../public/favicons', import.meta.url));
  const result = await fetchMissingIcons({
    hosts: hostsFromReadme(markdown),
    directory,
    source,
    refresh: args.includes('--refresh'),
  });
  console.log(
    `Site icons: ${result.saved.length} downloaded, ${result.skipped.length} already present, ${result.failed.length} unavailable.`,
  );
  for (const { host, reason } of result.failed) console.log(`  no icon for ${host}: ${reason}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

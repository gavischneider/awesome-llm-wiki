/**
 * Generates the search index consumed by the search page.
 *
 * This is the "generated intermediate representation" of the README: it is
 * rebuilt from README.md on every build and must never be edited by hand.
 */
import type { APIRoute } from 'astro';
import { catalog } from '../lib/catalog';
import type { Entry } from '../lib/catalog';
import { iconHosts } from '../lib/favicons';

/** One searchable entry. Keys are short to keep the download small. */
export interface SearchDoc {
  /** Sequential id. */
  i: number;
  /** Name. */
  n: string;
  /** Original outbound URL. */
  u: string;
  /** Plain-text description. */
  d: string;
  /** Companion link labels and notes, searchable (e.g. "GitHub PyPI"). */
  x: string;
  /** Category key: "section-slug" or "section-slug/subsection-slug". */
  c: string;
  /** Anchor id of the entry on its category page. */
  a: string;
}

/** Payload of search-index.json. */
export interface SearchIndex {
  /** Category key -> display path, e.g. ["Tools and Plugins", "Libraries and Frameworks"]. */
  categories: Record<string, string[]>;
  /** Hosts that have a downloaded site icon at favicons/<host>.png. */
  icons: string[];
  docs: SearchDoc[];
}

/**
 * Serialises every catalog entry, in README order, with its category path.
 * @returns JSON response.
 */
export const GET: APIRoute = () => {
  const index: SearchIndex = { categories: {}, icons: iconHosts, docs: [] };
  /**
   * Adds the entries of one category to the index.
   * @param key Category key.
   * @param path Display path of the category.
   * @param entries Entries in that category.
   */
  const add = (key: string, path: string[], entries: Entry[]) => {
    index.categories[key] = path;
    for (const entry of entries) {
      index.docs.push({
        i: index.docs.length,
        n: entry.name,
        u: entry.url,
        d: entry.descriptionText,
        x: [...entry.companions.map((link) => link.label), ...entry.notes].join(' '),
        c: key,
        a: entry.id,
      });
    }
  };
  for (const section of catalog.sections) {
    add(section.slug, [section.title], section.entries);
    for (const sub of section.subsections) {
      add(`${section.slug}/${sub.slug}`, [section.title, sub.title], sub.entries);
    }
  }
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};

/**
 * Loads the canonical README.md once per build and exposes the parsed catalog
 * plus a few lookup helpers shared by pages and components.
 *
 * README.md (two directories up from this file) is the only content source.
 * If it cannot be parsed, importing this module throws and the build fails.
 */
import { readFileSync } from 'node:fs';
import { parseReadme } from './readme-parser.mjs';
import type { Catalog, Entry, Section, Subsection } from './readme-parser.mjs';

export type { Catalog, Entry, Section, Subsection };

// process.cwd() is the site/ directory for every npm script and for CI.
const README_PATH = new URL('../README.md', `file://${process.cwd()}/`);
const CONTRIBUTING_PATH = new URL('../CONTRIBUTING.md', `file://${process.cwd()}/`);

export const catalog: Catalog = parseReadme(readFileSync(README_PATH, 'utf8'));

/** Raw CONTRIBUTING.md, rendered by the Contribute page. */
export const contributingMarkdown: string = readFileSync(CONTRIBUTING_PATH, 'utf8');

/**
 * Counts every entry in a section, including those in its subsections.
 *
 * @param section Section to count.
 * @returns Total number of entries.
 */
export function sectionEntryCount(section: Section): number {
  return section.entries.length + section.subsections.reduce((n, sub) => n + sub.entries.length, 0);
}

/** One browsable page of the catalog: a section or one of its subsections. */
export interface CatalogPage {
  /** Site-relative path, e.g. "tools-and-plugins/libraries-and-frameworks/". */
  path: string;
  title: string;
  section: Section;
  subsection: Subsection | null;
}

/**
 * Lists every catalog page in README reading order. Used for the
 * previous/next links at the bottom of each page.
 *
 * @returns Section pages, each followed by its subsection pages.
 */
export function catalogPages(): CatalogPage[] {
  return catalog.sections.flatMap((section) => [
    { path: `${section.slug}/`, title: section.title, section, subsection: null },
    ...section.subsections.map((subsection) => ({
      path: `${section.slug}/${subsection.slug}/`,
      title: subsection.title,
      section,
      subsection,
    })),
  ]);
}

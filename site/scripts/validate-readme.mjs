/**
 * Validates ../README.md against the website's parser and prints a summary.
 *
 * What it does: parses the canonical README exactly as the site build does and
 * exits non-zero, listing every problem with its line number, if the README
 * contains structure the site cannot render.
 *
 * How to run (from the site/ directory): `npm run validate`
 * First-time setup: `npm install` inside site/.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReadme } from '../src/lib/readme-parser.mjs';

const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));

try {
  const catalog = parseReadme(readFileSync(readmePath, 'utf8'));
  const subsectionCount = catalog.sections.reduce((n, s) => n + s.subsections.length, 0);
  console.log(
    `README.md OK: ${catalog.entryCount} entries in ${catalog.sections.length} sections and ${subsectionCount} subsections.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

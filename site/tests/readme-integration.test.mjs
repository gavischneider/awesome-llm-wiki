/**
 * Integration tests: the parser against the repository's real README.md.
 *
 * Each check compares the parsed catalog with an independent, deliberately
 * naive reading of the raw README text (regular expressions over lines), so a
 * parser bug that drops or mangles content cannot hide behind the parser's
 * own view of the file.
 *
 * How to run (from site/): `npm test`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReadme, NON_CATALOG_SECTIONS } from '../src/lib/readme-parser.mjs';

const markdown = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const catalog = parseReadme(markdown);
const lines = markdown.split('\n');

/** Every entry with its category titles, flattened in README order. */
const allEntries = catalog.sections.flatMap((section) => [
  ...section.entries.map((entry) => ({ entry, path: [section.title] })),
  ...section.subsections.flatMap((sub) => sub.entries.map((entry) => ({ entry, path: [section.title, sub.title] }))),
]);

/** Raw README text of the catalog only: after Contents, before the non-catalog tail. */
const catalogLines = (() => {
  const headingIndexes = lines.flatMap((line, index) => (/^## /.test(line) ? [index] : []));
  const first = headingIndexes.find((index) => !NON_CATALOG_SECTIONS.has(lines[index].slice(3).trim()));
  const last = headingIndexes.find(
    (index) => index > (first ?? 0) && NON_CATALOG_SECTIONS.has(lines[index].slice(3).trim()),
  );
  return lines.slice(first, last);
})();

// Covers completeness of entries. Exists because the core promise is that no entry
// is omitted. Expected: one parsed entry per top-level "- [" bullet in the catalog.
test('every bullet in the README becomes an entry', () => {
  const bullets = catalogLines.filter((line) => /^- \[/.test(line));
  assert.equal(allEntries.length, bullets.length);
  assert.equal(catalog.entryCount, bullets.length);
});

// Covers ordering and names. Expected: entry names appear in the same order as the
// bullets, each matching the bullet's link text.
test('entries keep README order and names', () => {
  const bullets = catalogLines.filter((line) => /^- \[/.test(line));
  allEntries.forEach(({ entry }, index) => {
    assert.ok(
      bullets[index].startsWith(`- [${entry.name}](${entry.url})`) || bullets[index].includes(`](${entry.url})`),
      `entry ${index} "${entry.name}" does not match bullet: ${bullets[index].slice(0, 80)}`,
    );
  });
});

// Covers headings. Expected: every ## and ### heading after Contents is a section
// or subsection, in order, apart from the documented non-catalog headings.
test('every heading becomes a section or subsection', () => {
  const rawHeadings = catalogLines.filter((line) => /^#{2,3} /.test(line)).map((line) => line.replace(/^#+ /, '').trim());
  const parsed = catalog.sections.flatMap((section) => [section.title, ...section.subsections.map((sub) => sub.title)]);
  assert.deepEqual(parsed, rawHeadings);
});

// Covers outbound links. Exists because every link in the list must survive,
// including companion links and links inside descriptions. Expected: the set of
// URLs in the raw catalog text equals the set of URLs in the parsed output.
test('every outbound link in the catalog is preserved', () => {
  const raw = new Set([...catalogLines.join('\n').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]));
  const parsed = new Set();
  for (const { entry } of allEntries) {
    parsed.add(entry.url);
    for (const link of entry.companions) parsed.add(link.url);
    for (const match of entry.descriptionHtml.matchAll(/href="([^"]+)"/g)) parsed.add(match[1].replace(/&#x26;|&amp;/g, '&'));
  }
  const missing = [...raw].filter((url) => !parsed.has(url));
  assert.deepEqual(missing, []);
});

// Covers descriptions. Expected: every entry has a non-empty description whose
// first words appear in the raw README.
test('every entry has its description', () => {
  const flat = catalogLines.join(' ').replace(/\s+/g, ' ');
  for (const { entry } of allEntries) {
    assert.ok(entry.descriptionText.length > 0, `${entry.name} has no description`);
    const lead = entry.descriptionText.split(/[`*[\]\\]/)[0].slice(0, 40).trim();
    assert.ok(flat.includes(lead), `description of "${entry.name}" not found in README: ${lead}`);
  }
});

// Covers URL stability. Expected: section and subsection slugs are unique, URL-safe
// and equal to the anchors used in the README's own Contents list.
test('section slugs are unique, URL-safe and match the Contents anchors', () => {
  const slugs = catalog.sections.flatMap((section) => [section.slug, ...section.subsections.map((sub) => sub.slug)]);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9-]+$/);
  const contentsAnchors = [...markdown.matchAll(/^\s*- \[[^\]]+\]\(#([^)]+)\)$/gm)].map((match) => match[1]);
  assert.deepEqual(slugs, contentsAnchors);
});

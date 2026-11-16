/**
 * Unit tests for the README parser (src/lib/readme-parser.mjs).
 *
 * They use small hand-written README fixtures to pin down the entry grammar
 * and, above all, the failure behaviour: malformed content must raise a
 * ReadmeStructureError that names the line, never be dropped silently.
 *
 * How to run (from site/): `npm test`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadme, ReadmeStructureError } from '../src/lib/readme-parser.mjs';

/**
 * Builds a minimal valid README around the given catalog body.
 * @param {string} contents Markdown list for the Contents section.
 * @param {string} body Markdown for the catalog sections.
 * @returns {string} Full README text.
 */
function readme(contents, body) {
  return `# Awesome Test [![Badge](https://example.com/b.svg)](https://example.com)\n\n> A tagline.\n\nIntro paragraph.\n\n---\n\n## Contents\n\n${contents}\n\n${body}\n\n## Contributing\n\nSee the guidelines.\n`;
}

const VALID = readme(
  '- [Alpha](#alpha)\n- [Beta](#beta)\n  - [Beta One](#beta-one)',
  [
    '## Alpha',
    '',
    '*Alpha things.*',
    '',
    '- [One](https://example.com/one) - First `thing` here.',
    '- [Two](https://example.com/two) ([GitHub](https://github.com/x/two)) (Acme Labs) - Second',
    '  thing wrapped over two lines.',
    '',
    '## Beta',
    '',
    '### Beta One',
    '',
    '- [One](https://example.com/b1) - Same name, other section.',
  ].join('\n'),
);

/**
 * Asserts that parsing fails with a structure error mentioning a fragment.
 * @param {string} markdown README text expected to be rejected.
 * @param {RegExp} pattern Pattern the error message must match.
 */
function assertRejected(markdown, pattern) {
  assert.throws(
    () => parseReadme(markdown),
    (error) => error instanceof ReadmeStructureError && pattern.test(error.message),
  );
}

// Covers the happy path: title without badges, tagline, intro, hierarchy and order.
// Exists because every page is built from these fields. Expected: exact values below.
test('parses title, tagline, intro, sections and subsections in order', () => {
  const catalog = parseReadme(VALID);
  assert.equal(catalog.title, 'Awesome Test');
  assert.equal(catalog.tagline, 'A tagline.');
  assert.deepEqual(catalog.introText, ['Intro paragraph.']);
  assert.deepEqual(
    catalog.sections.map((s) => [s.slug, s.subsections.map((sub) => sub.slug)]),
    [
      ['alpha', []],
      ['beta', ['beta-one']],
    ],
  );
  assert.equal(catalog.sections[0].descriptionText, 'Alpha things.');
  assert.equal(catalog.entryCount, 3);
});

// Covers the entry grammar: companion links, parenthetical notes, inline code and
// hard-wrapped descriptions. Exists because roughly a third of real entries use
// these forms. Expected: each part lands in its own field with whitespace collapsed.
test('parses companions, notes, inline code and wrapped descriptions', () => {
  const [one, two] = parseReadme(VALID).sections[0].entries;
  assert.equal(one.name, 'One');
  assert.equal(one.url, 'https://example.com/one');
  assert.equal(one.descriptionHtml, 'First <code>thing</code> here.');
  assert.deepEqual(two.companions, [{ label: 'GitHub', url: 'https://github.com/x/two' }]);
  assert.deepEqual(two.notes, ['Acme Labs']);
  assert.equal(two.descriptionText, 'Second thing wrapped over two lines.');
});

// Covers anchor generation. Exists because deep links must be stable and unique
// per page. Expected: slugs derive from names, and repeat names on one page get suffixes.
test('gives entries stable ids that are unique within a page', () => {
  const markdown = readme(
    '- [Alpha](#alpha)',
    '## Alpha\n\n- [Same Name](https://example.com/1) - First.\n- [Same Name](https://example.com/2) - Second.',
  );
  assert.deepEqual(
    parseReadme(markdown).sections[0].entries.map((entry) => entry.id),
    ['same-name', 'same-name-1'],
  );
});

// Covers a missing " - " separator. Exists so a malformed entry fails the build
// instead of disappearing. Expected: error naming the separator and the line.
test('rejects an entry without the " - " separator', () => {
  const markdown = readme('- [Alpha](#alpha)', '## Alpha\n\n- [One](https://example.com/one) No separator here.');
  assertRejected(markdown, /line \d+: entry is missing the " - " separator/);
});

// Covers entries that do not start with a link. Expected: error.
test('rejects an entry that does not start with a link', () => {
  const markdown = readme('- [Alpha](#alpha)', '## Alpha\n\n- Plain text - With a description.');
  assertRejected(markdown, /entry must start with a \[Name\]\(URL\) link/);
});

// Covers stray text between the name and the separator, which would otherwise be
// ambiguous (part of the name? a note?). Expected: error.
test('rejects unparenthesised text between the name and the separator', () => {
  const markdown = readme('- [Alpha](#alpha)', '## Alpha\n\n- [One](https://example.com/one) by Someone - Described.');
  assertRejected(markdown, /must be parenthesised links or notes/);
});

// Covers nested lists under an entry. Exists because nested items have no place
// in the site's model and must not be dropped. Expected: error.
test('rejects nested lists inside an entry', () => {
  const markdown = readme(
    '- [Alpha](#alpha)',
    '## Alpha\n\n- [One](https://example.com/one) - Described.\n  - [Child](https://example.com/c) - Nested.',
  );
  assertRejected(markdown, /list item must be a single paragraph/);
});

// Covers unsupported block types (tables, code blocks, deeper headings, stray prose).
// Exists so new README structure is noticed and supported deliberately. Expected: errors.
test('rejects unsupported blocks and heading levels', () => {
  const base = '## Alpha\n\n- [One](https://example.com/one) - Described.\n\n';
  assertRejected(readme('- [Alpha](#alpha)', `${base}#### Too Deep`), /unsupported heading "#### Too Deep"/);
  assertRejected(readme('- [Alpha](#alpha)', `${base}\`\`\`\ncode\n\`\`\``), /unsupported "code" block in "Alpha"/);
  assertRejected(readme('- [Alpha](#alpha)', `${base}Stray prose after entries.`), /unsupported paragraph in "Alpha"/);
});

// Covers empty categories. Expected: error naming the section.
test('rejects a section with no entries', () => {
  const markdown = readme('- [Alpha](#alpha)\n- [Empty](#empty)', '## Alpha\n\n- [One](https://example.com/one) - Described.\n\n## Empty');
  assertRejected(markdown, /section "Empty" has no entries/);
});

// Covers drift between the Contents list and the headings (missing, renamed or
// re-nested). Exists because the Contents list is how new sections are declared.
// Expected: error for each kind of mismatch.
test('rejects a Contents list that does not match the headings', () => {
  const body = '## Alpha\n\n- [One](https://example.com/one) - Described.\n\n## Beta\n\n- [Two](https://example.com/two) - Described.';
  assertRejected(readme('- [Alpha](#alpha)', body), /heading "Beta" is missing from Contents/);
  assertRejected(readme('- [Alpha](#alpha)\n- [Gamma](#gamma)', body), /does not match heading "Beta"/);
  assertRejected(readme('- [Alpha](#alpha)\n  - [Beta](#beta)', body), /does not match heading "Beta"/);
});

// Covers forward compatibility: a brand-new section with a subsection needs no code
// change. Expected: it parses and appears in order.
test('accepts new sections and subsections without code changes', () => {
  const markdown = readme(
    '- [Alpha](#alpha)\n- [Brand New](#brand-new)\n  - [New Sub](#new-sub)',
    '## Alpha\n\n- [One](https://example.com/one) - Described.\n\n## Brand New\n\n*New.*\n\n### New Sub\n\n- [N](https://example.com/n) - Described.',
  );
  const catalog = parseReadme(markdown);
  assert.equal(catalog.sections[1].title, 'Brand New');
  assert.equal(catalog.sections[1].subsections[0].entries[0].name, 'N');
});

// Covers raw HTML in descriptions. Exists as a safety check: README HTML must never
// be injected into pages. Expected: rejected as unsupported markup.
test('rejects raw HTML inside a description', () => {
  const markdown = readme('- [Alpha](#alpha)', '## Alpha\n\n- [One](https://example.com/one) - Has <b>html</b> inside.');
  assertRejected(markdown, /unsupported "html" markup in entry description/);
});

// Covers error aggregation. Exists so a contributor sees every problem in one run.
// Expected: both malformed entries are listed.
test('reports every problem at once', () => {
  const markdown = readme(
    '- [Alpha](#alpha)',
    '## Alpha\n\n- [Ok](https://example.com/ok) - Fine.\n- [One](https://example.com/one) No separator.\n- Not a link - Described.',
  );
  assert.throws(
    () => parseReadme(markdown),
    (error) => error instanceof ReadmeStructureError && error.problems.length === 2,
  );
});

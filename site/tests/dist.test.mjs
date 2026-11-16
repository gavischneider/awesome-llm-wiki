/**
 * Build-output tests: checks the generated site in dist/ against the README.
 *
 * They confirm that what was parsed actually reached the published HTML:
 * every category has a page, every entry's link and anchor is on its page,
 * the search index covers every entry, and the SEO files exist.
 *
 * How to run (from site/): `npm run build && npm run test:dist`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseReadme } from '../src/lib/readme-parser.mjs';

const catalog = parseReadme(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'));
const dist = new URL('../dist/', import.meta.url);

/**
 * Reads a built file as text.
 * @param {string} path Path relative to dist/.
 * @returns {string} File contents.
 */
function read(path) {
  return readFileSync(new URL(path, dist), 'utf8');
}

/**
 * Escapes a string the way it appears inside an HTML attribute value.
 * @param {string} value Raw value.
 * @returns {string} Attribute-escaped value.
 */
function attr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Every catalog page with the entries it must contain. */
const pages = catalog.sections.flatMap((section) => [
  { path: `${section.slug}/index.html`, title: section.title, entries: section.entries },
  ...section.subsections.map((sub) => ({
    path: `${section.slug}/${sub.slug}/index.html`,
    title: sub.title,
    entries: sub.entries,
  })),
]);

// Covers page generation. Expected: one HTML page per section and subsection.
test('every section and subsection has a page', () => {
  for (const page of pages) assert.ok(existsSync(new URL(page.path, dist)), `missing ${page.path}`);
});

// Covers rendering of entries. Exists because parsing alone does not prove the
// HTML is complete. Expected: each entry's anchor id, outbound URL and companion
// URLs are present on its category page.
test('every entry is rendered with its link and anchor', () => {
  let checked = 0;
  for (const page of pages) {
    const html = read(page.path);
    for (const entry of page.entries) {
      assert.ok(html.includes(`id="${entry.id}"`), `${page.path} is missing anchor for "${entry.name}"`);
      assert.ok(html.includes(`href="${attr(entry.url)}"`), `${page.path} is missing link for "${entry.name}"`);
      for (const link of entry.companions) {
        assert.ok(html.includes(`href="${attr(link.url)}"`), `${page.path} is missing companion link ${link.url}`);
      }
      checked += 1;
    }
  }
  assert.equal(checked, catalog.entryCount);
});

// Covers the home page directory. Expected: it names every section and subsection.
test('home page lists every section and subsection', () => {
  const html = read('index.html');
  for (const section of catalog.sections) {
    assert.ok(html.includes(`${section.slug}/"`), `home is missing a link to ${section.slug}`);
    for (const sub of section.subsections) {
      assert.ok(html.includes(`${section.slug}/${sub.slug}/"`), `home is missing a link to ${sub.slug}`);
    }
  }
});

// Covers the search index. Expected: one document per entry, in README order,
// each pointing at a known category.
test('search index contains every entry', () => {
  /** @type {{ categories: Record<string, string[]>, docs: { n: string, c: string }[] }} */
  const index = JSON.parse(read('search-index.json'));
  assert.equal(index.docs.length, catalog.entryCount);
  const names = catalog.sections.flatMap((section) => [
    ...section.entries.map((entry) => entry.name),
    ...section.subsections.flatMap((sub) => sub.entries.map((entry) => entry.name)),
  ]);
  assert.deepEqual(
    index.docs.map((doc) => doc.n),
    names,
  );
  for (const doc of index.docs) assert.ok(doc.c in index.categories, `unknown category ${doc.c}`);
});

// Covers SEO and sharing essentials. Expected: sitemap, robots.txt, 404 page,
// social image and icons exist, and pages carry canonical and Open Graph tags.
test('SEO files and metadata are present', () => {
  for (const file of ['sitemap-index.xml', 'robots.txt', '404.html', 'og-cover.jpg', 'icons/icon-32.png', 'manifest.webmanifest']) {
    assert.ok(existsSync(new URL(file, dist)), `missing ${file}`);
  }
  const html = read(pages[0].path);
  assert.match(html, /<link rel="canonical" href="https?:\/\/[^"]+\/"/);
  assert.match(html, /<meta property="og:image" content="https?:\/\/[^"]+og-cover\.jpg"/);
  assert.match(read('404.html'), /<meta name="robots" content="noindex"/);
  const sitemap = read('sitemap-0.xml');
  for (const page of pages) assert.ok(sitemap.includes(`/${page.path.replace('index.html', '')}<`), `sitemap is missing ${page.path}`);
});

// Covers site icons. Exists because an icon path that does not resolve would show
// as a broken image. Expected: every favicon referenced by a page exists in dist,
// and every entry has either an icon or a letter tile.
test('every referenced site icon exists and every entry has an icon or letter tile', () => {
  for (const page of pages) {
    const html = read(page.path);
    for (const match of html.matchAll(/class="favicon" src="[^"]*\/(favicons\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(match[1], dist)), `${page.path} references missing ${match[1]}`);
    }
    const tiles = [...html.matchAll(/class="favicon[ "]/g)].length;
    assert.equal(tiles, page.entries.length, `${page.path} icon count`);
  }
});

// Covers the privacy requirement. Expected: no third-party scripts, fonts or
// trackers are referenced from any page.
test('pages load no third-party resources', () => {
  for (const path of ['index.html', 'search/index.html', pages[0].path]) {
    const html = read(path);
    const external = [...html.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => !url.startsWith('https://gavischneider.github.io') && !/rel="(canonical|sitemap)"/.test(html.slice(html.indexOf(url) - 40, html.indexOf(url))));
    assert.deepEqual(external, [], `${path} references external resources`);
  }
});

// Covers a formatting slip that is easy to reintroduce: in Astro templates a line
// break before an inline element can drop the space, gluing a word to a link
// ("repository'sCONTRIBUTING.md"). Expected: no letter sits directly against the
// start of a link or button in the pages' prose.
test('prose is not glued to links or buttons', () => {
  for (const path of ['index.html', 'contribute/index.html', 'search/index.html', '404.html', pages[0].path]) {
    const html = read(path).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '');
    const glued = [...html.matchAll(/[A-Za-z,'’]<(?:a|kbd|button)\b[^>]*>[^<]{0,30}/g)].map((match) => match[0].slice(0, 60));
    assert.deepEqual(glued, [], `${path} has text glued to an inline element`);
  }
});

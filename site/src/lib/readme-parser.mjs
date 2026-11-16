/**
 * README parser for Awesome LLM Wiki.
 *
 * Turns the repository's canonical README.md into a structured catalog
 * (sections -> subsections -> entries) that the website renders. The README
 * stays the single source of truth; nothing here is edited by hand per entry.
 *
 * The parser is deliberately strict: any structure it does not recognise is
 * reported as an error (with the README line number) instead of being dropped,
 * so a malformed entry fails the build rather than vanishing from the site.
 *
 * How to run: imported by the site (src/lib/catalog.ts), by
 * scripts/validate-readme.mjs (`npm run validate`) and by the tests.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';

/**
 * @typedef {{ label: string, url: string }} CompanionLink A secondary link written as "([Label](url))" after the entry name.
 *
 * @typedef {object} Entry One curated resource.
 * @property {string} id Anchor id, unique within its section or subsection page.
 * @property {string} name Link text of the resource.
 * @property {string} url Original outbound URL.
 * @property {CompanionLink[]} companions Secondary links such as GitHub, PyPI or Docs.
 * @property {string[]} notes Plain parenthetical notes written after the name, e.g. "(Penfield Labs)".
 * @property {string} descriptionHtml Description as sanitised inline HTML.
 * @property {string} descriptionText Description as plain text (used for search).
 * @property {number} line README line the entry starts on.
 *
 * @typedef {object} Subsection A level-3 heading inside a section.
 * @property {string} title
 * @property {string} slug GitHub-compatible heading anchor, used as the URL segment.
 * @property {string | null} descriptionHtml
 * @property {string | null} descriptionText
 * @property {Entry[]} entries
 * @property {number} line
 *
 * @typedef {object} Section A level-2 heading listed in the README's Contents.
 * @property {string} title
 * @property {string} slug
 * @property {string | null} descriptionHtml
 * @property {string | null} descriptionText
 * @property {Entry[]} entries Entries placed directly under the section.
 * @property {Subsection[]} subsections
 * @property {number} line
 *
 * @typedef {object} Catalog
 * @property {string} title Text of the README's level-1 heading.
 * @property {string} tagline Text of the README's opening blockquote.
 * @property {string[]} introHtml Intro paragraphs that follow the tagline, as inline HTML.
 * @property {string[]} introText The same paragraphs as plain text.
 * @property {Section[]} sections Catalog sections in README order.
 * @property {number} entryCount Total number of entries.
 */

/**
 * Level-2 headings that are part of the README but are not catalog categories.
 * "Contents" is the table of contents (validated against the parsed sections)
 * and "Contributing" is a pointer to CONTRIBUTING.md, which the site renders
 * on its own page. Any other heading must be a catalog section.
 */
export const NON_CATALOG_SECTIONS = new Set(['Contents', 'Contributing']);

/** Inline node types allowed inside descriptions. Anything else is an error. */
const INLINE_TYPES = new Set(['text', 'inlineCode', 'emphasis', 'strong', 'link', 'break']);

/** Error thrown when the README has structure the site cannot represent faithfully. */
export class ReadmeStructureError extends Error {
  /**
   * @param {string[]} problems Human-readable problems, each prefixed with a line number.
   */
  constructor(problems) {
    super(
      `README.md has ${problems.length} structural problem(s) the website cannot render:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nFix the README (see CONTRIBUTING.md for the entry format) or extend site/src/lib/readme-parser.mjs.',
    );
    this.name = 'ReadmeStructureError';
    this.problems = problems;
  }
}

/**
 * Returns the 1-based README line a node starts on, for error messages.
 * @param {import('mdast').Nodes} node
 * @returns {number}
 */
function lineOf(node) {
  return node.position?.start.line ?? 0;
}

/**
 * Collapses the hard-wrapped whitespace the README uses (120-column prose)
 * into single spaces.
 * @param {string} text
 * @returns {string}
 */
function normaliseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Renders inline markdown nodes to HTML. Raw HTML in the README is never
 * passed through (mdast-util-to-hast drops it by default), so the output is
 * safe to inject into pages.
 * @param {import('mdast').PhrasingContent[]} nodes
 * @returns {string}
 */
function inlineHtml(nodes) {
  const hast = toHast({ type: 'paragraph', children: nodes });
  const html = toHtml(/** @type {import('hast').Element} */ (hast).children);
  return html.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Checks that every node in an inline tree is a supported type.
 * @param {import('mdast').PhrasingContent[]} nodes
 * @param {(message: string) => void} report
 * @param {string} where Description of the location, for the error message.
 */
function assertInline(nodes, report, where) {
  for (const node of nodes) {
    if (!INLINE_TYPES.has(node.type)) {
      report(`unsupported "${node.type}" markup in ${where}`);
    }
    if ('children' in node) assertInline(node.children, report, where);
  }
}

/**
 * Parses one list item of the form
 * `[Name](url) ([Label](url))… (note)… - Description.`
 *
 * The part between the name and the " - " separator may only contain
 * parenthesised companion links or plain parenthesised notes; this keeps a
 * stray dash inside a name or a missing separator from being misread.
 *
 * @param {import('mdast').ListItem} item
 * @param {(line: number, message: string) => void} report
 * @returns {Omit<Entry, 'id'> | null} The entry, or null when it was reported as malformed.
 */
function parseEntry(item, report) {
  const line = lineOf(item);
  const preview = `"${normaliseWhitespace(toString(item)).slice(0, 70)}…"`;
  /** @param {string} message */
  const fail = (message) => {
    report(line, `${message}: ${preview}`);
    return null;
  };

  if (item.children.length !== 1 || item.children[0].type !== 'paragraph') {
    return fail('list item must be a single paragraph (no nested lists or extra blocks)');
  }
  const nodes = item.children[0].children;
  const first = nodes[0];
  if (!first || first.type !== 'link') {
    return fail('entry must start with a [Name](URL) link');
  }
  const name = normaliseWhitespace(toString(first));
  if (!name) return fail('entry link has no text');
  if (!/^https?:\/\//.test(first.url)) return fail(`entry URL must be http(s), got "${first.url}"`);

  // Locate the " - " separator: the first text node after the name that contains it.
  let separatorIndex = -1;
  let separatorOffset = -1;
  for (let i = 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type !== 'text') continue;
    const match = /\s-\s/.exec(node.value);
    if (match) {
      separatorIndex = i;
      separatorOffset = match.index;
      break;
    }
  }
  if (separatorIndex === -1) {
    return fail('entry is missing the " - " separator between the name and the description');
  }
  const separatorNode = /** @type {import('mdast').Text} */ (nodes[separatorIndex]);

  // Everything between the name and the separator: companion links and notes.
  /** @type {CompanionLink[]} */
  const companions = [];
  let metaPattern = '';
  for (const node of nodes.slice(1, separatorIndex)) {
    if (node.type === 'text') {
      metaPattern += node.value;
    } else if (node.type === 'link') {
      companions.push({ label: normaliseWhitespace(toString(node)), url: node.url });
      metaPattern += '\u0000';
    } else {
      return fail(`unsupported "${node.type}" markup between the entry name and the " - " separator`);
    }
  }
  metaPattern += separatorNode.value.slice(0, separatorOffset);
  /** @type {string[]} */
  const notes = [];
  const metaRemainder = metaPattern.replace(/\s*\(([^()]+)\)/g, (_, inner) => {
    if (inner !== '\u0000') notes.push(normaliseWhitespace(inner));
    return '';
  });
  if (metaRemainder.trim() !== '') {
    return fail(
      'text between the entry name and the " - " separator must be parenthesised links or notes, e.g. "([GitHub](url))"',
    );
  }

  /** @type {import('mdast').PhrasingContent[]} */
  const descriptionNodes = [
    { type: 'text', value: separatorNode.value.slice(separatorOffset).replace(/^\s-\s/, '') },
    ...nodes.slice(separatorIndex + 1),
  ];
  let unsupported = false;
  assertInline(
    descriptionNodes,
    (message) => {
      unsupported = true;
      fail(message);
    },
    'entry description',
  );
  if (unsupported) return null;
  const descriptionText = normaliseWhitespace(toString({ type: 'paragraph', children: descriptionNodes }));
  if (!descriptionText) return fail('entry has an empty description');

  return {
    name,
    url: first.url,
    companions,
    notes,
    descriptionHtml: inlineHtml(descriptionNodes),
    descriptionText,
    line,
  };
}

/**
 * Flattens the README's nested "Contents" list into heading slugs, in order.
 * @param {import('mdast').List} list
 * @param {number} depth
 * @param {{ slug: string, title: string, depth: number, line: number }[]} out
 * @param {(line: number, message: string) => void} report
 */
function collectContents(list, depth, out, report) {
  for (const item of list.children) {
    const [paragraph, ...rest] = item.children;
    const inline = paragraph?.type === 'paragraph' ? paragraph.children : [];
    const link = inline[0];
    if (!link || link.type !== 'link' || !link.url.startsWith('#') || inline.length !== 1) {
      report(lineOf(item), 'Contents items must each be a single [Title](#anchor) link');
      continue;
    }
    out.push({ slug: link.url.slice(1), title: normaliseWhitespace(toString(link)), depth, line: lineOf(item) });
    for (const child of rest) {
      if (child.type === 'list') collectContents(child, depth + 1, out, report);
      else report(lineOf(child), `unsupported "${child.type}" block inside Contents`);
    }
  }
}

/**
 * Parses the full README markdown into a catalog.
 *
 * @param {string} markdown Contents of README.md.
 * @returns {Catalog}
 * @throws {ReadmeStructureError} When any part of the README cannot be represented.
 */
export function parseReadme(markdown) {
  const tree = fromMarkdown(markdown);
  /** @type {string[]} */
  const problems = [];
  /** @param {number} line @param {string} message */
  const report = (line, message) => problems.push(`line ${line}: ${message}`);

  // One slugger for the whole document reproduces GitHub's heading anchors,
  // including the "-1" suffixes it adds to duplicate headings.
  const headingSlugger = new GithubSlugger();

  let title = '';
  let tagline = '';
  /** @type {string[]} */
  const introHtml = [];
  /** @type {string[]} */
  const introText = [];
  /** @type {Section[]} */
  const sections = [];
  /** @type {{ slug: string, title: string, depth: number, line: number }[]} */
  const contents = [];
  let sawContents = false;

  /** @type {'preamble' | 'contents' | 'skip' | 'catalog'} */
  let mode = 'preamble';
  /** @type {Section | null} */
  let section = null;
  /** @type {Section | Subsection | null} */
  let target = null;
  /** @type {GithubSlugger} */
  let entrySlugger = new GithubSlugger();

  for (const node of tree.children) {
    const line = lineOf(node);
    if (node.type === 'thematicBreak') continue;

    if (node.type === 'heading') {
      const headingTitle = normaliseWhitespace(toString(node));
      if (node.depth === 1) {
        if (title) report(line, 'more than one level-1 heading');
        // The H1 carries badge images/links after the name; keep only its leading text.
        const lead = node.children[0];
        title = lead?.type === 'text' ? normaliseWhitespace(lead.value) : headingTitle;
        headingSlugger.slug(headingTitle);
        continue;
      }
      const slug = headingSlugger.slug(headingTitle);
      if (node.depth === 2) {
        section = null;
        target = null;
        if (headingTitle === 'Contents') {
          mode = 'contents';
          sawContents = true;
        } else if (NON_CATALOG_SECTIONS.has(headingTitle)) {
          mode = 'skip';
        } else {
          mode = 'catalog';
          section = {
            title: headingTitle,
            slug,
            descriptionHtml: null,
            descriptionText: null,
            entries: [],
            subsections: [],
            line,
          };
          sections.push(section);
          target = section;
          entrySlugger = new GithubSlugger();
        }
        continue;
      }
      if (node.depth === 3 && mode === 'catalog' && section) {
        /** @type {Subsection} */
        const subsection = { title: headingTitle, slug, descriptionHtml: null, descriptionText: null, entries: [], line };
        section.subsections.push(subsection);
        target = subsection;
        entrySlugger = new GithubSlugger();
        continue;
      }
      report(line, `unsupported heading "${'#'.repeat(node.depth)} ${headingTitle}" (only ## sections and ### subsections are supported)`);
      continue;
    }

    if (mode === 'preamble') {
      if (node.type === 'blockquote' && !tagline) {
        tagline = normaliseWhitespace(toString(node));
      } else if (node.type === 'paragraph' && node.children.every((child) => child.type === 'image')) {
        // Cover image; the site uses its own optimised copy of the artwork.
      } else if (node.type === 'paragraph' && title) {
        assertInline(node.children, (message) => report(line, message), 'intro paragraph');
        introHtml.push(inlineHtml(node.children));
        introText.push(normaliseWhitespace(toString(node)));
      } else {
        report(line, `unsupported "${node.type}" block before the first section`);
      }
      continue;
    }

    if (mode === 'contents') {
      if (node.type === 'list') collectContents(node, 2, contents, report);
      else report(line, `unsupported "${node.type}" block inside Contents`);
      continue;
    }

    if (mode === 'skip') continue;

    // mode === 'catalog'
    if (!target) {
      report(line, `"${node.type}" block is not inside a section`);
      continue;
    }
    if (node.type === 'paragraph') {
      const only = node.children.length === 1 ? node.children[0] : null;
      if (only && only.type === 'emphasis' && target.entries.length === 0 && target.descriptionHtml === null) {
        assertInline(only.children, (message) => report(line, message), 'section description');
        target.descriptionHtml = inlineHtml(only.children);
        target.descriptionText = normaliseWhitespace(toString(only));
      } else {
        report(
          line,
          `unsupported paragraph in "${target.title}" (only one italic description line before the entries is supported): "${normaliseWhitespace(toString(node)).slice(0, 70)}…"`,
        );
      }
      continue;
    }
    if (node.type === 'list') {
      if (node.ordered) report(line, `ordered list in "${target.title}" (entries must use "-" bullets)`);
      for (const item of node.children) {
        const entry = parseEntry(item, report);
        if (entry) target.entries.push({ id: entrySlugger.slug(entry.name), ...entry });
      }
      continue;
    }
    report(line, `unsupported "${node.type}" block in "${target.title}"`);
  }

  if (!title) problems.push('line 1: missing level-1 heading');
  if (!tagline) problems.push('line 1: missing the opening blockquote tagline');
  if (!sawContents) problems.push('line 1: missing the "## Contents" section');

  // Sections must contain something, and headings must stay unique enough to be URLs.
  const seenSlugs = new Set();
  for (const s of sections) {
    if (seenSlugs.has(s.slug)) report(s.line, `duplicate section URL "${s.slug}"`);
    seenSlugs.add(s.slug);
    if (s.entries.length === 0 && s.subsections.length === 0) report(s.line, `section "${s.title}" has no entries`);
    for (const sub of s.subsections) {
      if (sub.entries.length === 0) report(sub.line, `subsection "${sub.title}" has no entries`);
    }
  }

  // The Contents list must mirror the parsed hierarchy exactly. This catches
  // headings that were added, renamed or re-nested without updating Contents.
  if (sawContents) {
    const expected = sections.flatMap((s) => [
      { slug: s.slug, title: s.title, depth: 2, line: s.line },
      ...s.subsections.map((sub) => ({ slug: sub.slug, title: sub.title, depth: 3, line: sub.line })),
    ]);
    const length = Math.max(expected.length, contents.length);
    for (let i = 0; i < length; i += 1) {
      const want = expected[i];
      const got = contents[i];
      if (!want) {
        report(got.line, `Contents lists "${got.title}" but no matching heading follows`);
      } else if (!got) {
        report(want.line, `heading "${want.title}" is missing from Contents`);
      } else if (want.slug !== got.slug || want.title !== got.title || want.depth !== got.depth) {
        report(
          got.line,
          `Contents item "${got.title}" (#${got.slug}) does not match heading "${want.title}" (#${want.slug}) on line ${want.line}`,
        );
        break;
      }
    }
  }

  if (problems.length > 0) throw new ReadmeStructureError(problems);

  const entryCount = sections.reduce(
    (total, s) => total + s.entries.length + s.subsections.reduce((n, sub) => n + sub.entries.length, 0),
    0,
  );
  return { title, tagline, introHtml, introText, sections, entryCount };
}

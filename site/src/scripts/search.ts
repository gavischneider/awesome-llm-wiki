/**
 * Client-side search for the search page.
 *
 * Downloads search-index.json (generated from the README at build time),
 * indexes entry names, descriptions and companion labels with MiniSearch, and
 * renders results as the user types. The query and category filter are kept
 * in the URL (?q=…&in=…) so searches can be linked and shared.
 */
import MiniSearch from 'minisearch';
import type { SearchDoc, SearchIndex } from '../pages/search-index.json';

/** Results rendered per "page" before the "Show more" button appears. */
const PAGE_SIZE = 50;

/**
 * Finds a required element on the search page.
 * @param selector CSS selector.
 * @returns The element; throws if the page markup is missing it.
 */
function need<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Search page is missing ${selector}`);
  return element;
}

const form = need<HTMLFormElement>('[data-search-form]');
const input = need<HTMLInputElement>('#search-q');
const select = need<HTMLSelectElement>('#search-in');
const status = need<HTMLElement>('[data-search-status]');
const list = need<HTMLOListElement>('[data-search-results]');
const emptyState = need<HTMLElement>('[data-search-empty]');
const noneState = need<HTMLElement>('[data-search-none]');
const noneText = need<HTMLElement>('[data-search-none-text]');
const noneFilter = need<HTMLElement>('[data-search-none-filter]');
const errorState = need<HTMLElement>('[data-search-error]');
const moreButton = need<HTMLButtonElement>('[data-search-more]');
const base = form.dataset.base ?? '/';

let data: SearchIndex | null = null;
let engine: MiniSearch<SearchDoc> | null = null;
let icons = new Set<string>();
let current: { doc: SearchDoc; terms: string[] }[] = [];
let shown = 0;

/**
 * Appends text to an element, wrapping case-insensitive occurrences of the
 * matched terms in <mark>. Builds DOM nodes directly, so no HTML is injected.
 * @param parent Element to append to.
 * @param text Plain text to render.
 * @param terms Terms to highlight.
 */
function appendHighlighted(parent: HTMLElement, text: string, terms: string[]): void {
  const usable = terms.filter((term) => term.length > 1).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (usable.length === 0) {
    parent.append(text);
    return;
  }
  const pattern = new RegExp(`(${usable.join('|')})`, 'gi');
  for (const [index, part] of text.split(pattern).entries()) {
    if (index % 2 === 1) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      parent.append(mark);
    } else if (part) {
      parent.append(part);
    }
  }
}

/**
 * Shortens an outbound URL to its host for display.
 * @param url Absolute URL.
 * @returns Host without "www.".
 */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Builds the list item for one search result: name linking to the original
 * resource, description, and the category path linking to the entry's place
 * in the catalog.
 * @param doc Entry to render.
 * @param terms Matched terms to highlight.
 * @returns The list item element.
 */
function renderResult(doc: SearchDoc, terms: string[]): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'entry';

  // Site icon, or a letter tile when no icon was downloaded for this host.
  const hostName = host(doc.u);
  if (icons.has(hostName)) {
    const icon = document.createElement('img');
    icon.className = 'favicon';
    icon.src = `${base}favicons/${hostName}.png`;
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    icon.loading = 'lazy';
    item.append(icon);
  } else {
    const letter = document.createElement('span');
    letter.className = 'favicon favicon-letter';
    letter.setAttribute('aria-hidden', 'true');
    letter.textContent = (hostName[0] ?? '?').toUpperCase();
    item.append(letter);
  }

  const head = document.createElement('div');
  head.className = 'entry-head';
  const name = document.createElement('a');
  name.className = 'entry-name';
  name.href = doc.u;
  name.rel = 'external noopener';
  appendHighlighted(name, doc.n, terms);
  const hostLabel = document.createElement('span');
  hostLabel.className = 'entry-host';
  hostLabel.textContent = hostName;
  head.append(name, hostLabel);

  const description = document.createElement('p');
  description.className = 'entry-desc';
  appendHighlighted(description, doc.d, terms);

  const meta = document.createElement('p');
  meta.className = 'entry-meta result-path';
  const pathLink = document.createElement('a');
  pathLink.href = `${base}${doc.c}/#${doc.a}`;
  pathLink.textContent = (data?.categories[doc.c] ?? [doc.c]).join(' › ');
  meta.append('In ', pathLink);

  item.append(head, description, meta);
  return item;
}

/**
 * Shows exactly one of the empty / no-results / error panels (or none).
 * @param which Panel to show, or null to hide them all.
 */
function showState(which: 'empty' | 'none' | 'error' | null): void {
  emptyState.hidden = which !== 'empty';
  noneState.hidden = which !== 'none';
  errorState.hidden = which !== 'error';
}

/** Renders the next page of the current results and updates the "Show more" button. */
function renderMore(): void {
  const next = current.slice(shown, shown + PAGE_SIZE);
  list.append(...next.map((result) => renderResult(result.doc, result.terms)));
  shown += next.length;
  moreButton.hidden = shown >= current.length;
}

/**
 * Tests whether an entry belongs to the selected category filter. Selecting a
 * section also matches everything in its subsections.
 * @param doc Entry to test.
 * @param filter Category key, or "" for all categories.
 * @returns True when the entry should be included.
 */
function inCategory(doc: SearchDoc, filter: string): boolean {
  return filter === '' || doc.c === filter || doc.c.startsWith(`${filter}/`);
}

/** Runs the current query and filter, then renders results and status. */
function run(): void {
  if (!data || !engine) return;
  const query = input.value.trim();
  const filter = select.value;

  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  if (filter) url.searchParams.set('in', filter);
  else url.searchParams.delete('in');
  window.history.replaceState(null, '', url);

  list.replaceChildren();
  shown = 0;
  moreButton.hidden = true;
  const categoryName = filter ? (data.categories[filter] ?? [filter]).join(' › ') : '';

  if (!query && !filter) {
    current = [];
    showState('empty');
    status.textContent = `${data.docs.length} resources ready to search.`;
    return;
  }

  if (!query) {
    // A category with no query lists that category in README order.
    current = data.docs.filter((doc) => inCategory(doc, filter)).map((doc) => ({ doc, terms: [] }));
  } else {
    current = engine
      .search(query, { filter: (result) => inCategory(result as unknown as SearchDoc, filter) })
      .map((result) => ({ doc: data!.docs[result.id as number], terms: result.terms }));
  }

  if (current.length === 0) {
    showState('none');
    noneText.textContent = filter
      ? `Nothing in ${categoryName} matches “${query}”.`
      : `Nothing in the collection matches “${query}”.`;
    noneFilter.hidden = !filter;
    status.textContent = 'No results.';
    return;
  }

  showState(null);
  const count = `${current.length} ${current.length === 1 ? 'result' : 'results'}`;
  status.textContent = query
    ? `${count} for “${query}”${filter ? ` in ${categoryName}` : ''}.`
    : `${count} in ${categoryName}.`;
  renderMore();
}

/** Downloads and indexes the search data, then runs the query from the URL. */
async function load(): Promise<void> {
  showState(null);
  status.textContent = 'Loading the search index…';
  try {
    const response = await fetch(form.dataset.indexUrl ?? 'search-index.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = (await response.json()) as SearchIndex;
    icons = new Set(data.icons);
    engine = new MiniSearch<SearchDoc>({
      idField: 'i',
      fields: ['n', 'd', 'x'],
      storeFields: ['c'],
      searchOptions: {
        boost: { n: 3, x: 1.5 },
        prefix: true,
        fuzzy: (term) => (term.length > 4 ? 0.2 : false),
        combineWith: 'AND',
      },
    });
    engine.addAll(data.docs);
  } catch (error) {
    console.warn('Search index failed to load:', error);
    showState('error');
    status.textContent = 'Search is unavailable.';
    return;
  }
  const params = new URLSearchParams(window.location.search);
  input.value = params.get('q') ?? '';
  const requested = params.get('in') ?? '';
  select.value = requested in data.categories ? requested : '';
  run();
}

let debounce: number | undefined;
input.addEventListener('input', () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(run, 120);
});
select.addEventListener('change', run);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  window.clearTimeout(debounce);
  run();
});
moreButton.addEventListener('click', () => {
  const firstNew = shown;
  renderMore();
  // Move focus to the first newly added result so keyboard users continue from there.
  list.children[firstNew]?.querySelector('a')?.focus();
});
need<HTMLButtonElement>('[data-search-clear-filter]').addEventListener('click', () => {
  select.value = '';
  run();
  input.focus();
});
need<HTMLButtonElement>('[data-search-retry]').addEventListener('click', () => void load());

void load();

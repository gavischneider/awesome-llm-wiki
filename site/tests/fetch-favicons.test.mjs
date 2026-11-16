/**
 * Tests for the site-icon downloader (scripts/fetch-favicons.mjs).
 *
 * They run against a throwaway local HTTP server standing in for the icon
 * service, so no internet access is needed and no real site is contacted.
 *
 * How to run (from site/): `npm test`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fetchMissingIcons, hostsFromReadme, iconCandidates, iconHost } from '../scripts/fetch-favicons.mjs';

/**
 * Starts a fake icon service: a 64px PNG for hosts starting with "good",
 * an HTML page for "html.example" and 404 for anything else.
 * @returns {Promise<{ source: string, requests: string[], close: () => void }>}
 */
async function startIconServer() {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#8878ff' } }).png().toBuffer();
  /** @type {string[]} */
  const requests = [];
  const server = createServer((request, response) => {
    const host = new URL(request.url ?? '/', 'http://localhost').searchParams.get('host') ?? '';
    requests.push(host);
    if (host.startsWith('good')) {
      response.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    } else if (host === 'html.example') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>not an icon</p>');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { source: `http://127.0.0.1:${address.port}/?host={host}`, requests, close: () => server.close() };
}

// Covers host extraction. Exists because the host is used as a file name and must
// match what the pages look up. Expected: "www." removed, lower case, null for bad input.
test('iconHost normalises hosts and rejects unusable URLs', () => {
  assert.equal(iconHost('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(iconHost('https://gist.github.com/a/b'), 'gist.github.com');
  assert.equal(iconHost('not a url'), null);
});

// Covers host collection from the README. Expected: one host per distinct site, so
// entries on the same site (e.g. all YouTube videos) share a single icon.
test('hostsFromReadme returns each host once', () => {
  const markdown = [
    '# T',
    '',
    '> Tag.',
    '',
    '## Contents',
    '',
    '- [A](#a)',
    '',
    '## A',
    '',
    '- [One](https://www.youtube.com/watch?v=1) - First.',
    '- [Two](https://youtube.com/watch?v=2) - Second.',
    '- [Three](https://github.com/x/y) ([Docs](https://docs.example.com)) - Third.',
  ].join('\n');
  assert.deepEqual(hostsFromReadme(markdown), ['youtube.com', 'github.com']);
});

// Covers the download path end to end. Exists because a failed or bogus response
// must never break the build or save a corrupt file. Expected: good hosts saved as
// 32px PNGs, a 404 and a non-image response reported as failures, nothing else written.
test('saves valid icons as 32px PNGs and reports failures without throwing', async () => {
  const server = await startIconServer();
  const directory = await mkdtemp(join(tmpdir(), 'favicons-'));
  try {
    const result = await fetchMissingIcons({
      hosts: ['good.example', 'missing.example', 'html.example'],
      directory,
      source: server.source,
    });
    assert.deepEqual(result.saved, ['good.example']);
    assert.deepEqual(result.failed.map((failure) => failure.host).sort(), ['html.example', 'missing.example']);
    assert.deepEqual(await readdir(directory), ['good.example.png']);
    const meta = await sharp(await readFile(join(directory, 'good.example.png'))).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 32, 32]);
  } finally {
    server.close();
  }
});

// Covers caching. Expected: hosts that already have an icon are not requested again
// unless refresh is set.
test('skips hosts that already have an icon unless refreshing', async () => {
  const server = await startIconServer();
  const directory = await mkdtemp(join(tmpdir(), 'favicons-'));
  try {
    await writeFile(join(directory, 'good.example.png'), 'existing');
    const first = await fetchMissingIcons({ hosts: ['good.example', 'good2.example'], directory, source: server.source });
    assert.deepEqual(first.skipped, ['good.example']);
    assert.deepEqual(server.requests, ['good2.example']);
    const second = await fetchMissingIcons({ hosts: ['good.example'], directory, source: server.source, refresh: true });
    assert.deepEqual(second.saved, ['good.example']);
  } finally {
    server.close();
  }
});

// Covers the parent-domain fallback. Exists because personal subdomains on
// platforms like Substack or Medium often have no icon of their own. Expected: a
// subdomain with no icon gets its parent's icon, saved under the subdomain's name;
// a two-label host is never shortened.
test('falls back to the parent domain icon for subdomains', async () => {
  assert.deepEqual(iconCandidates('someone.good.example'), ['someone.good.example', 'good.example']);
  assert.deepEqual(iconCandidates('example.com'), ['example.com']);
  const server = await startIconServer();
  const directory = await mkdtemp(join(tmpdir(), 'favicons-'));
  try {
    const result = await fetchMissingIcons({
      hosts: ['someone.good.example', 'someone.missing.example'],
      directory,
      source: server.source,
    });
    assert.deepEqual(result.saved, ['someone.good.example']);
    assert.deepEqual(result.failed.map((failure) => failure.host), ['someone.missing.example']);
    assert.deepEqual(await readdir(directory), ['someone.good.example.png']);
  } finally {
    server.close();
  }
});

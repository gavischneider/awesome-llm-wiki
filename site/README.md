# Awesome LLM Wiki website

The public website for [Awesome LLM Wiki](https://github.com/gavischneider/awesome-llm-wiki), generated from the
repository's `README.md`.

Live site: <https://gavischneider.github.io/awesome-llm-wiki/>

## How content gets here

`../README.md` is the only source of content. Nothing in this folder holds a copy of the list.

1. At build time `src/lib/readme-parser.mjs` parses the README into sections, subsections and entries.
2. Astro renders one page per section and subsection, plus the home, search, contribute and 404 pages.
3. `search-index.json` is generated from the same parsed data for the search page.
4. The Contribute page is rendered from `../CONTRIBUTING.md`.

To change what the site shows, edit the README. A new `##` section or `###` subsection appears on the site
automatically once it is also listed under the README's `## Contents`.

### What the parser accepts

- `## Section` and `### Subsection` headings, each listed in `## Contents` in the same order and nesting.
- One optional italic description line directly under a heading.
- Entries as `- [Name](URL) - Description.` Between the name and the ` - ` separator, parenthesised companion
  links such as `([GitHub](URL))` and parenthesised notes such as `(Author Name)` are allowed.
- Descriptions may contain inline code, emphasis and links, and may wrap over several lines.
- `## Contents` and `## Contributing` are recognised as non-catalog headings.

Anything else (nested lists, tables, code blocks, raw HTML, `####` headings, an entry without a separator, an
empty section, a Contents list that does not match the headings) stops the build with a message naming the
README line. Entries are never skipped silently. To support a new kind of structure, extend the parser and add a
test for it.

## Commands

Run these from the `site/` directory. Node.js 22.12 or newer is required.

| Command             | What it does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `npm install`       | Installs dependencies (first-time setup).                                            |
| `npm run dev`       | Starts a local dev server at `http://localhost:4321/awesome-llm-wiki/` with reload.  |
| `npm run validate`  | Parses `../README.md` and reports structural problems with line numbers.             |
| `npm run favicons`  | Downloads a site icon for each linked website into `public/favicons/` (needs internet). |
| `npm run check`     | Type-checks Astro, TypeScript and JSDoc-typed JavaScript.                            |
| `npm run lint`      | Runs ESLint.                                                                         |
| `npm test`          | Runs parser unit tests and tests against the real README.                            |
| `npm run build`     | Builds the production site into `dist/`.                                             |
| `npm run test:dist` | Checks the built site against the README (run after `npm run build`).                |
| `npm run preview`   | Serves the built `dist/` locally.                                                    |
| `npm run verify`    | Runs validate, check, lint, test, build and test:dist in order.                      |

The repository's own `npm test` (awesome-lint on the README) is separate and unchanged; run it from the
repository root.

## Deployment

`.github/workflows/site.yml` builds and deploys the site to GitHub Pages.

- A push to `main` that changes `README.md`, `CONTRIBUTING.md`, `site/` or the workflow runs every check above
  and then deploys. Pushes that touch nothing else do not trigger a build.
- A pull request touching those files runs the same checks without deploying, so a README change the site
  cannot render is caught before merge.
- The workflow can be run by hand from the repository's Actions tab.
- A failed run shows a red mark on the commit and pull request, and GitHub emails the person who pushed. The
  previous deployment stays live until a later run succeeds.

One-time setup by the repository owner: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
No secrets or tokens are needed.

GitHub Pages serves assets over its CDN with its own cache headers. Files under `_astro/` have content hashes
in their names, so they can be cached indefinitely and never go stale.

## Using a custom domain later

1. In the repository, open **Settings → Pages → Custom domain**, enter the domain and follow GitHub's DNS
   instructions (a `CNAME` record for a subdomain, or `A`/`AAAA` records for an apex domain). Enable
   **Enforce HTTPS** once the certificate is issued.
2. In `.github/workflows/site.yml`, add these to the `Build` step so links, canonical URLs and the sitemap use
   the new address:

   ```yaml
   env:
     SITE_URL: https://your-domain.example
     BASE_PATH: /
   ```

Without those variables the site builds for `https://gavischneider.github.io/awesome-llm-wiki/` (the defaults in
`astro.config.mjs`). The output is plain static files, so it can also be hosted on any other static host by
running `npm run build` and publishing `dist/`.

## Layout

```text
site/
  astro.config.mjs        Site URL, base path, sitemap
  scripts/                validate-readme.mjs, fetch-favicons.mjs
  src/
    assets/brand/         Brand artwork: vector brain mark, app icons, cover images
    components/           SidebarNav, EntryList, Pager, BrainMark
    layouts/Base.astro    Head metadata, header, footer
    lib/                  readme-parser.mjs, catalog.ts, favicons.ts, site.ts
    pages/                Home, section and subsection pages, search, contribute, 404,
                          search-index.json, icons, social image, robots.txt, manifest
    scripts/search.ts     Client-side search
    styles/global.css     Design tokens and all styles
  tests/                  Parser, README integration and build-output tests
```

Favicons, app icons and the social preview image are generated during the build from `logo-square.png` and
`cover.png` in `src/assets/brand/`. That folder is the home of the brand artwork:

| File | Use |
| --- | --- |
| `brain-mark.svg`, `brain-mark-dark.svg` | The mark on a transparent background, for light and dark grounds |
| `logo-square.png` | Square icon on lavender; source of the site's favicon and header logo |
| `app-icon-default`, `-dark`, `-tinted` | 1024 px iOS app icon variants (SVG and PNG) |
| `avatar-circle-safe.png` | Square icon with extra margin, for circular avatars |
| `cover.png` | 1920 x 1080 cover with the name; shown at the top of the repository README |
| `social-preview-1280x640.png` | Cover sized for GitHub's social preview setting |

The home page draws the mark inline from `src/components/BrainMark.astro`, so its colours follow the theme. The site has no analytics, ads, cookies or third-party requests; fonts are bundled with the site.

## Site icons

Each entry shows the favicon of the website it links to, so all YouTube entries share the YouTube icon, all
GitHub entries the GitHub icon, and so on.

- `npm run favicons` downloads one 32px PNG per linked host into `public/favicons/` (not committed). It asks
  Google's favicon service by default; pass `-- --source "https://…{host}…"` to use another, and `-- --refresh`
  to re-download everything. A subdomain with no icon of its own (for example a personal Substack) uses its
  parent domain's icon.
- Icons are fetched at build time and served from this site, so a visitor's browser never contacts a
  third-party icon service.
- The deploy workflow runs the download before every build. If an icon cannot be fetched, or the step fails
  entirely, the build continues and those entries show a tile with the site's first letter.
- Locally, run `npm run favicons` once before `npm run dev` or `npm run build` to see real icons.

## Colours and themes

All colours are semantic tokens at the top of `src/styles/global.css`, in a light and a dark set built from the
artwork's lavender. The site follows the operating system theme; the header toggle lets a visitor override it,
and the choice is remembered in the browser's local storage (nothing is sent anywhere).

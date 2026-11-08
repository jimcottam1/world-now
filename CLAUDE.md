# World Now: notes for agents

A static site, the world-wide sister of Ireland Now (`../ireland-now`): GitHub Actions runs `scripts/build.js` every hour, which fetches each data layer into `site/data/*.json` and deploys `site/` to GitHub Pages. There is no server. See README.md for every source.

## Commands
- `npm test`: runs `test/*.test.js` (Node's built-in runner, no network). Must pass before any commit.
- `npm run build`: fetches every live source into `site/` (needs network; webcams need `WINDY_API_KEY`, so they fall back to their last good copy locally without it).
- `npx serve site`: preview at http://localhost:3000. After changing only `public/`, copy `public/app.js` and `public/styles.css` into `site/` instead of rebuilding.
- `npm run countries`: regenerate `public/data/countries.geojson` from Natural Earth (rarely).

## How we work
- **Test first.** A new layer or a changed parser needs a test in `test/` with a saved sample response in `test/fixtures/`. Use `mockHttp` and `loadLayer` from `test/helpers.js`. Tests must not depend on today's date.
- **Check a test catches the bug.** After writing one, break the code on purpose and confirm the test fails, then put the code back.
- **Never push, deploy or create GitHub issues without asking the owner.** Pushing to `main` deploys the live site.
- **Look at the real page.** For anything visible, check it in a browser at desktop width and at phone width (390 px). Check the browser console for errors.
- Ask the owner before adding a user-visible feature or a new data source; suggest a recommended option.

## Data rules
- **Only public, permitted sources.** Check `robots.txt` and the source's terms first. Never use a private API key taken from another site's page, never get around CAPTCHAs or bot checks, and never scrape a site whose `robots.txt` disallows it. GDACS, for example, only allows visits 04:00–06:45 UTC, one page a minute.
- **Mind free-tier limits.** Open-Meteo allows 10,000 calls a day and counts each place in a request as a call: weather (~240 places hourly) plus air quality (every 3 hours) uses about 7,700. Don't add hourly Open-Meteo layers without cutting something.
- **Every figure shows its age at the source**, not when we fetched it, with an orange ⚠ when it's older than the source's usual update cycle.
- **A failed source keeps its last good copy.** A layer should throw on anything it doesn't recognise rather than publish empty or wrong data.
- Credit every source in its `SOURCE` object (name, URL, licence); the footer lists them automatically.
- No secrets in the page or the repo; keys are GitHub repository secrets.
- **Borders:** Natural Earth's de facto boundaries; the footer says they don't imply a view on disputed territory. Don't hand-edit borders or names.

## Code layout
- `scripts/layers/<name>.js`: one per source, exporting `fetch<Name>()` that returns `{ updatedAt, source, sourceTime, ... }`. Register it in `scripts/build.js` with its cache age in hours.
- `scripts/lib/`: `http` (polite fetch with retries), `geo` (country lookups: `countryAt`, `byIso2`, `COUNTRIES`), `currencies` (which countries use each ECB currency), `state` (cache between runs), `redact` (keeps keys out of errors).
- Country ids are ISO 3166 alpha-3 codes where there is one (Natural Earth's own code otherwise, e.g. `KOS`); `wb` is the World Bank code; `lat`/`lon` is the capital, else the biggest town, else the middle.
- `public/app.js`: the whole front end. `public/styles.css`: copied from Ireland Now, light and dark themes.

## Writing
Plain British/Irish English, short sentences, no jargon on the page. Words users will read need the owner's agreement. Times show in the reader's own time zone unless marked local.

# DCR Employee Portal 2

A static website for the crew and the office, over the **DCR Desktop 2 database** (Supabase).
It keeps the old portal's look and habits; the data, the sign-in and every rule live in the
database (row level security, triggers, functions). The website holds only the project URL, the
publishable key and, later, the VAPID public key. No secret is ever stored here.

Published at `https://portal.dcrframing.com` by GitHub Pages (`.github/workflows/pages.yml`
publishes `site/` only, after the tests pass). The design documents stay on the office PC: `docs/`
is ignored by git and never pushed, because this repository is public.

## Layout

```
site/                       published as is
  index.html                sign-in ("keep me signed in", ?next=, inactive accounts)
  change-password.html      where a temporary password goes first
  dashboard.html            home: search and the cards this role may open
  settings.html             name, phone, colour, theme, password, sign out
  board.html, project.html, search.html, logs.html, capture.html, report-journal.html
  css/styles.css            the old portal's styles plus the Portal 2 accent
  js/config.js              DCR2_CONFIG (public values only) + the theme before first paint
  js/sb.js                  the one supabase-js client, its sign-in storage, me(), signIn/signOut
  js/common2.js             window.DCR2: dialogs, toasts, dates (America/Los_Angeles), money and
                            the amount mask, error sentences, requireAuth, the top bar, autosave
  js/live.js                Realtime: watch(table, filter, cb), presence(view, opts), onPresence
  js/money-mask.js          maskAmounts / fmtMoney, ported from Desktop 2 (shared test vectors)
  js/upload-queue2.js       IndexedDB custody + resumable uploads to Storage + the files row
  js/install.js, js/push2.js, sw.js, manifest.json, icons/
  js/shell/*.js             the scripts of the four pages above
  js/repo/*.js              data modules (the only code that talks to the database)
  js/map/*.js               Desktop 2 rows <-> the shapes the old pages use (pure)
  js/pages/*.js             the project pages' screens
tests/                      node --test (pure modules, the demo engine, the site guard)
tools/devserve.mjs          the local demo server (development only)
tools/fake/                 the demo database (development only, never published)
tools/check-pages.mjs       a headless look at the demo site (sign-in rules, service worker, queue)
tools/e2e-demo.mjs          the end-to-end walk of every P1 flow in the demo, with screenshots
tools/schema-check.mjs      Portal 2's own modules against the REAL database rules (PGlite)
tools/pglite-rest.mjs       the supabase-js subset answered by PGlite as the Data API would
tools/cdp.mjs               the small Chrome DevTools driver the two browser tools share
```

## Run it locally with made-up data

```
node tools/devserve.mjs          # http://127.0.0.1:8792/
```

The dev server serves `site/` and swaps the supabase-js library for an in-browser imitation of the
database with about 300 made-up projects (`tools/fake`). Nothing is sent to Supabase, and the
address search of Site Photos is answered from made-up towns (nothing goes to OpenStreetMap either).
Sign in with any demo account from the orange **DEMO** button (any password except `wrong`):
`admin@`, `manager@` (no prices: the owner's Q1), `manager2@` (prices switched on), `accountant@`,
`lead@`, `field@`, `viewer@`, `agents@` (refused), `inactive@` (refused), `newhire@` (temporary
password), all `@demo.test`. The same button turns the connection off, shows two colleagues online,
lets "someone else" edit the open project, and resets the demo data. Two tabs signed in without
"keep me signed in" are two people over the same demo data (they see each other's changes and
presence). The published site has no switch for any of this: the imitation exists only in pages
served by `tools/devserve.mjs`, which binds to 127.0.0.1.

In Claude Code the same server is the `portal2-demo` entry of `.claude/launch.json`.

## Tests

```
node --test                                        # pure modules, the demo engine, the site guard
node tools/check-pages.mjs --out <folder>          # headless Chrome/Edge: sign-in rules, service worker, queue
node tools/e2e-demo.mjs --out <folder>             # every P1 flow as every role + screenshots (final_*.png)
PGLITE_DIR=<folder> node tools/schema-check.mjs    # Portal 2's queries against Desktop 2's migrations
```

- `tools/check-pages.mjs` and `tools/e2e-demo.mjs` start the demo server on a free port and run a
  local Chrome or Edge headless with a throw-away profile. They collect every security-policy
  violation and console error on every page. They never talk to Supabase.
- `tools/e2e-demo.mjs` signs in as admin, manager, manager with prices, accountant, lead, field and
  viewer and checks what each may see and change, a Board drag (status + one log line), Overview
  autosave and "changed by someone else", Log and Journal entries, a journal photo with its caption,
  Site Photos with a GPS fix (nearest project, the pin, three photos at once, offline then online),
  Search, Log History, the journal report, the offline overlay, the install prompt and presence.
  It saves light and dark screenshots at 390 px and desktop width.
- `tools/schema-check.mjs` loads every migration of DCR Desktop 2 (`DCR_DESKTOP2_DIR`, default
  `../DCR Desktop 2`) into PGlite (`PGLITE_DIR`: a folder whose `node_modules` has
  `@electric-sql/pglite`) and runs Portal 2's own `sb.js`, `repo/*.js`, upload queue and `live.js`
  over `tools/pglite-rest.mjs`, as made-up people of every role (and the agents account, an
  inactive one, a temporary password). Every table, column, embed, RPC parameter name, trigger and
  policy is the database's own; the expected rows and refusals are asserted per role.

The money mask, the file-name rules and the project-location rules are checked against vectors
taken from DCR Desktop 2 (`tests/vectors/`). `tests/core-site-guard.test.mjs` checks every page for
the security policy meta tag, no inline script or handler, pinned library versions, no regular
expression look-behind (older iPhones), Portal 2's own browser names and no trace of the demo mode.

## Rules for every page

- The `Content-Security-Policy` meta tag of `index.html`, word for word, first in `<head>` after
  the charset. No inline `<script>` and no `on…=` attribute: scripts are files, handlers are
  `addEventListener`. Inline `style` is allowed. `script-src` names the one library file
  (`…/@supabase/supabase-js@2.117.2/dist/umd/supabase.js`), never the whole of jsDelivr (which serves
  anyone's npm or GitHub code); a page that needs another library (Leaflet 1.9.4 later) adds its exact
  file there. `worker-src` has no CDN.
- `<script src="js/config.js">`, then the pinned supabase-js
  (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js`, `defer`),
  then the page's `<script type="module">`. Every CDN script names an exact version.
- Browser-side names are Portal 2's own: session `dcr2-auth`, cache `dcr-portal2-v1`, IndexedDB
  `dcr2Uploads`, drafts `dcr2JrnDraft:<profile>:<project>`, theme `dcr2_theme`, city cache
  `dcr2CityGeo`, Site Photos' last job list `dcr2CaptureJobs:<profile>`, locks
  `dcr-portal2-single-instance`, `dcr2-upload-queue` and `dcr2-journal-drafts`. Never the old portal's
  names.
- The sign-in form ships inert (a disabled fieldset, `method="post"`, no `name` attributes) and only
  its script enables it: a press before the script has loaded sends nothing. The service worker keeps
  the site's files under their path only, never with a query string.
- The journal never loses what was typed: drafts stay on the device until the entry row exists (the
  home page, Site Photos and the project page create entries written with no signal, even after the
  app was killed), only the fields a person changed are sent, and someone else's change of the same
  entry is taken in ("Use mine" for a field both changed).
- Signing out ends this device's session only. Amounts in free text are masked on screen for
  people without the prices switch (display only).
- Test data is made up (`@demo.test`, `@example.com`, 555-01xx numbers, A267 as the sandbox).

## Publishing (go-live)

Portal 2 needs the database change M1 (`20261020000100_portal2_foundation`, in DCR Desktop 2), the
`admin-users` function with CORS and the temporary-password flag, and DCR Desktop 2 2.14.0 on every
office PC the same day. Every live step waits for the owner's OK.

**Owner, once (any time before the first publish)**

1. GitHub, account settings → Pages → Verified domains: add and verify `dcrframing.com` (a TXT
   record at the DNS provider). This stops anyone else's Pages site from claiming the address.
2. Repository `dcr-portal2` → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Same page → Custom domain: `portal.dcrframing.com` → Save.
4. DNS provider of `dcrframing.com`: a **CNAME** record `portal` → `barajas545.github.io`.
5. Supabase dashboard, Authentication → URL configuration: Site URL `https://portal.dcrframing.com`;
   Redirect URLs `https://portal.dcrframing.com/index.html` and
   `https://portal.dcrframing.com/change-password.html` (the same values are in DCR Desktop 2's
   `supabase/config.toml`). Authentication → Sign In / Providers: new sign-ups **off**, anonymous
   sign-ins **off**, password at least 10 characters with letters and digits.
6. Supabase dashboard, Realtime → Settings: "Allow public access" **off**.
7. Supabase dashboard, Storage → Settings: upload limit 500 MB (then the main session mirrors it in
   `supabase/config.toml`).

**Go-live day, in order**

1. Check that last night's backup exists (Supabase → Database → Backups).
2. Database change M1 (`npx supabase db push` from DCR Desktop 2), after the owner's OK.
3. `npx supabase functions deploy admin-users` (from DCR Desktop 2), after the owner's OK.
4. Install DCR Desktop 2 2.14.0 on every office PC.
5. **Gate — the managers who see prices today (Q1).** M1 changes nobody's switches, and every manager
   made before it got prices by default, so each of them would see the labor rate in Portal 2 from the
   first sign-in. List them (read-only, owner's OK for the linked query; DCR Desktop 2 `docs/DATABASE.md`
   §19): `select full_name, email from public.profiles where role = 'manager' and can_see_prices and active;`
   The owner answers **per name, in chat**: keep, or turn off (DCR Desktop 2 → Admin → Users → Edit →
   "Sees prices"). Step 6 waits for that answer.
6. Push this repository's `main` branch, after the owner's OK: the workflow runs the tests and
   publishes `site/`.
7. When GitHub shows the certificate is ready: Settings → Pages → tick **Enforce HTTPS**.
8. Try it on the sandbox project A267 only: sign in, Board, a photo from Site Photos, the journal,
   a second browser for "changed by someone else", Desktop 2 showing the photo under "Stored in DCR"
   and both apps in presence.
9. In DCR Desktop 2, Users: give each person who will use Portal 2 an account with a temporary
   password. Tell the crews the address and to add it to the Home Screen.

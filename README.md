# DCR Employee Portal 2

A static website for the crew and the office, over the **DCR Desktop 2 database** (Supabase).
It keeps the old portal's look and habits; the data, the sign-in and every rule live in the
database (row level security, triggers, functions). The website holds only the project URL, the
publishable key (phone reminders ask the push function for its public VAPID key). No secret is ever stored here.

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
  timesheet.html            Time Sheet, desk (the form + the two-week calendar; phones go to the phone page)
  timesheet-mobile.html     Time Sheet, phone (?date= from DCR Agents' reminders; the job's street per day)
  timesheet-batch.html      Batch Entry (one entry for many employees, a result per row)
  timesheet-manager.html    Team Sheets (the week grid, overtime / weekend marks, CSV, sign-off, live)
  report-timecard.html      the printable weekly Time Card
  admin.html                Employees & crews (admin, manager): employees, account links, each lead's crew
  my-tasks.html             My Tasks (P3: your open tasks, ?task= from a reminder, updates, Mark complete)
  tasks-map.html            Tasks on Map (P3: Leaflet 1.9.4, a pin per job, New task here, moving a pin)
  css/styles.css            the old portal's styles plus the Portal 2 accent
  css/tasks.css             the task pieces My Tasks, the map and the project's Tasks tab share
  agents-console.html       DCR Agents 2 (P6, admins): the old web console - its shell and eight tab modules - over
                            the console relay (rpc console_request / console_get / console_cancel, Realtime)
  my-assistant.html         My Assistant (P6: one's own DCR assistant - today, tomorrow, the week, the chat, to-dos)
  assistant-admin.html      Assistants (P6, admins: who has one, the office reading the chat, the office's items)
  pm.html                   the Progress Chart (P5a: the old pm.html on Desktop 2's data - the status-to-milestone
                            map, a lane per estimate item, quotes and change orders for everyone without amounts
                            (Q11), item flags set by estimate editors and leads, a quote's follow-up, the money
                            tiles and quote_commitments only with prices AND financials; no ?id=: the picker)
  report-pm.html            the printable project status report (the worksite copy for anyone without prices)
  js/pm-chart.js            the chart engine both share (derive / layout / svg; pure)
  project.html tabs Estimate, Takeoffs   (P5a, read only - Q12: edits stay in DCR Desktop 2) the estimates and change
                            orders in the office's order, crew lines, item flags; Labor / Material / Total and the
                            contract strip with prices only; the takeoffs by level, category and sub-category
  report-estimate.html      the printed estimate / several with a GRAND TOTAL / a change order with its contract
                            figures; the worksite copy (no amount at all) for anyone without prices
  report-takeoff.html       the Material List (everyone; typed amounts masked) / the Material Quote with tax (prices)
  css/estimates.css         the Estimate and Takeoffs tabs
  css/agents-console.css, css/console-print.css   the old console's styles, unchanged
  accounting.html           The Books (P5b, the financials switch): the old accountant's desk on Desktop 2's data -
                            the picture or the tiles, what needs doing, bills to pay (the check desk: payee, memo,
                            the amount capped at the approved amount still owed, the documents), pay by bank
                            transfer or card (the same panel: ACH / wire or card, the confirmation, no check number,
                            nobody to tell), payees to tell (payment_told), ready to enter in QuickBooks (a CSV built in the browser with the formula
                            guard, a BOM and CRLF - Q13: a MANUAL hand-off; mark_bills_entered with refused[] shown),
                            money in (the invoices' own marker), not ready and on whom, already entered (Undo)
  bill.html                 one bill, its paperwork and the decision (P5b): approve_bill with a REQUIRED pay method
                            (by check, in cash, either, by bank transfer - ACH or wire - or by card) (an admin, or a manager with the approve switch - an accountant never sees a working
                            approve button), set_bill_pay_method; the home page's approvals card links here (approvers)
  submit.html               the PUBLIC subcontractor form (P5c; BLUEPRINT 2.2.7: the only page nobody signs in to; no top
                            bar, no app, not indexed; phone first): invoice or change order, a job found by number, name,
                            street or town (open jobs only, five public fields), the details, the paperwork (one signed
                            upload into the private inbox subform-inbox - 25 MB, a photo, scan or PDF; "attached" copies it
                            under f/ - financials), a drawn signature, the declaration, a honeypot; everything goes
                            through js/repo/subform.js to DCR Desktop 2's Edge Function "subform" with its OWN client that
                            keeps no session (never the staff sign-in); a reference to quote on the phone at the end
  submissions.html          the review queue (P5c; money editors: an admin, or a manager or accountant with financials):
                            waiting / accepted / rejected, the paperwork and the signature through short signed links,
                            accept_submission (an invoice -> a bill NOT approved, billed against a quote or not; a change
                            order -> the job's change order) and reject_submission with a note, the version shown ("already
                            done" when somebody was faster); ?ref= from the office's e-mail; what became of each waiting
                            submission's e-mail (sub_submission_notices: "Nobody was e-mailed about this: ..." as the old
                            page said); an accepted invoice's bill as it is now; the home page's card with a badge
  leads.html                Sales Leads (P5c; admin, manager, accountant, view-only read - admin and manager write): the
                            category chips, open / converted / all, "contacted Nd ago" in company days, Contacted today,
                            Edit, Delete (versioned), Convert to project (rpc convert_lead: the project with the next
                            number and the lead linked in one step); a lead or field account is told it is the office's
  vehicles.html             the Vehicle Board (P5c; everyone reads, admin and manager write): oil changes due (by date
                            this month, or by miles), services due, registration / emissions / DOT due, every vehicle
                            (retired ones on request), the panel with open maintenance and history; schedule, complete
                            (rpc complete_vehicle_maintenance: today, the oil stamp, the mileage only forward), add and
                            edit a vehicle (never an insurance policy number - Q18); a service's material cost only with
                            the financials switch
  marketing.html            Marketing Tasks (P5c, Q17; the leads' readers and writers): Open / Completed / Not invoiced /
                            Not paid / All, grouped by project, Done / Invoiced / Paid marks (Done: the database stamps the
                            day); the price column, the totals and the price box only with the financials switch; a card
                            per task on a phone. In all three, words people typed that quote an amount read "(amount
                            hidden)" without the prices switch, and an edit form shows such a box masked and read only and
                            never sends it (js/map/masked-form.js; the project Overview's rule)
  css/lists.css             the three office lists' looks (the old pages' own blue, light and dark)
  estimates.html            Sales Estimates (P5c, Q10: the Sales estimates switch): the saved sales estimates and the
                            comps library (past projects with their photos); the trade cards (Deck; the others "coming
                            next", as in the old portal); benchmarks, ranges and past prices only with the prices switch
                            too; New / Add / Delete for a sales editor (an admin, or a manager with the switch)
  estimate-deck.html        the deck estimate wizard (P5c): project -> similar projects (scored comps) -> materials (the
                            product viewer) -> review (the estimator's rates) -> preliminary estimate (save, print);
                            photos with markup, CME drawings and voice notes with transcripts in sales-media; the money
                            only in sales_estimate_prices (never sent by someone without prices); read only for a reader
  materials-library.html    the Materials Library (P5c): division -> category -> sub-category, a product and its colors,
                            each with a picture gallery (the cover first); offered in the wizard (deck-materials.json is
                            only the fallback when the library is empty)
  cme.html, cme/            the Construction Modeling Engine (P5c), the old portal's drawing tool unchanged (cme/src) with
                            its two portal files rewritten (cme/boot.js: Portal 2's sign-in, the switch, no framing by
                            another site, a per-person per-estimate drawing library; cme/portal-bridge.js); opened over the
                            wizard by js/sales/cme-launcher.js, its PNG in sales-media, the drawing under the entry's "cme"
  js/sales/*.js             deck-engine.js (the wizard's arithmetic, pure), gallery.js (sales-media pictures, signed URLs),
                            photo-annotate.js (markup, the old editor), cme-launcher.js (the drawing overlay)
  js/console/*.js           the old console: shell.js (agents-console.js, its four network points through
                            bridge.js) and console-*.js (the eight tabs, byte for byte the old portal's);
                            bridge.js the module under them (supabase-js, Realtime); framed.js (no framing)
  js/config.js              DCR2_CONFIG (public values only) + the theme before first paint
  js/sb.js                  the one supabase-js client, its sign-in storage, me(), signIn/signOut
  js/common2.js             window.DCR2: dialogs, toasts, dates (America/Los_Angeles), money and
                            the amount mask, error sentences, requireAuth, the top bar, autosave
  js/live.js                Realtime: watch(table, filter, cb, opts), presence(view, opts), onPresence
                            (opts.lost: hear {type: "LOST"} when the channel goes, to pace one's own reads)
  js/money-mask.js          maskAmounts / fmtMoney, ported from Desktop 2 (shared test vectors)
  js/upload-queue2.js       IndexedDB custody + resumable uploads to Storage + the files row
  js/timesheet-pdf.js       the timesheet PDF in the DCR paper form (jsPDF 2.5.2 + AutoTable 3.8.4 from
                            jsDelivr, exact versions with integrity hashes; only the two Time Sheet pages
                            name them in their script-src)
  js/install.js, js/push2.js, sw.js, manifest.json, icons/
  js/shell/*.js             the scripts of the four pages above
  js/repo/*.js              data modules (the only code that talks to the database)
  js/map/*.js               Desktop 2 rows <-> the shapes the old pages use (pure)
  js/pages/*.js             the project pages' screens
tests/                      node --test (pure modules, the demo engine, the site guard)
tools/devserve.mjs          the local demo server (development only)
tools/fake/                 the demo database (development only, never published)
tools/check-pages.mjs       a headless look at the demo site (sign-in rules, service worker, queue)
tools/e2e-demo.mjs          the end-to-end walk of every P1 flow in the demo, with screenshots, then the P2 walk
tools/e2e-p2.mjs            the P2 timesheet pages (every role, phone and desk, light and dark); e2e-demo runs it
tools/e2e-p3.mjs            the P3 task pages (every role, phone and desk, light and dark); e2e-demo runs it
tools/e2e-p6.mjs            the P6 pages: the console, My Assistant, Assistants (every role, phone and desk, light
                            and dark); e2e-demo runs it
tools/e2e-p5a-est.mjs       the P5a Estimate and Takeoffs tabs and the printed estimate, change order, material list
                            and quote, and search for an item named with an amount (admin, managers with and without
                            prices, accountant, lead, field, view-only; phone and desk, light and dark, the print
                            preview; every amount the admin sees is looked for in the no-prices pages' HTML);
                            e2e-demo runs it (--p5est)
tools/e2e-p5a-pm.mjs        the P5a Progress Chart and its report (every role, phone and desk, light and dark);
                            e2e-demo runs it (--p5pm)
tools/e2e-p5b-books.mjs     the P5b books: The Books, the bill page, the approvals card (admin, a manager with approve,
                            a manager without, accountant, lead, field, view-only; phone and desk, light and dark;
                            acceptance checks 2, 3 and 5); e2e-demo runs it (--p5books); the demo approver is
                            approver@demo.test
tools/e2e-p5b-ledger.mjs    the P5b ledger: Expenses & receipts, the project's Expenses and Payments tabs, the printed
                            expense report (every role; phone and desk, light and dark); e2e-demo runs it (--p5ledger)
tools/e2e-p5c-sub.mjs       the P5c subcontractor form signed out on a phone (search, refusals, honeypot, the paperwork,
                            the reference) and its review for every role (accept, "already done", reject, the change
                            order; acceptance checks 4 and 5; phone and desk, light and dark); e2e-demo runs it (--p5sub)
tools/schema-check-p5c-sub.mjs  the same on the REAL rules: repo/subform.js through DCR Desktop 2's own subform handler
                            and SQL, repo/submissions.js as every role, on PGlite with every migration (schema-check runs it)
tools/e2e-p5c-sales.mjs     the P5c sales walk: who (the Sales estimates switch, the prices switch, a sales editor or a
                            reader), a deck estimate from scratch (a photo, its markup, a CME drawing saved and saved
                            again, the reference, the materials and the viewer, the rates, step 5 saved with its money
                            apart, print), a 409, the library (phone and desk, light and dark); e2e-demo runs it (--p5sales)
tools/schema-check-p5c-sales.mjs  the same module on the REAL rules (M5c): every column, who reads and writes, the prices
                            rows' versioned PATCH, the "cad" rule, sales-media's names and its one replace (schema-check)
tools/e2e-p5c-lists.mjs     the P5c office lists: Leads, the Vehicle Board, Marketing Tasks and the home page's cards for
                            every role (admin, manager, accountant, lead, field, view-only, the demo approver); a lead
                            added with HTML in its name, edited, contacted, converted and deleted; a service completed
                            as an oil change with its cost; a vehicle retired; a task done and priced; no cost or price
                            without financials; a manager without prices edits a task whose words quote an amount (masked,
                            read only, kept); phone and desk, light and dark (lists_*.png); e2e-demo runs it (--p5lists)
tools/schema-check-p5c-lists.mjs  the same on the REAL rules (M5c): repo/leads.js, repo/vehicles.js, repo/marketing.js as
                            every role on PGlite with every migration, convert_lead and complete_vehicle_maintenance as
                            Portal 2 calls them, P5 check 5, and the demo's columns against the real ones (schema-check)
tools/pglite-serve.mjs      PGLITE mode: the site with every page's supabase-js calls replayed on PGlite loaded with
                            every DCR Desktop 2 migration, as the signed-in person (tools/fake/pglite-client.js is
                            the page side); made-up people <role>@e2e.test, password pglite-<role>-2026
tools/e2e-p5b-pglite.mjs    every P5b page as every role on pglite-serve (the REAL database rules: acceptance checks 2,
                            3 and 5 through the pages, refusals by HTTP status); e2e-demo runs it when PGLITE_DIR is set
tools/e2e-p5c-pglite.mjs    every P5c page as every role (and signed out: submit.html) on pglite-serve in P5c mode
                            (tools/pglite-p5c.mjs: the demo's made-up lists and sales rows loaded into the REAL M5c
                            tables - drift stops it -, DCR Desktop 2's own subform function as the service role, the
                            signed upload): acceptance checks 4 and 5, accept -> a bill waiting for approval in The
                            Books, the notices for DCR Agents 2; e2e-demo runs it when PGLITE_DIR is set
tools/schema-check.mjs      Portal 2's own modules against the REAL database rules (PGlite); tools/schema-pm.mjs
                            is its Progress Chart part, tools/schema-check-p5a-est.mjs its estimates part and
                            tools/schema-p5a-sweep.mjs the P5 acceptance check 1 as a sweep of raw REST answers (every
                            price / money table, quotes, the print RPCs, search) per role, plus check 5 for M5a's log lines
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
password), all `@demo.test`. For the tasks the demo has two dozen made-up tasks over the sandbox and the
busy jobs: quiet ones ("needs an update"), a task due tomorrow morning, a Photo & Video Agent shoot with
its brief and shot list, a Recurring Tasks agent task ("Weekly on Mondays"), a task imported from the old
portal with its old notes and a texted reply filed for Jordan, an amount in a task's words (hidden without
the prices switch), tasks without a project and finished ones; on a task page the DEMO button also offers
"Someone else adds an update", "Someone else finishes a task" and "The office gives you a new task" (live
updates, the finished-elsewhere notice). The map's tiles are drawn in the page (nothing goes to
OpenStreetMap). For the timesheets the demo has eleven made-up employees (five linked to
those accounts; Riley Lead's crew of five; one who has left), four weeks of hours with overtime, a
Saturday, leave days, a day split across two jobs and one imported row whose job matched no project,
and last week's sign-offs (one gone stale because an hour changed after it). On a timesheet page the
DEMO button also offers "Someone else changes an hour this week" (live updates, stale sign-offs). The same button turns the connection off, shows two colleagues online,
lets "someone else" edit the open project, and resets the demo data. Two tabs signed in without
"keep me signed in" are two people over the same demo data (they see each other's changes and
presence). The published site has no switch for any of this: the imitation exists only in pages
served by `tools/devserve.mjs`, which binds to 127.0.0.1.

For phase 6 the demo has a made-up DCR server computer running DCR Agents 2 (`tools/fake/pc-demo.js`): it takes
each console request a moment after it is made and answers it with made-up agents, timesheets, tasks, photo
plans, assistants, training, activity, replies, people and settings (the real computer's allowlist of 122
methods; a change it asks about first, it asks about first), and it answers each chat message a few seconds
later (a reminder card for "remind me at 3 pm to ...", an e-mail draft card, never an amount). Jordan Field,
Riley Lead and Avery Admin have assistants (the office reads Jordan's and Avery's chats, not Riley's); the
managers have none ("ask the office"). On the console and assistant pages the DEMO button also offers "The DCR
server is off" (requests and chats wait) and "The office writes to you in the assistant chat".

In Claude Code the same server is the `portal2-demo` entry of `.claude/launch.json`.

## Tests

```
node --test                                        # pure modules, the demo engine, the site guard
node tools/check-pages.mjs --out <folder>          # headless Chrome/Edge: sign-in rules, service worker, queue
node tools/e2e-demo.mjs --out <folder>             # every P1 flow as every role + screenshots (final_*.png),
                                                   # then the P2 walk (--p2 checks | shots | none)
                                                   # and the P3 walk (--p3 checks | shots | none)
node tools/e2e-p2.mjs --out <folder>               # the P2 walk alone + screenshots (p2_*.png; --shots none)
node tools/e2e-p3.mjs --out <folder>               # the P3 walk alone + screenshots (p3_*.png; --shots none)
node tools/e2e-p6.mjs --out <folder>               # the P6 walk alone + screenshots (p6_*.png; --shots none)
node tools/e2e-p5a-pm.mjs --out <folder>           # the Progress Chart walk alone + screenshots (pm_*.png; --shots none)
node tools/e2e-p5a-est.mjs --out <folder>          # the estimates walk alone + screenshots (est_*.png; --shots none)
node tools/e2e-p5b-books.mjs --out <folder>       # the books walk alone + screenshots (books_*.png; --shots none)
node tools/e2e-p5b-ledger.mjs --out <folder>      # the ledger walk alone + screenshots (ledger_*.png; --shots none)
node tools/e2e-p5c-sales.mjs --out <folder>       # the sales walk alone + screenshots (sales_*.png; --shots none)
PGLITE_DIR=<folder> node tools/schema-check.mjs    # Portal 2's queries against Desktop 2's migrations
PGLITE_DIR=<folder> node tools/pglite-serve.mjs    # the site over PGlite with the real migrations (127.0.0.1:8793)
PGLITE_DIR=<folder> node tools/e2e-p5b-pglite.mjs --out <folder>   # the P5b pages on it + screenshots (p5b_final_*.png)
PGLITE_DIR=<folder> node tools/e2e-p5c-pglite.mjs --out <folder>   # the P5c pages on it + screenshots (p5c_final_*.png)
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
- `tools/e2e-p2.mjs` signs in as admin, manager, accountant, lead, field and viewer and checks the home
  cards and the top bar, every P2 page each may open (and the refusal of the others), a day and a
  vacation day from the phone (?date=, the schedule over the normal hours), Batch Entry for three of a
  crew, Team Sheets (the stale signature, a re-confirm, a change arriving while the confirm dialog is
  open -> 409 and nothing confirmed, live updates, Add / edit / delete, the CSV with its formula guard,
  read only for the accountant), the Time Card, Employees & crews (a new employee, a crew), Settings'
  employee section and the PDF (downloaded, `%PDF-`); and what the P2 review found: a change whose live
  event never arrived -> 409 (then, after the on-focus refresh, the signature carries what the screen
  shows), someone who has left (a printable Time Card, correctable entries; a link naming nobody in
  scope never shows one's own card), a lead without a crew (no Batch Entry), the desk Time Sheet's card
  buttons at tablet widths, the top bar on one row at 1366 / 1280 / 1100 / 900 px. It needs jsDelivr for
  jsPDF; nothing goes to Supabase. Screenshots: `p2_<page>_<role>_<light|dark>_<desktop|phone>.png`.
- `tools/e2e-p3.mjs` signs in as admin, manager, accountant, lead, field and viewer and checks the home
  cards (My Tasks with the badge the summary gives, Tasks on Map) and the top bar, My Tasks (the lists each
  role has; read only for a viewer; on a phone a task is the whole screen), the map (Leaflet, the pins,
  the person picker, a pin's sheet, New task here only for those who may create) and the project's Tasks
  tab; then, as field on the phone, the reminder link to a shoot (brief, shot list ticked on the phone), a
  quick phrase sent (via portal, the client key), no signal (the words and the key stay; the resend adds
  ONE note), Mark complete with a closing note, a task finished elsewhere while open (the words typed
  shown back), a note refused on a task finished with no live event ("already complete", the words shown
  back), a task handed away, a new task arriving live; as lead the crew's list, a new task for Jordan (one
  outbox row, the Access wording, the link, drained by the push function) and the project tab's tick,
  untick and a note; as manager the map's filters, New task here and a pin moved by hand (manual); Q3 in
  the pages (the project's Tasks tab shows a field person and a viewer only theirs and the ones they made);
  an amount in a task masked for a field person; the reminder link through the sign-in (signed out ->
  `index.html?next=` -> the task); Settings → Phone reminders on an Android phone (on, the test notice,
  the home switch, a lead's new task drained to the phone, off) and an iPhone in Safari ("Add to Home
  Screen first"). It needs jsDelivr for Leaflet; nothing goes to Supabase or OpenStreetMap. Screenshots:
  `p3_<page>_<role>_<light|dark>_<desktop|phone>.png`.
- `tools/schema-check.mjs` loads every migration of DCR Desktop 2 (`DCR_DESKTOP2_DIR`, default
  `../DCR Desktop 2`) into PGlite (`PGLITE_DIR`: a folder whose `node_modules` has
  `@electric-sql/pglite`) and runs Portal 2's own `sb.js`, `repo/*.js`, upload queue and `live.js`
  over `tools/pglite-rest.mjs`, as made-up people of every role (and the agents account, an
  inactive one, a temporary password). Every table, column, embed, RPC parameter name, trigger and
  policy is the database's own; the expected rows and refusals are asserted per role. With M3 it also
  checks the task pieces: who reads which task through REST (Q3), the lists and the summary, Q8's
  creation rules and the guards, the outbox notice, add_task_note (one note per key, "already complete"),
  complete_task (one transaction, PT409), the "no longer yours" tombstone, the live channels, the agents
  account, and that `map/tasks.js clockOf` answers DCR Desktop 2's shared clock cases
  (`tools/pglite_check/task_clock_cases.json`) exactly as `app.task_clock` does. Signed out (anon) every P3
  table answers nothing and every P3 RPC is refused; no answer a lead gets carries a priced task column.
  **Phone reminders end to end**: `push2.js` on a stand-in browser (real P-256 subscription keys) calls DCR
  Desktop 2's own push function (`supabase/functions/push/handler.ts` and `sql.ts`, its SQL run as the
  service role with no JWT, as `index.ts` does) over the same database, with a stand-in push service that
  decrypts what it receives and verifies the VAPID token (a key pair made in memory for the run): every
  role keeps its own subscription row and nobody, an admin included, reads or removes another's; the key
  for every active account, 403 for an inactive one, 401 signed out, 503 without keys; `send` only for an
  admin or the agents account; the test notice reaches the caller's own devices only; a lead's new task
  reaches the field person's phone as "New task" with `my-tasks.html?task=<id>`, once, and a dead device
  (410) is pruned; a shared phone moves to the person who turns reminders on there; five devices at most.
  With M4 (`20261023000100_agents_core`, DCR Agents 2's database surface) it also checks DCR Agents 2's line
  on an admin's home page: `repo/agents.js serverStatus()` (rpc `agents_server_status`, an admin's only:
  every other role, the agents account itself and anon get 42501) and `map/agents.js serverLine()` —
  "DCR Agents 2 PC - not seen yet" before any heartbeat, "last seen just now" after the agents account's
  `agents_heartbeat`, amber once it goes quiet — and that the agents account still reads no table.

- `tools/e2e-p6.mjs` signs in as admin, manager, accountant, lead, field and viewer and checks the home cards (My
  Assistant with the badge the database's counts give; DCR Agents 2 with the server's dot and Assistants for an
  admin only), the console (an admin's status bar and eleven tabs; "Only an Admin can manage DCR Agents 2." for
  anybody else, with nothing asked), My Assistant (on, or "ask the office") and Assistants (refused for anybody
  but an admin); then, as admin, every console tab drawn from the made-up DCR server through the relay (all the
  admin's own requests, answered, woken by Realtime) and Pause everything / Resume asked first; as field on the
  phone, the six panels, a question answered live with a reminder card, no signal (the words and their client id
  kept, the resend ONE message), the office's item only ticked, a to-do added / ticked / deleted, the briefing
  time and Spanish, a note kept, a note from the office arriving live ("1 new") and read; as admin on Assistants,
  a private chat ("does not read"), the office reads turned on, the office's to-do reaching the field person's
  open page live, the manager's assistant turned on while their page is open. Screenshots:
  `p6_<page>_<role>_<light|dark>_<desktop|phone>.png`.
- `tests/console/*.test.mjs` are the old portal's page tests of the console (the shell and every tab, with an
  `<img onerror>` in every string the server sends), pointed at the ported files; the shell's stand-in browser
  gives it a bridge over the old relay fake, so the request mechanics are tested unchanged.
- With M6 (`20261024000100_agents_phase6`), `tools/schema-check.mjs` runs `repo/console.js` and
  `repo/assistant.js` against the real migration: every name and parameter; an admin's request read back with
  console_get, another admin's id the same 404 as an unknown one, every other role refused; the lease holder
  takes and answers it; expired and lost worked out on read and stored by the purge; 20 open, 60 a minute (the
  wait), 20,000 characters; the agents account joins only `agents2-console` and `agents2-assistant`; My
  Assistant off until the office turns it on, the old GET (the agenda without amounts, unchanged at the same
  revision, the badge's counts) and every POST op as the page sends it; the office's list, the chat only while
  office reads is on and only from when it went on (the note that tells the person first), the office's items
  read-only for the person, every other role refused; the agents account reads no row of the chat (a question
  waiting is an id in `assistant_waiting`).

**P4 (DCR Agents 2 core).** Portal 2's only change is that admin line on the home page (`hmAgents`, drawn
by `shell/dashboard.js`; the demo database answers it from a made-up PC). Before M4 is pushed the RPC is
missing and the line simply stays hidden; nothing else on the page depends on it.

The money mask, the file-name rules and the project-location rules are checked against vectors
taken from DCR Desktop 2 (`tests/vectors/`). `tests/core-site-guard.test.mjs` checks every page for
the security policy meta tag, no inline script or handler, pinned library versions, no regular
expression look-behind (older iPhones), Portal 2's own browser names and no trace of the demo mode.

## Timesheets (P2) in short

- The pages read and write `timesheets` under the crew scope of migration M2 (`20261021000100_people_timesheets`):
  admin and manager everyone; the accountant reads everyone and writes only their own (Q7); a lead self
  and crew; field self; a view-only account reads its own and writes nothing. The pages only hide what
  the database would refuse (`pages/ts-shared.js context()`).
- People are `employees` rows (`rpc my_roster()` for the pickers: names, numbers and normal hours, never
  phone or address); a leave day is a `kind`, never a project; dates are calendar days and clock times
  plain times; weeks run Saturday to Friday in company time. Someone who has left (`active` off) is
  never offered for new hours, but stays on the Time Card ("(left)") and in the form of their own
  entries, for whoever has them in scope. One's own row is read with named columns (Settings): the
  employee notes are readable by the person and their lead in the database (M2), so the editor says so
  and Portal 2 never carries them to the crew's phones.
- Sign-off goes only through `timesheet_weeks`, `confirm_timesheet_week` and `unconfirm_timesheet_week`:
  a confirmation sends the fingerprint of the rows the screen shows (`map/timesheets.js
  weekFingerprint()`, the same formula as `app.timesheet_week_state`, checked by schema-check) — never
  the value `timesheet_weeks` handed back — so the database answers 409 whenever the screen is behind:
  a change while the dialog was open, or one whose live event never arrived. Rows and sign-offs are
  always read together (also the 90-second and on-focus refreshes).
- Batch Entry is for admin, manager and leads with a crew; a lead without a crew is pointed to the
  Time Sheet.
- Until the timesheet Saturday after DCR Agents 2 is live (BLUEPRINT 4.4) the pages are tried by the
  office and one lead on the live test project A000T2 (A267 is the demo's sandbox only); the history
  import waits for that evening.

## Tasks (P3) in short

- The pages read and write tasks under migration M3 (`20261022000100_tasks_push`) and the read rule of M1
  (Q3): the office and leads read every task; field and view-only people the ones given to them or made
  by them. A task is given to anyone by admin, manager and lead, by field and the accountant only to
  themselves or nobody (Q8); a view-only account creates and updates nothing. The pages only hide what the
  database would refuse (`map/tasks.js canCreate / canAssignAnyone / canWork`).
- **My Tasks** (`my-tasks.html`, the old page and its habits) reads `rpc my_tasks`: 'mine' for everyone,
  a lead's 'crew' (their crew's accounts through `crew_members` / `employees.profile_id`) and the
  office's 'everyone'; needs-an-update first, with the database's clock (`app.task_clock`: more than five
  Pacific days without a note; a shoot is never stale through its day). `?task=<id>` (the reminders' and
  the new-task notice's link) opens the task: a task finished since says so, one that is not the
  person's says "not on your list" (the same answer as one that does not exist).
- An update is `rpc add_task_note`: one line, at most 2,000 characters, written as a `task_notes` row
  (via `portal`). What is typed is a draft on this phone (`dcr2:taskDraft:<profile>:<task>`) until the
  database has it; each send carries a key kept with the draft, so the resend after a lost answer adds
  nothing twice. A note on a task finished meanwhile is refused ("already complete") and the words are
  shown back. Mark complete is `rpc complete_task`: the status and the closing note in one step.
- Live: tasks, notes and the "no longer yours" tombstone (`deletions.for_user`, M1) arrive through
  Realtime; a task finished or given away while open closes with a notice that shows what was typed.
- **Tasks on Map** (`tasks-map.html`): the old map's script moved into `js/pages/tasks-map.js`, its 36
  inline handlers (also the ones inside the popup HTML) are listeners, every word is escaped. Leaflet
  1.9.4 comes from jsDelivr with its integrity hashes (named in this page's `script-src` only); the pins
  are CSS (no picture from the CDN). One pin per project (`projects.lat` / `lng`); a project without a
  point is placed from its address (OpenStreetMap's search, one a second) and offered to
  `set_project_location` (geocode: it only fills an empty point). Moving a pin by hand is for managers
  and admins (`manual`).
- **The project's Tasks tab**: Pending / Completed / All, the tick (`complete_task`) and untick (a
  versioned PATCH), a row opens its updates and a box for one. The old tab's priced columns do not exist
  in this database.
- **The home page's badge**: `rpc my_tasks_summary` — one's own tasks needing an update in red, else
  one's own open tasks, else a lead's crew's (the office's everyone's) needing an update, dimmed.
- A new task given to someone else writes its notice into `notifications_outbox` (the tasks trigger, the
  Access wording, the `my-tasks.html?task=<id>` link); the page then asks the `push` function to send the
  waiting notices (`{op: 'drain'}`, fire-and-forget). The e-mail is DCR Agents 2's (P4), off until the
  owner turns `task_email_enabled` on.

## The DCR Agents 2 console and the assistants (P6) in short

- **The console** (`agents-console.html`, admins) is the old portal's web console: its shell and its eight tab
  modules (Dashboard, Agents, Timesheets and Tasks, Photo & Video, Assistants, Training, Activity / Replies /
  People, Settings) are the old files; the tab modules unchanged, the shell changed only at its four network
  points, which `js/console/bridge.js` answers from migration M6 in the old shapes: the status bar from rpc
  `agents_server_status` (ready, consoleOn), a request `console_request` -> `{id, at}`, reading it
  `console_get` (the old answer; expired and lost worked out by the database), cancelling `console_cancel`. The
  page listens on Realtime to the admin's own rows of `agents_console` (RLS lets nobody else's through), so an
  answer is read the moment it lands; the old poll stays as the fallback (every 5 s while the channel is joined,
  else 1 s then 2 s). Everything the DCR server does is checked again on the server computer; the database
  re-reads the admin role on every request and allows 20 open, 60 a minute and 900 an hour. The page never opens
  inside another site's frame.
- **My Assistant** (`my-assistant.html`, everyone; a phone page) is the old page: M6 answers `rpc my_assistant`
  as the old GET (the state, the agenda: one's own hours, open tasks and shoots, hours filed and the jobs' last
  log lines, scrubbed of amounts and clients' words by the database), `assistant_say` and `assistant_op` as the
  old POST. A message is kept on the phone with its client id until the database has it (the same id is
  accepted once: a lost answer never makes a second message); five may wait. The answers come from DCR Agents 2
  on the DCR server and arrive over Realtime on one's own rows (a channel that drops puts the page back on its
  5-second read at once). Items the office added are only ticked done.
  Drafts and the language are kept per profile (`dcr2:myAssistant.*`).
- **Assistants** (`assistant-admin.html`, admins) turns a person's assistant on or off and the office's reading
  of their chat and notes (`assistant_set`; from when it is turned on - what was written before stays private, and
  the person gets a note each time it changes), shows one person (`assistant_office_view`: the chat and the notes
  only while the office may read them, since then) and keeps the office's own reminders, to-dos and events for them
  (`assistant_office_item`). It works while the DCR server is off.
- The home page: My Assistant for everyone, with the old badge (answers not read, else what is due today:
  `my_assistant` with `p_summary`); DCR Agents 2 (with the server's dot) and Assistants for admins.
- Guided Assist is not built (Q21: dropped). The service worker keeps My Assistant ahead on phones, not the
  admins' pages.

## Sales estimates (P5c) in short

- **Who (Q10, owner 2026-10-21).** The "Sales estimates" switch (`profiles.can_sales_estimates`, migration M5c
  `20261027000100_office_lists`): an admin always has it; an admin gives it to anyone in DCR Desktop 2 (Users). With it a
  person READS the sales tables and the sales-media bucket; WRITING them is `app.can_edit('sales')` — an admin, or a manager
  with the switch — so anyone else with it opens everything read only. The pages read the switch on their own
  (`repo/sales.js salesAccess`); the home page's Sales Estimates card (Sales & Marketing) appears once it says so.
- **Money (2.1, Q10).** A comp's final price and cost per SF are `sales_reference_prices`; an estimate's benchmark, range,
  the estimator's rates and the priced output are `sales_estimate_prices`; both need the prices switch as well. Without it
  they never reach the browser (the embeds come back null), the columns and the money steps are not shown, and a save from
  such a person never sends them, so it never touches what a priced estimator worked out. The price rows are made by the
  database with every comp and estimate and written with a versioned PATCH (409 on a stale one). Words a person typed that
  quote an amount (notes, transcripts) are masked for anyone without prices and are then read only (a masked copy is never
  saved over the words).
- **Pictures, drawings, voice notes.** Everything is in the private bucket `sales-media`
  (`estimates|references|materials/<…>/<uuid>/<name>`, opened with signed URLs). A CME drawing is saved under the gallery
  entry's `cme` key, its PNG at `estimates/<EST-ref>/cme/cme-<drawing id>.png` — the one name the bucket lets a sales editor
  replace in place (one drawing, one file); a person can never write a new `cad` value (the old sketch tool's drawings are
  only kept, and opened in the old portal). The pictures' "URL" intake is gone (the security policy shows no other site's
  picture); an old link is kept as a link.
- **Not built (Q20):** the plans library, takeoff-web and the `.takeoff` archive stay on the old portal.

## Rules for every page

- The `Content-Security-Policy` meta tag of `index.html`, word for word, first in `<head>` after
  the charset. No inline `<script>` and no `on…=` attribute: scripts are files, handlers are
  `addEventListener`. Inline `style` is allowed. `script-src` names the one library file
  (`…/@supabase/supabase-js@2.117.2/dist/umd/supabase.js`), never the whole of jsDelivr (which serves
  anyone's npm or GitHub code); a page that needs another library (Leaflet 1.9.4 on the tasks map) adds
  its exact file there. `worker-src` has no CDN.
- `<script src="js/config.js">`, then the pinned supabase-js
  (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js`, `defer`),
  then the page's `<script type="module">`. Every CDN script names an exact version.
- Browser-side names are Portal 2's own: session `dcr2-auth`, cache `dcr-portal2-v3` (P6), IndexedDB
  `dcr2Uploads`, drafts `dcr2JrnDraft:<profile>:<project>`, theme `dcr2_theme`, city cache
  `dcr2CityGeo`, Site Photos' last job list `dcr2CaptureJobs:<profile>`, locks
  `dcr-portal2-single-instance`, `dcr2-upload-queue` and `dcr2-journal-drafts`, My Assistant's drafts `dcr2:myAssistant.draft.v1:<profile>`. Never the old portal's
  names.
- The sign-in form ships inert (a disabled fieldset, `method="post"`, no `name` attributes) and only
  its script enables it: a press before the script has loaded sends nothing. The service worker keeps
  the site's files under their path only, never with a query string.
- The journal never loses what was typed: drafts stay on the device until the entry row exists (the
  home page, Site Photos and the project page create entries written with no signal, even after the
  app was killed), only the fields a person changed are sent, and someone else's change of the same
  entry is taken in ("Use mine" for a field both changed).
- Signing out ends this device's session only, and turns this device's phone reminders off for that
  person first (a shared phone never shows their task titles afterwards). Amounts in free text are masked
  on screen for people without the prices switch (display only); a push never carries one (the push
  function masks every title and body).
- Test data is made up (`@demo.test`, `@example.com`, 555-01xx numbers, A267 as the sandbox). No page
  names A267 to people (it is not in the live database).
- The top bar is one row on every desk width: when the links do not fit (a long name, people online,
  the office roles' eight links) it first drops the words "DCR … Portal" beside the logo, then folds the
  links into the ☰ menu (`common2.js fitTopbar`, measured, not a fixed width); below 861 px the menu
  is always used.
- A page that needs another CDN library names its exact file in its own `script-src` and nowhere else
  (`tests/core-site-guard.test.mjs PAGE_LIBS`): today the two Time Sheet pages and jsPDF, and the tasks
  map and Leaflet (with its integrity hashes).
- The service worker precaches every page with everything it loads (`tests/core-sw.test.mjs` checks the
  whole import graph), so the installed app also opens offline from a cold start; a new page or module is
  added to `SHELL` in `site/sw.js` (and the cache name bumped with each release that changes the worker).

## Publishing (go-live)

Portal 2 needs the database change M1 (`20261020000100_portal2_foundation`, in DCR Desktop 2), the
`admin-users` function with CORS and the temporary-password flag, and DCR Desktop 2 2.14.0 on every
office PC the same day. Every live step waits for the owner's OK.

**P2 (timesheets) go-live, in order, each live step after the owner's OK.** The site calls M2's tables
and functions, so the database goes first (pushed before M2, the timesheet pages say the website and
database do not match; Settings and the home page carry on).

1. Both repositories committed; the offline checks green (DCR Desktop 2 suite, PGlite, `rehearse_p2.mjs`;
   here `node --test`, `schema-check`, `check-pages`, `e2e-demo` with its P2 walk).
2. A backup from today (Supabase → Database → Backups), then database change M2
   (`20261021000100_people_timesheets`): `npx supabase db push` from DCR Desktop 2.
3. DCR Desktop 2 2.15.0 on the office PCs (2.14 keeps working; 2.15 adds Users → Employees & crews).
4. The employee and journal imports (DCR Desktop 2 `tools/legacy_import/README.md`, "Portal 2 phase 2",
   steps 0–5), then in Employees & crews link each account to its employee and set each lead's crew.
5. Push this repository's `main` (the workflow runs the tests and publishes `site/`).
6. Try it on the test project **A000T2** ("Portal 2 test (delete later)"; A267, the old portal's sandbox,
   is not in this database): a day on the phone page, Team Sheets shows it live, confirm, change an hour
   in a second browser (the tick goes stale, the old fingerprint gets 409), withdraw, the Time Card, the
   PDF; then delete the test rows.

The crews keep filing hours in the old portal until they switch to Portal 2, on a Saturday the owner
picks once it is ready (texted hours need DCR Agents 2). The old hours are not imported (owner's
decision 2026-10-20): they stay in the old portal.

**P3 (tasks and phone reminders) go-live, in order, each live step after the owner's OK.** The full
runbook with every command and the expected counts is DCR Desktop 2's `tools/legacy_import/README.md`,
"Portal 2 phase 3" → "Phase 3 go-live: everything, in order". In short:

1. Both repositories committed; the offline checks green (DCR Desktop 2: the suite, PGlite, the Edge Function
   tests including the push function's, the self-test, `rehearse_p3.mjs`; here `node --test`,
   `schema-check` (it runs `push2.js` through the real push function over the real migrations),
   `check-pages`, `e2e-demo` with its P2 and P3 walks). The owner decides about the old portal's agent tasks
   (import them, the default, or leave them there).
2. A backup from today.
3. Database change M3 (`20261022000100_tasks_push`): `npx supabase db push` from DCR Desktop 2; the check
   gate query `select set_config('role', 'service_role', true) as push_can_set_role` must answer
   `service_role` (an error 42501: stop).
4. The `push` function: `npx supabase functions deploy push --use-api`, then its keys with
   `node tools/push/vapid.mjs --project-ref <ref> --yes` (DCR Desktop 2; prints the public key only).
   Portal 2 asks the function for the public key, so nothing changes here.
5. DCR Desktop 2 2.16.0 on every office PC the same day.
6. The invites and account links (each person who has old tasks needs an active, linked account first).
7. A fresh read of the old portal's open tasks, the build and the rehearsal; then the import (`tasks.sql`)
   and its verify queries.
8. The owner marks each moved task done in the old portal ("moved to Desktop 2", `tasks_closeout.md`).
9. Push this repository's `main` (the workflow runs the tests and publishes `site/`).
10. Smoke test on **A000T2** (never A267): reminders on an Android phone and on an iPhone from the Home
    Screen app, "Send me a test notice"; a task given to someone else on A000T2 reaches their phone and the
    tap opens `my-tasks.html?task=<id>`; an update and Mark complete from the phone show in DCR Desktop 2; a
    phone whose site data was cleared (reminders not turned off) is pruned on the next notice.
11. Delete the smoke test's tasks (DCR Desktop 2 → the task → Delete task). Tell the crews: Add to Home
    Screen, turn reminders on (the old portal's subscriptions cannot move).

**P5c (office lists, sales tools, the public subcontractor form) go-live, in order, each live step after the owner's
OK.** The full runbook with every command and the expected counts is DCR Desktop 2's `tools/legacy_import/README.md`,
"Portal 2 phase 5c: go-live, everything in order". In short: both repositories committed and the offline checks green
(here also `PGLITE_DIR=<folder> node tools/e2e-p5c-pglite.mjs`); a backup from today; database change M5c
(`20261027000100_office_lists`); the `subform` function (`npx supabase functions deploy subform --use-api
--no-verify-jwt`: the public form's only door, no sign-in); DCR Desktop 2 2.20.0 the same day, after the push (2.19 keeps
working on M5c; 2.20 needs it); a fresh read and rehearsal, the sales pictures, then the five office-list imports; then
`TZ=UTC node --test` and `node --test` green and this repository's `main` pushed; then the smoke test on A000T2 (a test
invoice from a phone that is not signed in, the e-mailed notice, accepted - a bill waiting for approval - and deleted).
`submit.html` is public: its link can go to subcontractors only after that smoke test.

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
8. Try it on the test project A000T2 only (A267, the old portal's sandbox, is not in this database): sign in, Board, a photo from Site Photos, the journal,
   a second browser for "changed by someone else", Desktop 2 showing the photo under "Stored in DCR"
   and both apps in presence.
9. In DCR Desktop 2, Users: give each person who will use Portal 2 an account with a temporary
   password. Tell the crews the address and to add it to the Home Screen.

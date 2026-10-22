// P5b: the ledger pages' static rules — ledger.html and report-expenses.html are Portal 2 pages like the others
// (the policy, one module script, no inline code); the project page's Expenses and Payments tabs are hidden by
// default and their code is fetched only on demand (a crew phone never downloads money code, and the offline
// list of the project page stays what it was); the Expenses tab and the printed report share js/expense-filter.js
// and neither re-implements a period, a sort or a total.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITE = new URL("../site/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, SITE), "utf8");
const strip = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("ledger.html and report-expenses.html: the shared policy, config.js, one page module, no inline code", () => {
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read("dashboard.html"))[1];
  for (const [page, mod] of [["ledger.html", "js/pages/ledger.js"], ["report-expenses.html", "js/pages/report-expenses.js"]]) {
    const html = read(page);
    assert.ok(html.includes('content="' + policy + '"'), page + ": the site's policy, word for word");
    assert.match(html, /<script src="js\/config\.js"><\/script>/);
    assert.ok(html.includes('<script type="module" src="' + mod + '"></script>'), page + ": its module");
    assert.ok(!/<script\b[^>]*>[^<]+<\/script>/.test(html) && !/\son[a-z]+\s*=/i.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), page + ": no inline code");
  }
  assert.match(read("ledger.html"), /<a href="accounting\.html">The Books<\/a>/, "the tab back to The Books");
});

test("project page: the money tabs are hidden until the financials switch shows them, and their code is fetched on demand", () => {
  const html = read("project.html");
  assert.match(html, /<button class="pj-tab" data-tab="expenses" type="button" role="tab" hidden>Expenses<\/button>/);
  assert.match(html, /<button class="pj-tab" data-tab="payments" type="button" role="tab" hidden>Payments<\/button>/);
  assert.ok(!/ledger\.css/.test(html), "the ledger stylesheet is added when a money tab opens");
  const js = strip(read("js/pages/project.js"));
  const statics = Array.from(js.matchAll(/(?:^|[;\n])\s*import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g)).map((m) => m[1]);
  for (const s of statics) assert.ok(!/project-expenses|project-payments|ledger|payments|expense-filter/.test(s), "static import of " + s);
  assert.match(js, /import\("\.\/project-expenses\.js"\)/);
  assert.match(js, /import\("\.\/project-payments\.js"\)/);
  assert.match(js, /MONEY_TABS\.indexOf\(name\) !== -1 && !ctx\.money\)\) name = "overview"/, "a ?tab= link to a money tab without the switch opens the Overview");
});

test("one source of truth for filtering expenses: the Expenses tab and the printed report both use js/expense-filter.js", () => {
  for (const f of ["js/pages/project-expenses.js", "js/pages/report-expenses.js"]) {
    const js = strip(read(f));
    assert.match(js, /from "\.\.\/expense-filter\.js"/, f);
    for (const re of [/thisMonth|lastMonth|thisQuarter/, /\.sort\(\s*function\s*\(a,\s*b\)\s*\{[^}]*expenseDate/, /getFullYear\(\)/]) {
      assert.ok(!re.test(js), f + " re-implements the filter (" + re + ")");
    }
    assert.match(js, /EF\.filter\(/);
    assert.match(js, /EF\.sort\(/);
    assert.match(js, /EF\.totals\(/);
  }
  // the report takes its filter from the address only, never from another tab's memory
  assert.ok(!/EF\.load\(/.test(strip(read("js/pages/report-expenses.js"))));
  assert.match(strip(read("js/pages/project-expenses.js")), /EF\.hrefWith\("report-expenses\.html", \{ id: ctx\.pid \}, f, true, today\)/, "Print pins the resolved window");
});

test("the CSV downloads carry a BOM and are built from the rows on screen (formula guard: map/ledger.js csvText)", () => {
  for (const f of ["js/pages/ledger.js", "js/pages/project-expenses.js"]) {
    const js = read(f);
    assert.match(js, /"\\ufeff" \+ csvText\(ledgerCsvRows\(rows\)\)/, f);
  }
});

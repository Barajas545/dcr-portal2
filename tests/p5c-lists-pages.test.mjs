// P5c: the office lists' pages — leads.html, vehicles.html and marketing.html are Portal 2 pages like the others (the
// site's security policy word for word, config.js, one module script, no inline code, no demo names), their scripts reach
// the data only through repo/ and map/, money is asked for only with the financials switch (a service's material cost, a
// marketing price), no insurance policy number appears anywhere, and the home page has their cards for the right people
// with counts-only badges read on demand (no static import: a crew phone's offline copy of the home page stays as it was).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITE = new URL("../site/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, SITE), "utf8");
const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const PAGES = [["leads.html", "js/pages/leads.js"], ["vehicles.html", "js/pages/vehicles.js"], ["marketing.html", "js/pages/marketing.js"]];
const MODULES = ["js/pages/leads.js", "js/pages/vehicles.js", "js/pages/marketing.js", "js/repo/leads.js", "js/repo/vehicles.js", "js/repo/marketing.js",
  "js/repo/_rows.js", "js/map/leads.js", "js/map/vehicles.js", "js/map/marketing.js", "js/map/masked-form.js"];

test("the three pages: the site's policy word for word, config.js, the lists stylesheet, one page module, no inline code", () => {
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read("dashboard.html"))[1];
  for (const [page, mod] of PAGES) {
    const html = read(page);
    assert.ok(html.includes('content="' + policy + '"'), page + ": the site's policy");
    assert.match(html, /<script src="js\/config\.js"><\/script>/, page);
    assert.match(html, /<link rel="stylesheet" href="css\/lists\.css" \/>/, page);
    assert.ok(html.includes('<script type="module" src="' + mod + '"></script>'), page + ": its module");
    assert.equal((html.match(/<script type="module"/g) || []).length, 1, page + ": one module");
    assert.ok(!/<script\b[^>]*>[^<]+<\/script>/.test(html), page + ": a script with a body");
    assert.ok(!/\son[a-z]+\s*=/i.test(html), page + ": an inline handler");
    assert.ok(!/<style\b/.test(html), page + ": its look is in css/lists.css");
    assert.match(html, /<div class="topbar" id="dcr2Topbar"><\/div>/, page + ": the Portal 2 bar");
  }
});

test("the scripts: data only through repo/ (pages) and supabase only in repo/; no demo names; no handler properties", () => {
  for (const f of MODULES) {
    const js = code(read(f));
    assert.ok(!/DCR2Fake|DCR2Demo|fake-supabase|__dev\//.test(read(f)), f + ": demo names");
    assert.ok(!/\.on(click|change|input|submit|keydown)\s*=/.test(js), f + ": a handler property");
    assert.ok(!/\beval\(|new Function\(/.test(js), f + ": eval");
    if (f.startsWith("js/pages/")) {
      assert.ok(!/\.from\(\s*["']/.test(js) && !/\.rpc\(/.test(js), f + ": a table or RPC outside repo/");
    }
    if (f.startsWith("js/map/")) assert.ok(!/^import /m.test(js) || /^import [^\n]*\.\/[a-z-]+\.js";$/m.test(js), f + ": a pure module");
  }
});

test("money only with the financials switch: the cost embed and the price embed are asked for only when the page says so", () => {
  const vRepo = code(read("js/repo/vehicles.js"));
  assert.match(vRepo, /select\(withCosts \? COST_EMBED : "\*"\)/, "the maintenance read asks for costs only with costs");
  const vPage = code(read("js/pages/vehicles.js"));
  assert.match(vPage, /state\.costs = seesCosts\(me\);/);
  assert.match(vPage, /repo\.loadFleet\(\{ costs: state\.costs \}\)/);
  assert.match(vPage, /el\("dmCostRow"\)\.hidden = !state\.costs;/, "the cost box only with financials");
  assert.match(vPage, /if \(state\.costs && el\("dmCost"\)\.value\.trim\(\)\) f\.materialCost/);
  const mRepo = code(read("js/repo/marketing.js"));
  assert.match(mRepo, /select\(withPrices \? PRICE_EMBED : "\*"\)/);
  const mPage = code(read("js/pages/marketing.js"));
  assert.match(mPage, /state\.prices = seesPrice\(me\);/);
  assert.match(mPage, /repo\.loadMarketing\(\{ prices: state\.prices \}\)/);
  assert.match(mPage, /const price = state\.prices \? el\("mf_marketingTaskPrice"\)\.value : undefined;/, "no price sent without the switch");
  assert.match(mPage, /if \(state\.prices\) \{\s*const t = totals\(state\.tasks\);/, "the totals only with the switch");
  assert.match(read("marketing.html"), /<div class="ls-f" id="mfPriceRow" hidden>/, "the price box starts hidden");
  assert.match(read("vehicles.html"), /<div class="ls-f full" id="dmCostRow" hidden>/, "the cost box starts hidden");
  // the map modules: who sees the money
  assert.match(code(read("js/map/vehicles.js")), /export function seesCosts\(me\) \{ return active\(me\) && \(me\.role === "admin" \|\| !!me\.can_see_financials\); \}/);
  assert.match(code(read("js/map/marketing.js")), /export function seesPrice\(me\) \{ return active\(me\) && me\.role !== "agents" && \(me\.role === "admin" \|\| !!me\.can_see_financials\); \}/);
});

test("Q18: no insurance policy number anywhere in the vehicle pages, their modules or the demo database", () => {
  for (const f of ["vehicles.html", "js/pages/vehicles.js", "js/repo/vehicles.js", "js/map/vehicles.js"]) {
    const s = code(read(f));
    assert.ok(!/policy_?number|policyNumber|insurancePolicy/i.test(s), f);
  }
  const fake = readFileSync(new URL("../tools/fake/p5c-lists.js", import.meta.url), "utf8");
  assert.ok(!/policy_?number|policyNumber/i.test(code(fake)), "the demo's vehicles");
});

test("leads and marketing: a lead or field account is told the list is the office's, and the page asks for nothing", () => {
  for (const [f, reads, load] of [["js/pages/leads.js", "readsLeads", "load"], ["js/pages/marketing.js", "readsMarketing", "load"]]) {
    const js = code(read(f));
    const init = js.split("async function init()")[1];
    const gate = init.indexOf("if (!" + reads + "(me)) {");
    assert.ok(gate !== -1, f + ": the gate");
    const ret = init.indexOf("return;", gate);
    assert.ok(ret !== -1 && ret < init.indexOf("await " + load + "()"), f + ": returns before the first read");
  }
  assert.match(code(read("js/pages/leads.js")), /el\("ldNewBtn"\)\.hidden = !state\.canWrite;/);
  assert.match(code(read("js/pages/marketing.js")), /el\("mkNewBtn"\)\.hidden = !state\.canWrite;/);
  assert.match(code(read("js/pages/vehicles.js")), /el\("vbSchedBtn"\)\.hidden = !state\.canWrite;/);
});

test("the home page: Leads and Marketing for the office (not a lead or field), Vehicles for everyone; the badges read on demand", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /const office = \["admin", "manager", "accountant", "viewer"\]\.indexOf\(role\) !== -1;/);
  assert.match(dash, /\{ href: "leads\.html", ic: "📞", tt: "Leads", id: "hmLeads", show: office,/);
  assert.match(dash, /\{ href: "marketing\.html", ic: "📣", tt: "Marketing Tasks", show: office,/);
  assert.match(dash, /\{ href: "vehicles\.html", ic: "🚚", tt: "Vehicles", id: "hmVehicles",\s*ds:/, "no show: everyone");
  for (const m of ["leads", "vehicles", "marketing"]) {
    assert.ok(!new RegExp("^import [^\\n]*(repo|map)/" + m + "\\.js", "m").test(dash), "no static import of " + m);
  }
  assert.match(dash, /import\("\.\.\/repo\/leads\.js"\), import\("\.\.\/map\/leads\.js"\)/);
  assert.match(dash, /repo\.loadFleet\(\{ costs: false \}\)/, "the badge never asks for a cost");
  assert.match(dash, /repo\.loadLeads\(\{ names: false \}\)/, "the badge never pages through the projects");
  // the badge texts are counts, never an amount
  const badges = dash.split("async function listBadges()")[1].split("\n}\n")[0];
  assert.ok(!/fmtMoney|materialCost|price/i.test(badges), "counts only");
});

test("words quoting an amount: every edit form fills its words through masked-form.js and sends the ORIGINAL of a masked box", () => {
  const leads = code(read("js/pages/leads.js"));
  assert.match(leads, /FIELDS\.forEach\(function \(f\) \{ fill\(el\("lf_" \+ f\), state\.editing \? state\.editing\[f\] \|\| "" : "", state\.mask\); \}\);/);
  assert.match(leads, /f\[k\] = valueOf\(el\("lf_" \+ k\), state\.editing \? state\.editing\[k\] : ""\);/);
  assert.match(leads, /fill\(el\("cvName"\), d\.name, state\.mask\);/);
  assert.match(leads, /name: valueOf\(el\("cvName"\), d\.name\)/);
  const veh = code(read("js/pages/vehicles.js"));
  assert.match(veh, /fill\(el\("emReq"\), state\.editM\.nextServiceRequirements \|\| "", state\.mask\);/);
  assert.match(veh, /valueOf\(el\("emReq"\), state\.editM\.nextServiceRequirements\)/);
  assert.match(veh, /fill\(el\("vf_" \+ k\), /);
  assert.match(veh, /valueOf\(el\("vf_" \+ k\), /);
  const mk = code(read("js/pages/marketing.js"));
  assert.match(mk, /TEXT\.forEach\(function \(f\) \{ fill\(el\("mf_" \+ f\), /);
  assert.match(mk, /TEXT\.forEach\(function \(k\) \{ f\[k\] = valueOf\(el\("mf_" \+ k\), /);
  // no edit box of these pages is filled straight from a record's words any more
  for (const [f, js] of [["leads", leads], ["vehicles", veh], ["marketing", mk]]) {
    assert.ok(!/\.value = state\.(editing|editV|editM)\b[^;]*(Notes|Requirements|Name|Descripiton|CompletedWork)/.test(js), f);
  }
});

// The plan buttons and the Floor Plans card (owner decisions 2026-10-26) in the page sources: Search draws a slot
// beside each project (never inside its link) and fills them with one plans_for call after the results; the project
// page's header slot; the Takeoffs tab keeps its own link; the home page's card for the people who see prices, in a
// new tab; the pages reach the broker only through repo/onedrive.js; nothing new in any security policy (the buttons
// are navigations); the offline list keeps the new code; the takeoff app's address is written in one place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (rel) => readFileSync(join(SITE, rel), "utf8").replace(/\r\n/g, "\n");
const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const statics = (js) => Array.from(code(js).matchAll(/(?:^|[;\n])\s*import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g)).map((m) => m[1]);
function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}

test("Search: each project's plan slot sits beside its link (never inside it), filled once after the results for the newest search", () => {
  const js = code(read("js/pages/search.js"));
  assert.ok(statics(read("js/pages/search.js")).includes("./plan-buttons.js"));
  assert.match(js, /return it\.projectId == null \? row : '<div class="se-proj">' \+ row \+\s*'<span class="se-plan" data-plans="' \+ esc\(it\.projectId\) \+ '" data-plans-style="icon" data-plans-title="' \+ esc\(it\.title\) \+\s*'" hidden><\/span><\/div>';/);
  assert.match(js, /paintThumbs\(my\);\s*paintPlans\(el\("seResults"\), me, function \(\) \{ return my === seq; \}\);/);
  // the Plans Library: the saved plans kept up to date while Search is open (people who see prices)
  assert.match(js, /me = await boot\("search"\);\s*mask = maskFor\(me\);\s*keepPlansFresh\(me\);/);
  // the projects group carries its id (map/search.js)
  assert.match(code(read("js/map/search.js")), /thumbId: p\.id, projectId: p\.id,/);
  const html = read("search.html");
  assert.match(html, /\.se-plan\[hidden\]\{display:none;\}/);
  assert.match(html, /\.se-proj > \.se-item\{flex:1; min-width:0; margin-bottom:0;\}/, "the result shrinks beside the button (a phone keeps no sideways scroll)");
  assert.match(html, /\.se-plan-go\{[^}]*min-height:44px;/, "a finger's target");
});

test("the project page: the header's slot beside the progress chart (on every tab), filled with this project's id; the Takeoffs tab keeps its link", () => {
  const html = read("project.html");
  const head = html.slice(html.indexOf('<div class="pj-head">'), html.indexOf('id="pjNew"'));
  assert.match(head, /<span class="pj-plans" id="pjPlans" data-plans-style="button" hidden><\/span>\s*<a class="pj-btn" id="pjPm"/);
  assert.match(html, /\.pj-plans\[hidden\]\{display:none;\}/);
  const js = code(read("js/pages/project.js"));
  assert.ok(statics(read("js/pages/project.js")).includes("./plan-buttons.js"));
  assert.match(js, /el\("pjPlans"\)\.setAttribute\("data-plans", String\(ctx\.project\.id\)\);\s*el\("pjPlans"\)\.setAttribute\("data-plans-title", el\("pjTitle"\)\.textContent \|\| ""\);\s*paintPlans\(document\.querySelector\("\.pj-head"\), ctx\.me\);\s*keepPlansFresh\(ctx\.me\);/);
  assert.ok(js.indexOf("ctx.project = await projectsRepo.getProject(ctx.pid)") < js.indexOf("paintPlans("), "after the project is read (a project not found: no ask)");
  const tk = code(read("js/pages/project-takeoffs.js"));
  assert.match(tk, /📐 Plans Archive \(takeoff-web\) ↗/);
});

test("the home page: Floor Plans in Projects for the people who see prices, opening the takeoff app's plans in a new tab", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /^import \{ PLANS_HOME, plansCardFor, planFilesFor \} from "\.\.\/map\/plans\.js";$/m);
  assert.match(dash, /\{ href: PLANS_HOME, ic: "📐", tt: "Floor Plans", ext: true, show: plansCardFor\(p\),\s*ds: "Open plans in the takeoff app — the Plans Archive and the plans kept on this device\." \}/);
  const projects = dash.slice(dash.indexOf('sections.push({ label: "Projects"'), dash.indexOf('sections.push({ label: "Sales & Marketing"'));
  assert.ok(projects.indexOf('tt: "Floor Plans"') > projects.indexOf('tt: "Search"'), "in Projects, after Search");
  assert.match(dash, /el\("a", \{ class: "hm-card-go", href: c\.href,\s*target: c\.ext \? "_blank" : null, rel: c\.ext \? "noopener" : null/);
  assert.ok(!/repo\/onedrive|plansFor/.test(dash), "the cards are links: nothing is asked for them");
  // the Plans Library (owner 2026-10-26): its card for the same people, right after Floor Plans; the page keeps the
  // saved plans up to date (a dynamic import inside plan-buttons.js: a crew phone never loads the library)
  assert.match(dash, /\{ href: "plans-library\.html", ic: "💾", tt: "Plans Library", show: planFilesFor\(p\),/);
  assert.ok(projects.indexOf('tt: "Plans Library"') > projects.indexOf('tt: "Floor Plans"'));
  assert.match(dash, /^import \{ keepPlansFresh \} from "\.\.\/pages\/plan-buttons\.js";$/m);
  assert.match(dash, /drain\(\);\s*keepPlansFresh\(p\);/);
});

test("the pages reach the broker only through repo/onedrive.js; plan-buttons.js says nothing on failure and calls no function itself", () => {
  const pb = code(read("js/pages/plan-buttons.js"));
  assert.deepEqual(statics(read("js/pages/plan-buttons.js")).sort(), ["../map/plan-library.js", "../map/plans.js", "../plan-handoff.js", "../repo/onedrive.js"]);
  assert.ok(!/functions\.invoke|\.rpc\(|\.from\(|toast|alert\(|innerText/.test(pb));
  // the buttons themselves say nothing (the menu, for the people who see prices, says what it does)
  const paint = pb.slice(pb.indexOf("export async function paintPlans"), pb.indexOf("function esc("));
  assert.ok(paint.length > 100 && !/textContent|say\(/.test(paint), "paintPlans says nothing");
  // the library is a dynamic import, for the people who see prices only
  assert.match(pb, /if \(!lib\) lib = import\("\.\.\/plan-library\.js"\);/);
  assert.match(pb, /const menu = planFilesFor\(me\);/);
  assert.match(pb, /try \{ got = await onedrive\.plansFor\(ids\); \} catch \(e\) \{ return 0; \}/);
  assert.match(pb, /if \(!root \|\| typeof root\.querySelectorAll !== "function" \|\| !onedrive\.plansShownFor\(me\)\) return 0;/);
  const repo = code(read("js/repo/onedrive.js"));
  assert.match(repo, /call\(\{ op: "plans_for", project_ids: part \}\)/);
  assert.match(repo, /if \(code === "takeoff_not_configured" \|\| code === "not_deployed"\) return \{\};/);
  assert.match(repo, /if \(!LIVE \|\| !ids\.length\) return out;/, "LIVE is respected");
  const map = code(read("js/map/plans.js"));
  assert.ok(!/import /.test(map), "map/plans.js is pure");
});

test("nothing new in any security policy: the buttons and the card are navigations; the takeoff app's address is written in one place", () => {
  for (const f of walk(SITE).filter((f) => f.endsWith(".html"))) {
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(f, "utf8"));
    if (m) assert.ok(!/github\.io/.test(m[1]), f + " names github.io in its policy");
  }
  const where = walk(SITE).filter((f) => /\.(js|html)$/.test(f) && readFileSync(f, "utf8").includes("barajas545.github.io/takeoff-web"))
    .map((f) => f.slice(SITE.length).replace(/\\/g, "/"));
  assert.deepEqual(where, ["js/map/plans.js"]);
});

test("the offline list keeps the plan buttons' code (Search, the project page and the home page load it) and the Plans Library (it opens with no signal); the cache name stays", () => {
  const sw = read("sw.js");
  for (const f of ["js/map/plans.js", "js/pages/plan-buttons.js", "plans-library.html", "js/pages/plans-library.js", "js/plan-library.js",
    "js/plan-library-worker.js", "js/plan-handoff.js", "js/map/plan-library.js"]) assert.ok(sw.includes('"' + f + '"'), f + " is in SHELL");
  assert.match(sw, /^const CACHE = "dcr-portal2-v3";$/m);
});

test("the Plans Library page: offline sign-in, the people who see prices only, the site's policy plus the OneDrive host, one page module", () => {
  const html = read("plans-library.html");
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>/g)).map((m) => m[0]);
  assert.deepEqual(scripts, ['<script src="js/config.js">',
    '<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" crossorigin="anonymous">',
    '<script type="module" src="js/pages/plans-library.js">']);
  const js = code(read("js/pages/plans-library.js"));
  assert.match(js, /state\.me = await boot\("", \{ offline: true \}\);\s*if \(!planFilesFor\(state\.me\)\)/);
  assert.ok(!/functions\.invoke|\.rpc\(|\.from\(|sb\(\)/.test(js), "the data only through the library and repo/");
  // the hand-over: only to the takeoff app's address, only from its tab, with its word
  const ho = code(read("js/plan-handoff.js"));
  assert.match(ho, /if \(ev\.source !== win \|\| ev\.origin !== TAKEOFF_ORIGIN\) return;/);
  assert.match(ho, /if \(!d \|\| typeof d !== "object" \|\| d\.v !== VERSION \|\| d\.nonce !== word\) return;/);
  assert.equal((ho.match(/postMessage\(/g) || []).length, 2, "the plan and a fresh link, nothing else");
  assert.equal((ho.match(/, TAKEOFF_ORIGIN\)/g) || []).length, 2, "each to the takeoff app's address only");
  assert.ok(!/postMessage\([^)]*["']\*["']/.test(ho), "never to any address");
  // the library: the bytes from OneDrive only through the broker's link, the link kept in memory only
  const lib = code(read("js/plan-library.js"));
  assert.ok(!/localStorage|sessionStorage/.test(lib), "no link or plan detail in web storage");
  assert.match(lib, /onedrive\.planLink\(/);
});

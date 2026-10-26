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
  assert.match(js, /return it\.projectId == null \? row : '<div class="se-proj">' \+ row \+\s*'<span class="se-plan" data-plans="' \+ esc\(it\.projectId\) \+ '" data-plans-style="icon" hidden><\/span><\/div>';/);
  assert.match(js, /paintThumbs\(my\);\s*paintPlans\(el\("seResults"\), me, function \(\) \{ return my === seq; \}\);/);
  assert.match(js, /me = await boot\("search"\);\s*mask = maskFor\(me\);/);
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
  assert.match(js, /el\("pjPlans"\)\.setAttribute\("data-plans", String\(ctx\.project\.id\)\);\s*paintPlans\(document\.querySelector\("\.pj-head"\), ctx\.me\);/);
  assert.ok(js.indexOf("ctx.project = await projectsRepo.getProject(ctx.pid)") < js.indexOf("paintPlans("), "after the project is read (a project not found: no ask)");
  const tk = code(read("js/pages/project-takeoffs.js"));
  assert.match(tk, /📐 Plans Archive \(takeoff-web\) ↗/);
});

test("the home page: Floor Plans in Projects for the people who see prices, opening the takeoff app's plans in a new tab", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /^import \{ PLANS_HOME, plansCardFor \} from "\.\.\/map\/plans\.js";$/m);
  assert.match(dash, /\{ href: PLANS_HOME, ic: "📐", tt: "Floor Plans", ext: true, show: plansCardFor\(p\),\s*ds: "Open plans in the takeoff app — the Plans Archive and the plans kept on this device\." \}/);
  const projects = dash.slice(dash.indexOf('sections.push({ label: "Projects"'), dash.indexOf('sections.push({ label: "Sales & Marketing"'));
  assert.ok(projects.indexOf('tt: "Floor Plans"') > projects.indexOf('tt: "Search"'), "in Projects, after Search");
  assert.match(dash, /el\("a", \{ class: "hm-card-go", href: c\.href,\s*target: c\.ext \? "_blank" : null, rel: c\.ext \? "noopener" : null/);
  assert.ok(!/repo\/onedrive|plansFor/.test(dash), "the card is a link: nothing is asked for it");
});

test("the pages reach the broker only through repo/onedrive.js; plan-buttons.js says nothing on failure and calls no function itself", () => {
  const pb = code(read("js/pages/plan-buttons.js"));
  assert.deepEqual(statics(read("js/pages/plan-buttons.js")).sort(), ["../map/plans.js", "../repo/onedrive.js"]);
  assert.ok(!/functions\.invoke|\.rpc\(|\.from\(|toast|alert\(|innerText|textContent/.test(pb));
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

test("the offline list keeps the plan buttons' code (Search, the project page and the home page load it); the cache name stays", () => {
  const sw = read("sw.js");
  for (const f of ["js/map/plans.js", "js/pages/plan-buttons.js"]) assert.ok(sw.includes('"' + f + '"'), f + " is in SHELL");
  assert.match(sw, /^const CACHE = "dcr-portal2-v3";$/m);
});

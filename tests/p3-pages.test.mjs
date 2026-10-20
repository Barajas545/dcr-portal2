// P3 (tasks): the page rules of My Tasks, the tasks map and the project's Tasks tab (BLUEPRINT 2.2.1,
// MODULES §5): Leaflet pinned and named by the map's policy only, no handler in any HTML the scripts build,
// the pins drawn without a CDN picture, Portal 2's own draft keys, the shared styles; the top bar and the
// home cards; live.js hands a task's "no longer yours" tombstone on as a DELETE.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { navItems } from "../site/js/common2.js";

// the same values as tests/core-site-guard.test.mjs (PAGE_LIBS); not imported, so its tests run once
const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
function parseCsp(text) {
  const out = {};
  for (const part of String(text).split(";")) {
    const [name, ...srcs] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = srcs.slice().sort().join(" ");
  }
  return out;
}

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (p) => readFileSync(join(SITE, p), "utf8");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const files = walk(SITE);
const rel = (p) => relative(SITE, p).replace(/\\/g, "/");

test("the tasks map loads Leaflet 1.9.4 from jsDelivr with its integrity hashes; only the map's policy names it", () => {
  const html = read("tasks-map.html");
  assert.ok(html.includes('<script defer src="' + LEAFLET_JS + '" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="' + LEAFLET_CSS + '" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous" />'));
  const csp = parseCsp(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)[1]);
  assert.ok(csp["script-src"].split(" ").includes(LEAFLET_JS));
  assert.ok(html.indexOf(LEAFLET_JS) > html.indexOf("supabase-js@2.117.2") && html.indexOf(LEAFLET_JS) < html.indexOf("js/pages/tasks-map.js"), "Leaflet before the page's module");
  for (const f of files.filter((x) => x.endsWith(".html") && rel(x) !== "tasks-map.html")) {
    assert.ok(!/leaflet/i.test(readFileSync(f, "utf8")), rel(f) + " names Leaflet");
  }
});

test("no handler in HTML a script builds (the old map's popups and cards had 36 of them): every page script", () => {
  for (const f of files.filter((x) => /\.m?js$/.test(x))) {
    const src = readFileSync(f, "utf8");
    const hit = /<[a-z][^>'"]*\son[a-z]+\s*=/i.exec(src);
    assert.equal(hit, null, rel(f) + ": an inline handler in built HTML: " + (hit && hit[0]));
    assert.ok(!/\.on(click|change|input|submit|keydown)\s*=/.test(src) || rel(f) === "sw.js", rel(f) + ": a handler property instead of addEventListener");
  }
});

test("the map's pins are drawn with CSS (divIcon): no default marker picture from the CDN (img-src allows none)", () => {
  const js = read("js/pages/tasks-map.js");
  assert.ok(!/Icon\.Default|L\(\)\.icon\(|marker-icon\.png/.test(js));
  for (const m of js.matchAll(/L\(\)\.marker\(([^;]*)/g)) assert.ok(/icon:\s*pinIcon/.test(m[1]), "every marker has the CSS pin: " + m[0].slice(0, 80));
  assert.ok(/divIcon\(/.test(js));
  assert.ok(/tile\.openstreetmap\.org/.test(js) && /subdomains:\s*"abc"/.test(js), "tiles from the subdomains img-src allows (*.tile.openstreetmap.org)");
});

test("Portal 2's own draft keys (Appendix C: dcr2: prefix plus the profile id), shared by My Tasks, the map and the project tab", () => {
  for (const p of ["js/pages/my-tasks.js", "js/pages/tasks-map.js", "js/pages/project-tasks.js"]) {
    const src = read(p);
    assert.ok(src.includes('"dcr2:taskDraft:"'), p);
    assert.ok(!/dcr\.myTasks|myTasks\.draft/.test(src), p + ": the old portal's keys");
  }
  assert.ok(read("js/pages/my-tasks.js").includes('"dcr2:taskShots:"'));
  for (const p of ["my-tasks.html", "tasks-map.html", "project.html"]) assert.ok(read(p).includes('href="css/tasks.css"'), p + " links the task styles");
});

test("the top bar has My Tasks for every role; the home page has My Tasks (with its badge) and Tasks on Map", async () => {
  for (const role of ["admin", "manager", "accountant", "lead", "field", "viewer"]) {
    const items = navItems({ role });
    assert.ok(items.some((i) => i.key === "tasks" && i.href === "my-tasks.html"), role);
  }
  const dash = read("js/shell/dashboard.js");
  assert.ok(/href: "my-tasks.html"[^}]*id: "hmMyTasks"/.test(dash) && dash.includes('href: "tasks-map.html"'));
  assert.ok(/myTasksBadge\(\)/.test(dash) && /taskSummary\(\)/.test(dash));
});

test("live.js: a task's tombstone (deletions.for_user, M1 7b) reaches the page as a DELETE of that task", async () => {
  const channels = [];
  const fake = {
    channel(topic, opts) {
      const ch = { topic, opts, binds: [], on(type, filter, cb) { this.binds.push({ type, filter, cb }); return this; },
        subscribe(cb) { this.status = cb; setTimeout(() => cb("SUBSCRIBED"), 0); return this; } };
      channels.push(ch);
      return ch;
    },
    removeChannel() { return "ok"; },
  };
  globalThis.DCR2_CONFIG = { SUPABASE_URL: "https://x.invalid", SUPABASE_KEY: "sb_publishable_test" };
  globalThis.supabase = { createClient: () => fake };
  const live = await import("../site/js/live.js");
  assert.ok(live.TOMBSTONE_TABLES.has("tasks") && live.TOMBSTONE_TABLES.has("files") && !live.SOFT_DELETE_TABLES.has("tasks"));
  const got = [];
  const stop = live.watch("tasks", "project_id=eq.268", (e) => got.push(e));
  const ch = channels[channels.length - 1];
  assert.equal(ch.opts.config.private, true);
  const tomb = ch.binds.find((b) => b.filter.table === "deletions");
  assert.equal(tomb.filter.filter, "table_name=eq.tasks");
  tomb.cb({ new: { table_name: "tasks", row_id: 41, project_id: 268, for_user: "u-field" } });
  tomb.cb({ new: { table_name: "tasks", row_id: 42, project_id: 999, for_user: "u-field" } });
  assert.deepEqual(got.filter((e) => e.type === "DELETE"), [{ type: "DELETE", table: "tasks", new: null, old: { id: 41, project_id: 268 }, soft: true, forMe: true }]);
  stop();
});

// The takeoff app inside the portal on a phone or a tablet (owner decision Q4, 2026-11-04; the iPad build contract C3,
// P3): the portal's own copy of takeoff-web at site/takeoff/ (tools/vendor-takeoff.mjs - exactly one commit's files, a
// strict page policy, VERSION.json), shown in a full-screen frame over the page (js/plan-frame.js) by the same hand-over
// as a computer's new tab (js/plan-handoff.js), routed by map/plans.js (phones and tablets: the frame; computers: the
// tab), and never cached by the portal's own service worker (site/sw.js: takeoff's own worker, scope /takeoff/, does).
// Made-up data only; nothing reaches Supabase, Microsoft or GitHub.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as V from "../tools/vendor-takeoff.mjs";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const TAKEOFF = join(SITE, "takeoff");
const read = (p) => readFileSync(join(SITE, p), "utf8");
function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}
// the same values as tests/core-site-guard.test.mjs (ONEDRIVE, TAKEOFF_CSP); not imported, so its tests run once
const ONEDRIVE = "https://netorgft10120038-my.sharepoint.com";
const TAKEOFF_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
  "connect-src 'self' " + ONEDRIVE + "; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const VERSION = JSON.parse(readFileSync(join(TAKEOFF, "VERSION.json"), "utf8"));

/* ── the copy (tools/vendor-takeoff.mjs) ─────────────────────────────────────────────────────────────────────── */

test("the copy is exactly what VERSION.json lists: every file's sha256 as published, nothing more, nothing less", () => {
  assert.match(VERSION.commit, /^[0-9a-f]{40}$/, "a whole commit id");
  assert.equal(VERSION.from, "takeoff-web");
  const onDisk = walk(TAKEOFF).map((f) => relative(TAKEOFF, f).replace(/\\/g, "/")).filter((p) => p !== "VERSION.json").sort();
  assert.deepEqual(onDisk, Object.keys(VERSION.files).sort(), "the files on disk are the listed ones");
  for (const [p, sum] of Object.entries(VERSION.files)) {
    assert.equal(createHash("sha256").update(readFileSync(join(TAKEOFF, p))).digest("hex"), sum, p + ": not the vendored bytes (a line-ending change? .gitattributes keeps site/takeoff/ -text)");
  }
  // only what the app ships: never takeoff-web's tests, docs or tools
  for (const p of onDisk) assert.equal(V.shipped(p) === "ship" || p === V.BOOT_FILE, true, p + " is not a file the app ships");
  for (const need of ["index.html", "sw.js", "manifest.webmanifest", "js/main.js", "css/app.css", "vendor/pdfjs/build/pdf.min.js",
    "vendor/pdfjs/build/pdf.worker.min.js", "vendor/pdfjs/LICENSE"]) assert.ok(onDisk.includes(need), need);
  assert.ok(!onDisk.some((p) => /^(tests|docs|tools)\//.test(p) || /\.md$/i.test(p)), "no tests, docs or notes");
  assert.equal(readFileSync(fileURLToPath(new URL("../.gitattributes", import.meta.url)), "utf8").match(/^site\/takeoff\/\*\* -text$/m) !== null, true,
    "git never changes the copy's line endings");
});

test("the copy's one page: the exact page policy before anything else, no inline script, no inline handler, its module beside it", () => {
  const html = read("takeoff/index.html");
  const metas = Array.from(html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi));
  assert.equal(metas.length, 1, "one policy");
  assert.equal(metas[0][1], TAKEOFF_CSP);
  assert.equal(VERSION.csp, TAKEOFF_CSP, "VERSION.json says the same");
  assert.ok(html.indexOf("Content-Security-Policy") < html.search(/<script\b|<link\b/i), "before any script or stylesheet");
  for (const m of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\ssrc="[^":]+"/, "a script of this site's own: " + m[0].slice(0, 80));
    assert.equal(m[2].trim(), "", "no inline script");
  }
  assert.equal(/<[a-z][^>]*\son[a-z]+\s*=/i.exec(html), null, "no inline handler");
  assert.ok(!/javascript:/i.test(html));
  // the policy: nothing but this site, the OneDrive host only to read a plan opened online, never the database, a CDN or github.io
  const p = V.takeoffCsp(ONEDRIVE);
  assert.equal(p, TAKEOFF_CSP, "the tool's policy");
  assert.ok(!/supabase|jsdelivr|github|'unsafe-eval'|\*/.test(p));
  assert.equal(/script-src ([^;]+)/.exec(p)[1], "'self'");
  assert.throws(() => V.takeoffCsp("https://evil.example"), /not the OneDrive host/);
  assert.equal(V.onedriveHost(read("js/repo/onedrive.js")), ONEDRIVE, "the host the portal's own code names");
});

test("the copy that ships talks to the portal's frame: takeoff-web's own UI-mode boot (never --allow-inline-boot), its embedded profile, the save to the portal and its heartbeat", () => {
  const html = read("takeoff/index.html");
  // a copy vendored with the escape (main f499435) never answers a same-origin parent: every handheld open would fail
  assert.equal(VERSION.inlineBootMoved, false, "vendored WITHOUT --allow-inline-boot");
  assert.deepEqual(Object.keys(VERSION.edits), ["index.html"], "only the page policy was written here");
  assert.ok(V.BOOT_FILE in VERSION.files && existsSync(join(TAKEOFF, V.BOOT_FILE)), "takeoff-web's own boot file");
  const at = html.indexOf('<script src="' + V.BOOT_FILE + '"></script>');
  assert.ok(at > 0 && at < html.indexOf('<link rel="stylesheet"'), "a classic script before the stylesheet paints");
  assert.match(read("takeoff/" + V.BOOT_FILE), /document\.documentElement\.dataset\.ui = /);
  assert.ok(!/DCR Portal 2's tools\/vendor-takeoff\.mjs/.test(read("takeoff/" + V.BOOT_FILE)), "not the tool's moved copy");
  assert.match(read("takeoff/sw.js"), /'js\/ui-mode-boot\.js'/, "in the app's offline program");
  assert.ok(!/vendor-takeoff/.test(read("takeoff/sw.js")), "the worker as takeoff-web wrote it");
  // the other half of js/plan-handoff.js: the same-site parent is the peer, ptt-save, and the "keeping" heartbeat
  const handoff = read("takeoff/js/core/portal-handoff.js");
  assert.match(handoff, /framedBySameSite/);
  assert.match(handoff, /'ptt-save'/);
  assert.match(handoff, /'keeping'/);
  assert.ok(existsSync(join(TAKEOFF, "js/core/embedded.js")), "the embedded profile");
  assert.ok(!/\(\?<[!=]/.test(read("takeoff/js/ui/catalog.js")), "no look-behind (Safari before 16.4)");
});

test("vendor-takeoff.mjs: what ships, the page edits and their refusals", () => {
  for (const p of ["index.html", "sw.js", "manifest.webmanifest", "js/main.js", "js/core/x.mjs", "css/app.css", "icons/a.png", "data/m.json",
    "vendor/pdfjs/build/pdf.min.js", "vendor/pdfjs/build/pdf.worker.min.js", "vendor/pdfjs/cmaps/Add-H.bcmap", "vendor/pdfjs/cmaps/LICENSE",
    "vendor/pdfjs/standard_fonts/FoxitSerif.pfb", "vendor/pdfjs/standard_fonts/LICENSE_FOXIT", "vendor/pdfjs/LICENSE"]) assert.equal(V.shipped(p), "ship", p);
  for (const p of ["js/notes.md", "css/x.scss", "vendor/pdfjs/web/viewer.html", "vendor/pdfjs/build/pdf.min.js.map", "data/x.csv"]) assert.equal(V.shipped(p), "skip", p);
  for (const p of ["tests/run-all.mjs", "README.md", "docs/x.md", ".gitattributes", "start.bat", "js/../x.js", "../index.html", "js//x.js", "vendor/other/x.js"]) {
    assert.equal(V.shipped(p), "", p);
  }
  const CSP = TAKEOFF_CSP;
  const page = '<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<title>t</title>\n<script>\nvar st = 1;\n</script>\n' +
    '<link rel="stylesheet" href="css/app.css">\n<!-- <script>not one</script> -->\n</head><body><script type="module" src="js/main.js"></script></body></html>';
  assert.throws(() => V.publishPage(page, CSP, false), /inline <script>.*--allow-inline-boot/s, "refused without the escape");
  const out = V.publishPage(page, CSP, true);
  assert.equal(out.boot, "\nvar st = 1;\n");
  assert.ok(out.html.includes('<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + CSP + '">'));
  assert.ok(out.html.includes('<script src="js/ui-mode-boot.js"></script>\n<link rel="stylesheet"'));
  assert.ok(out.html.includes("<!-- <script>not one</script> -->"), "a commented script is left as it is");
  assert.match(V.bootFile(out.boot, "f".repeat(40)), /moved out of the page word for word[\s\S]*\*\/\nvar st = 1;\n$/);
  // a page with no inline script needs no escape; two inline scripts, one in the body, a module, a handler, its own policy: refused
  const clean = page.replace(/<script>\nvar st = 1;\n<\/script>\n/, '<script src="js/ui-mode-boot.js"></script>\n');
  assert.equal(V.publishPage(clean, CSP, false).boot, null);
  assert.throws(() => V.publishPage(page.replace("</title>", "</title><script>x()</script>"), CSP, true), /ONE inline script/);
  assert.throws(() => V.publishPage(clean.replace("<body>", "<body><script>x()</script>"), CSP, true), /head's inline script only/);
  assert.throws(() => V.publishPage(page.replace("<script>\nvar", '<script type="module">\nvar'), CSP, true), /classic script only/);
  assert.throws(() => V.publishPage(clean.replace("<body>", '<body onload="x()">'), CSP, false), /inline event handler/);
  assert.throws(() => V.publishPage(clean.replace("<body>", '<body><a href="javascript:x()">'), CSP, false), /javascript:/);
  assert.throws(() => V.publishPage(clean.replace("<title>", '<meta http-equiv="Content-Security-Policy" content="default-src *"><title>'), CSP, false), /its own security-policy/);
  assert.throws(() => V.publishPage(clean.replace('<meta charset="utf-8">', ""), CSP, false), /no <meta charset/);
  // the boot file joins the app's own offline program once
  const sw = "const CACHE = 'x';\nconst PROGRAM = [\n  './',\n  'index.html',\n  'css/app.css',\n];\n";
  const sw2 = V.swWithBoot(sw);
  assert.match(sw2, /'index\.html',\n  'js\/ui-mode-boot\.js',/);
  assert.equal(V.swWithBoot(sw2), sw2);
  assert.throws(() => V.swWithBoot("const PROGRAM = [];"), /no PROGRAM list/);
  // the report of the portal's own rules
  const f = V.audit(new Map([["js/a.js", Buffer.from("const r = /(?<=\\d)x/;\nok();\n")], ["css/a.css", Buffer.from("(?<=x)")]]));
  assert.deepEqual(f.map((x) => [x.file, x.line]), [["js/a.js", 1]]);
});

let gitOk = false;
try { execFileSync("git", ["--version"], { stdio: "ignore" }); gitOk = true; } catch (e) { gitOk = false; }

test("vendor-takeoff.mjs over a made-up repository: the COMMIT's bytes (never the working tree, never a line-ending filter), the old copy replaced whole", { skip: !gitOk }, () => {
  const dir = mkdtempSync(join(tmpdir(), "dcr2-vendor-"));
  try {
    const repo = join(dir, "tw");
    const g = (args, input) => execFileSync("git", ["-C", repo, "-c", "core.autocrlf=false", "-c", "user.name=Made Up", "-c", "user.email=made-up@example.com"].concat(args), { input });
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    const put = (p, text) => { mkdirSync(join(repo, p, ".."), { recursive: true }); writeFileSync(join(repo, p), text); };
    put("index.html", '<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<script>\nboot();\n</script>\n<link rel="stylesheet" href="css/app.css">\n</head><body></body></html>\n');
    put("sw.js", "const PROGRAM = [\n  './',\n  'index.html',\n];\n");
    put("manifest.webmanifest", "{}\n");
    put("css/app.css", "a{}\r\nb{}\r\n");                      // CRLF in the commit: kept as committed
    put("js/main.js", "export const a = 1;\n");
    put("tests/secret-fixture.mjs", "never shipped\n");
    put("vendor/pdfjs/build/pdf.min.js", "pdf\n");
    put("vendor/pdfjs/web/viewer.html", "<html></html>\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "one"]);
    const one = g(["rev-parse", "HEAD"]).toString().trim();
    put("js/main.js", "export const a = 'working tree, never vendored';\n");   // not committed
    const out = join(dir, "site-takeoff");
    mkdirSync(out);
    writeFileSync(join(out, "stale.js"), "an older copy's file");
    const od = join(dir, "onedrive.js");
    writeFileSync(od, 'export const ONEDRIVE_HOST = "made-up-tenant-my.sharepoint.com";\n');
    assert.throws(() => V.vendor({ dir: repo, commit: one, out, onedriveSrc: od }), /inline <script>/);
    assert.ok(existsSync(join(out, "stale.js")), "a refused run leaves the old copy as it was");
    const r = V.vendor({ dir: repo, commit: one, out, onedriveSrc: od, allowInlineBoot: true });
    assert.equal(r.commit, one);
    assert.deepEqual(r.skipped, ["vendor/pdfjs/web/viewer.html"]);
    assert.ok(!existsSync(join(out, "stale.js")), "replaced whole");
    assert.equal(readFileSync(join(out, "js/main.js"), "utf8"), "export const a = 1;\n", "the commit's bytes, not the working tree's");
    assert.equal(readFileSync(join(out, "css/app.css"), "utf8"), "a{}\r\nb{}\r\n", "byte for byte");
    assert.ok(!existsSync(join(out, "tests")));
    const v = JSON.parse(readFileSync(join(out, "VERSION.json"), "utf8"));
    assert.equal(v.commit, one);
    assert.equal(v.csp, V.takeoffCsp("https://made-up-tenant-my.sharepoint.com"));
    assert.deepEqual(Object.keys(v.files).sort(), ["css/app.css", "index.html", "js/main.js", "js/ui-mode-boot.js", "manifest.webmanifest", "sw.js", "vendor/pdfjs/build/pdf.min.js"]);
    for (const [p, sum] of Object.entries(v.files)) assert.equal(V.sha256(readFileSync(join(out, p))), sum, p);
    assert.match(readFileSync(join(out, "index.html"), "utf8"), /<script src="js\/ui-mode-boot\.js"><\/script>/);
    // a commit that moved the boot itself: no escape needed, and the escape is refused
    g(["mv", "index.html", "index.old"]);
    put("index.html", '<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<script src="js/ui-mode-boot.js"></script>\n</head><body></body></html>\n');
    put("js/ui-mode-boot.js", "boot();\n");
    g(["rm", "-q", "--cached", "index.old"]);
    g(["add", "index.html", "js/ui-mode-boot.js"]);
    g(["commit", "-q", "-m", "two"]);
    assert.throws(() => V.vendor({ dir: repo, commit: "HEAD", out, onedriveSrc: od, allowInlineBoot: true }), /already has js\/ui-mode-boot\.js/);
    const two = V.vendor({ dir: repo, commit: "HEAD", out, onedriveSrc: od });
    assert.equal(JSON.parse(readFileSync(join(out, "VERSION.json"), "utf8")).inlineBootMoved, false);
    assert.ok(!("sw.js" in two.edits), "sw.js as committed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the demo server serves the copy as published (no demo stand-in in its page)", async (t) => {
  const { startServer, isVendored } = await import("../tools/devserve.mjs");
  assert.equal(isVendored("/takeoff/index.html"), true);
  assert.equal(isVendored("/search.html"), false);
  const server = startServer(0);
  t.after(() => server.close());
  await new Promise((r) => server.once("listening", r));
  const page = await (await fetch("http://127.0.0.1:" + server.address().port + "/takeoff/index.html")).text();
  assert.equal(page, read("takeoff/index.html"));
});

/* ── the portal's service worker (site/sw.js v5) ─────────────────────────────────────────────────────────────── */

/** site/sw.js in a node vm with Cache Storage in memory (as tests/core-sw.test.mjs runs it), at `scope`. */
function portalWorker(scope) {
  const SRC = read("sw.js");
  const ORIGIN = new URL(scope).origin;
  const stores = new Map();
  const handlers = {};
  const calls = [];
  const keyOf = (r) => (typeof r === "string" ? r : r.url);
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return { async put(r, res) { m.set(keyOf(r), res); }, async match(r) { return m.get(keyOf(r)); },
      async keys() { return Array.from(m.keys()).map((url) => ({ url })); }, async delete(r) { return m.delete(keyOf(r)); } };
  };
  const caches = { async open(n) { return cacheOf(n); }, async keys() { return Array.from(stores.keys()); }, async delete(n) { return stores.delete(n); },
    async match(r) { for (const n of stores.keys()) { const v = await cacheOf(n).match(r); if (v) return v; } return undefined; } };
  const response = (url) => ({ ok: true, type: url.startsWith(ORIGIN) ? "basic" : "cors", url, clone() { return response(url); } });
  const self = { location: new URL(ORIGIN + "/sw.js"), registration: { scope, showNotification: async () => {} },
    clients: { claim: async () => {}, matchAll: async () => [] }, skipWaiting() {}, addEventListener(t, fn) { handlers[t] = fn; } };
  const ctx = { self, caches, URL, Promise, console, fetch: async (r) => { calls.push(keyOf(r)); return response(keyOf(r)); } };
  vm.runInContext(SRC, vm.createContext(ctx));
  async function fire(type, event) {
    let done = Promise.resolve();
    const ev = Object.assign({ waitUntil(p) { done = p; }, respondWith(p) { done = p; ev.responded = true; } }, event);
    handlers[type](ev);
    await done;
    await new Promise((r) => setTimeout(r, 5));
    return !!ev.responded;
  }
  return { stores, calls, fire, get: (url, mode, method) => fire("fetch", { request: { url, method: method || "GET", mode: mode || "no-cors" } }) };
}

test("site/sw.js v5: the takeoff copy is never answered, kept or precached by the portal's worker (its own worker, scope takeoff/, does); everything else as before", async () => {
  const sw = read("sw.js");
  assert.match(sw, /^const CACHE = "dcr-portal2-v5";$/m);
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  assert.ok(!shell.some((f) => /^takeoff\//.test(f)), "no takeoff file in the portal's list");
  // the pass-through comes before anything else the fetch handler decides
  const handler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
  assert.ok(handler.indexOf("if (inTakeoff(url)) return;") !== -1 && handler.indexOf("if (inTakeoff(url)) return;") < handler.indexOf("respondWith"));
  for (const scope of ["https://portal.example.test/", "https://made-up.example.test/portal/"]) {
    const w = portalWorker(scope);
    await w.fire("install", {});
    await w.fire("activate", {});
    assert.ok(!w.calls.some((u) => /\/takeoff\//.test(u)), "install fetched no takeoff file");
    const base = new URL("takeoff/", scope).href;
    for (const [url, mode] of [[base + "index.html#portal=Zk3pQ9_x-7LmN2aBcD4e", "navigate"], [base + "index.html", "navigate"], [base, "navigate"],
      [base + "js/main.js", "cors"], [base + "sw.js", "same-origin"], [base + "vendor/pdfjs/build/pdf.worker.min.js", "same-origin"],
      [base + "vendor/pdfjs/cmaps/Add-H.bcmap", "cors"], [base + "data/materials_catalog.json?x=1", "cors"]]) {
      assert.equal(await w.get(url, mode), false, url + ": passed through");
    }
    assert.equal(await w.get(base + "index.html", "navigate", "POST"), false);
    for (const [name, m] of w.stores) for (const k of m.keys()) assert.ok(!/\/takeoff\//.test(k), name + " keeps " + k);
    // the site's own pages as before (a name that only starts like the folder is no part of it)
    assert.equal(await w.get(new URL("search.html", scope).href, "navigate"), true);
    assert.equal(await w.get(new URL("takeoff.html", scope).href, "navigate"), true);
    assert.equal(await w.get(new URL("report-takeoff.html", scope).href, "navigate"), true);
  }
  // the takeoff copy's own caches are never the portal's to delete (and its worker deletes only "ptt-web-*")
  const w = portalWorker("https://portal.example.test/");
  w.stores.set("ptt-web-v16", new Map([["https://portal.example.test/takeoff/index.html", { ok: true }]]));
  w.stores.set("dcr-portal2-v4", new Map());
  await w.fire("activate", {});
  assert.ok(w.stores.has("ptt-web-v16"), "the takeoff copy's cache is left alone");
  assert.ok(!w.stores.has("dcr-portal2-v4"), "the portal's older cache goes");
  const tw = read("takeoff/sw.js");
  assert.match(tw, /n\.startsWith\('ptt-web-'\) && n !== CACHE/, "the copy's worker deletes only its own names");
  assert.match(tw, /const CACHE = 'ptt-web-v\d+';/);
});

/* ── where the takeoff app opens (map/plans.js) ──────────────────────────────────────────────────────────────── */

// made-up user agents of the kinds a phone, a tablet and a computer send
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  tabletDesktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};
const device = (ua, o) => {
  const x = o || {};
  return { navigator: Object.assign({ userAgent: ua, maxTouchPoints: x.touch || 0 }, x.mobile === undefined ? {} : { userAgentData: { mobile: x.mobile } },
    x.standalone ? { standalone: true } : {}),
  matchMedia: (q) => ({ matches: q === "(pointer: coarse)" ? !!x.coarse : q === "(display-mode: standalone)" ? !!x.standalone : false }) };
};

test("phones and tablets open the takeoff app in the frame (home-screen app and Safari alike), computers in a new tab; the switch turns the frame off", async () => {
  const P = await import("../site/js/map/plans.js");
  assert.equal(P.PLAN_FRAME, true, "the frame is on");
  const TABLE = [
    ["Safari on an iPhone", device(UA.iphone, { touch: 5, coarse: true }), "frame"],
    ["the iPhone home-screen app", device(UA.iphone, { touch: 5, coarse: true, standalone: true }), "frame"],
    ["an iPad that calls itself a Mac (Safari)", device(UA.mac, { touch: 5, coarse: true }), "frame"],
    ["an iPad that calls itself a Mac (home-screen app)", device(UA.mac, { touch: 5, coarse: true, standalone: true }), "frame"],
    ["an older iPad that says iPad", device(UA.ipadOld, { touch: 5, coarse: true }), "frame"],
    ["Chrome on an Android phone", device(UA.android, { touch: 5, coarse: true, mobile: true }), "frame"],
    ["Chrome on an Android tablet (userAgentData not mobile)", device(UA.androidTablet, { touch: 10, coarse: true, mobile: false }), "frame"],
    ["an Android tablet asking for the desktop site", device(UA.tabletDesktop, { touch: 10, coarse: true, mobile: false }), "frame"],
    ["Safari on a Mac (no touch)", device(UA.mac), "tab"],
    ["Edge on Windows", device(UA.winEdge, { mobile: false }), "tab"],
    ["Edge on a Windows touch laptop", device(UA.winEdge, { touch: 10, coarse: true, mobile: false }), "tab"],
    ["a Chromebook with a touch screen", device(UA.chromebook, { touch: 10, coarse: true, mobile: false }), "tab"],
    ["Linux with a touch screen and a mouse", device(UA.tabletDesktop, { touch: 10, coarse: false }), "tab"],
    ["nothing to go on", {}, "tab"],
    ["no window (node)", null, "tab"],
  ];
  for (const [label, win, want] of TABLE) {
    assert.equal(P.planRoute(win), want, label);
    assert.equal(P.handheld(win), want === "frame", label + " (handheld)");
    assert.equal(P.planRoute(win, false), "tab", label + ": the switch off");
  }
  assert.equal(P.handheld({ navigator: { userAgent: "odd", maxTouchPoints: 2 }, matchMedia() { throw new Error("made up"); } }), false, "a matchMedia that throws");
  // the portal's copy, beside the page, with the hand-over's word only (nothing of the plan in the address)
  assert.equal(P.TAKEOFF_FRAME, "takeoff/index.html");
  assert.equal(P.frameLink("Zk3pQ9_x-7LmN2aBcD4e"), "takeoff/index.html#portal=Zk3pQ9_x-7LmN2aBcD4e");
  assert.equal(new URL(P.frameLink("Zk3pQ9_x-7LmN2aBcD4e"), "https://portal.dcrframing.com/search.html").href,
    "https://portal.dcrframing.com/takeoff/index.html#portal=Zk3pQ9_x-7LmN2aBcD4e");
  for (const bad of ["short", "a b c d e f g h i j k l m", "x".repeat(65), "../../evil#portal=1234567890abcdef", ""]) assert.throws(() => P.frameLink(bad), bad);
  assert.ok(existsSync(join(SITE, P.TAKEOFF_FRAME)), "the copy is there");
  // the plan pages sit at the site's root (the frame's address is relative to them)
  for (const page of ["search.html", "project.html", "plans-library.html"]) assert.ok(existsSync(join(SITE, page)));
});

test("the hand-over's rules per device: the home-screen app is refused only when the frame is off; the frame's problems never send anyone to Safari", async () => {
  const H = await import("../site/js/plan-handoff.js");
  const ipadHome = device(UA.mac, { touch: 5, coarse: true, standalone: true });
  const iphoneSafari = device(UA.iphone, { touch: 5, coarse: true });
  assert.equal(H.iosHomeScreen(ipadHome), true, "still an iPad home-screen app");
  assert.equal(H.usesFrame(ipadHome), true);
  assert.equal(H.iosHomeRefused(ipadHome), false, "nothing refused: the frame shares the home-screen app's storage");
  assert.equal(H.usesFrame(iphoneSafari), true);
  assert.equal(H.usesFrame(device(UA.winEdge)), false);
  assert.equal(H.iosHomeRefused(device(UA.winEdge)), false);
  // the frame's no answer is the app's (offline before it was ever kept), never "use Safari"
  assert.match(H.handoffProblem({ ok: false, why: "no_answer", via: "frame" }, ipadHome), /did not answer/);
  assert.equal(H.handoffProblem({ ok: false, why: "ios_home", via: "tab" }), H.IOS_HOME);
  assert.equal(H.handoffProblem({ ok: false, why: "no_answer", via: "tab" }, ipadHome), H.IOS_HOME, "a tab from the home-screen app (the frame off)");
  assert.equal(H.handoffProblem({ ok: false, why: "closed", via: "frame" }), "", "the person closed it: nothing to say");
  assert.match(H.handoffProblem({ ok: false, why: "blocked", via: "frame" }), /Reload the page/);
  assert.match(H.handoffProblem({ ok: false, why: "blocked", via: "tab" }), /pop-ups/);
  assert.match(H.handoffProblem({ ok: false, why: "paused" }), /paused/);
  assert.match(H.handoffProblem({ ok: false, why: "busy", via: "frame" }), /open with changes that are not saved/);
  // a frame already open is replaced only when nothing would be lost (never a second frame over unsaved work)
  const fr = read("js/plan-frame.js");
  assert.match(fr, /if \(active && !closeIfIdle\(\)\) return null;/);
  assert.match(read("js/plan-handoff.js"), /if \(!peer\) \{ done\(\{ ok: false, why: frame\.isOpen\(\) \? "busy" : "blocked", via: "frame" \}\); return; \}/);
  // a second tap while the same plan is on its way is the same opening
  const lib = read("js/plan-library.js");
  assert.match(lib, /if \(itemId && opening\[key\]\) return;\s*opening\[key\] = true;\s*try \{ await openOnDeviceNow\(o, itemId, key, onDone, onStep\); \} finally \{ delete opening\[key\]; \}/);
  assert.equal(H.handoffProblem({ ok: false, why: "failed", error: new Error("made up") }), "made up");
});

/* ── the conversation (plan-handoff.js talk): one for the tab and the frame ──────────────────────────────────── */

const WORD = "Zk3pQ9_x-7LmN2aBcD4e";
const HERE = "https://portal.example.test";
function stage(via, origin) {
  const host = { ls: [], addEventListener(t, fn) { if (t === "message") this.ls.push(fn); }, removeEventListener(t, fn) { this.ls = this.ls.filter((x) => x !== fn); } };
  const win = { posted: [], postMessage(m, o) { this.posted.push({ m, o }); } };
  const peer = { win, origin, via, isClosed: false, closes: 0, closed() { return this.isClosed; }, close() { this.closes++; } };
  const said = [];
  const emit = async (ev) => { for (const fn of host.ls.slice()) fn(ev); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { host, win, peer, said, emit };
}
const ready = (s, over) => Object.assign({ source: s.win, origin: s.peer.origin, data: { type: "ptt-ready", v: 1, nonce: WORD } }, over || {});

test("the frame's messages: only from the frame's own window, from this site, protocol v1, with the word (accepted)", async () => {
  const H = await import("../site/js/plan-handoff.js");
  const F = await import("../site/js/plan-frame.js");
  const frameWin = { postMessage() {} };
  const peer = F.peerOf({ contentWindow: frameWin }, { origin: HERE });
  assert.deepEqual([peer.win === frameWin, peer.origin, peer.via], [true, HERE, "frame"], "the peer: the frame's window, this site's origin");
  const ok = { source: frameWin, origin: HERE, data: { type: "ptt-ready", v: 1, nonce: WORD } };
  assert.deepEqual(H.accepted(ok, peer, WORD), ok.data);
  const other = { postMessage() {} };
  for (const [label, ev] of [
    ["another window of this site (a second frame, the page itself)", Object.assign({}, ok, { source: other })],
    ["no window", Object.assign({}, ok, { source: null })],
    ["the takeoff app's own site (github.io) in this frame", Object.assign({}, ok, { origin: "https://barajas545.github.io" })],
    ["another site", Object.assign({}, ok, { origin: "https://evil.example" })],
    ["this site over http", Object.assign({}, ok, { origin: "http://portal.example.test" })],
    ["another word", Object.assign({}, ok, { data: Object.assign({}, ok.data, { nonce: "Zk3pQ9_x-7LmN2aBcD4f" }) })],
    ["no word", Object.assign({}, ok, { data: { type: "ptt-ready", v: 1 } })],
    ["protocol v2", Object.assign({}, ok, { data: Object.assign({}, ok.data, { v: 2 }) })],
    ["a string", Object.assign({}, ok, { data: "ptt-ready" })],
    ["nothing", Object.assign({}, ok, { data: null })],
  ]) assert.equal(H.accepted(ev, peer, WORD), null, label);
  assert.equal(H.accepted(null, peer, WORD), null);
  assert.equal(H.accepted(ok, null, WORD), null);
});

test("talk(): ready -> the plan, to the peer's origin only; a renewal answered for a link; the offline word noted; nothing from anyone else", async () => {
  const H = await import("../site/js/plan-handoff.js");
  for (const [via, origin] of [["frame", HERE], ["tab", "https://barajas545.github.io"]]) {
    const s = stage(via, origin);
    const file = new Blob(["PDFCACHE1 made up"]);
    let offline = 0;
    const plan = { kind: "file", file, name: "A900 Bid.takeoff", size: file.size, lastModified: 1, number: "A900", updateAvailable: false };
    const ctl = H.talk(s.peer, WORD, async () => plan, null, (r) => s.said.push(r), () => offline++, s.host);
    // a stranger's ready and a wrong word are ignored: nothing is posted
    await s.emit(ready(s, { source: { postMessage() {} } }));
    await s.emit(ready(s, { origin: origin === HERE ? "https://barajas545.github.io" : HERE }));
    await s.emit(ready(s, { data: { type: "ptt-ready", v: 1, nonce: "x".repeat(20) } }));
    assert.equal(s.win.posted.length, 0, via + ": nothing for a stranger");
    await s.emit(ready(s));
    assert.equal(s.win.posted.length, 1, via + ": the plan, once");
    const { m, o } = s.win.posted[0];
    assert.equal(o, origin, via + ": to the peer's origin, never '*'");
    assert.deepEqual(Object.assign({}, m, { file: null }), Object.assign({}, plan, { file: null, type: "ptt-open", v: 1, nonce: WORD }));
    assert.equal(m.file, file, "the File itself (nothing copied)");
    assert.ok(!("canSave" in m), "no canSave unless the plan says so and a save is taken (P4: tests/p8-plan-save.test.mjs)");
    assert.deepEqual(s.said, [{ ok: true, via, kind: "file" }]);
    await s.emit(ready(s));
    assert.equal(s.win.posted.length, 1, "a second ready posts nothing");
    await s.emit(ready(s, { data: { type: "ptt-renew", v: 1, nonce: WORD, req: "r1" } }));
    assert.equal(s.win.posted.length, 1, "a file is never renewed");
    await s.emit(ready(s, { data: { type: "ptt-offline", v: 1, nonce: WORD } }));
    assert.equal(offline, 1);
    assert.equal(s.host.ls.length, 0, via + ": a file's conversation ends at the offline word");
    ctl.stop();
    assert.equal(s.said.length, 1, "stopping after it opened says nothing more");
  }
  // a link: renewed for as long as the app is open, '' when there is none; a req longer than 20 is refused
  const s = stage("frame", HERE);
  const urls = ["https://made-up-my.sharepoint.com/fresh-1", ""];
  const link = H.talk(s.peer, WORD, async () => ({ kind: "link", url: "https://made-up-my.sharepoint.com/x", name: "B.takeoff", size: 5, lastModified: 0, number: "A1" }),
    async () => urls.shift(), (r) => s.said.push(r), null, s.host);
  await s.emit(ready(s));
  await s.emit(ready(s, { data: { type: "ptt-renew", v: 1, nonce: WORD, req: "r1" } }));
  await s.emit(ready(s, { data: { type: "ptt-renew", v: 1, nonce: WORD, req: "r2" } }));
  await s.emit(ready(s, { data: { type: "ptt-renew", v: 1, nonce: WORD, req: "r".repeat(21) } }));
  await s.emit(ready(s, { source: { postMessage() {} }, data: { type: "ptt-renew", v: 1, nonce: WORD, req: "r3" } }));
  assert.deepEqual(s.win.posted.slice(1).map((x) => [x.m.type, x.m.req, x.m.url, x.m.nonce, x.o]),
    [["ptt-link", "r1", "https://made-up-my.sharepoint.com/fresh-1", WORD, HERE], ["ptt-link", "r2", "", WORD, HERE]]);
  assert.equal(s.host.ls.length, 1, "a link's conversation lasts while the app is open");
  link.stop();                                               // the frame closed
  assert.equal(s.host.ls.length, 0);
  assert.deepEqual(s.said, [{ ok: true, via: "frame", kind: "link" }], "nothing more said once it had opened");
});

test("talk(): no answer in 90 s - said, then the peer closed (the frame only if nothing would be lost); a plan that fails; the person closing first", async (t) => {
  const H = await import("../site/js/plan-handoff.js");
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const a = stage("frame", HERE);
  const order = [];
  a.peer.close = function () { order.push("close"); };
  H.talk(a.peer, WORD, async () => ({ kind: "file" }), null, (r) => { order.push("said:" + r.why); }, null, a.host);
  t.mock.timers.tick(H.READY_WAIT_MS - 1);
  assert.deepEqual(order, []);
  t.mock.timers.tick(1);
  assert.deepEqual(order, ["said:no_answer", "close"], "said first: the frame's own close then cannot turn it into 'closed'");
  assert.equal(a.host.ls.length, 0);
  // the person closes the frame before the app said it is ready: "closed" (the menu says nothing), nothing more heard
  const c = stage("frame", HERE);
  const ctl = H.talk(c.peer, WORD, async () => ({ kind: "file" }), null, (r) => c.said.push(r), null, c.host);
  ctl.stop();
  assert.deepEqual(c.said, [{ ok: false, why: "closed", via: "frame" }]);
  assert.equal(c.host.ls.length, 0);
  // the tab closed by the person: noticed by the 5 s watch
  const d = stage("tab", "https://barajas545.github.io");
  H.talk(d.peer, WORD, async () => ({ kind: "file" }), null, (r) => d.said.push(r), null, d.host);
  d.peer.isClosed = true;
  t.mock.timers.tick(5000);
  assert.deepEqual(d.said, [{ ok: false, why: "closed", via: "tab" }]);
  t.mock.timers.reset();
  // the plan cannot be read: said, the peer closed, nothing posted
  const b = stage("frame", HERE);
  H.talk(b.peer, WORD, async () => { throw new Error("This saved plan is no longer on this device."); }, null, (r) => b.said.push(r), null, b.host);
  await b.emit(ready(b));
  assert.equal(b.win.posted.length, 0);
  assert.deepEqual([b.said[0].ok, b.said[0].why, b.said[0].error.message, b.peer.closes], [false, "failed", "This saved plan is no longer on this device.", 1]);
  b.host.ls.forEach(() => assert.fail("still listening"));
});

/* ── the frame (js/plan-frame.js) ────────────────────────────────────────────────────────────────────────────── */

test("the frame's Close: at once when nothing would be lost; asked while the app has unsaved changes or a save is in flight", async () => {
  const F = await import("../site/js/plan-frame.js");
  assert.equal(F.closeQuestion("", false), null);
  assert.equal(F.closeQuestion("", null), null, "no app in the frame yet (still loading, an offline page): closes at once");
  const dirty = F.closeQuestion("", true);
  assert.match(dirty.text, /not saved/);
  assert.equal(dirty.danger, true);
  // unsaved changes come first, whatever is in flight (review FRAME-1): the danger question, what is in flight after it
  const both = F.closeQuestion("Your save is being kept on this iPad.", true);
  assert.deepEqual([both.title, both.okText, both.danger], ["Close the takeoff app?", "Close without saving", true]);
  assert.match(both.text, /^This plan has changes that are not saved\..* Your save is being kept on this iPad\. Closing now does not stop it/);
  const busy = F.closeQuestion("Your save is being kept on this iPad.", false);
  assert.match(busy.title, /save is not finished/);
  assert.equal(busy.danger, false, "closing does not stop it (review WORDS-1)");
  assert.ok(!/Closing now stops it/.test(busy.text));
  // the app's own live objects (takeoff-web's window.TakeoffApp, "for the portal embed"), read defensively
  assert.equal(F.unsavedIn({ TakeoffApp: { app: { project: { dirty: true } } } }), true);
  assert.equal(F.unsavedIn({ TakeoffApp: { app: { project: { dirty: false } } } }), false);
  assert.equal(F.unsavedIn({}), null);
  assert.equal(F.unsavedIn(null), null);
  assert.equal(F.unsavedIn({ get TakeoffApp() { throw new Error("a page of another site (SecurityError)"); } }), null);
  assert.match(read("takeoff/js/main.js"), /window\.TakeoffApp = \{\s*app,/, "the vendored app still exposes it");
  // a save in flight (P4) registers a guard; unregistered, Close is free again
  const off = F.guard(() => "A save is being kept on this device.");
  assert.equal(typeof off, "function");
  off();
  // the visual viewport (iOS keyboard, a pinch): the frame takes its box
  assert.deepEqual(F.viewportBox({ offsetTop: 120.4, offsetLeft: 0, width: 834, height: 700.6 }), { top: 120, left: 0, width: 834, height: 701 });
  assert.equal(F.viewportBox(null), null);
  assert.equal(F.viewportBox({ width: 0, height: 0 }), null);
  assert.equal(F.isOpen(), false);
  assert.equal(F.open("takeoff/index.html#portal=" + WORD), null, "no page (node): nothing opens");
});

test("the copy's own worker is registered before its page loads in the frame (else the app reloads itself under the portal's worker and loses the word)", async () => {
  const F = await import("../site/js/plan-frame.js");
  const BASE = HERE + "/search.html?q=A900";
  const calls = [];
  const nav = (regs) => ({ serviceWorker: {
    getRegistration: async (u) => { calls.push(["get", u]); return regs[u] || regs[HERE + "/"] || undefined; },
    register: async (u, o) => { calls.push(["register", u, o.scope]); return { scope: o.scope }; } } });
  // none of its own yet (getRegistration answers the portal's, scope "/"): registered, the script and scope takeoff-web uses
  assert.deepEqual(await F.takeoffWorker(nav({ [HERE + "/"]: { scope: HERE + "/" } }), BASE), { scope: HERE + "/takeoff/" });
  assert.deepEqual(calls, [["get", HERE + "/takeoff/"], ["register", HERE + "/takeoff/sw.js", HERE + "/takeoff/"]]);
  assert.equal(new URL(F.TAKEOFF_SW, BASE).pathname, "/takeoff/sw.js");
  assert.ok(existsSync(join(SITE, F.TAKEOFF_SW)), "the copy's own worker is published");
  // already there: used as it is (no second update check)
  calls.length = 0;
  const mine = { scope: HERE + "/takeoff/" };
  assert.equal(await F.takeoffWorker(nav({ [HERE + "/takeoff/"]: mine }), BASE), mine);
  assert.deepEqual(calls, [["get", HERE + "/takeoff/"]]);
  // no workers here, or a refusal (offline, a private window): null, never a throw - the page loads anyway
  assert.equal(await F.takeoffWorker({}, BASE), null);
  assert.equal(await F.takeoffWorker({ serviceWorker: { register: async () => { throw new Error("made up"); } } }, BASE), null);
  assert.ok(F.WORKER_WAIT_MS >= 5000 && F.WORKER_WAIT_MS <= 30000, "time for a first install on a slow phone, but bounded");
  // ACTIVE first: an installing worker is waited for until it is activated (or fails, or the wait ends)
  const worker = () => {
    const ls = [];
    return { state: "installing", addEventListener: (t, fn) => ls.push(fn), removeEventListener: (t, fn) => ls.splice(ls.indexOf(fn), 1),
      go(state) { this.state = state; ls.slice().forEach((fn) => fn()); }, ls };
  };
  for (const end of ["activated", "redundant"]) {
    const w = worker();
    const reg = { scope: HERE + "/takeoff/", installing: w, active: null };
    let got = null;
    const p = F.activeOf(reg, 60000).then((r) => { got = r; });
    await new Promise((r) => setImmediate(r));
    assert.equal(got, null, "still installing: the page waits");
    w.go("installed");
    await new Promise((r) => setImmediate(r));
    assert.equal(got, null);
    if (end === "activated") reg.active = w;
    w.go(end);
    await p;
    assert.equal(got, reg, end);
    assert.equal(w.ls.length, 0, "its listener goes");
  }
  const slow = { scope: HERE + "/takeoff/", installing: worker(), active: null };
  assert.equal(await F.activeOf(slow, 5), slow, "a wait that ends: the page loads anyway");
  assert.equal(await F.activeOf(null, 5), null);
  const on = { active: {} };
  assert.equal(await F.activeOf(on, 5), on);
  // the vendored app does reload itself on a new controller - the reason for all this
  assert.match(read("takeoff/js/main.js"), /const hadController = !!navigator\.serviceWorker\.controller;/);
});

test("plan-frame.js: a same-site frame of the copy, over everything, with Close; the page under it held still; it never posts itself", () => {
  const src = read("js/plan-frame.js");
  const js = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  assert.ok(!/postMessage\(/.test(js), "the conversation is plan-handoff.js's alone");
  assert.match(js, /export const FRAME_ALLOW = "fullscreen; clipboard-write; web-share";/);
  assert.match(js, /frame\.setAttribute\("allow", FRAME_ALLOW\);/);
  // the copy's page only once its own worker is active (or after a while whatever happens)
  assert.match(js, /takeoffWorker\(navigator, location\.href\)\.then\(go, go\);\s*setTimeout\(go, WORKER_WAIT_MS \+ 500\);/);
  assert.match(js, /started = true;\s*if \(el\("ptfSay"\)\.textContent === READYING\) say\(""\);\s*frame\.src = String\(link\);/);
  assert.ok(!/sandbox|srcdoc|github\.io|https?:\/\//.test(js), "no other site, no inline document");
  assert.match(js, /const frame = document\.createElement\("iframe"\);/, "a new frame (a new window) each time");
  assert.match(js, /try \{ frame\.remove\(\); \}/);
  assert.match(js, /n\.inert = true;/, "the page under it out of reach of taps and focus");
  assert.match(js, /document\.body\.style\.overflow = "hidden";/, "and still");
  assert.match(js, /env\(safe-area-inset-top, 0px\)/, "the bar below the home-screen app's status bar");
  assert.match(js, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(js, /window\.visualViewport\.addEventListener\("resize", fit\)/, "it follows the on-screen keyboard");
  assert.match(js, /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); requestClose\(\); return; \}/);
  assert.match(js, /try \{ if \(a\.back && a\.back\.isConnected && a\.back\.focus\) a\.back\.focus\(\); \}/, "the focus goes back");
  assert.match(js, /z-index:100000;/);
  // the hand-over opens it with the copy's address and stops when it closes
  const ho = read("js/plan-handoff.js");
  assert.match(ho, /const peer = frame\.open\(frameLink\(word\), \{ title: \(opts && opts\.title\) \|\| "", onClose: function \(\) \{\s*if \(ctl\) ctl\.stop\(\);/);
  assert.ok(read("sw.js").includes('"js/plan-frame.js"'), "kept for offline use (the menu opens it with no signal)");
});

/* ── open on a phone or a tablet: on the device first (js/plan-library.js openOnDevice) ─────────────────────── */

test("a phone or a tablet opens a plan from a copy on the device: saved first, online only without room (and said so - also that a big plan may not save from there: MEM-1)", async () => {
  const L = await import("../site/js/map/plan-library.js");
  assert.equal(L.deviceOpenStep({ have: true, online: true, writable: true }), "fetch", "online: brought up to OneDrive's version first");
  assert.equal(L.deviceOpenStep({ have: false, online: true, writable: true }), "fetch", "not on the device: saved first");
  assert.equal(L.deviceOpenStep({ have: true, online: false, writable: true }), "open", "offline: the copy here, as it is");
  assert.equal(L.deviceOpenStep({ have: false, online: false, writable: true }), "offline");
  assert.equal(L.deviceOpenStep({ have: false, online: true, writable: false }), "online", "a browser that cannot keep plans");
  assert.equal(L.deviceOpenStep(null), "offline");
  for (const have of [true, false]) {
    assert.equal(L.afterFetch("space", have), "online", "no room: the newest, online");
    assert.equal(L.afterFetch("unsupported", have), "online");
    assert.equal(L.afterFetch("forbidden", have), "fail", "refused (prices taken away): nothing opens");
    assert.equal(L.afterFetch("removed", have), "fail");
  }
  for (const code of ["busy", "gone", "offline", "paused", "changed", "stopped", "busy_here", "not_plan", undefined]) {
    assert.equal(L.afterFetch(code, true), "open", code + ": the copy here");
    assert.equal(L.afterFetch(code, false), "fail", code + ": nothing here");
  }
  const lib = read("js/plan-library.js");
  const fn = lib.slice(lib.indexOf("export async function openOnDevice"));
  assert.match(fn, /res = r \? await resume\(itemId\)\s*: await save\(\{ projectId: o\.projectId, number: o\.number, projectTitle: o\.projectTitle, file: o\.file \}\);/,
    "the library's own download (its green bar)");
  assert.match(fn, /if \(!still\(\)\) \{ done\(\{ ok: false, why: "closed" \}\); return; \}/, "a menu closed meanwhile opens nothing");
  assert.match(fn, /const note = onlineNote\(why\);/);
  assert.match(L.onlineNote("space"), /^Not enough room on this device for this plan, so it opened online/);
  // and that a Save of a big plan may not work from there (the app's Save of a plan opened online reads it whole into
  // memory: review MEM-1) - what to do instead
  assert.match(L.onlineNote("space"), /Saving may not work from there for a big plan - free some room, then open it again from the Plans Library so this device keeps it before you save\.$/);
  assert.match(L.onlineNote("unsupported"), /^This browser cannot keep plans on the device, so it opened online/);
  assert.match(fn, /openOnline\(o\.projectId, o\.number, \{ id: itemId \}/);
  assert.ok(fn.indexOf("open(itemId,") !== -1, "then the file itself");
  // the save back (P4): offered only in the frame, to a person who may save back (tests/p8-plan-save.test.mjs)
  assert.match(lib, /const offer = frame && saveBackFor\(o\.me\);/);
  assert.match(fn, /open\(itemId, function \(res\) \{ done\(note \? Object\.assign\(\{ note \}, res\) : res\); \}, \{ title, me: o\.me \}\);/);
});

test("the home-screen refusals are lifted on the frame path only: saving, resuming and the automatic downloads; the 📐 menu and the library page say IOS_HOME only with the frame off", () => {
  const lib = read("js/plan-library.js");
  assert.equal((lib.match(/if \(iosHomeRefused\(\)\) throw err\("ios_home", IOS_HOME\);/g) || []).length, 2, "save() and resume()");
  assert.match(lib, /if \(o\.download !== false && !iosHomeRefused\(\)\) await autoWork\(\);/);
  assert.ok(!/iosHomeScreen\(\)/.test(lib), "no refusal left that ignores the frame");
  const pb = read("js/pages/plan-buttons.js");
  assert.match(pb, /const ios = iosHomeRefused\(\);/);
  assert.ok(!/iosHomeScreen/.test(pb));
  assert.match(pb, /if \(usesFrame\(\)\) \{[\s\S]*?L\.openOnDevice\(\{ projectId: c\.o\.projectId,[\s\S]*?still: function \(\) \{ return current === c; \}, me: c\.o\.me \}/);
  const page = read("js/pages/plans-library.js");
  assert.match(page, /if \(iosHomeRefused\(\)\) \{/);
  assert.match(page, /if \(!iosHomeRefused\(\)\) L\.autoWork\(\);/);
  assert.match(page, /if \(usesFrame\(\)\) \{[\s\S]*?L\.openOnDevice\(/);
  assert.ok(!/iosHomeScreen/.test(page));
});

/* ── the doors of a phone or a tablet: the 📐 menu or the Plans Library, never the Plans Archive ────────────────── */

test("the 📐 button on a phone or a tablet: the menu for the people who see prices, 'Plans are for the people who see prices' for anyone else; a computer's as before", async () => {
  const P = await import("../site/js/map/plans.js");
  const { menuText } = await import("../site/js/pages/plan-buttons.js");
  const e = { number: "A900", plans: 3 };
  const pc = P.planButtonHtml(e, "icon");
  assert.match(pc, /href="https:\/\/barajas545\.github\.io\/takeoff-web\/index\.html#plans=A900" target="_blank" rel="noopener"/, "a computer: the Plans Archive");
  assert.equal(P.planButtonHtml(e, "icon", false, false), pc);
  const none = P.planButtonHtml(e, "button", false, true);
  assert.match(none, /^<a class="pj-btn" href="plans-library\.html" aria-label="Plans for A900" title="3 takeoff files for A900" data-plan-none="A900" aria-haspopup="dialog">/);
  assert.ok(!/github\.io|target=|↗/.test(none), "no dead end, no new tab");
  const menu = P.planButtonHtml(e, "icon", true, true);
  assert.match(menu, /href="plans-library\.html" aria-label="Plans for A900 — open or save the plan files"/);
  assert.match(menu, /data-plan-menu="A900" aria-haspopup="dialog"/);
  assert.ok(!/github\.io|target=/.test(menu));
  assert.equal(P.planButtonHtml({ number: "A900", plans: 0 }, "icon", false, true), "");
  assert.equal(P.PRICES_ONLY, "Plans are for the people who see prices: plan files carry prices.");
  // the menu's words: no Plans Archive at a phone's foot
  const m = menuText("A900", false, false), h = menuText("A900", true, false), n = menuText("A900", true, true);
  assert.match(m.foot, /Plans Archive \(Edge or Chrome on a computer\) ↗/);
  assert.match(m.foot, /#plans=A900/);
  assert.equal(h.foot, '<a href="plans-library.html">Plans Library</a>');
  assert.match(h.lead, /on this device first \(the green bar\)/);
  assert.deepEqual(n, { lead: P.PRICES_ONLY, foot: "" });
  const pb = read("js/pages/plan-buttons.js");
  assert.match(pb, /const html = planButtonHtml\(got\[s\.getAttribute\("data-plans"\)\], s\.getAttribute\("data-plans-style"\), menu, hand\);/);
  assert.match(pb, /closest\("\[data-plan-menu\], \[data-plan-none\]"\)/);
  assert.match(pb, /if \(o\.none\) return;/, "the plain sentence: no broker call, no library");
  assert.match(pb, /if \(current !== c \|\| frameOpen\(\)\) return;/, "the frame's keys are its own");
});

test("the Floor Plans card and the Takeoffs tab on a phone or a tablet: the Plans Library and the project's 📐; a computer's as before", async () => {
  const P = await import("../site/js/map/plans.js");
  assert.deepEqual(P.floorPlansCard(false), { href: P.PLANS_HOME, ext: true, ds: "Open plans in the takeoff app — the Plans Archive and the plans kept on this device." });
  assert.deepEqual(P.floorPlansCard(true), { href: "plans-library.html", ext: false, ds: "Open plans on this device: the Plans Library, or 📐 on a project." });
  const tk = read("js/pages/project-takeoffs.js");
  assert.match(tk, /import \{ openPlans \} from "\.\/plan-buttons\.js";/);
  assert.match(tk, /const hand = handheld\(typeof window !== "undefined" \? window : null\);/);
  assert.match(tk, /id="tkoPlans" aria-haspopup="dialog"/);
  assert.match(tk, /openPlans\(\{ projectId: ctx\.pid,/);
  assert.match(tk, /📐 Plans Archive \(takeoff-web\) ↗/, "a computer keeps its link");
  const pb = read("js/pages/plan-buttons.js");
  assert.match(pb, /export function openPlans\(o\) \{\s*openMenu\(Object\.assign\(\{\}, o, \{ none: !planFilesFor\(o\.me\) \}\)\);\s*\}/);
});

test("the pages that show the frame name it in their policy (frame-src 'self': this site only) and nothing else changes; no github.io anywhere in a policy", () => {
  for (const page of ["search.html", "project.html", "plans-library.html"]) {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read(page))[1];
    assert.match(csp, /; frame-src 'self';/, page);
    assert.ok(!/github\.io|child-src/.test(csp), page);
  }
  for (const page of ["dashboard.html", "index.html", "settings.html"]) {
    assert.ok(!/frame-src/.test(read(page)), page + ": shows no frame");
  }
});

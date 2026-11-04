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
  "connect-src 'self' " + ONEDRIVE + "; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'";
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

test("the moved UI-mode boot (--allow-inline-boot, until takeoff-web's P2 commit is vendored): the page's words, loaded where they stood, in the app's offline program", () => {
  const html = read("takeoff/index.html");
  if (!VERSION.inlineBootMoved) {
    assert.ok(!(V.BOOT_FILE in VERSION.edits), "no boot made here");
    return;
  }
  assert.ok(existsSync(join(TAKEOFF, V.BOOT_FILE)));
  const at = html.indexOf('<script src="' + V.BOOT_FILE + '"></script>');
  assert.ok(at > 0 && at < html.indexOf('<link rel="stylesheet"'), "a classic script before the stylesheet paints");
  assert.match(read("takeoff/" + V.BOOT_FILE), /document\.documentElement\.dataset\.ui = /);
  assert.match(read("takeoff/sw.js"), /'index\.html',\n\s*'js\/ui-mode-boot\.js',/);
  assert.match(VERSION.edits["sw.js"], /PROGRAM/);
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

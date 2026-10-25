// Part 4: the Files tab's OneDrive part in the page sources - what is loaded where (the uploader and the rules with
// project.html, the admin's self-test only when clicked and never kept on a phone), the go-live switch, what is never
// done (photos into OneDrive, a sign-in header on a chunk, an Edge Function called from a page), the demo's parts
// registered in the dev server and the test loader, and the demo server serving the OneDrive part switched on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onedriveLive } from "../tools/devserve.mjs";

const read = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

test("the Files tab loads the broker module, the rules and the uploader; the self-test only on a click (an admin's, A000T2)", () => {
  const files = code(read("site/js/pages/project-files.js"));
  for (const m of ["../repo/onedrive.js", "../map/onedrive.js", "../onedrive-upload.js"]) {
    assert.match(files, new RegExp('^import [^\\n]*from "' + m.replace(/[.]/g, "\\.") + '";', "m"), m);
  }
  assert.ok(!/^import [^\n]*onedrive-selftest/m.test(files), "no static import of the self-test");
  assert.match(files, /import\("\.\/onedrive-selftest\.js"\)/);
  assert.match(files, /onedrive\.selfTestFor\(ctx\.me, ctx\.project\)/, "the button only for an admin on the test project");
  assert.match(files, /st\.odOn = onedrive\.shownFor\(ctx\.me, ctx\.project\)/, "the OneDrive part only while LIVE (or the admin's test project)");
  for (const f of ["site/js/pages/project.js", "site/js/pages/project-files.js", "site/js/onedrive-upload.js", "site/js/map/onedrive.js", "site/sw.js"]) {
    assert.ok(!/^import [^\n]*onedrive-selftest/m.test(read(f)), f);
  }
  const self = code(read("site/js/pages/onedrive-selftest.js"));
  const run = self.slice(self.indexOf("export async function run("));
  assert.ok(run.indexOf("onedrive.selfTestFor(ctx.me, ctx.project)") !== -1 && run.indexOf("selfTestFor") < run.indexOf("onedrive.status()"),
    "the self-test refuses for anybody else before it asks anything");
});

test("sw.js keeps the OneDrive part's code (project.html loads it) and never the admin's self-test", () => {
  const sw = read("site/sw.js");
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  for (const f of ["js/repo/onedrive.js", "js/map/onedrive.js", "js/onedrive-upload.js", "js/scrub-money.js"]) assert.ok(shell.includes(f), f);
  assert.ok(!shell.includes("js/pages/onedrive-selftest.js"), "the self-test is an admin's: not on every phone");
});

test("the OneDrive part never: a photo into OneDrive, a sign-in on a chunk, a function called from the page, the host named outside repo/", () => {
  const files = read("site/js/pages/project-files.js");
  const od = files.slice(files.indexOf("the OneDrive project folder ─"), files.indexOf("/* ── capture"));
  assert.ok(!/capture=/.test(od), "no camera button in the OneDrive part (photos and voice notes keep the capture bar, D9)");
  assert.match(files, /id="capPhotoIn" accept="image\/\*" capture="environment"/, "the capture bar is unchanged");
  assert.match(od, /OD\.targetChoices\(/, "the target is Documents or Floor Plans (map/onedrive.js targetChoices)");
  assert.ok(!/functions\.invoke|\.rpc\(|\.from\(/.test(code(od)));
  assert.ok(!/sharepoint|netorgft/i.test(files + read("site/js/onedrive-upload.js") + read("site/js/pages/onedrive-selftest.js")), "only repo/onedrive.js names the host");
  assert.match(code(read("site/js/onedrive-upload.js")), /headers: \{ "Content-Range": plan\.range \}/, "a chunk carries its range and nothing else");
  assert.match(code(read("site/js/pages/onedrive-selftest.js")), /headers: \{ "Content-Range": plan\.range \}/);
  // the link is opened at once, never kept; a demo blob is saved under its name
  assert.match(od, /a\.href = link\.url;/);
  assert.ok(!/st\.od\.[a-z]+ = link|od\.link =/.test(od));
});

test("the live files watch hands its event to the Files tab (the OneDrive box reads again for a OneDrive row only, later)", () => {
  assert.match(read("site/js/pages/project.js"), /live\.watch\("files", f, function \(evt\) \{\s*filesTab\.reload\(ctx, evt\);/);
  const files = code(read("site/js/pages/project-files.js"));
  assert.match(files, /export function reload\(ctx, evt\)/);
  assert.match(files, /row\.storage !== "local"/);
  assert.match(files, /OD_LIVE_MS = 5000/);
});

test("LIVE: the published module ships with the OneDrive part off; the demo server serves it on (and --onedrive-off as published)", () => {
  const src = read("site/js/repo/onedrive.js");
  assert.match(src, /^export const LIVE = false;$/m);
  const served = onedriveLive(src);
  assert.match(served, /^export const LIVE = true;/m);
  assert.equal(served.replace(/export const LIVE = true;[^\n]*/, "export const LIVE = false;"), src, "nothing else is changed");
  const dev = read("tools/devserve.mjs");
  assert.match(dev, /"p5c-sales\.js", "p7-onedrive\.js", "engine\.js"/, "the demo's broker before engine.js");
  assert.match(dev, /path === "\/js\/repo\/onedrive\.js"\) body = onedriveLive/);
  assert.match(read("tests/pages-engine.mjs"), /p7-onedrive\.js/);
  // the published site never names the demo
  for (const f of ["site/js/repo/onedrive.js", "site/js/pages/project-files.js", "site/js/onedrive-upload.js", "site/js/pages/onedrive-selftest.js", "site/js/map/onedrive.js"]) {
    assert.ok(!/__dev\/|fake-supabase|DCR2Fake|DCR2Demo|p7-onedrive/.test(read(f)), f);
  }
});

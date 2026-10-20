// PROJECT-PAGES: the static rules every project page keeps (BLUEPRINT 2.2.1, Appendix C):
// the security policy meta tag, no inline script or on…= handler, scripts only from this site or
// jsDelivr at an exact version, Portal 2's own browser-side names (never the old portal's), no demo
// code, data access only through repo/ + map/ (no direct supabase calls in the page scripts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SITE = new URL("../site/", import.meta.url);
const PAGES = ["board.html", "project.html", "search.html", "logs.html", "capture.html", "report-journal.html"];
const read = (rel) => readFileSync(new URL(rel, SITE), "utf8");
const jsFiles = (dir) => readdirSync(new URL(dir, SITE)).filter((f) => f.endsWith(".js")).map((f) => dir + f);
const MINE = jsFiles("js/pages/").concat(jsFiles("js/repo/"), jsFiles("js/map/"));

test("pages: the security policy is on every page, without unsafe-inline scripts", () => {
  for (const p of PAGES) {
    const html = read(p);
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    assert.ok(m, p + ": no CSP meta tag");
    const csp = m[1];
    const script = /script-src ([^;]+)/.exec(csp)[1];
    assert.ok(!/unsafe-inline|unsafe-eval/.test(script), p + ": script-src allows inline code");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /connect-src [^;]*https:\/\/[a-z0-9]+\.supabase\.co/);
    assert.match(csp, /connect-src [^;]*wss:\/\/[a-z0-9]+\.supabase\.co/);
    assert.match(csp, /object-src 'none'/);
  }
});

test("pages: no inline script and no inline handler", () => {
  for (const p of PAGES) {
    const html = read(p);
    const scripts = html.match(/<script\b[^>]*>/g) || [];
    for (const s of scripts) assert.match(s, /\ssrc="/, p + ": inline <script>: " + s);
    assert.ok(!/<script\b[^>]*>[^<]+<\/script>/.test(html), p + ": a script tag with a body");
    assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), p + ": an inline on…= handler");
    assert.ok(!/javascript:/i.test(html), p + ": a javascript: URL");
  }
  for (const f of MINE) {
    const js = read(f);
    assert.ok(!/\son[a-z]+=\\?["']/.test(js.replace(/\/\*[\s\S]*?\*\//g, "")), f + ": builds an inline handler into HTML");
    assert.ok(!/\beval\(|new Function\(/.test(js), f + ": eval");
  }
});

test("pages: scripts come from this site or jsDelivr at an exact version", () => {
  for (const p of PAGES) {
    const html = read(p);
    for (const m of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) {
      const src = m[1];
      if (/^https?:/.test(src)) assert.match(src, /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/@]+\/)?[^@/]+@\d+\.\d+\.\d+\//, p + ": " + src);
      else assert.ok(!src.startsWith("/") && !src.startsWith("//"), p + ": " + src);
    }
    assert.match(html, /<script src="js\/config\.js"><\/script>/, p + ": config.js");
    assert.match(html, /<script type="module" src="js\/pages\/[a-z-]+\.js"><\/script>/, p + ": the page module");
  }
});

test("pages: Portal 2's own browser-side names, never the old portal's", () => {
  const OLD = ["dcr_portal_token", "dcrJrnDraft:", "dcrCityGeo", "\"dcrUploads\"", "dcr-portal-single-instance", "dcr_theme\"",
    "dcrPlanRecent", "dcr-portal-v"];
  for (const f of MINE.concat(PAGES)) {
    const s = read(f);
    for (const o of OLD) assert.ok(s.indexOf(o) === -1, f + " uses the old portal's " + o);
  }
  assert.match(read("js/pages/project-journal.js"), /dcr2JrnDraft:/);
  assert.match(read("js/pages/capture.js"), /dcr2CityGeo/);
});

test("pages: no demo code and no switch that turns it on", () => {
  for (const f of MINE.concat(PAGES)) {
    const s = read(f);
    assert.ok(!/DCR2Fake|fake-supabase|tools\/fake|devserve/i.test(s), f + " mentions the demo fake");
  }
});

test("pages: page scripts reach the data only through repo/ and map/ (and the shared queue / live)", () => {
  for (const f of jsFiles("js/pages/")) {
    const s = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\.from\(\s*["'][a-z_]+["']\s*\)/.test(s), f + ": a table read outside repo/");
    assert.ok(!/\.rpc\(/.test(s), f + ": an RPC outside repo/");
    assert.ok(!/\bsb\(\)/.test(s), f + ": the client used directly");
  }
});

test("pages: the old portal's status spellings are never shown", () => {
  for (const f of jsFiles("js/pages/").concat(PAGES)) {
    const s = read(f);
    assert.ok(!/["'>](Recived|Aproved)["'<]/.test(s), f + " shows an old spelling");
  }
});

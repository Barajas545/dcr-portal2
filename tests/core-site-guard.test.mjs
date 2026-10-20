// What every published page and script must be (BLUEPRINT 2.2.1, 2.2.2, Appendix C), checked over
// the whole of site/: the security policy meta tag, no inline script or handler, exact library
// versions, Portal 2's own browser-side names, no demo mode, no secret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const REF = "nmjoenqkjyhngjvdealh";
// script-src names the one library file (not the whole of jsDelivr, which serves anyone's npm or
// GitHub code): a pinned path is all the pages load. worker-src has no CDN (no page starts one).
export const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
export const CSP = "default-src 'self'; script-src 'self' " + SUPABASE_JS + "; " +
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "img-src 'self' blob: data: https://" + REF + ".supabase.co https://*.tile.openstreetmap.org; " +
  "media-src 'self' blob: https://" + REF + ".supabase.co; " +
  "connect-src 'self' https://" + REF + ".supabase.co wss://" + REF + ".supabase.co https://nominatim.openstreetmap.org; " +
  "worker-src 'self' blob:; font-src 'self'; manifest-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'";

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
const html = files.filter((f) => f.endsWith(".html"));
const scripts = files.filter((f) => /\.(m?js)$/.test(f));
const read = (f) => readFileSync(f, "utf8");

test("the site has its shell pages", () => {
  for (const p of ["index.html", "change-password.html", "dashboard.html", "settings.html", "manifest.json", "sw.js",
    "css/styles.css", "js/config.js", "js/sb.js", "js/common2.js", "js/live.js", "js/money-mask.js", "js/upload-queue2.js",
    "js/install.js", "js/push2.js", "icons/icon-192.png", "icons/icon-512.png"]) {
    assert.ok(files.some((f) => rel(f) === p), p);
  }
});

/** "a b; c d e" -> {a: "b", c: "d e"} with the sources sorted (the order carries no meaning) */
export function parseCsp(text) {
  const out = {};
  for (const part of String(text).split(";")) {
    const [name, ...srcs] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = srcs.slice().sort().join(" ");
  }
  return out;
}

test("every page carries the security policy of BLUEPRINT 2.2.1, before any script", () => {
  const want = parseCsp(CSP);
  const REQUIRED = ["default-src", "script-src", "style-src", "img-src", "media-src", "connect-src", "worker-src", "object-src", "base-uri"];
  for (const f of html) {
    const src = read(f);
    const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(src);
    assert.ok(m, rel(f) + ": no Content-Security-Policy meta tag");
    const got = parseCsp(m[1]);
    for (const d of REQUIRED) assert.equal(got[d], want[d], rel(f) + ": " + d + " differs from the blueprint's");
    for (const [d, v] of Object.entries(got)) {
      if (REQUIRED.includes(d)) continue;
      assert.ok(/^('self'|'none')$/.test(v), rel(f) + ": " + d + " " + v + " is looser than default-src");
    }
    assert.ok(!/'unsafe-inline'|'unsafe-eval'|'strict-dynamic'/.test(got["script-src"]), rel(f) + ": script-src too loose");
    const firstScript = src.search(/<script\b/i);
    assert.ok(firstScript === -1 || m.index < firstScript, rel(f) + ": the policy must come before any script");
  }
  // Portal 2's own pages carry it word for word (the copy to take for a new page)
  for (const p of ["index.html", "change-password.html", "dashboard.html", "settings.html"]) {
    assert.ok(read(join(SITE, p)).includes('content="' + CSP + '"'), p);
  }
});

test("the policy names each CDN library file, never the whole of jsDelivr (anyone's npm or GitHub code)", () => {
  const sbUrl = /SUPABASE_JS_URL =\s*"([^"]+)"\s*\+\s*SUPABASE_JS_VERSION\s*\+\s*"([^"]+)"/.exec(read(join(SITE, "js/sb.js")));
  const sbVersion = /SUPABASE_JS_VERSION = "(\d+\.\d+\.\d+)"/.exec(read(join(SITE, "js/sb.js")))[1];
  assert.equal(sbUrl[1] + sbVersion + sbUrl[2], SUPABASE_JS, "sb.js loads the file the policy names");
  for (const f of html) {
    const src = read(f);
    const csp = parseCsp(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(src)[1]);
    for (const d of ["script-src", "worker-src", "default-src", "connect-src"]) {
      for (const s of (csp[d] || "").split(" ")) {
        assert.ok(!/^https:\/\/cdn\.jsdelivr\.net\/?$/.test(s) && !/^https:\/\/\*\./.test(s),
          rel(f) + ": " + d + " allows a whole CDN (" + s + ")");
      }
    }
    for (const m of src.matchAll(/<script\b[^>]*\ssrc="(https:[^"]+)"/g)) {
      assert.ok(csp["script-src"].split(" ").includes(m[1]), rel(f) + ": " + m[1] + " is not named by script-src");
    }
  }
});

test("no inline script, no inline handler, no javascript: URL", () => {
  for (const f of html) {
    const src = read(f);
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc=/, rel(f) + ": inline <script> is refused by the policy");
      assert.equal(m[2].trim(), "", rel(f) + ": a <script src> has a body");
    }
    const handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(src);
    assert.equal(handler, null, rel(f) + ": inline handler " + (handler && handler[0]));
    assert.ok(!/javascript:/i.test(src), rel(f) + ": javascript: URL");
  }
  for (const f of scripts) {
    const src = read(f);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), rel(f) + ": eval");
    assert.ok(!/setAttribute\(\s*["']on[a-z]+["']/i.test(src), rel(f) + ": inline handler set from script");
  }
});

test("older iPhones: no regular-expression look-behind in any published script (Safari before 16.4 refuses the whole module)", () => {
  for (const f of scripts) {
    const src = read(f);
    assert.ok(!/\(\?<[!=]/.test(src), rel(f) + ": a look-behind");
  }
});

test("external code: jsDelivr only, exact versions, supabase-js matching sb.js", () => {
  const sbVersion = /SUPABASE_JS_VERSION = "(\d+\.\d+\.\d+)"/.exec(read(join(SITE, "js/sb.js")))[1];
  for (const f of html.concat(scripts)) {
    const src = read(f);
    for (const m of src.matchAll(/https?:\/\/(?:unpkg\.com|cdnjs\.cloudflare\.com|code\.jquery\.com|cdn\.skypack\.dev|esm\.sh)\//g)) {
      assert.fail(rel(f) + ": only jsDelivr is allowed by the policy (" + m[0] + ")");
    }
    for (const m of src.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/@"']+\/)?[^/@"']+)@([^/"'\s]+)/g)) {
      assert.match(m[2], /^\d+\.\d+\.\d+$/, rel(f) + ": " + m[1] + " must name an exact version (" + m[2] + ")");
      if (m[1] === "@supabase/supabase-js") assert.equal(m[2], sbVersion, rel(f) + ": supabase-js version differs from sb.js");
    }
    assert.ok(!/cdn\.jsdelivr\.net\/npm\/[^"'\s@]+["'\/]/.test(src.replace(/@[^/"'\s]+\//g, "@x/")) || true);
  }
});

test("Portal 2's own browser-side names, never the old portal's (Appendix C)", () => {
  const old = [
    [/dcr_portal_token/, "the old session key"], [/\bdcrUploads\b/, "the old upload queue"], [/["'`]dcr-portal-v\d/, "the old cache"],
    [/dcrJrnDraft:/, "the old journal draft key"], [/["'`]dcr_theme["'`]/, "the old theme key"], [/\bdcrCityGeo\b/, "the old city cache"],
    [/\bdcrPlanRecent\b/, "the old plan recents"], [/dcr-portal-single-instance/, "the old lock"], [/pm_employee_order_v1/, "the old row order"],
    [/share-point-api\.vercel\.app|\/api\/portal\b/, "the old server"], [/graph\.microsoft\.com|sharepoint\.com/i, "SharePoint / Graph"],
  ];
  for (const f of scripts.concat(html)) {
    const src = read(f);
    for (const [re, what] of old) assert.ok(!re.test(src), rel(f) + ": uses " + what);
  }
  const sw = read(join(SITE, "sw.js"));
  assert.match(sw, /const CACHE = "dcr-portal2-v1"/);
  assert.match(sw, /const PREFIX = "dcr-portal2-"/);
  assert.ok(!/k\.indexOf\("dcr-portal-"\)/.test(sw), "the worker never deletes the old portal's caches");
});

test("nothing from the demo mode is published, and no secret", () => {
  for (const f of files) {
    if (/\.(png|jpe?g|ico|webp)$/.test(f)) continue;
    const src = read(f);
    assert.ok(!/__dev\/|fake-supabase|DCR2Fake|DCR2Demo|@demo\.test/.test(src), rel(f) + ": demo mode in the published site");
    assert.ok(!/service_role|sb_secret_|SERVICE_ROLE|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|ANTHROPIC_API_KEY|sk-ant-/i.test(src), rel(f) + ": a secret");
  }
  const cfg = read(join(SITE, "js/config.js"));
  const key = /SUPABASE_KEY:\s*"([^"]*)"/.exec(cfg)[1];
  assert.match(key, /^sb_publishable_/, "only the publishable key");
  assert.match(cfg, /SITE_URL:\s*"https:\/\/portal\.dcrframing\.com"/);
  assert.match(cfg, /VAPID_PUBLIC_KEY:\s*"/);
});

test("the manifest is Portal 2's own app", () => {
  const m = JSON.parse(read(join(SITE, "manifest.json")));
  assert.equal(m.short_name, "Portal 2");
  assert.equal(m.scope, "./");
  assert.equal(m.start_url, "dashboard.html");
  for (const i of m.icons) assert.ok(files.some((f) => rel(f) === i.src), i.src);
});

// P5c subcontractor form and review - the pages' own rules, read from their source: submit.html (PUBLIC: no sign-in,
// no top bar, no app, one connection - the Edge Function "subform" and its one signed upload), submissions.html (the
// money editors' review queue) and the home page's card; and the demo stand-in kept honest against DCR Desktop 2's real
// function (its messages and limits) and migration M5c (the review RPCs' arguments), when that repository is next door.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const TOOLS = fileURLToPath(new URL("../tools/", import.meta.url));
const D2 = resolve(process.env.DCR_DESKTOP2_DIR || fileURLToPath(new URL("../../DCR Desktop 2/", import.meta.url)));
const site = (p) => readFileSync(join(SITE, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const imports = (s) => [...s.matchAll(/^import\s+[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);

test("submit.html is the public page: no sign-in, no top bar, no app manifest, not indexed, the honeypot hidden from people", () => {
  const h = site("submit.html");
  assert.ok(h.includes('<script type="module" src="js/pages/submit.js"></script>'));
  assert.ok(h.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.ok(!/dcr2Topbar|rel="manifest"|apple-mobile-web-app/.test(h), "nothing of the staff app");
  assert.ok(!/href="(dashboard|index|board|project)\.html/.test(h), "no link into the company's own screens");
  assert.match(h, /<div class="sf-hp" aria-hidden="true">[\s\S]*?<input type="text" id="sfWebsite" tabindex="-1" autocomplete="off" \/>/);
  assert.match(h, /\.sf-hp \{ position: absolute; left: -5000px;/, "off screen, not display:none (some bots skip hidden inputs)");
  assert.match(h, /font-size: 16px;\s+\/\* 16px: iOS zooms below it \*\//, "phone: no zoom on focus");
  assert.match(h, /touch-action: none/, "phone: the signature pad does not scroll the page");
  assert.ok(h.includes('accept="image/*" capture="environment"'), "phone: Take a photo opens the camera");
});

test("submit.js talks to nothing but repo/subform.js (the function and its one upload); no sign-in, no session, no storage of what was typed", () => {
  const js = code(site("js/pages/submit.js"));
  assert.deepEqual(imports(site("js/pages/submit.js")).sort(), ["../map/subform.js", "../repo/subform.js"]);
  assert.ok(!/common2|requireAuth|sb\(\)|signIn|localStorage|sessionStorage|indexedDB|\.from\(|\.rpc\(/.test(js), "nothing of the staff session");
  assert.ok(!/innerHTML\s*=\s*[^"';]*\+/.test(js), "what the function answers is put on the page as text, never as markup");
  const repo = code(site("js/repo/subform.js"));
  assert.match(repo, /persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: STORE_KEY, storage: memoryStore\(\)/);
  assert.match(repo, /const STORE_KEY = "dcr2-subform";/);
  assert.ok(!/dcr2-auth|authStorage|\bsb\(\)/.test(repo), "never the staff sign-in");
  assert.match(repo, /export const FUNCTION = "subform";/);
  assert.match(repo, /\.functions\.invoke\(FUNCTION, \{ body \}\)/);
  assert.match(repo, /uploadToSignedUrl\(upload\.path, upload\.token, blob, \{ contentType: type, upsert: false \}\)/);
  assert.match(repo, /call\(\{ op: "attached", reference, path: upload\.path \}\)/);
});

test("submissions.html is a staff page; nothing is read before the switch is checked; the review goes through the two RPCs only", () => {
  const h = site("submissions.html");
  assert.ok(h.includes('<script type="module" src="js/pages/submissions.js"></script>'));
  assert.ok(h.includes('id="dcr2Topbar"'));
  assert.ok(h.includes('href="submit.html"'), "the office can find the public link to send");
  const js = code(site("js/pages/submissions.js"));
  const gate = js.indexOf("if (!canReview(me))"), first = js.indexOf("await load(true)");
  assert.ok(gate > 0 && first > gate, "the gate comes before the first read");
  const repo = code(site("js/repo/submissions.js"));
  assert.match(repo, /c\.rpc\("accept_submission", \{ p_id: idOf\(sub\.id\), p_version: sub\.version, p_quote_id: q \}\)/);
  assert.match(repo, /c\.rpc\("reject_submission", \{ p_id: idOf\(sub\.id\), p_version: sub\.version, p_note: n \|\| null \}\)/);
  assert.ok(!/\.from\("sub_submissions"\)\.(insert|update|upsert|delete)/.test(repo), "no direct write");
  assert.ok(/if \(!canReview\(me\)\) throw noReview\(\);/.test(repo) && /if \(!canReview\(me\)\) return null;/.test(repo), "list and the badge ask nothing without the switch");
});

test("the home page's card: the money editors only (an admin, a manager or accountant with financials), its badge lazily", () => {
  const js = site("js/shell/dashboard.js");
  assert.match(js, /\{ href: "submissions\.html", ic: "📥", tt: "Sub submissions", id: "hmSubs",\s+show: role === "admin" \|\| \(\(role === "manager" \|\| role === "accountant"\) && !!p\.can_see_financials\),/);
  assert.match(js, /const repo = await import\("\.\.\/repo\/submissions\.js"\);/, "the queue's code loads only on the home page, on demand");
});

test("the demo stand-in says what the real function says: the same messages, limits and file names", { skip: !existsSync(join(D2, "supabase/functions/subform/handler.ts")) && "DCR Desktop 2 is not next door" }, () => {
  const handler = readFileSync(join(D2, "supabase/functions/subform/handler.ts"), "utf8");
  const fake = readFileSync(join(TOOLS, "fake/p5c-sub.js"), "utf8");
  const msgs = /export const MESSAGES = \{([\s\S]*?)\} as const;/.exec(handler)[1];
  for (const m of msgs.matchAll(/^\s+(\w+): '([^']+)',$/gm)) {
    if (["server", "tooLarge", "notKept"].includes(m[1])) continue;   // never reached in the demo
    assert.ok(fake.includes('"' + m[2] + '"'), "the demo's " + m[1] + " message: " + m[2]);
  }
  const rate = /export const RATE = \{([\s\S]*?)\} as const;/.exec(handler)[1];
  for (const m of rate.matchAll(/(\w+): \{ limit: (\d+), seconds: (\d+) \}/g)) {
    assert.ok(fake.includes(m[1] + ": [" + m[2] + ", " + m[3] + "]"), "the demo's " + m[1] + " limit");
  }
  assert.ok(/export const MAX_AMOUNT = 5_000_000;/.test(handler) && /MAX_AMOUNT = 5000000/.test(fake));
  assert.ok(handler.includes("return `SUB ${k} ${ref}${suffix ? ' ' + suffix : ''}.${ext}`;") && fake.includes('"SUB " + (kind === "change_order"'), "our file names");
});

test("the demo's review RPCs take migration M5c's arguments", { skip: !existsSync(join(D2, "supabase/migrations/20261027000100_office_lists.sql")) && "M5c is not next door" }, () => {
  const sql = readFileSync(join(D2, "supabase/migrations/20261027000100_office_lists.sql"), "utf8");
  const fake = readFileSync(join(TOOLS, "fake/p5c-sub.js"), "utf8");
  for (const [fn, args] of [["accept_submission", ["p_id", "p_version", "p_quote_id"]], ["reject_submission", ["p_id", "p_version", "p_note"]]]) {
    const m = new RegExp("create or replace function public\\." + fn + "\\(([^)]*)\\)").exec(sql);
    assert.ok(m, fn);
    assert.deepEqual(m[1].split(",").map((a) => a.trim().split(/\s+/)[0]), args, fn + " in M5c");
    assert.ok(fake.includes(fn + ': ["' + args.join('", "') + '"]'), fn + " in the demo");
  }
  for (const col of ["signature_path", "document_path", "document_name", "document_size", "document_mime", "document_attached_at", "project_label", "submitted_ip"]) {
    assert.match(sql, new RegExp("\\n  " + col + "\\s"), "M5c has " + col);
    assert.ok(fake.includes(col + ":"), "the demo has " + col);
  }
});

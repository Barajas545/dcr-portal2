// Sign-in storage ("keep me signed in"), the password rule and the profile shape (sb.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuthStorage, passwordProblem, shapeProfile, STORAGE_KEY, SUPABASE_JS_URL, SUPABASE_JS_VERSION } from "../site/js/sb.js";

function memStore() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

test("the session key is Portal 2's own", () => {
  assert.equal(STORAGE_KEY, "dcr2-auth");
  assert.match(SUPABASE_JS_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js$/);
  assert.match(SUPABASE_JS_VERSION, /^\d+\.\d+\.\d+$/);
});

test("keep me signed in: localStorage; otherwise sessionStorage", () => {
  const local = memStore(), session = memStore();
  const a = makeAuthStorage(() => local, () => session);
  assert.equal(a.mode(), "local", "a device that never signed in reads localStorage");
  a.setMode("session");
  a.setItem(STORAGE_KEY, "S1");
  assert.equal(session.getItem(STORAGE_KEY), "S1");
  assert.equal(local.getItem(STORAGE_KEY), null);
  assert.equal(a.getItem(STORAGE_KEY), "S1");
  // signing in again with the tick: the session copy goes, the new one is kept
  a.setMode("local");
  assert.equal(session.getItem(STORAGE_KEY), null);
  a.setItem(STORAGE_KEY, "L1");
  a.setItem(STORAGE_KEY + "-profile", "{}");
  assert.equal(local.getItem(STORAGE_KEY), "L1");
  assert.equal(a.getItem(STORAGE_KEY), "L1");
  // a second adapter over the same stores (the next page) finds it
  const b = makeAuthStorage(() => local, () => session);
  assert.equal(b.getItem(STORAGE_KEY), "L1");
  // other sites' keys on the same stores are never touched
  local.setItem("dcr_portal_token", "old portal");
  local.setItem("dcr2_theme", "dark");
  b.clear();
  assert.equal(local.getItem(STORAGE_KEY), null);
  assert.equal(local.getItem(STORAGE_KEY + "-profile"), null);
  assert.equal(local.getItem("dcr_portal_token"), "old portal");
  assert.equal(local.getItem("dcr2_theme"), "dark");
});

test("a store the browser refuses falls back to memory (the session lasts the page)", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const a = makeAuthStorage(() => throwing, () => throwing);
  a.setItem(STORAGE_KEY, "M");
  assert.equal(a.getItem(STORAGE_KEY), "M");
  a.removeItem(STORAGE_KEY);
  assert.equal(a.getItem(STORAGE_KEY), null);
});

test("password rule: Desktop 2's (10+ characters, letters and digits)", () => {
  assert.equal(passwordProblem("short1"), "Use at least 10 characters.");
  assert.equal(passwordProblem("onlyletters"), "Use both letters and digits.");
  assert.equal(passwordProblem("1234567890"), "Use both letters and digits.");
  assert.equal(passwordProblem("framing2026x"), "");
  assert.equal(passwordProblem(undefined), "Use at least 10 characters.");
});

test("profile shape: name falls back to the e-mail; admins hold every switch", () => {
  const p = shapeProfile({ id: "u1", full_name: " ", email: "a@demo.test", role: "lead", can_see_prices: false, active: true, version: 3 });
  assert.equal(p.name, "a@demo.test");
  assert.equal(p.must_change_password, false);
  assert.equal(p.can_estimate, false, "a database without the column: off");
  assert.equal(p.can_upload_onedrive, false);
  const a = shapeProfile({ id: "u2", full_name: "Avery", email: "x@demo.test", role: "admin", can_see_prices: false, can_see_financials: false, can_approve_payments: false });
  assert.ok(a.can_see_prices && a.can_see_financials && a.can_approve_payments);
  assert.ok(a.can_estimate && a.can_upload_onedrive, "Part 3's switches too");
  const m = shapeProfile({ id: "u4", email: "m@demo.test", role: "manager", can_estimate: true, can_upload_onedrive: true });
  assert.ok(m.can_estimate && m.can_upload_onedrive);
  assert.equal(shapeProfile({ id: "u3", email: "y", role: "field", active: false }).active, false);
  assert.equal(shapeProfile(null), null);
});

// The Books program, release B (I29): where a person lands after signing in, when no ?next= says otherwise - an
// accountant with financials on the Accounting page, everyone else on Home; an explicit ?next= always wins (safeNext,
// unchanged); the installed app (it opens Home) sends the accountant there ONCE per browser session.
test("landingFor: an active accountant with financials -> books-home.html; anyone else -> dashboard.html; safeNext unchanged", async () => {
  const { landingFor, safeNext, bounceFor, markLanded, LANDED_KEY, navItems } = await import("../site/js/common2.js");
  assert.equal(landingFor({ role: "accountant", active: true, can_see_financials: true }), "books-home.html");
  for (const p of [{ role: "accountant", active: true, can_see_financials: false }, { role: "accountant", active: false, can_see_financials: true },
    { role: "admin", active: true, can_see_financials: true }, { role: "manager", active: true, can_see_financials: true, can_approve_payments: true },
    { role: "lead", active: true, can_see_financials: true }, null, undefined]) {
    assert.equal(landingFor(p), "dashboard.html", JSON.stringify(p));
  }
  // an explicit next is as it always was
  assert.equal(safeNext("my-tasks.html%3Ftask%3D12"), "my-tasks.html?task=12");
  assert.equal(safeNext("bill.html?id=4"), "bill.html?id=4");
  assert.equal(safeNext("https://evil.example/x"), "dashboard.html");
  assert.equal(safeNext("index.html"), "dashboard.html");
  assert.equal(safeNext("", "-"), "-");
  // once per session (sessionStorage), and a browser that refuses it: only when this site did not send them
  const mem = new Map();
  globalThis.sessionStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const acc = { role: "accountant", active: true, can_see_financials: true };
  try {
    assert.equal(bounceFor({ role: "admin", active: true }, ""), "", "Home stays Home for an admin");
    assert.equal(bounceFor(acc, ""), "books-home.html", "the first Home of the session");
    assert.equal(bounceFor(acc, ""), "", "then Home stays Home");
    mem.clear();
    markLanded();
    assert.equal(mem.get(LANDED_KEY), "1");
    assert.equal(bounceFor(acc, ""), "", "the sign-in page or the Accounting page marked it");
    globalThis.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    globalThis.location = { origin: "https://portal.example.test" };
    assert.equal(bounceFor(acc, "https://portal.example.test/books-home.html"), "", "storage refused: sent here by this site - stay");
    assert.equal(bounceFor(acc, ""), "books-home.html", "storage refused: opened from outside - go");
  } finally {
    delete globalThis.sessionStorage;
    delete globalThis.location;
  }
  // the top bar's one doorway to the money pages: whoever sees the Books
  const has = (p) => navItems(p).some((i) => i.key === "books" && i.href === "books-home.html" && i.text === "Accounting");
  assert.ok(has({ role: "admin" }) && has({ role: "accountant", can_see_financials: true }) && has({ role: "manager", can_see_financials: true }));
  assert.ok(!has({ role: "accountant", can_see_financials: false }) && !has({ role: "lead" }) && !has({ role: "field" }) && !has({ role: "viewer" }));
});

test("the sign-in page: an explicit ?next= wins, else the person's landing; either way the session is marked landed", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../site/js/shell/index.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /const asked = rawNext\(\) && safeNext\(rawNext\(\), "-"\) !== "-" \? safeNext\(rawNext\(\)\) : "";/);
  assert.match(src, /const go = \(p\) => asked \|\| landingFor\(p\);/);
  assert.match(src, /const nextAfterPassword = \(p\) => \{\n  markLanded\(\);\n  return p && p\.must_change_password \? "change-password\.html\?next=" \+ encodeURIComponent\(go\(p\)\) : go\(p\);/);
  const dash = readFileSync(new URL("../site/js/shell/dashboard.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(dash, /const landing = bounceFor\(p, [^)]*\);\n  if \(landing\) \{ location\.replace\(landing\); return; \}/);
});

test("signed out on a page: the sign-in page brings them back (?next=) - except bare Home before the session landed, so the installed app's signed-out start still lands the accountant on Accounting (I29)", async () => {
  const { signInHref, hasLanded, markLanded, LANDED_KEY, safeNext, landingFor } = await import("../site/js/common2.js");
  // the installed app opens dashboard.html; not kept signed in, every launch starts signed out there
  assert.equal(signInHref("dashboard.html", false), "index.html", "no ?next=: the sign-in page lands them (landingFor)");
  assert.equal(signInHref("dashboard.html", true), "index.html?next=dashboard.html", "landed already this session: back to Home");
  assert.equal(signInHref("dashboard.html?x=1", false), "index.html?next=dashboard.html%3Fx%3D1", "only bare Home");
  assert.equal(signInHref("bill.html?id=5", false), "index.html?next=bill.html%3Fid%3D5", "a bill link comes back to the bill");
  assert.equal(signInHref("my-tasks.html?task=12", false), "index.html?next=my-tasks.html%3Ftask%3D12");
  assert.equal(signInHref("", false), "index.html");
  // what the sign-in page then does with it (shell/index.js: an explicit ?next= wins, else the landing)
  const acc = { role: "accountant", active: true, can_see_financials: true };
  const go = (href) => { const m = /[?&]next=([^&]+)/.exec(href); const n = m && safeNext(m[1], "-") !== "-" ? safeNext(m[1]) : ""; return n || landingFor(acc); };
  assert.equal(go(signInHref("dashboard.html", false)), "books-home.html", "the accountant, signed out on the installed app: the Accounting page");
  assert.equal(go(signInHref("dashboard.html", true)), "dashboard.html");
  assert.equal(go(signInHref("bill.html?id=5", false)), "bill.html?id=5");
  const mem = new Map();
  globalThis.sessionStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    assert.equal(hasLanded(), false);
    markLanded();
    assert.equal(hasLanded(), true);
    assert.equal(mem.get(LANDED_KEY), "1");
    globalThis.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.equal(hasLanded(), false, "storage refused: not landed (the landing applies)");
  } finally {
    delete globalThis.sessionStorage;
  }
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../site/js/common2.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /function bounceToSignIn\(extra\) \{\n  const to = signInHref\(thisPage\(\), hasLanded\(\)\);/, "requireAuth's bounce goes through signInHref");
  assert.ok(!/"index\.html\?next=" \+ encodeURIComponent\(thisPage\(\)\)/.test(src), "no bounce builds ?next= from Home unasked");
});

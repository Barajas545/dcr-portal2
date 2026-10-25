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

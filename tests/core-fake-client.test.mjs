// The demo stand-in for supabase-js (tools/fake/fake-supabase.js) through the very sb.js code the
// pages run: sign-in storage, keep-me-signed-in, profile checks, sign-out scopes, query builder
// semantics (single, maybeSingle, select after write, count), RPCs, storage, and the TUS fetch path.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../tools/fake/engine.js";
import "../tools/fake/seed.js";
import "../tools/fake/fake-supabase.js";

const F = globalThis.DCR2Fake;
const demo = globalThis.DCR2Demo;
demo.setLatency(0);

function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function client(storage) {
  return globalThis.supabase.createClient("https://demo-ref.supabase.co", "sb_publishable_demo", { auth: { storage: storage || memStorage(), storageKey: "dcr2-auth" } });
}

test("sign in: wrong password refused; a session is written where the adapter says", async () => {
  const st = memStorage();
  const c = client(st);
  const bad = await c.auth.signInWithPassword({ email: "lead@demo.test", password: "wrong" });
  assert.equal(bad.error.code, "invalid_credentials");
  const ok = await c.auth.signInWithPassword({ email: "Lead@Demo.test ", password: "anything" });
  assert.equal(ok.error, null);
  const raw = JSON.parse(st.getItem("dcr2-auth"));
  assert.equal(raw.user.email, "lead@demo.test");
  assert.equal((await c.auth.getSession()).data.session.user.id, raw.user.id);
});

test("queries: single / maybeSingle / count / select after insert and update", async () => {
  const c = client();
  await c.auth.signInWithPassword({ email: "manager@demo.test", password: "x" });
  const one = await c.from("projects").select("id,number,version").eq("number", "A267").single();
  assert.equal(one.data.number, "A267");
  const none = await c.from("projects").select("id").eq("number", "Z999").maybeSingle();
  assert.equal(none.data, null);
  assert.equal(none.error, null);
  const many = await c.from("projects").select("id").limit(2).single();
  assert.equal(many.error.code, "PGRST116");
  assert.equal(many.status, 406);
  const head = await c.from("projects").select("*", { count: "exact", head: true }).eq("status", "completed");
  assert.ok(head.count > 50 && head.data === null);
  const up = await c.from("projects").update({ status_note: "Crew starts Monday" }).eq("id", one.data.id).eq("version", one.data.version).select();
  assert.equal(up.data.length, 1);
  assert.equal(up.data[0].version, one.data.version + 1);
  const stale = await c.from("projects").update({ status_note: "late" }).eq("id", one.data.id).eq("version", one.data.version).select();
  assert.deepEqual(stale.data, [], "the stale version matches nothing");
  const note = await c.from("activity").insert({ project_id: one.data.id, kind: "note", text: "From the demo test" }).select("id,text,projects(number)").single();
  assert.equal(note.data.projects.number, "A267");
  const ins = await c.from("activity").insert({ project_id: one.data.id, kind: "system", text: "x" });
  assert.equal(ins.error.code, "42501");
  assert.equal(ins.status, 403);
  const rpc = await c.rpc("search", { q: "A24" });
  assert.equal(rpc.data.projects[0].number, "A024");
  const missing = await c.rpc("no_such_function");
  assert.equal(missing.error.code, "PGRST202");
});

test("offline: queries answer status 0 like a failed fetch; sign-out offline keeps the session", async () => {
  const st = memStorage();
  const c = client(st);
  await c.auth.signInWithPassword({ email: "field@demo.test", password: "x" });
  demo.setOffline(true);
  try {
    const r = await c.from("projects").select("id").limit(1);
    assert.equal(r.status, 0);
    assert.match(r.error.message, /Failed to fetch/);
    const out = await c.auth.signOut({ scope: "local" });
    assert.equal(out.error.name, "AuthRetryableFetchError");
    assert.ok(st.getItem("dcr2-auth"), "still signed in on this device");
  } finally {
    demo.setOffline(false);
  }
});

test("sign out: local ends this device only; others ends every other session", async () => {
  const a = client(), b = client();
  await a.auth.signInWithPassword({ email: "viewer@demo.test", password: "x" });
  await new Promise((r) => setTimeout(r, 5));
  await b.auth.signInWithPassword({ email: "viewer@demo.test", password: "x" });
  await a.auth.signOut({ scope: "local" });
  assert.equal((await a.auth.getSession()).data.session, null);
  assert.ok((await b.auth.getSession()).data.session, "the other device is still signed in");
  const c = client();
  await new Promise((r) => setTimeout(r, 5));
  await c.auth.signInWithPassword({ email: "viewer@demo.test", password: "x" });
  await c.auth.signOut({ scope: "others" });               // a password change does this
  assert.equal((await b.auth.getSession()).data.session, null, "the older session ended");
  assert.ok((await c.auth.getSession()).data.session, "this one stays");
});

test("password change: Desktop 2's rule, and password_changed clears the temporary flag", async () => {
  const c = client();
  await c.auth.signInWithPassword({ email: "newhire@demo.test", password: "temporary1" });
  const me = await c.from("profiles").select("must_change_password").eq("email", "newhire@demo.test").single();
  assert.equal(me.data.must_change_password, true);
  assert.equal((await c.auth.updateUser({ password: "short" })).error.code, "weak_password");
  assert.equal((await c.auth.updateUser({ password: "framing2026x" })).error, null);
  await c.rpc("password_changed");
  const after = await c.from("profiles").select("must_change_password").eq("email", "newhire@demo.test").single();
  assert.equal(after.data.must_change_password, false);
});

test("storage: simple and TUS uploads through fetch to the Supabase host, never the network", async () => {
  const st = memStorage();
  const c = client(st);
  await c.auth.signInWithPassword({ email: "field@demo.test", password: "x" });
  const token = JSON.parse(st.getItem("dcr2-auth")).access_token;
  const auth = { apikey: "k", authorization: "Bearer " + token };
  const key = "p/268/photos/" + "9".repeat(32) + "/IMG x.jpg";
  const r1 = await fetch("https://demo-ref.supabase.co/storage/v1/object/project-files/" + key.split("/").map(encodeURIComponent).join("/"),
    { method: "POST", headers: Object.assign({ "content-type": "image/jpeg", "x-upsert": "false" }, auth), body: new Blob(["abc"]) });
  assert.equal(r1.status, 200);
  const r2 = await fetch("https://demo-ref.supabase.co/storage/v1/object/project-files/" + encodeURI(key),
    { method: "POST", headers: Object.assign({ "content-type": "image/jpeg" }, auth), body: new Blob(["abc"]) });
  assert.equal(r2.status, 400);
  assert.equal((await r2.json()).statusCode, "409", "no overwrite");
  const meta = "bucketName " + btoa("project-files") + ",objectName " + btoa("p/268/photos/" + "8".repeat(32) + "/v.mov");
  const cr = await fetch("https://demo-ref.supabase.co/storage/v1/upload/resumable",
    { method: "POST", headers: Object.assign({ "tus-resumable": "1.0.0", "upload-length": "10", "upload-metadata": meta }, auth) });
  assert.equal(cr.status, 201);
  const loc = new URL(cr.headers.get("location"), "https://demo-ref.supabase.co").href;
  const pt = await fetch(loc, { method: "PATCH", headers: Object.assign({ "tus-resumable": "1.0.0", "upload-offset": "0", "content-type": "application/offset+octet-stream" }, auth), body: new Blob(["0123456789"]) });
  assert.equal(pt.status, 204);
  assert.equal(pt.headers.get("upload-offset"), "10");
  await assert.rejects(fetch("https://demo-ref.supabase.co/rest/v1/projects"), /no network to Supabase/);
  const signed = await c.storage.from("project-files").createSignedUrls([key, "p/1/photos/none/x.jpg"], 60);
  assert.equal(signed.data[1].signedUrl, null);
});

test("realtime: a private channel joins, gets the changes it may see, presence carries the colleagues", async () => {
  const c = client();
  await c.auth.signInWithPassword({ email: "lead@demo.test", password: "x" });
  const events = [];
  const statuses = [];
  const ch = c.channel("dcr-projects-1", { config: { private: true } })
    .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: "id=eq.268" }, (p) => events.push(p))
    .subscribe((s) => statuses.push(s));
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(statuses, ["SUBSCRIBED"]);
  demo.remoteEdit("projects", 268, { status_note: "Changed elsewhere" });
  demo.remoteEdit("projects", 1, { status_note: "Not this one" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "UPDATE");
  assert.equal(events[0].new.status_note, "Changed elsewhere");
  const pub = [];
  c.channel("dcr-projects-2", {}).subscribe((s) => pub.push(s));
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(pub, ["CHANNEL_ERROR"], "a public channel is refused");
  const pres = c.channel("presence:dcr", { config: { private: true, presence: { key: "me" } } });
  let synced = 0;
  pres.on("presence", { event: "sync" }, () => { synced++; }).subscribe();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(synced >= 1);
  const names = Object.values(pres.presenceState()).flat().map((m) => m.name);
  assert.ok(names.includes("Morgan Manager") && names.includes("Riley Lead"));
  await c.removeAllChannels();
  void ch;
});

test("the agents account cannot join any channel", async () => {
  const c = client();
  await c.auth.signInWithPassword({ email: "agents@demo.test", password: "x" });
  const st = [];
  c.channel("presence:dcr", { config: { private: true } }).subscribe((s) => st.push(s));
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(st, ["CHANNEL_ERROR"]);
  assert.equal((await c.from("projects").select("id")).data.length, 0);
});

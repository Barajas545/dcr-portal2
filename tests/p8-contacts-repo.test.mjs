// The Books release A3 (WP-P2): site/js/repo/contacts.js - a contact's picture (the private bucket contact-pictures,
// "<contact id>/<uuid>.jpg", one column written with a versioned PATCH) and its reach (phone, e-mail) - over the demo
// database (tools/fake/p8-contacts.js: the rules of DCR Desktop 2 migration 20261030000200, docs/DATABASE.md §32) as
// each role, plus the books' contact reads (repo/books.js CONTACT_COLS) and the degrade to initials on a database that
// has no contacts.picture_path yet. tools/schema-check-p8-contacts.mjs runs the same module against the REAL migration.
// Made-up people and companies only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as C from "../site/js/repo/contacts.js";
import * as books from "../site/js/repo/books.js";
import * as searchRepo from "../site/js/repo/search.js";
import { toGroups } from "../site/js/map/search.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
  C.forgetPictures();
  C.forgetPictureColumn();
}
const id = (key) => F.PEOPLE.find((p) => p.key === key).id;
function me(key) {
  const p = E.rows.profiles.find((x) => x.id === id(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
/** as `key` over the demo database; every Storage call is logged ({bucket, op, path(s), opts, seconds}) */
function as(key, opts) {
  const o = opts || {};
  const c = clientAs(E, id(key));
  const log = [];
  const storage = {
    from: (bucket) => {
      const inner = c.storage.from(bucket);
      return {
        upload: (path, body, op) => { log.push({ bucket, op: "upload", path, opts: op, size: body && body.size }); return inner.upload(path, body, op); },
        createSignedUrl: (path, s) => { log.push({ bucket, op: "sign", path, seconds: s }); return inner.createSignedUrl(path, s); },
        createSignedUrls: (paths, s) => { log.push({ bucket, op: "signMany", paths: paths.slice(), seconds: s }); return inner.createSignedUrls(paths, s); },
      };
    },
  };
  const from = (t) => {
    const q = c.from(t);
    if (t !== "contacts" || !o.noPictureColumn) return q;
    // a database before migration 20261030000200: the column is not there
    const sel = q.select.bind(q), upd = q.update.bind(q);
    let bad = null;
    q.select = (cols) => { if (/picture_path/.test(String(cols || ""))) bad = { code: "42703", message: "column contacts.picture_path does not exist" }; return sel(cols); };
    q.update = (body) => { if (body && "picture_path" in body) bad = { code: "PGRST204", message: "Could not find the 'picture_path' column of 'contacts' in the schema cache" }; return upd(body); };
    const then = q.then.bind(q);
    q.then = (ok, no) => (bad ? Promise.resolve({ data: null, error: bad, status: 400 }).then(ok, no) : then(ok, no));
    return q;
  };
  useClient({ from, rpc: (n, a) => c.rpc(n, a), storage });
  clearPeople();
  return log;
}
const contact = (company) => E.rows.contacts.find((c) => c.company === company);
const plain = (row) => JSON.parse(JSON.stringify(row));
const jpeg = (n) => ({ blob: new Blob([new Uint8Array(n || 2048)], { type: "image/jpeg" }), mime: "image/jpeg", ext: ".jpg", width: 400, height: 400 });
async function refused(fn, code) {
  try { await fn(); } catch (e) { if (code) assert.equal(String(e.code), code, e.message); return e; }
  assert.fail("expected a refusal " + (code || ""));
}

test("the key: app.contact_picture_path_ok's shape, and a new dashed lower-case uuid for every picture", () => {
  for (const good of ["7/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "123456789012345678/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.png",
    "42/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.webp"]) assert.ok(C.picturePathOk(good), good);
  for (const bad of ["07/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "7/0a9b8c7d6e5f4a3b8c2d1e0f9a8b7c6d.jpg", "7/0A9B8C7D-6E5F-4A3B-8C2D-1E0F9A8B7C6D.jpg",
    "7/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpeg", "7/x/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "c/7/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d/picture.jpg",
    "1234567890123456789/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "", null, undefined, 7]) assert.equal(C.picturePathOk(bad), false, String(bad));
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const k = C.pictureKey(12);
    assert.match(k, /^12\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/);
    seen.add(k);
  }
  assert.equal(seen.size, 50, "a new uuid each time: the path is the cache key");
  assert.equal(C.pictureKey("12", "0A9B8C7D-6E5F-4A3B-8C2D-1E0F9A8B7C6D"), "12/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "lower case, never .hex");
  assert.throws(() => C.pictureKey(null), /no id/);
  // without crypto.randomUUID (an older browser): the same form from getRandomValues
  const saved = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
    assert.match(C.newUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (saved) Object.defineProperty(globalThis.crypto, "randomUUID", saved); else delete globalThis.crypto.randomUUID;
  }
  assert.deepEqual([C.PICTURE_BUCKET, C.PICTURE_SIDE, C.PICTURE_MAX_BYTES, C.SIGN_S], ["contact-pictures", 400, 2097152, 3600]);
});

test("setPicture: the upload first (contact-pictures, never overwriting, a JPEG), then ONE column at the version read", { skip }, async () => {
  await setup();
  const before = plain(contact("Oakfield Concrete"));
  const log = as("accountant");
  const got = await C.getContact(before.id);
  assert.equal(got.pictures, true);
  assert.equal(got.row.version, before.version);
  const row = await C.setPicture(got.row, jpeg(4096));
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].bucket, log[0].op, log[0].opts.upsert, log[0].opts.contentType, log[0].size], ["contact-pictures", "upload", false, "image/jpeg", 4096]);
  assert.match(log[0].path, new RegExp("^" + before.id + "/[0-9a-f-]{36}\\.jpg$"));
  assert.equal(row.picture_path, log[0].path);
  assert.equal(row.version, before.version + 1);
  const after = plain(contact("Oakfield Concrete"));
  assert.equal(after.picture_path, log[0].path);
  assert.ok(E.storage.has(log[0].path), "the object is there");
  for (const k of ["name", "company", "kind", "phone", "email", "address", "city", "notes", "deleted_at"]) assert.equal(after[k], before[k], k + " untouched");
  // a second picture: a new key (the old object stays, read by nobody)
  const row2 = await C.setPicture(row, jpeg());
  assert.notEqual(row2.picture_path, row.picture_path);
  assert.equal(row2.version, row.version + 1);
  // its own upload is shown at once, never signed again
  const urls = await C.pictureUrls([row2]);
  assert.ok(urls[row2.picture_path], "shown");
  useClient(null);
});

test("who may: a lead, field, view-only and the agents account are refused by Storage before anything changes; a deleted contact for an admin too", { skip }, async () => {
  await setup();
  const c0 = plain(contact("Oakfield Concrete"));
  for (const k of ["lead", "field", "viewer"]) {
    const log = as(k);
    const e = await refused(() => C.setPicture(c0, jpeg()), "42501");
    assert.match(e.message, /only an admin, a manager or an accountant/);
    assert.equal(log.length, 1, k + ": only the refused upload");
    assert.deepEqual(plain(contact("Oakfield Concrete")), c0, k + ": the contact unchanged");
  }
  for (const k of ["admin", "manager", "accountant"]) {
    as(k);
    const cur = (await C.getContact(c0.id)).row;
    const row = await C.setPicture(cur, jpeg());
    assert.ok(C.picturePathOk(row.picture_path), k);
  }
  // a deleted contact: Storage wants a LIVE contact (an admin too)
  const gone = contact("Rosewell Concrete");
  gone.deleted_at = new Date().toISOString();
  as("admin");
  await refused(() => C.setPicture(plain(gone), jpeg()), "42501");
  // the shape is the database's: another contact's id in the key is refused by the column's own rule
  as("accountant");
  const other = contact("Brightwater Concrete");
  const r = await clientAs(E, id("accountant")).from("contacts").update({ picture_path: other.picture_path.replace(/^\d+/, String(c0.id)) })
    .eq("id", other.id).select("id");
  assert.equal(r.error && r.error.code, "23514", "a key naming another contact");
  useClient(null);
});

test("a change by someone else meanwhile: the picture is pointed at once more, at the new version (PT409 once); twice is PT409", { skip }, async () => {
  await setup();
  const stale = plain(contact("Oakfield Concrete"));
  await clientAs(E, id("admin")).from("contacts").update({ notes: "Made-up note from someone else" }).eq("id", stale.id).select("id");
  as("accountant");
  const row = await C.setPicture(stale, jpeg());
  assert.equal(row.version, stale.version + 2);
  assert.equal(contact("Oakfield Concrete").notes, "Made-up note from someone else", "theirs kept");
  // a hand-made client that is always one version ahead: one retry only, then the conflict
  let updates = 0, ver = 10;
  const q = (t) => {
    const self = { op: "select", t };
    self.update = () => { self.op = "update"; updates++; return self; };
    self.select = () => self;
    self.eq = () => self;
    self.then = (ok, no) => Promise.resolve(self.op === "update" ? { data: [], error: null } : { data: [{ id: 5, version: ++ver }], error: null }).then(ok, no);
    return self;
  };
  useClient({ from: q, storage: { from: () => ({ upload: async () => ({ data: {}, error: null }) }) } });
  const e = await refused(() => C.setPicture({ id: 5, version: 1 }, jpeg()), "PT409");
  assert.ok(e.current, "the row now comes with it");
  assert.equal(updates, 2, "sent twice, never more");
  useClient(null);
});

test("clearPicture: initials again (NULL) - the old object stays in the bucket, read by nobody", { skip }, async () => {
  await setup();
  as("accountant");
  const c0 = (await C.getContact(contact("Brightwater Concrete").id)).row;
  assert.ok(C.picturePathOk(c0.picture_path), "the seed gave it one");
  const old = c0.picture_path;
  const row = await C.clearPicture(c0);
  assert.equal(row.picture_path, null);
  assert.equal(row.version, c0.version + 1);
  assert.ok(E.storage.has(old), "the object is not removed");
  C.forgetPictures();
  assert.deepEqual(await C.pictureUrls([old]), {}, "and nobody reads it any more");
  as("admin");
  assert.deepEqual(await C.pictureUrls([old]), {}, "an admin neither");
  useClient(null);
});

test("pictureUrls: an hour from contact-pictures, remembered for the page; only the pictures this person may read", { skip }, async () => {
  await setup();
  const live = plain(contact("Rosewell Concrete")), other = plain(contact("Brightwater Concrete"));
  let log = as("field");
  const urls = await C.pictureUrls([live, { picturePath: other.picture_path }, other.picture_path, "../not/a/key.jpg", null, { id: 1 }]);
  assert.deepEqual(Object.keys(urls).sort(), [live.picture_path, other.picture_path].sort(), "every active person reads a live contact's picture (owner Q7)");
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].bucket, log[0].op, log[0].seconds, log[0].paths.length], ["contact-pictures", "signMany", 3600, 2], "one call, nothing malformed asked");
  await C.pictureUrls([live]);
  assert.equal(log.length, 1, "remembered");
  // a deleted contact's picture: admins only
  contact("Rosewell Concrete").deleted_at = new Date().toISOString();
  C.forgetPictures();
  log = as("field");
  assert.deepEqual(Object.keys(await C.pictureUrls([live, other])), [other.picture_path], "field: not the deleted contact's");
  C.forgetPictures();
  as("admin");
  assert.equal(Object.keys(await C.pictureUrls([live, other])).length, 2, "an admin reads it");
  C.forgetPictures();
  as("agents");
  assert.deepEqual(await C.pictureUrls([live, other]), {}, "the agents account reads none");
  // many: 100 a call
  C.forgetPictures();
  const calls = [];
  const many = Array.from({ length: 150 }, (_, i) => (i + 1) + "/0a9b8c7d-6e5f-4a3b-8c2d-" + String(i).padStart(12, "0") + ".jpg");
  useClient({ storage: { from: (b) => ({ createSignedUrls: async (paths, s) => { calls.push([b, paths.length, s]); return { data: paths.map((p) => ({ path: p, signedUrl: "https://signed.test/" + p, error: null })), error: null }; } }) } });
  const all = await C.pictureUrls(many.map((p) => ({ picture_path: p })));
  assert.equal(Object.keys(all).length, 150);
  assert.deepEqual(calls, [["contact-pictures", 100, 3600], ["contact-pictures", 50, 3600]]);
  // a failed call is tried again next time (initials meanwhile)
  C.forgetPictures();
  let fail = true;
  useClient({ storage: { from: () => ({ createSignedUrls: async (paths) => (fail ? { data: null, error: { message: "Failed to fetch" } }
    : { data: paths.map((p) => ({ path: p, signedUrl: "https://signed.test/" + p })), error: null }) }) } });
  assert.deepEqual(await C.pictureUrls([many[0]]), {});
  fail = false;
  assert.ok((await C.pictureUrls([many[0]]))[many[0]], "asked again");
  useClient(null);
});

test("updateReach: the phone and e-mail given, as the database tidies them; another contact's e-mail in words; a stale version only when the reach moved", { skip }, async () => {
  await setup();
  as("accountant");
  const c0 = (await C.getContact(contact("Oakfield Concrete").id)).row;
  const row = await C.updateReach(c0, { phone: "805 555 0177", email: "  oakfield.office@example.com " });
  assert.equal(row.phone, "(805) 555-0177", "t15_phone");
  assert.equal(row.email, "oakfield.office@example.com", "trimmed");
  assert.equal(row.version, c0.version + 1);
  assert.equal((await C.updateReach(row, {})).version, row.version, "nothing given: nothing sent");
  const taken = contact("Rosewell Concrete").email;
  const e = await refused(() => C.updateReach(row, { email: taken.toUpperCase() }), "23505");
  assert.equal(e.message, "Another contact already has this e-mail.");
  assert.equal(contact("Oakfield Concrete").email, "oakfield.office@example.com", "nothing written");
  // a new picture meanwhile (version moved, reach not): the words go on top, once
  const shown = (await C.getContact(c0.id)).row;
  await C.setPicture(shown, jpeg());
  const row2 = await C.updateReach(shown, { phone: "" });
  assert.equal(row2.phone, null, "cleared");
  assert.ok(C.picturePathOk(row2.picture_path), "the picture kept");
  // someone else changed the e-mail meanwhile: theirs is not written over
  const mine = (await C.getContact(c0.id)).row;
  await clientAs(E, id("admin")).from("contacts").update({ email: "theirs@example.com" }).eq("id", c0.id).select("id");
  const c2 = await refused(() => C.updateReach(mine, { email: "mine@example.com" }), "PT409");
  assert.equal(c2.current.email, "theirs@example.com");
  assert.equal(contact("Oakfield Concrete").email, "theirs@example.com");
  // not a contact editor: refused by the database (42501)
  for (const k of ["lead", "field", "viewer"]) {
    as(k);
    await refused(() => C.updateReach((({ id: i, version, phone, email }) => ({ id: i, version, phone, email }))(contact("Oakfield Concrete")), { phone: "805 555 0100" }), "42501");
  }
  // the card's own checks: before anything is sent
  as("accountant");
  await refused(() => C.updateReach(mine, { email: "not an e-mail" }), "22023");
  useClient(null);
});

test("reachProblem: a malformed e-mail, too few digits, too long", () => {
  assert.equal(C.reachProblem({ email: "sam@example.com", phone: "(805) 555-0101" }), "");
  assert.equal(C.reachProblem({ email: "", phone: "" }), "", "clearing is fine");
  assert.match(C.reachProblem({ email: "sam@example" }), /doesn't look right/);
  assert.match(C.reachProblem({ email: "sam example.com" }), /doesn't look right/);
  assert.match(C.reachProblem({ phone: "555-01" }), /too few digits/);
  assert.match(C.reachProblem({ phone: "8".repeat(61) }), /too long/);
  assert.equal(C.reachProblem({ phone: "805 555 0101 ext. 12" }), "");
});

test("search carries the picture (rpc search: picture_path on a contact hit); map/search.js keeps it on the contact", { skip }, async () => {
  await setup();
  as("field");
  const raw = await searchRepo.raw("Rosewell");
  const hit = raw.contacts.find((c) => c.company === "Rosewell Concrete");
  assert.ok(hit && C.picturePathOk(hit.picture_path), "the seed's picture");
  const g = toGroups(raw, { q: "Rosewell" }).find((x) => x.key === "contacts");
  const it = g.items.find((x) => x.contact && x.contact.company === "Rosewell Concrete");
  assert.deepEqual(Object.keys(it.contact).sort(), ["company", "id", "name", "picture_path"]);
  assert.equal(it.contact.picture_path, hit.picture_path);
  const none = toGroups({ contacts: [{ id: 3, name: "Pat Example", company: null }] }, {}).find((x) => x.key === "contacts").items[0];
  assert.equal(none.contact.picture_path, null, "initials");
  useClient(null);
});

test("The Books read the contacts with their picture and version (repo/books.js CONTACT_COLS)", { skip }, async () => {
  await setup();
  assert.equal(books.CONTACT_COLS, "id, name, company, email, phone, picture_path, deleted_at, version");
  as("accountant");
  const d = await books.loadDesk(me("accountant"));
  const rows = Array.from(d.links.contacts.values());
  assert.ok(rows.length > 10 && rows.every((r) => "picture_path" in r && typeof r.version === "number"));
  assert.ok(rows.some((r) => C.picturePathOk(r.picture_path)));
  const b = E.rows.bills.find((x) => x.vendor_contact_id != null && !x.deleted_at);
  const one = await books.loadBill(b.id, me("accountant"));
  assert.ok(one.contact && "picture_path" in one.contact && one.contact.version >= 1);
  useClient(null);
});

test("the degrade: a database without contacts.picture_path (42703 / PGRST204) - read again without it, initials; no upload is tried", { skip }, async () => {
  await setup();
  const log = as("accountant", { noPictureColumn: true });
  const d = await books.loadDesk(me("accountant"));
  const rows = Array.from(d.links.contacts.values());
  assert.ok(rows.length > 10 && rows.every((r) => !("picture_path" in r) && typeof r.version === "number"), "the books still open, without the column");
  assert.equal(C.picturesReady(), false);
  const b = E.rows.bills.find((x) => x.vendor_contact_id != null && !x.deleted_at);
  assert.ok((await books.loadBill(b.id, me("accountant"))).contact, "the bill page too");
  const got = await C.getContact(contact("Oakfield Concrete").id);
  assert.equal(got.pictures, false);
  assert.ok(!("picture_path" in got.row));
  const e = await refused(() => C.setPicture(got.row, jpeg()), "PGRST204");
  assert.match(e.message, /next database update/);
  assert.equal(log.length, 0, "no upload");
  const row = await C.updateReach(got.row, { phone: "805 555 0123" });
  assert.equal(row.phone, "(805) 555-0123", "the reach still saves");
  // a database whose PATCH says so first (the column read before it was dropped): the same sentence
  C.forgetPictureColumn();
  const e2 = await refused(() => C.clearPicture(got.row), "PGRST204");
  assert.match(e2.message, /next database update/);
  C.forgetPictureColumn();
  useClient(null);
});

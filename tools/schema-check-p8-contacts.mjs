/* DCR Portal 2 — contact pictures and a contact's reach against the REAL database rules (development only): the Books
   release A3 part of tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/
   contacts.js (and the books' and Search's contact reads) runs over PGlite loaded with every DCR Desktop 2 migration,
   M2 20261030000200_contacts_pictures_vendors included (docs/DATABASE.md §32), as each made-up role:

   * the names: contacts.picture_path and version (repo/contacts.js and repo/books.js CONTACT_COLS), the private bucket
     contact-pictures with its own limits (2 MiB of image/jpeg, image/png, image/webp), search(q)'s picture_path, and
     the key's shape (repo/contacts.js PICTURE_RE) equal to app.contact_picture_path_ok on every vector;
   * setPicture as each contact editor (admin, manager, accountant): the object at "<contact id>/<uuid>.jpg" in
     contact-pictures (Storage's insert policy), then ONE column at the version read; refused by Storage (42501, nothing
     changed) for a lead, field, view-only, the agents account and a turned-off person, and for a deleted contact (an
     admin too); a key of another shape, or naming another contact, refused by the bucket and by the column's rules
     (23514); a type outside the bucket's refused; nobody overwrites an object (no update policy);
   * a change by someone else meanwhile: pointed at once more at the new version (PT409 once);
   * pictureUrls: every active person reads a live contact's picture (owner Q7), a deleted contact's only an admin, the
     agents account and a turned-off person none, a replaced picture nobody; clearPicture: NULL, the object stays;
   * updateReach: the phone tidied by t15_phone, the e-mail trimmed by t11_contacts_email; another live contact with the
     e-mail: contacts_email_key, said "Another contact already has this e-mail."; refused for anyone but a contact editor;
     a stale version when the e-mail moved meanwhile (PT409), sent once more when only the picture did;
   * search(q) carries picture_path, and map/search.js keeps it; The Books (repo/books.js loadDesk, loadBill) read the
     contacts with their picture and version;
   * drift: the demo database (tools/fake/p8-contacts.js) has every contact column the modules read and the same key rule.
   Made-up people and companies only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const T = catalog.tables;
  if (!(T.contacts && T.contacts.cols.picture_path && catalog.functions.search)) {
    results.push({ section, name: "M2 (20261030000200_contacts_pictures_vendors) is not in DCR Desktop 2 yet: the contact picture checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const C = await site("repo/contacts.js");
  const books = await site("repo/books.js");
  const searchRepo = await site("repo/search.js");
  const MS = await site("map/search.js");
  const sbm = await site("sb.js");
  const BUCKET = C.PICTURE_BUCKET;
  const jpeg = (n) => ({ blob: new Blob([new Uint8Array(n || 2048)], { type: "image/jpeg" }), mime: "image/jpeg", ext: ".jpg", width: 400, height: 400 });
  const objects = async (prefix) => (await sql("select name from storage.objects where bucket_id = $1 and name like $2 order by name", [BUCKET, prefix + "/%"]))
    .map((r) => r.name);
  const row = async (id) => one("select * from public.contacts where id = $1", [id]);
  const fresh = async (id) => (await C.getContact(id)).row;
  const asKey = async (k) => { C.forgetPictures(); C.forgetPictureColumn(); await as(k); };

  /* made-up contacts (as the database's own user: no person's audit) */
  await sql("reset role");
  const K = {};
  const mk = async (name, company, kind, email, phone) => (await one(
    "insert into public.contacts (name, company, kind, email, phone) values ($1, $2, $3, $4, $5) returning id", [name, company, kind, email, phone])).id;
  K.sub = await mk("Pat Pictureton", "Pictureton Concrete", "subcontractor", "pat@pictureton.example.com", "(805) 555-0141");
  K.supplier = await mk("Lou Lumberly", "Lumberly Lumber Supply", "supplier", "lou@lumberly.example.com", "(805) 555-0142");
  K.client = await mk("Cam Clientson", null, "client", "cam@clientson.example.com", "(805) 555-0143");
  K.gone = await mk("Del Deleted", "Deleted Drywall", "subcontractor", "del@deleted.example.com", "(805) 555-0144");
  await sql("update public.contacts set deleted_at = now() where id = $1", [K.gone]);

  await check("Books A3 names: contacts.picture_path and version (CONTACT_COLS), the bucket contact-pictures and its limits, search(q), the key's shape", async () => {
    for (const cols of [C.CONTACT_COLS, books.CONTACT_COLS]) {
      for (const c of cols.split(",").map((x) => x.trim())) ok(T.contacts.cols[c], "contacts." + c);
    }
    ok(/picture_path/.test(books.CONTACT_COLS) && /version/.test(books.CONTACT_COLS), "the books read the picture and the version");
    await sql("reset role");
    const b = await one("select public, file_size_limit::int8::text as lim, allowed_mime_types::text as mimes from storage.buckets where id = $1", [BUCKET]);
    ok(b, "the bucket " + BUCKET);
    same([b.public, b.lim, b.mimes], [false, String(C.PICTURE_MAX_BYTES), "{image/jpeg,image/png,image/webp}"], "private, 2 MiB, three image types");
    same(catalog.functions.search.map((f) => f.args.map((a) => a.name)), [["q"]], "search(q)");
    const vectors = ["7/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "123456789012345678/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.webp",
      "42/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.png", "07/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "7/0a9b8c7d6e5f4a3b8c2d1e0f9a8b7c6d.jpg",
      "7/0A9B8C7D-6E5F-4A3B-8C2D-1E0F9A8B7C6D.jpg", "7/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpeg", "7/x/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg",
      "c/7/0a9b8c7d6e5f4a3b8c2d1e0f9a8b7c6d/picture.jpg", "1234567890123456789/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg", "", "7/.jpg",
      C.pictureKey(K.sub)];
    for (const v of vectors) {
      const db = (await one("select app.contact_picture_path_ok($1) as ok", [v])).ok;
      same(C.picturePathOk(v), db, "the key rule on " + JSON.stringify(v));
    }
  });

  await check("Books A3 setPicture as a contact editor: the object at <contact id>/<uuid>.jpg in contact-pictures, then ONE column at the version read", async () => {
    for (const k of ["accountant", "admin", "manager"]) {
      await asKey(k);
      const before = await row(K.sub);
      const r = await C.setPicture(await fresh(K.sub), jpeg(4096));
      ok(new RegExp("^" + K.sub + "/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpg$").test(r.picture_path), k + ": the key " + r.picture_path);
      same(r.version, before.version + 1, k + ": one new version");
      await sql("reset role");
      const after = await row(K.sub);
      same(after.picture_path, r.picture_path, k + ": the column");
      for (const c of ["name", "company", "kind", "phone", "email", "address", "city", "notes", "deleted_at"]) same(after[c], before[c], k + ": " + c + " untouched");
      const o = await one("select metadata ->> 'mimetype' as mime from storage.objects where bucket_id = $1 and name = $2", [BUCKET, r.picture_path]);
      same(o && o.mime, "image/jpeg", k + ": the object, a JPEG");
    }
    await sql("reset role");
    ok((await objects(String(K.sub))).length >= 3, "the replaced pictures stay in the bucket (an admin sweeps)");
  });

  await check("Books A3 setPicture refused: lead, field, view-only, the agents account, a turned-off person (Storage, 42501, nothing changed); a deleted contact for an admin too", async () => {
    await sql("reset role");
    const before = await row(K.supplier);
    const n0 = (await objects(String(K.supplier))).length;
    for (const k of ["lead", "field", "viewer", "agents", "inactive"]) {
      await asKey(k);
      const e = await refused(() => C.setPicture({ id: K.supplier, version: before.version, name: before.name }, jpeg()), "42501", k);
      ok(/only an admin, a manager or an accountant/.test(e.message), k + ": said so");
      await sql("reset role");
      same((await row(K.supplier)).version, before.version, k + ": the contact unchanged");
      same((await objects(String(K.supplier))).length, n0, k + ": no object");
    }
    await asKey("admin");
    const gone = await row(K.gone);
    await refused(() => C.setPicture({ id: K.gone, version: gone.version, name: gone.name }, jpeg()), "42501", "a deleted contact (an admin)");
    await sql("reset role");
    same((await objects(String(K.gone))).length, 0, "nothing stored for it");
  });

  await check("Books A3 the bucket's and the column's own rules: another shape, another contact's key, another type, an overwrite - refused", async () => {
    await asKey("accountant");
    const up = (key, type) => client.storage.from(BUCKET).upload(key, new Blob([new Uint8Array(512)], { type: type || "image/jpeg" }),
      { upsert: false, contentType: type || "image/jpeg" });
    for (const bad of [K.sub + "/0a9b8c7d6e5f4a3b8c2d1e0f9a8b7c6d.jpg", K.sub + "/x/" + C.newUuid() + ".jpg", "0" + K.sub + "/" + C.newUuid() + ".jpg",
      K.gone + "/" + C.newUuid() + ".jpg", "99999999/" + C.newUuid() + ".jpg"]) {
      ok((await up(bad)).error, "refused: " + bad);
    }
    ok((await up(K.sub + "/" + C.newUuid() + ".gif", "image/gif")).error, "a type outside the bucket's");
    const mine = K.supplier + "/" + C.newUuid() + ".jpg";
    ok(!(await up(mine)).error, "a good key for a live contact");
    ok((await up(mine)).error, "the same key again: never overwritten");
    const again = await client.storage.from(BUCKET).upload(mine, new Blob([new Uint8Array(9)], { type: "image/jpeg" }), { upsert: true, contentType: "image/jpeg" });
    ok(again.error, "upsert: no update policy");
    // the column: a person's write names THIS contact (t12_contacts_picture), in the key's shape
    const sub = await fresh(K.sub);
    const r1 = await client.from("contacts").update({ picture_path: mine }).eq("id", K.sub).eq("version", sub.version).select("id");
    same(r1.error && r1.error.code, "23514", "a key naming another contact");
    await C.setPicture(await fresh(K.supplier), jpeg());
    const supp = await fresh(K.supplier);
    const r2 = await client.from("contacts").update({ picture_path: "x/not-a-key.jpg" }).eq("id", K.supplier).eq("version", supp.version).select("id");
    same(r2.error && r2.error.code, "23514", "a malformed key (contacts_picture_path_shape)");
  });

  await check("Books A3 a change by someone else meanwhile: the picture is pointed at once more at the new version", async () => {
    await asKey("accountant");
    const stale = await fresh(K.client);
    await asKey("admin");
    await client.from("contacts").update({ notes: "Made-up note from someone else" }).eq("id", K.client).eq("version", stale.version).select("id");
    await asKey("accountant");
    const r = await C.setPicture(stale, jpeg());
    same(r.version, stale.version + 2, "theirs, then mine");
    await sql("reset role");
    same((await row(K.client)).notes, "Made-up note from someone else", "their note kept");
  });

  await check("Books A3 pictureUrls: every active person reads a live contact's picture; a deleted contact's only an admin; the agents account and a turned-off person none; a replaced one nobody", async () => {
    await sql("reset role");
    const live = await row(K.sub);
    ok(C.picturePathOk(live.picture_path), "the sub has a picture");
    const old = (await objects(String(K.sub))).find((n) => n !== live.picture_path);
    ok(old, "an older picture of it");
    for (const k of ["admin", "manager", "manager2", "accountant", "lead", "field", "viewer"]) {
      await asKey(k);
      const urls = await C.pictureUrls([live, old]);
      same(Object.keys(urls), [live.picture_path], k + ": the live picture, never the replaced one");
    }
    for (const k of ["agents", "inactive"]) {
      await asKey(k);
      same(await C.pictureUrls([live]), {}, k + ": none");
    }
    // a deleted contact's picture: admins only (and everyone again once it is undeleted)
    await asKey("accountant");
    const supp = await row(K.supplier);
    await sql("reset role");
    await sql("update public.contacts set deleted_at = now() where id = $1", [K.supplier]);
    await asKey("field");
    same(await C.pictureUrls([supp]), {}, "field: not a deleted contact's");
    await asKey("admin");
    same(Object.keys(await C.pictureUrls([supp])), [supp.picture_path], "an admin: yes");
    await sql("reset role");
    await sql("update public.contacts set deleted_at = null where id = $1", [K.supplier]);
  });

  await check("Books A3 clearPicture: initials again (NULL); the object stays, read by nobody", async () => {
    await asKey("manager");
    const c0 = await fresh(K.client);
    const was = c0.picture_path;
    ok(C.picturePathOk(was), "it had one");
    const r = await C.clearPicture(c0);
    same([r.picture_path, r.version], [null, c0.version + 1], "NULL, one version");
    await sql("reset role");
    ok((await objects(String(K.client))).includes(was), "the object is not removed");
    await asKey("admin");
    same(await C.pictureUrls([was]), {}, "nobody reads it (an admin neither)");
  });

  await check("Books A3 updateReach: tidied by the database, another contact's e-mail in words, only contact editors, a stale version only when the reach moved", async () => {
    await asKey("accountant");
    const c0 = await fresh(K.client);
    const r = await C.updateReach(c0, { phone: "805.555.0177", email: "  cam.office@clientson.example.com " });
    same([r.phone, r.email, r.version], ["(805) 555-0177", "cam.office@clientson.example.com", c0.version + 1], "t15_phone, t11_contacts_email");
    const e = await refused(() => C.updateReach(r, { email: "PAT@pictureton.example.com" }), "23505", "another contact's e-mail, any case");
    same(e.message, "Another contact already has this e-mail.", "in words");
    // only the picture moved meanwhile: sent once more
    const shown = await fresh(K.client);
    await C.setPicture(shown, jpeg());
    const r2 = await C.updateReach(shown, { phone: "" });
    same(r2.phone, null, "cleared over a new picture");
    ok(C.picturePathOk(r2.picture_path), "the picture kept");
    // the e-mail moved meanwhile: theirs is never written over
    const mine = await fresh(K.client);
    await asKey("admin");
    await client.from("contacts").update({ email: "theirs@clientson.example.com" }).eq("id", K.client).eq("version", mine.version).select("id");
    await asKey("accountant");
    const c = await refused(() => C.updateReach(mine, { email: "mine@clientson.example.com" }), "PT409", "a stale version");
    same(c.current && c.current.email, "theirs@clientson.example.com", "theirs shown");
    for (const k of ["lead", "field", "viewer"]) {
      await asKey(k);
      const now = await fresh(K.client);
      await refused(() => C.updateReach(now, { phone: "805 555 0100" }), "42501", k);
    }
    await sql("reset role");
    same((await row(K.client)).email, "theirs@clientson.example.com", "nothing of theirs changed");
  });

  await check("Books A3 search(q) carries picture_path, and map/search.js keeps it; The Books read the contacts with their picture and version", async () => {
    await asKey("field");
    const raw = await searchRepo.raw("Pictureton");
    const hit = (raw.contacts || []).find((x) => x.id === K.sub);
    ok(hit && "picture_path" in hit && C.picturePathOk(hit.picture_path), "the hit's picture");
    const g = MS.toGroups(raw, { q: "Pictureton" }).find((x) => x.key === "contacts");
    same(g.items[0].contact.picture_path, hit.picture_path, "kept on the contact");
    await asKey("accountant");
    const me = await sbm.me({ fresh: true });
    const d = await books.loadDesk(me);
    const sub = d.links.contacts.get(String(K.sub));
    ok(sub && C.picturePathOk(sub.picture_path) && typeof sub.version === "number", "loadDesk: the picture and the version");
  });

  await check("Books A3 drift: the demo database (tools/fake/p8-contacts.js) has every contact column the modules read, and the same key rule", async () => {
    const pe = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await pe.freshEngine();
    for (const cols of [C.CONTACT_COLS, books.CONTACT_COLS]) {
      for (const c of cols.split(",").map((x) => x.trim())) ok(c in engine.COLS.contacts, "the demo's contacts." + c);
    }
    const F = await pe.loadFake();
    same(String(F.p8PictureRe), String(C.PICTURE_RE), "the demo's key rule");
  });
}

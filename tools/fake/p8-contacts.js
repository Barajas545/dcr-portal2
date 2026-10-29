/* DCR Portal 2 — DEMO MODE ONLY: contact pictures and a contact's reach in the in-memory database (the Books program,
   release A3; DCR Desktop 2 migration 20261030000200_contacts_pictures_vendors, docs/DATABASE.md §32). Loaded before
   seed.js and fake-supabase.js (tools/devserve.mjs FAKE_PARTS, tests/pages-engine.mjs: it has no table list for
   engine.js to read when it loads); installed into each engine (NS.extInstall), its made-up pictures added to the seed
   (NS.extSeed). Never published (tools/ is not part of the site).

   The same rules as the migration, as far as the pages can tell:
   * contacts.picture_path: NULL or "<contact id>/<uuid>.<jpg|png|webp>" (app.contact_picture_path_ok: the uuid dashed
     and lower case) - 23514 contacts_picture_path_shape; a person's write names THIS contact in the key (23514, the
     migration's sentence); one contact per key (23505 contacts_picture_path_key);
   * the contacts rules the contact card meets (they were the database's before this migration, and the demo had not
     modelled them): the e-mail trimmed ('' = none) and one live contact per e-mail, any case (23505 contacts_email_key,
     t11_contacts_email); the phone tidied (t15_phone, app.format_phone's plain cases: tools/fake/p5c-lists.js);
   * the bucket contact-pictures (its keys are this extension's: "<digits>/<one part>"): an upload needs the key's
     shape, a contact editor (admin, manager, accountant) and a LIVE contact named by the first part; a picture is read
     by whoever can read a contact pointing at it (a deleted contact's: an admin; the agents account: none; a replaced
     picture or one never linked: nobody); no overwrite; only an admin removes one (the engine's remove);
   * rpc search: a contact hit carries picture_path (the core search, then the column).
   Not modelled: a contact INSERT carrying a picture (the pages never insert contacts), the bucket's size and type
   limits (the engine's Storage knows no bucket; tools/schema-check-p8-contacts.mjs runs them against the real one).
   Made-up pictures only: two subcontractors' (their bytes are the demo's generated placeholder art). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const PICTURE_RE = /^[1-9][0-9]{0,17}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
  const OWNS = /^[0-9]+\/[^/]+$/;            // the keys of the bucket contact-pictures (project-files' start p/ or f/)
  const EDITORS = ["admin", "manager", "accountant"];
  const SEED_PICTURES = [["Rosewell Concrete", "6f1c2a4e-8b3d-4c5e-9a70-1b2c3d4e5f60"], ["Brightwater Concrete", "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d"]];
  NS.p8PictureRe = PICTURE_RE;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS: ECOLS, PgErr, rule, readable } = E;
    if (ECOLS.contacts && !("picture_path" in ECOLS.contacts)) ECOLS.contacts.picture_path = null;
    const fmt = typeof NS.p5cFormatPhone === "function" ? NS.p5cFormatPhone : (v) => v;
    let inSearch = false;

    function guardUpdate(w, table, old, r, patch) {
      if (table !== "contacts") return;
      if ("picture_path" in patch && r.picture_path !== old.picture_path) {
        const p = r.picture_path;
        if (p !== null && p !== undefined) {
          if (typeof p !== "string" || !PICTURE_RE.test(p)) {
            throw rule("23514", 'new row for relation "contacts" violates check constraint "contacts_picture_path_shape"');
          }
          if (w.uid && p.split("/")[0] !== String(r.id)) {
            throw rule("23514", "a contact's picture is stored under that contact: add the contact first, then its picture");
          }
          if (rows.contacts.some((c) => c.id !== r.id && c.picture_path === p)) {
            throw new PgErr("23505", 'duplicate key value violates unique constraint "contacts_picture_path_key"', 409);
          }
        } else {
          r.picture_path = null;
        }
      }
      if ("email" in patch) {
        const e = String(r.email == null ? "" : r.email).replace(/^[\s ]+|[\s ]+$/g, "");
        r.email = e || null;
        if (r.email && !r.deleted_at && rows.contacts.some((c) => c.id !== r.id && !c.deleted_at && c.email &&
            String(c.email).toLowerCase() === r.email.toLowerCase())) {
          throw new PgErr("23505", 'duplicate key value violates unique constraint "contacts_email_key"', 409,
            "Key (lower(email))=(" + r.email.toLowerCase() + ") already exists.");
        }
      }
      if ("phone" in patch && r.phone !== null && r.phone !== undefined) r.phone = fmt(r.phone) || null;
    }

    /* Storage: the bucket contact-pictures */
    const editor = (w) => !!w.active && EDITORS.includes(w.role);
    function canUploadObject(w, key) {
      if (!PICTURE_RE.test(key) || !editor(w)) return false;
      const id = Number(key.split("/")[0]);
      return rows.contacts.some((c) => c.id === id && !c.deleted_at);
    }
    function canReadObject(w, key) {
      return readable(w, "contacts").some((c) => c.picture_path === key);
    }

    function rpc(w, name, args) {
      // the core search, then picture_path on each contact hit (as the re-made search(q) answers it)
      inSearch = true;
      let res;
      try { res = E.callRpc(w, "search", args); } finally { inSearch = false; }
      const byId = new Map(rows.contacts.map((c) => [c.id, c]));
      (res && Array.isArray(res.contacts) ? res.contacts : []).forEach((c) => {
        const row = byId.get(c.id);
        c.picture_path = row && row.picture_path ? row.picture_path : null;
      });
      return res;
    }

    return {
      name: "p8-contacts", tables: new Set(["contacts"]), canRead: () => false, guardUpdate,
      handles: (n) => n === "search" && !inSearch, rpc,
      ownsObject: (key) => OWNS.test(String(key || "")),
      canUploadObject, canReadObject, canReplaceObject: () => false,
    };
  });

  /* ── made-up pictures (after seed.js made the contacts) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedP8(out) {
    (out.contacts || []).forEach((c) => { if (!("picture_path" in c)) c.picture_path = null; });
    out.objects = out.objects || {};
    for (const [company, uuid] of SEED_PICTURES) {
      const c = (out.contacts || []).find((x) => x.company === company);
      if (!c) continue;
      c.picture_path = c.id + "/" + uuid + ".jpg";
      out.objects[c.picture_path] = { size: 38214, mime: "image/jpeg", owner: c.created_by || null, created_at: c.created_at || null };
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

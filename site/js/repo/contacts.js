/* A contact's picture and how to reach them, on the web (the Books program, release A3: "contacts get a picture";
   Books plan decision I5 and §4.2; DCR Desktop 2 migration 20261030000200_contacts_pictures_vendors, docs/DATABASE.md
   §32). Everything else about a contact is edited in DCR Desktop 2.

   The picture lives in its own PRIVATE Storage bucket, contact-pictures (at most 2 MiB of JPEG, PNG or WebP: the
   bucket's own limits), at "<contact id>/<uuid>.jpg" - the uuid in its dashed, lower-case form, a new one for every
   picture, so the path is the cache key. contacts.picture_path points at it (NULL: initials). Storage lets a contact
   editor (app.can_edit('contacts'): an admin, a manager or an accountant) add a picture for a LIVE contact named by the
   first part of the key, and anybody who can read the contact read the one it points at; nobody overwrites an
   object, only an admin removes one (a replaced picture stays in the bucket until an admin sweeps).

   * PICTURE_BUCKET, PICTURE_RE       the bucket, and app.contact_picture_path_ok's shape (picturePathOk);
   * pictureKey(id, uuid)             the key of a new picture (newUuid: crypto.randomUUID's form);
   * CONTACT_COLS                     what the card and the pictures read (picture_path and version included);
   * contactRows(read, cols)          read(cols) - and, on a database without contacts.picture_path yet (42703 /
                                      PGRST204), read again without it: the pages show initials whichever deploys first;
   * getContact(id)                   one contact, fresh, as the card shows it -> {row, pictures: true | false} | null;
   * pictureUrls(list)                {path: signed url} for the contacts' pictures (an hour; 100 a call; remembered
                                      for the page; a picture this person may not read is simply absent);
   * setPicture(contact, pic)         pic: thumb-prep.js prepare(file, {maxSide: 400, square: true}) - the upload
                                      (upsert false), then ONE column: a versioned PATCH of picture_path, retried once at
                                      the new version when someone changed the contact meanwhile (PT409) -> the row;
   * clearPicture(contact)            the same PATCH to NULL (initials again) -> the row;
   * updateReach(contact, {phone, email})
                                      a versioned PATCH of the phone and e-mail given (the database tidies the phone and
                                      trims the e-mail); another live contact with that e-mail is 23505 "Another contact
                                      already has this e-mail."; a change by someone else meanwhile is PT409 - unless
                                      it left the phone and e-mail as this person read them (a new picture, say): then
                                      it is sent again once at the new version -> the row;
   * reachProblem({phone, email})     the sentence for a phone or e-mail the card will not send, or "";
   * forgetPictures()                 forget the signed addresses (signing out, the tests).
   A write the database refuses is its error (42501, PT404, PT409, 23505, 23514), as _db.js throws it. */

import { db, must, idOf, versioned, isConflict } from "./_db.js";

export const PICTURE_BUCKET = "contact-pictures";
export const PICTURE_SIDE = 400;                       // a 400 x 400 square (Books plan §4.2; Desktop 2's prepare_square)
export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;      // the bucket's file_size_limit (2,097,152)
export const SIGN_S = 3600;                            // a signed address lasts an hour ...
const REUSE_MS = 50 * 60 * 1000;                       // ... and is used again for 50 minutes
const SIGN_BATCH = 100;
export const EMAIL_MAX = 254;
export const PHONE_MAX = 60;

// app.contact_picture_path_ok: the id without leading zeros (at most 18 digits), the dashed lower-case uuid, nothing else
export const PICTURE_RE = /^[1-9][0-9]{0,17}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
export function picturePathOk(p) { return typeof p === "string" && PICTURE_RE.test(p); }

export const CONTACT_COLS = "id, name, company, kind, email, phone, picture_path, deleted_at, version";

/** A dashed, lower-case version 4 uuid (crypto.randomUUID, or the same from getRandomValues). */
export function newUuid() {
  const C = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (C && typeof C.randomUUID === "function") return String(C.randomUUID()).toLowerCase();
  const b = new Uint8Array(16);
  if (C && typeof C.getRandomValues === "function") C.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
}

/** "<contact id>/<uuid>.jpg" */
export function pictureKey(contactId, uuid) {
  const key = String(idOf(String(contactId))) + "/" + String(uuid || newUuid()).toLowerCase() + ".jpg";
  if (!picturePathOk(key)) throw local("That contact can't have a picture (no id).", "22023");
  return key;
}

function local(message, code) {
  const e = new Error(message);
  e.code = code || "local_rule"; e.status = 400; e.own = true;
  return e;
}

/* ── the column, whichever deploys first ─────────────────────────── */

let noPictureColumn = false;

export function missingPictureColumn(e) {
  const code = String((e && e.code) || "");
  return (code === "42703" || code === "PGRST204") && /picture_path/.test(String((e && e.message) || "") + String((e && e.details) || ""));
}

export function withoutPicture(cols) {
  return String(cols).split(",").map((s) => s.trim()).filter((s) => s && s !== "picture_path").join(", ");
}

/** read(cols) with contacts.picture_path; a database without it yet is asked again without it (and remembered). */
export async function contactRows(read, cols) {
  const want = cols || CONTACT_COLS;
  if (!noPictureColumn) {
    try { return await read(want); } catch (e) {
      if (!missingPictureColumn(e)) throw e;
      noPictureColumn = true;
    }
  }
  return read(withoutPicture(want));
}

/** Whether this database has contact pictures (false only after a read found the column missing). */
export function picturesReady() { return !noPictureColumn; }

/** Ask for the column again from the next read on (after the database update; the tests). */
export function forgetPictureColumn() { noPictureColumn = false; }

/** One contact, fresh -> {row, pictures} or null (gone, or not this person's to read). */
export async function getContact(id) {
  const c = await db();
  const rows = await contactRows(async (cols) => must(await c.from("contacts").select(cols).eq("id", idOf(String(id)))) || []);
  return rows.length ? { row: rows[0], pictures: !noPictureColumn } : null;
}

/* ── the pictures' signed addresses ──────────────────────────────── */

const signed = new Map();         // path -> {url | null, at}

function pathOf(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  const p = x.picture_path !== undefined ? x.picture_path : x.picturePath;
  return typeof p === "string" ? p : null;
}

/** {path: url} for the pictures of `list` (contact rows, objects with picturePath, or paths); unreadable ones absent. */
export async function pictureUrls(list) {
  const want = Array.from(new Set((list || []).map(pathOf).filter(picturePathOk)));
  const now = Date.now();
  const missing = want.filter((p) => { const s = signed.get(p); return !s || now - s.at > REUSE_MS; });
  if (missing.length) {
    const c = await db();
    const b = c.storage.from(PICTURE_BUCKET);
    for (let i = 0; i < missing.length; i += SIGN_BATCH) {
      const part = missing.slice(i, i + SIGN_BATCH);
      try {
        if (typeof b.createSignedUrls === "function") {
          const res = await b.createSignedUrls(part, SIGN_S);
          if (!res || res.error) continue;                 // the whole call failed: tried again next time
          const got = new Map();
          (res.data || []).forEach((x) => { if (x && x.path && !x.error && (x.signedUrl || x.signedURL)) got.set(x.path, x.signedUrl || x.signedURL); });
          part.forEach((p) => signed.set(p, { url: got.get(p) || null, at: now }));
        } else {
          await Promise.all(part.map(async (p) => {
            const r = await b.createSignedUrl(p, SIGN_S);
            if (r && !r.error && r.data) signed.set(p, { url: r.data.signedUrl || r.data.signedURL || null, at: now });
            else if (r && r.error) signed.set(p, { url: null, at: now });
          }));
        }
      } catch (e) { /* no connection: initials now, signed next time */ }
    }
  }
  const out = {};
  want.forEach((p) => { const s = signed.get(p); if (s && s.url) out[p] = s.url; });
  return out;
}

export function forgetPictures() {
  signed.forEach((s) => { if (s && s.local && typeof URL !== "undefined" && URL.revokeObjectURL) { try { URL.revokeObjectURL(s.url); } catch (e) { /* */ } } });
  signed.clear();
}

/* ── writes ──────────────────────────────────────────────────────── */

function storageFailure(err, what) {
  const sc = Number(err.statusCode || err.status || 0);
  const msg = String(err.message || "");
  if (sc === 403 || /row-level security|unauthorized|not allowed/i.test(msg)) {
    const e = local("You can't change this contact's picture: only an admin, a manager or an accountant changes contact pictures, " +
      "and only on a contact that is not deleted.", "42501");
    e.status = 403;
    return e;
  }
  if (sc === 413 || /maximum allowed size|too large/i.test(msg)) return local("That picture is larger than 2 MB.", "too_large");
  if (sc === 415 || /mime type/i.test(msg)) return local("A contact picture must be a JPEG, PNG or WebP picture.", "22023");
  const e = new Error(msg || "The " + what + " could not be uploaded.");
  e.code = "storage"; e.status = sc || 0;
  return e;
}

async function patch(contact, body) {
  return contactRows((cols) => versioned("contacts", idOf(String(contact.id)), contact.version, body, cols));
}

/** The picture column only, at the contact's version - once more at the new one when someone changed it meanwhile. */
async function pointAt(contact, path) {
  try {
    return await patch(contact, { picture_path: path });
  } catch (e) {
    if (missingPictureColumn(e)) throw local("Contact pictures arrive with the next database update.", "PGRST204");
    if (!isConflict(e) || !e.current || e.current.version === undefined || e.current.version === null) throw e;
    return patch(Object.assign({}, contact, { version: e.current.version }), { picture_path: path });
  }
}

/** pic: {blob, mime: "image/jpeg"} (thumb-prep.js prepare with {maxSide: 400, square: true}). -> the contacts row. */
export async function setPicture(contact, pic) {
  if (!contact || contact.id === undefined || contact.id === null) throw local("Which contact?", "22023");
  if (!pic || !pic.blob || !pic.blob.size) throw local("The picture is empty.", "22023");
  if (pic.blob.size > PICTURE_MAX_BYTES) throw local("That picture is larger than 2 MB.", "too_large");
  const mime = String(pic.mime || pic.blob.type || "").toLowerCase();
  if (mime !== "image/jpeg") throw local("A contact picture is stored as a JPEG.", "22023");
  if (noPictureColumn) throw local("Contact pictures arrive with the next database update.", "PGRST204");
  const key = pictureKey(contact.id);
  const c = await db();
  const up = await c.storage.from(PICTURE_BUCKET).upload(key, pic.blob, { upsert: false, contentType: mime, cacheControl: "3600" });
  if (up && up.error) throw storageFailure(up.error, "picture");
  // the upload is this person's own: shown at once from its bytes, never signed and fetched again
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try { signed.set(key, { url: URL.createObjectURL(pic.blob), at: Date.now(), local: true }); } catch (e) { /* signed when shown */ }
  }
  return pointAt(contact, key);
}

/** Initials again (the old picture stays in the bucket, unread, until an admin sweeps). -> the contacts row. */
export async function clearPicture(contact) {
  if (!contact || contact.id === undefined || contact.id === null) throw local("Which contact?", "22023");
  return pointAt(contact, null);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function oneLine(v) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); }

/** The sentence for a phone or e-mail the card won't send, or "". */
export function reachProblem(f) {
  const x = f || {};
  if (x.email !== undefined && x.email !== null) {
    const e = oneLine(x.email);
    if (e && (e.length > EMAIL_MAX || !EMAIL_RE.test(e))) return "That e-mail doesn't look right: it should be like name@example.com.";
  }
  if (x.phone !== undefined && x.phone !== null) {
    const p = oneLine(x.phone);
    if (p.length > PHONE_MAX) return "That phone number is too long.";
    if (p && (p.match(/[0-9]/g) || []).length < 7) return "That phone number has too few digits.";
  }
  return "";
}

/** reach: {phone?, email?} (a key left out is unchanged; "" clears it). -> the contacts row. */
export async function updateReach(contact, reach) {
  if (!contact || contact.id === undefined || contact.id === null) throw local("Which contact?", "22023");
  const r = reach || {};
  const body = {};
  if (r.phone !== undefined) body.phone = oneLine(r.phone) || null;
  if (r.email !== undefined) body.email = oneLine(r.email) || null;
  const problem = reachProblem(body);
  if (problem) throw local(problem, "22023");
  if (!Object.keys(body).length) return contact;
  const dup = (e) => {
    if (String(e && e.code) !== "23505") return e;
    const x = local("Another contact already has this e-mail.", "23505");
    x.status = 409;
    return x;
  };
  try {
    return await patch(contact, body);
  } catch (e) {
    if (!isConflict(e) || !e.current) throw dup(e);
    // changed meanwhile - but not its phone or e-mail (a new picture, say): this person's words go on top, once
    const cur = e.current;
    const same = (k) => String(cur[k] == null ? "" : cur[k]) === String(contact[k] == null ? "" : contact[k]);
    if (!same("phone") || !same("email") || cur.version === undefined || cur.version === null) throw e;
    try { return await patch(Object.assign({}, contact, { version: cur.version }), body); } catch (e2) { throw dup(e2); }
  }
}

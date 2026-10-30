/* The vendor list's reads and its one write (books-vendors.html; the Books program, release B part 2b: DCR Desktop 2
   migrations 20261030000500_books_reports - books_vendor_balances, docs/DATABASE.md §35.3 - and
   20261030000200_contacts_pictures_vendors - vendor_profiles, §32.2). Everything is read under row level security as
   `me`, and NOTHING without the financials switch (seesBooks(me) refuses before any read).

   * loadVendors(me)      WITH the prices switch: rpc books_vendor_balances() (the database's own sums: owed, past due,
                          paid this year and last, and the vendor's facts with the W-9 / insurance / workers' comp flags);
                          WITHOUT it (S4: books_vendor_balances needs prices, and no amount is ever read then): the live
                          subcontractor, supplier and service contacts and the vendor_profiles rows - the facts only.
                          Both: the vendor_profiles rows (notes and version, for the edit sheet) and the contacts behind
                          the vendors (their pictures, for the avatars and the contact card) -> {vendors (map/vendors.js),
                          contacts: Map, prices, today, can};
   * saveProfile(v, fields)   the vendor details, an UPSERT on contact_id for the money editors that never overwrites
                          anyone silently: a vendor with no details yet is inserted (ON CONFLICT DO NOTHING - when
                          somebody added them meanwhile nothing is written and the answer is "changed by someone else",
                          PT409); one with details is a versioned PATCH (?contact_id=eq.X&version=eq.V: PT409 when it
                          moved on). Dates and flags only (never a tax id, S12); the database tidies the words. */

import { db, must, idOf, forbidden, conflict } from "./_db.js";
import { contactRows } from "./contacts.js";
import { seesBooks, canMoney } from "../map/books.js";
import { toVendor, factsVendor, withProfiles, sortVendors, profileBody, profileProblem } from "../map/vendors.js";
import { ymd } from "../map/pacific.js";

export const PROFILE_COLS = "contact_id, tax_1099, legal_name, w9_received_on, insurance_expires_on, workers_comp_expires_on, workers_comp_exempt, " +
  "license_number, notes, version";
export const CONTACT_COLS = "id, name, company, kind, email, phone, picture_path, deleted_at, version";
export const VENDOR_KINDS = Object.freeze(["subcontractor", "supplier", "service"]);

export function seesPrices(me) { return !!me && (me.role === "admin" || !!me.can_see_prices); }

function noBooks() {
  const e = forbidden();
  e.message = "The vendor list needs the financials switch. Ask an admin.";
  return e;
}
function local(message, code) {
  const e = new Error(message);
  e.code = code;
  e.status = 400;
  return e;
}

async function byIds(c, table, cols, col, list) {
  const want = Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined).map((v) => idOf(String(v)))));
  const out = [];
  for (let i = 0; i < want.length; i += 150) {
    (must(await c.from(table).select(cols).in(col, want.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}

/** Everything the vendor list shows, read as `me` (see the header). */
export async function loadVendors(me) {
  if (!seesBooks(me)) throw noBooks();
  const prices = seesPrices(me);
  const c = await db();
  const today = ymd(new Date());
  const profiles = must(await c.from("vendor_profiles").select(PROFILE_COLS).order("contact_id", { ascending: true })) || [];
  let vendors;
  let contacts;
  if (prices) {
    const rows = must(await c.rpc("books_vendor_balances", {})) || [];
    vendors = (Array.isArray(rows) ? rows : []).map(toVendor);
    const ids = vendors.map((v) => v.contactId).filter((x) => x !== null);
    contacts = await contactRows(async (cols) => byIds(c, "contacts", cols, "id", ids), CONTACT_COLS);
  } else {
    // the facts only: the vendor contacts, and any contact with vendor details
    const kinds = await contactRows(async (cols) => must(await c.from("contacts").select(cols).in("kind", VENDOR_KINDS.slice()).is("deleted_at", null)) || [], CONTACT_COLS);
    const extra = profiles.map((p) => p.contact_id).filter((id) => !kinds.some((k) => String(k.id) === String(id)));
    const more = extra.length ? await contactRows(async (cols) => byIds(c, "contacts", cols, "id", extra), CONTACT_COLS) : [];
    contacts = kinds.concat(more.filter((k) => !k.deleted_at));
    const by = new Map(profiles.map((p) => [String(p.contact_id), p]));
    vendors = contacts.map((k) => factsVendor(k, by.get(String(k.id)) || null, today));
  }
  return {
    vendors: sortVendors(withProfiles(vendors, profiles)),
    contacts: new Map((contacts || []).map((k) => [String(k.id), k])),
    profiles, prices, today,
    can: { money: canMoney(me) },
  };
}

/** Save a vendor's details as they were shown (v.profileVersion: null when it had none) -> the vendor_profiles row. */
export async function saveProfile(v, fields) {
  if (!v || v.contactId === null || v.contactId === undefined) throw local("Only a vendor linked to a contact has vendor details: link the bill to a contact in DCR Desktop 2.", "22023");
  const problem = profileProblem(fields);
  if (problem) throw local(problem, "22023");
  const body = profileBody(fields);
  const c = await db();
  const id = idOf(String(v.contactId));
  if (v.profileVersion === null || v.profileVersion === undefined) {
    const made = must(await c.from("vendor_profiles").upsert(Object.assign({ contact_id: id }, body), { onConflict: "contact_id", ignoreDuplicates: true })
      .select(PROFILE_COLS)) || [];
    if (made.length) return made[0];
    // somebody added this vendor's details meanwhile: nothing written - say so, with theirs
    const cur = must(await c.from("vendor_profiles").select(PROFILE_COLS).eq("contact_id", id)) || [];
    if (cur.length) throw conflict(cur[0]);
    throw forbidden();
  }
  const rows = must(await c.from("vendor_profiles").update(body).eq("contact_id", id).eq("version", v.profileVersion).select(PROFILE_COLS)) || [];
  if (rows.length) return rows[0];
  const cur = must(await c.from("vendor_profiles").select(PROFILE_COLS).eq("contact_id", id)) || [];
  if (cur.length && Number(cur[0].version) !== Number(v.profileVersion)) throw conflict(cur[0]);
  throw forbidden();
}

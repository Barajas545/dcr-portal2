/* The Progress Chart's data (BLUEPRINT 3.3.11 "Progress Chart (PM)", Appendix A "pm": selects plus
   quote_commitments and estimate_item_flags; quote_follow_up). Replaces the old one-call aggregation
   (?action=pm): every read is a plain select under row level security, chosen by what the person may see,
   so a REST answer never carries a column the page would have to hide (acceptance check 1):

   * everyone who may open a project: the project, its status rows (the milestone dates), its live
     estimates and items, the contacts they are assigned to / quoted by, the item flags (M5a), the quotes and change
     orders WITHOUT money (Q11: quotes are read by every active person; their amount, the vendor's priced
     document and their notes - which name the price - are in quote_prices), estimate_item_totals.priced (the
     database's yes / no "the item has a price", the same for every reader - never a money column),
     the takeoffs (lines counted), the item documents, the tasks (Q3 decides whose);
   * with the prices switch: estimate_item_totals.total, estimate_item_prices.quoted_price and the
     prices:quote_prices(amount, document_url, notes) embed (it would come back null without the switch);
   * with prices AND financials (the money tiles): bills (+ payments), invoices (+ lines, client payments),
     costs and the quote_commitments view.

   Writes: setFlag / clearFlag (estimate_item_flags: estimate editors and leads - versioned), followUp
   (rpc quote_follow_up: the database stamps the company day and counts). The stage and the quick note
   reuse repo/projects.js setStatus and repo/activity.js addNote. */

import { db, must, idOf, conflict, notFound, forbidden, pageAll } from "./_db.js";
import { toPayload, seesPrices, seesMoney, cleanFlag } from "../map/pm.js";
import { nameBook } from "./people.js";
import { ymd } from "../map/pacific.js";

export const ITEM_COLS = "id, estimate_id, project_id, group_name, group_code, sort, name, description, material_description, item_type, " +
  "assigned_contact_id, assigned_text, deleted_at";
export const QUOTE_COLS = "id, project_id, estimate_item_id, vendor_contact_id, vendor_name, kind, status, requested_date, received_date, " +
  "follow_ups, last_follow_up, version";
// a quote's money and notes (quote_prices, the prices switch)
export const QUOTE_PRICE_EMBED = "prices:quote_prices(amount, document_url, notes)";
export const ESTIMATE_COLS = "id, project_id, number, kind, co_number, name, status, group_order, archived_at, deleted_at";
export const TASK_COLS = "id, project_id, estimate_item_id, title, description, category, priority, assigned_to, status, created_at, completed_at";
export const FILE_COLS = "id, project_id, estimate_item_id, folder, name, storage, storage_path, size, created_at, modified_at";
// a bill's payments with the check register's void (the Books program, release A; migration 20261030000300): a voided
// payment is paid against nothing (map/pm.js toBill). A database without the column yet: read again without it.
const BILL_ROW_COLS = "id, project_id, estimate_item_id, quote_id, vendor_name, invoice_number, invoice_date, due_date, amount, " +
  "description, document_file_id, void, approved_by, approved_at, approved_amount, pay_method, deleted_at, ";
export const BILL_COLS = BILL_ROW_COLS + "payments(amount, voided_at)";
export const BILL_COLS_BEFORE = BILL_ROW_COLS + "payments(amount)";
export const INVOICE_COLS = "id, project_id, number, status, invoice_date, sent_date, due_date, deleted_at, " +
  "invoice_lines(estimate_id, amount), client_payments(amount)";
export const COST_COLS = "id, project_id, estimate_item_id, cost_date, kind, description, vendor, amount";
const IDS_PER_READ = 150;

/** read(cols) with the payments' void column; a database without it yet (42703 / PGRST204 naming it) is asked again
    with `before`. */
export async function withVoids(read, cols, before) {
  try { return await read(cols); } catch (e) {
    const code = String((e && e.code) || "");
    if (!((code === "42703" || code === "PGRST204") && /\bvoided_at\b/.test(String((e && e.message) || "") + " " + String((e && e.details) || "")))) throw e;
  }
  return read(before);
}

/** rows of `table` whose `col` is one of `ids`, 150 ids a read (a URL stays short) */
async function byIds(c, table, cols, col, ids) {
  const list = Array.from(new Set((ids || []).filter(function (v) { return v !== null && v !== undefined; }).map(idOf)));
  const out = [];
  for (let i = 0; i < list.length; i += IDS_PER_READ) {
    (must(await c.from(table).select(cols).in(col, list.slice(i, i + IDS_PER_READ))) || []).forEach(function (r) { out.push(r); });
  }
  return out;
}

/** Everything the chart draws for project `projectId`, read as `me` -> {payload, rows}. Plain selects (no embed
    across the estimate tables), so the same calls work against Supabase and the demo. */
export async function load(projectId, me, opts) {
  const o = opts || {};
  const c = await db();
  const pid = idOf(projectId);
  const prices = seesPrices(me);
  const money = seesMoney(me);

  const projRows = must(await c.from("projects").select("*").eq("id", pid)) || [];
  if (!projRows.length) throw notFound("That project");

  const ACT = "id, kind, text, from_status, to_status, created_at";
  const [statusRows, oldStatusRows, estimates, items, quotes, takeoffs, takeoffRows, files, tasks, nameOf, totals, money1] = await Promise.all([
    // the status rows (the database writes them) and an imported line of the old portal's "Status changed: …"
    c.from("activity").select(ACT).eq("project_id", pid).eq("kind", "status").order("created_at", { ascending: true }).range(0, 999).then(must),
    c.from("activity").select(ACT).eq("project_id", pid).ilike("text", "Status changed%").order("created_at", { ascending: true }).range(0, 299).then(must),
    c.from("estimates").select(ESTIMATE_COLS).eq("project_id", pid).order("number", { ascending: true }).then(must),
    pageAll(function (cl) { return cl.from("estimate_items").select(ITEM_COLS).eq("project_id", pid).order("id", { ascending: true }); }),
    c.from("quotes").select(QUOTE_COLS + (prices ? ", " + QUOTE_PRICE_EMBED : "")).eq("project_id", pid)
      .order("id", { ascending: true }).range(0, 1999).then(must),
    c.from("takeoffs").select("id, estimate_item_id, name").eq("project_id", pid).then(must),
    pageAll(function (cl) { return cl.from("takeoff_rows").select("id, takeoff_id").eq("project_id", pid).order("id", { ascending: true }); }),
    c.from("current_files").select(FILE_COLS).eq("project_id", pid).eq("folder", "item").order("created_at", { ascending: false }).then(must),
    c.from("tasks").select(TASK_COLS).eq("project_id", pid).order("created_at", { ascending: false }).range(0, 999).then(must),
    nameBook(),
    // "priced" for everyone (the same yes / no); the total only with prices - never a money column otherwise
    c.from("estimate_item_totals").select(prices ? "item_id, priced, total" : "item_id, priced").eq("project_id", pid).then(must),
    money ? Promise.all([
      withVoids((cols) => c.from("bills").select(cols).eq("project_id", pid).order("due_date", { ascending: true }).then(must), BILL_COLS, BILL_COLS_BEFORE),
      c.from("invoices").select(INVOICE_COLS).eq("project_id", pid).order("invoice_date", { ascending: false }).then(must),
      c.from("costs").select(COST_COLS).eq("project_id", pid).order("cost_date", { ascending: false }).range(0, 1999).then(must),
      // M5a's roll-up (financials; committed needs prices too): an error here is shown, not drawn as "no commitments"
      c.from("quote_commitments").select("*").eq("project_id", pid).then(must),
    ]) : Promise.resolve(null),
  ]);
  const liveIds = (items || []).filter(function (it) { return !it.deleted_at; }).map(function (it) { return it.id; });
  const contactIds = (items || []).map(function (it) { return it.assigned_contact_id; })
    .concat((quotes || []).map(function (q) { return q.vendor_contact_id; }));
  const [flags, itemPrices, contacts] = await Promise.all([
    // the item flags (M5a): whoever reads the item reads its flags
    byIds(c, "estimate_item_flags", "*", "item_id", liveIds),
    prices ? byIds(c, "estimate_item_prices", "item_id, quoted_price", "item_id", liveIds) : Promise.resolve(null),
    byIds(c, "contacts", "id, name, company, email", "id", contactIds),
  ]);
  const rowsOfTakeoff = {};
  (takeoffRows || []).forEach(function (r) { rowsOfTakeoff[String(r.takeoff_id)] = (rowsOfTakeoff[String(r.takeoff_id)] || 0) + 1; });
  const rows = {
    project: projRows[0],
    activity: (statusRows || []).concat((oldStatusRows || []).filter(function (r) { return r.kind !== "status"; })),
    estimates: estimates || [],
    items: items || [],
    flags: flags,
    itemPrices: itemPrices,
    quotes: quotes || [],
    contacts: contacts,
    takeoffs: (takeoffs || []).map(function (t) { return Object.assign({}, t, { rows: rowsOfTakeoff[String(t.id)] || 0 }); }),
    files: files || [],
    tasks: tasks || [],
    totals: totals,
    bills: money1 ? money1[0] || [] : null,
    invoices: money1 ? money1[1] || [] : null,
    costs: money1 ? money1[2] || [] : null,
    commitments: money1 ? money1[3] : null,
  };
  const payload = toPayload(rows, { today: o.today || ymd(new Date()), prices: prices, money: money, nameOf: nameOf, mask: o.mask });
  return { payload: payload, rows: rows };
}

/* ── item flags (M5a: estimate_item_flags, one row per item) ── */

/** Set the flag of item `itemId`. `current` is the flag on screen ({version}) or null when there is none. */
export async function setFlag(itemId, state, note, due, current) {
  const body = cleanFlag(state, note, due);
  const c = await db();
  const iid = idOf(itemId);
  if (current && current.version != null) {
    const rows = must(await c.from("estimate_item_flags").update(body).eq("item_id", iid).eq("version", current.version).select("*")) || [];
    if (rows.length) return rows[0];
    const now = must(await c.from("estimate_item_flags").select("*").eq("item_id", iid)) || [];
    if (now.length && Number(now[0].version) === Number(current.version)) throw forbidden();
    throw conflict(now[0] || null);
  }
  const res = await c.from("estimate_item_flags").insert(Object.assign({ item_id: iid }, body)).select("*");
  if (res && res.error && (res.error.code === "23505" || res.error.code === "409")) {
    const now = must(await c.from("estimate_item_flags").select("*").eq("item_id", iid)) || [];
    throw conflict(now[0] || null);
  }
  const rows = must(res) || [];
  return rows[0] || null;
}

/** Clear the flag as it was shown: someone who changed it meanwhile wins (PT409 with theirs). */
export async function clearFlag(itemId, current) {
  const c = await db();
  const iid = idOf(itemId);
  let q = c.from("estimate_item_flags").delete().eq("item_id", iid);
  if (current && current.version != null) q = q.eq("version", current.version);
  const gone = must(await q.select("item_id")) || [];
  if (gone.length) return true;
  const now = must(await c.from("estimate_item_flags").select("*").eq("item_id", iid)) || [];
  if (!now.length) return true;                                    // already cleared
  if (current && Number(now[0].version) === Number(current.version)) throw forbidden();
  throw conflict(now[0]);
}

/* ── quotes ── */

/** One more follow-up today (rpc quote_follow_up: the company day and the count are the database's). */
export async function followUp(quoteId) {
  const c = await db();
  const res = must(await c.rpc("quote_follow_up", { p_id: idOf(quoteId) }));
  return Array.isArray(res) ? res[0] || null : res;
}

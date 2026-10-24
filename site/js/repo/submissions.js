/* Subcontractor submissions (submissions.html and the home page's card): their reads and the two review RPCs
   (BLUEPRINT 3.3.11 "Subcontractor form (public) and review", Appendix A "submissions", P5 5c, acceptance check 4).
   Replaces the old ?action=submissions: the rows are public.sub_submissions (migration M5c), written by the public
   Edge Function "subform" only (state pending), readable and reviewable by the money editors (an admin, or a manager
   or accountant with the financials switch). Nothing is asked without that (canReview(me)).

   Reads: list(me) - every submission (they are few) with its project's number and name and the reviewer's name, what
   became of the e-mail about each one still waiting (rpc sub_submission_notices: sent / waiting / not sent and why -
   the old page's "Nobody was emailed about this"), and whether an accepted invoice's bill is approved yet; the
   signature and the document are the Storage objects the row names (signature_path, document_path once
   document_attached_at is set: under f/, readable by whoever reads the submission - M5c's app.storage_can_read);
   quotesFor(projectId, me) - the quotes and change orders an invoice may be billed against (the amount only with the
   prices switch); pendingCount(me) - the home page's badge.
   Writes: accept(sub, quoteId) = rpc accept_submission(p_id, p_version, p_quote_id) -> the row: an invoice becomes a
   bill that is NOT approved (its document a receipts file, the bill's document_file_id), a change order becomes a
   change order of the job (awarded, its amount in quote_prices); reject(sub, note) = rpc reject_submission(p_id,
   p_version, p_note). The version is the one on screen (PT409 otherwise); a submission reviewed meanwhile says
   "already done" (23514). */

import { db, must, idOf, forbidden, pageAll } from "./_db.js";
import { nameBook } from "./people.js";
import { canReview, toSubmission, counts, REJECT_NOTE_MAX } from "../map/submissions.js";

export const SUB_COLS = "id, reference, kind, state, project_id, project_label, vendor_company, contact_name, contact_email, contact_phone, " +
  "invoice_number, amount, description, invoice_date, due_date, signature_name, signed_at, signature_path, document_path, document_name, " +
  "document_size, document_mime, document_attached_at, submitted_ip, reviewed_by, reviewed_at, review_note, bill_id, quote_id, " +
  "document_file_id, created_at, version";

function noReview() {
  const e = forbidden();
  e.message = "Subcontractor submissions need the financials switch. Ask an admin.";
  return e;
}

async function byIds(c, table, cols, ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v !== null && v !== undefined).map(idOf)));
  const out = [];
  for (let i = 0; i < list.length; i += 150) {
    (must(await c.from(table).select(cols).in("id", list.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}

/** What became of the e-mails about these submissions: Map String(id) -> {state, sentAt, why}. Never fails the list (an
    older database without the RPC, a hiccup): an empty map, and the cards say nothing about e-mail. */
async function noticesOf(c, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    try {
      const got = must(await c.rpc("sub_submission_notices", { p_ids: ids.slice(i, i + 400).map(idOf) })) || [];
      (Array.isArray(got) ? got : []).forEach((n) => out.set(String(n.id), n));
    } catch (e) { return out; }
  }
  return out;
}

/** Every submission, mapped: {all: [...], counts}. */
export async function list(me) {
  if (!canReview(me)) throw noReview();
  const c = await db();
  const rows = await pageAll((cl) => cl.from("sub_submissions").select(SUB_COLS).order("created_at", { ascending: false }).order("id", { ascending: false }));
  const waiting = rows.filter((r) => r.state === "pending").map((r) => r.id);
  const billIds = rows.filter((r) => r.state === "accepted" && r.bill_id).map((r) => r.bill_id);
  const [projRows, nameOf, notices, billRows] = await Promise.all([
    rows.length ? byIds(c, "projects", "id, number, name", rows.map((r) => r.project_id)) : Promise.resolve([]),
    nameBook(),
    waiting.length ? noticesOf(c, waiting) : Promise.resolve(new Map()),
    billIds.length ? byIds(c, "bills", "id, approved_at, void, deleted_at", billIds).catch(() => []) : Promise.resolve([]),
  ]);
  const projects = new Map(projRows.map((p) => [String(p.id), p]));
  const bills = new Map(billRows.map((b) => [String(b.id), b]));
  return { all: rows.map((r) => Object.assign(toSubmission(r, { projects, nameOf, notices, bills }), { created_at: r.created_at })), counts: counts(rows) };
}

/** How many are waiting (the home page's card): null when the person does not review them (nothing is read). */
export async function pendingCount(me) {
  if (!canReview(me)) return null;
  const rows = await pageAll((cl) => cl.from("sub_submissions").select("id").eq("state", "pending"));
  return rows.length;
}

/** The quotes and change orders of a job (for "bill against"): [{id, kind, status, vendor_name, amount|null}]. */
export async function quotesFor(projectId, me) {
  const c = await db();
  const prices = !!me && (me.role === "admin" || !!me.can_see_prices);
  const rows = must(await c.from("quotes").select("id, kind, status, vendor_name" + (prices ? ", prices:quote_prices(amount)" : ""))
    .eq("project_id", idOf(projectId)).order("id", { ascending: true })) || [];
  return rows.filter((q) => q.status !== "declined").map((q) => {
    const p = Array.isArray(q.prices) ? q.prices[0] : q.prices;
    return { id: q.id, kind: q.kind, status: q.status, vendor_name: q.vendor_name, amount: p && p.amount != null ? Number(p.amount) : null };
  });
}

function one(res) { return Array.isArray(res) ? res[0] || null : res; }

/** Accept (as shown: its version): an invoice -> a bill waiting for approval, a change order -> the job's change order. */
export async function accept(sub, quoteId) {
  const c = await db();
  const q = quoteId === "" || quoteId === null || quoteId === undefined ? null : idOf(String(quoteId));
  return one(must(await c.rpc("accept_submission", { p_id: idOf(sub.id), p_version: sub.version, p_quote_id: q })));
}

/** Reject (as shown), with an optional note (the subcontractor is not told automatically). */
export async function reject(sub, note) {
  const c = await db();
  const n = String(note == null ? "" : note).replace(/\s+/g, " ").trim().slice(0, REJECT_NOTE_MAX);
  return one(must(await c.rpc("reject_submission", { p_id: idOf(sub.id), p_version: sub.version, p_note: n || null })));
}

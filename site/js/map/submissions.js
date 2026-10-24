/* Subcontractor submissions (submissions.html): rows of public.sub_submissions (migration M5c) -> what the review
   page shows. Pure: no DOM, no network (tests/p5c-sub-*.test.mjs).

   A submission is a claim by somebody outside the company. Accepting it (rpc accept_submission) is the moment it
   becomes a record inside: an invoice becomes a bill that is NOT approved (it waits for approve_bill like any
   other), a change order becomes a change order on the job (awarded). Accepting is not approving. Who may review:
   an admin, or a manager or accountant with the financials switch (app.can_edit('money'), Appendix D) - the
   same people the database lets read the rows. */

import { canMoney, fmtMoney, num } from "./books.js";

export const STATES = Object.freeze({ pending: "Waiting", accepted: "Accepted", rejected: "Rejected" });
export const TABS = Object.freeze(["pending", "accepted", "rejected"]);
export const KIND_LABEL = Object.freeze({ invoice: "Invoice", change_order: "Change order" });
export const REJECT_NOTE_MAX = 300;

/** Who reviews: the money editors (the rows are theirs to read, the RPCs theirs to call). */
export function canReview(me) { return canMoney(me); }

function day(v) {
  const s = String(v || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** "Oct 21, 2026" from a YYYY-MM-DD (as written, no time zone sums). */
export function fmtDay(v) {
  const d = day(v);
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] + " " + dd + ", " + y;
}

/** A timestamp's company day (America/Los_Angeles) as YYYY-MM-DD. */
export function companyDay(ts) {
  if (!ts) return "";
  const t = new Date(ts);
  if (isNaN(t)) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const g = (k) => (p.find((x) => x.type === k) || {}).value;
  return g("year") + "-" + g("month") + "-" + g("day");
}

/** What the review queue says about the e-mail of a submission still waiting (rpc sub_submission_notices; the old
    page's "Nobody was emailed about this: <state>"): null when it went (or nothing is known), else {warn, text}. */
export function noticeLine(n, createdAt, now) {
  if (!n || n.state === "sent") return null;
  if (n.state === "waiting") {
    const age = (now === undefined ? Date.now() : now) - Date.parse(createdAt || "");
    return Number.isFinite(age) && age > 30 * 60000
      ? { warn: false, text: "The e-mail about it has not gone out yet (DCR Agents 2 sends it)." }
      : null;
  }
  const why = String(n.why || "");
  let text;
  if (/^expired/i.test(why)) text = "it was not sent within 3 days (is DCR Agents 2 running?)";
  else if (/turned off/i.test(why)) text = "these e-mails are turned off (DCR Desktop 2, Settings, Task notices)";
  else if (/nobody to tell/i.test(why)) text = "there was nobody to tell (no admin, accountant with financials or approver with an e-mail address)";
  else if (/no longer reviews/i.test(why)) text = "the people it was for no longer review submissions";
  else if (/no notice was written/i.test(why)) text = "no notice was written";
  else text = "the e-mail could not be sent (" + why.slice(0, 160) + ")";
  return { warn: true, text: "Nobody was e-mailed about this: " + text + "." };
}

/** What an accepted invoice's bill is now (bills: approved_at, void, deleted_at), or "" when it is not known. */
export function billState(b) {
  if (!b) return "";
  if (b.deleted_at) return "removed";
  if (b.void) return "void";
  return b.approved_at ? "approved" : "waiting for approval";
}

/** One row (with ctx.projects: Map String(id) -> {number, name}, ctx.nameOf(uid), ctx.notices: Map String(id) -> the
    e-mail's state, ctx.bills: Map String(id) -> {approved_at, void, deleted_at}). The signature and the document are
    Storage objects the row names (signature_path; document_path once document_attached_at says the upload finished): a
    money editor reads both through a short signed link (M5c's app.storage_can_read). */
export function toSubmission(r, ctx) {
  const c = ctx || {};
  const get = (m, id) => (m && m.get && id !== null && id !== undefined ? m.get(String(id)) || null : null);
  const proj = get(c.projects, r.project_id);
  const isCo = r.kind === "change_order";
  const attached = !!(r.document_attached_at && r.document_path);
  const doc = attached ? { name: r.document_name || String(r.document_path).replace(/^.*\//, ""), path: r.document_path, mime: r.document_mime || "",
    size: Number(r.document_size) || 0 } : null;
  const sig = r.signature_path ? { name: "signature", path: r.signature_path, mime: "image/png", size: 0 } : null;
  const state = STATES[r.state] ? r.state : "pending";
  const pending = state === "pending";
  const amount = r.amount === null || r.amount === undefined ? null : num(r.amount);
  return {
    id: r.id,
    version: r.version,
    reference: r.reference || "",
    kind: isCo ? "change_order" : "invoice",
    kindLabel: isCo ? KIND_LABEL.change_order : KIND_LABEL.invoice,
    isCo,
    state,
    stateLabel: STATES[state],
    pending,
    projectId: r.project_id,
    projectLabel: proj ? [proj.number, proj.name].filter(Boolean).join(" — ") : r.project_label || "(project " + r.project_id + ")",
    vendor: r.vendor_company || "",
    contact: r.contact_name || "",
    email: r.contact_email || "",
    phone: r.contact_phone || "",
    invoiceNumber: r.invoice_number || "",
    amount,
    amountText: amount === null ? "" : fmtMoney(amount),
    description: r.description || "",
    invoiceDate: day(r.invoice_date),
    dueDate: day(r.due_date),
    signatureName: r.signature_name || "",
    signedDay: companyDay(r.signed_at || r.created_at),
    sentDay: companyDay(r.created_at),
    ip: r.submitted_ip || "",
    document: doc,
    signature: sig,
    hasDocument: attached,
    documentAnnounced: !attached && !!r.document_path,
    reviewedByName: (typeof c.nameOf === "function" && r.reviewed_by ? c.nameOf(r.reviewed_by) : "") || "",
    reviewedDay: companyDay(r.reviewed_at),
    reviewNote: r.review_note || "",
    billId: r.bill_id || null,
    billState: r.bill_id ? billState(get(c.bills, r.bill_id)) : "",
    quoteId: r.quote_id || null,
    notice: pending ? noticeLine(get(c.notices, r.id), r.created_at, c.now) : null,
    /* nothing can be approved for payment without its paperwork, so an invoice without it cannot be accepted:
       accepting would only move the dead end further down the line */
    canAccept: pending && (isCo || attached),
    acceptWhy: pending && !isCo && !attached
      ? "No document is attached, so it could never be approved for payment. Ask the subcontractor to send it, quoting " + (r.reference || "the reference") + "."
      : "",
  };
}

export function counts(rows) {
  const out = { pending: 0, accepted: 0, rejected: 0 };
  for (const r of rows || []) if (out[r.state] !== undefined) out[r.state]++;
  return out;
}

/** Newest first; the waiting ones oldest first (the queue order). */
export function order(list, tab) {
  const a = (list || []).slice();
  a.sort((x, y) => (tab === "pending" ? 1 : -1) * (String(x.created_at || "").localeCompare(String(y.created_at || ""))) || (x.id - y.id));
  return a;
}

/** A quote or change order of the job an invoice may be billed against. amount null = hidden (no prices switch). */
export function quoteOption(q) {
  const kind = q.kind === "change_order" ? "CO" : "Quote";
  const amt = q.amount === null || q.amount === undefined ? "" : " · " + fmtMoney(q.amount);
  return { value: String(q.id), label: kind + " · " + (q.vendor_name || "vendor") + (q.status ? " (" + q.status + ")" : "") + amt };
}

/** The line under an accepted or rejected submission. */
export function reviewedLine(s) {
  const who = s.reviewedByName ? " by " + s.reviewedByName : "";
  const when = s.reviewedDay ? " on " + fmtDay(s.reviewedDay) : "";
  const what = s.state === "accepted"
    ? (s.billId ? " · bill #" + s.billId + (s.billState ? " (" + s.billState + ")" : "") : s.quoteId ? " · change order #" + s.quoteId + " on the job" : "")
    : "";
  return s.stateLabel + who + when + what + (s.reviewNote ? " — " + s.reviewNote : "");
}

/** A refusal that means "look again": reviewed by somebody else meanwhile ("already done", 23514) or changed (PT409). */
export function isStale(e) {
  return !!e && (e.code === "PT409" || e.status === 409 || /already done/i.test(String(e.message || "")));
}

/** The sentence after a refusal, from the database's words ("already done: that submission was already accepted by
    …"; PT409: changed meanwhile). */
export function refusalText(e) {
  const m = String((e && e.message) || "");
  if (/already done/i.test(m)) {
    const rest = m.replace(/^already done:\s*/i, "");
    return "Already done — " + rest.charAt(0).toLowerCase() + rest.slice(1) + ".";
  }
  if (e && (e.code === "PT409" || e.status === 409)) return "Someone changed this submission since it was opened — here it is as it is now.";
  return m || "That did not work.";
}

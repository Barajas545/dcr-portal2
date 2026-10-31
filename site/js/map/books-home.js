/* The Accounting page's piles (books-home.html; the Books program, release B part 2a; design-portal §3 with the build
   plan's I14-I24). No SQL copy of the desk (I24): the page reuses The Books' tested reads and shapes - repo/books.js
   loadDesk -> map/books.js buildDesk (the bills' states, the check desk, deskChecks' toTell, resolvePayee) - and adds
   the money messages (money_messages) on top. Pure: no DOM, no network (node tests import it).

   * buildHome(desk, extra, ctx)   desk = buildDesk's payload; extra = {messages (money_messages, null without them yet),
     drafts, subs (pending submissions), files (current_files of the paid payments and their bills)}; ctx = {today, me,
     now} -> {
       waiting      bills waiting for an approver (each with lastAsked), toDecide (approved - nobody said how to pay; the
                    same ask), blocked (on her first: the paperwork), subs {count, oldest (five)};
       toPay, toSend   the check desk and the "Pay by bank transfer or card" list (the pay panel draws them);
       tellGroups   the checks and cash nobody was told about, one group per payee and kind (check | cash: one message
                    may tell a payee about several of theirs - tell_payee takes 1-20 of one payee, all checks or all
                    cash), each with its last pick-up message;
       atOffice     told and not picked up yet (live check / cash) - [Picked up];
       paid30       the payments dated in the last 30 days (paid_date >= today - 29: the date on the check, Q6), newest
                    first, live ones only (a voided check paid nothing), each with its files (the payment's, then the
                    bill's) and its state (told / picked up / cleared);
       counts       homeCounts; waitingEmail - one of MY e-mails still waits for the reminder PC (the page polls every
                    30 s only then, I32)
     };
   * lastAsked(billId, messages)   the latest approval request naming the bill: who asked, when, and each recipient
     of that ask with the outcome; lastAskedText(la) its words ("Asked Avery · e-mail ✓ sent Oct 28 10:44 AM");
   * lastPickup(paymentIds, messages)   the latest pick-up message naming any of these payments;
   * homeCounts(h)   {approvals, checks, pickups, atOffice, paid, todo}: the chips and the home page's "N to do"
     (waiting + blocked + checks to write + payees to tell - counts only);
   * PAID_FILTERS / paidKind(method)   All · Checks · Cash · Transfer · Card. */

import { dayOf, plural, shortDay } from "./books.js";
import { toMessage, whenShort, dayShort } from "./money-messages.js";

export const PAID_DAYS = 30;
export const PAID_FILTERS = Object.freeze([
  { id: "", label: "All" }, { id: "check", label: "Checks" }, { id: "cash", label: "Cash" }, { id: "transfer", label: "Transfer" }, { id: "card", label: "Card" },
]);
/** A payment's method as the Paid list filters it: check | cash | transfer (ACH, wire) | card | other. */
export function paidKind(method) {
  const m = String(method || "").toLowerCase();
  return m === "ach" || m === "wire" ? "transfer" : m === "check" || m === "cash" || m === "card" ? m : "other";
}

const txt = (v) => String(v == null ? "" : v).trim();
const low = (v) => txt(v).replace(/\s+/g, " ").toLowerCase();
function addDayKey(k, n) {
  return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)).toISOString().slice(0, 10);
}
const first = (name) => txt(name).split(/\s+/)[0].split("@")[0];
const newest = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || Number(b.id) - Number(a.id);

/* ── the messages ─────────────────────────────────────────────────────── */

function asMessages(list) { return (Array.isArray(list) ? list : []).map((m) => (m && m.billIds && m.status !== undefined ? m : toMessage(m))); }

/** The latest approval request naming `billId`: {at, by, groupId, entries: [{toName, channel, status, statusNote,
    sentAt, createdAt}]} (the recipients of that one ask), or null. */
export function lastAsked(billId, messages) {
  const id = String(billId);
  const mine = asMessages(messages).filter((m) => m.kind === "approval_request" && m.billIds.indexOf(id) !== -1).sort(newest);
  if (!mine.length) return null;
  const top = mine[0];
  const group = mine.filter((m) => top.groupId ? m.groupId === top.groupId : m.id === top.id).sort((a, b) => Number(a.id) - Number(b.id));
  return { at: top.createdAt, by: top.createdBy, groupId: top.groupId, entries: group };
}

/** One recipient's outcome, short: "e-mail ✓ sent Oct 28 10:44 AM", "text (by hand) Oct 28", "e-mail not sent: …". */
export function askedWords(m) {
  if (m.channel === "email") {
    if (m.status === "queued") return "e-mail waiting for the reminder PC";
    if (m.status === "sent") return "e-mail ✓ sent " + whenShort(m.sentAt || m.createdAt);
    const n = txt(m.statusNote);
    return "e-mail " + (/^not sent/i.test(n) ? n : "not sent" + (n ? ": " + n : ""));
  }
  if (m.status === "sent") return "text (by hand) " + dayShort(m.sentAt || m.createdAt);
  if (m.status === "draft") return "text (by hand) not marked sent yet";
  return "text not sent";
}

/** "Asked Avery · e-mail ✓ sent Oct 28 10:44 AM; Drew · text (by hand) Oct 28" | "Not asked yet". */
export function lastAskedText(la) {
  if (!la || !la.entries || !la.entries.length) return "Not asked yet";
  return "Asked " + la.entries.map((m) => (first(m.toName) || "someone") + " · " + askedWords(m)).join("; ");
}

/** The latest pick-up message naming any of `paymentIds`, or null. */
export function lastPickup(paymentIds, messages) {
  const want = new Set((paymentIds || []).map(String));
  const mine = asMessages(messages).filter((m) => m.kind === "payment_pickup" && m.paymentIds.some((p) => want.has(p))).sort(newest);
  return mine[0] || null;
}

/* ── the piles ────────────────────────────────────────────────────────── */

/** The payee a pick-up message goes to, as a key: the bill's vendor contact, else the payee's name. */
function payeeKey(t) {
  return t.vendorContactId !== null && t.vendorContactId !== undefined ? "c" + t.vendorContactId : "n" + low(t.payee || t.vendor);
}

/** deskChecks' toTell, one group per payee and kind (check | cash), at most 20 payments a group (tell_payee). */
export function tellGroups(toTell, messages) {
  const groups = [];
  const at = new Map();
  (toTell || []).forEach((t) => {
    const key = payeeKey(t) + "|" + (t.isCash ? "cash" : "check");
    let g = at.get(key);
    if (!g || g.payments.length >= 20) {
      g = { key: key + "|" + groups.length, payee: t.payee || t.vendor || "", vendorContactId: t.vendorContactId == null ? null : t.vendorContactId,
        quoteId: t.quoteId == null ? null : t.quoteId, isCash: !!t.isCash, payments: [], projectLabels: [] };
      at.set(key, g);
      groups.push(g);
    }
    g.payments.push(t);
    if (t.projectLabel && g.projectLabels.indexOf(t.projectLabel) === -1) g.projectLabels.push(t.projectLabel);
  });
  groups.forEach((g) => {
    g.paymentIds = g.payments.map((p) => p.paymentId);
    g.amount = Math.round(g.payments.reduce((n, p) => n + (Number(p.amount) || 0), 0) * 100) / 100;
    g.first = g.payments[0];
    g.lastMessage = lastPickup(g.paymentIds, messages);
  });
  return groups;
}

/** The contact kinds tell_payee takes for a bill that names no contact (I36): a client or an employee is never a payee. */
export const PAYEE_KINDS = Object.freeze(["subcontractor", "supplier", "service", "other"]);
const payeeKind = (c) => !!c && !c.deleted_at && PAYEE_KINDS.indexOf(low(c.kind)) !== -1;

/** Who a group's pick-up message goes to (I20 / I36): the bill's own vendor contact (the database takes it from the
    bill, whatever its kind: nothing is given), else - a bill with no contact (a public-form bill) - the quote's vendor
    contact, else a contact whose company or name IS the payee or the bill's vendor name (case and spaces aside; never a
    loose "guess"), both only of a payee kind (PAYEE_KINDS: the database refuses anyone else, so a client or an employee
    of the same name is never shown, dialled or picked over the sub). -> {contact (a contacts row | null), contactId
    (what tell_payee is given: null for the bill's own), source: bill | quote | name | none, email, phone}. */
export function pickupContact(g, links) {
  const L = links || {};
  const contacts = L.contacts || new Map();
  const reach = (c, contactId, source) => ({ contact: c || null, contactId, source,
    email: c && !c.deleted_at && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(txt(c.email)) ? txt(c.email) : "",
    phone: c && !c.deleted_at && (txt(c.phone).match(/\d/g) || []).length >= 7 ? txt(c.phone) : "" });
  if (g.vendorContactId !== null && g.vendorContactId !== undefined) {
    return reach(contacts.get(String(g.vendorContactId)) || null, null, "bill");
  }
  const q = g.quoteId !== null && g.quoteId !== undefined && L.quotes ? L.quotes.get(String(g.quoteId)) : null;
  const qc = q && q.vendor_contact_id !== null && q.vendor_contact_id !== undefined ? contacts.get(String(q.vendor_contact_id)) : null;
  if (payeeKind(qc)) return reach(qc, qc.id, "quote");
  const t = g.first || {};
  const keys = [t.payee, t.vendor, t.vendorCompany].map(low).filter(Boolean);
  const hit = Array.from(contacts.values()).filter((c) => payeeKind(c) && (keys.indexOf(low(c.company)) !== -1 || keys.indexOf(low(c.name)) !== -1))
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  return hit ? reach(hit, hit.id, "name") : reach(null, null, "none");
}

/** Told and not picked up yet: the live check / cash payments of live bills. */
export function waitingPickup(payments, byId) {
  const out = [];
  (payments || []).forEach((p) => {
    if (!p.collectable || !p.live || !p.toldAt || p.pickedUpAt) return;
    const b = byId ? byId.get(String(p.billId)) : null;
    if (!b) return;
    out.push(Object.assign({}, p, { paymentId: p.id, projectLabel: b.projectLabel, invoiceNumber: b.invoiceNumber, vendorContactId: b.vendorContactId,
      payee: p.payee || b.vendorCompany || b.vendor, isCash: p.method === "cash", vendor: b.vendor }));
  });
  return out.sort((a, b) => String(a.toldAt || "").localeCompare(String(b.toldAt || "")) || Number(a.id) - Number(b.id));
}

/** The live payments dated in the last 30 days (paid_date >= today - 29), newest first, with their files. */
export function paid30(payments, byId, files, today) {
  const t = dayOf(today);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(t) ? addDayKey(t, -(PAID_DAYS - 1)) : "";
  const all = Array.from(files || []);
  const out = [];
  (payments || []).forEach((p) => {
    if (!p.live || !p.paidDate || (from && p.paidDate < from)) return;
    const b = byId ? byId.get(String(p.billId)) : null;
    const own = all.filter((f) => String(f.payment_id) === String(p.id));
    const bills = all.filter((f) => f.payment_id == null && String(f.bill_id) === String(p.billId));
    out.push(Object.assign({}, p, {
      kind: paidKind(p.method),
      payee: p.payee || (b ? b.vendorCompany || b.vendor : ""),
      projectLabel: b ? b.projectLabel : "",
      vendorContactId: b ? b.vendorContactId : null,
      invoiceNumber: b ? b.invoiceNumber : "",
      ref: p.method === "check" ? p.checkNumber : p.reference,
      files: own.concat(bills),
      fileCount: own.length + bills.length,
    }));
  });
  return out.sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)) || Number(b.id) - Number(a.id));
}

/** A paid payment's state in words: "cleared Oct 28" | "picked up Oct 27" | "told by e-mail Oct 26" | "not told yet" | "". */
export function paidState(p) {
  if (p.clearedOn) return "cleared " + shortDay(p.clearedOn);
  if (p.pickedUpAt) return "picked up " + dayShort(p.pickedUpAt);
  if (!p.collectable) return p.kind === "card" ? "on the card" : "sent";
  if (p.toldAt) return "told " + (p.toldHow ? toldHowWords(p.toldHow) + " " : "") + dayShort(p.toldAt);
  return "not told yet";
}
/** payments.pickup_told_how in words. */
export function toldHowWords(how) {
  const h = low(how);
  return h === "email" ? "by e-mail" : h === "text message" || h === "text" ? "by text" : h === "phone" ? "by phone" : h === "in person" ? "in person" : h;
}

/** The chips' and the home page's counts. */
export function homeCounts(h) {
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  const pickups = (h.tellGroups || []).reduce((s, g) => s + g.payments.length, 0);
  return {
    approvals: n(h.waiting) + n(h.toDecide) + n(h.blocked),
    checks: n(h.toPay) + n(h.toSend),
    pickups,
    atOffice: n(h.atOffice),
    paid: n(h.paid30),
    todo: n(h.waiting) + n(h.blocked) + n(h.toPay) + n(h.toSend) + pickups,
  };
}
/** "3 to do" | "" (nothing). */
export function todoBadge(counts) {
  const n = counts && counts.todo;
  return n ? n + " to do" : "";
}

/** The pending submissions: {count, oldest (five, oldest first)}. */
export function pendingSubs(list) {
  const p = (Array.isArray(list) ? list : []).filter((s) => s && (s.pending || s.state === "pending"))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || Number(a.id) - Number(b.id));
  return { count: p.length, oldest: p.slice(0, 5) };
}

/** Everything the Accounting page shows (see the header). */
export function buildHome(desk, extra, ctx) {
  const d = desk || {};
  const x = extra || {};
  const c = ctx || {};
  const today = dayOf(c.today || d.today);
  const messages = Array.isArray(x.messages) ? asMessages(x.messages) : null;
  const msgs = messages || [];
  const checks = d.checks || { toPay: [], toSend: [], toDecide: [], toTell: [] };
  const withAsk = (b) => Object.assign({}, b, { lastAsked: lastAsked(b.id, msgs) });
  const out = {
    today,
    ready: messages !== null,
    waiting: (d.waiting || []).map(withAsk),
    toDecide: (checks.toDecide || []).map(withAsk),
    blocked: (d.blocked || []).slice(),
    subs: pendingSubs(x.subs),
    toPay: (checks.toPay || []).slice(),
    toSend: (checks.toSend || []).slice(),
    tellGroups: tellGroups(checks.toTell || [], msgs),
    atOffice: waitingPickup(d.payments || [], d.byId),
    paid30: paid30(d.payments || [], d.byId, x.files || [], today),
    drafts: asMessages(x.drafts),
    messages: msgs,
  };
  out.paid30Total = Math.round(out.paid30.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  out.counts = homeCounts(out);
  const me = c.me && c.me.id ? String(c.me.id) : null;
  out.waitingEmail = msgs.some((m) => m.channel === "email" && m.status === "queued" && (!me || String(m.createdBy) === me));
  return out;
}

/** "3 bills" style words for the chips' aria labels. */
export function countWords(n, one, many) { return plural(n, one, many); }

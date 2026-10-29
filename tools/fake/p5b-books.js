/* DCR Portal 2 — DEMO MODE ONLY: P5b's books side of migration M5b (20261026000100_books_ledger.sql) and the money
   tables' own rules (20261007000500_money.sql, 20261007001200_versioned_writes.sql, M4's payee / memo / pick-up
   columns, M6's payment_told) in the in-memory database, read and written by accounting.html, bill.html and the home
   page's approvals card. Loaded BEFORE engine.js and AFTER tools/fake/p5a-pm.js (and p5b-ledger.js when it is
   there); installed into each engine FIRST among the later phases (NS.extInstall.unshift) because it takes over the
   rules of bills, payments and invoices that p5a-pm.js only read. Never published (tools/ is not part of the site).

   The same names and rules as the shared P5b contract and the money migrations:
   * bills.kind (Subcontractor | Material supplier | Equipment | Other, stored in those words; NULL: not said);
     bills.qbo_entered_at / qbo_entered_by / qbo_ref and the same on invoices - set ONLY by the mark / unmark RPCs (a
     direct write is refused, 42501); a bill marked entered keeps what QuickBooks holds: its amount, vendor, invoice
     number, document, voiding, deleting and withdrawing its approval are refused (23514) until it is unmarked;
   * read: bills, payments, invoices with the financials switch (Desktop 2's RLS); the agents account none;
   * bills: money editors insert and update (app.can_edit('money')); the approval columns only through approve_bill /
     unapprove_bill / set_bill_pay_method (42501 otherwise); an edit of the amount, vendor, invoice number or
     document of an APPROVED bill clears the approval; once a payment exists those edits, void and delete are
     refused (23514);
   * rpc approve_bill(id, pay_method, version, note): admin, or a manager with the approve switch and financials
     (42501 for anyone else - an accountant ALWAYS); the version as shown (PT409); pay method REQUIRED (22023);
     not void, amount > 0, the document attached in the bill's project, no payment yet (23514); stamps by / at /
     the approved amount; unapprove_bill(id, version) the same callers, no payment yet;
   * rpc set_bill_pay_method(p_id, p_method, p_version): approve authority; an approved bill with no payment;
   * pay methods (owner decision 2026-10-21): check | cash | both | transfer (ACH or wire) | card;
   * payments: money editors; the bill approved, live; a person pays the way the approver allowed (check, cash, both:
     a check or cash; transfer: ACH or wire; card: a card; "other" never - app.pay_method_allows); a check needs its
     number; the payments never above the approved amount (23514 "the payments would exceed the approved amount" -
     acceptance check 2); payee 1..200 and memo 1..100 (blank -> null); the pick-up stamp never set by a person's
     write (42501); a payment once told cannot be deleted (M5b's guard, 23514);
   * rpc payment_told(p_id, p_how, p_version) (M6): money editors; phone | in person | email | text; version as
     shown; check / cash only; how = null clears it; {ok, toldAt, toldDate, toldBy, toldHow, version, already?};
   * rpc mark_bills_entered(p_ids, p_ref) -> {marked, refused: [{id, reason}], enteredAt, ref} (money editors; only
     live, approved, documented, not-entered bills; 1..1,000 ids), unmark_bills_entered(p_ids) -> {unmarked, refused},
     mark_invoices_entered(p_ids, p_ref) (live, sent or paid, with an amount, not entered), unmark_invoices_entered;
   * view books_desk (security invoker, financials): one row per bill not deleted - the bill's columns, its project's
     number / name / label, paid_total, payments_count, to_tell, owed, documented, state (void | entered | blocked |
     waiting | ready), reason, pay_state (void | unapproved | to_pay | part_paid | paid), late_by, pay_pile (check_desk |
     transfer_card);
   * no activity row is written by any of it (P5 acceptance check 5: no amount in any activity row).
   Made-up data only: a demo approver (a manager with the approve and financials switches, no prices - Q1), kinds
   and a QuickBooks mark on the sandbox's bills, and bills, payments and invoices on three more made-up jobs (A303,
   A294, A284) in every state the desk can show (waiting with and without paperwork, approved for check / cash /
   either, part paid, paid and not told, told, entered; a memo a spreadsheet would run as a formula; approved for a bank
   transfer - one part paid by ACH - and for a card). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const KINDS = ["Subcontractor", "Material supplier", "Equipment", "Other"];
  const METHODS = ["check", "cash", "both", "transfer", "card"];
  // app.pay_method_allows / app.pay_method_words (M5b)
  const ALLOWS = { check: ["check"], cash: ["cash"], both: ["check", "cash"], transfer: ["ach", "wire"], card: ["card"] };
  const WORDS = { check: "check", cash: "cash", both: "check or cash", transfer: "bank transfer (ACH or wire)", card: "card" };
  const BAD_METHOD = "pay_method must be check, cash, both, transfer or card";
  const BILL_EXTRA = { kind: null, qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null };
  const INVOICE_EXTRA = { qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null };
  const PAYMENT_EXTRA = { payee: null, memo: null, pickup_told_at: null, pickup_told_by: null, pickup_told_how: null };
  const SIGS = {
    approve_bill: ["id", "pay_method", "version", "note"],
    unapprove_bill: ["id", "version"],
    set_bill_pay_method: ["p_id", "p_method", "p_version"],
    mark_bills_entered: ["p_ids", "p_ref"],
    unmark_bills_entered: ["p_ids"],
    mark_invoices_entered: ["p_ids", "p_ref"],
    unmark_invoices_entered: ["p_ids"],
    payment_told: ["p_id", "p_how", "p_version"],
  };
  NS.p5bBooksSigs = SIGS;   // tools/schema-check-p5b-books.mjs compares them with the real functions' arguments
  const APPROVER = { key: "approver", id: "00000000-0000-4000-8000-000000000011", full_name: "Drew Approver", email: "approver@demo.test",
    role: "manager", color: "#d4652f", phone: "(805) 555-0111" };

  // the books_desk view's columns (a view: no audit columns)
  (NS.extTables = NS.extTables || []).push({
    tables: ["books_desk"],
    cols: { books_desk: { id: null, project_id: null, project_number: null, project_name: null, project_label: null, kind: null,
      vendor_contact_id: null, vendor_name: null, invoice_number: null, invoice_date: null, due_date: null, amount: null, description: null,
      estimate_item_id: null, quote_id: null, document_file_id: null, void: null, approved_by: null, approved_at: null, approved_amount: null,
      pay_method: null, approval_note: null, qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null, created_at: null, created_by: null,
      updated_at: null, version: null, paid_total: null, payments_count: null, to_tell: null, owed: null, documented: null, state: null,
      reason: null, pay_state: null, late_by: null, pay_pile: null,
      // the Books program, release A (20261030000300_check_register): at the END
      voided_count: null, at_office: null, last_paid_date: null } },
    pk: { books_desk: "id" },
    uuid: [],
    noAudit: ["books_desk"],
    fks: [["books_desk", "project_id", "projects"]],
  });

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  function install(E) {
    const { rows, COLS, PgErr, deny, rule, nowIso, today, companyDay, clone, auditUpdate, commitUpdate, projectVisible } = E;
    // M5b / M4's columns on the tables p5a-pm.js declared (idempotent: every engine shares COLS)
    const extend = (t, extra) => { if (COLS[t]) Object.keys(extra).forEach((k) => { if (!(k in COLS[t])) COLS[t][k] = extra[k]; }); };
    extend("bills", BILL_EXTRA);
    extend("invoices", INVOICE_EXTRA);
    extend("payments", PAYMENT_EXTRA);
    if (!rows.bills || !rows.payments || !rows.invoices) return null;

    const tables = new Set(["bills", "payments", "invoices", "books_desk"]);
    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const approver = (w) => w.active && (w.admin || (w.role === "manager" && !!(w.p && w.p.can_approve_payments) && w.financials));
    const billOf = (id) => rows.bills.find((b) => b.id === Number(id)) || null;
    // the Books program, release A (20261030000300_check_register): a voided payment is paid against no bill - every
    // sum takes the live ones only; the payments' register rules (void final, the stamps system code's, the date, the
    // check number used once) are tools/fake/p8-register.js's, called at the triggers' places (NS.p5bPaymentRules)
    const live = (p) => !p.voided_at;
    const paidOn = (id) => r2(rows.payments.filter((p) => p.bill_id === Number(id) && live(p)).reduce((s, p) => s + Number(p.amount || 0), 0));
    const more = (NS.p5bPaymentRules || []).map((mk) => mk(E)).filter(Boolean);
    const payRule = (name, ...args) => more.forEach((x) => { if (typeof x[name] === "function") x[name](...args); });
    const fileIn = (fid, pid) => fid !== null && fid !== undefined && rows.files.some((f) => f.id === Number(fid) && f.project_id === pid && !f.deleted_at);
    const pt409 = (table, id, version) => new PgErr("PT409", "the " + (table === "bills" ? "bill" : "payment") + " was changed by someone else", 409,
      JSON.stringify({ table, id, version }));
    const notFound = (what) => new PgErr("PT404", what + " not found", 404);
    const trim = (v) => { const s = v === null || v === undefined ? "" : String(v).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""); return s || null; };

    function canRead(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "bills": case "invoices": return w.financials && (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
        case "payments": return w.financials && projectVisible(w, r.project_id);
        case "books_desk": return w.financials && projectVisible(w, r.project_id);
        default: return false;
      }
    }
    function canInsert(w, table, r) {
      if (!moneyEditor(w)) return false;
      if (table === "bills" || table === "invoices") return !r.deleted_at && projectVisible(w, r.project_id);
      if (table === "payments") { const b = billOf(r.bill_id); return projectVisible(w, b ? b.project_id : r.project_id); }
      return false;
    }
    function canUpdate(w, table, r) {
      if (!moneyEditor(w)) return false;
      if (table === "bills" || table === "invoices") return (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
      if (table === "payments") return projectVisible(w, r.project_id);
      return false;
    }
    function canDelete(w, table, r) {
      if (!moneyEditor(w) || !projectVisible(w, r.project_id)) return false;
      if (table === "payments") {
        payRule("beforeDelete", w, r);
        // M5b: a payment the payee was told about stays (the record of what they were told)
        if (r.pickup_told_at) throw rule("23514", "the payee was told this payment is ready to pick up: it cannot be deleted (clear the told mark first if they were not told)");
        return true;
      }
      return false;   // bills and invoices: soft delete through Desktop 2
    }

    const APPROVAL = ["approved_by", "approved_at", "approved_amount", "pay_method", "approval_note"];
    const QBO = ["qbo_entered_at", "qbo_entered_by", "qbo_ref"];
    const PICKUP = ["pickup_told_at", "pickup_told_by", "pickup_told_how"];
    const set = (r, k) => r[k] !== null && r[k] !== undefined;
    function checkKind(r) {
      if (r.kind !== null && r.kind !== undefined && !KINDS.includes(r.kind)) {
        throw rule("23514", 'new row for relation "bills" violates check constraint "bills_kind_check"');
      }
    }
    function tidyPayment(r) {
      r.payee = trim(r.payee);
      r.memo = trim(r.memo);
      if (r.payee !== null && r.payee.length > 200) throw rule("23514", 'new row for relation "payments" violates check constraint "payments_payee_check"');
      if (r.memo !== null && r.memo.length > 100) throw rule("23514", 'new row for relation "payments" violates check constraint "payments_memo_check"');
      if (!(Number(r.amount) > 0)) throw rule("23514", 'new row for relation "payments" violates check constraint "payments_amount_check"');
      if (!["check", "cash", "ach", "card", "wire", "other"].includes(r.method)) throw rule("23514", 'new row for relation "payments" violates check constraint "payments_method_check"');
    }
    function payGate(r, old) {
      const b = billOf(r.bill_id);
      if (!b || b.deleted_at) throw rule("23503", "bill not found");
      if (b.void) throw rule("23514", "the bill is void");
      if (!b.approved_at) throw rule("23514", "the bill is not approved");
      // M5b review fix (t01_payments_client, first): the approver's way binds - ACH or wire only on a bank transfer bill,
      // a card only on a card bill, "other" never
      if (!["check", "cash"].includes(r.method) && !(ALLOWS[b.pay_method] || []).includes(r.method) && (!old || r.method !== old.method)) {
        throw rule("23514", "the bill was approved to be paid by " + (WORDS[b.pay_method] || "the approved way") +
          ": ask a manager or admin to change that before paying it another way");
      }
      // t10_payments: a check or cash as the approver allowed
      if ((r.method === "check" && !["check", "both"].includes(b.pay_method)) || (r.method === "cash" && !["cash", "both"].includes(b.pay_method))) {
        throw rule("23514", "the bill is approved for " + (b.pay_method === "transfer" ? "bank transfer" : b.pay_method) + " payment");
      }
      if (r.method === "check" && !trim(r.check_number)) throw rule("23514", "a check payment needs the check number");
      const others = r2(rows.payments.filter((p) => p.bill_id === b.id && live(p) && (!old || p.id !== old.id)).reduce((s, p) => s + Number(p.amount || 0), 0));
      if (others + Number(r.amount) > Number(b.approved_amount) + 1e-9) {
        throw Object.assign(rule("23514", "the payments would exceed the approved amount"), { details: "remaining: " + r2(Number(b.approved_amount) - others).toFixed(2) });
      }
      r.project_id = b.project_id;
    }
    function beforeInsert(w, table, r) {
      if (table === "bills") {
        if (APPROVAL.some((k) => set(r, k))) throw deny("bills are approved with approve_bill()");
        if (QBO.some((k) => set(r, k))) throw deny("a bill is marked entered with mark_bills_entered()");
        checkKind(r);
        if (!(Number(r.amount) >= 0)) throw rule("23514", 'new row for relation "bills" violates check constraint "bills_amount_check"');
        if (r.document_file_id !== null && r.document_file_id !== undefined && !fileIn(r.document_file_id, r.project_id)) {
          throw rule("23514", "the document belongs to another project");
        }
      } else if (table === "invoices") {
        if (QBO.some((k) => set(r, k))) throw deny("an invoice is marked entered with mark_invoices_entered()");
      } else if (table === "payments") {
        if (PICKUP.some((k) => set(r, k))) throw deny("a payment is marked told by DCR Agents 2 or the books (payment_told), not by an update");
        payRule("beforeInsert", w, r);
        tidyPayment(r);
        if (!r.paid_date) r.paid_date = today();
        payGate(r, null);
        payRule("checkNumber", w, r, null);
      }
    }
    function guardUpdate(w, table, old, r) {
      if (table === "bills") {
        if (r.project_id !== old.project_id) throw rule("23514", "a bill cannot move to another project");
        if (APPROVAL.some((k) => JSON.stringify(r[k]) !== JSON.stringify(old[k]))) throw deny("approval changes only through approve_bill() / unapprove_bill()");
        if (QBO.some((k) => JSON.stringify(r[k]) !== JSON.stringify(old[k]))) throw deny("the QuickBooks mark changes only through mark_bills_entered() / unmark_bills_entered()");
        checkKind(r);
        const key = ["amount", "vendor_contact_id", "vendor_name", "invoice_number", "document_file_id"].some((k) => JSON.stringify(r[k]) !== JSON.stringify(old[k]));
        // M5b: a bill marked entered in QuickBooks keeps what QuickBooks holds
        if (old.qbo_entered_at && r.qbo_entered_at && (key || (r.void && !old.void) || (r.deleted_at && !old.deleted_at) || (old.approved_at && !r.approved_at))) {
          throw rule("23514", ENTERED_LOCK);
        }
        if ((key || (r.void && !old.void) || (r.deleted_at && !old.deleted_at)) && paidOn(old.id) > 0) {
          throw rule("23514", "this bill has payments: amount, vendor, invoice number, document, void and delete are locked");
        }
        if (old.approved_at && (key || (r.void && !old.void))) APPROVAL.forEach((k) => { r[k] = null; });
        if (r.document_file_id !== old.document_file_id && r.document_file_id !== null && !fileIn(r.document_file_id, r.project_id)) {
          throw rule("23514", "the document belongs to another project");
        }
      } else if (table === "invoices") {
        if (QBO.some((k) => JSON.stringify(r[k]) !== JSON.stringify(old[k]))) throw deny("the QuickBooks mark changes only through mark_invoices_entered() / unmark_invoices_entered()");
      } else if (table === "payments") {
        if (r.bill_id !== old.bill_id) throw rule("23514", "a payment cannot move to another bill");
        payRule("guardUpdate", w, old, r);
        if (PICKUP.some((k) => JSON.stringify(r[k]) !== JSON.stringify(old[k]))) throw deny("a payment is marked told by DCR Agents 2 or the books (payment_told), not by an update");
        tidyPayment(r);
        // M5b review fix (t01_payments_client): a told payment keeps what the payee was told
        if (old.pickup_told_at && ["amount", "method", "check_number", "reference", "payee"].some((k) => JSON.stringify(r[k] === undefined ? null : r[k]) !== JSON.stringify(old[k] === undefined ? null : old[k]))) {
          throw rule("23514", "the payee was told about this payment: clear the told mark first (and tell them again) before changing its amount, method, check number, reference or payee");
        }
        payGate(r, old);
        payRule("checkNumber", w, r, old);
      }
    }

    /* books_desk (security invoker): one row per bill not deleted, as the real view (M5b section 5) */
    function desk(w) {
      if (!w || !w.active || !w.financials) return [];
      const todayK = today();
      const utc = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
      return rows.bills.filter((b) => !b.deleted_at && projectVisible(w, b.project_id)).map((b) => {
        const all = rows.payments.filter((p) => p.bill_id === b.id);
        const pays = all.filter(live);
        const paid = r2(pays.reduce((n, p) => n + Number(p.amount || 0), 0));
        const pr = rows.projects.find((p) => p.id === b.project_id) || {};
        const documented = fileIn(b.document_file_id, b.project_id);
        const amount = Number(b.amount || 0);
        const state = b.void ? "void" : b.qbo_entered_at ? "entered" : amount <= 0 || !documented ? "blocked" : !b.approved_at ? "waiting" : "ready";
        const reason = b.void ? "Voided: nothing to enter." : b.qbo_entered_at ? null : amount <= 0 ? "No amount on it yet."
          : !documented ? "No invoice attached, so it cannot be approved." : !b.approved_at ? "Waiting for a manager or admin to approve it." : null;
        const out = {};
        ["id", "project_id", "kind", "vendor_contact_id", "vendor_name", "invoice_number", "invoice_date", "due_date", "amount", "description",
          "estimate_item_id", "quote_id", "document_file_id", "void", "approved_by", "approved_at", "approved_amount", "pay_method", "approval_note",
          "qbo_entered_at", "qbo_entered_by", "qbo_ref", "created_at", "created_by", "updated_at", "version"].forEach((k) => { out[k] = b[k] === undefined ? null : b[k]; });
        return Object.assign(out, {
          project_number: pr.number || null, project_name: pr.name || null,
          project_label: [pr.number, pr.name].map((x) => String(x || "").trim()).filter(Boolean).join(" \u2014 "),
          paid_total: paid, payments_count: pays.length,
          to_tell: pays.filter((p) => (p.method === "check" || p.method === "cash") && !p.pickup_told_at && !p.picked_up_at).length,
          owed: b.void ? 0 : b.approved_at ? r2(Math.max(Number(b.approved_amount) - paid, 0)) : r2(Math.max(amount - paid, 0)),
          documented, state, reason,
          pay_state: b.void ? "void" : !b.approved_at ? "unapproved" : paid >= Number(b.approved_amount) ? "paid" : paid > 0 ? "part_paid" : "to_pay",
          late_by: b.due_date ? Math.round((utc(todayK) - utc(String(b.due_date))) / 86400000) : null,
          pay_pile: b.void || !b.approved_at ? null : ["transfer", "card"].includes(b.pay_method) ? "transfer_card"
            : ["check", "cash", "both"].includes(b.pay_method) ? "check_desk" : null,
          voided_count: all.length - pays.length,
          at_office: pays.filter((p) => (p.method === "check" || p.method === "cash") && p.pickup_told_at && !p.picked_up_at && !p.cleared_on).length,
          last_paid_date: pays.reduce((m, p) => (!m || String(p.paid_date) > m ? String(p.paid_date) : m), null),
        });
      });
    }

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      if (keys.some((k) => !want.includes(k)) || want.some((k) => !keys.includes(k) && !(name === "approve_bill" && k === "note"))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function write(w, table, old, patch) {
      const r = Object.assign(clone(old), patch);
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    function idList(v) {
      if (!Array.isArray(v)) throw rule("22023", "p_ids must be a list of ids");
      const ids = Array.from(new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
      if (!ids.length) throw rule("22023", "Nothing was selected.");
      if (ids.length > 1000) throw rule("22023", "At most 1,000 at a time.");
      return ids;
    }
    const ENTERED_LOCK = "this bill is marked entered in QuickBooks: unmark it first (and correct QuickBooks) before changing its amount, vendor, invoice number or document, voiding or deleting it, or withdrawing its approval";
    const cleanRef = (v) => { const s = String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().slice(0, 80); return s || null; };

    function billGet(w, id) {
      const b = billOf(id);
      if (!b || b.deleted_at || !projectVisible(w, b.project_id) || !w.financials) throw notFound("bill");
      return b;
    }

    function rpc(w, name, a) {
      switch (name) {
        case "approve_bill": {
          if (!approver(w)) throw deny("only an admin or a manager allowed to approve payments can approve bills");
          if (a.version === null || a.version === undefined) throw rule("22023", "approve the bill as it was reviewed: its version is required");
          const b = billOf(a.id);
          if (!b || b.deleted_at || !projectVisible(w, b.project_id)) throw notFound("bill");
          if (Number(b.version) !== Number(a.version)) throw pt409("bills", b.id, b.version);
          if (!METHODS.includes(a.pay_method)) throw rule("22023", BAD_METHOD);
          if (b.void) throw rule("23514", "the bill is void");
          if (!(Number(b.amount) > 0)) throw rule("23514", "the bill amount must be greater than zero");
          if (!fileIn(b.document_file_id, b.project_id)) throw rule("23514", "attach the bill document before approving");
          if (paidOn(b.id) > 0) throw rule("23514", "the bill already has payments");
          const note = trim(a.note);
          return clone(write(w, "bills", b, { approved_by: w.uid, approved_at: nowIso(), approved_amount: Number(b.amount), pay_method: a.pay_method,
            approval_note: note ? note.slice(0, 300) : null }));
        }
        case "unapprove_bill": {
          if (!approver(w)) throw deny("only an admin or a manager allowed to approve payments can withdraw an approval");
          if (a.version === null || a.version === undefined) throw rule("22023", "withdraw the approval of the bill as it was shown: its version is required");
          const b = billOf(a.id);
          if (!b || b.deleted_at || !projectVisible(w, b.project_id)) throw notFound("bill");
          if (Number(b.version) !== Number(a.version)) throw pt409("bills", b.id, b.version);
          if (paidOn(b.id) > 0) throw rule("23514", "the bill has payments; the approval cannot be withdrawn");
          if (b.qbo_entered_at) throw rule("23514", ENTERED_LOCK);
          return clone(write(w, "bills", b, { approved_by: null, approved_at: null, approved_amount: null, pay_method: null, approval_note: null }));
        }
        case "set_bill_pay_method": {
          if (!approver(w)) throw deny("only an admin or a manager allowed to approve payments can say how a bill is paid");
          if (a.p_version === null || a.p_version === undefined) throw rule("22023", "set the pay method of the bill as it was shown: its version is required");
          const b = billOf(a.p_id);
          if (!b || b.deleted_at || !projectVisible(w, b.project_id)) throw notFound("bill");
          if (Number(b.version) !== Number(a.p_version)) throw pt409("bills", b.id, b.version);
          if (!METHODS.includes(a.p_method)) throw rule("22023", BAD_METHOD);
          if (b.void) throw rule("23514", "the bill is void");
          if (!b.approved_at) throw rule("23514", "approve the bill first: that is where its pay method is set");
          if (paidOn(b.id) > 0) throw rule("23514", "this bill has payments: how it was paid is now a matter of record");
          if (b.pay_method === a.p_method) return clone(b);
          return clone(write(w, "bills", b, { pay_method: a.p_method }));
        }
        case "mark_bills_entered": case "unmark_bills_entered": {
          if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, can mark bills entered");
          const ids = idList(a.p_ids);
          const marking = name === "mark_bills_entered";
          const ref = marking ? cleanRef(a.p_ref) : null;
          const done = [], refused = [];
          for (const id of ids) {
            const b = billOf(id);
            if (!b || b.deleted_at || !projectVisible(w, b.project_id)) { refused.push({ id, reason: "No such bill." }); continue; }
            if (!marking) {
              if (!b.qbo_entered_at) { refused.push({ id, reason: "It was not marked as entered." }); continue; }
              write(w, "bills", b, { qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null });
              done.push(id);
              continue;
            }
            const why = b.qbo_entered_at ? "Already entered" + (b.qbo_ref ? " as " + b.qbo_ref : "") + "."
              : b.void ? "Voided: nothing to enter." : !(Number(b.amount) > 0) ? "No amount on it yet."
                : !fileIn(b.document_file_id, b.project_id) ? "No invoice attached, so it cannot be approved."
                  : !b.approved_at ? "Waiting for a manager or admin to approve it." : "";
            if (why) { refused.push({ id, reason: why }); continue; }
            write(w, "bills", b, { qbo_entered_at: nowIso(), qbo_entered_by: w.uid, qbo_ref: ref });
            done.push(id);
          }
          return marking ? { marked: done, refused, enteredAt: nowIso(), ref } : { unmarked: done, refused };
        }
        case "mark_invoices_entered": case "unmark_invoices_entered": {
          if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, can mark invoices entered");
          const ids = idList(a.p_ids);
          const marking = name === "mark_invoices_entered";
          const ref = marking ? cleanRef(a.p_ref) : null;
          const done = [], refused = [];
          for (const id of ids) {
            const iv = rows.invoices.find((x) => x.id === id);
            if (!iv || iv.deleted_at || !projectVisible(w, iv.project_id)) { refused.push({ id, reason: "No such invoice." }); continue; }
            if (!marking) {
              if (!iv.qbo_entered_at) { refused.push({ id, reason: "It was not marked as entered." }); continue; }
              write(w, "invoices", iv, { qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null });
              done.push(id);
              continue;
            }
            const total = r2(rows.invoice_lines.filter((l) => l.invoice_id === iv.id).reduce((s, l) => s + Number(l.amount || 0), 0));
            const why = iv.qbo_entered_at ? "Already entered" + (iv.qbo_ref ? " as " + iv.qbo_ref : "") + "."
              : iv.status === "void" ? "Voided: nothing to enter." : iv.status === "draft" ? "Not sent yet." : !(total > 0) ? "No amount on it yet." : "";
            if (why) { refused.push({ id, reason: why }); continue; }
            write(w, "invoices", iv, { qbo_entered_at: nowIso(), qbo_entered_by: w.uid, qbo_ref: ref });
            done.push(id);
          }
          return marking ? { marked: done, refused, enteredAt: nowIso(), ref } : { unmarked: done, refused };
        }
        case "payment_told": {
          if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, can mark a payment told");
          let how = null;
          if (a.p_how !== null && a.p_how !== undefined && String(a.p_how).trim()) {
            const k = String(a.p_how).trim().toLowerCase().replace(/[\s_-]+/g, " ");
            how = { phone: "phone", "by phone": "phone", call: "phone", "in person": "in person", person: "in person", email: "email", "e mail": "email",
              "by email": "email", text: "text message", "text message": "text message", sms: "text message" }[k] || null;
            if (!how) throw rule("22023", "how must be phone, in person, email or text");
          }
          if (a.p_version === null || a.p_version === undefined) throw rule("22023", "mark the payment as it was shown: its version is required");
          const p = rows.payments.find((x) => x.id === Number(a.p_id));
          const b = p ? billOf(p.bill_id) : null;
          if (!p || !b || b.deleted_at || b.void || !projectVisible(w, p.project_id)) throw notFound("payment");
          if (Number(p.version) !== Number(a.p_version)) throw pt409("payments", p.id, p.version);
          payRule("told", w, p, how);
          // M5b: a mark is made on a check or cash only, and cleared on any payment
          if (how !== null && !["check", "cash"].includes(p.method)) throw rule("22023", "only a check or cash is picked up in person");
          const shape = (x, already) => Object.assign({ ok: true, toldAt: x.pickup_told_at, toldDate: x.pickup_told_at ? companyDay(new Date(x.pickup_told_at)) : null,
            toldBy: x.pickup_told_by, toldHow: x.pickup_told_how, version: x.version }, already ? { already: true } : {});
          if ((how === null && !p.pickup_told_at) || (how !== null && p.pickup_told_at)) return shape(p, true);
          const by = how === null ? null : ((w.p && String(w.p.full_name || "").trim()) || (w.p && w.p.email) || "The office").slice(0, 120);
          return shape(write(w, "payments", p, { pickup_told_at: how === null ? null : nowIso(), pickup_told_by: by, pickup_told_how: how }), false);
        }
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }

    return {
      name: "p5b-books", tables, canRead, canInsert, canUpdate, canDelete, beforeInsert, guardUpdate,
      views: { books_desk: desk }, handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
    };
  }
  // FIRST among the later phases: bills, payments and invoices are p5a-pm.js's tables too, and the engine asks the
  // first extension that names a table
  (NS.extInstall = NS.extInstall || []).unshift(install);

  /* ── made-up data (after tools/fake/p5a-pm.js made the sandbox's bills, and p5b-ledger.js its costs) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedBooks(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const iso = (d) => new Date(d).toISOString();
    const at = (days, hour) => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d - days, 16 + (hour || 0), 40, 0));
      return t.getTime() > now.getTime() ? iso(now.getTime() - 60000 * (days + 9)) : iso(t);
    };
    const day = (days) => {
      const [y, m, d] = today.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
    };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.accountant, updated_at: at(days), updated_by: null, version: 1 });

    // the demo approver: a manager with the approve and financials switches (prices off - Q1)
    if (out.profiles && !out.profiles.some((p) => p.id === APPROVER.id)) {
      out.profiles.push(Object.assign({ id: APPROVER.id, full_name: APPROVER.full_name, email: APPROVER.email, phone: APPROVER.phone, role: APPROVER.role,
        color: APPROVER.color, can_see_prices: false, can_see_financials: true, can_approve_payments: true, active: true, must_change_password: false },
        { created_at: iso(now.getTime() - 300 * 86400000), created_by: P.admin, updated_at: iso(now.getTime() - 300 * 86400000), updated_by: null, version: 1 }));
    }
    if (Array.isArray(NS.PEOPLE) && !NS.PEOPLE.some((p) => p.key === APPROVER.key)) {
      NS.PEOPLE.push({ key: APPROVER.key, id: APPROVER.id, email: APPROVER.email, name: APPROVER.full_name, role: APPROVER.role, note: "approve + financials switched on" });
    }
    P.approver = APPROVER.id;

    ["bills", "payments", "invoices", "invoice_lines", "client_payments", "files"].forEach((t) => { out[t] = out[t] || []; });
    out.objects = out.objects || {};
    out.bills.forEach((b) => Object.keys(BILL_EXTRA).forEach((k) => { if (!(k in b)) b[k] = BILL_EXTRA[k]; }));
    out.invoices.forEach((iv) => Object.keys(INVOICE_EXTRA).forEach((k) => { if (!(k in iv)) iv[k] = INVOICE_EXTRA[k]; }));
    out.payments.forEach((p) => Object.keys(PAYMENT_EXTRA).forEach((k) => { if (!(k in p)) p[k] = PAYMENT_EXTRA[k]; }));
    const maxId = (t) => out[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const ids = { b: maxId("bills"), p: maxId("payments"), i: maxId("invoices"), l: maxId("invoice_lines"), c: maxId("client_payments"), f: maxId("files") };
    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const contact = (company) => out.contacts.find((c) => c.company === company) || null;

    function doc(project, name, days, image) {
      const id = ++ids.f;
      const leaf = name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      const key = "f/" + project.id + "/receipts/" + (id.toString(16).padStart(8, "0") + "b".repeat(24)) + "/" + leaf;
      out.files.push(Object.assign({ id, project_id: project.id, estimate_item_id: null, journal_entry_id: null, bill_id: null, cost_id: null, folder: "receipts",
        subpath: "", name, storage_path: key, size: image ? 356000 : 164000, mime: image ? "image/jpeg" : "application/pdf", version_no: 1, previous_id: null,
        is_financial: true, storage: "cloud", rel_path: null, modified_at: null, description: null, preview_path: null, source: "desktop", deleted_at: null },
        audit(days, P.accountant)));
      out.objects[key] = { size: image ? 356000 : 164000, mime: image ? "image/jpeg" : "application/pdf", owner: P.accountant, created_at: at(days) };
      return id;
    }
    function bill(project, f, days) {
      const id = ++ids.b;
      const c = f.vendor === undefined ? null : f.vendor;
      const row = Object.assign({ id, project_id: project.id, estimate_item_id: null, quote_id: null, vendor_contact_id: c ? c.id : null,
        vendor_name: c ? c.company || c.name : null, invoice_number: "INV-" + (6200 + id), invoice_date: day(days), due_date: day(days - 30), amount: 0,
        description: null, document_file_id: null, void: false, approved_by: null, approved_at: null, approved_amount: null, pay_method: null,
        approval_note: null, deleted_at: null }, BILL_EXTRA, f, audit(days, P.accountant));
      delete row.vendor;
      if (f.doc) {
        row.document_file_id = doc(project, f.doc, days, !!f.image);
        const file = out.files.find((x) => x.id === row.document_file_id);
        if (file) file.bill_id = id;
        delete row.doc;
      }
      delete row.image;
      out.bills.push(row);
      return row;
    }
    function approve(b, days, method, by, note) {
      Object.assign(b, { approved_by: by || P.admin, approved_at: at(days, 1), approved_amount: b.amount, pay_method: method, approval_note: note || null });
    }
    function pay(b, amount, days, method, number, extra) {
      const row = Object.assign({ id: ++ids.p, bill_id: b.id, project_id: b.project_id, paid_date: day(days), amount, method,
        check_number: method === "check" ? number : null, reference: method !== "check" ? number || null : null, notes: null }, PAYMENT_EXTRA, extra || {},
        audit(days, P.accountant));
      out.payments.push(row);
      return row;
    }
    function entered(r, days, ref, by) { Object.assign(r, { qbo_entered_at: at(days, 2), qbo_entered_by: by || P.accountant, qbo_ref: ref || null }); }
    function invoice(project, f, lines, days, paid) {
      const id = ++ids.i;
      const row = Object.assign({ id, project_id: project.id, number: project.number + "-" + String(out.invoices.filter((x) => x.project_id === project.id).length + 1).padStart(2, "0"),
        invoice_date: day(days), due_date: day(days - 15), description: null, status: "sent", sent_date: day(days), terms: "Net 15", notes: null, deleted_at: null },
        INVOICE_EXTRA, f, audit(days, P.accountant));
      out.invoices.push(row);
      lines.forEach((l, n) => out.invoice_lines.push(Object.assign({ id: ++ids.l, invoice_id: id, sort: n + 1, description: l[0], qty: 1, unit_price: l[1], amount: l[1],
        estimate_id: null }, audit(days, P.accountant))));
      if (paid) out.client_payments.push(Object.assign({ id: ++ids.c, invoice_id: id, paid_date: day(paid[1]), amount: paid[0], method: "check", reference: paid[2] || null },
        audit(paid[1], P.accountant)));
      return row;
    }

    /* the sandbox's bills (tools/fake/p5a-pm.js): their kinds, and the floor package keyed into QuickBooks */
    const sb = byNumber("A267");
    if (sb) {
      const mine = out.bills.filter((b) => b.project_id === sb.id).sort((a, b) => a.id - b.id);
      const kinds = ["Material supplier", "Equipment", "Subcontractor", "Subcontractor", "Equipment"];
      mine.forEach((b, i) => { if (!b.kind) b.kind = kinds[i] || "Other"; });
      if (mine[0] && mine[0].approved_at) entered(mine[0], 10, "QB-1042");
    }

    /* A303 (approved): waiting for an approval - one with its paperwork, one without */
    const roof = byNumber("A303");
    if (roof) {
      bill(roof, { vendor: contact("Quarryman Concrete"), kind: "Subcontractor", amount: 3850, description: "Footings and stem wall, phase 1",
        doc: "Quarryman phase 1 invoice.pdf", due_date: day(-5) }, 4);
      bill(roof, { vendor: contact("Marlow Lumber Supply"), kind: "Material supplier", amount: 1264.18, description: "Roof framing package (back order)",
        due_date: day(-12) }, 2);
      // approved for check, nothing paid; a memo line a spreadsheet would run as a formula without the guard
      const b = bill(roof, { vendor: contact("Rosewell Concrete"), kind: "Subcontractor", amount: 2400, description: "-10% retainage held until the final walk",
        doc: "Rosewell progress bill.jpg", image: true }, 9);
      approve(b, 6, "check", P.admin, "Retainage per the contract");
      invoice(roof, { description: "Roof framing, deposit" }, [["Deposit - 30% of the contract", 8400]], 6, null);
    }

    /* A294 (in progress): approved for cash and for either, one part paid; a late one */
    const shop = byNumber("A294");
    if (shop) {
      const a = bill(shop, { vendor: contact("Oakfield Concrete"), kind: "Subcontractor", amount: 680, description: "Slab patch at the roll-up door",
        doc: "Oakfield patch.pdf", due_date: day(6) }, 30);
      approve(a, 20, "cash", P.admin);
      const b = bill(shop, { vendor_name: "Hillside Equipment Rental", kind: "Equipment", amount: 1200, description: "Telehandler, one week",
        doc: "Telehandler rental.pdf" }, 14);
      approve(b, 12, "both", APPROVER.id, "Cash for the deposit, the rest by check");
      pay(b, 400, 11, "cash", "Petty cash slip 18", { payee: "Hillside Equipment Rental", memo: "A294 · Telehandler deposit" });
      // approved to be paid by bank transfer: one part paid by ACH (nobody is told - it is never picked up), one not yet
      const t = bill(shop, { vendor_name: "Summit Steel Fabricators", kind: "Subcontractor", amount: 4120, description: "Moment frame, shop and install",
        doc: "Summit moment frame.pdf" }, 16);
      approve(t, 13, "transfer", APPROVER.id, "Wire or ACH - their bank details are on file");
      pay(t, 2000, 9, "ach", "ACH 0041-7781", { payee: "Summit Steel Fabricators", memo: "A294 · Moment frame, first half" });
      const t2 = bill(shop, { vendor_name: "Northgate Rebar Supply", kind: "Material supplier", amount: 1388.25, description: "Rebar for the slab extension",
        doc: "Northgate rebar.pdf", due_date: day(-8) }, 5);
      approve(t2, 3, "transfer", P.admin);
      invoice(shop, { description: "Shop framing, draw 2" }, [["Framing - draw 2", 15600]], 25, [6000, 10, "3310"]);
      entered(out.invoices[out.invoices.length - 1], 20, "INV-QB-2207");
    }

    /* A284 (in progress): paid by check and not told yet; paid, told and entered */
    const porch = byNumber("A284");
    if (porch) {
      const a = bill(porch, { vendor: contact("Brightwater Concrete"), kind: "Subcontractor", amount: 2950, description: "Porch footings",
        doc: "Brightwater footings.pdf" }, 21);
      approve(a, 18, "check", P.admin);
      pay(a, 2950, 2, "check", "5310", { payee: "Brightwater Concrete", memo: "A284 · Inv " + a.invoice_number + " · Porch footings" });
      entered(a, 15, "QB-1051");
      const b = bill(porch, { vendor: contact("Larkspur Lumber Supply"), kind: "Material supplier", amount: 812.4, description: "Porch decking and hardware",
        doc: "Larkspur decking.pdf" }, 40);
      approve(b, 36, "check", APPROVER.id);
      pay(b, 812.4, 33, "check", "5288", { payee: "Larkspur Lumber Supply", memo: "A284 · Porch decking", pickup_told_at: at(32, 3),
        pickup_told_by: "Casey Accounts", pickup_told_how: "email" });
      entered(b, 30, "QB-1033");
      // approved to be paid on the company card
      const c = bill(porch, { vendor_name: "Coastline Equipment Rentals", kind: "Equipment", amount: 386.5, description: "Plate compactor, two days",
        doc: "Coastline rental.pdf" }, 7);
      approve(c, 5, "card", APPROVER.id, "Put it on the company card");
      invoice(porch, { description: "Porch, complete", status: "paid" }, [["Porch framing and decking - complete", 9800]], 28, [9800, 9, "2296"]);
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

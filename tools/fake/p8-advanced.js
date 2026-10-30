/* DCR Portal 2 — DEMO MODE ONLY: the Books program's Advanced mode, release B part 2b (DCR Desktop 2 migrations
   20261030000500_books_reports - docs/DATABASE.md §35 -, 20261030000200's vendor_profiles - §32.2 - and the money
   history of 20261030000300_check_register - money_events, §33.7) in the in-memory database, read and written by
   books-vendors.html and books-reports.html. Loaded BEFORE engine.js and AFTER tools/fake/p8-books.js (the bills,
   payments, spoiled blanks and money messages it reads are p5b-books.js's, p8-register.js's and p8-books.js's);
   installed into each engine (NS.extInstall). Never published (tools/ is not part of the site).

   The same names, rules and sentences as the migrations (a port of their SQL; the migrations are the truth):
   * public.vendor_profiles (contact_id the key; the financials switch reads; money editors add - a live contact - and
     change; nobody deletes; never another contact's: 42501 "a contact's vendor details stay with that contact"; the
     words tidied - one line for the legal name and the license, blank -> NULL; workers' comp exempt OR a date: 23514);
   * the four report functions, SECURITY INVOKER over the caller's own rows, each first app.books_reader() - the
     financials AND prices switches, else 42501 "the Books reports need the financials and prices switches":
     books_ap_aging(p_as_of) (what was owed on a day, by days past due; a later payment and a voided one never count),
     books_vendor_balances() (owed as books_desk, past due, paid this year and last, the vendor's facts and flags),
     books_1099(p_year, p_threshold) (cash basis; card and materials excluded; $600 through 2025, $2,000 from 2026) and
     books_payments_by_month(p_from, p_to) (per month and method: live, voided, cleared and not - NULL for cash);
   * public.money_events - in the demo a view over the rows' own stamps (the real table is appended to by the
     database's t97 triggers and never changes): a bill added, approved, entered in QuickBooks or voided, a payment
     recorded, told, picked up, cleared or voided, a money file attached, a blank spoiled, a money e-mail queued / sent,
     a text sent, a vendor's details changed - with the real columns, the financials switch to read (a deleted job's
     rows admins only), never a message body or an address in detail.
   Made-up data only: vendor details on three made-up vendor contacts - a 1099 sub whose insurance runs out within the
   month and whose workers' comp has run out, a 1099 sub with no W-9 whose insurance has run out, and a supplier exempt
   from workers' comp. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const SIGS = {
    books_ap_aging: ["p_as_of"],
    books_vendor_balances: [],
    books_1099: ["p_year", "p_threshold"],
    books_payments_by_month: ["p_from", "p_to"],
  };
  const OPTIONAL = { books_ap_aging: ["p_as_of"], books_1099: ["p_threshold"] };
  NS.p8AdvancedSigs = SIGS;   // tools/schema-check-p8-advanced.mjs compares them with the real functions' arguments
  const PROFILE_COLS = { contact_id: null, tax_1099: false, legal_name: null, w9_received_on: null, insurance_expires_on: null,
    workers_comp_expires_on: null, workers_comp_exempt: false, license_number: null, notes: null };
  const EVENT_COLS = { id: null, at: null, actor_id: null, actor_name: null, kind: null, project_id: null, bill_id: null, payment_id: null,
    file_id: null, contact_id: null, message_id: null, amount: null, detail: null, created_at: null, created_by: null, updated_at: null,
    updated_by: null, version: null };
  NS.p8AdvancedCols = { vendor_profiles: PROFILE_COLS, money_events: EVENT_COLS };

  (NS.extTables = NS.extTables || []).push({
    tables: ["vendor_profiles", "money_events"],
    cols: { vendor_profiles: PROFILE_COLS, money_events: EVENT_COLS },
    pk: { vendor_profiles: "contact_id" },
    uuid: [],
    noAudit: ["money_events"],
    fks: [],
  });

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const trimOrNull = (v) => { const s = String(v === null || v === undefined ? "" : v).trim(); return s || null; };
  /** app.one_line */
  const oneLine = (v) => { const s = String(v === null || v === undefined ? "" : v).replace(/[\s ]+/g, " ").trim(); return s || null; };
  /** app.text_block */
  const textBlock = (v) => { if (v === null || v === undefined) return null; const s = String(v).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, ""); return s.trim() ? s : null; };
  /** app.payee_key(contact, null, vendor_name) */
  function payeeKey(contact, payee, vendorName) {
    if (contact !== null && contact !== undefined) return "c" + contact;
    const t = (v) => String(v === null || v === undefined ? "" : v).replace(/^ +| +$/g, "");
    const name = t(payee) || (vendorName === null || vendorName === undefined ? "" : String(vendorName));
    return "n" + t(name).replace(/\s+/g, " ").toLowerCase();
  }
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const dayKey = (v) => (v === null || v === undefined ? null : String(v).slice(0, 10));
  const dayDiff = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);
  const sum = (list, f) => list.reduce((n, x) => n + Number(f(x) || 0), 0);
  const ORDER = ["check", "cash", "ach", "wire", "card", "other"];

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS, PgErr, deny, rule, today, companyDay, readable, projectVisible, profileOf } = E;
    if (!rows.bills || !rows.payments || !rows.vendor_profiles) return null;
    const tables = new Set(["vendor_profiles", "money_events"]);
    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const contactOf = (id) => rows.contacts.find((c) => c.id === Number(id)) || null;

    function canRead(w, table, r) {
      if (!w.active) return false;
      if (table === "vendor_profiles") return !!w.financials;
      if (table === "money_events") return !!w.financials && projectVisible(w, r.project_id);
      return false;
    }
    function canInsert(w, table, r) {
      if (table !== "vendor_profiles" || !moneyEditor(w)) return false;
      const c = contactOf(r.contact_id);
      return !!c && !c.deleted_at;
    }
    function canUpdate(w, table) { return table === "vendor_profiles" && moneyEditor(w); }
    // the migration's checks and t10_vendor_profiles (tidy the words; never another contact's)
    function tidy(w, r, old) {
      if (old && Number(r.contact_id) !== Number(old.contact_id)) throw deny("a contact's vendor details stay with that contact");
      if (!contactOf(r.contact_id)) throw rule("23503", 'insert or update on table "vendor_profiles" violates foreign key constraint "vendor_profiles_contact_id_fkey"');
      r.legal_name = oneLine(r.legal_name);
      r.license_number = oneLine(r.license_number);
      r.notes = textBlock(r.notes);
      r.tax_1099 = r.tax_1099 === true;
      r.workers_comp_exempt = r.workers_comp_exempt === true;
      const bad = (c) => rule("23514", 'new row for relation "vendor_profiles" violates check constraint "vendor_profiles_' + c + '_check"');
      if (r.legal_name && r.legal_name.length > 200) throw bad("legal_name");
      if (r.license_number && r.license_number.length > 40) throw bad("license_number");
      if (r.notes && r.notes.length > 1000) throw bad("notes");
      ["w9_received_on", "insurance_expires_on", "workers_comp_expires_on"].forEach((c) => {
        if (r[c] === "") r[c] = null;
        if (r[c] !== null && r[c] !== undefined && !DAY.test(String(r[c]).slice(0, 10))) throw rule("22007", 'invalid input syntax for type date: "' + r[c] + '"');
        if (r[c]) r[c] = String(r[c]).slice(0, 10);
      });
      if (r.workers_comp_exempt && r.workers_comp_expires_on) {
        throw rule("23514", 'new row for relation "vendor_profiles" violates check constraint "vendor_profiles_wc"');
      }
    }

    /* app.books_reader(): the financials AND prices switches */
    function reader(w) {
      if (!(w && w.active && w.financials && w.prices)) throw deny("the Books reports need the financials and prices switches");
    }
    const liveBills = (w) => readable(w, "bills").filter((b) => !b.deleted_at && !b.void);
    const livePays = (w) => readable(w, "payments").filter((p) => !p.voided_at);
    const contactsSeen = (w) => new Map(readable(w, "contacts").map((c) => [c.id, c]));
    const nameOf = (cmap, cid, fallback) => {
      const c = cid === null || cid === undefined ? null : cmap.get(Number(cid));
      return (c && (trimOrNull(c.company) || c.name)) || fallback || null;
    };
    const newestName = (list) => {
      const x = list.slice().sort((a, b) => b.id - a.id).map((b) => oneLine(b.vendor_name)).filter(Boolean);
      return x.length ? x[0] : null;
    };
    const byName = (a, b) => {
      const x = a.vendor_name === null ? null : String(a.vendor_name).toLowerCase(), y = b.vendor_name === null ? null : String(b.vendor_name).toLowerCase();
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) || (a.vendor_key < b.vendor_key ? -1 : a.vendor_key > b.vendor_key ? 1 : 0);
    };

    function apAging(w, a) {
      reader(w);
      const asOf = a.p_as_of ? dayKey(a.p_as_of) : today();
      const pays = livePays(w);
      const cmap = contactsSeen(w);
      const groups = new Map();
      liveBills(w).forEach((b) => {
        const dated = dayKey(b.invoice_date) || companyDay(new Date(b.created_at));
        if (dated > asOf) return;
        const approvedThen = !!b.approved_at && companyDay(new Date(b.approved_at)) <= asOf;
        const base = approvedThen ? Number(b.approved_amount || 0) : Number(b.amount || 0);
        const paidThen = sum(pays.filter((p) => p.bill_id === b.id && String(p.paid_date).slice(0, 10) <= asOf), (p) => p.amount);
        const amt = Math.max(base - paidThen, 0);
        if (!(amt > 0)) return;
        const key = payeeKey(b.vendor_contact_id, null, b.vendor_name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ b, amt, due: dayKey(b.due_date), approvedThen });
      });
      const out = [];
      groups.forEach((list, key) => {
        const cids = list.map((x) => x.b.vendor_contact_id).filter((c) => c !== null && c !== undefined);
        const cid = cids.length ? Math.max.apply(null, cids) : null;
        const f = (pred) => r2(sum(list.filter(pred), (x) => x.amt));
        const late = (x) => (x.due ? dayDiff(asOf, x.due) : null);
        const dues = list.map((x) => x.due).filter(Boolean).sort();
        out.push({ as_of: asOf, vendor_contact_id: cid, vendor_key: key, vendor_name: nameOf(cmap, cid, newestName(list.map((x) => x.b))), open_bills: list.length,
          current: f((x) => x.due && x.due >= asOf), d1_30: f((x) => x.due && late(x) >= 1 && late(x) <= 30), d31_60: f((x) => x.due && late(x) >= 31 && late(x) <= 60),
          d61_90: f((x) => x.due && late(x) >= 61 && late(x) <= 90), d90_plus: f((x) => x.due && late(x) > 90), no_due: f((x) => !x.due),
          waiting_approval: f((x) => !x.approvedThen), total: r2(sum(list, (x) => x.amt)), oldest_due_date: dues[0] || null,
          bill_ids: list.slice().sort((x, y) => (x.due === y.due ? x.b.id - y.b.id : x.due === null ? 1 : y.due === null ? -1 : x.due < y.due ? -1 : 1)).map((x) => x.b.id) });
      });
      return out.sort(byName);
    }

    function vendorBalances(w) {
      reader(w);
      const t = today();
      const year = t.slice(0, 4) + "-01-01";
      const lastYear = (Number(t.slice(0, 4)) - 1) + "-01-01";
      const pays = livePays(w);
      const cmap = contactsSeen(w);
      const profiles = new Map(readable(w, "vendor_profiles").map((p) => [Number(p.contact_id), p]));
      const bills = liveBills(w);
      const groups = new Map();
      bills.forEach((b) => {
        const key = payeeKey(b.vendor_contact_id, null, b.vendor_name);
        if (!groups.has(key)) groups.set(key, []);
        const pd = sum(pays.filter((p) => p.bill_id === b.id), (p) => p.amount);
        const ow = Math.max((b.approved_at ? Number(b.approved_amount || 0) : Number(b.amount || 0)) - pd, 0);
        groups.get(key).push({ b, pd, ow });
      });
      const liveIds = new Set(bills.map((b) => b.id));
      const paysByKey = new Map();
      pays.forEach((p) => {
        if (!liveIds.has(p.bill_id)) return;
        const b = bills.find((x) => x.id === p.bill_id);
        const key = payeeKey(b.vendor_contact_id, null, b.vendor_name);
        if (!paysByKey.has(key)) paysByKey.set(key, []);
        paysByKey.get(key).push(p);
      });
      const keys = new Map();
      groups.forEach((list, key) => {
        const cids = list.map((x) => x.b.vendor_contact_id).filter((c) => c !== null && c !== undefined);
        keys.set(key, cids.length ? Math.max.apply(null, cids) : null);
      });
      cmap.forEach((c) => {
        if (c.deleted_at) return;
        if (["subcontractor", "supplier", "service"].includes(c.kind) || profiles.has(c.id)) keys.set("c" + c.id, c.id);
      });
      const out = [];
      keys.forEach((cid, key) => {
        const list = groups.get(key) || [];
        const ps = paysByKey.get(key) || [];
        const c = cid === null ? null : cmap.get(cid) || null;
        const vp = cid === null ? null : profiles.get(cid) || null;
        const lastDay = ps.map((p) => String(p.paid_date).slice(0, 10)).sort().pop() || null;
        out.push({ vendor_contact_id: cid, vendor_key: key, vendor_name: nameOf(cmap, cid, newestName(list.map((x) => x.b))), contact_kind: c ? c.kind : null,
          bills: list.length, open_bills: list.filter((x) => x.ow > 0).length,
          billed: r2(sum(list, (x) => x.b.amount)), approved: r2(sum(list.filter((x) => x.b.approved_at), (x) => x.b.approved_amount)),
          paid: r2(sum(list, (x) => x.pd)), owed: r2(sum(list, (x) => x.ow)),
          past_due: r2(sum(list.filter((x) => x.b.due_date && dayKey(x.b.due_date) < t), (x) => x.ow)),
          waiting_approval: r2(sum(list.filter((x) => !x.b.approved_at), (x) => x.ow)),
          paid_ytd: r2(sum(ps.filter((p) => String(p.paid_date) >= year && String(p.paid_date).slice(0, 10) <= t), (p) => p.amount)),
          paid_last_year: r2(sum(ps.filter((p) => String(p.paid_date) >= lastYear && String(p.paid_date) < year), (p) => p.amount)),
          last_paid_date: lastDay, last_paid_amount: lastDay ? r2(sum(ps.filter((p) => String(p.paid_date).slice(0, 10) === lastDay), (p) => p.amount)) : null,
          tax_1099: !!(vp && vp.tax_1099), legal_name: vp ? vp.legal_name : null, w9_received_on: vp ? vp.w9_received_on : null, w9_missing: !(vp && vp.w9_received_on),
          insurance_expires_on: vp ? vp.insurance_expires_on : null, insurance_expired: !!(vp && vp.insurance_expires_on && vp.insurance_expires_on < t),
          workers_comp_expires_on: vp ? vp.workers_comp_expires_on : null, workers_comp_exempt: !!(vp && vp.workers_comp_exempt),
          workers_comp_expired: !!(vp && !vp.workers_comp_exempt && vp.workers_comp_expires_on && vp.workers_comp_expires_on < t),
          license_number: vp ? vp.license_number : null, profile_version: vp ? vp.version : null });
      });
      return out.sort(byName);
    }

    function w1099(w, a) {
      reader(w);
      const y = a.p_year === null || a.p_year === undefined ? null : Number(a.p_year);
      if (y === null || !Number.isInteger(y) || y < 2000 || y > 2100) throw rule("22023", "the 1099 report needs a calendar year between 2000 and 2100");
      if (a.p_threshold !== null && a.p_threshold !== undefined && Number(a.p_threshold) < 0) throw rule("22023", "the 1099 threshold cannot be negative");
      const threshold = r2(a.p_threshold === null || a.p_threshold === undefined ? (y <= 2025 ? 600 : 2000) : Number(a.p_threshold));
      const bills = new Map(liveBills(w).map((b) => [b.id, b]));
      const cmap = contactsSeen(w);
      const profiles = new Map(readable(w, "vendor_profiles").map((p) => [Number(p.contact_id), p]));
      const groups = new Map();
      livePays(w).forEach((p) => {
        const b = bills.get(p.bill_id);
        if (!b) return;
        const d = String(p.paid_date).slice(0, 10);
        if (d < y + "-01-01" || d > y + "-12-31") return;
        const key = payeeKey(b.vendor_contact_id, null, b.vendor_name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ p, b, mat: b.kind === "Material supplier" });
      });
      const out = [];
      groups.forEach((list, key) => {
        const cids = list.map((x) => x.b.vendor_contact_id).filter((c) => c !== null && c !== undefined);
        const cid = cids.length ? Math.max.apply(null, cids) : null;
        const f = (pred) => r2(sum(list.filter(pred), (x) => x.p.amount));
        const chk = f((x) => x.p.method === "check" && !x.mat), csh = f((x) => x.p.method === "cash" && !x.mat);
        const xfer = f((x) => (x.p.method === "ach" || x.p.method === "wire") && !x.mat), oth = f((x) => x.p.method === "other" && !x.mat);
        const total = r2(chk + csh + xfer + oth);
        const vp = cid === null ? null : profiles.get(cid) || null;
        out.push({ year: y, vendor_contact_id: cid, vendor_key: key, vendor_name: nameOf(cmap, cid, newestName(list.map((x) => x.b))), legal_name: vp ? vp.legal_name : null,
          tax_1099: !!(vp && vp.tax_1099), w9_received_on: vp ? vp.w9_received_on : null, paid_check: chk, paid_cash: csh, paid_transfer: xfer, paid_other: oth,
          card_excluded: f((x) => x.p.method === "card"), materials_excluded: f((x) => x.mat && x.p.method !== "card"), reportable_total: total,
          payments: list.length, threshold, reportable: !!(vp && vp.tax_1099) && total >= threshold, needs_w9: total >= threshold && !(vp && vp.w9_received_on) });
      });
      return out.sort((a2, b2) => b2.reportable_total - a2.reportable_total || byName(a2, b2));
    }

    function byMonth(w, a) {
      reader(w);
      if (!a.p_from || !a.p_to) throw rule("22023", "from and to are dates (YYYY-MM-DD)");
      const from = dayKey(a.p_from), to = dayKey(a.p_to);
      if (to < from) throw rule("22023", "to must not be before from");
      const bills = new Set(liveBills(w).map((b) => b.id));
      const groups = new Map();
      readable(w, "payments").forEach((p) => {
        const d = String(p.paid_date).slice(0, 10);
        if (!bills.has(p.bill_id) || d < from || d > to) return;
        const k = d.slice(0, 7) + "-01|" + p.method;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      });
      const out = [];
      groups.forEach((list, k) => {
        const [month, method] = k.split("|");
        const live = list.filter((p) => !p.voided_at), voided = list.filter((p) => p.voided_at);
        const cash = method === "cash";
        const cl = live.filter((p) => p.cleared_on), nc = live.filter((p) => !p.cleared_on);
        out.push({ month, method, payments: live.length, total: r2(sum(live, (p) => p.amount)), voided: voided.length, voided_total: r2(sum(voided, (p) => p.amount)),
          cleared: cash ? null : cl.length, cleared_total: cash ? null : r2(sum(cl, (p) => p.amount)),
          not_cleared: cash ? null : nc.length, not_cleared_total: cash ? null : r2(sum(nc, (p) => p.amount)) });
      });
      const pos = (m) => { const i = ORDER.indexOf(m); return i === -1 ? 99 : i; };
      return out.sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : 0) || pos(x.method) - pos(y.method) || (x.method < y.method ? -1 : 1));
    }

    /* money_events: in the demo, the rows' own stamps (see the header) */
    function history(w) {
      if (!w || !w.active || !w.financials) return [];
      const ev = [];
      const actor = (uid, fallback) => { const p = uid ? profileOf(uid) : null; return (p && (String(p.full_name || "").trim() || p.email)) || fallback || "System"; };
      const add = (at, kind, o) => { if (at) ev.push(Object.assign({ at: new Date(at).toISOString(), kind, actor_id: null, actor_name: "System", project_id: null, bill_id: null,
        payment_id: null, file_id: null, contact_id: null, message_id: null, amount: null, detail: {} }, o)); };
      rows.bills.forEach((b) => {
        const base = { project_id: b.project_id, bill_id: b.id };
        add(b.created_at, "bill_added", Object.assign({}, base, { actor_id: b.created_by, actor_name: actor(b.created_by), amount: r2(b.amount),
          detail: { vendorName: b.vendor_name || undefined, invoiceNumber: b.invoice_number || undefined } }));
        if (b.approved_at) add(b.approved_at, "bill_approved", Object.assign({}, base, { actor_id: b.approved_by, actor_name: actor(b.approved_by), amount: r2(b.approved_amount),
          detail: { payMethod: b.pay_method || undefined } }));
        if (b.qbo_entered_at) add(b.qbo_entered_at, "bill_entered", Object.assign({}, base, { actor_id: b.qbo_entered_by, actor_name: actor(b.qbo_entered_by), detail: { ref: b.qbo_ref || undefined } }));
        if (b.void) add(b.updated_at, "bill_voided", Object.assign({}, base, { actor_id: b.updated_by, actor_name: actor(b.updated_by), amount: r2(b.amount) }));
      });
      rows.payments.forEach((p) => {
        const base = { project_id: p.project_id, bill_id: p.bill_id, payment_id: p.id, amount: r2(p.amount) };
        add(p.created_at, "payment_recorded", Object.assign({}, base, { actor_id: p.created_by, actor_name: actor(p.created_by),
          detail: { method: p.method, checkNumber: p.check_number || undefined, paidDate: String(p.paid_date).slice(0, 10), payee: p.payee || undefined } }));
        if (p.pickup_told_at) add(p.pickup_told_at, "payment_told", Object.assign({}, base, { actor_name: String(p.pickup_told_by || "System").slice(0, 140),
          detail: { how: p.pickup_told_how || undefined, by: p.pickup_told_by || undefined } }));
        if (p.picked_up_at) add(p.picked_up_at, "payment_picked_up", Object.assign({}, base, { actor_id: p.picked_up_by, actor_name: actor(p.picked_up_by),
          detail: { on: companyDay(new Date(p.picked_up_at)), note: p.picked_up_note || undefined } }));
        if (p.cleared_at) add(p.cleared_at, "payment_cleared", Object.assign({}, base, { actor_id: p.cleared_by, actor_name: actor(p.cleared_by), detail: { on: p.cleared_on } }));
        if (p.voided_at) add(p.voided_at, "payment_voided", Object.assign({}, base, { actor_id: p.voided_by, actor_name: actor(p.voided_by), detail: { reason: p.void_reason } }));
      });
      (rows.files || []).forEach((f) => {
        if (!f.is_financial || f.deleted_at || !(f.bill_id || f.cost_id || f.payment_id)) return;
        add(f.created_at, "file_attached", { project_id: f.project_id, bill_id: f.bill_id || null, payment_id: f.payment_id || null, file_id: f.id,
          actor_id: f.created_by, actor_name: actor(f.created_by), detail: { fileId: f.id, name: f.name, mime: f.mime || undefined, billId: f.bill_id || undefined, paymentId: f.payment_id || undefined } });
      });
      (rows.spoiled_checks || []).forEach((s) => add(s.created_at, "check_spoiled", { actor_id: s.created_by, actor_name: actor(s.created_by),
        detail: { spoiledId: s.id, number: s.check_number, reason: s.reason, on: s.spoiled_on } }));
      (rows.money_messages || []).forEach((m) => {
        const bills = (m.bill_ids || []).map((id) => rows.bills.find((b) => b.id === Number(id))).filter(Boolean);
        const projects = Array.from(new Set(bills.map((b) => b.project_id)));
        const base = { project_id: projects.length === 1 ? projects[0] : null, bill_id: (m.bill_ids || []).length === 1 ? Number(m.bill_ids[0]) : null,
          payment_id: (m.payment_ids || []).length === 1 ? Number(m.payment_ids[0]) : null, contact_id: m.to_contact_id || null, message_id: m.id };
        const detail = { messageKind: m.kind, templateKey: m.template_key, channel: m.channel, status: m.status };
        if (m.channel === "email") add(m.created_at, "message_queued", Object.assign({}, base, { actor_id: m.created_by, actor_name: actor(m.created_by), detail: Object.assign({}, detail, { status: "queued" }) }));
        if (m.channel === "email" && m.status === "sent") add(m.sent_at, "message_sent", Object.assign({}, base, { actor_name: "DCR Agents 2 (automatic)", detail }));
        if (m.channel === "email" && m.status === "not_sent") add(m.updated_at, "message_not_sent", Object.assign({}, base, { actor_name: "DCR Agents 2 (automatic)", detail }));
        if (m.channel === "sms" && m.status === "sent") add(m.sent_at || m.updated_at, "text_sent", Object.assign({}, base, { actor_id: m.created_by, actor_name: actor(m.created_by), detail }));
      });
      // vendor_changed as t97_vendor_profiles_money_events words a first save: {added: true} and the facts set, camelCase
      const CAMEL = { tax_1099: "tax1099", legal_name: "legalName", w9_received_on: "w9ReceivedOn", insurance_expires_on: "insuranceExpiresOn",
        workers_comp_expires_on: "workersCompExpiresOn", workers_comp_exempt: "workersCompExempt", license_number: "licenseNumber", notes: "notes" };
      rows.vendor_profiles.forEach((v) => {
        const changed = { added: true };
        Object.keys(CAMEL).forEach((k) => { if (v[k] !== null && v[k] !== undefined) changed[CAMEL[k]] = k === "notes" ? "set" : v[k]; });
        add(v.updated_at || v.created_at, "vendor_changed", { contact_id: v.contact_id, actor_id: v.updated_by || v.created_by, actor_name: actor(v.updated_by || v.created_by), detail: changed });
      });
      ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || Number(a.payment_id || a.bill_id || 0) - Number(b.payment_id || b.bill_id || 0));
      return ev.map((e, i) => Object.assign({ id: i + 1 }, e, { created_at: e.at, created_by: e.actor_id, updated_at: e.at, updated_by: null, version: 1 }));
    }

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      const opt = OPTIONAL[name] || [];
      if (keys.some((k) => !want.includes(k)) || want.some((k) => !keys.includes(k) && !opt.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function rpc(w, name, a) {
      switch (name) {
        case "books_ap_aging": return apAging(w, a || {});
        case "books_vendor_balances": return vendorBalances(w);
        case "books_1099": return w1099(w, a || {});
        case "books_payments_by_month": return byMonth(w, a || {});
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }

    if (COLS.vendor_profiles && !("contact_id" in COLS.vendor_profiles)) Object.assign(COLS.vendor_profiles, PROFILE_COLS);
    return {
      name: "p8-advanced", tables, canRead, canInsert, canUpdate, canDelete: () => false,
      beforeInsert: (w, table, r) => { if (table === "vendor_profiles") tidy(w, r, null); },
      guardUpdate: (w, table, old, r) => { if (table === "vendor_profiles") tidy(w, r, old); },
      views: { money_events: history },
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
    };
  });

  /* ── made-up data: three vendors' details (after seed.js's contacts) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedVendors(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const day = (n) => {
      const [y, m, d] = today.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    };
    const at = (n) => new Date(now.getTime() - n * 86400000).toISOString();
    out.vendor_profiles = out.vendor_profiles || [];
    const subs = (out.contacts || []).filter((c) => c.kind === "subcontractor" && !c.deleted_at).sort((a, b) => a.id - b.id);
    const sups = (out.contacts || []).filter((c) => c.kind === "supplier" && !c.deleted_at).sort((a, b) => a.id - b.id);
    // the vendors paid most this year first, then the ones billed (their 1099 and their papers are what the pages show)
    const billOf = new Map((out.bills || []).map((b) => [b.id, b]));
    const paid = new Map();
    (out.payments || []).forEach((p) => {
      const b = billOf.get(p.bill_id);
      if (!b || !b.vendor_contact_id || String(p.paid_date).slice(0, 4) !== today.slice(0, 4)) return;
      paid.set(b.vendor_contact_id, (paid.get(b.vendor_contact_id) || 0) + Number(p.amount || 0));
    });
    const billed = new Set((out.bills || []).map((b) => b.vendor_contact_id).filter(Boolean));
    const rank = (c) => (paid.get(c.id) || 0) * 10 + (billed.has(c.id) ? 1 : 0);
    const pick = (list) => list.slice().sort((a, b) => rank(b) - rank(a) || a.id - b.id);
    const s = pick(subs), u = pick(sups);
    const row = (c, f, days) => Object.assign({}, PROFILE_COLS, { contact_id: c.id }, f,
      { created_at: at(days), created_by: P.accountant || null, updated_at: at(days), updated_by: null, version: 1 });
    if (s[0]) out.vendor_profiles.push(row(s[0], { tax_1099: true, w9_received_on: day(-200), insurance_expires_on: day(20), workers_comp_expires_on: day(-10),
      license_number: "C-0000112" }, 40));
    if (s[1]) out.vendor_profiles.push(row(s[1], { tax_1099: true, insurance_expires_on: day(-5), workers_comp_expires_on: day(160),
      notes: "Asked for the W-9 twice - they say it is in the mail." }, 25));
    if (u[0]) out.vendor_profiles.push(row(u[0], { tax_1099: false, w9_received_on: day(-320), insurance_expires_on: day(240), workers_comp_exempt: true,
      legal_name: (u[0].company || "Made-up Supply") + " Inc." }, 60));
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

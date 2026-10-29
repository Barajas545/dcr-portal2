/* DCR Portal 2 — DEMO MODE ONLY: the Books program's check register (DCR Desktop 2 migration
   20261030000300_check_register, docs/DATABASE.md §33; the build plan's I7-I12) in the in-memory database, read and
   written by books-checks.html and the payment panel (accounting.html). Loaded BEFORE engine.js and AFTER
   tools/fake/p5b-books.js (whose payments it judges at the triggers' places: NS.p5bPaymentRules) and p8-files.js;
   installed into each engine (NS.extInstall). Never published (tools/ is not part of the site).

   The same names, rules and sentences as the migration:
   * payments: voided_at / voided_by / void_reason, picked_up_at / picked_up_by / picked_up_note, cleared_on /
     cleared_at / cleared_by - written only by the register's RPCs (a person's write of any: 42501); a voided payment is
     FINAL (a person's update 23514, never deleted) and counts in no sum (p5b-books.js: paidOn, the cap, books_desk); a
     picked-up or cleared one keeps its amount, method, number, reference, payee and date (23514) and is never deleted;
     a person's paid_date, on insert or when it changes, is between today - 400 and today + 31 (22023);
   * a check number is used ONCE (t11_payments_check_number: its key app.check_key - digits and letters, upper case,
     leading zeros dropped - voided checks and spoiled blanks included; one check may pay several bills of the same payee
     on the same day): 23505 "check N is already in the check register (<payee>, <Mon D, YYYY>[, voided] | a spoiled
     blank, <day>): ..."; a person's insert, or an update changing the number, method, payee or date of a check;
   * settings.payments_void_enabled (false; admin-write, as every settings column);
   * public.spoiled_checks (financials read; written only by spoil_check / unspoil_check);
   * public.check_register (security invoker: the caller's financials): one row per physical check plus one per spoiled
     blank, with the view's very columns, status and number_reused;
   * the RPCs void_payment (55000 while the switch is off), payment_picked_up (told "in person" too when nobody was),
     clear_payments ({changed, unchanged, refused, clearedOn}), spoil_check, unspoil_check, next_check_number (all-digit
     keys only) and check_number_info; payment_told refuses a voided payment and never clears a picked-up one's mark.
   Made-up data only: on the made-up job A284 a check picked up and cleared, one check paying two bills of one supplier
   on one day (told, waiting at the office), a spoiled blank between them and a missing number after them. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const SIGS = {
    void_payment: ["p_id", "p_reason", "p_version"],
    payment_picked_up: ["p_id", "p_on", "p_version", "p_note", "p_date"],
    clear_payments: ["p_ids", "p_on", "p_on_date"],
    spoil_check: ["p_number", "p_reason"],
    unspoil_check: ["p_id"],
    next_check_number: [],
    check_number_info: ["p_number", "p_payment_id"],
  };
  const OPTIONAL = { payment_picked_up: ["p_note", "p_date"], clear_payments: ["p_on_date"], check_number_info: ["p_payment_id"] };
  NS.p8RegisterSigs = SIGS;   // tools/schema-check-p8-register.mjs compares them with the real functions' arguments
  const PAYMENT_M3 = { voided_at: null, voided_by: null, void_reason: null, picked_up_at: null, picked_up_by: null, picked_up_note: null,
    cleared_on: null, cleared_at: null, cleared_by: null };
  const STAMPS = Object.keys(PAYMENT_M3);
  const REGISTER_COLS = { check_number: null, check_key: null, kind: null, paid_date: null, payee: null, vendor_contact_id: null, amount: null,
    written_amount: null, payment_ids: null, bill_ids: null, project_ids: null, status: null, void_reason: null, voided_at: null, cleared_on: null,
    picked_up_at: null, told_at: null, recorded_at: null, number_reused: null, spoiled_id: null };
  NS.p8RegisterPaymentCols = PAYMENT_M3;

  (NS.extTables = NS.extTables || []).push({
    tables: ["spoiled_checks", "check_register"],
    cols: { spoiled_checks: { id: null, check_number: null, reason: null, spoiled_on: null }, check_register: REGISTER_COLS },
    pk: { check_register: "check_number" },
    uuid: [],
    noAudit: ["check_register"],
    fks: [],
  });

  /* ── the pure rules (the migration's SQL, in plain JS) ── */

  /** app.check_key */
  function checkKey(p) {
    const s = String(p === null || p === undefined ? "" : p).replace(/[^0-9A-Za-z]/g, "").toUpperCase().replace(/^0+(?=.)/, "");
    return s || null;
  }
  NS.checkKey = checkKey;
  /** app.payee_key */
  function payeeKey(contact, payee, vendorName) {
    if (contact !== null && contact !== undefined) return "c" + contact;
    const t = (v) => String(v === null || v === undefined ? "" : v).replace(/^ +| +$/g, "");
    const name = t(payee) || (vendorName === null || vendorName === undefined ? "" : String(vendorName));
    return "n" + t(name).replace(/\s+/g, " ").toLowerCase();
  }
  /** app.note_line */
  function noteLine(p) {
    return String(p === null || p === undefined ? "" : p).replace(/[\r\n\t\u000b\u000c\u0085\u2028\u2029\u00a0]/g, " ").replace(/ {2,}/g, " ").trim();
  }
  /** to_char(d, 'Mon FMDD, YYYY') */
  function longDay(k) {
    const s = String(k || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  const trimOrNull = (v) => { const s = v === null || v === undefined ? "" : String(v).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""); return s || null; };
  const clashWords = (c) => "check " + c.number + " is already in the check register (" +
    (c.spoiled ? "a spoiled blank, " + longDay(c.paidDate) : (c.payee || "no payee") + ", " + longDay(c.paidDate) + (c.voided ? ", voided" : "")) +
    "): a check number is used once - one check may pay several bills of the same payee on the same day";

  /* the payments' register rules at the triggers' places (tools/fake/p5b-books.js calls them) */
  (NS.p5bPaymentRules = NS.p5bPaymentRules || []).push(function rules(E) {
    const { rows, deny, rule, PgErr, today, addDaysYmd, companyDay } = E;
    const billOf = (id) => rows.bills.find((b) => b.id === Number(id)) || null;
    const person = (w) => !!(w && w.uid);
    const BOUNDS = () => {
      const t = today();
      return { min: addDaysYmd ? addDaysYmd(t, -400) : t, max: addDaysYmd ? addDaysYmd(t, 31) : t };
    };
    function dateRule(r, old) {
      if (old && String(r.paid_date) === String(old.paid_date)) return;
      if (!r.paid_date) return;
      const b = BOUNDS();
      const d = String(r.paid_date).slice(0, 10);
      if (d < b.min || d > b.max) {
        throw rule("22023", "a payment's date is at most 400 days back and 31 days ahead: between " + longDay(b.min) + " and " + longDay(b.max));
      }
    }
    return {
      /* t13 (a person's insert sets no stamp) and t01's date */
      beforeInsert(w, r) {
        if (!person(w)) return;
        if (STAMPS.some((k) => r[k] !== null && r[k] !== undefined)) {
          throw deny("a payment is voided, picked up or cleared with void_payment / payment_picked_up / clear_payments, not by an update");
        }
        dateRule(r, null);
      },
      /* t01: the void frozen; a picked-up or cleared payment's told list and date frozen; t13: the stamps; the date */
      guardUpdate(w, old, r) {
        if (!person(w)) return;
        if (old.voided_at) throw rule("23514", "this payment was voided: it stays as it was - record a new payment");
        if (STAMPS.some((k) => JSON.stringify(r[k] === undefined ? null : r[k]) !== JSON.stringify(old[k] === undefined ? null : old[k]))) {
          throw deny("a payment is voided, picked up or cleared with void_payment / payment_picked_up / clear_payments, not by an update");
        }
        if ((old.picked_up_at || old.cleared_on) && ["amount", "method", "check_number", "reference", "payee", "paid_date"].some((k) =>
          JSON.stringify(k === "payee" ? trimOrNull(r[k]) : r[k] === undefined ? null : r[k]) !== JSON.stringify(old[k] === undefined ? null : old[k]))) {
          throw rule("23514", "this payment was " + (old.cleared_on ? "cleared by the bank" : "picked up") + ": its amount, method, check number, reference, payee and date stay as they are");
        }
        dateRule(r, old);
      },
      /* t11: a person's check number is used once */
      checkNumber(w, r, old) {
        if (!person(w) || r.method !== "check" || r.voided_at) return;
        if (old && r.check_number === old.check_number && r.method === old.method && trimOrNull(r.payee) === old.payee &&
          String(r.paid_date) === String(old.paid_date)) return;
        const c = E.p8Clash ? E.p8Clash(r.id === undefined ? null : r.id, r.bill_id, r.check_number, r.payee, r.paid_date, w) : null;
        if (c) throw new PgErr("23505", clashWords(c), 409, JSON.stringify(c));
      },
      /* t14: a voided, cleared or picked-up payment is never deleted */
      beforeDelete(w, r) {
        if (r.voided_at) throw rule("23514", "this payment was voided: it stays in the check register (a void is final)");
        if (r.cleared_on) throw rule("23514", "this payment cleared the bank: it cannot be deleted (take the cleared mark off first if the bank returned it)");
        if (r.picked_up_at) throw rule("23514", "the payee picked this payment up: it cannot be deleted - void it instead");
      },
      /* payment_told (re-made): a voided payment; a picked-up payment's told mark stays */
      told(w, p, how) {
        if (p.voided_at) throw rule("23514", "the payment was voided");
        if (how === null && p.pickup_told_at && p.picked_up_at) throw rule("23514", "it was picked up: the told mark stays (take the picked-up mark off first)");
      },
      _bounds: BOUNDS, _billOf: billOf, _companyDay: companyDay,
    };
  });

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS, PgErr, deny, rule, nowIso, today, companyDay, clone, auditUpdate, commitUpdate, auditInsert, commitInsert, nextId,
      projectVisible } = E;
    if (COLS.payments) Object.keys(PAYMENT_M3).forEach((k) => { if (!(k in COLS.payments)) COLS.payments[k] = null; });
    if (COLS.settings && !("payments_void_enabled" in COLS.settings)) COLS.settings.payments_void_enabled = false;
    if (!rows.payments || !rows.bills || !rows.spoiled_checks) return null;
    rows.payments.forEach((p) => Object.keys(PAYMENT_M3).forEach((k) => { if (!(k in p)) p[k] = null; }));
    (rows.settings || []).forEach((s) => { if (!("payments_void_enabled" in s)) s.payments_void_enabled = false; });

    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const billOf = (id) => rows.bills.find((b) => b.id === Number(id)) || null;
    const billSeen = (w, b) => !!b && w.financials && (!b.deleted_at || w.admin) && projectVisible(w, b.project_id);
    const notFound = (what) => new PgErr("PT404", what + " not found", 404);
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    const dayOfTs = (v) => (v ? companyDay(new Date(v)) : null);
    const firstDay = (p) => { const a = String(p.paid_date).slice(0, 10), b = dayOfTs(p.created_at) || a; return a < b ? a : b; };
    function write(w, table, old, patch) {
      const r = Object.assign(clone(old), patch);
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }

    /* app.check_number_clash (a definer: every check counts) */
    function clash(pid, billId, number, payee, date, w) {
      const key = checkKey(number);
      if (!key) return null;
      const sp = rows.spoiled_checks.filter((s) => checkKey(s.check_number) === key).sort((a, b) => a.id - b.id)[0];
      if (sp) return { paymentId: null, spoiledId: sp.id, number: sp.check_number, paidDate: sp.spoiled_on, payee: null, voided: false, spoiled: true };
      const bill = billId === null || billId === undefined ? null : billOf(billId);
      const vContact = bill && bill.vendor_contact_id !== null && bill.vendor_contact_id !== undefined ? bill.vendor_contact_id : null;
      const vName = bill ? payeeKey(null, payee, bill.vendor_name) : null;
      const day = date === null || date === undefined ? null : String(date).slice(0, 10);
      const s = rows.payments.filter((p) => p.method === "check" && checkKey(p.check_number) === key && p.id !== pid).map((p) => {
        const b = billOf(p.bill_id);
        return { p, contact: b && b.vendor_contact_id !== null && b.vendor_contact_id !== undefined ? b.vendor_contact_id : null,
          vendorName: b ? b.vendor_name : null, nameKey: payeeKey(null, p.payee, b ? b.vendor_name : null) };
      });
      const share = s.filter((x) => !x.p.voided_at && String(x.p.paid_date) === day && x.contact !== null).map((x) => ({ contact: x.contact, nameKey: x.nameKey }));
      if (vContact !== null) share.push({ contact: vContact, nameKey: vName });
      const whoOf = (contact, nameKey) => {
        let c = contact;
        if (c === null) {
          const m = share.filter((x) => x.nameKey === nameKey).map((x) => x.contact);
          c = m.length ? Math.min.apply(null, m) : null;
        }
        return c !== null ? "c" + c : nameKey;
      };
      const me = whoOf(vContact, vName);
      const hit = s.map((x) => Object.assign({}, x, { who: whoOf(x.contact, x.nameKey) }))
        .filter((x) => !(!x.p.voided_at && String(x.p.paid_date) === day && me !== null && x.who === me))
        .sort((a, b) => (a.p.voided_at ? 1 : 0) - (b.p.voided_at ? 1 : 0) || String(b.p.paid_date).localeCompare(String(a.p.paid_date)) || b.p.id - a.p.id)[0];
      if (!hit) return null;
      return { paymentId: w && projectVisible(w, hit.p.project_id) ? hit.p.id : null, spoiledId: null, number: String(hit.p.check_number).trim(),
        paidDate: String(hit.p.paid_date).slice(0, 10), payee: trimOrNull(hit.p.payee) || trimOrNull(hit.vendorName) || "", voided: !!hit.p.voided_at, spoiled: false };
    }
    E.p8Clash = clash;

    /* check_register (security invoker): the caller's payments, bills and spoiled blanks */
    function register(w) {
      if (!w || !w.active || !w.financials) return [];
      const pays = rows.payments.filter((p) => p.method === "check" && projectVisible(w, p.project_id)).map((p) => {
        const b0 = billOf(p.bill_id);
        const b = billSeen(w, b0) ? b0 : null;
        const contact = b && b.vendor_contact_id !== null && b.vendor_contact_id !== undefined ? b.vendor_contact_id : null;
        return { p, key: checkKey(p.check_number), day: String(p.paid_date).slice(0, 10),
          payee: trimOrNull(p.payee) || trimOrNull(b && b.vendor_name) || "", contact, nameKey: payeeKey(null, p.payee, b ? b.vendor_name : null) };
      });
      pays.forEach((x) => {
        let c = x.contact;
        if (c === null) {
          const m = pays.filter((y) => y.key === x.key && y.day === x.day && y.nameKey === x.nameKey && y.contact !== null).map((y) => y.contact);
          c = m.length ? Math.min.apply(null, m) : null;
        }
        x.payeeKey = c !== null ? "c" + c : x.nameKey;
      });
      const groups = new Map();
      pays.forEach((x) => {
        const g = JSON.stringify([x.key, x.day, x.payeeKey]);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(x);
      });
      const out = [];
      const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
      const uniq = (list) => Array.from(new Set(list)).sort((a, b) => a - b);
      groups.forEach((list) => {
        list.sort((a, b) => a.p.id - b.p.id);
        const live = list.filter((x) => !x.p.voided_at);
        const all = (f) => live.length > 0 && live.every(f);
        const status = !live.length ? "void" : all((x) => x.p.cleared_on) ? "cleared" : all((x) => x.p.picked_up_at || x.p.cleared_on) ? "picked_up"
          : all((x) => x.p.pickup_told_at) ? "told" : "written";
        const byContact = list.slice().sort((a, b) => (a.contact === null ? 1 : 0) - (b.contact === null ? 1 : 0) || a.p.id - b.p.id);
        const contacts = list.map((x) => x.contact).filter((c) => c !== null);
        const maxOf = (vals) => vals.filter(Boolean).sort().pop() || null;
        const minOf = (vals) => vals.filter(Boolean).sort()[0] || null;
        const voided = list.filter((x) => x.p.voided_at);
        out.push({ check_number: list[0].p.check_number, check_key: list[0].key, kind: "check", paid_date: list[0].day,
          payee: byContact[0].payee, vendor_contact_id: contacts.length ? Math.min.apply(null, contacts) : null,
          amount: r2(live.reduce((n, x) => n + Number(x.p.amount || 0), 0)), written_amount: r2(list.reduce((n, x) => n + Number(x.p.amount || 0), 0)),
          payment_ids: list.map((x) => x.p.id), bill_ids: uniq(list.map((x) => x.p.bill_id)), project_ids: uniq(list.map((x) => x.p.project_id)),
          status, void_reason: voided.length ? voided[0].p.void_reason : null, voided_at: iso(maxOf(list.map((x) => x.p.voided_at))),
          cleared_on: maxOf(live.map((x) => x.p.cleared_on)), picked_up_at: iso(maxOf(live.map((x) => x.p.picked_up_at))),
          told_at: iso(minOf(live.map((x) => x.p.pickup_told_at))), recorded_at: iso(minOf(list.map((x) => x.p.created_at))), number_reused: false, spoiled_id: null });
      });
      rows.spoiled_checks.forEach((s) => {
        out.push({ check_number: s.check_number, check_key: checkKey(s.check_number), kind: "spoiled", paid_date: s.spoiled_on, payee: null,
          vendor_contact_id: null, amount: null, written_amount: null, payment_ids: [], bill_ids: [], project_ids: [], status: "spoiled",
          void_reason: s.reason, voided_at: null, cleared_on: null, picked_up_at: null, told_at: null, recorded_at: iso(s.created_at), number_reused: false,
          spoiled_id: s.id });
      });
      const seen = {};
      out.forEach((r) => { if (r.check_key) seen[r.check_key] = (seen[r.check_key] || 0) + 1; });
      out.forEach((r) => { r.number_reused = !!(r.check_key && seen[r.check_key] > 1); });
      return out;
    }

    function stamps(p, extra) {
      return Object.assign({ ok: true, id: p.id, billId: p.bill_id, version: p.version, voidedAt: iso(p.voided_at), voidedBy: p.voided_by, voidReason: p.void_reason,
        pickedUpAt: iso(p.picked_up_at), pickedUpDate: dayOfTs(p.picked_up_at), pickedUpBy: p.picked_up_by, pickedUpNote: p.picked_up_note,
        clearedOn: p.cleared_on, clearedAt: iso(p.cleared_at), clearedBy: p.cleared_by, toldAt: iso(p.pickup_told_at), toldDate: dayOfTs(p.pickup_told_at),
        toldBy: p.pickup_told_by, toldHow: p.pickup_told_how }, extra || {});
    }
    /* app.register_payment: a payment the caller may act on (PT404 otherwise, one sentence) */
    function regPayment(w, id) {
      const p = rows.payments.find((x) => x.id === Number(id));
      if (!p || !w.financials || !projectVisible(w, p.project_id)) throw notFound("payment");
      return p;
    }
    const pt409 = (p) => new PgErr("PT409", "the payment was changed by someone else", 409, JSON.stringify({ table: "payments", id: p.id, version: p.version }));
    const editor = (w, what) => { if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, " + what); };
    const byName = (w) => ((w.p && String(w.p.full_name || "").trim()) || (w.p && w.p.email) || "The office").slice(0, 120);
    const noonOf = (k) => { const d = new Date(k + "T12:00:00"); const off = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getTime() - d.getTime(); return new Date(d.getTime() - off).toISOString(); };

    function nextNumber() {
      const last = rows.payments.filter((p) => p.method === "check" && /^[0-9]+$/.test(checkKey(p.check_number) || "")).sort((a, b) => b.id - a.id)[0];
      if (!last) return { next: null, last: null };
      const used = new Set(rows.payments.filter((p) => p.method === "check").map((p) => checkKey(p.check_number)).concat(rows.spoiled_checks.map((s) => checkKey(s.check_number))));
      let n = BigInt(checkKey(last.check_number)) + 1n;
      for (let i = 0; i < 10000 && used.has(String(n)); i++) n += 1n;
      const b = billOf(last.bill_id);
      return { next: String(n), last: { number: last.check_number, paidDate: String(last.paid_date).slice(0, 10),
        payee: trimOrNull(last.payee) || trimOrNull(b && b.vendor_name) || "" } };
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
        case "void_payment": {
          editor(w, "voids a payment");
          const s = rows.settings && rows.settings[0];
          if (!(s && s.payments_void_enabled)) throw rule("55000", "voiding payments is turned on by an admin once every DCR Desktop 2 runs 2.25");
          const why = noteLine(a.p_reason);
          if (why.length < 3 || why.length > 300) throw rule("22023", "say why the payment is voided (3 to 300 characters)");
          if (a.p_version === null || a.p_version === undefined) throw rule("22023", "void the payment as it was shown: its version is required");
          const p = regPayment(w, a.p_id);
          if (Number(p.version) !== Number(a.p_version)) throw pt409(p);
          if (p.voided_at) return stamps(p, { already: true });
          if (p.cleared_on) throw rule("23514", "it cleared the bank on " + longDay(p.cleared_on) + ": take the cleared mark off first if the bank returned it");
          return stamps(write(w, "payments", p, { voided_at: nowIso(), voided_by: w.uid, void_reason: why }));
        }
        case "payment_picked_up": {
          editor(w, "marks a payment picked up");
          if (a.p_on === null || a.p_on === undefined) throw rule("22023", "say whether it was picked up (true) or not (false)");
          if (a.p_version === null || a.p_version === undefined) throw rule("22023", "mark the payment as it was shown: its version is required");
          const note = noteLine(a.p_note) || null;
          if (note && note.length > 120) throw rule("22023", "who collected it: at most 120 characters");
          const p = regPayment(w, a.p_id);
          if (Number(p.version) !== Number(a.p_version)) throw pt409(p);
          if (!["check", "cash"].includes(p.method)) throw Object.assign(rule("22023", "only a check or cash is picked up"), { hint: "not_collectable" });
          if (p.voided_at) throw rule("23514", "the payment was voided");
          if (a.p_on) {
            if (p.picked_up_at) return stamps(p, { already: true });
            const d = a.p_date ? String(a.p_date).slice(0, 10) : null;
            if (d && (d < firstDay(p) || d > today())) throw rule("22023", "the day it was picked up is between " + longDay(firstDay(p)) + " and today");
            const at = !d || d === today() ? nowIso() : noonOf(d);
            const told = p.pickup_told_at;
            return stamps(write(w, "payments", p, { picked_up_at: at, picked_up_by: w.uid, picked_up_note: note,
              pickup_told_at: told || at, pickup_told_by: told ? p.pickup_told_by : byName(w), pickup_told_how: told ? p.pickup_told_how : "in person" }));
          }
          if (!p.picked_up_at) return stamps(p, { already: true });
          if (p.cleared_on) throw rule("23514", "it cleared the bank: it stays picked up");
          return stamps(write(w, "payments", p, { picked_up_at: null, picked_up_by: null, picked_up_note: null }));
        }
        case "clear_payments": {
          editor(w, "marks payments cleared");
          if (a.p_on === null || a.p_on === undefined) throw rule("22023", "say whether they cleared (true) or not (false)");
          const day = a.p_on_date ? String(a.p_on_date).slice(0, 10) : today();
          if (a.p_on && day > today()) throw rule("22023", "a payment clears today or earlier");
          const list = Array.isArray(a.p_ids) ? Array.from(new Set(a.p_ids.filter((x) => x !== null && x !== undefined).map(Number))).sort((x, y) => x - y) : [];
          if (!list.length) throw rule("22023", "Nothing was selected.");
          if (list.length > 1000) throw rule("22023", "At most 1,000 at a time.");
          const changed = [], same = [], refused = [];
          for (const id of list) {
            let p;
            try { p = regPayment(w, id); } catch (e) { refused.push({ id, reason: "No such payment." }); continue; }
            const why = p.voided_at ? "Voided: it never clears." : p.method === "cash" ? "Cash never goes through the bank."
              : a.p_on && day < firstDay(p) ? "It was written after that day." : "";
            if (why) { refused.push({ id, reason: why }); continue; }
            if ((a.p_on && p.cleared_on === day) || (!a.p_on && !p.cleared_on)) { same.push(id); continue; }
            write(w, "payments", p, { cleared_on: a.p_on ? day : null, cleared_at: a.p_on ? nowIso() : null, cleared_by: a.p_on ? w.uid : null });
            changed.push(id);
          }
          return { changed, unchanged: same, refused, clearedOn: a.p_on ? day : null };
        }
        case "spoil_check": {
          editor(w, "marks a check spoiled");
          const number = noteLine(a.p_number);
          const key = checkKey(number);
          if (!key || number.length > 40) throw rule("22023", "a check number is 1 to 40 characters with a digit or a letter");
          const why = noteLine(a.p_reason);
          if (why.length < 3 || why.length > 300) throw rule("22023", "say why the check is spoiled (3 to 300 characters)");
          const c = clash(null, null, number, null, null, w);
          if (c && c.spoiled) throw new PgErr("23505", "check " + c.number + " is already marked spoiled (" + longDay(c.paidDate) + ")", 409, JSON.stringify(c));
          if (c) throw new PgErr("23505", "check " + c.number + " was written (" + (c.payee || "no payee") + ", " + longDay(c.paidDate) +
            "): only a blank never used is spoiled - void the check instead", 409, JSON.stringify(c));
          const r = { id: nextId("spoiled_checks"), check_number: number, reason: why, spoiled_on: today() };
          auditInsert(w, "spoiled_checks", r);
          commitInsert("spoiled_checks", r);
          return { ok: true, id: r.id, number: r.check_number, key, reason: r.reason, spoiledOn: r.spoiled_on };
        }
        case "unspoil_check": {
          editor(w, "takes a spoiled mark off");
          const s = rows.spoiled_checks.find((x) => x.id === Number(a.p_id));
          if (!s) throw notFound("spoiled check");
          E.commitDelete("spoiled_checks", s);
          return { ok: true, id: s.id, number: s.check_number };
        }
        case "next_check_number": {
          if (!w.financials) throw deny("only someone who sees financials reads the check register");
          return nextNumber();
        }
        case "check_number_info": {
          if (!w.financials) throw deny("only someone who sees financials reads the check register");
          if (!checkKey(a.p_number)) throw rule("22023", "a check number has a digit or a letter");
          if (a.p_payment_id !== null && a.p_payment_id !== undefined) {
            const p = rows.payments.find((x) => x.id === Number(a.p_payment_id));
            if (!p || !projectVisible(w, p.project_id)) throw notFound("payment");
          }
          const c = clash(a.p_payment_id === null || a.p_payment_id === undefined ? null : Number(a.p_payment_id), null, a.p_number, null, null, w);
          return { free: !c, clash: c, next: nextNumber().next };
        }
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }

    return {
      name: "p8-register", tables: new Set(["spoiled_checks", "check_register"]),
      canRead: (w, table) => !!(w.active && w.financials && (table === "spoiled_checks" || table === "check_register")),
      canInsert: () => false, canUpdate: () => false, canDelete: () => false,
      views: { check_register: register },
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
    };
  });

  /* ── made-up data: a register to look at (after p5b-books.js's bills and payments) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedRegister(out, h) {
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
    ["payments", "bills", "files"].forEach((t) => { out[t] = out[t] || []; });
    out.spoiled_checks = out.spoiled_checks || [];
    out.payments.forEach((p) => Object.keys(PAYMENT_M3).forEach((k) => { if (!(k in p)) p[k] = null; }));
    (out.settings || []).forEach((s) => { if (!("payments_void_enabled" in s)) s.payments_void_enabled = false; });
    const porch = (out.projects || []).find((p) => p.number === "A284");
    const contact = (company) => (out.contacts || []).find((c) => c.company === company) || null;
    if (!porch || !P.accountant) return;
    const maxId = (t) => out[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const ids = { b: maxId("bills"), p: maxId("payments"), f: maxId("files") };
    out.objects = out.objects || {};
    const proto = out.bills[0] || {};
    function bill(c, number, amount, description, days, approver) {
      const id = ++ids.b;
      const fid = ++ids.f;
      const name = c.company + " " + number + ".pdf";
      const key = "f/" + porch.id + "/receipts/" + (fid.toString(16).padStart(8, "0") + "c".repeat(24)) + "/" + name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      out.files.push(Object.assign({ id: fid, project_id: porch.id, estimate_item_id: null, journal_entry_id: null, bill_id: id, cost_id: null, payment_id: null,
        folder: "receipts", subpath: "", name, storage_path: key, size: 152000, mime: "application/pdf", version_no: 1, previous_id: null, is_financial: true,
        storage: "cloud", rel_path: null, modified_at: null, description: null, preview_path: null, source: "desktop", deleted_at: null }, audit(days, P.accountant)));
      out.objects[key] = { size: 152000, mime: "application/pdf", owner: P.accountant, created_at: at(days) };
      const row = Object.assign({}, Object.fromEntries(Object.keys(proto).map((k) => [k, null])), {
        id, project_id: porch.id, estimate_item_id: null, quote_id: null, vendor_contact_id: c.id, vendor_name: c.company, invoice_number: number,
        invoice_date: day(days), due_date: day(days - 30), amount, description, document_file_id: fid, void: false, approved_by: approver || P.admin,
        approved_at: at(days - 1, 1), approved_amount: amount, pay_method: "check", approval_note: null, kind: /Lumber/.test(c.company) ? "Material supplier" : "Subcontractor",
        qbo_entered_at: at(days - 2, 2), qbo_entered_by: P.accountant, qbo_ref: "QB-" + (1060 + id), deleted_at: null }, audit(days, P.accountant));
      out.bills.push(row);
      return row;
    }
    function pay(b, number, days, extra) {
      const row = Object.assign({ id: ++ids.p, bill_id: b.id, project_id: b.project_id, paid_date: day(days), amount: b.amount, method: "check",
        check_number: number, reference: null, notes: null, payee: b.vendor_name, memo: "A284 · Inv " + b.invoice_number,
        pickup_told_at: null, pickup_told_by: null, pickup_told_how: null }, PAYMENT_M3, extra || {}, audit(days, P.accountant));
      out.payments.push(row);
      return row;
    }
    const stone = contact("Stonebrook Concrete"), kestrel = contact("Kestrel Lumber Supply");
    if (stone) {
      // 5306: told by phone, picked up, cleared the bank
      const b = bill(stone, "SB-118", 1640, "Porch steps and landing", 16);
      pay(b, "5306", 12, { pickup_told_at: at(11, 1), pickup_told_by: "Casey Accounts", pickup_told_how: "phone", picked_up_at: at(10, 2), picked_up_by: P.accountant,
        cleared_on: day(6), cleared_at: at(6, 3), cleared_by: P.accountant });
    }
    // 5307: a blank torn in the printer
    out.spoiled_checks.push(Object.assign({ id: 1, check_number: "5307", reason: "Torn in the printer", spoiled_on: day(9) }, audit(9, P.accountant)));
    if (kestrel) {
      // 5308: one check paying two bills of one supplier on one day - told by e-mail, waiting at the office
      const b1 = bill(kestrel, "K-2290", 418.6, "Porch railing hardware", 8);
      const b2 = bill(kestrel, "K-2297", 233.15, "Deck screws and post bases", 7);
      const told = { pickup_told_at: at(3, 1), pickup_told_by: "Casey Accounts", pickup_told_how: "email" };
      pay(b1, "5308", 4, told);
      pay(b2, "5308", 4, told);
    }
    // 5309 is missing between 5308 and 5310 (p5b-books.js's check): the register flags it
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

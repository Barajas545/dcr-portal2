/* DCR Portal 2 — DEMO MODE ONLY: the Books program's money messages (DCR Desktop 2 migration
   20261030000400_money_messages, docs/DATABASE.md §34; the build plan's I13-I23, I34-I38) in the in-memory database,
   read and written by the Accounting page (books-home.html), its ask / tell panels, the template editor, the bill
   page's Ask and the home page's "asked by". Loaded BEFORE engine.js and AFTER tools/fake/p5b-books.js and
   p8-register.js; installed into each engine (NS.extInstall). Never published (tools/ is not part of the site).

   The same names, rules and sentences as the migration (a port of its SQL; the migration is the truth):
   * public.message_templates (key x channel; financials read; written only by save_message_template /
     reset_message_template - money editors, at the version shown: PT409), seeded with the six defaults;
   * public.money_messages (financials read; written only by the RPCs below and the outbox's sent trigger);
   * notifications_outbox gains money_message_id and to_name; the kinds approval_request / payment_pickup, e-mail only
     (push_result 'e-mail only': the push demo never takes one);
   * the renderer is the database's (one pass; every value cleaned: no control or bidi character, no "{{", a link
     "[link removed]"; app.scrub_money of itself) - the Portal renders nothing;
   * the RPCs money_approvers (the usual approver: the latest approval in the job by someone who still approves, else
     of the vendor, else nobody; never the caller, never an address), preview_message_template, ask_for_approval
     (1-50 askable bills, 1-10 approvers [{profile, channel}], already within 10 minutes, 3 e-mails a company day per
     bill per approver, 30 an hour - PT429), tell_payee (one payee's checks OR cash; the bill's contact, or p_contact_id
     only for a bill with none and only the payee), money_text_sent (a pick-up text stamps told "text message"),
     reminder_pc_status (the made-up PC's heartbeat - never its name);
   * a dev hook, engine.exts.find((x) => x.name === "p8-books").__dev: reminderPc({fail, optOut, ids}) takes the waiting
     money e-mails as DCR Agents 2 would (judged first: approved / voided / told meanwhile, an address that can't be
     used) and reports each sent (told "(e-mail by DCR Agents 2)" for a pick-up), failed ("trying again: ...") or set
     aside ("opted out"); pcStatus(o) makes the status answer o (e.g. {notTaking: true}) until pcStatus(null).
   Made-up data only: a third bill waiting on the made-up kitchen job, one waiting and one approved with no pay method
   on another made-up job, a cash payment not told yet (its payee has a phone), an earlier ask by e-mail and an
   earlier pick-up e-mail. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const SIGS = {
    save_message_template: ["p_key", "p_channel", "p_subject", "p_body", "p_version"],
    reset_message_template: ["p_key", "p_channel", "p_version"],
    preview_message_template: ["p_key", "p_channel", "p_subject", "p_body", "p_bill_ids", "p_payment_ids", "p_to_profile_id"],
    money_approvers: ["p_bill_ids"],
    reminder_pc_status: [],
    ask_for_approval: ["p_bill_ids", "p_to", "p_subject", "p_body", "p_sms_body"],
    tell_payee: ["p_payment_ids", "p_channel", "p_contact_id", "p_subject", "p_body"],
    money_text_sent: ["p_message_id", "p_sent"],
  };
  const OPTIONAL = {
    preview_message_template: ["p_bill_ids", "p_payment_ids", "p_to_profile_id"], money_approvers: ["p_bill_ids"],
    ask_for_approval: ["p_subject", "p_body", "p_sms_body"], tell_payee: ["p_contact_id", "p_subject", "p_body"],
  };
  NS.p8BooksSigs = SIGS;   // tools/schema-check-p8-books.mjs compares them with the real functions' arguments
  const TEMPLATE_COLS = { key: null, channel: null, subject: null, body: null };
  const MESSAGE_COLS = { id: null, group_id: null, kind: null, template_key: null, channel: null, by_hand: false, bill_ids: null, payment_ids: null,
    to_profile_id: null, to_contact_id: null, to_name: null, to_address: null, subject: null, body: null, status: null, status_note: null, sent_at: null };
  const OUTBOX_COLS = { money_message_id: null, to_name: null };
  NS.p8BooksCols = { message_templates: TEMPLATE_COLS, money_messages: MESSAGE_COLS, outbox: OUTBOX_COLS };

  (NS.extTables = NS.extTables || []).push({
    tables: ["message_templates", "money_messages"],
    cols: { message_templates: TEMPLATE_COLS, money_messages: MESSAGE_COLS },
    // a template's key is (key, channel): its row carries "_k" (key/channel) for the demo's own bookkeeping only
    pk: { message_templates: "_k" },
    uuid: [],
    noAudit: [],
    fks: [],
  });

  /* ── the migration's rules, in plain JS ── */

  const VARS = {
    approval_request: ["company", "requesterName", "requesterFirstName", "requesterPhone", "requesterEmail", "approverFirstName", "approverName", "billsPhrase", "billList", "link"],
    check_ready: ["company", "requesterName", "requesterFirstName", "requesterPhone", "requesterEmail", "firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate", "checkNumber"],
    cash_ready: ["company", "requesterName", "requesterFirstName", "requesterPhone", "requesterEmail", "firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate"],
  };
  NS.p8MoneyVars = VARS;
  const DASH = "—";
  const DEFAULTS = {
    "approval_request/email": ["Approval needed: {{billsPhrase}} waiting for you",
      "Hi {{approverFirstName}},\n\n{{billsPhrase}} waiting for your approval:\n\n{{billList}}\n\n" +
      "Open it in DCR Portal: {{link}}\n" +
      "Sign in there to see the invoice and the amount, and to approve it. This e-mail never approves anything, and its links only open DCR Portal.\n\n" +
      "Please don't reply to this e-mail; call {{requesterName}} with any question.\nPhone: {{requesterPhone}}\n\n" +
      "Thank you,\n{{requesterName}}\n{{company}}"],
    "approval_request/sms": [null, "Hi {{approverFirstName}}, {{billsPhrase}} waiting for your approval in DCR Portal: {{link}} - {{requesterFirstName}}"],
    "check_ready/email": ["Your check is ready for pickup " + DASH + " {{projectLabel}}",
      "Hello {{payee}},\n\nYour check #{{checkNumber}} is ready to be picked up at our office.\n" +
      "Job: {{projectLabel}}\nYour invoice #{{invoiceNumber}}\nWritten on {{writtenDate}}\n\n" +
      "Please bring ID when you collect it.\n\n" +
      "Please don't reply to this e-mail; call {{requesterName}} with any question.\nPhone: {{requesterPhone}}\n\n" +
      "Thank you,\n{{company}}"],
    "check_ready/sms": [null, "Hi {{firstName}}, your check from {{company}} is ready to pick up at our office. Please bring ID."],
    "cash_ready/email": ["Your payment is ready for pickup " + DASH + " {{projectLabel}}",
      "Hello {{payee}},\n\nYour cash payment is ready to be picked up at our office.\n" +
      "Job: {{projectLabel}}\nYour invoice #{{invoiceNumber}}\n\n" +
      "Please bring ID when you collect it.\n\n" +
      "Please don't reply to this e-mail; call {{requesterName}} with any question.\nPhone: {{requesterPhone}}\n\n" +
      "Thank you,\n{{company}}"],
    "cash_ready/sms": [null, "Hi {{firstName}}, your payment from {{company}} is ready to pick up at our office. Please bring ID."],
  };
  const def = (key, channel) => { const d = DEFAULTS[key + "/" + channel]; return d ? { subject: d[0], body: d[1] } : null; };
  NS.p8MoneyDefault = def;

  const LINK = () => /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*|\b(?:mailto|tel|sms):\S+|\bwww\.\S*|\\\\\S+|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|info|biz|io|co|us|app|dev|xyz|link|ly|me|site|online|top)\b\S*/gi;
  const EMAIL_OK = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  const emailOk = (p) => typeof p === "string" && p.length <= 320 && EMAIL_OK.test(p);
  const E164 = /^\+1[2-9][0-9]{9}$/;
  const scrub = (v) => (typeof NS.p6ScrubMoney === "function" ? NS.p6ScrubMoney(v) : String(v == null ? "" : v));
  const oneLine = (p) => String(p == null ? "" : p).replace(/\s+/g, " ").trim();
  const firstName = (p) => { const m = /^\s*(\S+)/.exec(String(p == null ? "" : p)); return m ? m[1] : ""; };

  /** app.money_safe_value */
  function safeValue(p, max) {
    let v = String(p == null ? "" : p);
    v = v.replace(/[\n\r\t\u000b\u000c\u0085\u2028\u2029]/g, " ");
    v = v.replace(/[\u0001-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
    while (v.indexOf("{{") !== -1 || v.indexOf("}}") !== -1) v = v.split("{{").join("").split("}}").join("");
    v = v.replace(LINK(), "[link removed]");
    v = v.replace(/ {2,}/g, " ").trim();
    const m = Math.max(0, Number(max) || 0);
    if (v.length > m) {
      v = v.slice(0, m).trim();
      v = v.replace(LINK(), "").replace(/ {2,}/g, " ").trim();
    }
    return v;
  }
  /** app.money_template_problem */
  function problem(key, channel, subject, body) {
    const vars = VARS[key];
    if (!vars || (channel !== "email" && channel !== "sms")) return "there is no such message template";
    if (!String(body == null ? "" : body).trim()) return "the text is empty";
    if (channel === "sms" && subject !== null && subject !== undefined) return "a text message has no subject";
    if (channel === "email" && !String(subject == null ? "" : subject).trim()) return "an e-mail needs a subject";
    if (subject !== null && subject !== undefined && /[\u0001-\u001f\u007f\u0085\u2028\u2029]/.test(subject)) return "the subject is one line: no line break or control character";
    if (subject && subject.length > 200) return "the subject is at most 200 characters";
    if (body.length > 4000) return "the text is at most 4000 characters";
    if (channel === "sms" && body.length > 640) return "a text message is at most 640 characters";
    const both = (subject || "") + "\n" + (body || "");
    if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(both)) return "the text holds a hidden or control character";
    const re = /\{\{([A-Za-z]+)\}\}/g;
    let m;
    while ((m = re.exec(both))) {
      if (vars.indexOf(m[1]) === -1) return "{{" + m[1] + "}} is not a placeholder of this message: use " + vars.map((x) => "{{" + x + "}}").join(", ");
    }
    const flat = both.replace(/\{\{[A-Za-z]+\}\}/g, "X");
    if (flat.indexOf("{{") !== -1 || flat.indexOf("}}") !== -1) return "a placeholder is written {{name}}: two braces, its name in letters, two braces";
    if (/(^|[^#])\{\{(checkNumber|invoiceNumber)\}\}/.test(both)) return "write # right before a number: #{{checkNumber}}, #{{invoiceNumber}}";
    if (scrub(flat) !== flat || /\$|\bUSD\b|[0-9]{1,3}(,[0-9]{3})+|[0-9]+\.[0-9]{2}\b/i.test(flat)) return "the text holds an amount: a money message never carries one";
    if (LINK().test(flat) || flat.indexOf("@") !== -1) {
      return "the text holds a link or an address: the only links are {{link}} and the ones in {{billList}}, the only address and phone {{requesterEmail}} and {{requesterPhone}}";
    }
    return null;
  }
  /** app.money_render: one left-to-right pass */
  function render(text, vars, email) {
    const v = vars && typeof vars === "object" ? vars : {};
    const lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const kept = [];
    for (const line of lines) {
      let done = "", rest = line, any = false, full = false;
      for (;;) {
        const m = /\{\{([A-Za-z]+)\}\}/.exec(rest);
        if (!m) break;
        const x = v[m[1]];
        const val = typeof x === "string" || typeof x === "number" ? String(x) : "";
        any = true;
        if (val.trim() !== "") full = true;
        done += rest.slice(0, m.index) + val;
        rest = rest.slice(m.index + m[0].length);
      }
      if (any && !full) continue;
      kept.push((done + rest).replace(/[ \t]+$/, ""));
    }
    const out = [];
    kept.forEach((l) => { if (l.trim() === "" && (!out.length || out[out.length - 1].trim() === "")) return; out.push(l); });
    if (out.length && out[out.length - 1].trim() === "") out.pop();
    const s = out.join("\n");
    return email ? s.replace(/\n/g, "\r\n") : s;
  }
  /** app.money_fit: scrubbed until it holds */
  function fit(p, max) {
    let v = scrub(p);
    for (let i = 0; i < 5; i++) { const n = scrub(v.slice(0, max)); if (n === v) break; v = n; }
    return v;
  }
  /** app.money_compose */
  function compose(channel, subject, body, vars) {
    return {
      subject: channel === "email" ? fit(oneLine(render(subject, vars, false)), 200) || null : null,
      body: fit(render(body, vars, channel === "email"), 20000) || null,
    };
  }
  NS.p8Money = { safeValue, problem, render, compose, emailOk, VARS, def };

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS, PgErr, deny, rule, nowIso, today, companyDay, clone, auditUpdate, commitUpdate, auditInsert, commitInsert, nextId, projectVisible } = E;
    if (COLS.notifications_outbox) Object.keys(OUTBOX_COLS).forEach((k) => { if (!(k in COLS.notifications_outbox)) COLS.notifications_outbox[k] = null; });
    if (!rows.message_templates || !rows.money_messages || !rows.bills || !rows.payments) return null;
    (rows.notifications_outbox || []).forEach((o) => Object.keys(OUTBOX_COLS).forEach((k) => { if (!(k in o)) o[k] = null; }));
    const dev = { pc: null };

    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const editor = (w, what) => { if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, " + what); };
    const profileOf = (id) => rows.profiles.find((p) => p.id === id) || null;
    /* app.can_approve_profile */
    const approves = (id) => { const p = profileOf(id); return !!(p && p.active && (p.role === "admin" || (p.role === "manager" && p.can_approve_payments && p.can_see_financials))); };
    const billOf = (id) => rows.bills.find((b) => b.id === Number(id)) || null;
    const payOf = (id) => rows.payments.find((p) => p.id === Number(id)) || null;
    const projOf = (id) => rows.projects.find((p) => p.id === Number(id)) || null;
    const contactOf = (id) => (id === null || id === undefined ? null : rows.contacts.find((c) => c.id === Number(id)) || null);
    const billSeen = (w, b) => !!b && w.financials && projectVisible(w, b.project_id) && (!b.deleted_at || w.admin);
    const notFound = (what) => new PgErr("PT404", what + " not found", 404);
    const rate = (msg) => new PgErr("PT429", msg, 429, null, "rate");
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    const e164 = (v) => (typeof NS.e164 === "function" ? NS.e164(v) : null);
    const portal = () => { try { return root.location && /^https?:/.test(root.location.origin) ? root.location.origin : "https://portal.example.test"; } catch (e) { return "https://portal.example.test"; } };
    const company = () => safeValue(rows.settings && rows.settings[0] ? rows.settings[0].company_name : "", 120);
    const monDay = (d) => { const s = String(d || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : ""; };
    const monDayYear = (d) => { const s = String(d || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : ""; };
    const dashLabel = (n, name) => [String(n || "").trim(), String(name || "").trim()].filter(Boolean).join(" " + DASH + " ");
    const payeeKey = (v) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").toLowerCase();
    const midnight = () => { const t = today(); const d = new Date(t + "T12:00:00Z"); const off = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getTime() - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime(); return Date.parse(t + "T00:00:00Z") - off; };

    /* app.money_profile_reach: the employee's e-mail / phone, else the profile's */
    function reach(id) {
      const p = profileOf(id);
      const e = rows.employees ? rows.employees.find((x) => x.profile_id === id) : null;
      return { email: (e && String(e.email || "").trim()) || (p ? String(p.email || "").trim() : ""), phone: (e && e.phone_e164) || (p ? e164(p.phone) : null) };
    }
    const phoneWords = (v) => (E164.test(String(v || "")) ? "(" + v.slice(2, 5) + ") " + v.slice(5, 8) + "-" + v.slice(8) : "");
    /* app.money_requester_vars */
    function requesterVars(uid) {
      const p = profileOf(uid);
      const name = p ? String(p.full_name || "").trim() : "";
      const r = reach(uid);
      return { company: company(), requesterName: safeValue(name, 80), requesterFirstName: safeValue(firstName(name), 80),
        requesterPhone: phoneWords(r.phone), requesterEmail: emailOk(r.email) ? r.email : "" };
    }
    /* app.money_approval_vars */
    function approvalVars(billIds, to, requester) {
      const bills = billIds.map(billOf).filter(Boolean).sort((a, b) => a.id - b.id);
      const n = bills.length;
      const list = bills.map((b) => {
        const c = contactOf(b.vendor_contact_id);
        const pr = projOf(b.project_id) || {};
        return [safeValue(String(b.vendor_name || "").trim() || (c && String(c.company || "").trim()) || (c && String(c.name || "").trim()) || "A vendor", 80) || null,
          safeValue(b.invoice_number, 40) ? "invoice #" + safeValue(b.invoice_number, 40) : null,
          safeValue(String(pr.number || "").trim() || pr.name, 120) || null,
          b.due_date ? "due " + monDay(b.due_date) : null,
          portal() + "/bill.html?id=" + b.id].filter(Boolean).join(" · ");
      }).join("\n");
      const tp = profileOf(to);
      return Object.assign(requesterVars(requester), {
        approverName: safeValue(tp ? tp.full_name : "", 80), approverFirstName: safeValue(firstName(tp ? tp.full_name : ""), 80),
        billsPhrase: n === 1 ? "1 bill is" : n + " bills are", billList: list,
        link: n === 1 ? portal() + "/bill.html?id=" + billIds[0] : portal() + "/dashboard.html",
      });
    }
    /* app.money_pickup_vars */
    function pickupVars(payIds, contactId, requester) {
      const pays = payIds.map(payOf).filter(Boolean).map((p) => {
        const b = billOf(p.bill_id) || {};
        const pr = projOf(b.project_id) || {};
        const bc = contactOf(b.vendor_contact_id);
        return { id: p.id, method: p.method, paid: String(p.paid_date || "").slice(0, 10), check: String(p.check_number || "").trim() || null,
          payee: String(p.payee || "").trim() || String(b.vendor_name || "").trim() || (bc && String(bc.company || "").trim()) || (bc && String(bc.name || "").trim()) || null,
          label: dashLabel(pr.number, pr.name), invoice: String(b.invoice_number || "").trim() || null };
      }).sort((a, b) => a.id - b.id);
      const c = contactOf(contactId);
      const name = (c && (String(c.name || "").trim() || String(c.company || "").trim())) || (pays[0] && pays[0].payee) || "";
      const payee = (pays[0] && pays[0].payee) || "";
      const uniq = (list) => Array.from(new Set(list.filter(Boolean))).sort();
      const out = Object.assign(requesterVars(requester), {
        firstName: safeValue(firstName(name), 80), name: safeValue(name, 80), payee: safeValue(payee, 80),
        projectLabel: uniq(pays.map((p) => safeValue(p.label, 120))).join("; "),
        invoiceNumber: uniq(pays.map((p) => safeValue(p.invoice, 40))).join(", #"),
        writtenDate: Array.from(new Set(pays.map((p) => p.paid))).sort().map(monDayYear).join(", "),
      });
      if (pays.some((p) => p.method === "check")) out.checkNumber = uniq(pays.filter((p) => p.method === "check").map((p) => safeValue(p.check, 40))).join(", #");
      return out;
    }
    const SAMPLE = () => ({
      approverName: "Alex Approver", approverFirstName: "Alex", billsPhrase: "2 bills are",
      billList: "Sample Framing Sub LLC · invoice #1043 · A101 · due " + monDay(E.addDaysYmd ? E.addDaysYmd(today(), 7) : today()) + " · " + portal() + "/bill.html?id=1\n" +
        "Valley Truss Co · invoice #77 · A102 · " + portal() + "/bill.html?id=2",
      link: portal() + "/dashboard.html", firstName: "Sam", name: "Sam Sample", payee: "Sample Framing Sub LLC",
      projectLabel: "A101 " + DASH + " Sample Job", invoiceNumber: "1043", writtenDate: monDayYear(today()), checkNumber: "1001",
    });

    function templateRow(key, channel) { return rows.message_templates.find((t) => t.key === key && t.channel === channel) || null; }
    function templateJson(t) {
      const d = def(t.key, t.channel);
      return { key: t.key, channel: t.channel, subject: t.subject, body: t.body, version: t.version, updatedAt: iso(t.updated_at), updatedBy: t.updated_by,
        isDefault: !!d && d.subject === t.subject && d.body === t.body };
    }
    function messageJson(m) {
      return { id: m.id, groupId: m.group_id, kind: m.kind, templateKey: m.template_key, channel: m.channel, toProfileId: m.to_profile_id, toContactId: m.to_contact_id,
        toName: m.to_name, status: m.status, statusNote: m.status_note, subject: m.subject, body: m.body, phone: m.channel === "sms" ? m.to_address : null,
        billIds: m.bill_ids, paymentIds: m.payment_ids, createdAt: iso(m.created_at), sentAt: iso(m.sent_at), version: m.version };
    }
    const uuid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : "00000000-0000-4000-8000-" + String(Date.now()).slice(-12).padStart(12, "0"));
    function writeMessage(w, f) {
      const r = Object.assign(clone(COLS.money_messages), { id: nextId("money_messages") }, f);
      auditInsert(w, "money_messages", r);
      commitInsert("money_messages", r);
      return r;
    }
    function writeOutbox(kind, m) {
      const r = Object.assign(clone(COLS.notifications_outbox), { id: nextId("notifications_outbox"), kind, task_id: null, to_profile_id: m.to_profile_id,
        to_email: m.to_address, to_name: m.to_name, subject: m.subject, body: m.body, created_at: nowIso(), email_wanted: true, push_result: "e-mail only",
        money_message_id: m.id });
      commitInsert("notifications_outbox", r);
      return r;
    }
    function update(table, old, patch, w) {
      const r = Object.assign(clone(old), patch);
      if (table !== "notifications_outbox") auditUpdate(w || { uid: null }, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    /* app.stamp_told: untold, live check / cash payments on live bills; the first stamp wins */
    function stampTold(ids, how, by, suffix) {
      const p0 = profileOf(by);
      const who = ((p0 && (String(p0.full_name || "").trim() || p0.email)) || "The office").slice(0, 120 - String(suffix || "").length) + (suffix || "");
      const done = [];
      (ids || []).forEach((id) => {
        const p = payOf(id);
        const b = p ? billOf(p.bill_id) : null;
        if (!p || !b || b.deleted_at || b.void || !["check", "cash"].includes(p.method) || p.pickup_told_at || p.voided_at) return;
        update("payments", p, { pickup_told_at: nowIso(), pickup_told_by: who, pickup_told_how: how }, { uid: by });
        done.push(p.id);
      });
      return done;
    }
    /* app.money_rate_check */
    function rateCheck(w, kind, billIds, to) {
      if (!to.length) return;
      const hour = Date.now() - 3600000;
      const mine = rows.money_messages.filter((m) => m.created_by === w.uid && Date.parse(m.created_at) > hour).length;
      if (mine + to.length > 30) throw rate("at most 30 money messages an hour: wait a little, or call instead");
      const since = midnight();
      for (const t of to) {
        if (t.channel !== "email") continue;
        if (kind === "approval_request") {
          for (const b of billIds) {
            const n = rows.money_messages.filter((m) => m.kind === "approval_request" && m.channel === "email" && ["queued", "sent"].includes(m.status) &&
              m.to_profile_id === t.profile && (m.bill_ids || []).includes(b) && Date.parse(m.created_at) >= since).length;
            if (n >= 3) {
              const p = profileOf(t.profile);
              throw rate(((p && String(p.full_name || "").trim()) || "that person") + " was already e-mailed 3 times today about " + billWords(b) + ": call instead");
            }
          }
        } else {
          const n = rows.money_messages.filter((m) => m.kind === "payment_pickup" && m.channel === "email" && ["queued", "sent"].includes(m.status) &&
            m.to_contact_id === t.contact && Date.parse(m.created_at) >= since).length;
          if (n >= 3) { const c = contactOf(t.contact); throw rate(((c && (c.name || c.company)) || "that contact") + " was already e-mailed 3 times today: call instead"); }
        }
      }
    }
    /* app.money_bill_words */
    function billWords(id) {
      const b = billOf(id);
      if (!b) return "that bill";
      const c = contactOf(b.vendor_contact_id);
      const pr = projOf(b.project_id) || {};
      return [String(oneLine(b.vendor_name) || (c && oneLine(c.company)) || (c && oneLine(c.name)) || "a vendor").slice(0, 80),
        b.invoice_number ? "invoice #" + oneLine(b.invoice_number).slice(0, 40) : null, "job " + (oneLine(pr.number) || oneLine(pr.name).slice(0, 60))].filter(Boolean).join(", ");
    }
    const documented = (b) => b.document_file_id !== null && b.document_file_id !== undefined &&
      rows.files.some((f) => f.id === Number(b.document_file_id) && f.project_id === b.project_id && !f.deleted_at);
    const idList = (v, max, what) => {
      if (!Array.isArray(v) || !v.length || v.some((x) => x === null || x === undefined)) throw rule("22023", "which " + what + "? 1 to " + max);
      const out = Array.from(new Set(v.map(Number))).sort((a, b) => a - b);
      if (out.length > max) throw rule("22023", "which " + what + "? 1 to " + max);
      return out;
    };

    function rpc(w, name, a) {
      switch (name) {
        case "save_message_template": case "reset_message_template": {
          const reset = name === "reset_message_template";
          editor(w, "changes the message templates");
          if (!VARS[a.p_key] || !["email", "sms"].includes(a.p_channel)) throw rule("22023", "there is no such message template");
          if (a.p_version === null || a.p_version === undefined) throw rule("22023", (reset ? "reset" : "save") + " the template as it was shown: its version is required");
          const d = def(a.p_key, a.p_channel);
          const subject = reset ? d.subject : a.p_channel === "sms" ? (a.p_subject === "" ? null : a.p_subject === undefined ? null : a.p_subject) : a.p_subject;
          const body = reset ? d.body : a.p_body;
          if (!reset) { const why = problem(a.p_key, a.p_channel, subject, body); if (why) throw rule("22023", why); }
          const t = templateRow(a.p_key, a.p_channel);
          if (!t) throw notFound("message template");
          if (Number(t.version) !== Number(a.p_version)) {
            throw new PgErr("PT409", "the template was changed by someone else", 409, JSON.stringify({ table: "message_templates", key: a.p_key, channel: a.p_channel, version: t.version }));
          }
          if ((t.subject === undefined ? null : t.subject) === (subject === undefined ? null : subject) && t.body === body) return Object.assign(templateJson(t), { unchanged: true });
          return templateJson(update("message_templates", t, { subject: subject === undefined ? null : subject, body }, w));
        }
        case "preview_message_template": {
          editor(w, "previews the message templates");
          if (!VARS[a.p_key] || !["email", "sms"].includes(a.p_channel)) throw rule("22023", "there is no such message template");
          let subject = a.p_subject === undefined ? null : a.p_subject, body = a.p_body === undefined ? null : a.p_body;
          if (subject === null && body === null) {
            const t = templateRow(a.p_key, a.p_channel) || def(a.p_key, a.p_channel);
            subject = t.subject; body = t.body;
          }
          let vars;
          if (a.p_key === "approval_request") {
            const ids = Array.isArray(a.p_bill_ids) ? a.p_bill_ids : [];
            if (ids.length > 50) throw rule("22023", "at most 50 bills");
            if (ids.some((id) => !billSeen(w, billOf(id)))) throw notFound("bill");
            if (a.p_to_profile_id && !approves(a.p_to_profile_id)) throw rule("22023", "that person does not approve payments (an active admin, or a manager who approves and sees financials)");
            vars = Object.assign(requesterVars(w.uid), SAMPLE());
            if (ids.length) {
              const x = approvalVars(Array.from(new Set(ids.map(Number))).sort((p, q) => p - q), a.p_to_profile_id || null, w.uid);
              if (!a.p_to_profile_id) { delete x.approverName; delete x.approverFirstName; }
              Object.assign(vars, x);
            } else if (a.p_to_profile_id) {
              const tp = profileOf(a.p_to_profile_id);
              Object.assign(vars, { approverName: safeValue(tp.full_name, 80), approverFirstName: safeValue(firstName(tp.full_name), 80) });
            }
          } else {
            const ids = Array.isArray(a.p_payment_ids) ? a.p_payment_ids : [];
            if (ids.length > 20) throw rule("22023", "at most 20 payments");
            if (ids.some((id) => { const p = payOf(id); return !p || !w.financials || !projectVisible(w, p.project_id); })) throw notFound("payment");
            vars = Object.assign(requesterVars(w.uid), SAMPLE());
            if (ids.length) {
              const cs = Array.from(new Set(ids.map((id) => (billOf(payOf(id).bill_id) || {}).vendor_contact_id).filter((x) => x !== null && x !== undefined)));
              Object.assign(vars, pickupVars(ids.map(Number), cs.length === 1 ? cs[0] : null, w.uid));
            }
            if (a.p_key === "cash_ready") delete vars.checkNumber;
          }
          const c = compose(a.p_channel, subject, body, vars);
          return { subject: a.p_channel === "email" ? c.subject || "" : null, body: c.body || "", problem: problem(a.p_key, a.p_channel, subject, body) };
        }
        case "money_approvers": {
          editor(w, "asks for an approval");
          const ids = Array.isArray(a.p_bill_ids) ? a.p_bill_ids : [];
          if (ids.length > 50) throw rule("22023", "at most 50 bills");
          if (ids.some((id) => id === null || !billSeen(w, billOf(id)))) throw notFound("bill");
          const list = rows.profiles.filter((p) => approves(p.id) && p.id !== w.uid);
          const vkey = (b) => (b.vendor_contact_id !== null && b.vendor_contact_id !== undefined ? "c" + b.vendor_contact_id : "n" + payeeKey(b.vendor_name));
          const latest = (pred) => rows.bills.filter((b) => b.approved_at && b.approved_by && approves(b.approved_by) && pred(b) && list.some((p) => p.id === b.approved_by))
            .sort((x, y) => String(y.approved_at).localeCompare(String(x.approved_at)) || y.id - x.id)[0];
          const usual = ids.map((id) => {
            const b = billOf(id);
            const k = vkey(b);
            const hit = latest((x) => x.project_id === b.project_id) || (k !== "n" ? latest((x) => vkey(x) === k) : null);
            return { bill: b, who: hit ? hit.approved_by : null, number: (projOf(b.project_id) || {}).number || null };
          });
          return list.map((p) => {
            const r = reach(p.id);
            const mine = usual.filter((u) => u.who === p.id);
            const name = String(p.full_name || "").trim() || p.email;
            return { profileId: p.id, name, firstName: firstName(name), role: p.role, hasEmail: emailOk(r.email), phone: E164.test(String(r.phone || "")) ? r.phone : null,
              usual: mine.length > 0, usualFor: Array.from(new Set(mine.map((u) => u.number).filter(Boolean))) };
          }).sort((x, y) => (y.usual ? 1 : 0) - (x.usual ? 1 : 0) || x.name.toLowerCase().localeCompare(y.name.toLowerCase()) || String(x.profileId).localeCompare(String(y.profileId)));
        }
        case "reminder_pc_status": {
          if (!w.financials) throw deny("only a person who sees financials reads the reminder PC's status");
          if (dev.pc) return Object.assign({ seenMinutesAgo: 1, paused: false, notTaking: false }, dev.pc);
          const host = typeof E.server === "function" ? E.server() : null;
          if (!host || host.standby) return { seenMinutesAgo: null, paused: null, notTaking: false };
          const ago = Math.floor((Date.now() - Date.parse(host.at)) / 60000);
          const waiting = (rows.notifications_outbox || []).some((o) => ["approval_request", "payment_pickup"].includes(o.kind) && o.email_wanted && !o.sent_at &&
            !o.claimed_at && Date.parse(o.created_at) < Date.now() - 15 * 60000);
          return { seenMinutesAgo: ago, paused: !!(host.payload && host.payload.paused), notTaking: ago < 5 && waiting };
        }
        case "ask_for_approval": {
          editor(w, "asks for an approval");
          const bills = idList(a.p_bill_ids, 50, "bills");
          for (const id of bills) {
            const b = billOf(id);
            if (!billSeen(w, b)) throw notFound("bill");
            if (b.deleted_at) throw rule("22023", billWords(id) + " was deleted");
            if (b.void) throw rule("22023", billWords(id) + " is void: nothing to approve");
            if (!(Number(b.amount) > 0)) throw rule("22023", billWords(id) + " has no amount yet");
            if (!documented(b)) throw rule("22023", "attach the invoice to " + billWords(id) + " first: a bill is approved on its document");
            if (b.approved_at && b.pay_method) throw rule("22023", billWords(id) + " is already approved");
          }
          const TO = 'say who is asked: 1 to 10 people, each {"profile": <their id>, "channel": "email" or "sms"}';
          if (!Array.isArray(a.p_to) || a.p_to.length < 1 || a.p_to.length > 10) throw rule("22023", TO);
          const seen = [], plan = [];
          for (const e of a.p_to) {
            if (!e || typeof e !== "object" || Array.isArray(e) || Object.keys(e).sort().join() !== "channel,profile" || typeof e.profile !== "string" || typeof e.channel !== "string") throw rule("22023", TO);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.profile) || !["email", "sms"].includes(e.channel)) throw rule("22023", TO);
            const id = e.profile.toLowerCase();
            if (seen.includes(id)) throw rule("22023", "each person is asked once: by e-mail or by text");
            seen.push(id);
            if (id === w.uid) throw rule("22023", "you cannot ask yourself");
            if (!approves(id)) throw rule("22023", "that person does not approve payments (an active admin, or a manager who approves and sees financials)");
            const r = reach(id);
            const p = profileOf(id);
            const nm = oneLine(String(p.full_name || "").trim() || p.email).slice(0, 200);
            if (e.channel === "email" && !emailOk(r.email)) throw rule("22023", nm + " has no e-mail address that can be used: text or call them");
            if (e.channel === "sms" && !E164.test(String(r.phone || ""))) throw rule("22023", nm + " has no mobile number on file: e-mail or call them");
            plan.push({ profile: id, channel: e.channel, name: nm, address: e.channel === "email" ? r.email : r.phone });
          }
          const tm = templateRow("approval_request", "email") || def("approval_request", "email");
          const ts = templateRow("approval_request", "sms") || def("approval_request", "sms");
          const mail = { subject: tm.subject, body: tm.body }, text = { body: ts.body };
          if (a.p_subject !== null && a.p_subject !== undefined || a.p_body !== null && a.p_body !== undefined) {
            if (a.p_subject !== null && a.p_subject !== undefined) mail.subject = a.p_subject;
            if (a.p_body !== null && a.p_body !== undefined) mail.body = a.p_body;
            const why = problem("approval_request", "email", mail.subject, mail.body);
            if (why) throw rule("22023", "the e-mail: " + why);
          }
          if (a.p_sms_body !== null && a.p_sms_body !== undefined) {
            text.body = a.p_sms_body;
            const why = problem("approval_request", "sms", null, text.body);
            if (why) throw rule("22023", "the text: " + why);
          }
          const recent = Date.now() - 10 * 60000;
          plan.forEach((x) => {
            const old = rows.money_messages.filter((m) => m.kind === "approval_request" && m.to_profile_id === x.profile && m.channel === x.channel &&
              ["draft", "queued", "sent"].includes(m.status) && Date.parse(m.created_at) > recent && bills.every((b) => (m.bill_ids || []).includes(b))).sort((p, q) => q.id - p.id)[0];
            if (old) x.already = old;
          });
          rateCheck(w, "approval_request", bills, plan.filter((x) => !x.already));
          const group = uuid();
          const out = [];
          for (const x of plan) {
            if (x.already) { out.push(Object.assign(messageJson(x.already), { already: true })); continue; }
            const vars = approvalVars(bills, x.profile, w.uid);
            const c = x.channel === "email" ? compose("email", mail.subject, mail.body, vars) : compose("sms", null, text.body, vars);
            if (!c.body) throw rule("22023", "the message would be empty");
            const m = writeMessage(w, { group_id: group, kind: "approval_request", template_key: "approval_request", channel: x.channel, by_hand: x.channel === "sms",
              bill_ids: bills, payment_ids: null, to_profile_id: x.profile, to_contact_id: null, to_name: x.name, to_address: x.address,
              subject: x.channel === "email" ? c.subject || fit("A message from " + (company() || "the office"), 200) : null, body: c.body,
              status: x.channel === "email" ? "queued" : "draft", status_note: null, sent_at: null });
            if (m.channel === "email") writeOutbox("approval_request", m);
            out.push(messageJson(m));
          }
          return { groupId: group, messages: out };
        }
        case "tell_payee": {
          editor(w, "tells a payee their payment is ready");
          if (!["email", "sms"].includes(a.p_channel)) throw rule("22023", "tell them by email or sms");
          const pays = idList(a.p_payment_ids, 20, "payments");
          for (const id of pays) {
            const p = payOf(id);
            if (!p || !w.financials || !projectVisible(w, p.project_id)) throw notFound("payment");
            const b = billOf(p.bill_id);
            if (p.voided_at) throw rule("22023", "that payment was voided: nobody is told about it");
            if (!["check", "cash"].includes(p.method)) throw Object.assign(rule("22023", "only a check or cash is picked up"), { hint: "not_collectable" });
            if (p.picked_up_at) throw rule("22023", "that payment was picked up already");
            if (!b || b.deleted_at || b.void) throw rule("22023", "that payment's bill was deleted or voided");
          }
          const list = pays.map(payOf);
          const methods = Array.from(new Set(list.map((p) => p.method)));
          if (methods.length > 1) throw rule("22023", "one message is about checks or about cash, not both");
          const key = methods[0] === "cash" ? "cash_ready" : "check_ready";
          const billIds = Array.from(new Set(list.map((p) => p.bill_id))).sort((x, y) => x - y);
          const contacts = Array.from(new Set(billIds.map((id) => billOf(id).vendor_contact_id).filter((x) => x !== null && x !== undefined)));
          const PAYEE = "that contact is not this bill's payee: fix the contact's company first";
          let c;
          if (contacts.length > 1) throw rule("22023", "these payments are for different payees: tell each one on their own");
          if (contacts.length === 1) {
            if (a.p_contact_id !== null && a.p_contact_id !== undefined && Number(a.p_contact_id) !== contacts[0]) throw rule("22023", "the bill names its payee's contact: the message goes to that contact");
            c = contactOf(contacts[0]);
            if (!c || c.deleted_at) throw rule("22023", "the bill's contact was deleted: link the bill to the payee's contact");
          } else {
            if (a.p_contact_id === null || a.p_contact_id === undefined) throw rule("22023", "no contact on this bill: pick the payee's contact (or add one in DCR Desktop 2 Contacts)");
            c = contactOf(a.p_contact_id);
            if (!c || c.deleted_at || !["subcontractor", "supplier", "service", "other"].includes(c.kind)) throw rule("22023", PAYEE);
          }
          // I36: a bill with no contact is this contact's only when it is the quote's vendor, or its company or name is the payee
          for (const p of list) {
            const b = billOf(p.bill_id);
            if (b.vendor_contact_id !== null && b.vendor_contact_id !== undefined) continue;
            const q = b.quote_id !== null && b.quote_id !== undefined && rows.quotes ? rows.quotes.find((x) => x.id === b.quote_id) : null;
            if (q && q.vendor_contact_id === c.id) continue;
            const mine = [payeeKey(c.company), payeeKey(c.name)].filter(Boolean);
            if (!mine.some((k) => k === payeeKey(p.payee) || k === payeeKey(b.vendor_name))) throw rule("22023", PAYEE);
          }
          const nm = oneLine(String(c.name || "").trim() || String(c.company || "").trim() || "the payee").slice(0, 200);
          let address;
          if (a.p_channel === "email") {
            address = String(c.email || "").trim();
            if (!emailOk(address)) throw rule("22023", nm + " has no e-mail address that can be used: text or call them");
          } else {
            address = e164(c.phone);
            if (!E164.test(String(address || ""))) throw rule("22023", nm + " has no mobile number on file: e-mail or call them");
          }
          const t0 = templateRow(key, a.p_channel) || def(key, a.p_channel);
          const t = { subject: a.p_channel === "email" ? t0.subject : null, body: t0.body };
          if ((a.p_subject !== null && a.p_subject !== undefined) || (a.p_body !== null && a.p_body !== undefined)) {
            t.subject = a.p_channel === "email" ? (a.p_subject !== null && a.p_subject !== undefined ? a.p_subject : t.subject) : (a.p_subject === undefined ? null : a.p_subject);
            if (a.p_body !== null && a.p_body !== undefined) t.body = a.p_body;
            const why = problem(key, a.p_channel, t.subject, t.body);
            if (why) throw rule("22023", (a.p_channel === "email" ? "the e-mail: " : "the text: ") + why);
          }
          const recent = Date.now() - 10 * 60000;
          const old = rows.money_messages.filter((m) => m.kind === "payment_pickup" && m.to_contact_id === c.id && m.channel === a.p_channel &&
            ["draft", "queued", "sent"].includes(m.status) && Date.parse(m.created_at) > recent && pays.every((p) => (m.payment_ids || []).includes(p))).sort((p, q) => q.id - p.id)[0];
          if (old) return { groupId: old.group_id, messages: [Object.assign(messageJson(old), { already: true })] };
          rateCheck(w, "payment_pickup", billIds, [{ contact: c.id, channel: a.p_channel }]);
          const vars = pickupVars(pays, c.id, w.uid);
          const r = compose(a.p_channel, t.subject, t.body, vars);
          if (!r.body) throw rule("22023", "the message would be empty");
          const m = writeMessage(w, { group_id: uuid(), kind: "payment_pickup", template_key: key, channel: a.p_channel, by_hand: a.p_channel === "sms",
            bill_ids: billIds, payment_ids: pays, to_profile_id: null, to_contact_id: c.id, to_name: nm, to_address: address,
            subject: a.p_channel === "email" ? r.subject || fit("A message from " + (company() || "the office"), 200) : null, body: r.body,
            status: a.p_channel === "email" ? "queued" : "draft", status_note: null, sent_at: null });
          if (m.channel === "email") writeOutbox("payment_pickup", m);
          return { groupId: m.group_id, messages: [messageJson(m)] };
        }
        case "money_text_sent": {
          editor(w, "marks a text sent");
          if (a.p_sent === null || a.p_sent === undefined) throw rule("22023", "say whether the text was sent (true) or not (false)");
          const m = rows.money_messages.find((x) => x.id === Number(a.p_message_id));
          if (!m || !w.financials || (m.bill_ids || []).some((id) => { const b = billOf(id); return b && !projectVisible(w, b.project_id); })) throw notFound("message");
          if (m.channel !== "sms") throw rule("22023", "only a text message sent by hand is marked this way");
          if (m.created_by !== w.uid && !w.admin) throw deny("only the person who wrote the text (or an admin) marks it");
          if ((a.p_sent && m.status === "sent") || (!a.p_sent && m.status === "cancelled")) return Object.assign(messageJson(m), { already: true });
          if (m.status !== "draft") throw rule("23514", "that text was " + (m.status === "sent" ? "sent" : "cancelled") + " already");
          const x = update("money_messages", m, { status: a.p_sent ? "sent" : "cancelled", sent_at: a.p_sent ? nowIso() : null }, w);
          if (a.p_sent && x.kind === "payment_pickup") stampTold(x.payment_ids, "text message", w.uid, "");
          return messageJson(x);
        }
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }
    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      const opt = OPTIONAL[name] || [];
      if (keys.some((k) => !want.includes(k)) || want.some((k) => !keys.includes(k) && !opt.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }

    /* the reminder PC, by hand (the demo's DCR Agents 2): take the waiting money e-mails, judge them, report each */
    function reminderPc(o) {
      const opt = o || {};
      const out = { sent: 0, failed: 0, setAside: 0 };
      const want = (o2) => ["approval_request", "payment_pickup"].includes(o2.kind) && o2.email_wanted && !o2.sent_at && Number(o2.attempts || 0) < 5 &&
        (!opt.ids || opt.ids.map(Number).includes(Number(o2.money_message_id)));
      const aside = (row, error) => {
        const x = update("notifications_outbox", row, { email_wanted: false, error });
        const m = rows.money_messages.find((y) => y.id === x.money_message_id);
        if (m && m.status === "queued") update("money_messages", m, { status: "not_sent", status_note: error.slice(0, 2000) });
        out.setAside++;
      };
      rows.notifications_outbox.filter(want).sort((p, q) => p.id - q.id).forEach((row) => {
        const m = rows.money_messages.find((y) => y.id === row.money_message_id);
        if (!m) return;
        if (!emailOk(String(row.to_email || "").trim())) { aside(row, "skipped: the address can't be used"); return; }
        if (row.kind === "approval_request") {
          if (!(m.bill_ids || []).some((id) => { const b = billOf(id); return b && !b.deleted_at && !b.void && (!b.approved_at || !b.pay_method); })) {
            aside(row, "skipped: every bill in it was approved, voided or deleted meanwhile"); return;
          }
          if (!approves(row.to_profile_id)) { aside(row, "skipped: the person no longer approves payments"); return; }
        } else if (!(m.payment_ids || []).some((id) => {
          const p = payOf(id);
          const b = p ? billOf(p.bill_id) : null;
          return p && b && !b.deleted_at && !b.void && !p.voided_at && !p.picked_up_at && (!p.pickup_told_at || Date.parse(p.pickup_told_at) < Date.parse(m.created_at));
        })) { aside(row, "skipped: the payment was voided, picked up, deleted or told meanwhile"); return; }
        const opted = opt.optOut === true || (Array.isArray(opt.optOut) && opt.optOut.map((x) => String(x).toLowerCase()).includes(String(row.to_email || "").toLowerCase()));
        if (opted) { aside(row, "opted out"); return; }
        if (opt.fail) {
          const tries = Number(row.attempts || 0) + 1;
          const err = "the made-up mail channel failed";
          update("notifications_outbox", row, { attempts: tries, claimed_at: nowIso(), error: err });
          if (m.status === "queued") update("money_messages", m, tries >= 5 ? { status: "not_sent", status_note: "not sent after 5 tries: " + err } : { status_note: "trying again: " + err });
          out.failed++;
          return;
        }
        const at = nowIso();
        update("notifications_outbox", row, { attempts: Number(row.attempts || 0) + 1, claimed_at: at, sent_at: at, sent_by: "demo PC", error: null });
        const x = update("money_messages", m, { status: "sent", sent_at: at, status_note: null });
        if (x.kind === "payment_pickup") stampTold(x.payment_ids, "email", x.created_by, " (e-mail by DCR Agents 2)");
        out.sent++;
      });
      return out;
    }

    return {
      name: "p8-books", tables: new Set(["message_templates", "money_messages"]),
      canRead: (w, table) => !!(w.active && w.financials && (table === "message_templates" || table === "money_messages")),
      canInsert: () => false, canUpdate: () => false, canDelete: () => false,
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
      __dev: { reminderPc, pcStatus: (o) => { dev.pc = o || null; return dev.pc; } },
    };
  });

  /* ── made-up data (after p5b-books.js's and p8-register.js's bills and payments) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedMessages(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const iso = (d) => new Date(d).toISOString();
    const at = (days, hour) => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d - days, 16 + (hour || 0), 40, 0));
      return t.getTime() > now.getTime() ? iso(now.getTime() - 60000 * (days + 9)) : iso(t);
    };
    const day = (days) => { const [y, m, d] = today.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10); };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || null, updated_at: at(days), updated_by: null, version: 1 });
    ["bills", "payments", "files", "notifications_outbox"].forEach((t) => { out[t] = out[t] || []; });
    out.message_templates = [];
    Object.keys(DEFAULTS).forEach((k) => {
      const [key, channel] = k.split("/");
      out.message_templates.push(Object.assign({ _k: k, key, channel, subject: DEFAULTS[k][0], body: DEFAULTS[k][1] }, audit(40, null)));
    });
    out.money_messages = out.money_messages || [];
    out.notifications_outbox.forEach((o) => { if (!("money_message_id" in o)) o.money_message_id = null; if (!("to_name" in o)) o.to_name = null; });
    if (!P.accountant || !P.admin || !out.projects || !out.contacts) return;
    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const kitchen = byNumber("A303");
    // another made-up job, one with no bills yet
    const job = out.projects.find((p) => p.status === "in_progress" && !p.deleted_at && !out.bills.some((b) => b.project_id === p.id));
    const used = new Set(out.bills.map((b) => b.vendor_contact_id).filter((x) => x !== null && x !== undefined));
    const free = out.contacts.filter((c) => !c.deleted_at && (c.kind === "subcontractor" || c.kind === "supplier") && c.email && c.phone && !used.has(c.id))
      .sort((a, b) => a.id - b.id);
    if (!kitchen || !job || free.length < 2) return;
    const maxId = (t) => out[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const ids = { b: maxId("bills"), p: maxId("payments"), f: maxId("files"), m: 0, o: maxId("notifications_outbox") };
    const proto = out.bills[0] || {};
    out.objects = out.objects || {};
    function bill(project, c, number, amount, description, days, f) {
      const id = ++ids.b;
      const fid = ++ids.f;
      const name = c.company + " " + number + ".pdf";
      const key = "f/" + project.id + "/receipts/" + (fid.toString(16).padStart(8, "0") + "d".repeat(24)) + "/" + name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      out.files.push(Object.assign({ id: fid, project_id: project.id, estimate_item_id: null, journal_entry_id: null, bill_id: id, cost_id: null, payment_id: null,
        folder: "receipts", subpath: "", name, storage_path: key, size: 141000, mime: "application/pdf", version_no: 1, previous_id: null, is_financial: true,
        storage: "cloud", rel_path: null, modified_at: null, description: null, preview_path: null, source: "desktop", deleted_at: null }, audit(days, P.accountant)));
      out.objects[key] = { size: 141000, mime: "application/pdf", owner: P.accountant, created_at: at(days) };
      const row = Object.assign({}, Object.fromEntries(Object.keys(proto).map((k) => [k, null])), {
        id, project_id: project.id, estimate_item_id: null, quote_id: null, vendor_contact_id: c.id, vendor_name: c.company, invoice_number: number,
        invoice_date: day(days), due_date: day(days - 21), amount, description, document_file_id: fid, void: false, approved_by: null, approved_at: null,
        approved_amount: null, pay_method: null, approval_note: null, kind: /Lumber/.test(c.company) ? "Material supplier" : "Subcontractor",
        qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null, deleted_at: null }, audit(days, P.accountant), f || {});
      out.bills.push(row);
      return row;
    }
    // a second bill waiting on the kitchen job (with Quarryman's, two to ask about at once; the usual approver there:
    // whoever approved the job's latest bill)
    const w2 = bill(kitchen, free[0], "W-3301", 1975, "Cabinet blocking and soffits", 3);
    // another job: one waiting, one approved with no pay method (the approver approved it), one paid by check and not told
    const w3 = bill(job, free[1], "C-512", 2280, "Stair stringers and landing", 5);
    const d1 = bill(job, free[0], "C-498", 640, "Beam pockets, second visit", 9,
      { approved_by: P.approver || P.admin, approved_at: at(6, 1), approved_amount: 640, pay_method: null });
    // (cash: no check number, so the check register's numbers and next number stay as they are)
    const c1 = bill(job, free[1], "C-470", 1150, "Stair framing, first half", 14,
      { approved_by: P.approver || P.admin, approved_at: at(12, 1), approved_amount: 1150, pay_method: "cash" });
    out.payments.push(Object.assign({ id: ++ids.p, bill_id: c1.id, project_id: job.id, paid_date: day(1), amount: 1150, method: "cash", check_number: null,
      reference: "Petty cash slip 22", notes: null, payee: free[1].company, memo: job.number + " · Inv C-470", pickup_told_at: null, pickup_told_by: null,
      pickup_told_how: null }, NS.p8RegisterPaymentCols || {}, audit(1, P.accountant)));
    // what was said before: an ask by e-mail about Quarryman's bill (sent), and Larkspur's pick-up e-mail (sent)
    const quarry = out.bills.find((b) => b.description === "Footings and stem wall, phase 1");
    const admin = out.profiles.find((p) => p.id === P.admin);
    const msg = (f, days) => {
      const r = Object.assign({}, MESSAGE_COLS, { id: ++ids.m, group_id: "0b1c2d3e-4f50-4a61-8b72-" + String(9000 + ids.m).padStart(12, "0") }, f, audit(days, P.accountant));
      out.money_messages.push(r);
      out.notifications_outbox.push({ id: ++ids.o, kind: r.kind, task_id: null, to_profile_id: r.to_profile_id, to_email: r.to_address, subject: r.subject, body: r.body,
        created_at: r.created_at, claimed_at: r.sent_at, sent_at: r.sent_at, attempts: 1, error: null, sent_by: "demo PC", push_sent_at: null, push_result: "e-mail only",
        email_wanted: true, money_message_id: r.id, to_name: r.to_name });
      return r;
    };
    if (quarry && admin) {
      msg({ kind: "approval_request", template_key: "approval_request", channel: "email", by_hand: false, bill_ids: [quarry.id], to_profile_id: admin.id,
        to_name: admin.full_name, to_address: admin.email, subject: "Approval needed: 1 bill is waiting for you",
        body: "Hi " + admin.full_name.split(" ")[0] + ",\r\n\r\n1 bill is waiting for your approval:\r\n\r\n(made-up demo message)", status: "sent", sent_at: at(2, 1) }, 2);
    }
    const lark = out.payments.find((p) => p.check_number === "5288");
    const larkBill = lark ? out.bills.find((b) => b.id === lark.bill_id) : null;
    const larkC = larkBill ? out.contacts.find((c) => c.id === larkBill.vendor_contact_id) : null;
    if (lark && larkC) {
      msg({ kind: "payment_pickup", template_key: "check_ready", channel: "email", by_hand: false, bill_ids: [lark.bill_id], payment_ids: [lark.id],
        to_contact_id: larkC.id, to_name: larkC.name, to_address: larkC.email, subject: "Your check is ready for pickup",
        body: "Hello " + larkC.company + ",\r\n\r\nYour check #5288 is ready to be picked up at our office.\r\n(made-up demo message)", status: "sent", sent_at: at(32, 3) }, 32);
    }
    void w2; void w3; void d1;
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

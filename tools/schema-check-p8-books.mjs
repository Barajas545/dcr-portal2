/* DCR Portal 2 — the Accounting page's and the money messages' calls against the REAL database rules (development
   only): the Books program's release B part 2a, P4 part of tools/schema-check.mjs (it calls run() with its own helpers).
   site/js/repo/money-messages.js, repo/books-home.js and map/money-messages.js run over PGlite loaded with every DCR
   Desktop 2 migration - 20261030000400_money_messages (M4) included: point DCR_DESKTOP2_DIR at a checkout of the branch
   books-messages - as each made-up role:

   * names: every column the modules select (money_messages, message_templates) and every RPC argument they send exist
     (and equal the demo database's: tools/fake/p8-books.js); the chips equal app.money_template_vars;
   * who: the accountant and an admin read the page and ask, tell and change templates; the accountant never approves
     (42501, S1); a manager without financials, a lead, field and view-only are refused before anything is read (the
     RPCs 42501, the tables nothing); the agents account reads none of it;
   * recipients (S2, S6): the approvers are exactly app.can_approve's people, never the caller, never an address; the
     usual approver is the job's last approver; a non-approver (the accountant, a manager without the switches, an
     admin turned off) and oneself are refused 22023; a contact with no e-mail is refused;
   * no amount (S5): a typed amount in a one-off text or a template is refused in the database's words; the six
     defaults pass the template rules and are app.scrub_money of themselves ("invoice #1043" intact); every stored body
     is its own scrub; the sms: link of a text draft is built from the database's E.164 number;
   * the life of a message, as the agents account: agents_outbox_take answers its very keys, money rows masked; done
     (sent) makes a pick-up told "(e-mail by DCR Agents 2)"; a bill approved first sets its ask aside; the checks feed
     stands down while her e-mail waits; I sent it stamps told "text message";
   * the limits: the 4th e-mail a company day about one bill to one approver is PT429 in the database's words;
   * templates: save at the version shown (PT409 otherwise), reset; reminder_pc_status never names the PC;
   * drift: the demo database (tools/fake/p8-books.js) has the real columns and the RPCs' arguments.
   Made-up people and jobs only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  if (!(catalog.tables.money_messages && catalog.tables.message_templates && catalog.functions.ask_for_approval && catalog.functions.tell_payee)) {
    results.push({ section, name: "The Books program's M4 (20261030000400_money_messages) is not in DCR Desktop 2 yet: the money messages checks wait for it (DCR_DESKTOP2_DIR)", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const mm = await site("repo/money-messages.js");
  const homeRepo = await site("repo/books-home.js");
  const books = await site("repo/books.js");
  const MM = await site("map/money-messages.js");
  const AMOUNT = /\$\s?\d|\b\d{1,3}(,\d{3})+(\.\d\d)?\b|\b\d+\.\d\d\b/;
  const J = {};

  const me = async (key) => {
    const p = await one("select id, full_name as name, role, active, coalesce(can_see_prices, false) as can_see_prices, coalesce(can_see_financials, false) as can_see_financials, " +
      "coalesce(can_approve_payments, false) as can_approve_payments from public.profiles where id = $1", [PEOPLE[key].id]);
    return Object.assign({}, p, { can_see_financials: p.role === "admin" || p.can_see_financials, can_see_prices: p.role === "admin" || p.can_see_prices });
  };
  const asked = [];
  const origFrom = client.from.bind(client);
  const origRpc = client.rpc.bind(client);
  const sent = [];
  client.from = function (t) { asked.push(t); return origFrom(t); };
  client.rpc = function (n, a) { asked.push("rpc:" + n); sent.push([n, a]); return origRpc(n, a); };
  const raw = async (n, a) => { const r = await origRpc(n, a); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.data; };

  /* ── a made-up job: two vendors (one with no e-mail), four bills waiting, a bill-less check ── */
  await sql("reset role");
  if (!PEOPLE.approver) {
    PEOPLE.approver = { id: "c2000000-0000-4000-8000-0000000008b1", name: "Abe Approver", role: "manager" };
    await sql("insert into auth.users (id, email) values ($1, 'approver@schema-check.test') on conflict do nothing", [PEOPLE.approver.id]);
    await sql(`insert into public.profiles (id, full_name, email, role, can_see_prices, can_see_financials, can_approve_payments)
               values ($1, 'Abe Approver', 'approver@schema-check.test', 'manager', false, true, true) on conflict do nothing`, [PEOPLE.approver.id]);
  }
  await sql("update public.profiles set phone = '(805) 555-0181' where id = $1", [PEOPLE.admin.id]);
  await sql("update public.profiles set phone = '(805) 555-0182' where id = $1", [PEOPLE.approver.id]);
  // an admin turned off: never an approver
  J.offAdmin = "c2000000-0000-4000-8000-0000000008b2";
  await sql("insert into auth.users (id, email) values ($1, 'offadmin@schema-check.test') on conflict do nothing", [J.offAdmin]);
  await sql("insert into public.profiles (id, full_name, email, role, active) values ($1, 'Ode Offadmin', 'offadmin@schema-check.test', 'admin', false) on conflict do nothing", [J.offAdmin]);
  J.project = await one("insert into public.projects (name, city, status) values ('Messages Schema Loft', 'Sandbox', 'in_progress') returning id, number");
  const pid = J.project.id;
  J.oak = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Sam Oakmade', 'Madeup Oakmade Framing', 'subcontractor', 'sam.oakmade@example.com', '(805) 555-0183') returning id")).id;
  J.elm = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Eli Elmade', 'Madeup Elmade Concrete', 'subcontractor', null, '(805) 555-0184') returning id")).id;
  const leaf = (n) => (0x8b00 + n).toString(16).padStart(32, "0");
  let n = 0;
  const bill = async (contact, company, no, amount, approved) => {
    const id = (await one(`insert into public.bills (project_id, vendor_contact_id, vendor_name, invoice_number, amount, kind, due_date)
       values ($1, $2, $3, $4, $5, 'Subcontractor', app.today() + 10) returning id`, [pid, contact, company, no, amount])).id;
    const doc = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, bill_id)
       values ($1, 'receipts', $2, $3, 'application/pdf', 900, $4) returning id`, [pid, no + ".pdf", "f/" + pid + "/receipts/" + leaf(++n) + "/" + no + ".pdf", id])).id;
    await sql("update public.bills set document_file_id = $2 where id = $1", [id, doc]);
    if (approved) await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = amount, pay_method = 'check' where id = $1", [id, PEOPLE.admin.id]);
    return (await one("select id, version, project_id from public.bills where id = $1", [id]));
  };
  J.b0 = await bill(J.oak, "Madeup Oakmade Framing", "OAK-900", 700, false);
  J.b1 = await bill(J.oak, "Madeup Oakmade Framing", "OAK-901", 1250, false);
  J.b2 = await bill(J.oak, "Madeup Oakmade Framing", "OAK-902", 480, false);
  J.b3 = await bill(J.oak, "Madeup Oakmade Framing", "OAK-903", 220, false);
  J.b4 = await bill(J.oak, "Madeup Oakmade Framing", "OAK-904", 90, false);
  J.paidOak = await bill(J.oak, "Madeup Oakmade Framing", "OAK-890", 300, true);
  J.paidElm = await bill(J.elm, "Madeup Elmade Concrete", "ELM-890", 410, true);
  J.walk = await bill(null, "Madeup Walk-in Roofing", "WALK-890", 150, true);
  const payment = async (b, number, payee) => (await one(`insert into public.payments (bill_id, project_id, amount, method, check_number, payee, paid_date)
     values ($1, $2, $3, 'check', $4, $5, app.today()) returning id, version`, [b.id, pid, (await one("select amount from public.bills where id = $1", [b.id])).amount, number, payee])).id;
  J.pOak = await payment(J.paidOak, "TEST-8B1", "Madeup Oakmade Framing");
  J.pElm = await payment(J.paidElm, "TEST-8B2", "Madeup Elmade Concrete");
  J.pWalk = await payment(J.walk, "TEST-8B3", "Madeup Walk-in Roofing");

  await check("P8 books: the names - money_messages' and message_templates' columns, the RPCs' arguments (the demo's too), the chips = app.money_template_vars", async () => {
    for (const c of mm.DRAFT_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.money_messages.cols[c], "money_messages." + c);
    for (const c of mm.TEMPLATE_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.message_templates.cols[c], "message_templates." + c);
    ok(catalog.tables.notifications_outbox.cols.money_message_id && catalog.tables.notifications_outbox.cols.to_name, "the outbox's money columns");
    const args = (f) => (catalog.functions[f] || [])[0] ? catalog.functions[f][0].args.map((a) => a.name) : null;
    same(args("ask_for_approval"), ["p_bill_ids", "p_to", "p_subject", "p_body", "p_sms_body"], "ask_for_approval");
    same(args("tell_payee"), ["p_payment_ids", "p_channel", "p_contact_id", "p_subject", "p_body"], "tell_payee");
    same(args("money_text_sent"), ["p_message_id", "p_sent"], "money_text_sent");
    same(args("money_approvers"), ["p_bill_ids"], "money_approvers");
    same(args("save_message_template"), ["p_key", "p_channel", "p_subject", "p_body", "p_version"], "save_message_template");
    same(args("reset_message_template"), ["p_key", "p_channel", "p_version"], "reset_message_template");
    same(args("preview_message_template"), ["p_key", "p_channel", "p_subject", "p_body", "p_bill_ids", "p_payment_ids", "p_to_profile_id"], "preview_message_template");
    same(args("reminder_pc_status"), [], "reminder_pc_status");
    for (const k of MM.TEMPLATE_KEYS) {
      const db = (await one("select app.money_template_vars($1) as v", [k])).v;
      same(MM.PLACEHOLDERS[k].slice(), db, "the chips of " + k);
    }
  });

  await check("P8 books: who - the accountant and an admin read the page; a manager without financials, a lead, field and view-only are refused before any read (the RPCs 42501); the agents account none", async () => {
    for (const k of ["accountant", "admin"]) {
      await as(k);
      const d = await homeRepo.loadHome(await me(k));
      ok(d.ready && Array.isArray(d.templates) && d.templates.length === 6 && d.waiting.some((b) => b.id === J.b1.id), k + ": the page, the templates, the made-up bills");
    }
    for (const k of ["manager", "lead", "field", "viewer"]) {
      await as(k);
      const who = await me(k);
      asked.length = 0;
      await refused(() => homeRepo.loadHome(who), "42501", k);
      same(asked, [], k + ": nothing asked");
      await refused(() => raw("money_approvers", { p_bill_ids: [J.b1.id] }), "42501", k + ": money_approvers");
      await refused(() => raw("reminder_pc_status", {}), "42501", k + ": reminder_pc_status");
      await refused(() => raw("ask_for_approval", { p_bill_ids: [J.b1.id], p_to: [{ profile: PEOPLE.admin.id, channel: "email" }] }), "42501", k + ": ask_for_approval");
      for (const t of ["money_messages", "message_templates"]) {
        const r = await origFrom(t).select("*").limit(3);
        same((r.data || []).length, 0, k + ": " + t + " shows nothing");
      }
    }
    await as("agents");
    await refused(() => raw("tell_payee", { p_payment_ids: [J.pOak], p_channel: "email" }), "42501", "agents: tell_payee");
    same(((await origFrom("money_messages").select("id").limit(3)).data || []).length, 0, "agents: no message");
  });

  await check("P8 books: the approvers - exactly the approvers, never the caller, never an address; the usual one is the job's last approver; the accountant never approves (S1)", async () => {
    // the approver approves one of the job's bills: the usual approver of the job from now on
    await as("approver");
    const b = await one("select id, version from public.bills where id = $1", [J.b0.id]);
    await books.approve({ id: b.id, version: b.version }, "check", null);
    await as("accountant");
    const list = await mm.approvers([J.b1.id, J.b2.id]);
    const ids = list.map((a) => a.profileId);
    ok(ids.includes(PEOPLE.admin.id) && ids.includes(PEOPLE.approver.id), "the admin and the approver");
    ok(!ids.includes(PEOPLE.accountant.id) && !ids.includes(PEOPLE.manager.id) && !ids.includes(J.offAdmin), "never the accountant, a manager without the switches, an admin turned off");
    same(list[0].profileId, PEOPLE.approver.id, "usual first");
    same([list[0].usual, list[0].usualFor], [true, [J.project.number]], "the job's last approver");
    ok(list.every((a) => !("email" in a) && (a.phone === null || /^\+1[2-9][0-9]{9}$/.test(a.phone))), "no address, a phone only in E.164");
    await as("admin");
    ok(!(await mm.approvers([J.b1.id])).some((a) => a.profileId === PEOPLE.admin.id), "never the caller");
    await as("accountant");
    const x = await one("select id, version from public.bills where id = $1", [J.b1.id]);
    await refused(() => books.approve({ id: x.id, version: x.version }, "check", null), "42501", "the accountant approves nothing");
  });

  await check("P8 books: Ask - an e-mail queued (one outbox row, amount-free, its own scrub), a text a draft whose sms: link is the database's; the wrong recipients refused 22023", async () => {
    await as("accountant");
    const r = await mm.ask([J.b1.id, J.b2.id], [{ profile: PEOPLE.approver.id, channel: "email" }, { profile: PEOPLE.admin.id, channel: "sms" }], {});
    const mail = r.messages.find((m) => m.channel === "email"), text = r.messages.find((m) => m.channel === "sms");
    same([mail.status, text.status], ["queued", "draft"], "queued and a draft");
    ok(!AMOUNT.test(mail.body + mail.subject) && /invoice #OAK-901/.test(mail.body), "no amount; the invoice number with its #");
    same(text.phone, "+18055550181", "the admin's phone, E.164");
    ok(MM.smsHref(text.phone, text.body) === "sms:+18055550181?&body=" + encodeURIComponent(text.body), "the sms: link from the database's answer");
    const row = await one("select o.kind, o.to_email, o.push_result, o.email_wanted, m.body = app.scrub_money(m.body) as scrubbed from public.notifications_outbox o join public.money_messages m on m.id = o.money_message_id where m.id = $1", [mail.id]);
    same([row.kind, row.to_email, row.push_result, row.email_wanted, row.scrubbed], ["approval_request", "approver@schema-check.test", "e-mail only", true, true], "the outbox row");
    J.mail = mail.id;
    J.text = text.id;
    await as("admin");
    for (const who of [PEOPLE.accountant.id, PEOPLE.manager.id, J.offAdmin]) {
      const e = await refused(() => mm.ask([J.b1.id], [{ profile: who, channel: "email" }], {}), "22023", "not an approver");
      ok(/^that person does not approve payments/.test(e.message), e.message);
    }
    const e = await refused(() => mm.ask([J.b1.id], [{ profile: PEOPLE.admin.id, channel: "email" }], {}), "22023", "oneself");
    ok(/you cannot ask yourself/.test(e.message), e.message);
    // I sent it: the draft becomes sent (an approval text stamps nothing)
    await as("accountant");
    const s = await mm.textSent(J.text, true);
    same(s.status, "sent", "I sent it");
  });

  await check("P8 books: no amount (S5) - a typed amount in a one-off text or a template refused in the database's words; the six defaults pass and are their own scrub", async () => {
    await as("accountant");
    const e1 = await refused(() => mm.ask([J.b3.id], [{ profile: PEOPLE.approver.id, channel: "email" }], { body: "Please approve the $4,500.00 bill" }), "22023", "a typed amount");
    ok(/^the e-mail: the text holds an amount: a money message never carries one$/.test(e1.message), e1.message);
    const e2 = await refused(() => mm.ask([J.b3.id], [{ profile: PEOPLE.approver.id, channel: "sms" }], { smsBody: "see www.madeup.example/pay" }), "22023", "a link");
    ok(/^the text: the text holds a link or an address/.test(e2.message), e2.message);
    const t = (await mm.templates()).find((x) => x.key === "check_ready" && x.channel === "email");
    const e3 = await refused(() => mm.saveTemplate(t, t.subject, "Your check for 12,500.00 is ready"), "22023", "a template with an amount");
    same(e3.message, "the text holds an amount: a money message never carries one", "the database's sentence");
    for (const r of await sql("select key, channel, app.money_template_problem(key, channel, subject, body) as p, app.scrub_money(body) = body as same from public.message_templates")) {
      same([r.p, r.same], [null, true], r.key + "/" + r.channel);
    }
    const p = await mm.preview("approval_request", "email", null, null, {});
    ok(/invoice #1043/.test(p.body) && !AMOUNT.test(p.body) && p.problem === "", "the sample: invoice #1043 intact, no amount");
  });

  await check("P8 books: Tell - no e-mail on file refused; an e-mail queued, a text drafted; I sent it stamps told 'text message'; a bill-less payment only to its payee (I36)", async () => {
    await as("accountant");
    const e = await refused(() => mm.tell([J.pElm], "email", {}), "22023", "no e-mail on file");
    ok(/has no e-mail address that can be used/.test(e.message), e.message);
    const t = await mm.tell([J.pElm], "sms", {});
    same([t.messages[0].status, t.messages[0].phone], ["draft", "+18055550184"], "a text to the contact's mobile");
    await mm.textSent(t.messages[0].id, true);
    same((await one("select pickup_told_how from public.payments where id = $1", [J.pElm])).pickup_told_how, "text message", "told by text");
    const m = await mm.tell([J.pOak], "email", {});
    same(m.messages[0].status, "queued", "queued for the reminder PC");
    J.pickup = m.messages[0].id;
    await refused(() => mm.tell([J.pWalk], "email", {}), "22023", "a bill with no contact: whose?");
    const bad = await refused(() => mm.tell([J.pWalk], "email", { contactId: J.oak }), "22023", "another vendor's contact");
    ok(/not this bill's payee/.test(bad.message), bad.message);
  });

  await check("P8 books: I36 on the page - a bill with no contact whose payee a client shares (the client's id the lower): the page picks the sub, never the client, and the database takes the page's pick", async () => {
    const MH = await site("map/books-home.js");
    await sql("reset role");
    // the client first (the lower id), then the sub of the same company
    const client = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Hal Hilltop', 'Madeup Hilltop Roofing', 'client', 'hal.client@example.com', '(805) 555-0185') returning id")).id;
    const sub = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Ida Hilltop', 'Madeup Hilltop Roofing', 'subcontractor', 'ida.sub@example.com', '(805) 555-0186') returning id")).id;
    const hb = await bill(null, "Madeup Hilltop Roofing", "HILL-890", 175, true);
    const hp = await payment(hb, "TEST-8B4", "Madeup Hilltop Roofing");
    await as("accountant");
    const H = await homeRepo.loadHome(await me("accountant"));
    const g = H.tellGroups.find((x) => x.paymentIds.map(String).includes(String(hp)));
    ok(g, "the payment is to tell");
    ok(H.desk.links.contacts.get(String(client)).kind === "client", "the desk reads the contacts' kind (repo/books.js CONTACT_COLS)");
    const who = MH.pickupContact(g, H.desk.links);
    same([who.source, who.contactId, who.email], ["name", sub, "ida.sub@example.com"], "the sub, not the lower-id client");
    const no = await refused(() => mm.tell([hp], "email", { contactId: client }), "22023", "the client is never the payee");
    ok(/not this bill's payee/.test(no.message), no.message);
    const m = await mm.tell([hp], "email", { contactId: who.contactId });
    same(m.messages[0].status, "queued", "the database takes the page's pick");
  });

  await check("P8 books: as the agents account - take answers its very keys (money rows masked); a bill approved first sets its ask aside; sent makes a pick-up told by e-mail; the checks feed stands down meanwhile", async () => {
    // the checks feed stands down while her e-mail about the payment waits (the automatic agent switched on for this)
    await sql("reset role");
    const was = (await one("select agents_checks_enabled as on from public.settings where id = 1")).on;
    await sql("update public.settings set agents_checks_enabled = true where id = 1");
    await as("agents");
    const feed = await raw("agents_checks_to_tell", { p_day: null, p_max_age_days: 30 });
    const keys = (feed.items || []).map((x) => x.key);
    ok(keys.includes("check:" + J.pWalk), "an untold check is in the feed: " + keys.join(","));
    ok(!keys.includes("check:" + J.pOak), "the one her e-mail is about is not, while it waits");
    await sql("reset role");
    await sql("update public.settings set agents_checks_enabled = $1 where id = 1", [was]);
    // a bill of the queued ask approved first
    await as("approver");
    for (const id of [J.b1.id, J.b2.id]) {
      const b = await one("select id, version from public.bills where id = $1", [id]);
      await books.approve({ id: b.id, version: b.version }, "check", null);
    }
    await as("agents");
    const got = await raw("agents_outbox_take", { p_limit: 100 });
    const items = got.items || [];
    const mine = await sql("select id, money_message_id from public.notifications_outbox where money_message_id in ($1, $2)", [J.mail, J.pickup]);
    const byMsg = Object.fromEntries(mine.map((r) => [String(r.money_message_id), r.id]));
    const pick = items.find((x) => String(x.id) === String(byMsg[String(J.pickup)]));
    ok(pick, "the pick-up e-mail is taken");
    same(Object.keys(pick).sort(), ["attempts", "body", "created_at", "id", "kind", "masked", "subject", "submission_id", "task_id", "to_email", "to_name", "to_profile_id"], "the very keys");
    same([pick.kind, pick.masked, pick.to_name], ["payment_pickup", true, "Sam Oakmade"], "a money row, masked, to the contact by name");
    ok(!items.some((x) => String(x.id) === String(byMsg[String(J.mail)])), "the ask about bills approved meanwhile is not taken");
    await as("accountant");
    const ask = (await mm.messages(await me("accountant"))).find((m) => m.id === J.mail);
    same([ask.status, ask.statusNote], ["not_sent", "skipped: every bill in it was approved, voided or deleted meanwhile"], "set aside, said why");
    await as("agents");
    await raw("agents_outbox_done", { p_id: pick.id, p_ok: true, p_error: null, p_final: false });
    const p = await one("select pickup_told_how, pickup_told_by from public.payments where id = $1", [J.pOak]);
    same([p.pickup_told_how, p.pickup_told_by], ["email", "Ace Accountant (e-mail by DCR Agents 2)"], "told by e-mail, by the PC on her behalf");
    await as("accountant");
    same((await mm.messages(await me("accountant"))).find((m) => m.id === J.pickup).status, "sent", "the message is sent");
  });

  await check("P8 books: the limits - the 4th e-mail a company day about one bill to one approver is PT429 in the database's words; the page keeps them", async () => {
    await as("accountant");
    for (let i = 0; i < 3; i++) {
      await mm.ask([J.b3.id], [{ profile: PEOPLE.approver.id, channel: "email" }], {});
      // older than the 10 minutes of "already" (the audit trigger keeps created_at: moved with the triggers off)
      await sql("reset role");
      await sql("set session_replication_role = replica");
      await sql("update public.money_messages set created_at = now() - interval '11 minutes' where kind = 'approval_request' and $1 = any (bill_ids)", [J.b3.id]);
      await sql("set session_replication_role = origin");
      await as("accountant");
    }
    const e = await refused(() => mm.ask([J.b3.id], [{ profile: PEOPLE.approver.id, channel: "email" }], {}), "PT429", "the 4th");
    ok(/^Abe Approver was already e-mailed 3 times today about Madeup Oakmade Framing, invoice #OAK-903, job .+: call instead$/.test(e.message), e.message);
    same(MM.messageError(e, () => "Too many attempts."), e.message[0].toUpperCase() + e.message.slice(1) + ".", "the page says the database's sentence");
    const again = await mm.ask([J.b3.id], [{ profile: PEOPLE.approver.id, channel: "sms" }], {});
    same(again.messages[0].status, "draft", "a text still goes");
  });

  await check("P8 books: templates - save at the version shown (PT409 otherwise), unchanged, reset; preview with the job's bills; reminder_pc_status never names the PC", async () => {
    await as("accountant");
    let t = (await mm.templates()).find((x) => x.key === "cash_ready" && x.channel === "sms");
    const saved = await mm.saveTemplate(t, null, "Hi {{firstName}}, your payment is at the office.");
    same([saved.version, saved.isDefault], [t.version + 1, false], "saved");
    await refused(() => mm.saveTemplate(t, null, "Hi {{firstName}}, stale."), "PT409", "at a version no longer there");
    same((await mm.saveTemplate(saved, null, saved.body)).unchanged, true, "unchanged");
    const back = await mm.resetTemplate(saved);
    same(back.isDefault, true, "reset");
    const pv = await mm.preview("approval_request", "email", null, null, { billIds: [J.b3.id], toProfileId: PEOPLE.approver.id });
    ok(/^Hi Abe,/.test(pv.body) && /Madeup Oakmade Framing · invoice #OAK-903/.test(pv.body) && !AMOUNT.test(pv.body), pv.body.slice(0, 160));
    const pc = await mm.pcStatus();
    same(Object.keys(pc).sort(), ["notTaking", "paused", "seenMinutesAgo"], "three keys, never a name");
  });

  await check("P8 books: drift - the demo database (tools/fake/p8-books.js) has the real columns and the RPCs' arguments", async () => {
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p8-books.js")).href);
    const NS = globalThis.DCR2Fake;
    for (const [name, want] of Object.entries(NS.p8BooksSigs)) {
      same(want, (catalog.functions[name] || [])[0] ? catalog.functions[name][0].args.map((a) => a.name) : null, name);
    }
    const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["money_messages", "message_templates"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
    }
    ok("money_message_id" in engine.COLS.notifications_outbox && "to_name" in engine.COLS.notifications_outbox, "the outbox's money columns");
    // the demo's defaults are the migration's six, word for word
    for (const r of await sql("select key, channel, subject, body from public.message_templates t where t.version = 1 or true")) {
      const d = await one("select subject, body from app.money_template_default($1, $2)", [r.key, r.channel]);
      same(NS.p8MoneyDefault(r.key, r.channel), { subject: d.subject, body: d.body }, "the default " + r.key + "/" + r.channel);
    }
  });

  client.from = origFrom;
  client.rpc = origRpc;
}

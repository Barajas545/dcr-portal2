/* Ready to pick up - tell them (the Books program, release B part 2a; design-portal §3.5 with the build plan's I20-I23,
   I36 and §4.5): the Accounting page's "Not told yet" and "Told, waiting for pickup" rows, shared by the pages that
   tell a payee (books-home.html now; accounting.html with release B's P5).

   * groupHtml(g, ctx)       one payee's checks (or cash) nobody was told about - the payee and picture, "Check #1043" /
     "Cash", the job, the day written, the amount (only with the prices switch), how to reach them, the last pick-up
     message's state, and for a money editor the four ways:
       [E-mail (automatic)]  rpc tell_payee(…, 'email'): queued for the reminder PC - the told stamp lands when it reports
                             it sent ("Told … (e-mail by DCR Agents 2)");
       [Text (by hand)]      rpc tell_payee(…, 'sms'): a draft whose number and body the database answers - [Open the text]
                             (an sms: link, only for an E.164 number), [Copy the text] with the number shown, [I sent it]
                             (rpc money_text_sent: told "text message" at once) and [Not sent];
       [Call]                the tel: link, then [Told by phone] (rpc payment_told 'phone', each payment);
       [In person]           rpc payment_told 'in person'.
     Who it goes to is the database's rule (I20 / I36): the bill's vendor contact; only for a bill with none, the quote's
     vendor contact or a contact whose company or name IS the payee (map/books-home.js pickupContact - never a loose
     guess). No e-mail and no phone: [Add phone / e-mail] (the contact card) when there is a contact to open;
   * waitingHtml(p, ctx)     told and not picked up yet: who told them, how and when, and [Picked up] (the day and who
     collected it: rpc payment_picked_up through repo/checks.js);
   * textStep(msg, o)        the hand-text box (a DOM node, every word as text): also the Ask dialog's and the drafts';
   * wireTell(root, ctx)     the buttons, then ctx.onChanged() so the page reads everything again.
   Every database word is escaped (h) or set as text; the sms: href is set as an attribute of a node, never written into
   markup. Nothing here approves anything. */

import { esc, toast, confirmBox, errorText, D, can, seesPrices } from "./shell.js";
import { avatarHtml, openCard } from "./avatar.js";
import * as mm from "../repo/money-messages.js";
import * as books from "../repo/books.js";
import * as checks from "../repo/checks.js";
import { pickupContact, toldHowWords } from "../map/books-home.js";
import { smsHref, telHref, phoneWords, messageStatus, messageError, CHANNEL_LABELS, toMessage } from "../map/money-messages.js";
import { fmtMoney, plural, shortDay } from "../map/books.js";

const h = esc;

function pieces(g) {
  const p = g.payments || [];
  const nums = p.map((x) => x.checkNumber).filter(Boolean);
  const what = g.isCash ? (p.length > 1 ? p.length + " cash payments" : "Cash")
    : nums.length ? (nums.length > 1 ? "Checks #" + nums.join(", #") : "Check #" + nums[0]) : plural(p.length, "check", "checks");
  const days = Array.from(new Set(p.map((x) => shortDay(x.writtenDate)).filter(Boolean)));
  return { what, days: days.join(", "), jobs: (g.projectLabels || []).join("; ") };
}

/** The contacts row of `id` from the desk's links (null when not read). */
function contactOf(links, id) {
  return id !== null && id !== undefined && links && links.contacts ? links.contacts.get(String(id)) || null : null;
}

/** One "Not told yet" group (see the header). ctx: {me, links, pc}. */
export function groupHtml(g, ctx) {
  const c = ctx || {};
  const prices = seesPrices(c.me);
  const money = can(c.me, "money");
  const who = pickupContact(g, c.links);
  const pc = pieces(g);
  const shown = who.contact || contactOf(c.links, g.vendorContactId);
  let s = '<div class="ck-tell bh-tell" data-group="' + h(g.key) + '"><div class="top"><div>' +
    '<span class="ck-payee"><span class="av-name">' + avatarHtml(shown, { size: 28, name: g.payee, edit: can(c.me, "contacts") }) +
    '<span class="av-t">' + h(g.payee || "(no payee)") + "</span></span></span>" +
    '<div class="ck-for">' + h(pc.what) + (pc.days ? " · " + h(pc.days) : "") + '<span class="ck-method' + (g.isCash ? " cash" : "") + '">' + (g.isCash ? "cash" : "check") + "</span></div>" +
    (pc.jobs ? '<div class="ck-for">' + h(pc.jobs) + "</div>" : "") + "</div>" +
    (prices ? '<div class="ck-payee">' + h(fmtMoney(g.amount)) + "</div>" : "") + "</div>";
  // how they are reached (the database's rule decides who; this says what is on file)
  if (!who.email && !who.phone) {
    s += '<div class="ck-how none">No e-mail or phone on file for them.</div>';
    const open = who.contact && !who.contact.deleted_at ? who.contact : null;
    const edit = !!open && can(c.me, "contacts");
    s += '<div class="ck-none-note">The payment is ready and waiting. ' +
      (edit ? "Add their phone or e-mail, or tell them in person." : "Add the contact in DCR Desktop 2, or tell them in person.") + "</div>" +
      (edit ? '<div class="ck-acts"><button type="button" class="ac-b" data-reach="' + h(open.id) + '">Add phone / e-mail</button></div>' : "");
  } else {
    const src = who.source === "bill" ? "The bill's vendor in Contacts" : who.source === "quote" ? "From the quote this bill is billed against" : "Matched by name in Contacts";
    s += '<div class="ck-how certain">' + h(src + (shown ? " (" + (shown.company || shown.name || "") + ")" : "") + ".") + "</div>" +
      '<div class="ck-none-note">' + (who.email ? "E-mail: " + h(who.email) : "") + (who.email && who.phone ? " · " : "") + (who.phone ? "Phone: " + h(who.phone) : "") + "</div>";
  }
  if (g.lastMessage) {
    const st = messageStatus(g.lastMessage);
    s += '<div class="bh-st ' + h(st.cls) + '">' + h(st.text) + "</div>";
  }
  if (money) {
    s += '<div class="ck-acts bh-acts">' +
      '<button type="button" class="ac-b go" data-tell="email" data-g="' + h(g.key) + '"' + (who.email ? "" : " disabled title=\"No e-mail on file\"") + ">" + h(CHANNEL_LABELS.email) + "</button>" +
      '<button type="button" class="ac-b" data-tell="sms" data-g="' + h(g.key) + '"' + (who.phone ? "" : " disabled title=\"No phone on file\"") + ">" + h(CHANNEL_LABELS.sms) + "</button>" +
      '<button type="button" class="ac-b" data-tell="call" data-g="' + h(g.key) + '"' + (who.phone ? "" : " disabled") + ">Call</button>" +
      '<button type="button" class="ac-b" data-tell="person" data-g="' + h(g.key) + '">In person</button>' +
      '<span class="ac-msg" data-tellmsg="' + h(g.key) + '" role="status"></span></div>' +
      '<div class="bh-call" data-call="' + h(g.key) + '" hidden></div>';
  } else {
    s += '<div class="ac-note">Only an admin, or a manager or accountant with financials, tells a payee.</div>';
  }
  return s + "</div>";
}

/** "Told, waiting for pickup" (see the header). */
export function waitingHtml(p, ctx) {
  const c = ctx || {};
  const prices = seesPrices(c.me);
  const shown = contactOf(c.links, p.vendorContactId);
  return '<div class="ck-tell bh-tell" data-wait="' + h(p.paymentId) + '"><div class="top"><div>' +
    '<span class="ck-payee"><span class="av-name">' + avatarHtml(shown, { size: 28, name: p.payee, edit: can(c.me, "contacts") }) +
    '<span class="av-t">' + h(p.payee || "(no payee)") + "</span></span></span>" +
    '<div class="ck-for">' + (p.isCash ? "Cash" : "Check #" + h(p.checkNumber)) + " · " + h(shortDay(p.paidDate)) + (p.projectLabel ? " · " + h(p.projectLabel) : "") + "</div>" +
    '<div class="ck-for">Told ' + h(shortDayTs(p.toldAt)) + " " + h(toldHowWords(p.toldHow)) + (p.toldBy ? " (" + h(p.toldBy) + ")" : "") + "</div></div>" +
    (prices ? '<div class="ck-payee">' + h(fmtMoney(p.amount)) + "</div>" : "") + "</div>" +
    (can(c.me, "money") ? '<div class="ck-acts"><button type="button" class="ac-b go" data-picked="' + h(p.paymentId) + '">&#10003; Picked up</button>' +
      '<span class="ac-msg" data-pickmsg="' + h(p.paymentId) + '" role="status"></span></div>' : "") + "</div>";
}

function shortDayTs(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
}

/* ── the hand-text box ────────────────────────────────────────────────── */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/** The box of one hand text (a money message the database answered: its number and body). o: {onDone(msg)}. Its body
    is set as text; its [Open the text] link carries an sms: href only for an E.164 number. */
export function textStep(msg, opts) {
  const o = opts || {};
  const m = msg && msg.billIds ? msg : toMessage(msg);
  const box = el("div", "bh-text");
  box.setAttribute("data-text", String(m.id));
  box.appendChild(el("div", "bh-text-h", "Text " + (m.toName || "them") + (m.phone ? " · " + phoneWords(m.phone) : "")));
  const body = el("div", "bh-text-b", m.body);
  box.appendChild(body);
  const acts = el("div", "bh-acts");
  const href = smsHref(m.phone, m.body);
  let open;
  if (href) {
    open = el("a", "ac-b go", "Open the text");
    open.setAttribute("href", href);
    open.setAttribute("data-act", "open");
  } else {
    open = el("button", "ac-b", "Open the text");
    open.setAttribute("type", "button");
    open.setAttribute("data-act", "open");
    open.disabled = true;
    open.title = "No mobile number in the shape a phone can text";
  }
  const copy = el("button", "ac-b", "Copy the text");
  copy.setAttribute("type", "button");
  copy.setAttribute("data-act", "copy");
  const sent = el("button", "ac-b go", "I sent it");
  sent.setAttribute("type", "button");
  sent.setAttribute("data-act", "sent");
  const not = el("button", "ac-b", "Not sent");
  not.setAttribute("type", "button");
  not.setAttribute("data-act", "notsent");
  [open, copy, sent, not].forEach((b) => acts.appendChild(b));
  box.appendChild(acts);
  const say = el("div", "ac-msg");
  say.setAttribute("role", "status");
  box.appendChild(say);
  box.appendChild(el("div", "ac-note", "On a computer without Phone Link, copy the text and send it from your phone to " +
    (m.phone ? phoneWords(m.phone) : "their number") + ". Press “I sent it” once it has gone."));
  const done = (x, words) => {
    acts.textContent = "";
    say.textContent = words;
    say.className = "ac-msg ok";
    if (typeof o.onDone === "function") o.onDone(x);
  };
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(m.body);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy the text"; }, 1500);
    } catch (e) {
      say.textContent = "Could not copy it: select the text above and copy it by hand.";
      say.className = "ac-msg err";
    }
  });
  const mark = async (yes) => {
    sent.disabled = true; not.disabled = true;
    try {
      const x = await mm.textSent(m.id, yes);
      done(x, yes ? "Marked sent ✓ (by hand)" : "Marked not sent.");
    } catch (e) {
      sent.disabled = false; not.disabled = false;
      say.textContent = messageError(e, errorText);
      say.className = "ac-msg err";
    }
  };
  sent.addEventListener("click", () => mark(true));
  not.addEventListener("click", () => mark(false));
  return box;
}

/* ── the buttons ──────────────────────────────────────────────────────── */

function sayOn(root, attr, key, text, bad) {
  const n = Array.from(root.querySelectorAll("[" + attr + "]")).find((x) => x.getAttribute(attr) === String(key));
  if (!n) { if (text) toast(text, bad ? "error" : "ok"); return; }
  n.textContent = text || "";
  n.className = "ac-msg" + (bad ? " err" : "");
}

/** Wire the tell rows inside `root`. ctx: {me, links, groups (tellGroups), waiting (atOffice), today, sheet (books-nav
    openSheet), onChanged()}. */
export function wireTell(root, ctx) {
  const c = ctx || {};
  const groupOf = (key) => (c.groups || []).find((g) => g.key === key) || null;
  const changed = () => (typeof c.onChanged === "function" ? c.onChanged() : null);
  root.querySelectorAll("[data-reach]").forEach((b) => b.addEventListener("click", () => {
    openCard(b.getAttribute("data-reach"), { me: c.me, onSaved: changed }).catch((e) => toast(errorText(e), "error"));
  }));
  root.querySelectorAll("[data-tell]").forEach((b) => b.addEventListener("click", async () => {
    const g = groupOf(b.getAttribute("data-g"));
    if (!g) return;
    const how = b.getAttribute("data-tell");
    const who = pickupContact(g, c.links);
    const say = (t, bad) => sayOn(root, "data-tellmsg", g.key, t, bad);
    if (how === "call") {
      const box = Array.from(root.querySelectorAll("[data-call]")).find((x) => x.getAttribute("data-call") === g.key);
      if (!box) return;
      box.textContent = "";
      const tel = telHref(who.phone);
      if (tel) {
        const a = el("a", "ac-b", "Call " + who.phone);
        a.setAttribute("href", tel);
        box.appendChild(a);
      }
      const told = el("button", "ac-b go", "✓ Told by phone");
      told.setAttribute("type", "button");
      told.addEventListener("click", () => markAll(g, "phone", told, say, changed));
      box.appendChild(told);
      box.hidden = false;
      return;
    }
    if (how === "person") {
      const sure = await confirmBox("Mark " + (g.payee || "the payee") + " told in person that " + (g.isCash ? "the cash is" : "the check is") + " ready?",
        { title: "Told in person", okText: "Told in person" });
      if (sure) await markAll(g, "in person", b, say, changed);
      return;
    }
    b.disabled = true;
    say(how === "email" ? "Queuing the e-mail…" : "Writing the text…");
    let r;
    try {
      r = await mm.tell(g.paymentIds, how, { contactId: who.contactId });
    } catch (e) {
      b.disabled = false;
      say(messageError(e, errorText), true);
      return;
    }
    const m = r.messages[0];
    if (how === "email") {
      toast(m && m.already ? "That e-mail was queued a moment ago: it is not sent twice." : "E-mail queued: the reminder PC sends it, and they are marked told when it has gone.", "ok");
      changed();
      return;
    }
    // a text: the database's number and body, in a sheet
    if (!m) { changed(); return; }
    const sh = typeof c.sheet === "function" ? c.sheet({ title: "Text " + (m.toName || g.payee || "them"), onClose: changed }) : null;
    if (sh && sh.body) {
      sh.body.appendChild(textStep(m, { onDone: () => { setTimeout(() => sh.close(), 900); } }));
    } else {
      changed();
    }
  }));
  root.querySelectorAll("[data-picked]").forEach((b) => b.addEventListener("click", () => pickedUp(b.getAttribute("data-picked"), c, root)));
}

/* payment_told(how) on every payment of the group (versioned; a PT409 reads everything again) */
async function markAll(g, how, btn, say, changed) {
  btn.disabled = true;
  let n = 0;
  for (const p of g.payments) {
    try { await books.markTold(p, how); n++; } catch (e) {
      btn.disabled = false;
      say(errorText(e), true);
      if (e && (e.code === "PT409" || e.status === 409) && typeof changed === "function") changed();
      return;
    }
  }
  toast("Marked told (" + how + "): " + plural(n, "payment", "payments") + ".", "ok");
  if (typeof changed === "function") changed();
}

/* [Picked up]: the day (today, or back to the day it was written) and who collected it */
async function pickedUp(pid, c, root) {
  const p = (c.waiting || []).find((x) => String(x.paymentId) === String(pid));
  if (!p) return;
  const M = D().modal;
  if (typeof M !== "function") return;
  const today = c.today || "";
  const v = await M({
    title: "Picked up", message: (p.payee || "The payee") + " collected " + (p.isCash ? "the cash" : "check #" + p.checkNumber) + ".",
    okText: "Picked up",
    fields: [{ name: "d", label: "When did they collect it?", type: "date", value: today }, { name: "n", label: "Who collected it (optional)", placeholder: "e.g. their foreman" }],
    // the database judges the first day (the day the check was written or recorded); the page says only "not after today"
    validate: (x) => (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.d || "")) ? "Pick the day." : today && x.d > today ? "Not after today." : ""),
  });
  if (!v) return;
  try {
    await checks.pickedUp(p, true, { date: v.d, note: v.n });
  } catch (e) {
    sayOn(root, "data-pickmsg", pid, errorText(e), true);
    return;
  }
  toast("Marked picked up.", "ok");
  if (typeof c.onChanged === "function") c.onChanged();
}

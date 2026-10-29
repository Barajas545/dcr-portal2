/* The money messages' words and rules on the page side (the Books program, release B part 2a; the build plan's I13-I23,
   I34-I36, §4.4 "Message placeholders" and §4.5 "Texts by hand"; DCR Desktop 2 migration 20261030000400_money_messages,
   docs/DATABASE.md §34). The DATABASE IS THE ONLY RENDERER (I16): nothing here fills a placeholder - a message is
   rendered, cleaned and scrubbed by app.money_render / app.money_safe_value / app.scrub_money, and the page shows the
   text the database answered (preview_message_template, ask_for_approval, tell_payee).

   * TEMPLATE_KEYS / CHANNELS / TEMPLATE_LABELS / CHANNEL_LABELS   approval_request | check_ready | cash_ready, e-mail
     (sent by itself from the reminder PC) | text (sent by hand from her own phone);
   * PLACEHOLDERS[key]          the camelCase allow-list - equal to app.money_template_vars(key) (tests and
     tools/schema-check-p8-books.mjs compare them); PLACEHOLDER_WORDS what each one becomes; chipText(name) what a chip
     inserts ("#{{checkNumber}}" and "#{{invoiceNumber}}" carry their "#": the database refuses a number without it);
   * LIMITS                     the sizes the database checks again (bills 1-50, approvers 1-10, payments 1-20, a subject
     200 on one line, an e-mail body 4000, a text 640 - one SMS is 160);
   * lengthProblem(channel, subject, body)   the page's own early word on the sizes only (every other rule - no amount,
     no link or address, only its placeholders, # before a number - is the database's: app.money_template_problem);
   * unknownPlaceholders(key, text)   the editor's "unknown placeholder" warning;
   * smsHref(phone, body)       "sms:+1XXXXXXXXXX?&body=<encoded>" ONLY for a phone of the database's E.164 shape
     (^\+1[2-9][0-9]{9}$): anything else is null and the [Open the text] button stays off (critic). The phone and the
     body come from the database's answer, never from the page;
   * telHref(phone)             "tel:<digits>" of a phone on file, or null;
   * phoneWords(e164)           "(805) 555-0123";
   * messageStatus(m, now)      a money_messages row's state in words, {cls, text}: "E-mail waiting for the reminder PC",
     "e-mail sent ✓ Oct 28 10:44 AM", "not sent: opted out", "text not marked sent yet", "text sent by hand";
   * pcWarning(pc)              reminder_pc_status() in words, or "": not taking / paused / not heard from - text or call
     instead (the PC's name is never said: the database does not answer it);
   * messageError(e, errorText) a refusal in the database's own words (PT429's sentence too, which the shared mapping
     would turn into "too many attempts").

   Pure module: no DOM, no network (node tests import it). No amount, no address and no company name in it (a public
   repository: the database's {{company}} and the requester placeholders say who writes). */

export const TEMPLATE_KEYS = Object.freeze(["approval_request", "check_ready", "cash_ready"]);
export const CHANNELS = Object.freeze(["email", "sms"]);
export const TEMPLATE_LABELS = Object.freeze({
  approval_request: "Ask to approve",
  check_ready: "Check ready to pick up",
  cash_ready: "Cash ready to pick up",
});
export const CHANNEL_LABELS = Object.freeze({ email: "E-mail (automatic)", sms: "Text (by hand)" });
export const KIND_OF_KEY = Object.freeze({ approval_request: "approval_request", check_ready: "payment_pickup", cash_ready: "payment_pickup" });

const EVERY = ["company", "requesterName", "requesterFirstName", "requesterPhone", "requesterEmail"];
/** app.money_template_vars(key): the placeholders each template may use (no amount placeholder anywhere). */
export const PLACEHOLDERS = Object.freeze({
  approval_request: Object.freeze(EVERY.concat(["approverFirstName", "approverName", "billsPhrase", "billList", "link"])),
  check_ready: Object.freeze(EVERY.concat(["firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate", "checkNumber"])),
  cash_ready: Object.freeze(EVERY.concat(["firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate"])),
});
export const PLACEHOLDER_WORDS = Object.freeze({
  company: "the company's name",
  requesterName: "your name",
  requesterFirstName: "your first name",
  requesterPhone: "your phone, on a line of its own",
  requesterEmail: "your e-mail",
  approverFirstName: "the approver's first name",
  approverName: "the approver's name",
  billsPhrase: "\"1 bill is\" / \"3 bills are\"",
  billList: "one line per bill: vendor · invoice # · job · due day · its DCR Portal link",
  link: "the DCR Portal link (the bill, or Home for several)",
  firstName: "the payee's first name",
  name: "the payee's name",
  payee: "the payee as written on the check",
  projectLabel: "the job",
  invoiceNumber: "their invoice number",
  writtenDate: "the day it was written",
  checkNumber: "the check number",
});
/** The chips' one rule about the links: said beside them in the editor. */
export const LINK_RULE = "No link, e-mail address or phone number may be typed into a message: the only link is {{link}} (and the ones in {{billList}}), " +
  "the only address and phone {{requesterEmail}} and {{requesterPhone}}. No amount either - the approver sees it on the bill page.";

/** What a chip inserts: the two numbers carry their "#" (the database refuses "invoice {{invoiceNumber}}"). */
export function chipText(name) {
  return name === "checkNumber" || name === "invoiceNumber" ? "#{{" + name + "}}" : "{{" + name + "}}";
}

/** `text` with `token` put in place of the selection [start, end) -> {text, at} (the caret after it). */
export function insertAt(text, start, end, token) {
  const s = String(text == null ? "" : text);
  const a = Math.max(0, Math.min(s.length, Number.isFinite(start) ? start : s.length));
  const b = Math.max(a, Math.min(s.length, Number.isFinite(end) ? end : a));
  return { text: s.slice(0, a) + token + s.slice(b), at: a + token.length };
}

export const LIMITS = Object.freeze({ bills: 50, approvers: 10, payments: 20, subject: 200, body: 4000, sms: 640, smsOne: 160, days: 45 });

/** The sizes only (the database judges the rest): "" when they fit. */
export function lengthProblem(channel, subject, body) {
  const b = String(body == null ? "" : body);
  if (!b.trim()) return "The message is empty.";
  if (channel === "email") {
    const s = String(subject == null ? "" : subject);
    if (!s.trim()) return "An e-mail needs a subject.";
    if (/[\r\n]/.test(s)) return "The subject is one line.";
    if (s.length > LIMITS.subject) return "The subject is at most " + LIMITS.subject + " characters.";
    if (b.length > LIMITS.body) return "The e-mail is at most " + LIMITS.body + " characters.";
    return "";
  }
  if (b.length > LIMITS.sms) return "A text is at most " + LIMITS.sms + " characters.";
  return "";
}

/** "1 text" / "2 texts" (one SMS is 160 characters): the counter under a text box. */
export function smsCount(body) {
  const n = String(body == null ? "" : body).length;
  const parts = n <= LIMITS.smsOne ? 1 : Math.ceil(n / 153);
  return n + " / " + LIMITS.sms + " characters" + (n > LIMITS.smsOne ? " · " + parts + " texts on most phones" : "");
}

/** The placeholders in `text` that `key` does not have ("{{amount}}"). */
export function unknownPlaceholders(key, text) {
  const allowed = PLACEHOLDERS[key] || [];
  const out = [];
  const re = /\{\{([A-Za-z]+)\}\}/g;
  let m;
  while ((m = re.exec(String(text == null ? "" : text)))) if (allowed.indexOf(m[1]) === -1 && out.indexOf(m[1]) === -1) out.push(m[1]);
  return out;
}

/* ── texts by hand (§4.5) ─────────────────────────────────────────────── */

export const E164 = /^\+1[2-9][0-9]{9}$/;

/** The sms: link of a hand text, or null unless the phone is the database's E.164 (+1XXXXXXXXXX). The "?&body=" form
    opens the body on both iOS and Android. */
export function smsHref(phone, body) {
  const p = String(phone == null ? "" : phone);
  if (!E164.test(p)) return null;
  return "sms:" + p + "?&body=" + encodeURIComponent(String(body == null ? "" : body));
}

/** "tel:+18055550123" of a phone on file (digits and a leading + only), or null. */
export function telHref(phone) {
  const s = String(phone == null ? "" : phone).replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
  return (s.match(/\d/g) || []).length >= 7 ? "tel:" + s : null;
}

/** "(805) 555-0123" of "+18055550123"; anything else as it is. */
export function phoneWords(e164) {
  const p = String(e164 == null ? "" : e164);
  return E164.test(p) ? "(" + p.slice(2, 5) + ") " + p.slice(5, 8) + "-" + p.slice(8) : p;
}

/* ── states in words ──────────────────────────────────────────────────── */

const TZ = "America/Los_Angeles";
/** "Oct 28 10:44 AM" (company time) of a timestamp; "" for none. */
export function whenShort(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}
/** "Oct 28" (company time). */
export function dayShort(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
}
/** "just now" / "12 min ago" / "2 h ago" / "3 days ago". */
export function agoWords(v, now) {
  const t = Date.parse(v || "");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round(((now instanceof Date ? now.getTime() : Number(now) || Date.now()) - t) / 60000));
  if (m < 2) return "just now";
  if (m < 60) return m + " min ago";
  const hrs = Math.round(m / 60);
  if (hrs < 36) return hrs + " h ago";
  const days = Math.round(m / 1440);
  return days + (days === 1 ? " day ago" : " days ago");
}

const NOTE_MAX = 160;
function note(v) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > NOTE_MAX ? s.slice(0, NOTE_MAX - 1) + "…" : s;
}

/** A money message (a money_messages row, or an RPC's message answer) in a known shape. */
export function toMessage(r) {
  const x = r || {};
  const pick = (a, b) => (x[a] !== undefined ? x[a] : x[b]);
  const ids = (v) => (Array.isArray(v) ? v.map((n) => String(n)) : []);
  return {
    id: x.id,
    groupId: pick("group_id", "groupId") || null,
    kind: pick("kind", "kind") || "",
    templateKey: pick("template_key", "templateKey") || "",
    channel: x.channel === "sms" ? "sms" : "email",
    byHand: x.channel === "sms",
    billIds: ids(pick("bill_ids", "billIds")),
    paymentIds: ids(pick("payment_ids", "paymentIds")),
    toProfileId: pick("to_profile_id", "toProfileId") || null,
    toContactId: pick("to_contact_id", "toContactId") == null ? null : pick("to_contact_id", "toContactId"),
    toName: String(pick("to_name", "toName") || ""),
    // a text's number: the RPC's answer says it (phone), a row read back carries it (to_address of an sms)
    phone: x.phone || (x.channel === "sms" && x.to_address ? String(x.to_address) : ""),
    subject: x.subject == null ? "" : String(x.subject),
    body: x.body == null ? "" : String(x.body),
    status: String(x.status || ""),
    statusNote: String(pick("status_note", "statusNote") || ""),
    sentAt: pick("sent_at", "sentAt") || null,
    createdAt: pick("created_at", "createdAt") || null,
    createdBy: pick("created_by", "createdBy") || null,
    version: x.version == null ? null : Number(x.version),
    already: !!x.already,
  };
}

/** A message's state in words: {cls: wait | ok | bad | draft | off, text}. */
export function messageStatus(m) {
  const x = m && m.status !== undefined && m.channel !== undefined && m.billIds ? m : toMessage(m);
  const n = note(x.statusNote);
  if (x.channel === "email") {
    if (x.status === "queued") {
      return { cls: "wait", text: "E-mail waiting for the reminder PC" + (/^trying again/i.test(n) ? " — " + n : x.createdAt ? " (since " + whenShort(x.createdAt) + ")" : "") };
    }
    if (x.status === "sent") return { cls: "ok", text: "e-mail sent ✓" + (x.sentAt ? " " + whenShort(x.sentAt) : "") + (n ? " — " + n : "") };
    if (x.status === "not_sent") return { cls: "bad", text: /^not sent/i.test(n) ? n : "not sent" + (n ? ": " + n : "") };
    return { cls: "off", text: x.status || "" };
  }
  if (x.status === "draft") return { cls: "draft", text: "text written — not marked sent yet" };
  if (x.status === "sent") return { cls: "ok", text: "text sent by hand" + (x.sentAt ? " " + whenShort(x.sentAt) : "") };
  if (x.status === "cancelled") return { cls: "off", text: "text not sent" };
  return { cls: "off", text: x.status || "" };
}

/** reminder_pc_status() {seenMinutesAgo, paused, notTaking} in words, or "" when it is sending. */
export function pcWarning(pc) {
  if (!pc || typeof pc !== "object") return "";
  const tail = " Text or call instead, or ask an admin.";
  if (pc.notTaking) return "The reminder PC isn't sending e-mails right now (paused or off): e-mails wait until it is back." + tail;
  if (pc.paused) return "The reminder PC is paused: e-mails wait until an admin resumes it." + tail;
  const m = pc.seenMinutesAgo;
  if (m === null || m === undefined) return "The reminder PC has not been heard from: e-mails wait until it is on." + tail;
  if (Number(m) > 15) return "The reminder PC was last heard from " + (Number(m) >= 120 ? Math.round(Number(m) / 60) + " hours" : m + " minutes") + " ago: e-mails wait until it is back." + tail;
  return "";
}

/** "the bill is void" -> "The bill is void." */
function sentence(t) {
  const s = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const u = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(u) ? u : u + ".";
}

/** A refusal in the database's own words: a limit (PT429) keeps its sentence; anything else as errorText says it. */
export function messageError(e, errorText) {
  if (e && String(e.code) === "PT429" && e.message) return sentence(e.message);
  return typeof errorText === "function" ? errorText(e) : sentence((e && e.message) || "Something went wrong.");
}

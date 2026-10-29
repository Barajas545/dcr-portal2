/* The money messages' reads and writes (the Books program, release B part 2a: the Accounting page, the bill page's
   Ask, the home page's "asked by"; DCR Desktop 2 migration 20261030000400_money_messages, docs/DATABASE.md §34). Every
   read is a plain select under row level security (the financials switch - nothing is asked without it: seesBooks(me)),
   every write one of the migration's RPCs (definers that check the caller first: money editors; an id the caller
   cannot read answers PT404). The database renders every message (I16); recipients come only from stored ids (S6) -
   nothing here ever names an address.

   Reads:
   * messages(me, o)          money_messages of the last o.days (45) days, newest first: who asked whom about which bills
                              or payments, by e-mail or by text, and what became of it (never the body: drafts() has
                              the texts still to send); a database without them yet: null;
   * drafts(me)               my own texts not marked sent yet (status draft): their number and body, as stored - the
                              page's sms: link is built from these, never from what the page typed;
   * templates()              message_templates (key, channel, subject, body, version);
   * approvers(billIds)       rpc money_approvers(p_bill_ids) -> [{profileId, name, firstName, role, hasEmail, phone,
                              usual, usualFor}], usual ones first - never the caller, never an address;
   * pcStatus()               rpc reminder_pc_status() -> {seenMinutesAgo, paused, notTaking} (never the PC's name);
                              a database without it: null;
   * preview(key, channel, subject, body, o)   rpc preview_message_template(...) -> {subject, body, problem}: the text
                              exactly as it would be stored (sample values, or o.billIds / o.paymentIds / o.toProfileId).
   Writes (money editors):
   * ask(billIds, to, o)      rpc ask_for_approval(p_bill_ids, p_to [{profile, channel}], p_subject, p_body, p_sms_body)
                              -> {groupId, messages}: an e-mail is queued for the reminder PC, a text is a draft;
   * tell(paymentIds, channel, o)   rpc tell_payee(p_payment_ids, p_channel, p_contact_id, p_subject, p_body);
   * textSent(messageId, sent)      rpc money_text_sent(p_message_id, p_sent): "I sent it" / "Not sent";
   * saveTemplate(t, subject, body) / resetTemplate(t)   rpc save_message_template / reset_message_template, at the
                              version shown (PT409 otherwise). */

import { db, must, idOf, forbidden, pageAll } from "./_db.js";
import { seesBooks } from "../map/books.js";
import { toMessage, LIMITS } from "../map/money-messages.js";

export const MESSAGE_COLS = "id, group_id, kind, template_key, channel, by_hand, bill_ids, payment_ids, to_profile_id, to_contact_id, to_name, " +
  "status, status_note, sent_at, created_at, created_by, version";
export const DRAFT_COLS = MESSAGE_COLS + ", to_address, body";
export const TEMPLATE_COLS = "key, channel, subject, body, version, updated_at, updated_by";

const SCHEMA = new Set(["42703", "PGRST204", "PGRST202", "42883", "42P01", "PGRST205"]);
/** A database without the money messages yet (a missing table, column or function). */
export function missing(e) { return SCHEMA.has(String((e && e.code) || "")); }

function noBooks() {
  const e = forbidden();
  e.message = "The money messages need the financials switch. Ask an admin.";
  return e;
}
const ids = (list) => Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined && v !== "").map((v) => idOf(v))));
const one = (res) => (Array.isArray(res) ? res[0] || null : res);
const orNull = (v) => (v === undefined || v === "" ? null : v);

/* ── reads ────────────────────────────────────────────────────────────── */

/** money_messages of the last `o.days` days (45), newest first, mapped (toMessage); null without the table yet. */
export async function messages(me, opts) {
  if (!seesBooks(me)) throw noBooks();
  const o = opts || {};
  const days = Math.max(1, Math.min(400, Number(o.days) || LIMITS.days));
  const since = new Date((o.now instanceof Date ? o.now.getTime() : Date.now()) - days * 86400000).toISOString();
  try {
    const rows = await pageAll((cl) => {
      let q = cl.from("money_messages").select(MESSAGE_COLS).gte("created_at", since);
      if (o.kind) q = q.eq("kind", o.kind);
      return q.order("created_at", { ascending: false }).order("id", { ascending: false });
    });
    return (rows || []).map(toMessage);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** My texts still waiting for "I sent it" / "Not sent", oldest first (their number and body as stored). */
export async function drafts(me) {
  if (!seesBooks(me) || !me || !me.id) return [];
  try {
    const rows = await pageAll((cl) => cl.from("money_messages").select(DRAFT_COLS).eq("status", "draft").eq("created_by", me.id)
      .order("created_at", { ascending: true }).order("id", { ascending: true }));
    return (rows || []).map(toMessage);
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** The six templates: [{key, channel, subject, body, version, updatedAt, updatedBy}]; null without the table yet. */
export async function templates() {
  const c = await db();
  try {
    const rows = must(await c.from("message_templates").select(TEMPLATE_COLS).order("key", { ascending: true }).order("channel", { ascending: true })) || [];
    return rows.map(toTemplate);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

export function toTemplate(r) {
  const x = r || {};
  return { key: String(x.key || ""), channel: x.channel === "sms" ? "sms" : "email", subject: x.subject == null ? null : String(x.subject),
    body: String(x.body == null ? "" : x.body), version: x.version == null ? null : Number(x.version),
    updatedAt: x.updated_at || x.updatedAt || null, updatedBy: x.updated_by || x.updatedBy || null,
    isDefault: typeof x.isDefault === "boolean" ? x.isDefault : null, unchanged: !!x.unchanged };
}

/** Who may be asked to approve these bills (every approver but me), usual ones first. */
export async function approvers(billIds) {
  const c = await db();
  const r = must(await c.rpc("money_approvers", { p_bill_ids: ids(billIds) }));
  return (Array.isArray(r) ? r : []).map((a) => ({
    profileId: a.profileId, name: String(a.name || ""), firstName: String(a.firstName || ""), role: String(a.role || ""),
    hasEmail: !!a.hasEmail, phone: a.phone ? String(a.phone) : null, usual: !!a.usual,
    usualFor: Array.isArray(a.usualFor) ? a.usualFor.map(String) : [],
  }));
}

/** The reminder PC as the database last heard it, or null (no such RPC yet, or it could not be read). */
export async function pcStatus() {
  const c = await db();
  try {
    const r = one(must(await c.rpc("reminder_pc_status", {})));
    return r && typeof r === "object" ? { seenMinutesAgo: r.seenMinutesAgo == null ? null : Number(r.seenMinutesAgo), paused: r.paused == null ? null : !!r.paused,
      notTaking: !!r.notTaking } : null;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** A text exactly as it would be stored: {subject, body, problem}. o: {billIds, paymentIds, toProfileId}. */
export async function preview(key, channel, subject, body, opts) {
  const o = opts || {};
  const c = await db();
  const r = one(must(await c.rpc("preview_message_template", {
    p_key: key, p_channel: channel, p_subject: channel === "email" ? orNull(subject) : null, p_body: orNull(body),
    p_bill_ids: o.billIds && o.billIds.length ? ids(o.billIds) : null,
    p_payment_ids: o.paymentIds && o.paymentIds.length ? ids(o.paymentIds) : null,
    p_to_profile_id: o.toProfileId || null,
  }))) || {};
  return { subject: r.subject == null ? null : String(r.subject), body: String(r.body == null ? "" : r.body), problem: r.problem ? String(r.problem) : "" };
}

/* ── writes (money editors; the database decides) ─────────────────────── */

function answer(r) {
  const x = one(r) || {};
  return { groupId: x.groupId || null, messages: (Array.isArray(x.messages) ? x.messages : []).map(toMessage) };
}

/** Ask approvers about bills. to: [{profile, channel: "email" | "sms"}]; o: {subject, body, smsBody} - this message's
    own text (null: the template's). */
export async function ask(billIds, to, opts) {
  const o = opts || {};
  const c = await db();
  const p_to = (to || []).map((x) => ({ profile: String(x.profile), channel: x.channel === "sms" ? "sms" : "email" }));
  return answer(must(await c.rpc("ask_for_approval", { p_bill_ids: ids(billIds), p_to,
    p_subject: orNull(o.subject), p_body: orNull(o.body), p_sms_body: orNull(o.smsBody) })));
}

/** Tell a payee their check or cash is ready. channel: email | sms; o: {contactId (only for a bill with no contact),
    subject, body}. */
export async function tell(paymentIds, channel, opts) {
  const o = opts || {};
  const c = await db();
  return answer(must(await c.rpc("tell_payee", { p_payment_ids: ids(paymentIds), p_channel: channel === "sms" ? "sms" : "email",
    p_contact_id: o.contactId == null || o.contactId === "" ? null : idOf(o.contactId),
    p_subject: channel === "email" ? orNull(o.subject) : null, p_body: orNull(o.body) })));
}

/** "I sent it" (true) / "Not sent" (false) on one of my texts -> the message. */
export async function textSent(messageId, sent) {
  const c = await db();
  return toMessage(one(must(await c.rpc("money_text_sent", { p_message_id: idOf(messageId), p_sent: !!sent }))) || {});
}

/** Save a template as it was shown (its version) -> the template as the database has it. */
export async function saveTemplate(t, subject, body) {
  const c = await db();
  return toTemplate(one(must(await c.rpc("save_message_template", { p_key: t.key, p_channel: t.channel,
    p_subject: t.channel === "email" ? (subject == null ? null : String(subject)) : null, p_body: body == null ? null : String(body), p_version: t.version }))));
}

/** Put a template back to the default, as it was shown. */
export async function resetTemplate(t) {
  const c = await db();
  return toTemplate(one(must(await c.rpc("reset_message_template", { p_key: t.key, p_channel: t.channel, p_version: t.version }))));
}

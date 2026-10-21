/* The personal DCR assistant (BLUEPRINT 3.3.10, migration M6 20261024000100_agents_phase6). The only code that
   talks to the database for My Assistant, the home page's badge and the office's Assistants page.

   M6 answers in the old portal's JSON, so the pages draw what comes back unchanged:
   * page({agenda, rev, summary})  rpc my_assistant(p_agenda, p_rev, p_summary): the person's OWN assistant (the
                                   old GET ?action=assistant): the whole state (+ the agenda: their own hours,
                                   tasks, shoots, hours filed and their jobs' log lines, amounts and client words
                                   scrubbed by the database); {unchanged: true, ...} when p_rev is still the
                                   revision; the badge's {enabled, unread, dueToday} with p_summary; {enabled:
                                   false, message} until the office turns it on
   * op(name, body)                rpc assistant_op(p_op, p_body): the old POST ops (item.add, item.update,
                                   item.complete, item.delete, memory.add, memory.delete, prefs.set, read) ->
                                   {ok, ..., rev}; the office's items are only ever ticked done
   * say(text, clientId)           rpc assistant_say(p_text, p_client_id): a message (1,500 characters, five
                                   waiting at most, the same client id accepted once) -> {ok, message, rev, already?}
   * pcStatus()                    rpc assistant_pc_status() -> {lastSeen, minutesAgo, chatAt, paused}
   * watchMine(uid, cb)            Realtime on the person's own rows (an answer, an item the office added, the
                                   assistant turned on or off)
   The office (an admin, read live by the database):
   * officeList()                  rpc assistant_office_list() -> [{profile_id, name, role, active, on, officeReads,
                                   waiting, unread, dueToday, ...}]
   * officeSet(id, on, reads)      rpc assistant_set(p_profile_id, p_on, p_office_reads)
   * officeView(id)                rpc assistant_office_view(p_profile_id): the chat and the notes ONLY while the
                                   office may read them (chatHidden otherwise), the items always
   * officeItem(id, do, itemId, item)  rpc assistant_office_item(p_profile_id, p_do, p_item_id, p_item): the
                                   office's own reminders, to-dos and events (add | update | complete | delete)
   * watchOffice(cb)               Realtime on what an admin reads of the assistants
   Nothing here decides who may: a refusal is the database's (its message is the old sentence, its hint the
   old code). RPC holds every name this module calls. */
import { db, must } from "./_db.js";

export const RPC = Object.freeze({
  page: "my_assistant",                 // (p_agenda, p_rev, p_summary)
  op: "assistant_op",                   // (p_op, p_body)
  say: "assistant_say",                 // (p_text, p_client_id)
  pcStatus: "assistant_pc_status",      // ()
  officeList: "assistant_office_list",  // ()
  set: "assistant_set",                 // (p_profile_id, p_on, p_office_reads)
  officeView: "assistant_office_view",  // (p_profile_id)
  officeItem: "assistant_office_item",  // (p_profile_id, p_do, p_item_id, p_item)
});
export const OPS = Object.freeze(["item.add", "item.update", "item.complete", "item.delete", "memory.add", "memory.delete", "prefs.set", "read"]);

async function call(name, args) {
  const c = await db();
  return must(await c.rpc(name, args || {}));
}

/* ── the person's own ─────────────────────────────────────────────────── */

export function page(o) {
  const x = o || {};
  return call(RPC.page, { p_agenda: !!x.agenda, p_rev: x.rev === undefined || x.rev === null || x.rev === "" ? null : Number(x.rev),
    p_summary: !!x.summary });
}
export function op(name, body) {
  if (OPS.indexOf(name) === -1) return Promise.reject(Object.assign(new Error("Unknown change: " + name), { code: "22023", status: 400 }));
  return call(RPC.op, { p_op: name, p_body: body && typeof body === "object" ? body : {} });
}
export function say(text, clientId) {
  return call(RPC.say, { p_text: String(text === null || text === undefined ? "" : text), p_client_id: clientId ? String(clientId) : null });
}
export function pcStatus() { return call(RPC.pcStatus); }

export async function watchMine(uid, cb) {
  const live = await import("../live.js");
  /* {lost: true}: the page hears {type: "LOST", table} when a channel goes, and polls at its own pace again */
  const offs = ["assistant_messages", "assistant_items", "assistant_profiles"].map((t) => live.watch(t, "profile_id=eq." + uid, cb, { lost: true }));
  return function () { offs.forEach((off) => { try { off(); } catch (e) { /* */ } }); };
}

/* ── the office (admins) ──────────────────────────────────────────────── */

export async function officeList() {
  const r = await call(RPC.officeList);
  return (r && Array.isArray(r.people) ? r.people : []).filter((p) => p && p.profile_id);
}
export function officeSet(profileId, on, officeReads) {
  return call(RPC.set, { p_profile_id: profileId, p_on: !!on, p_office_reads: officeReads === undefined || officeReads === null ? null : !!officeReads });
}
export function officeView(profileId) { return call(RPC.officeView, { p_profile_id: profileId }); }
export function officeItem(profileId, what, itemId, item) {
  return call(RPC.officeItem, { p_profile_id: profileId, p_do: String(what || ""), p_item_id: itemId ? String(itemId) : null,
    p_item: item && typeof item === "object" ? item : null });
}
export async function watchOffice(cb) {
  const live = await import("../live.js");
  const offs = ["assistant_profiles", "assistant_items", "assistant_messages"].map((t) => live.watch(t, "", cb));
  return function () { offs.forEach((off) => { try { off(); } catch (e) { /* */ } }); };
}

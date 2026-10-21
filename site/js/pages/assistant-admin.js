/* Assistants (the office's side of the personal assistants) — admins only (BLUEPRINT 3.3.10, P6).

   What the old portal did through the DCR server's console (its Assistants tab: turn one on, the office reads,
   the office's own items), straight on the database here (migration M6), so it works while the DCR server is
   off; the database checks every change (an admin, read live):
   - everyone who could have an assistant, with theirs (rpc assistant_office_list);
   - per person: their assistant on / off and whether the office may read their chat and notes
     (rpc assistant_set(p_profile_id, p_on, p_office_reads));
   - one person (rpc assistant_office_view): the office's own reminders, to-dos and events for them (rpc
     assistant_office_item: add, change, delete - the person can only tick these done), their own items and the
     assistant's (shown, never changed from here), and their chat and notes ONLY while their office_reads is on
     (the database answers chatHidden otherwise, and this page says so instead of an empty chat).
   The answers themselves come from DCR Agents 2 on the DCR server (rpc assistant_pc_status says when it last
   looked). Realtime keeps the page current. Everything from the database is drawn as text (el()). */
import { requireAuth, topbar, el, modal, confirm, toast, errorText, fmtDateTime } from "../common2.js";
import * as repo from "../repo/assistant.js";
import { localStamp, itemFields } from "../map/assistant.js";

const $ = (id) => document.getElementById(id);
const S = { me: null, people: [], sel: null, view: null, pc: null, gen: 0, unwatch: null, timer: null, q: "" };
const KIND_WORDS = { reminder: "Reminder", todo: "To-do", event: "Event" };
const BY_WORDS = { office: "the office", assistant: "their assistant", employee: "them" };
const ICON = { reminder: "⏰", todo: "📝", event: "📅" };

/* the database names roles the old way (app.agents_role_label: Admin, Lead, Field, ReadOnly ...); the page says
   Portal 2's words */
const ROLE_WORDS = { ReadOnly: "View only", Agents: "DCR Agents" };
const roleWords = (r) => ROLE_WORDS[r] || String(r || "");
function first(name) { return String(name || "").split(/\s+/)[0] || "them"; }
function personOf(id) { return S.people.find((x) => x.profile_id === id) || null; }
function stampWords(st) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(st || "");
  if (!m) return "";
  const day = new Date(m[1] + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const hr = Number(m[2]);
  return day + " " + ((hr % 12) || 12) + ":" + m[3] + (hr < 12 ? " am" : " pm");
}
function dayWords(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return "";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function whenOf(it) {
  if (it.kind === "todo") return it.due ? "due " + dayWords(it.due) : "no date";
  const end = it.kind === "event" && it.end ? stampWords(it.end) : "";
  return stampWords(it.at) + (end ? " – " + end.replace(/^.* (\d+:\d+ [ap]m)$/, "$1") : "");
}

/* ── the DCR server's line ────────────────────────────────────────────── */
function pcLine() {
  const box = $("aaPc");
  const pc = S.pc;
  if (!pc) { box.textContent = ""; box.className = "aa-pc"; return; }
  const mins = pc.minutesAgo === null || pc.minutesAgo === undefined || pc.minutesAgo === "" ? null : Number(pc.minutesAgo);
  const off = pc.paused || mins === null || mins > 15;
  box.className = "aa-pc " + (pc.paused ? "warn" : off ? "bad" : "ok");
  box.textContent = pc.paused ? "DCR Agents 2 is paused on the DCR server: chats wait until someone resumes it."
    : mins === null ? "No DCR server has reported yet: chats wait until DCR Agents 2 runs."
      : off ? "The DCR server was last seen " + mins + " min ago: chats wait until it is back."
        : "The DCR server answers the chats (last seen " + (mins < 1 ? "just now" : mins + " min ago") + ").";
}

/* ── the list ─────────────────────────────────────────────────────────── */
function drawList() {
  const box = $("aaList");
  box.innerHTML = "";
  const q = S.q.trim().toLowerCase();
  const rows = S.people.filter((p) => !q || String(p.name).toLowerCase().includes(q) || roleWords(p.role).toLowerCase().includes(q));
  const on = S.people.filter((p) => p.on).length;
  $("aaCount").textContent = on + (on === 1 ? " assistant on" : " assistants on") + " · " + S.people.length + " people";
  if (!rows.length) { box.appendChild(el("p", { class: "aa-empty" }, "Nobody matches.")); return; }
  for (const p of rows) {
    const chips = [el("span", { class: "aa-chip " + (p.on ? "on" : "off") }, p.on ? "On" : "Off")];
    if (p.on) chips.push(el("span", { class: "aa-chip " + (p.officeReads ? "reads" : "private") }, p.officeReads ? "The office reads" : "Private"));
    if (p.on && p.waiting) chips.push(el("span", { class: "aa-chip dim" }, "a question waiting"));
    if (p.active === false) chips.push(el("span", { class: "aa-chip dim" }, "sign-in turned off"));
    const btn = el("button", { type: "button", class: "aa-row" + (S.sel === p.profile_id ? " sel" : ""),
      "aria-current": S.sel === p.profile_id ? "true" : null, onclick: () => select(p.profile_id) },
      el("span", { class: "aa-name" }, p.name), el("span", { class: "aa-role" }, roleWords(p.role) + (p.on && p.dueToday ? " · " + p.dueToday + " due today" : "")),
      el("span", { class: "aa-chips" }, chips));
    box.appendChild(btn);
  }
}

/* ── one person ───────────────────────────────────────────────────────── */
async function select(id) {
  S.sel = id;
  drawList();
  const mine = ++S.gen;
  const p = personOf(id);
  const box = $("aaDetail");
  box.hidden = false;
  $("aaPick").hidden = true;
  document.body.classList.add("aa-open");
  box.innerHTML = "";
  box.appendChild(el("p", { class: "aa-muted" }, "Loading " + (p ? p.name : "") + "…"));
  try {
    // a person whose assistant was never turned on has no row: only the switch
    const view = p && (p.on || p.rev) ? await repo.officeView(id).catch((e) => (e && e.code === "PT404" ? null : Promise.reject(e))) : null;
    if (mine !== S.gen) return;
    S.view = view;
    drawDetail();
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches && box.scrollIntoView) box.scrollIntoView({ block: "start" });
  } catch (e) {
    if (mine !== S.gen) return;
    box.innerHTML = "";
    box.appendChild(el("div", { class: "aa-error", role: "alert" }, errorText(e)));
  }
}

function itemLi(it, editable) {
  const tools = editable ? el("span", { class: "aa-tools" },
    el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => editItem(it.kind, it) }, "Edit"),
    el("button", { type: "button", class: "btn btn-ghost btn-sm aa-danger", onclick: () => deleteItem(it) }, "Delete")) : null;
  return el("li", { class: "aa-item" + (it.done ? " done" : "") },
    el("div", { class: "aa-itext" }, el("span", { "aria-hidden": "true" }, (ICON[it.kind] || "") + " "), it.text),
    el("div", { class: "aa-iwhen" }, (KIND_WORDS[it.kind] || "") + " · " + whenOf(it) + (it.done ? " · done" : "") + (it.location ? " · " + it.location : "") +
      (it.by === "office" ? "" : " · added by " + (BY_WORDS[it.by] || "them"))),
    it.notes ? el("div", { class: "aa-inotes" }, it.notes) : null,
    tools);
}

function drawDetail() {
  const p = personOf(S.sel);
  const v = S.view;
  const box = $("aaDetail");
  box.innerHTML = "";
  if (!p) { box.hidden = true; $("aaPick").hidden = false; return; }
  const name = first(p.name);
  box.appendChild(el("button", { type: "button", class: "btn btn-ghost btn-sm aa-back",
    onclick: () => { box.hidden = true; $("aaPick").hidden = false; document.body.classList.remove("aa-open"); S.sel = null; drawList(); } }, "‹ Everyone"));
  box.appendChild(el("h2", { class: "aa-h" }, p.name, el("span", { class: "aa-muted" }, " · " + roleWords(p.role))));
  const on = !!p.on;
  const reads = p.officeReads !== false;
  const onBox = el("input", { type: "checkbox", id: "aaOn", checked: on, disabled: p.active === false && !on });
  const readsBox = el("input", { type: "checkbox", id: "aaReads", checked: reads, disabled: !on });
  onBox.addEventListener("change", () => setSwitch(p, onBox.checked, reads, onBox));
  readsBox.addEventListener("change", () => setSwitch(p, on, readsBox.checked, readsBox));
  box.appendChild(el("div", { class: "aa-card" },
    el("label", { class: "aa-switch" }, onBox, " ", el("span", {}, el("b", {}, name + "'s assistant is on"),
      el("small", {}, "They see My Assistant on their phone: a chat, their day, reminders and to-dos. Answers come from DCR Agents 2."))),
    el("label", { class: "aa-switch" }, readsBox, " ", el("span", {}, el("b", {}, "The office can read the chat and the notes"),
      el("small", {}, "From when it is turned on - what " + name + " wrote before stays private. Their page says which, and a " +
        "note in their chat tells them each time you change it.")))));
  if (!on || !v) {
    box.appendChild(el("p", { class: "aa-muted" }, "Turn the assistant on to add the office's reminders and to-dos for " + name + "."));
    return;
  }
  const items = Array.isArray(v.items) ? v.items : [];
  const office = items.filter((i) => i.by === "office");
  const theirs = items.filter((i) => i.by !== "office");
  const add = (kind, label) => el("button", { type: "button", class: "btn btn-sm", onclick: () => editItem(kind, null) }, label);
  box.appendChild(el("section", { class: "aa-card" },
    el("h3", {}, "From the office"),
    el("p", { class: "aa-muted" }, name + " sees these on their phone and can tick them done, nothing more."),
    el("div", { class: "aa-addrow" }, add("reminder", "+ Reminder"), add("todo", "+ To-do"), add("event", "+ Event")),
    office.length ? el("ul", { class: "aa-items" }, office.map((i) => itemLi(i, !i.done))) : el("p", { class: "aa-empty" }, "Nothing from the office yet.")));
  box.appendChild(el("section", { class: "aa-card" },
    el("h3", {}, "Their own and their assistant's"),
    theirs.length ? el("ul", { class: "aa-items" }, theirs.map((i) => itemLi(i, false))) : el("p", { class: "aa-empty" }, "None.")));
  if (v.chatHidden || !v.officeReads) {
    box.appendChild(el("section", { class: "aa-card" }, el("h3", {}, "Chat"),
      el("p", { class: "aa-muted" }, "The office does not read " + name + "'s conversations. Turn on “The office can read the chat” above to see them.")));
    return;
  }
  const chat = (Array.isArray(v.chat) ? v.chat : []).slice(-40);
  box.appendChild(el("section", { class: "aa-card" }, el("h3", {}, "Chat (read only)"),
    chat.length ? el("ol", { class: "aa-chat" }, chat.map((m) => el("li", { class: "aa-msg " + m.role },
      el("div", { class: "aa-who" }, (m.role === "user" ? name : m.role === "office" ? "The office" : "Assistant") +
        (m.at ? " · " + fmtDateTime(m.at) : "") + (m.status === "waiting" ? " · waiting for an answer" : m.status === "failed" ? " · not answered" : "")),
      el("div", { class: "aa-bubble" }, m.text),
      (m.cards || []).length ? el("div", { class: "aa-cards" }, m.cards.map((c) => el("span", { class: "aa-chip dim" },
        c.type === "item" ? "an item" : c.type === "email" ? "an email draft" : c.type === "task" ? "a task" : "a link"))) : null))) :
      el("p", { class: "aa-empty" }, "No messages yet.")));
  const memory = Array.isArray(v.memory) ? v.memory : [];
  box.appendChild(el("section", { class: "aa-card" }, el("h3", {}, "What their assistant keeps about them"),
    memory.length ? el("ul", { class: "aa-items" }, memory.map((n) => el("li", { class: "aa-item" }, n.text,
      n.by === "assistant" ? el("span", { class: "aa-muted" }, " · noted by the assistant") : null))) : el("p", { class: "aa-empty" }, "Nothing yet.")));
}

async function setSwitch(p, on, reads, box) {
  box.disabled = true;
  try {
    await repo.officeSet(p.profile_id, on, reads);
    toast(on !== !!p.on ? (on ? first(p.name) + "'s assistant is on." : first(p.name) + "'s assistant is off.")
      : reads ? "The office can read " + first(p.name) + "'s chat." : "The office no longer reads " + first(p.name) + "'s chat.", "ok");
    await reload();
  } catch (e) {
    box.checked = !box.checked;
    toast(errorText(e), "error");
  } finally {
    box.disabled = false;
  }
}

/* ── the office's items ───────────────────────────────────────────────── */
function nextHour() {
  const now = localStamp(new Date());
  const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1, +now.slice(8, 10), +now.slice(11, 13) + 1, 0));
  const s = d.toISOString().slice(0, 16);
  return { day: s.slice(0, 10), time: s.slice(11) };
}
async function editItem(kind, it) {
  const p = personOf(S.sel);
  if (!p) return;
  const at = it && it.at ? { day: it.at.slice(0, 10), time: it.at.slice(11) } : nextHour();
  const remindOpts = [{ value: "", label: "No reminder" }, { value: "0", label: "At the start" }, { value: "30", label: "30 minutes before" },
    { value: "60", label: "1 hour before" }, { value: "1440", label: "1 day before" }];
  const fields = kind === "todo" ? [
    { name: "text", label: "What needs doing?", value: it ? it.text : "" },
    { name: "due", label: "Due (optional)", type: "date", value: it ? it.due : "" },
    { name: "notes", label: "Notes (optional)", type: "textarea", rows: 2, value: it ? it.notes : "" },
  ] : kind === "reminder" ? [
    { name: "text", label: "What should they be reminded about?", value: it ? it.text : "" },
    { name: "day", label: "Day", type: "date", value: at.day },
    { name: "time", label: "Time", type: "time", value: at.time },
  ] : [
    { name: "text", label: "What is it?", value: it ? it.text : "" },
    { name: "day", label: "Day", type: "date", value: at.day },
    { name: "time", label: "Starts at", type: "time", value: at.time },
    { name: "end", label: "Ends at (optional)", type: "time", value: it && it.end ? it.end.slice(11) : "" },
    { name: "location", label: "Where (optional)", value: it ? it.location : "" },
    { name: "remind", label: "Remind them", type: "select", options: remindOpts,
      value: it ? (it.remind === null || it.remind === undefined ? "" : String(it.remind)) : "30" },
    { name: "notes", label: "Notes (optional)", type: "textarea", rows: 2, value: it ? it.notes : "" },
  ];
  const v = await modal({
    title: (it ? "Change the " : "New ") + KIND_WORDS[kind].toLowerCase() + " for " + first(p.name), okText: it ? "Save" : "Add", fields,
    validate: (x) => {
      const words = String(x.text || "").trim();
      if (!words) return "Write what it's about.";
      if (words.length > 300) return "Keep it under 300 characters.";
      if (kind !== "todo") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.day || "")) return "Pick a day.";
        if (!/^\d{2}:\d{2}$/.test(x.time || "")) return "Pick a time.";
        if (kind === "event" && x.end && x.end < x.time) return "It ends before it starts.";
      }
      return "";
    },
  });
  if (!v) return;
  try {
    if (it) await repo.officeItem(p.profile_id, "update", it.id, itemFields(kind, v, true));
    else await repo.officeItem(p.profile_id, "add", null, itemFields(kind, v, false));
    toast(it ? "Saved." : "Added — " + first(p.name) + " sees it on their phone.", "ok");
    await select(p.profile_id);
  } catch (e) {
    toast(errorText(e), "error");
  }
}
async function deleteItem(it) {
  const p = personOf(S.sel);
  if (!p) return;
  if (!(await confirm("Delete “" + it.text + "” from " + first(p.name) + "'s list?", { danger: true, okText: "Delete" }))) return;
  try {
    await repo.officeItem(p.profile_id, "delete", it.id, null);
    toast("Deleted.", "ok");
    await select(p.profile_id);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/* ── loading and live updates ─────────────────────────────────────────── */
async function reload() {
  const [people, pc] = await Promise.all([repo.officeList(), repo.pcStatus().catch(() => null)]);
  S.people = people;
  S.pc = pc;
  pcLine();
  drawList();
  if (S.sel && personOf(S.sel)) await select(S.sel);
}
function reloadSoon() {
  clearTimeout(S.timer);
  S.timer = setTimeout(() => { reload().catch(() => null); }, 400);
}
async function listen() {
  try { S.unwatch = await repo.watchOffice((evt) => { if (evt) reloadSoon(); }); } catch (e) { /* Refresh still reads again */ }
  window.addEventListener("pagehide", () => { if (S.unwatch) S.unwatch(); });
}

async function start() {
  S.me = await requireAuth({ roles: ["admin"] });
  topbar("assistants");
  $("aaSearch").addEventListener("input", (e) => { S.q = e.target.value || ""; drawList(); });
  $("aaRefresh").addEventListener("click", () => reload().catch((e) => toast(errorText(e), "error")));
  try {
    await reload();
  } catch (e) {
    $("aaList").innerHTML = "";
    $("aaList").appendChild(el("div", { class: "aa-error", role: "alert" }, errorText(e)));
    return;
  }
  const want = new URLSearchParams(location.search).get("person");
  if (want && personOf(want)) select(want);
  listen();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

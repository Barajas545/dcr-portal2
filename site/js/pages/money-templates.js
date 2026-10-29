/* The message templates (the Books program, release B part 2a; design-portal §3.7 with the build plan's I16, I34 and
   §4.4): what "Ask to approve", "Check ready" and "Cash ready" say, by e-mail and by text - a sheet on the Accounting
   page, for the money editors (an admin, or a manager or accountant with financials: the database's
   app.can_edit('money')); anyone else with financials reads them.

   * The placeholders as chips (map/money-messages.js PLACEHOLDERS - app.money_template_vars itself): a click puts one
     at the cursor of the field last used; the rule about links, addresses and amounts is said beside them.
   * [Preview]: rpc preview_message_template with made-up sample values - the text EXACTLY as the database would store
     it (it renders; the page never does), and what is wrong with it.
   * [Save]: rpc save_message_template at the version shown. A refusal is the database's own sentence ("the text holds
     an amount: a money message never carries one", "{{amount}} is not a placeholder of this message: use …", a link or
     an address, "write # right before a number"); someone else's save meanwhile (PT409): "Changed by someone else —
     showing theirs." and their text.
   * [Reset to the original]: rpc reset_message_template (the six defaults). Every save and reset is in the money
     history (template_saved / template_reset).
   Every database word is escaped (h) or set as text. */

import { esc, toast, errorText, confirmBox, can } from "./shell.js";
import { openSheet } from "./books-nav.js";
import * as mm from "../repo/money-messages.js";
import {
  TEMPLATE_KEYS, TEMPLATE_LABELS, PLACEHOLDERS, PLACEHOLDER_WORDS, LINK_RULE, LIMITS, chipText, insertAt, unknownPlaceholders,
  lengthProblem, smsCount, messageError,
} from "../map/money-messages.js";

const h = esc;
const CONFLICT = "Changed by someone else — showing theirs.";

function find(list, key, channel) { return (list || []).find((t) => t.key === key && t.channel === channel) || null; }

/** The editor for one key (see the header). */
export function editorHtml(key, list, ctx) {
  const c = ctx || {};
  const edit = !!c.edit;
  const mail = find(list, key, "email") || { subject: "", body: "" };
  const text = find(list, key, "sms") || { body: "" };
  const ro = edit ? "" : " readonly";
  let s = '<div class="bh-tpl"><div class="bh-tabs" role="tablist">' + TEMPLATE_KEYS.map((k) =>
    '<button type="button" role="tab" data-key="' + h(k) + '" aria-selected="' + (k === key) + '">' + h(TEMPLATE_LABELS[k]) + "</button>").join("") + "</div>";
  if (edit) {
    s += '<div class="bh-chiprow"><span class="lab">Insert:</span>' + (PLACEHOLDERS[key] || []).map((n) =>
      '<button type="button" class="bh-ph" data-chip="' + h(n) + '" title="' + h(PLACEHOLDER_WORDS[n] || n) + '">' + h(chipText(n)) + "</button>").join("") + "</div>" +
      '<div class="ac-note">' + h(LINK_RULE) + "</div>";
  }
  s += '<section class="bh-tplc" data-channel="email"><h4>E-mail</h4>' +
    '<label for="bhTplSubj">Subject</label><input id="bhTplSubj" data-f="email" maxlength="' + LIMITS.subject + '" value="' + h(mail.subject || "") + '"' + ro + ">" +
    '<label for="bhTplBody">The e-mail</label><textarea id="bhTplBody" data-f="email" rows="10" maxlength="' + LIMITS.body + '"' + ro + ">" + h(mail.body || "") + "</textarea>" +
    '<div class="bh-warn" id="bhTplWarnE"></div>' +
    '<div class="bh-acts"><button type="button" class="ac-b" data-prev="email">Preview</button>' +
    (edit ? '<button type="button" class="ac-b go" data-save="email">Save the e-mail</button><button type="button" class="ac-b" data-reset="email">Reset to the original</button>' : "") +
    '</div><div class="ac-msg" id="bhTplMsgE" role="status"></div><div class="bh-prev" id="bhTplPrevE" hidden></div></section>';
  s += '<section class="bh-tplc" data-channel="sms"><h4>Text message</h4>' +
    '<label for="bhTplSms">The text</label><textarea id="bhTplSms" data-f="sms" rows="3" maxlength="' + LIMITS.sms + '"' + ro + ">" + h(text.body || "") + "</textarea>" +
    '<div class="bh-count" id="bhTplSmsN">' + h(smsCount(text.body || "")) + '</div><div class="bh-warn" id="bhTplWarnS"></div>' +
    '<div class="bh-acts"><button type="button" class="ac-b" data-prev="sms">Preview</button>' +
    (edit ? '<button type="button" class="ac-b go" data-save="sms">Save the text</button><button type="button" class="ac-b" data-reset="sms">Reset to the original</button>' : "") +
    '</div><div class="ac-msg" id="bhTplMsgS" role="status"></div><div class="bh-prev" id="bhTplPrevS" hidden></div></section>';
  if (!edit) s += '<div class="ac-note">Only an admin, or a manager or accountant with financials, changes these.</div>';
  return s + "</div>";
}

/** Open the templates. o: {me, templates (optional), key, onDone()}. */
export async function openTemplates(o) {
  const opt = o || {};
  const edit = can(opt.me, "money");
  const st = { key: TEMPLATE_KEYS.indexOf(opt.key) !== -1 ? opt.key : TEMPLATE_KEYS[0], list: opt.templates || null, focus: null, changed: false };
  const sh = openSheet({ title: "Message templates", wide: true, html: '<div class="ac-none">Loading…</div>',
    onClose: () => { if (st.changed && typeof opt.onDone === "function") opt.onDone(); } });
  if (!st.list) {
    try { st.list = await mm.templates(); } catch (e) { sh.body.innerHTML = '<div class="ac-msg err">' + h(errorText(e)) + "</div>"; return; }
    if (!st.list) { sh.body.innerHTML = '<div class="ac-none">The message templates are not in the database yet.</div>'; return; }
  }
  const $ = (id) => sh.body.querySelector("#" + id);
  const say = (ch, t, bad) => { const n = $(ch === "email" ? "bhTplMsgE" : "bhTplMsgS"); if (n) { n.textContent = t || ""; n.className = "ac-msg" + (bad ? " err" : t ? " ok" : ""); } };
  const warn = () => {
    const e = unknownPlaceholders(st.key, ($("bhTplSubj") || {}).value + "\n" + ($("bhTplBody") || {}).value);
    const s = unknownPlaceholders(st.key, ($("bhTplSms") || {}).value);
    const w = (list) => (list.length ? "Unknown placeholder" + (list.length > 1 ? "s" : "") + ": " + list.map((n) => "{{" + n + "}}").join(", ") +
      " — the database refuses " + (list.length > 1 ? "them" : "it") + "." : "");
    if ($("bhTplWarnE")) $("bhTplWarnE").textContent = w(e);
    if ($("bhTplWarnS")) $("bhTplWarnS").textContent = w(s);
    const n = $("bhTplSmsN");
    if (n) n.textContent = smsCount(($("bhTplSms") || {}).value);
  };
  function draw() {
    sh.body.innerHTML = editorHtml(st.key, st.list, { edit });
    sh.body.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => { st.key = b.getAttribute("data-key"); st.focus = null; draw(); }));
    sh.body.querySelectorAll("[data-f]").forEach((f) => {
      f.addEventListener("focus", () => { st.focus = f.id; });
      f.addEventListener("focusin", () => { st.focus = f.id; });
      f.addEventListener("input", warn);
    });
    sh.body.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => {
      const f = $(st.focus || "bhTplBody");
      if (!f || f.readOnly) return;
      const r = insertAt(f.value, f.selectionStart, f.selectionEnd, chipText(b.getAttribute("data-chip")));
      f.value = r.text;
      try { f.focus(); f.setSelectionRange(r.at, r.at); } catch (e) { /* */ }
      warn();
    }));
    sh.body.querySelectorAll("[data-prev]").forEach((b) => b.addEventListener("click", () => preview(b.getAttribute("data-prev"))));
    sh.body.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => save(b.getAttribute("data-save"))));
    sh.body.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => reset(b.getAttribute("data-reset"))));
    warn();
  }
  const values = (ch) => (ch === "email" ? { subject: ($("bhTplSubj") || {}).value || "", body: ($("bhTplBody") || {}).value || "" }
    : { subject: null, body: ($("bhTplSms") || {}).value || "" });
  async function preview(ch) {
    const v = values(ch);
    const box = $(ch === "email" ? "bhTplPrevE" : "bhTplPrevS");
    try {
      const r = await mm.preview(st.key, ch, v.subject, v.body, {});
      box.textContent = "";
      const hd = document.createElement("div");
      hd.className = "bh-prev-h";
      hd.textContent = "As the database would send it (made-up sample values):";
      box.appendChild(hd);
      if (ch === "email") { const s = document.createElement("div"); s.className = "bh-prev-s"; s.textContent = r.subject || ""; box.appendChild(s); }
      const b = document.createElement("div");
      b.className = "bh-text-b";
      b.textContent = r.body;
      box.appendChild(b);
      if (r.problem) { const p = document.createElement("div"); p.className = "ac-msg err"; p.textContent = "The database would refuse this: " + r.problem; box.appendChild(p); }
      box.hidden = false;
    } catch (e) {
      say(ch, messageError(e, errorText), true);
    }
  }
  async function reload(ch, words) {
    try { st.list = await mm.templates(); } catch (e) { /* keep what is shown */ }
    draw();
    if (words) say(ch, words, true);
  }
  async function save(ch) {
    const t = find(st.list, st.key, ch);
    if (!t) return;
    const v = values(ch);
    const bad = lengthProblem(ch, v.subject, v.body);
    if (bad) { say(ch, bad, true); return; }
    say(ch, "Saving…");
    let r;
    try { r = await mm.saveTemplate(t, v.subject, v.body); } catch (e) {
      if (e && (e.code === "PT409" || e.status === 409)) { await reload(ch, CONFLICT); return; }
      say(ch, messageError(e, errorText), true);
      return;
    }
    Object.assign(t, r);
    st.changed = true;
    say(ch, r.unchanged ? "Nothing changed." : "Saved: the next " + (ch === "email" ? "e-mail" : "text") + " says this.");
    if (!r.unchanged) toast("Saved: " + TEMPLATE_LABELS[st.key] + " (" + (ch === "email" ? "e-mail" : "text") + ").", "ok");
  }
  async function reset(ch) {
    const t = find(st.list, st.key, ch);
    if (!t) return;
    const sure = await confirmBox("Put the " + (ch === "email" ? "e-mail" : "text") + " of “" + TEMPLATE_LABELS[st.key] + "” back to the original wording?",
      { title: "Reset to the original", okText: "Reset" });
    if (!sure) return;
    let r;
    try { r = await mm.resetTemplate(t); } catch (e) {
      if (e && (e.code === "PT409" || e.status === 409)) { await reload(ch, CONFLICT); return; }
      say(ch, messageError(e, errorText), true);
      return;
    }
    Object.assign(t, r);
    st.changed = true;
    draw();
    say(ch, r.unchanged ? "It already says the original." : "Back to the original wording.");
  }
  draw();
}

/* "Ask to approve" (the Books program, release B part 2a; design-portal §3.3 with the build plan's I17-I19, I21, I23 and
   S1/S2/S6): a shared dialog, opened from the Accounting page (one bill, or the ones ticked), from the bill page for a
   money editor who does not approve, and from The Books' "Not ready" (release B's P5).

   * Who: rpc money_approvers(p_bill_ids) - the database's exact app.can_approve rule for another person (an active
     admin, or an active manager with approve and financials), never the sender, never an address. The usual approver
     (I19: whoever approved this job's latest bill, else this vendor's, else nobody) is ticked for her.
   * How, per person: E-mail (automatic - the reminder PC sends it) when there is an address on file, Text (by hand)
     when there is a mobile number; a channel with nothing on file is off and says so.
   * The message: the template's text (message_templates, read when the dialog opens - never a page's older copy),
     editable for THIS ask only (I17: the database checks the edit by the template's own rules - no amount, no link or
     address, only its placeholders); [Preview] shows it exactly as it would be stored (rpc preview_message_template -
     the database renders, never the page), and Send sends that same text (the boxes, edited or not), so a template
     saved meanwhile elsewhere never goes out in place of what she saw.
   * The reminder PC (rpc reminder_pc_status, read when the dialog opens): paused, off or not taking e-mails - said at
     the top, so she texts or calls instead (risk 1), wherever the dialog was opened from.
   * Send: ONE rpc ask_for_approval(p_bill_ids, p_to [{profile, channel}], p_subject, p_body, p_sms_body). Each e-mail is
     queued (and said so); each text comes back as a draft with its number and body - the hand-text box ([Open the
     text], [Copy the text], [I sent it], [Not sent]: pages/tell-payee.js textStep). A refusal is said in the database's
     words (an approved bill, no document, a limit).
   Asking never approves: there is no approve call here (S1) - an approver approves on the bill page, signed in.
   Every database word is escaped (h) or set as text. */

import { esc, toast, errorText, can } from "./shell.js";
import { openSheet } from "./books-nav.js";
import { textStep } from "./tell-payee.js";
import * as mm from "../repo/money-messages.js";
import { LIMITS, CHANNEL_LABELS, lengthProblem, smsCount, messageError, messageStatus, phoneWords, pcWarning } from "../map/money-messages.js";
import { shortDay, daysLate } from "../map/books.js";

const h = esc;
const NOTE = "Messages carry no amounts: the approver sees them on the bill page, signed in to DCR Portal, and approves there. " +
  "An e-mail goes out by itself from the reminder PC; a text opens on your phone and you press Send.";

/** "Kestrel Lumber #4101 — A081 — due Oct 30" / "… — 3 days late". */
export function billLine(b, today) {
  const late = daysLate(b.dueDate, today);
  return (b.vendor || "(no vendor)") + (b.invoiceNumber ? " #" + b.invoiceNumber : "") + (b.projectNumber || b.projectLabel ? " — " + (b.projectNumber || b.projectLabel) : "") +
    (late !== null && late > 0 ? " — " + (late === 1 ? "1 day late" : late + " days late") : b.dueDate ? " — due " + shortDay(b.dueDate) : "") +
    (b.approved ? " — approved, needs how to pay" : "");
}

/** One approver's line: the tick, the name, "Usual for A081", the two channels (off when nothing is on file). */
export function approverHtml(a, i) {
  const email = !!a.hasEmail, sms = !!a.phone;
  const none = !email && !sms;
  const pick = a.usual && !none;
  return '<div class="bh-ap" data-ap="' + h(i) + '">' +
    '<label class="nm"><input type="checkbox" data-pick="' + h(i) + '"' + (pick ? " checked" : "") + (none ? " disabled" : "") + "> " +
      "<span>" + h(a.name || "(no name)") + "</span>" + (a.usual ? ' <span class="bh-usual">Usual' + (a.usualFor && a.usualFor.length ? " for " + h(a.usualFor.join(", ")) : "") + "</span>" : "") + "</label>" +
    '<div class="bh-ch" role="radiogroup" aria-label="' + h("How to reach " + (a.name || "them")) + '">' +
      '<label' + (email ? "" : ' class="off"') + '><input type="radio" name="bhCh' + h(i) + '" value="email"' + (email ? " checked" : " disabled") + "> " + h(CHANNEL_LABELS.email) +
        (email ? "" : ' <span class="why">— no e-mail on file</span>') + "</label>" +
      '<label' + (sms ? "" : ' class="off"') + '><input type="radio" name="bhCh' + h(i) + '" value="sms"' + (!email && sms ? " checked" : "") + (sms ? "" : " disabled") + "> " + h(CHANNEL_LABELS.sms) +
        (sms ? ' <span class="why">' + h(phoneWords(a.phone)) + "</span>" : ' <span class="why">— no mobile number on file</span>') + "</label>" +
    "</div>" + (none ? '<div class="ac-note">Nothing on file to reach them by: call them, or add their e-mail or phone in DCR Desktop 2.</div>' : "") + "</div>";
}

/** The dialog's body (see the header). tpl: {email: {subject, body}, sms: {body}}; ctx: {today, pc (reminder_pc_status)}. */
export function askHtml(bills, approvers, tpl, ctx) {
  const c = ctx || {};
  const t = tpl || {};
  const e = t.email || {}, s = t.sms || {};
  const warn = pcWarning(c.pc);
  let out = '<div class="bh-ask">' + (warn ? '<div class="bh-pc sm" id="bhAskPc" role="status">' + h(warn) + "</div>" : "") +
    '<div class="bh-bills"><b>' + h(bills.length === 1 ? "1 bill" : bills.length + " bills") + "</b><ul>" +
    bills.map((b) => "<li>" + h(billLine(b, c.today)) + "</li>").join("") + "</ul></div>";
  out += '<fieldset class="bh-who"><legend>Who can approve</legend><div class="ac-note" style="margin:0 0 6px">' +
    (approvers.some((a) => a.usual) ? "Ticked: the usual approver for these jobs." : "Nobody is ticked: no usual approver for these jobs yet.") + "</div>";
  out += approvers.length ? approvers.map((a, i) => approverHtml(a, i)).join("")
    : '<div class="ac-none">Nobody can approve these bills right now (an active admin, or a manager who approves and sees financials).</div>';
  out += "</fieldset>";
  out += '<details class="bh-edit" id="bhAskEdit"><summary>Edit the message (for this ask only)</summary>' +
    '<label for="bhAskSubj">E-mail subject</label><input id="bhAskSubj" maxlength="' + LIMITS.subject + '" value="' + h(e.subject || "") + '">' +
    '<label for="bhAskBody">E-mail</label><textarea id="bhAskBody" rows="9" maxlength="' + LIMITS.body + '">' + h(e.body || "") + "</textarea>" +
    '<label for="bhAskSms">Text message</label><textarea id="bhAskSms" rows="3" maxlength="' + LIMITS.sms + '">' + h(s.body || "") + "</textarea>" +
    '<div class="bh-count" id="bhAskSmsN">' + h(smsCount(s.body || "")) + "</div>" +
    '<div class="ac-note">The {{…}} words are filled in by the database for each person. No amount, link or address may be typed in: the database refuses it.</div>' +
    '<div class="bh-acts"><button type="button" class="ac-b" id="bhAskPrev">Preview</button></div>' +
    '<div class="bh-prev" id="bhAskPrevBox" hidden></div></details>';
  out += '<div class="ac-note">&#9432; ' + h(NOTE) + "</div>" +
    '<div class="ac-msg" id="bhAskMsg" role="status"></div>' +
    '<div class="bh-foot"><button type="button" class="ac-b" id="bhAskCancel">Cancel</button>' +
    '<button type="button" class="btn-accept" id="bhAskSend"' + (approvers.length ? "" : " disabled") + ">Send</button></div></div>";
  return out;
}

/* the template's text of a key and channel */
function tplOf(list, key, channel) {
  const t = (list || []).find((x) => x.key === key && x.channel === channel);
  return t ? { subject: t.subject || "", body: t.body || "" } : { subject: "", body: "" };
}

/** Who was ticked and how: [{i, profile, channel, approver}] */
export function chosen(root, approvers) {
  const out = [];
  approvers.forEach((a, i) => {
    const box = root.querySelector('[data-pick="' + i + '"]');
    if (!box || !box.checked) return;
    const radios = root.querySelectorAll('input[name="bhCh' + i + '"]');
    const on = Array.from(radios).find((r) => r.checked && !r.disabled);
    out.push({ i, profile: a.profileId, channel: on ? on.value : "", approver: a });
  });
  return out;
}

/** Open the dialog. o: {bills (map/books.js bills), me, templates (the page's copy of repo/money-messages.js
    templates(): only when they cannot be read now), today, onDone()} -> a promise of the database's answer once sent
    (null when nothing was). */
export async function openAsk(o) {
  const opt = o || {};
  if (!can(opt.me, "money")) { toast("Only an admin, or a manager or accountant with financials, asks for an approval.", "error"); return null; }
  const bills = (opt.bills || []).filter(Boolean).slice(0, LIMITS.bills);
  if (!bills.length) return null;
  let sent = null;
  const sh = openSheet({ title: "Ask to approve — " + (bills.length === 1 ? "1 bill" : bills.length + " bills"), wide: true,
    html: '<div class="ac-none">Loading who can approve…</div>', onClose: () => { if (sent && typeof opt.onDone === "function") opt.onDone(sent); } });
  // read now, not the page's copy: the boxes show the template as it is stored now, and the reminder PC as it is now
  let approvers, templates, pc;
  try {
    [approvers, templates, pc] = await Promise.all([mm.approvers(bills.map((b) => b.id)), mm.templates().catch(() => null), mm.pcStatus().catch(() => null)]);
  } catch (e) {
    sh.body.innerHTML = '<div class="ac-msg err">' + h(messageError(e, errorText)) + "</div>";
    return null;
  }
  if (!sh.isOpen()) return null;
  if (!templates) templates = opt.templates || null;
  const tpl = { email: tplOf(templates, "approval_request", "email"), sms: tplOf(templates, "approval_request", "sms") };
  sh.body.innerHTML = askHtml(bills, approvers, tpl, { today: opt.today, pc });
  const $ = (id) => sh.body.querySelector("#" + id);
  const say = (t, bad) => { const n = $("bhAskMsg"); if (n) { n.textContent = t || ""; n.className = "ac-msg" + (bad ? " err" : ""); } };
  const field = (id) => { const n = $(id); return n ? n.value : ""; };
  const edits = () => {
    const subj = field("bhAskSubj"), body = field("bhAskBody"), sms = field("bhAskSms");
    return { subject: subj !== tpl.email.subject ? subj : null, body: body !== tpl.email.body ? body : null, smsBody: sms !== tpl.sms.body ? sms : null,
      shown: { subject: subj, body, sms } };
  };
  const smsN = $("bhAskSms");
  if (smsN) smsN.addEventListener("input", () => { const n = $("bhAskSmsN"); if (n) n.textContent = smsCount(smsN.value); });
  const cancel = $("bhAskCancel");
  if (cancel) cancel.addEventListener("click", () => sh.close());
  const prev = $("bhAskPrev");
  if (prev) prev.addEventListener("click", async () => {
    const box = $("bhAskPrevBox");
    const x = edits();
    const first = chosen(sh.body, approvers)[0];
    prev.disabled = true;
    try {
      const ids = bills.map((b) => b.id);
      const to = first ? first.profile : null;
      const [mail, text] = await Promise.all([
        mm.preview("approval_request", "email", x.shown.subject, x.shown.body, { billIds: ids, toProfileId: to }),
        mm.preview("approval_request", "sms", null, x.shown.sms, { billIds: ids, toProfileId: to }),
      ]);
      box.textContent = "";
      const part = (label, subject, body, problem) => {
        const d = document.createElement("div");
        d.className = "bh-prev-part";
        const hd = document.createElement("div");
        hd.className = "bh-prev-h";
        hd.textContent = label + (first ? " to " + first.approver.name : "");
        d.appendChild(hd);
        if (subject !== null && subject !== undefined) { const sj = document.createElement("div"); sj.className = "bh-prev-s"; sj.textContent = subject; d.appendChild(sj); }
        const bd = document.createElement("div");
        bd.className = "bh-text-b";
        bd.textContent = body;
        d.appendChild(bd);
        if (problem) { const p = document.createElement("div"); p.className = "ac-msg err"; p.textContent = problem; d.appendChild(p); }
        box.appendChild(d);
      };
      part("The e-mail", mail.subject, mail.body, mail.problem);
      part("The text", null, text.body, text.problem);
      box.hidden = false;
    } catch (e) {
      say(messageError(e, errorText), true);
    }
    prev.disabled = false;
  });
  const send = $("bhAskSend");
  if (send) send.addEventListener("click", async () => {
    const who = chosen(sh.body, approvers);
    if (!who.length) { say("Tick who should approve.", true); return; }
    const noWay = who.find((w) => !w.channel);
    if (noWay) { say((noWay.approver.name || "Someone") + " has no e-mail or mobile number on file: untick them, or call them.", true); return; }
    if (who.length > LIMITS.approvers) { say("At most " + LIMITS.approvers + " people in one ask.", true); return; }
    const x = edits();
    const bad = (x.subject !== null || x.body !== null ? lengthProblem("email", x.shown.subject, x.shown.body) : "") ||
      (x.smsBody !== null ? lengthProblem("sms", null, x.shown.sms) : "");
    if (bad) { say(bad, true); return; }
    send.disabled = true;
    sh.setBusy(true);
    say("Sending…");
    let r;
    try {
      // the text in the boxes, edited or not - what Preview showed: a template saved meanwhile never goes out instead
      // (an empty box - no template could be read - leaves it to the database's stored one)
      r = await mm.ask(bills.map((b) => b.id), who.map((w) => ({ profile: w.profile, channel: w.channel })),
        { subject: x.shown.subject, body: x.shown.body, smsBody: x.shown.sms });
    } catch (e) {
      sh.setBusy(false);
      send.disabled = false;
      say(messageError(e, errorText), true);
      return;
    }
    sh.setBusy(false);
    sent = r;
    showSent(sh, r);
  });
  return null;
}

/* after Send: each e-mail said, each text as a hand-text box */
function showSent(sh, r) {
  sh.body.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "bh-sent";
  const mails = r.messages.filter((m) => m.channel === "email");
  const texts = r.messages.filter((m) => m.channel === "sms");
  mails.forEach((m) => {
    const line = document.createElement("div");
    line.className = "bh-st " + messageStatus(m).cls;
    line.textContent = "E-mail to " + (m.toName || "them") + ": " + (m.already ? "asked a moment ago - it is not sent twice" : messageStatus(m).text) + ".";
    wrap.appendChild(line);
  });
  texts.forEach((m) => {
    if (m.already && m.status !== "draft") {
      const line = document.createElement("div");
      line.className = "bh-st ok";
      line.textContent = "Text to " + (m.toName || "them") + ": " + messageStatus(m).text + ".";
      wrap.appendChild(line);
      return;
    }
    wrap.appendChild(textStep(m, {}));
  });
  const foot = document.createElement("div");
  foot.className = "bh-foot";
  const done = document.createElement("button");
  done.setAttribute("type", "button");
  done.className = "btn-accept";
  done.id = "bhAskDone";
  done.textContent = "Done";
  done.addEventListener("click", () => sh.close());
  foot.appendChild(done);
  wrap.appendChild(foot);
  sh.body.appendChild(wrap);
  if (!texts.length) toast(mails.length === 1 ? "Asked: the e-mail is on its way." : "Asked: the e-mails are on their way.", "ok");
}

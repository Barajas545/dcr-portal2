/* The review queue for what subcontractors send through the public form (port of the old submissions.html /
   submissions.js; BLUEPRINT 3.3.11, Appendix A "submissions", P5 5c, acceptance check 4).

   Accepting is the moment an outside claim becomes an inside record: an invoice becomes a bill that then goes through
   the ordinary approval gate (bill.html, approve_bill), a change order becomes a change order of the job (awarded).
   The database decides both (rpc accept_submission / reject_submission, migration M5c); this screen only asks, with
   the version it showed: a submission somebody else dealt with meanwhile is refused and shown again, and a second
   accept says it is already done.

   Only an admin, or a manager or accountant with the financials switch: anyone else is told so and sent home before
   anything is read. The paperwork (under f/ in Storage) opens through a short signed link in its own tab.
   ?ref=SUB-XXXX-XXXX (the link in the office's e-mail about a new submission) opens the tab it is on and shows it first. */

import { boot, esc, toast, errorText, confirmBox, D, qs } from "./shell.js";
import * as subs from "../repo/submissions.js";
import * as filesRepo from "../repo/files.js";
import { canReview, quoteOption, reviewedLine, refusalText, isStale, fmtDay, TABS, REJECT_NOTE_MAX } from "../map/submissions.js";
import { SIGNED_DOC_S } from "../map/files.js";

const h = esc;
const el = (id) => document.getElementById(id);
const state = { me: null, tab: "pending", all: [], counts: {}, quotes: new Map(), busy: new Set(),
  focus: String(qs("ref") || "").trim().toUpperCase() };

function rowsOfTab() {
  const list = state.all.filter((s) => s.state === state.tab);
  // the waiting ones oldest first (the queue order), the others newest first; the one the link named on top
  list.sort((a, b) => (b.reference === state.focus) - (a.reference === state.focus) ||
    (state.tab === "pending" ? 1 : -1) * String(a.created_at || "").localeCompare(String(b.created_at || "")) || (a.id - b.id));
  return list;
}

function card(s) {
  const id = h(String(s.id));
  let x = '<div class="sb-card' + (s.pending ? " pending" : "") + (s.reference === state.focus ? " focus" : "") + '" data-id="' + id + '" id="sub-' + h(s.reference) + '">';
  x += '<div class="sb-top"><div><span class="sb-who">' + h(s.vendor || "(no company)") + "</span>" +
    '<span class="sb-kind ' + (s.isCo ? "co" : "inv") + '">' + (s.isCo ? "CHANGE ORDER" : "INVOICE") + "</span>" +
    '<div class="sb-meta">' + h(s.projectLabel) + (s.invoiceNumber ? " · #" + h(s.invoiceNumber) : "") +
      (s.invoiceDate ? " · dated " + h(fmtDay(s.invoiceDate)) : "") + (s.dueDate ? " · due " + h(fmtDay(s.dueDate)) : "") +
      ' · <b class="sb-ref">' + h(s.reference) + "</b></div>" +
    '<div class="sb-meta">' + h(s.contact) +
      (s.email ? ' &lt;<a href="mailto:' + h(s.email) + "?subject=" + encodeURIComponent(s.reference) + '">' + h(s.email) + "</a>&gt;" : "") +
      (s.phone ? " · " + h(s.phone) : "") + (s.sentDay ? " · sent " + h(fmtDay(s.sentDay)) : "") + "</div>" +
    '</div><div class="sb-amt">' + (s.amountText ? h(s.amountText) : "—") + "</div></div>";
  if (s.description) x += '<div class="sb-desc">' + h(s.description) + "</div>";

  x += '<div class="sb-files">';
  x += s.document
    ? '<button type="button" data-doc="' + id + '" title="' + h(s.document.name) + '">&#128206; ' + h(s.document.name) + "</button>"
    : '<span class="sb-nodoc">No document attached</span>' + (s.documentAnnounced && s.pending ? '<span class="sb-chip">their upload did not finish</span>' : "");
  if (s.signature) x += '<img class="sb-sig" alt="Signature of ' + h(s.signatureName) + '" data-sig="' + id + '">';
  x += '<span class="sb-chip">Signed by ' + h(s.signatureName || "—") + (s.signedDay ? " on " + h(fmtDay(s.signedDay)) : "") +
    (s.ip && s.ip !== "unknown" ? " from " + h(s.ip) : "") + "</span>";
  x += "</div>";

  if (s.pending) {
    if (s.acceptWhy) x += '<div class="sb-warn">&#9888; ' + h(s.acceptWhy) + "</div>";
    if (s.notice) x += '<div class="' + (s.notice.warn ? "sb-warn sb-notice" : "sb-chip sb-notice") + '">' + (s.notice.warn ? "&#9888; " : "") + h(s.notice.text) + "</div>";
    x += '<div class="sb-acts">';
    if (!s.isCo) x += '<select data-q="' + id + '" aria-label="Bill it against"><option value="">Loading quotes…</option></select>';
    x += '<button type="button" class="btn-accept" data-accept="' + id + '"' + (s.canAccept ? "" : " disabled") + ">&#10003; " +
      (s.isCo ? "Accept as a change order" : "Accept as a bill") + "</button>" +
      '<button type="button" class="btn-reject" data-reject="' + id + '">Reject</button></div>';
    x += '<div class="sb-msg" data-msg="' + id + '"></div>';
  } else {
    x += '<div class="sb-done">' + h(reviewedLine(s));
    if (s.billId) x += ' · <a href="bill.html?id=' + encodeURIComponent(s.billId) + '">Open the bill &rarr;</a>';
    else if (s.quoteId) x += ' · <a href="pm.html?id=' + encodeURIComponent(s.projectId) + '">Open the job&rsquo;s progress chart &rarr;</a>';
    x += "</div>";
  }
  return x + "</div>";
}

function render() {
  for (const t of TABS) {
    const b = el("sbTab-" + t);
    b.setAttribute("aria-pressed", String(t === state.tab));
    b.querySelector(".n").textContent = state.counts[t] ? "(" + state.counts[t] + ")" : "";
  }
  el("sbCount").textContent = (state.counts.pending || 0) + " waiting";
  const box = el("sbList");
  const list = rowsOfTab();
  if (!list.length) {
    box.innerHTML = '<div class="sb-empty">' + (state.tab === "pending"
      ? "Nothing waiting. Anything a subcontractor sends through the form lands here." : "Nothing here.") + "</div>";
    return;
  }
  box.innerHTML = list.map(card).join("");
  box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => openDoc(find(b.getAttribute("data-doc")))));
  box.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => act(find(b.getAttribute("data-accept")), "accept")));
  box.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => act(find(b.getAttribute("data-reject")), "reject")));
  box.querySelectorAll("[data-q]").forEach((sel) => fillQuotes(sel, find(sel.getAttribute("data-q"))));
  box.querySelectorAll("[data-sig]").forEach((img) => showSignature(img, find(img.getAttribute("data-sig"))));
}

function find(id) { return state.all.find((s) => String(s.id) === String(id)) || null; }

/* The commitments of one project, so an invoice can be filed against the quote it bills. Read per project only when
   a card needs it - the queue is usually two or three jobs. */
async function fillQuotes(sel, s) {
  if (!s) return;
  let qs = state.quotes.get(String(s.projectId));
  if (!qs) {
    try { qs = await subs.quotesFor(s.projectId, state.me); } catch (e) { qs = []; }
    state.quotes.set(String(s.projectId), qs);
  }
  sel.textContent = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = qs.length ? "— not against a quote —" : "— no quotes on this job —";
  sel.appendChild(none);
  for (const q of qs) {
    const o = quoteOption(q);
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label;
    sel.appendChild(op);
  }
}

async function showSignature(img, s) {
  if (!s || !s.signature || !s.signature.path) return;
  try {
    const url = await filesRepo.signedUrl(s.signature.path, SIGNED_DOC_S);
    if (url) img.src = url;
  } catch (e) { img.hidden = true; }
}

async function openDoc(s) {
  if (!s || !s.document) return;
  const w = window.open("", "_blank");
  try {
    const url = await filesRepo.signedUrl(s.document.path, SIGNED_DOC_S);
    if (!url) throw new Error("No link for this file.");
    if (w) w.location.href = url; else location.href = url;
  } catch (e) {
    if (w) w.close();
    toast(errorText(e), "error");
  }
}

function msgOf(s) { return document.querySelector('[data-msg="' + String(s.id) + '"]'); }
function buttons(s, disabled) {
  document.querySelectorAll('[data-accept="' + String(s.id) + '"],[data-reject="' + String(s.id) + '"]').forEach((b) => {
    b.disabled = disabled || (b.hasAttribute("data-accept") && !s.canAccept);
  });
}

async function act(s, op) {
  if (!s || state.busy.has(String(s.id))) return;
  let note = "";
  if (op === "reject") {
    const M = D().modal;
    const v = typeof M === "function" ? await M({
      title: "Reject this " + s.kindLabel.toLowerCase(),
      message: "Reject the " + s.kindLabel.toLowerCase() + " from " + (s.vendor || "this subcontractor") + " (" + s.reference + ")? They are not told automatically — you will need to reply to them.",
      okText: "Reject", danger: true,
      fields: [{ name: "note", type: "textarea", rows: 3, label: "Why (optional, kept with the submission)", placeholder: "e.g. Duplicate of SUB-…" }],
      validate: (x) => (String(x.note || "").length > REJECT_NOTE_MAX ? "At most " + REJECT_NOTE_MAX + " characters." : ""),
    }) : ((await confirmBox("Reject this submission?")) ? { note: "" } : null);
    if (!v) return;
    note = v.note || "";
  } else {
    const sure = await confirmBox(s.isCo
      ? "Record this change order from " + (s.vendor || "the subcontractor") + " (" + (s.amountText || "no amount") + ") on " + s.projectLabel + " as agreed (awarded)?"
      : "File this invoice from " + (s.vendor || "the subcontractor") + " (" + (s.amountText || "no amount") + ") as a bill on " + s.projectLabel + "? It still needs approval before anything is paid.",
      { title: s.isCo ? "Accept the change order" : "Accept as a bill", okText: "Accept" });
    if (!sure) return;
  }
  const sel = document.querySelector('[data-q="' + String(s.id) + '"]');
  const msg = msgOf(s);
  state.busy.add(String(s.id));
  buttons(s, true);
  if (msg) { msg.textContent = op === "accept" ? "Filing it…" : "Rejecting…"; msg.className = "sb-msg"; }
  try {
    if (op === "accept") await subs.accept(s, sel ? sel.value : null);
    else await subs.reject(s, note);
  } catch (e) {
    state.busy.delete(String(s.id));
    const text = refusalText(e);
    toast(text, "error");
    if (isStale(e)) { await load(); return; }        // reviewed or changed by somebody else: show it as it is now
    if (msg) { msg.textContent = text; msg.className = "sb-msg err"; }
    buttons(s, false);
    return;
  }
  state.busy.delete(String(s.id));
  toast(op === "accept" ? (s.isCo ? "Change order recorded on the job." : "Filed as a bill — it is waiting for approval.") : "Rejected.", "ok");
  await load();
}

async function load(first) {
  try {
    const d = await subs.list(state.me);
    state.all = d.all;
    state.counts = d.counts;
    const named = first && state.focus ? state.all.find((s) => s.reference === state.focus) : null;
    if (named) state.tab = named.state;
    render();
    if (named) {
      const card = document.getElementById("sub-" + named.reference);
      if (card && card.scrollIntoView) card.scrollIntoView({ block: "start" });
    }
  } catch (e) {
    el("sbList").innerHTML = '<div class="sb-empty" style="color:var(--err)">' + h(errorText(e)) + "</div>";
  }
}

function tab(name) {
  if (TABS.indexOf(name) === -1) return;
  state.tab = name;
  render();
}

async function start() {
  let me;
  try { me = await boot("submissions"); } catch (e) { return; }
  state.me = me;
  if (!canReview(me)) {
    el("sbList").innerHTML = '<div class="sb-empty">Subcontractor submissions are not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("Subcontractor submissions need the financials switch (an admin, or a manager or accountant with it). Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  for (const t of TABS) el("sbTab-" + t).addEventListener("click", () => tab(t));
  el("sbRefresh").addEventListener("click", () => { state.quotes.clear(); load(); });
  await load(true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

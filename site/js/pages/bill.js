/* One bill, its paperwork, and the decision (port of the old bill.html / bill.js; MODULES §5b; BLUEPRINT 3.3.11 "Bill
   approval page", P5 5b, acceptance check 2).

   Reached from the home page's approvals card, The Books and the Progress Chart. The question it answers is "should
   I authorise THIS, and does the paperwork say what the row says", so the document is next to the numbers: an image
   is shown in place; a PDF opens in its own tab through a short signed link (the page's security policy lets no
   other site's file into a frame); a file kept on the office computers is named, not opened.

   * Approve (rpc approve_bill(id, pay_method, version, note)): only an admin, or a manager with the approve switch
     (and financials). The pay method - by check, in cash, either, by bank transfer (ACH or wire) or by card (owner
     decision 2026-10-21) - is REQUIRED and nothing is pre-selected (a default would get clicked through
     and the accountant told "check" about a bill meant for cash); the version is the one on screen, so a bill
     changed meanwhile is refused (PT409) and shown again; the document must be attached. An accountant sees the
     bill and its state but never an approve button (and approve_bill refuses them anyway).
   * Change how to pay (rpc set_bill_pay_method(p_id, p_method, p_version)): approve authority, an approved bill with
     no payment yet - the accountant carries out the approver's choice and cannot quietly switch it.
   * The payments already made, with their pick-up stamp; "In QuickBooks" when the accountant has marked it entered.
   Editing a bill stays in DCR Desktop 2 (Q12): an edit of an approved bill's amount clears the approval there.

   Only with the financials switch: anyone else is told so and sent home before anything is read. */

import { boot, esc, toast, errorText, qs, D } from "./shell.js";
import * as books from "../repo/books.js";
import * as filesRepo from "../repo/files.js";
import { fmtMoney, payMethodWords, paymentLabel, isPayMethod, PAY_METHODS, seesBooks, canApprove, APPROVAL_NOTE_MAX } from "../map/books.js";
import { fmtSize, SIGNED_DOC_S } from "../map/files.js";
import { fmtDay } from "../map/pacific.js";

const h = esc;
const money = fmtMoney;
const state = { me: null, data: null, active: 0, busy: false };
const BID = String(qs("id") || "").trim();

function day(v) { const s = fmtDay(v); return s === "—" ? "" : s; }

function row(k, v, cls) {
  if (v === "" || v === null || v === undefined) return "";
  return '<div><span class="k">' + h(k) + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
}

function viewable(f) {
  const m = String(f.mime || "").toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (/^image\/(jpeg|png|gif|webp|bmp)$/.test(m) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name)) return "image";
  return "";
}

const METHOD_OPTIONS = [{ value: "", label: "Choose…" }].concat(PAY_METHODS.map((m) => ({ value: m.id, label: m.label })));

function render() {
  const d = state.data;
  const b = d.bill, files = d.files || [], can = d.can || {};
  const waiting = !b.approved;
  const lateDue = (b.lateBy || 0) > 0;
  const stateCls = b.void ? "void" : waiting ? "wait" : "ok";
  const stateText = b.void ? "VOID" : waiting ? "AWAITING APPROVAL" : "APPROVED";

  let s = '<div class="bl-top"><div><h2>' + h(b.vendor || "(no vendor)") +
    (b.invoiceNumber ? ' <span class="no">#' + h(b.invoiceNumber) + "</span>" : "") + " " +
    '<span class="bl-state ' + stateCls + '" id="blState">' + stateText + "</span>" +
    (b.entered ? ' <span class="bl-state qbo">IN QUICKBOOKS</span>' : "") + "</h2>" +
    '<p class="bl-sub">' + h(b.projectLabel) + (b.projectAddress ? " · " + h(b.projectAddress) : "") + "</p></div>" +
    '<div class="bl-amt"><div class="v">' + money(b.amount) + '</div><div class="n">' +
    (b.paid > 0 ? money(b.paid) + " paid · " + money(b.owed) + " still to pay" : "nothing paid yet") + "</div></div></div>";

  s += '<div class="bl-grid">';

  // the paperwork
  s += '<div class="bl-view"><div class="bl-card"><h3>The paperwork</h3>';
  if (!files.length) {
    s += '<div class="bl-stage"><div class="bl-smsg">No document is attached to this bill.<br>It cannot be approved until one is (in DCR Desktop 2).</div></div>';
  } else {
    s += '<div class="bl-tabs">' + files.map((f, i) => '<button type="button" data-f="' + i + '" aria-pressed="' + (i === state.active) + '" title="' + h(f.name) + '">' +
      (f.primary ? "&#128206; " : "") + h(f.name) + "</button>").join("") + "</div>";
    s += '<div class="bl-stage" id="blStage"><div class="bl-smsg">Opening…</div></div><div class="bl-viewbar" id="blViewBar"></div>';
  }
  s += "</div></div>";

  // the facts and the decision
  s += '<div class="bl-side"><div class="bl-card"><h3>The bill</h3><div class="bl-rows">' +
    row("Vendor", h(b.vendor || "—")) +
    (b.vendorPerson ? row("Contact", h(b.vendorPerson)) : "") +
    row("Their invoice #", h(b.invoiceNumber || "—")) +
    row("Kind", h(b.kindLabel || "—")) +
    row("Amount", money(b.amount)) +
    row("Invoice date", h(day(b.invoiceDate) || "—")) +
    row("Due", h(day(b.dueDate) || "—") + (lateDue && waiting ? " · OVERDUE" : ""), lateDue && waiting ? "late" : "") +
    row("Logged by", h([b.loggedByName, day(b.loggedDay)].filter(Boolean).join(" · ") || "—")) +
    (b.entered ? row("In QuickBooks", h([day(b.enteredDay), b.enteredByName, b.qboRef].filter(Boolean).join(" · "))) : "") +
    "</div></div>";
  if (b.description) s += '<div class="bl-card"><h3>What it is for</h3><div class="bl-desc">' + h(b.description) + "</div></div>";
  if (d.quote) {
    s += '<div class="bl-card"><h3>Billed against</h3><div class="bl-rows">' + row(d.quote.kind, h(d.quote.vendor || b.vendor)) +
      (d.quote.amount !== null && d.quote.amount !== undefined ? row("Agreed", money(d.quote.amount)) : "") +
      (d.quote.status ? row("Status", h(d.quote.status)) : "") + "</div></div>";
  }

  s += '<div class="bl-card" id="blDecision"><h3>' + (waiting ? "Approve for payment" : "Approval") + "</h3>";
  if (b.void) {
    s += '<div class="bl-why">This bill was voided. Nothing is approved or paid on it.</div>';
  } else if (!waiting) {
    s += '<div class="bl-ok"><b>Approved</b> by ' + h(b.approvedByName || "—") + (b.approvedDay ? " on " + h(day(b.approvedDay)) : "") +
      (b.approvedAmount ? "<br>Authorised at <b>" + money(b.approvedAmount) + "</b>" : "") +
      (b.approvalNote ? "<br>" + h(b.approvalNote) : "") +
      (b.payMethod ? "<br>To be paid <b>" + h(payMethodWords(b.payMethod)) + "</b>" : "") + "</div>";
    if (!b.payMethod) {
      s += '<div class="bl-why" style="margin-top:8px">Nobody recorded how this is paid (by check, in cash, by bank transfer or by card), so the accountant cannot pay it.' +
        (can.approve ? "" : " Ask a manager or admin to set it.") + "</div>";
    }
    if (can.approve && !d.payments.length) {
      s += '<div style="margin-top:10px"><button type="button" class="bl-secondary" id="blHow">' + (b.payMethod ? "Change how to pay" : "Say how to pay") + "</button></div>";
    } else if (can.approve && d.payments.length) {
      s += '<div class="bl-msg">A payment is recorded, so how it is paid is settled.</div>';
    }
  } else if (!can.approve) {
    s += '<div class="bl-why" id="blNoApprove">Only an admin, or a manager with approve authority, can sign this off.' +
      (state.me && state.me.role === "accountant" ? " The accountant pays it once it is approved." : "") + "</div>";
  } else if (!b.hasDocument) {
    s += '<div class="bl-why">Attach the invoice first (in DCR Desktop 2) — an approved payment needs the paperwork behind it.</div>';
  } else {
    s += '<input class="bl-note" id="blNote" type="text" maxlength="' + APPROVAL_NOTE_MAX + '" placeholder="Note (optional)" aria-label="Approval note">' +
      '<button type="button" class="bl-approve" id="blGo">&#10003; Approve ' + money(b.amount) + " for payment</button>";
  }
  s += '<div class="bl-msg" id="blMsg"></div></div>';

  if (d.payments.length) {
    s += '<div class="bl-card"><h3>Paid on this bill</h3>' + d.payments.map((p) => '<div class="bl-pay"><span>' +
      h(paymentLabel(p.method)) + (p.method === "check" ? " #" + h(p.checkNumber) : p.reference && p.method !== "cash" ? " · " + h(p.reference) : "") +
      " · " + h(day(p.paidDate)) +
      (p.payee ? '<br><span class="t">to ' + h(p.payee) + "</span>" : "") + "</span><span><b>" + money(p.amount) + "</b>" +
      (p.collectable ? '<br><span class="t">' + (p.toldAt ? "told " + h(p.toldHow) + " " + h(day(p.toldDay)) : "not told yet") + "</span>" : "") +
      "</span></div>").join("") + "</div>";
  }

  if (b.projectId != null) s += '<a class="bl-secondary" href="pm.html?id=' + encodeURIComponent(b.projectId) + '">Open this project in the progress chart &rarr;</a>';
  if (canApprove(state.me)) s += '<a class="bl-secondary" href="dashboard.html">Back to the approvals list</a>';
  s += '<a class="bl-secondary" href="accounting.html">The Books &rarr;</a>';
  s += "</div></div>";

  document.getElementById("blRoot").innerHTML = s;
  document.title = "DCR Portal 2 — " + (b.vendor || "Bill") + (b.invoiceNumber ? " #" + b.invoiceNumber : "");
  if (files.length) {
    document.querySelectorAll("[data-f]").forEach((btn) => btn.addEventListener("click", () => show(Number(btn.getAttribute("data-f")))));
    show(state.active);
  }
  const how = document.getElementById("blHow");
  if (how) how.addEventListener("click", setPayMethod);
  const go = document.getElementById("blGo");
  if (go) go.addEventListener("click", approve);
}

/* Put a file on screen: an image in place, a PDF in its own tab, a file on the office computers named. */
async function show(i) {
  const f = state.data.files[i];
  if (!f) return;
  state.active = i;
  document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-f")) === i)));
  const stage = document.getElementById("blStage"), bar = document.getElementById("blViewBar");
  bar.textContent = "";
  bar.appendChild(document.createTextNode(f.name + (f.size ? " · " + fmtSize(f.size) : "")));
  if (!f.cloud || !f.storagePath) {
    stage.innerHTML = '<div class="bl-smsg"><b>' + h(f.name) + "</b><br>On the office computers — open it in DCR Desktop 2.</div>";
    return;
  }
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Open in a new tab ↗";
  open.addEventListener("click", () => openFile(f));
  bar.appendChild(document.createTextNode(" · "));
  bar.appendChild(open);
  const kind = viewable(f);
  if (kind !== "image") {
    stage.innerHTML = '<div class="bl-smsg"><b>' + h(f.name) + "</b><br>" + (kind === "pdf" ? "A PDF opens in its own tab." : "This kind of file opens in its own tab.") +
      '<br><button type="button" class="bl-secondary" id="blOpenDoc" style="max-width:260px;margin:12px auto 0">Open ' + (kind === "pdf" ? "the PDF" : "it") + " ↗</button></div>";
    const b = document.getElementById("blOpenDoc");
    if (b) b.addEventListener("click", () => openFile(f));
    return;
  }
  stage.innerHTML = '<div class="bl-smsg">Opening ' + h(f.name) + "…</div>";
  try {
    const url = await filesRepo.signedUrl(f.storagePath, SIGNED_DOC_S);
    if (!url) throw new Error("No link for this file.");
    if (state.active !== i) return;
    stage.innerHTML = "";
    const img = document.createElement("img");
    img.alt = f.name;
    img.src = url;
    stage.appendChild(img);
  } catch (e) {
    stage.innerHTML = '<div class="bl-smsg" style="color:var(--err)">' + h(errorText(e)) + "</div>";
  }
}

async function openFile(f) {
  const w = window.open("", "_blank");
  try {
    const url = await filesRepo.signedUrl(f.storagePath, SIGNED_DOC_S);
    if (!url) throw new Error("No link for this file.");
    if (w) w.location.href = url; else location.href = url;
  } catch (e) {
    if (w) w.close();
    toast(errorText(e), "error");
  }
}

async function pickMethod(title, message, current) {
  const M = D().modal;
  if (typeof M !== "function") return null;
  const v = await M({
    title, message, okText: title === "Approve for payment" ? "Approve" : "Set it",
    fields: [{ name: "m", label: "How should this be paid?", type: "select", value: current || "", options: METHOD_OPTIONS }],
    validate: (x) => (isPayMethod(x.m) ? "" : "Choose how it is paid: by check, in cash, either, by bank transfer or by card."),
  });
  return v ? v.m : null;
}

function failed(e, msg) {
  const conflict = e && (e.code === "PT409" || e.status === 409);
  const text = conflict ? "Someone changed this bill since it was opened — here it is as it is now. Check it, then try again." : errorText(e);
  if (msg) { msg.textContent = text; msg.className = "bl-msg err"; }
  toast(text, "error");
  return conflict;
}

async function approve() {
  const b = state.data.bill;
  const go = document.getElementById("blGo"), msg = document.getElementById("blMsg");
  const note = (document.getElementById("blNote") || {}).value || "";
  /* How it is to be paid is part of the approval: asked here, nothing pre-selected. */
  const m = await pickMethod("Approve for payment", "Approve " + money(b.amount) + " to " + (b.vendor || "this vendor") +
    "? Your name and the time are recorded against the bill, and the accountant is told how to pay it.", "");
  if (!m || state.busy) return;
  state.busy = true;
  go.disabled = true;
  msg.textContent = "Approving…";
  msg.className = "bl-msg";
  try {
    await books.approve(b, m, note);
  } catch (e) {
    state.busy = false;
    go.disabled = false;
    if (failed(e, msg)) await load();
    return;
  }
  state.busy = false;
  toast("Approved — to be paid " + payMethodWords(m) + ".", "ok");
  await load();
}

async function setPayMethod() {
  const b = state.data.bill;
  const m = await pickMethod(b.payMethod ? "Change how to pay" : "Say how to pay",
    "This bill is approved for " + money(b.approvedAmount || b.amount) + ". Saying how it is paid is an authorisation, which is why it is yours and not the accountant's.",
    b.payMethod);
  if (!m || state.busy) return;
  if (m === b.payMethod) return;
  state.busy = true;
  try {
    await books.setPayMethod(b, m);
  } catch (e) {
    state.busy = false;
    if (failed(e, document.getElementById("blMsg"))) await load();
    return;
  }
  state.busy = false;
  toast("To be paid " + payMethodWords(m) + ".", "ok");
  await load();
}

async function load() {
  try {
    state.data = await books.loadBill(BID, state.me);
    if (state.active >= state.data.files.length) state.active = 0;
    render();
  } catch (e) {
    document.getElementById("blRoot").innerHTML = '<div class="bl-card" style="color:var(--err)">' + h(errorText(e)) +
      '</div><a class="bl-secondary" href="dashboard.html" style="max-width:320px">Back to the home page</a>';
  }
}

async function start() {
  let me;
  try { me = await boot("books"); } catch (e) { return; }
  state.me = me;
  if (!seesBooks(me)) {
    document.getElementById("blRoot").innerHTML = '<div class="bl-card">Bills are not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("Bills are not available for your role: they need the financials switch. Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  if (!/^\d{1,15}$/.test(BID)) {
    document.getElementById("blRoot").innerHTML = '<div class="bl-card">No bill was named. <a href="accounting.html">The Books</a> · <a href="dashboard.html">Home</a></div>';
    return;
  }
  await load();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

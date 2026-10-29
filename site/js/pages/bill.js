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
   * The paperwork on the web (the Books program, release A; design-portal §6.5, the contract §4.1, decisions I2-I4),
     for money editors (an admin, or a manager or accountant with financials - the database's rule): the document, the
     bill's other files ("extras") and each payment's files ("Check #1043 · Oct 28"), all through the durable upload
     queue (kind "bill" - the bill's id -, kind "payment" - the payment's too; js/pages/file-drop.js: several at
     once, drop, paste, the camera):
       - no document yet: the first PDF or picture added becomes the document (queued with the tag "document"; when it
         has landed the page points the bill at it - books.setDocument, a versioned PATCH); the rest are extras. A page
         closed in between leaves it an extra with "Make this the bill's document", so nothing is lost;
       - "Make this the bill's document" on an extra only re-points (the old document stays as an extra);
       - "Replace…" on the document uploads the new file, points the bill at it, then removes the old one (a soft
         delete - the database keeps it in the history);
       - a bill marked entered in QuickBooks, or a paid one, keeps its document: refused BEFORE any byte moves; on an
         approved bill the page asks first ("this withdraws the approval"), and the database withdraws it;
       - "Remove" on an extra or a payment's file (money editors, I4); never on the document - the database guards the
         document of an approved, paid or entered bill anyway.
     A file name is data: every name is put on the page with textContent or h(). A refused upload keeps the database's
     sentence on its line ("this kind of file can't be attached to money: save it as a PDF or a picture").
   Editing a bill stays in DCR Desktop 2 (Q12): an edit of an approved bill's amount clears the approval there.

   Only with the financials switch: anyone else is told so and sent home before anything is read. */

import { boot, esc, toast, errorText, qs, D, confirmBox } from "./shell.js";
import * as books from "../repo/books.js";
import * as filesRepo from "../repo/files.js";
import * as uploads from "./uploads.js";
import { fmtMoney, payMethodWords, paymentLabel, isPayMethod, PAY_METHODS, seesBooks, canApprove, APPROVAL_NOTE_MAX } from "../map/books.js";
import { fmtSize } from "../map/files.js";
import { fmtDay } from "../map/pacific.js";
import { mountFileDrop, queueAll, acceptable, ACCEPT } from "./file-drop.js";
import { paperwork, showIn, openTab, documentProblem, withdrawsApproval, landingProblem, WITHDRAW_TEXT, kindOf } from "./file-viewer.js";

const h = esc;
const money = fmtMoney;
const state = { me: null, data: null, active: 0, busy: false, files: [], drop: null, queue: [], watching: false, payFor: null, chain: Promise.resolve() };
const BID = String(qs("id") || "").trim();

function day(v) { const s = fmtDay(v); return s === "—" ? "" : s; }

function row(k, v, cls) {
  if (v === "" || v === null || v === undefined) return "";
  return '<div><span class="k">' + h(k) + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
}

/* May this person add files here, and is the bill one that takes them (live: not void, not deleted)? */
function editsPaper() {
  const d = state.data;
  return !!(d && d.can && d.can.pay && !d.bill.void && !d.bill.deleted);
}

const METHOD_OPTIONS = [{ value: "", label: "Choose…" }].concat(PAY_METHODS.map((m) => ({ value: m.id, label: m.label })));

function render() {
  const d = state.data;
  const b = d.bill, can = d.can || {};
  const files = state.files = paperwork(b, d.files || [], d.payments || []);
  // the file looked at stays the one looked at when the list changes (a file landed, the document moved)
  const was = state.activeId == null ? -1 : files.findIndex((f) => String(f.id) === String(state.activeId));
  state.active = was !== -1 ? was : state.active < files.length ? state.active : 0;
  const waiting = !b.approved;
  // a voided payment (the check register's Void) is paid against nothing: listed as void, counted nowhere
  const livePays = (d.payments || []).filter((p) => p.live !== false);
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

  // the paperwork: the document, the bill's other files, each payment's files
  const edit = editsPaper();
  const hasDoc = files.some((f) => f.role === "document");
  s += '<div class="bl-view"><div class="bl-card" id="blPaper"><h3>The paperwork</h3>';
  if (!files.length) {
    s += '<div class="bl-stage"><div class="bl-smsg">No document is attached to this bill.<br>' + (edit
      ? "It cannot be approved until one is: attach it here (or in DCR Desktop 2) - paste, drop or choose a PDF or photos below."
      : "It cannot be approved until one is (attached in the Books, or in DCR Desktop 2).") + "</div></div>";
  } else {
    s += '<div class="bl-tabs">' + files.map((f, i) => '<button type="button" data-f="' + i + '" data-role="' + h(f.role) + '" aria-pressed="' + (i === state.active) +
      '" title="' + h(f.label + ": " + f.name) + '">' + (f.role === "document" ? "&#128206; " : f.role === "payment" ? "&#128181; " : "") + h(f.name) + "</button>").join("") + "</div>";
    s += '<div class="bl-stage" id="blStage"><div class="bl-smsg">Opening…</div></div><div class="bl-viewbar" id="blViewBar"></div>';
  }
  if (edit) {
    s += '<div class="bl-q" id="blQueue"></div><div class="bl-drop" id="blDrop"></div>' +
      '<input type="file" id="blReplaceIn" accept="' + h(ACCEPT) + '" hidden>' +
      '<input type="file" id="blPayIn" accept="' + h(ACCEPT) + '" multiple hidden>';
    if (!hasDoc && files.length) s += '<div class="bl-why" style="margin-top:8px">None of these files is the bill\'s document yet: pick one and press “Make this the bill\'s document”.</div>';
  }
  s += '<div class="bl-msg" id="blFileMsg" role="status"></div>';
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
    if (can.approve && !livePays.length) {
      s += '<div style="margin-top:10px"><button type="button" class="bl-secondary" id="blHow">' + (b.payMethod ? "Change how to pay" : "Say how to pay") + "</button></div>";
    } else if (can.approve && livePays.length) {
      s += '<div class="bl-msg">A payment is recorded, so how it is paid is settled.</div>';
    }
  } else if (!can.approve) {
    s += '<div class="bl-why" id="blNoApprove">Only an admin, or a manager with approve authority, can sign this off.' +
      (state.me && state.me.role === "accountant" ? " The accountant pays it once it is approved." : "") + "</div>";
  } else if (!b.hasDocument) {
    s += '<div class="bl-why">Attach the invoice first (in the paperwork here, or in DCR Desktop 2) — an approved payment needs the paperwork behind it.</div>';
  } else {
    s += '<input class="bl-note" id="blNote" type="text" maxlength="' + APPROVAL_NOTE_MAX + '" placeholder="Note (optional)" aria-label="Approval note">' +
      '<button type="button" class="bl-approve" id="blGo">&#10003; Approve ' + money(b.amount) + " for payment</button>";
  }
  s += '<div class="bl-msg" id="blMsg"></div></div>';

  if (d.payments.length) {
    const ofPay = (p) => files.filter((f) => f.role === "payment" && String(f.paymentId) === String(p.id));
    s += '<div class="bl-card"><h3>Paid on this bill</h3>' + d.payments.map((p) => '<div class="bl-pay"><span>' +
      h(paymentLabel(p.method)) + (p.method === "check" ? " #" + h(p.checkNumber) : p.reference && p.method !== "cash" ? " · " + h(p.reference) : "") +
      " · " + h(day(p.paidDate)) +
      (p.payee ? '<br><span class="t">to ' + h(p.payee) + "</span>" : "") +
      (ofPay(p).length ? '<br><span class="t">&#128181; ' + ofPay(p).map((f) => '<button type="button" class="bl-link" data-show="' + h(f.id) + '">' + h(f.name) + "</button>").join(", ") + "</span>" : "") +
      (edit ? '<br><button type="button" class="bl-link" data-payfile="' + h(p.id) + '">＋ Add a file (a photo of the check, a confirmation)</button>' : "") +
      (p.live === false
        ? '</span><span><b class="bl-void">Void</b>' + (p.voidReason ? '<br><span class="t">' + h(p.voidReason) + "</span>" : "")
        : "</span><span><b>" + money(p.amount) + "</b>" +
          (p.collectable ? '<br><span class="t">' + (p.toldAt ? "told " + h(p.toldHow) + " " + h(day(p.toldDay)) : "not told yet") + "</span>" : "")) +
      "</span></div>").join("") + "</div>";
  }

  if (b.projectId != null) s += '<a class="bl-secondary" href="pm.html?id=' + encodeURIComponent(b.projectId) + '">Open this project in the progress chart &rarr;</a>';
  if (canApprove(state.me)) s += '<a class="bl-secondary" href="dashboard.html">Back to the approvals list</a>';
  s += '<a class="bl-secondary" href="accounting.html">The Books &rarr;</a>';
  s += "</div></div>";

  if (state.drop) { state.drop.destroy(); state.drop = null; }
  document.getElementById("blRoot").innerHTML = s;
  document.title = "DCR Portal 2 — " + (b.vendor || "Bill") + (b.invoiceNumber ? " #" + b.invoiceNumber : "");
  if (files.length) {
    document.querySelectorAll("[data-f]").forEach((btn) => btn.addEventListener("click", () => show(Number(btn.getAttribute("data-f")))));
    show(state.active);
  }
  document.querySelectorAll("[data-show]").forEach((btn) => btn.addEventListener("click", () => {
    const i = files.findIndex((f) => String(f.id) === btn.getAttribute("data-show"));
    if (i !== -1) show(i);
  }));
  if (edit) wirePaper(hasDoc);
  const how = document.getElementById("blHow");
  if (how) how.addEventListener("click", setPayMethod);
  const go = document.getElementById("blGo");
  if (go) go.addEventListener("click", approve);
}

function barButton(bar, text, id, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.textContent = text;
  b.addEventListener("click", fn);
  bar.appendChild(document.createTextNode(" · "));
  bar.appendChild(b);
  return b;
}

/* Put a file on screen (js/pages/file-viewer.js): an image in place, a PDF in its own tab, a file on the office
   computers named; under it what the file is, and - for a money editor - what can be done with it. */
async function show(i) {
  const f = state.files[i];
  if (!f) return;
  state.active = i;
  state.activeId = f.id;
  document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-f")) === i)));
  const stage = document.getElementById("blStage"), bar = document.getElementById("blViewBar");
  if (!stage || !bar) return;
  bar.textContent = "";
  bar.appendChild(document.createTextNode(f.name + (f.size ? " · " + fmtSize(f.size) : "") + " · " + f.label));
  if (kindOf(f) !== "local") barButton(bar, "Open in a new tab ↗", "blOpen", () => openFile(f));
  if (editsPaper()) {
    if (f.role === "document" && kindOf(f) !== "local") barButton(bar, "Replace…", "blReplace", () => replaceDocument(f));
    if (f.role === "extra") barButton(bar, "Make this the bill's document", "blMakeDoc", () => makeDocument(f));
    if (f.role !== "document") barButton(bar, "Remove", "blRemove", () => removeFile(f));
  }
  await showIn(stage, f, { errorText, onOpen: openFile });
}

function openFile(f) {
  return openTab(f, (e) => toast(errorText(e), "error"));
}

/* ── the paperwork's writes ──────────────────────────────────────────── */

function sayFile(text, bad) {
  const n = document.getElementById("blFileMsg");
  if (!n) { if (text) toast(text, bad ? "error" : "info"); return; }
  n.textContent = text || "";
  n.className = "bl-msg" + (bad ? " err" : "");
}

/** Yes when the bill is not approved, or the person agrees that a new document withdraws the approval. */
async function agreeWithdraw(b) {
  if (!withdrawsApproval(b)) return true;
  return confirmBox(WITHDRAW_TEXT, { title: "This bill is approved", okText: "Change the document" });
}

/* The paperwork card's controls: the file-drop (several at once, drop, paste - heard on the card, never on document),
   the Replace and add-to-a-payment pickers, the queue's lines for this bill. */
function wirePaper(hasDoc) {
  const host = document.getElementById("blDrop");
  if (host) {
    state.drop = mountFileDrop(host, {
      label: hasDoc ? "Add files to this bill: paste, drop or choose (PDFs or photos)"
        : "Attach the invoice: paste, drop or choose (a PDF or photos) — the first becomes the bill's document",
      onFiles: (list) => addFiles(list),
      pasteOn: document.getElementById("blPaper") || undefined,
    });
  }
  const rin = document.getElementById("blReplaceIn");
  if (rin) rin.addEventListener("change", () => { const f = rin.files && rin.files[0]; rin.value = ""; if (f) replaceWith(f); });
  const pin = document.getElementById("blPayIn");
  if (pin) pin.addEventListener("change", () => { const list = Array.from(pin.files || []); pin.value = ""; addPaymentFiles(state.payFor, list); });
  document.querySelectorAll("[data-payfile]").forEach((b) => b.addEventListener("click", () => {
    state.payFor = b.getAttribute("data-payfile");
    if (pin) pin.click();
  }));
  paintQueue();
}

/* Files for the bill: when it has no document, the first PDF or picture becomes it (refused before any byte moves on
   a bill whose document cannot change; asked first on an approved one), the rest are extras. */
async function addFiles(list) {
  const b = state.data.bill;
  const hasDoc = state.files.some((f) => f.role === "document");
  let tag = "";
  if (!hasDoc) {
    const p = documentProblem(b);
    if (p) { sayFile(p, true); return; }
    if (!(await agreeWithdraw(b))) return;
    tag = withdrawsApproval(b) ? "document!" : "document";
  }
  const first = list[0];
  const res = await queueAll(list, uploads.enqueue, (f) => ({ projectId: b.projectId, kind: "bill", billId: b.id, tag: f === first ? tag : "" }));
  queued(res);
}

async function addPaymentFiles(paymentId, list) {
  const b = state.data.bill;
  const p = (state.data.payments || []).find((x) => String(x.id) === String(paymentId));
  if (!p || !list.length) return;
  const bad = list.map((f) => acceptable(f)).find(Boolean);
  if (bad) { sayFile(bad, true); return; }
  const res = await queueAll(list, uploads.enqueue, () => ({ projectId: b.projectId, kind: "payment", billId: b.id, paymentId: p.id }));
  queued(res);
}

function queued(res) {
  if (res.failed.length) sayFile(errorText(res.failed[0].error), true);
  else sayFile(res.queued === 1 ? "The file is on its way." : res.queued + " files are on their way.");
  uploads.drain();
}

/* "Replace…": refused before any byte moves when the document cannot change; the new file is queued with the tag
   "replace:<the old document's id>" ("!" when the person agreed to withdraw the approval). */
function replaceDocument(f) {
  const p = documentProblem(state.data.bill);
  if (p) { sayFile(p, true); return; }
  state.replacing = f;
  const rin = document.getElementById("blReplaceIn");
  if (rin) rin.click();
}

async function replaceWith(file) {
  const b = state.data.bill;
  const old = state.replacing;
  state.replacing = null;
  if (!old) return;
  const bad = acceptable(file);
  if (bad) { sayFile(bad, true); return; }
  if (!(await agreeWithdraw(b))) return;
  const tag = (withdrawsApproval(b) ? "replace!:" : "replace:") + old.id;
  const res = await queueAll([file], uploads.enqueue, () => ({ projectId: b.projectId, kind: "bill", billId: b.id, tag }));
  queued(res);
}

/* "Make this the bill's document": only re-points (the old document stays as an extra). The approval is withdrawn only
   when the person was asked and said yes: a bill approved after the page was drawn answers PT409 (link() says so and
   shows it again), never a silent withdrawal. */
async function makeDocument(f) {
  const b = state.data.bill;
  const p = documentProblem(b);
  if (p) { sayFile(p, true); return; }
  if (!(await agreeWithdraw(b))) return;
  await link(f.id, withdrawsApproval(b), null);
}

/* "Remove": an extra or a payment's file (a soft delete; the database keeps the history). Never the document. */
async function removeFile(f) {
  if (f.role === "document") return;
  if (!(await confirmBox("Take “" + f.name + "” off this bill? It is kept in the history; an admin can bring it back.",
    { title: "Remove the file", okText: "Remove", danger: true }))) return;
  try {
    await filesRepo.removeFile({ id: f.id, version: f.version });
    toast("Removed: " + f.name, "ok");
  } catch (e) {
    sayFile(errorText(e), true);
  }
  await load();
}

/* The bill points at `fileId` (one write at a time); a replaced document is then removed. onlyIfNone (a file queued
   as "the first becomes the document"): only while the bill still has no LIVE document (its paperwork, not the bare
   pointer: a removed document leaves the pointer behind), read again inside the chain - the first file to land wins,
   a later batch queued before it landed stays an extra (the contract §4.1). Nobody asked (agreed false) and the bill
   as the page holds it now is approved - approved after the file was queued or the button pressed, and read again
   since (the page reopened over the durable queue, another file landed, a Remove, an approve): the file stays an
   extra, because the versioned write would match and withdraw that approval with no question (a page that did not
   read it again gets PT409 from setDocument). A replace whose document an earlier replace already took off (two
   Replace… in a row) points the bill at the newest file and leaves the earlier replacement an extra. The page is
   drawn again before its words are written (a redraw would wipe them). */
function link(fileId, agreed, oldId, onlyIfNone, name) {
  state.chain = state.chain.then(async () => {
    if (onlyIfNone) await load();
    const why = landingProblem(state.data.bill, state.files, { first: !!onlyIfNone, agreed: !!agreed });
    if (why === "has") {
      if (name) sayFile("“" + name + "” is kept as another file of this bill: the bill has its document already.");
      return;
    }
    if (why === "approved") {
      if (!onlyIfNone) await load();
      sayFile("The bill was approved meanwhile: the file is kept as another file of the bill. Look at it again, then make it the document (that withdraws the approval).", true);
      return;
    }
    const replaces = oldId != null && String(state.data.bill.documentFileId) === String(oldId);
    try {
      await books.setDocument(state.data.bill, fileId, { withdraw: !!agreed });
      toast(oldId != null ? "The document is replaced." : "That file is now the bill's document.", "ok");
    } catch (e) {
      const conflict = e && (e.code === "PT409" || e.status === 409);
      await load();
      sayFile(conflict ? "The bill was approved or changed meanwhile: the file is kept as another file of the bill. Look at it again, then make it the document."
        : errorText(e), true);
      return;
    }
    let left = "";
    if (replaces) {
      try { await filesRepo.removeFile({ id: oldId }); } catch (e) { left = "The new document is in place; the old one stays as another file: " + errorText(e); }
    }
    await load();
    if (left) sayFile(left, true);
    const i = state.files.findIndex((f) => String(f.id) === String(fileId));
    if (i !== -1) show(i);
  });
  return state.chain;
}

/* the queue's lines for this bill, and what to do when one of its files has landed */
function paintQueue() {
  const box = document.getElementById("blQueue");
  if (!box) return;
  box.textContent = "";
  state.queue.forEach((it) => {
    const line = document.createElement("div");
    line.className = "bl-qi" + (it.state === "failed" ? " bad" : "");
    line.textContent = (it.state === "failed" ? "⚠ " : "⏳ ") + it.name + " — " + uploads.itemLabel(it, navigator.onLine !== false);
    if (it.state === "failed") {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "bl-link";
      again.textContent = "Try again";
      again.addEventListener("click", () => uploads.retryAll());
      const off = document.createElement("button");
      off.type = "button";
      off.className = "bl-link";
      off.textContent = "Take it off";
      off.addEventListener("click", () => uploads.remove(it.id));
      line.appendChild(document.createTextNode(" "));
      line.appendChild(again);
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(off);
    }
    box.appendChild(line);
  });
}

function landed(item, row) {
  const tag = String(item.tag || "");
  if (row && row.id != null && /^document!?$/.test(tag)) return link(row.id, tag === "document!", null, true, row.name || item.name);
  const m = /^replace(!?):(\d+)$/.exec(tag);
  if (row && row.id != null && m) return link(row.id, m[1] === "!", m[2]);
  return load();
}

function watchQueue() {
  if (state.watching) return;
  state.watching = true;
  uploads.onProgress((items, evt) => {
    state.queue = items.filter((i) => String(i.billId) === BID);
    paintQueue();
    if (evt && evt.type === "done" && evt.item && String(evt.item.billId) === BID) landed(evt.item, evt.row);
  });
  uploads.drain();
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
    if (editsPaper()) watchQueue();
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

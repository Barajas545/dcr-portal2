/* The public subcontractor form (port of the old submit.html / submit.js; BLUEPRINT 2.2.7, 3.3.11, P5 5c).

   No sign-in, no top bar, no common2.js, nothing that assumes a Portal 2 session: the people using this page do
   not have one. Everything goes through repo/subform.js (the Edge Function "subform" and the one signed upload it
   hands out); map/subform.js holds the rules. The function checks everything again: what happens here only saves
   the sub a round trip.

   Flow: the kind -> the job (a search of at least 3 characters; the function answers open jobs only, at most 8)
   -> the details, the amount, the paperwork, the drawn signature and the declaration -> Submit: the function
   files a Pending submission and answers its reference and one upload for the paperwork -> the file goes to it
   -> "attached" -> the reference on screen. If the upload fails the submission still stands, and the page says
   to e-mail the paperwork quoting the reference. */

import { searchProjects, submit, sendDocument } from "../repo/subform.js";
import { kindCopy, checkFile, hitLines, pickedLabel, localProblems, payloadFor, SEARCH_MIN } from "../map/subform.js";

const el = (id) => document.getElementById(id);
const state = { kind: "Invoice", project: null, file: null, signed: false, busy: false };

function say(text, cls) {
  const m = el("sfMsg");
  m.textContent = text || "";
  m.className = "sf-msg" + (cls ? " " + cls : "");
}

function setLabel(id, words, optional) {
  const l = el(id);
  l.textContent = words + (optional ? " " : "");
  if (optional) {
    const o = document.createElement("span");
    o.className = "opt";
    o.textContent = "(optional)";
    l.appendChild(o);
  }
}

/* ── which kind ───────────────────────────────────────────────────── */
function setKind(kind) {
  state.kind = kind;
  const inv = kind === "Invoice";
  el("sfKindInv").setAttribute("aria-pressed", String(inv));
  el("sfKindCo").setAttribute("aria-pressed", String(!inv));
  const c = kindCopy(kind);
  el("sfMoneyHead").textContent = c.head;
  setLabel("sfNumberLabel", c.number, true);
  setLabel("sfDateLabel", c.date, true);
  el("sfDescLabel").textContent = c.desc;
  el("sfDesc").placeholder = c.placeholder;
}

/* ── finding the job ──────────────────────────────────────────────── */
let searchTimer = null, searchSeq = 0;

function note(box, text, err) {
  box.textContent = "";
  const d = document.createElement("div");
  d.className = "note" + (err ? " err" : "");
  d.textContent = text;
  box.appendChild(d);
  box.hidden = false;
}

async function runSearch(q, seq) {
  const box = el("sfHits");
  let d;
  try {
    d = await searchProjects(q);
  } catch (e) {
    if (seq !== searchSeq) return;
    note(box, e.status === 429 ? e.message : "Could not search just now. Check your connection.", true);
    return;
  }
  if (seq !== searchSeq) return;        // typing is faster than the network: only the last search draws
  if (!d.projects.length) { note(box, "No open job matches that. Try the street address or the job number."); return; }
  box.textContent = "";
  d.projects.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hit";
    const l = hitLines(p);
    const t = document.createElement("b");
    t.textContent = l.title;
    const w = document.createElement("span");
    w.textContent = l.where;
    b.appendChild(t);
    b.appendChild(w);
    b.addEventListener("click", () => choose(p));
    box.appendChild(b);
  });
  if (d.more) {
    const m = document.createElement("div");
    m.className = "note";
    m.textContent = "and " + d.more + " more — add another word to narrow it";
    box.appendChild(m);
  }
  box.hidden = false;
}

function choose(p) {
  state.project = p;
  el("sfPickedText").textContent = pickedLabel(p);
  el("sfPicked").hidden = false;
  el("sfHits").hidden = true;
  el("sfSearch").value = "";
  say("");
}

/* ── the paperwork ────────────────────────────────────────────────── */
function takeFile(f) {
  if (!f) return;
  const c = checkFile(f);
  if (!c.ok) { say(c.message, "err"); return; }
  state.file = { blob: f, type: c.type, size: c.size };
  el("sfDocName").textContent = c.label;
  el("sfDoc").hidden = false;
  say("");
}

/* ── the signature ────────────────────────────────────────────────── */
/* Drawn at a fixed internal resolution and scaled by CSS, so a signature made on a phone and one made on a laptop
   produce the same size of PNG. Pointer events cover mouse, pen and touch in one path; touch-action: none in the
   CSS stops the page scrolling out from under the finger. */
function signaturePad() {
  const cv = el("sfSig"), ctx = cv.getContext("2d");
  let drawing = false, last = null;
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#12243a";
  ctx.fillStyle = "#12243a";
  const at = (ev) => {
    const r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (cv.width / r.width), y: (ev.clientY - r.top) * (cv.height / r.height) };
  };
  const marked = () => {
    if (state.signed) return;
    state.signed = true;
    el("sfSigHint").hidden = true;
    el("sfSigState").textContent = "Signed";
    el("sfSigWrap").classList.add("signed");
  };
  cv.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* an old browser: drawing still works */ }
    drawing = true;
    last = at(ev);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.6, 0, Math.PI * 2); ctx.fill();   // a tap still leaves a mark
    marked();
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!drawing) return;
    ev.preventDefault();
    const p = at(ev);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => cv.addEventListener(t, () => { drawing = false; }));
  el("sfSigClear").addEventListener("click", () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    state.signed = false;
    el("sfSigHint").hidden = false;
    el("sfSigState").textContent = "Not signed";
    el("sfSigWrap").classList.remove("signed");
  });
  return () => cv.toDataURL("image/png");
}

/* ── submitting ───────────────────────────────────────────────────── */
async function onSubmit(ev, signatureData) {
  ev.preventDefault();
  if (state.busy) return;
  const local = localProblems(state);
  if (local.length) { say(local.join("\n"), "err"); return; }
  const payload = payloadFor(state, {
    company: el("sfCompany").value, contact: el("sfContact").value, email: el("sfEmail").value, phone: el("sfPhone").value,
    number: el("sfNumber").value, amount: el("sfAmount").value, description: el("sfDesc").value,
    date: el("sfDate").value, due: el("sfDue").value, signatureName: el("sfSigName").value,
    signature: signatureData(), agree: el("sfAgree").checked, website: el("sfWebsite").value,
  });
  state.busy = true;
  el("sfGo").disabled = true;
  say("Sending…", "busy");
  let out;
  try {
    out = await submit(payload);
  } catch (e) {
    state.busy = false;
    el("sfGo").disabled = false;
    say((e.errors || [e.message]).join("\n"), "err");
    return;
  }
  /* The submission exists now. The document is a second step straight to Storage, on the one upload the function
     just made for this file. If it fails the submission still stands - it shows as missing its paperwork, which
     somebody can chase. */
  let attached = false;
  if (out.upload) {
    say("Uploading the document…", "busy");
    try { attached = await sendDocument(out.reference, out.upload, state.file.blob, state.file.type); } catch (e) { attached = false; }
  }
  done(out.reference, attached);
}

function done(reference, attached) {
  el("sfForm").hidden = true;
  const d = el("sfDone");
  d.className = "sf-card sf-done";
  d.textContent = "";
  const add = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; d.appendChild(n); return n; };
  add("div", "tick", "✓");
  add("h2", "", "Received");
  add("p", "", "Keep this reference. Quote it if you call about this " + state.kind.toLowerCase() + ".");
  add("div", "sf-ref", reference).id = "sfRef";
  if (attached) {
    add("p", "", "Your document was received. Somebody at " + companyName() + " will review this and be in touch.");
  } else {
    add("p", "warn", "We could not receive your document. Your submission was saved — please email it quoting the reference above, or it cannot be approved for payment.");
  }
  const again = add("p", "", "");
  again.style.marginTop = "18px";
  const a = document.createElement("a");
  a.href = "submit.html";
  a.textContent = "Send another";
  again.appendChild(a);
  d.hidden = false;
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
}

function companyName() {
  const c = (globalThis.DCR2_CONFIG && globalThis.DCR2_CONFIG.COMPANY) || {};
  return c.name || (globalThis.DCR2_CONFIG && globalThis.DCR2_CONFIG.COMPANY_NAME) || "DCR Framing";
}

function start() {
  const cfg = globalThis.DCR2_CONFIG || {};
  const info = cfg.COMPANY || {};
  if (info.logo) { el("sfLogo").src = info.logo; el("sfLogo").hidden = false; }
  el("sfCompanyName").textContent = companyName();
  el("sfFoot").textContent = [info.legalName || info.name || "", info.phone || "", info.license || ""].filter(Boolean).join(" · ");
  document.title = "Submit an invoice or change order — " + companyName();

  el("sfKindInv").addEventListener("click", () => setKind("Invoice"));
  el("sfKindCo").addEventListener("click", () => setKind("Change order"));
  setKind("Invoice");

  el("sfSearch").addEventListener("input", function () {
    clearTimeout(searchTimer);
    const q = this.value.trim();
    if (q.length < SEARCH_MIN) { el("sfHits").hidden = true; searchSeq++; return; }
    const seq = ++searchSeq;
    searchTimer = setTimeout(() => runSearch(q, seq), 250);
  });
  el("sfSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  el("sfClearPick").addEventListener("click", () => { state.project = null; el("sfPicked").hidden = true; el("sfSearch").focus(); });

  el("sfScan").addEventListener("click", () => el("sfCam").click());
  el("sfPick").addEventListener("click", () => el("sfFile").click());
  ["sfCam", "sfFile"].forEach((id) => el(id).addEventListener("change", function () { takeFile(this.files && this.files[0]); }));
  el("sfDocClear").addEventListener("click", () => {
    state.file = null;
    el("sfDoc").hidden = true;
    el("sfCam").value = "";
    el("sfFile").value = "";
  });

  const signatureData = signaturePad();
  el("sfForm").addEventListener("submit", (ev) => onSubmit(ev, signatureData));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

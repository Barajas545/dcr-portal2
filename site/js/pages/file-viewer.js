/* The money files' viewer (the Books program, release A; design-portal §4.4): one way to look at a bill's paperwork,
   a payment's files and a cost's receipts - the bill page, the expense dialog and a project's Expenses tab here, the
   payment panel and the Books later (accounting.js's showDoc / isImage and bill.js's stage, in one module).

   * kindOf(file)              image (shown in place) | heic (Chrome cannot draw one) | pdf | file | local;
   * showIn(stage, file)       a picture in place through a 120 s signed URL (its 320 px preview for a tile); a PDF or
                               any other file names itself and opens in its own tab (the site's policy lets no page
                               frame another site's file); a file kept on the office computers is named, not opened;
   * claimStage(stage)         the last file asked for on a stage wins: showIn takes the stage's turn, and so does a
                               caller that writes its own words there (the payment panel's "opened in a new tab");
   * openTab(file)             a new tab opened on the click itself (a pop-up blocker allows it), told nothing about
                               this page (opener = null), then sent to the signed URL;
   * openViewer(files, at)     a dialog paging "N of M" (← → and Esc), as the ledger's viewer does;
   * the bill's paperwork (pure, the contract §4.1): paperwork(bill, files, payments) - the document first, then the
     extras, then each payment's files labelled "Check #1043 · Oct 28"; documentProblem(bill) - why the document can't
     change now (a void bill, a bill marked entered in QuickBooks, a paid one: refused BEFORE any byte moves);
     withdrawsApproval(bill) and WITHDRAW_TEXT - the question asked first on an approved bill; landingProblem(bill,
     paperwork, o) - whether a file that has just landed may now become the bill's document.
   Every name is put on the page with textContent, never as markup. Files are accepted in any of the shapes the repos
   answer (repo/books.js loadBill's {storagePath, previewPath, cloud}, repo/ledger.js's {path, preview, storage},
   or a files row). */

import { signedUrl } from "../repo/files.js";
import { fmtSize, SIGNED_DOC_S } from "../map/files.js";
import { paymentLabel, shortDay } from "../map/books.js";

/* ── pure ─────────────────────────────────────────────────────────────── */

/** Any file shape -> {id, name, mime, size, local, path, preview, billId, paymentId, version}. */
export function fileOf(f) {
  const x = f || {};
  const storage = x.storage || (x.cloud === false ? "local" : "cloud");
  return {
    id: x.id == null ? null : x.id,
    name: String(x.name || ""),
    mime: String(x.mime || x.mimeType || ""),
    size: x.size == null ? null : Number(x.size),
    local: storage === "local",
    path: x.storagePath || x.path || x.storage_path || null,
    preview: x.previewPath || x.preview || x.preview_path || null,
    billId: x.billId !== undefined ? x.billId : x.bill_id !== undefined ? x.bill_id : null,
    paymentId: x.paymentId !== undefined ? x.paymentId : x.payment_id !== undefined ? x.payment_id : null,
    version: x.version == null ? null : Number(x.version),
  };
}

export function kindOf(f) {
  const x = fileOf(f);
  if (x.local || !x.path) return "local";
  const m = x.mime.toLowerCase(), n = x.name.toLowerCase();
  if (/^image\/hei[cf]$/.test(m) || /\.hei[cf]$/.test(n)) return "heic";
  if (/^image\/(jpeg|png|gif|webp|bmp)$/.test(m) || /\.(jpe?g|jfif|png|gif|webp|bmp)$/.test(n)) return "image";
  if (m === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  return "file";
}
export function isImage(f) { return kindOf(f) === "image"; }

/** "Check #1043 · Oct 28", "Cash · Oct 28", "ACH transfer · 0041 · Oct 28". */
export function paymentFileLabel(p) {
  if (!p) return "A payment";
  const ref = p.method === "check" ? (p.checkNumber ? " #" + p.checkNumber : "") : p.reference && p.method !== "cash" ? " · " + p.reference : "";
  const day = shortDay(p.paidDate);
  return paymentLabel(p.method) + ref + (day ? " · " + day : "");
}

/** The bill's files in the order shown: the document, the extras (newest first, as read), each payment's files.
    Each: the file, plus role (document | extra | payment), label (what it is, in words) and payment (or null). */
export function paperwork(bill, files, payments) {
  const b = bill || {};
  const pays = new Map((payments || []).map((p) => [String(p.id), p]));
  const doc = b.documentFileId == null ? null : String(b.documentFileId);
  const out = (files || []).map((f) => {
    const x = fileOf(f);
    const pid = x.paymentId == null ? null : String(x.paymentId);
    const role = doc !== null && String(x.id) === doc ? "document" : pid !== null ? "payment" : "extra";
    const p = pid !== null ? pays.get(pid) || null : null;
    const label = role === "document" ? "The bill's document" : role === "payment" ? "Proof of payment: " + paymentFileLabel(p) : "Another file of this bill";
    return Object.assign({}, f, { role, label, payment: p });
  });
  const rank = { document: 0, extra: 1, payment: 2 };
  return out.map((f, i) => [f, i]).sort((a, c) => rank[a[0].role] - rank[c[0].role] || a[1] - c[1]).map((x) => x[0]);
}

/** Why the bill's document cannot change now ("" when it can): a void bill, a bill marked entered in QuickBooks, a
    bill with payments (the database's own locks - refused here before any byte moves). */
export function documentProblem(bill) {
  const b = bill || {};
  if (b.void) return "This bill was voided: its paperwork stays as it is.";
  if (b.deleted) return "This bill was deleted.";
  if (b.entered) return "This bill is marked entered in QuickBooks: unmark it in the Books first (and correct QuickBooks), then change its document.";
  if (Number(b.paid) > 0) return "This bill has payments: its document stays as it is. Add the file as another file of the bill.";
  return "";
}

/** A new document on an approved bill withdraws the approval (the database clears it): asked first. */
export function withdrawsApproval(bill) { return !!(bill && bill.approved); }
export const WITHDRAW_TEXT = "A new document withdraws the approval — the bill goes back to waiting, and an approver approves it again.";

/** May the bill be pointed at a file now (a file that has just landed, or "Make this the bill's document" whose turn
    came), judged on the bill as the page holds it NOW and its paperwork (paperwork()'s roles)? o: {first (queued as
    "the first becomes the document"), agreed (the person was asked and said yes to withdrawing an approval)}.
    -> "" (point it), "has" (a first file, and the bill has a live document already: the first file to land wins - a
    pointer to a removed file is no document, approve_bill refuses that bill too) or "approved" (the bill is approved
    and the person was never asked: it was approved after the file was queued or the button pressed, and the page read
    it again since, so a versioned write would match and withdraw the approval silently - the file stays an extra). */
export function landingProblem(bill, files, o) {
  const x = o || {};
  if (x.first && (files || []).some((f) => f && f.role === "document")) return "has";
  if (!x.agreed && withdrawsApproval(bill)) return "approved";
  return "";
}

/* ── on the page ──────────────────────────────────────────────────────── */

const STYLE = [
  ".fv{position:fixed;inset:0;z-index:1200;background:rgba(10,14,20,.72);display:flex;align-items:center;justify-content:center;padding:16px}",
  ".fv[hidden]{display:none}",
  ".fv-card{background:var(--surface,#fff);color:var(--text,#1b2733);border-radius:12px;width:min(980px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow)}",
  ".fv-hd{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:10px 12px;border-bottom:1px solid var(--border,#dfe3e8);font-size:13px}",
  ".fv-hd .nm{flex:1 1 160px;min-width:0;font-weight:700;overflow-wrap:anywhere}",
  ".fv-hd .n{color:var(--text-muted,#61738a)}",
  ".fv-b{border:1px solid var(--border,#dfe3e8);background:var(--surface-2,#f0f2f5);color:var(--text,#1b2733);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}",
  ".fv-bd{flex:1;min-height:200px;overflow:auto;display:flex;align-items:center;justify-content:center;background:var(--surface-2,#f0f2f5)}",
  ".fv-bd img{max-width:100%;max-height:78vh;display:block}",
  ".fv-msg{padding:36px 18px;text-align:center;color:var(--text-muted,#61738a);font-size:13.5px;line-height:1.6;overflow-wrap:anywhere}",
  ".fv-msg b{color:var(--text,#1b2733)}",
].join("\n");

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("fvStyle")) return;
  const s = document.createElement("style");
  s.id = "fvStyle";
  s.textContent = STYLE;
  (document.head || document.documentElement).appendChild(s);
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const urlCache = new Map();          // path -> {p, until}: a signed URL lives 120 s; kept a little less
function sign(path) {
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.p;
  const p = signedUrl(path, SIGNED_DOC_S).catch((e) => { urlCache.delete(path); throw e; });
  urlCache.set(path, { p, until: Date.now() + 100000 });
  return p;
}

/** A signed URL for the file (its preview when asked and there is one), or null for a file on the office computers. */
export async function urlFor(f, preview) {
  const x = fileOf(f);
  if (x.local || !x.path) return null;
  return sign(preview && x.preview ? x.preview : x.path);
}

/** Open the file in a new tab (the tab is opened on the click itself, then sent on) -> true once it was sent there,
    false when it could not be (onError was told why: a caller writes "opened" only on true). */
export async function openTab(f, onError) {
  const x = fileOf(f);
  if (x.local || !x.path) { if (onError) onError(new Error("This file is on the office computers: open it there.")); return false; }
  const w = window.open("", "_blank");
  try {
    const url = await urlFor(x, false);
    if (!url) throw new Error("No link for this file.");
    if (w) { try { w.opener = null; } catch (e) { /* */ } w.location.href = url; } else location.href = url;
    return true;
  } catch (e) {
    if (w) w.close();
    if (onError) onError(e);
    return false;
  }
}

function message(stage, bold, rest, button) {
  stage.textContent = "";
  const m = node("div", "fv-msg bl-smsg");
  if (bold) { m.appendChild(node("b", "", bold)); m.appendChild(node("br")); }
  m.appendChild(document.createTextNode(rest || ""));
  if (button) { m.appendChild(node("br")); m.appendChild(button); }
  stage.appendChild(m);
  return m;
}

/** Take `stage`'s turn -> mine(): true while no later file was asked for on that stage. Whoever writes on a stage
    takes its turn first (showIn does; so does the payment panel's PDF / office-file path, which writes its own words),
    so the last file asked for wins whichever answer comes back last. */
export function claimStage(stage) {
  const turn = (stage._fvTurn = (stage._fvTurn || 0) + 1);
  return () => stage._fvTurn === turn;
}

/** Put a file on `stage`. o: {errorText(e), onOpen(file) (the Open button; default openTab)} -> resolves when shown.
    The last file asked for wins: a picture whose signed link answers after another file was put on the same stage is
    dropped (each call takes the stage's turn first, so a PDF's or an office file's words also make it stale). */
export async function showIn(stage, f, opts) {
  const mine = claimStage(stage);
  const o = opts || {};
  ensureStyle();
  const x = fileOf(f);
  const kind = kindOf(x);
  const err = (e) => (o.errorText ? o.errorText(e) : (e && e.message) || "Could not open it.");
  if (kind === "local") { message(stage, x.name, "On the office computers — open it in DCR Desktop 2."); return; }
  if (kind !== "image") {
    const b = node("button", "fv-b bl-secondary", kind === "pdf" ? "Open the PDF ↗" : "Open it ↗");
    b.type = "button";
    b.style.maxWidth = "260px";
    b.style.margin = "12px auto 0";
    b.addEventListener("click", () => (o.onOpen ? o.onOpen(f) : openTab(f, (e) => { if (mine()) message(stage, x.name, err(e)); })));
    message(stage, x.name, kind === "pdf" ? "A PDF opens in its own tab." : kind === "heic" ? "An iPhone photo (HEIC): this browser cannot show it here — open it in its own tab." : "This kind of file opens in its own tab.", b);
    return;
  }
  message(stage, "", "Opening " + x.name + "…");
  try {
    const url = await urlFor(x, false);
    if (!mine()) return;                             // another file was put here meanwhile
    if (!url) throw new Error("No link for this file.");
    stage.textContent = "";
    const img = node("img");
    img.alt = x.name;
    img.src = url;
    stage.appendChild(img);
  } catch (e) {
    if (!mine()) return;
    message(stage, x.name, err(e)).style.color = "var(--danger, #c8371f)";
  }
}

/* the dialog: one for the page */
const view = { files: [], at: 0, opts: {}, el: null, last: null };
function viewer() {
  if (view.el) return view.el;
  ensureStyle();
  const host = node("div", "fv");
  host.id = "fvView";
  host.hidden = true;
  const card = node("div", "fv-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "fvName");
  const hd = node("div", "fv-hd");
  const prev = node("button", "fv-b", "←"); prev.type = "button"; prev.id = "fvPrev"; prev.title = "Previous (left arrow)";
  const next = node("button", "fv-b", "→"); next.type = "button"; next.id = "fvNext"; next.title = "Next (right arrow)";
  const nm = node("span", "nm"); nm.id = "fvName";
  const n = node("span", "n"); n.id = "fvN";
  const open = node("button", "fv-b", "Open in a new tab ↗"); open.type = "button"; open.id = "fvOpen";
  const close = node("button", "fv-b", "✕"); close.type = "button"; close.id = "fvClose"; close.title = "Close (Esc)";
  [prev, next, nm, n, open, close].forEach((x) => hd.appendChild(x));
  const bd = node("div", "fv-bd"); bd.id = "fvBody";
  card.appendChild(hd);
  card.appendChild(bd);
  host.appendChild(card);
  document.body.appendChild(host);
  prev.addEventListener("click", () => go(view.at - 1));
  next.addEventListener("click", () => go(view.at + 1));
  open.addEventListener("click", () => openTab(view.files[view.at], view.opts.onError));
  close.addEventListener("click", closeViewer);
  host.addEventListener("click", (e) => { if (e.target === host) closeViewer(); });
  // heard first (the capture phase) and an Esc kept to the viewer: a dialog under it (the expense dialog closes on Esc
  // too, and would throw away what was typed) never hears the key that closed the viewer
  document.addEventListener("keydown", (e) => {
    if (host.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeViewer(); }
    else if (e.key === "ArrowLeft") go(view.at - 1);
    else if (e.key === "ArrowRight") go(view.at + 1);
  }, true);
  view.el = host;
  return host;
}

function go(at) {
  const files = view.files;
  if (!files.length) return;
  view.at = Math.max(0, Math.min(at, files.length - 1));
  const f = files[view.at];
  const x = fileOf(f);
  document.getElementById("fvName").textContent = x.name + (x.size ? " · " + fmtSize(x.size) : "");
  document.getElementById("fvN").textContent = files.length > 1 ? (view.at + 1) + " of " + files.length : "";
  document.getElementById("fvPrev").hidden = files.length < 2;
  document.getElementById("fvNext").hidden = files.length < 2;
  document.getElementById("fvOpen").hidden = kindOf(x) === "local";
  showIn(document.getElementById("fvBody"), f, view.opts);
}

/** Page through `files` from `at` in a dialog. opts: {errorText, onError}. */
export function openViewer(files, at, opts) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return;
  const host = viewer();
  view.files = list;
  view.opts = opts || {};
  view.last = document.activeElement;
  host.hidden = false;
  go(at || 0);
  setTimeout(() => { const c = document.getElementById("fvClose"); if (c) c.focus(); }, 0);
}

export function closeViewer() {
  if (!view.el) return;
  view.el.hidden = true;
  view.files = [];
  const back = view.last;
  view.last = null;
  try { if (back && back.focus) back.focus(); } catch (e) { /* */ }
}

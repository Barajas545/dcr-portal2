/* The Books pages' small shared parts (the Books program, release B part 2a; design-portal §3.1): the sticky chip bar
   of counts that jumps to its section, the jump itself (moved out of accounting.js's), and the one sheet the Accounting
   page's dialogs open in (Ask to approve, tell a payee by text, the message templates) - full screen on a phone.

   * chipBar(items)       markup of the bar: items [{to, icon, label, count}] - every word escaped;
   * wireJumps(root)      [data-jump] buttons and links scroll to their section, marked once the scroll has stopped;
   * jump(id)             that;
   * openSheet(o)         {title, html, wide, onClose} -> {card, body, close(), setBusy(on)}: one sheet at a time, Esc and
                          the backdrop close it (not while busy, and an Esc meant for a question over it stays the
                          question's), the focus goes back where it was. The html is the caller's, built with h(). */

import { esc } from "./shell.js";

const h = esc;

/** The chip bar: ⏸ Approvals 3 · ✎ Checks 2 · ☎ Pick-ups 1 · ✓ Paid (30 d) 6. */
export function chipBar(items) {
  return '<nav class="bh-chips" id="bhChips" aria-label="Jump to a list">' + (items || []).map((x) =>
    '<button type="button" class="bh-chip' + (x.count ? " on" : "") + '" data-jump="' + h(x.to) + '" aria-label="' + h(x.label + ": " + x.count) + '">' +
      '<span class="ic" aria-hidden="true">' + h(x.icon) + "</span>" + h(x.label) + ' <b>' + h(String(x.count)) + "</b></button>").join("") + "</nav>";
}

/** Scrolled to AND marked, once the scrolling has stopped. */
export function jump(id) {
  const s = document.getElementById(id);
  if (!s) return;
  const easy = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  s.scrollIntoView({ behavior: easy ? "auto" : "smooth", block: "start" });
  let last = null, tries = 0;
  (function settle() {
    const y = Math.round(window.scrollY || 0);
    if (y === last || ++tries > 40) {
      s.classList.remove("ac-flash");
      void s.offsetWidth;
      s.classList.add("ac-flash");
      return;
    }
    last = y;
    setTimeout(settle, 60);
  })();
}

export function wireJumps(root) {
  (root || document).querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    jump(b.getAttribute("data-jump"));
  }));
}

/* ── the sheet ────────────────────────────────────────────────────────── */

/* The sheet's look (and the hand-text box's), on Portal 2's theme tokens (css/styles.css: light and dark), scoped to
   the sheet: it is opened on pages without css/books.css too (the bill page's Ask). */
export const SHEET_CSS =
  ".bh-dlg{position:fixed;inset:0;z-index:1100;background:rgba(10,14,20,.6);display:flex;align-items:center;justify-content:center;padding:14px;}" +
  ".bh-dlg[hidden]{display:none!important;}" +
  ".bh-dlg *,.bh-dlg *::before,.bh-dlg *::after{box-sizing:border-box;}" +
  ".bh-dlg-card{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;width:100%;max-width:540px;" +
  "max-height:calc(100vh - 28px);overflow:auto;padding:14px 16px 16px;box-shadow:0 18px 50px rgba(0,0,0,.35);}" +
  ".bh-dlg-card.wide{max-width:780px;}" +
  ".bh-dlg-hd{display:flex;align-items:center;gap:10px;margin-bottom:10px;}" +
  ".bh-dlg-hd h3{margin:0;font-size:16px;font-weight:800;flex:1;min-width:0;overflow-wrap:anywhere;}" +
  ".bh-x{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;width:36px;height:36px;font-size:20px;line-height:1;cursor:pointer;}" +
  ".bh-dlg .ac-b,.bh-text .ac-b{padding:8px 13px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);" +
  "background:var(--surface);color:var(--text);text-decoration:none;display:inline-block;min-height:38px;}" +
  ".bh-dlg .ac-b.go,.bh-text .ac-b.go{background:var(--ok);border-color:var(--ok);color:#fff;}" +
  ".bh-dlg .ac-b:disabled,.bh-text .ac-b:disabled{opacity:.5;cursor:default;}" +
  ".bh-dlg .btn-accept{padding:9px 16px;border-radius:8px;border:1px solid var(--ok);background:var(--ok);color:#fff;font:inherit;font-size:13.5px;" +
  "font-weight:700;cursor:pointer;min-height:40px;}" +
  ".bh-dlg .btn-accept:disabled{opacity:.5;cursor:default;}" +
  ".bh-dlg .ac-msg,.bh-text .ac-msg{font-size:12.5px;margin-top:8px;white-space:pre-line;color:var(--text);overflow-wrap:anywhere;}" +
  ".bh-dlg .ac-msg.err,.bh-text .ac-msg.err{color:var(--danger);font-weight:600;}" +
  ".bh-dlg .ac-msg.ok,.bh-text .ac-msg.ok{color:var(--ok);font-weight:600;}" +
  ".bh-dlg .ac-note,.bh-text .ac-note{font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.5;}" +
  ".bh-dlg .ac-none{color:var(--text-muted);font-size:13px;padding:10px 2px;}" +
  ".bh-bills ul{margin:4px 0 10px;padding-left:18px;font-size:13px;}.bh-bills li{margin:2px 0;overflow-wrap:anywhere;}" +
  ".bh-who{border:1px solid var(--border);border-radius:10px;padding:8px 10px 10px;margin:0 0 10px;min-width:0;}" +
  ".bh-who legend{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted);padding:0 4px;}" +
  ".bh-ap{padding:8px 0;}.bh-ap+.bh-ap{border-top:1px solid var(--border);}" +
  ".bh-ap .nm{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;min-height:36px;overflow-wrap:anywhere;}" +
  ".bh-ap .nm input,.bh-ch input{width:20px;height:20px;flex:none;margin:0;}" +
  ".bh-usual{font-size:11px;font-weight:800;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:1px 8px;white-space:nowrap;}" +
  ".bh-ch{display:flex;flex-wrap:wrap;gap:4px 16px;padding-left:28px;font-size:13px;}" +
  ".bh-ch label{display:flex;align-items:center;gap:6px;min-height:34px;cursor:pointer;}.bh-ch label.off{color:var(--text-muted);cursor:default;}" +
  ".bh-ch .why{color:var(--text-muted);font-size:12px;}" +
  ".bh-edit{margin:0 0 6px;}.bh-edit summary{cursor:pointer;font-weight:700;font-size:13px;padding:6px 0;color:var(--accent);}" +
  ".bh-edit label,.bh-tplc label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin:8px 0 3px;}" +
  ".bh-edit input,.bh-edit textarea,.bh-tplc input,.bh-tplc textarea{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;" +
  "background:var(--surface);color:var(--text);font:inherit;font-size:14px;}" +
  ".bh-edit textarea,.bh-tplc textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.45;}" +
  ".bh-count{font-size:11.5px;color:var(--text-muted);margin-top:3px;}" +
  ".bh-prev{border:1px dashed var(--border);border-radius:10px;padding:8px 10px;margin-top:8px;}" +
  ".bh-prev-h{font-size:11.5px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin:4px 0;}" +
  ".bh-prev-s{font-weight:700;font-size:13.5px;margin:2px 0 4px;overflow-wrap:anywhere;}" +
  ".bh-text{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:8px 0;background:var(--surface);color:var(--text);}" +
  ".bh-text-h{font-weight:700;font-size:13.5px;margin-bottom:6px;overflow-wrap:anywhere;}" +
  ".bh-text-b{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.5;background:rgba(127,127,127,.08);" +
  "border-radius:8px;padding:8px 10px;margin:4px 0;max-height:260px;overflow:auto;overflow-wrap:anywhere;color:var(--text);}" +
  ".bh-text .bh-acts,.bh-dlg .bh-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;}" +
  ".bh-dlg .bh-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;border-top:1px solid var(--border);padding-top:12px;}" +
  ".bh-dlg .bh-st{font-size:13px;font-weight:600;margin:6px 0;overflow-wrap:anywhere;}.bh-dlg .bh-st.ok{color:var(--ok);}.bh-dlg .bh-st.bad{color:var(--danger);}" +
  ".bh-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--border);margin-bottom:10px;}" +
  ".bh-tabs button{border:0;border-bottom:2px solid transparent;background:none;color:var(--text-muted);font:inherit;font-weight:700;font-size:13px;padding:8px 10px;cursor:pointer;}" +
  ".bh-tabs button[aria-selected=\"true\"]{color:var(--accent);border-bottom-color:var(--accent);}" +
  ".bh-chiprow{display:flex;flex-wrap:wrap;gap:5px;align-items:center;}.bh-chiprow .lab{font-size:12px;font-weight:700;color:var(--text-muted);margin-right:2px;}" +
  ".bh-ph{border:1px solid var(--border);background:var(--surface-2,rgba(127,127,127,.08));color:var(--text);border-radius:6px;padding:4px 7px;" +
  "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;cursor:pointer;min-height:30px;}" +
  ".bh-tplc{border-top:1px solid var(--border);margin-top:12px;padding-top:6px;}.bh-tplc h4{margin:6px 0 2px;font-size:13px;}" +
  ".bh-warn{color:var(--danger);font-size:12px;font-weight:600;margin-top:4px;}" +
  "@media (max-width:560px){.bh-dlg{padding:0;align-items:stretch;}.bh-dlg-card,.bh-dlg-card.wide{max-width:none;max-height:none;height:100%;border-radius:0;border:0;}" +
  ".bh-dlg .bh-foot .btn-accept,.bh-dlg .bh-foot .ac-b{flex:1 1 auto;min-height:44px;}.bh-text .ac-b{flex:1 1 45%;min-height:44px;text-align:center;}" +
  ".bh-ch{padding-left:0;}}";

/** The sheet's look, once per page. */
export function ensureSheetStyle() {
  if (typeof document === "undefined" || document.getElementById("bhSheetStyle")) return;
  const st = document.createElement("style");
  st.id = "bhSheetStyle";
  st.textContent = SHEET_CSS;
  (document.head || document.documentElement).appendChild(st);
}

const S = { host: null, busy: false, onClose: null, last: null, open: false };

function host() {
  if (S.host && S.host.parentNode) return S.host;
  const x = document.createElement("div");
  x.id = "bhSheet";
  x.className = "bh-dlg";
  x.setAttribute("role", "dialog");
  x.setAttribute("aria-modal", "true");
  x.setAttribute("aria-labelledby", "bhSheetH");
  x.hidden = true;
  x.addEventListener("click", (e) => { if (e.target === x && !S.busy) closeSheet(); });
  x.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || S.busy) return;
    // a question asked over the sheet (DCR2.confirm) answers its own Esc
    if (document.querySelector(".dcr-mo.open")) return;
    if (e.preventDefault) e.preventDefault();
    closeSheet();
  });
  document.body.appendChild(x);
  S.host = x;
  return x;
}

/** Close the open sheet (its onClose runs once). */
export function closeSheet() {
  if (!S.open) return;
  S.open = false;
  S.busy = false;
  const x = S.host;
  if (x) { x.hidden = true; x.innerHTML = ""; }
  if (document.body && document.body.classList) document.body.classList.remove("bh-noscroll");
  const fn = S.onClose;
  S.onClose = null;
  const back = S.last;
  S.last = null;
  try { if (back && back.focus) back.focus(); } catch (e) { /* */ }
  if (typeof fn === "function") { try { fn(); } catch (e) { /* */ } }
}

/** Open a sheet: o {title, html, wide, onClose} -> {card, body, close, setBusy}. */
export function openSheet(o) {
  const opt = o || {};
  if (S.open) closeSheet();
  ensureSheetStyle();
  const x = host();
  S.last = document.activeElement;
  S.onClose = opt.onClose || null;
  S.open = true;
  S.busy = false;
  x.innerHTML = '<div class="bh-dlg-card' + (opt.wide ? " wide" : "") + '"><div class="bh-dlg-hd"><h3 id="bhSheetH">' + h(opt.title || "") + "</h3>" +
    '<button type="button" class="bh-x" id="bhSheetX" aria-label="Close">&times;</button></div><div class="bh-dlg-b" id="bhSheetB">' + (opt.html || "") + "</div></div>";
  x.hidden = false;
  if (document.body && document.body.classList) document.body.classList.add("bh-noscroll");
  const card = x.querySelector(".bh-dlg-card");
  const body = x.querySelector("#bhSheetB");
  const closeBtn = x.querySelector("#bhSheetX");
  if (closeBtn) closeBtn.addEventListener("click", () => { if (!S.busy) closeSheet(); });
  setTimeout(() => {
    const f = x.querySelector("[data-autofocus]") || closeBtn;
    try { if (f && f.focus) f.focus(); } catch (e) { /* */ }
  }, 20);
  return {
    card, body,
    close: closeSheet,
    setBusy(on) { S.busy = !!on; if (closeBtn) closeBtn.disabled = !!on; },
    isOpen: () => S.open && S.host === x,
  };
}

export const _test = { S };

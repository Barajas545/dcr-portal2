/* The shoot schedule's photo files parts - drawn by pages/shoots.js (the photographer screen program, P5, the OneDrive
   edition; DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §3.3, §8.4, §10). Markup only: what to say is map/photo-files.js's
   (the contract's choosers and words), every text escaped here.

   * filesHtml(fs, o)          the shoot sheet's Files section: the "Needs you" chips, the main line and the extra lines,
                               the completion line, who was told (an admin's line, o.admin), and the phone's buttons -
                               [Open in OneDrive] (the folder's link, only with can.open_folder), the phone's hand-in
                               (OD §3.3: [Add photos and videos] with can.add_from_phone, the file in flight's progress,
                               [Hand in what's there] / [Cancel it] while it sends - no separate Stop; each asks first,
                               pages/shoots.js phoneAsk -, the stopped-on-
                               this-phone choices [Pick the rest again] / [Hand in what's there] / [Cancel it], after
                               not_checked_phone [Pick them again] / [Hand in without them], and a stopped phone hand-in
                               of another device: [Hand in what's there] / [Cancel it] for its starter or an admin) and
                               [Check again] (map/photo-files.js filesView; js/photo-send.js's view for the phone's own
                               lines; phoneButtons)
   * readyListHtml(r, o)       the Ready for marketing list: its two tabs and the cards
   * readyCardHtml(item, me, o) one card, in the detail column (a phone: full screen); under Open in OneDrive its tip
                               (ready.open_tip: open it on the web or in the OneDrive app, never sync the whole folder)
   * postedBody / passBody     the Posted… and Not for posting… sheets */

import { esc } from "./shell.js";
import { WORDS, filesView, readyView, homeBadge, safe, WHERE, NOTE_MAX, LINK_MAX, GONE_LINES } from "../map/photo-files.js";

const W = WORDS;
const toneCls = (t) => (t ? " " + t : "");

// the phone's buttons (files_buttons codes) and their acts on the page (pages/shoots.js)
const PHONE_ACT = { add_phone: "files-add-phone", pick_rest: "files-pick-rest", pick_them_again: "files-pick-rest", hand_in_there: "files-hand-in",
  cancel_copy: "files-cancel", hand_in_without: "files-hand-in-without" };
const PHONE_CLS = { add_phone: " primary", pick_rest: " primary", pick_them_again: " primary", hand_in_there: " ok", cancel_copy: " warn", hand_in_without: "" };
// js/photo-send.js's phases while it works on the hand-in it holds (no other act on the phone meanwhile)
export const PHONE_BUSY = Object.freeze(["starting", "sending", "finding", "sealing", "asking"]);

/** The phone's hand-in buttons for one shoot (OD §3.3 steps 1, 8, 9). st: its photo_drive_status; v: its filesView;
    ph: {view (js/photo-send.js's view while it holds THIS shoot's hand-in, else null), other (it is busy with another
    shoot's), knows (this phone holds the keys of this shoot's open hand-in), viewer, planning}. -> [files_buttons codes]:
    while this page sends, Hand in what's there (once a file of it is in OneDrive) / Cancel it; its own choices (stopped:
    Pick the rest again, Hand in what's there - once one is in -, Cancel it; not_checked_phone: Pick them again, Hand in
    without them); with nothing of it here, this shoot's stopped phone hand-in - on this phone (its device row): Pick the
    rest again (its keys held), Hand in what's there (once something of it is in), Cancel it; on another device: Hand in
    what's there (likewise) and Cancel it - for its starter or an admin; else Add photos and videos
    (can.add_from_phone: filesView.addPhone). */
export function phoneButtons(st, v, ph) {
  const p = ph || {};
  const pv = p.view || null;
  if (pv && (PHONE_BUSY.indexOf(pv.phase) !== -1 || pv.buttons.length)) return pv.buttons.slice();
  if (p.planning === true) return ["add_phone"];               // (its label Checking…, disabled: the pick is being read)
  if (p.other) return [];
  if (!v || !v.available || (v.lines.length && GONE_LINES.indexOf(v.lines[0].code) !== -1)) return [];
  const uploads = Array.isArray(st && st.uploads) ? st.uploads.filter(Boolean) : [];
  const open = uploads.find((u) => u.state === "open" || u.state === "abandoned") || null;
  if (open && open.source === "phone") {
    if (!open.can_decide) return [];
    // this phone's own: nothing of it runs on this page (a reload) - whatever its last beat's age says; another
    // device's: once it stopped beating (running: a beat under 2 minutes old)
    const here = open.pc_id !== null && open.pc_id !== undefined && !!p.viewer && open.pc_id === p.viewer.device_id;
    // Hand in what's there, here as elsewhere, only once a file of it is in OneDrive (its sent_files; OD §3.3 steps 8
    // and 9, review round 3): never "Hand in the 0 files…"
    const there = (open.sent_files || 0) > 0 ? ["hand_in_there"] : [];
    if (here) return (p.knows ? ["pick_rest"] : []).concat(there, ["cancel_copy"]);
    if (open.running) return [];
    return there.concat(["cancel_copy"]);
  }
  return v.addPhone ? ["add_phone"] : [];
}

/** The Files section of a shoot. fs: {st (photo_drive_status | null | undefined while reading), err, busy (a check
    running)}; o: {today, now, offline, doneSent, admin, phone: {view, other, knows, viewer, sending, planning, lines (the
    pick's own: big_phone; a refusal of the pick's read)}}. "" when the database has no photo files, or not the OneDrive
    edition (fs.st null). */
export function filesHtml(fs, o) {
  const opt = o || {};
  const ph = opt.phone || {};
  const head = '<section class="sh-files" aria-labelledby="shFilesH"><h3 class="sh-h3" id="shFilesH">' + esc(W.files.title) + "</h3>";
  if (!fs || fs.st === null) return "";
  if (fs.st === undefined && !fs.err) return head + '<div class="sh-skel sh-fskel" aria-hidden="true"></div></section>';
  if (fs.err && !fs.st) {
    return head + '<div class="sh-fl problem" role="status">' + esc(W.files.read_failed) + "</div>" +
      '<div class="sh-acts"><button type="button" class="sh-btn" data-act="files-reload">Try again</button></div></section>';
  }
  const v = filesView(fs.st, Object.assign({}, opt, { viewer: ph.viewer || {}, sending: ph.sending || null }));
  const out = [head];
  if (v.help.length) out.push('<div class="sh-fhelp">' + v.help.map((h) => '<span class="sh-chip need">' + esc(h) + "</span>").join("") + "</div>");
  const parts = v.lines.map((l, i) => '<p class="sh-fl' + (i === 0 ? " main" : "") + toneCls(l.tone) + '" data-line="' + esc(l.code) + '">' + esc(l.text) + "</p>")
    .concat(phoneLines(v, ph).map((l) => '<p class="sh-fl' + toneCls(l.tone) + '" data-line="' + esc(l.group + "." + l.code) + '">' + esc(l.text) + "</p>"));
  // the file this phone sends now, under the line with the counts: its name and how far
  const f = ph.view && ph.view.file;
  if (f) {
    parts.splice(parts.length ? 1 : 0, 0, '<div class="sh-fprog" data-sending="1"><span class="sh-fprog-n">' + esc(f.name) +
      '</span><progress class="sh-fbar" max="100" value="' + esc(f.pct) + '" aria-label="' + esc(f.name) + '"></progress></div>');
  }
  out.push('<div class="sh-flines" role="status">' + parts.join("") + "</div>");
  if (v.completion) out.push('<p class="sh-fdone" data-completion="' + esc(v.completion.code) + '">' + esc(v.completion.text) + "</p>");
  if (v.told) out.push('<p class="sh-ftold">' + esc(v.told) + "</p>");
  if (fs.err) out.push('<p class="sh-fl warn">' + esc(W.files.read_failed) + "</p>");
  const btns = [];
  if (v.open) btns.push('<a class="sh-btn primary" data-act="open-folder" href="' + esc(v.open) + '" target="_blank" rel="noopener noreferrer">' +
    esc(W.files_buttons.open_onedrive) + "</a>");
  for (const code of phoneButtons(fs.st, v, ph)) {
    const label = code === "add_phone" && ph.planning ? W.files_buttons.checking : W.files_buttons[code];
    btns.push('<button type="button" class="sh-btn' + (PHONE_CLS[code] || "") + '" data-act="' + PHONE_ACT[code] + '"' +
      (code === "add_phone" && ph.planning ? " disabled" : "") + ">" + esc(label) + "</button>");
  }
  const held = !!(fs.waitUntil && fs.waitUntil > (opt.now || Date.now()));      // photo-files' Retry-After (429 rate, 503 busy)
  if (v.check) btns.push('<button type="button" class="sh-btn" data-act="files-check"' + (fs.busy || held ? " disabled" : "") + ">" +
    esc(fs.busy === "check" ? W.files_buttons.checking : W.files_buttons.check_again) + "</button>");
  if (btns.length) out.push('<div class="sh-acts sh-facts-b">' + btns.join("") + "</div>");
  out.push("</section>");
  return out.join("");
}

/** The phone's own lines (js/photo-send.js: the pick's, the send's, the last act's), after the status's: never one the
    status says already - its confirmed / checking once the status is read again after the seal - nor twice. */
export function phoneLines(v, ph) {
  const p = ph || {};
  const said = new Set(v.lines.map((l) => l.text));
  const codes = new Set(v.lines.map((l) => l.code));
  const settled = codes.has("confirmed") || codes.has("checking") || codes.has("confirmed_culled");
  const seen = new Set();
  return (p.lines || []).concat(p.view ? p.view.lines : []).filter((l) => {
    if (!l || !l.text || said.has(l.text) || seen.has(l.text)) return false;
    if (l.group === "files" && (codes.has(l.code) || (settled && (l.code === "confirmed" || l.code === "checking")))) return false;
    seen.add(l.text);
    return true;
  });
}

/** The Ready for marketing list. r: {tab: open | done, lists: {open, done} (photo_ready_list answers), err, sel, msg,
    want (a link's card waiting for a read: its failed read is said with Try again, even over a list read before)}.
    The Ready tab's number is Home's badge (ready plus claimed by me, §13.5 ready.home_badge) - the number DCR Desktop's
    Ready view says too - never the cards someone else is on (R5). */
export function readyListHtml(r, o) {
  const opt = o || {};
  const list = r.lists[r.tab];
  const open = r.lists.open;
  const badge = open && open.counts ? homeBadge(open.counts) : null;
  const n = badge ? badge.n : null;
  const tab = (key, label, count) => '<button type="button" role="tab" class="sh-rtab" data-act="ready-tab" data-tab="' + key + '" aria-selected="' +
    (r.tab === key ? "true" : "false") + '">' + esc(label) + (count ? ' <span class="sh-n">' + esc(count) + "</span>" : "") + "</button>";
  const out = ['<div class="sh-rtabs" role="tablist" aria-label="' + esc(W.ready.view) + '">' + tab("open", W.ready.tab_open, n) + tab("done", W.ready.tab_done, 0) + "</div>"];
  if (r.msg) out.push('<div class="sh-pc" role="status">' + esc(r.msg) + "</div>");
  if (r.err && (!list || r.want)) {
    out.push('<div class="sh-empty"><b>' + esc(W.ready.view) + "</b>" + esc(r.err) +
      '<div><button type="button" class="sh-btn" data-act="ready-reload" style="margin-top:12px">Try again</button></div></div>');
    return out.join("");
  }
  if (!list) { out.push('<div class="sh-skel"></div><div class="sh-skel"></div>'); return out.join(""); }
  if (!list.items.length) {
    out.push('<div class="sh-empty">' + esc(r.tab === "done" ? W.ready.empty_done : W.ready.empty) + "</div>");
    return out.join("");
  }
  out.push('<div class="sh-rlist">' + list.items.map((it) => {
    const v = readyView(it, list.me, opt);
    // the row's one warning is the shoot's own: an access line is about the viewer's account (the card says it)
    const first = v.warnings.find((w) => !w.access);
    const warn = first ? '<span class="sh-rw-n">' + esc(first.text) + "</span>" : "";
    return '<button type="button" class="sh-rrow' + (it.state === "claimed" && it.claimed && it.claimed.you ? " mine" : "") + '" data-ready="' + esc(it.id) + '"' +
      (r.sel === it.id ? ' aria-current="true"' : "") + '><span class="sh-chip ' + esc(chipCls(v.chip.code)) + '">' + esc(v.chip.text) + "</span>" +
      '<span class="sh-name">' + esc(v.title) + "</span>" + '<span class="sh-job">' + esc(v.rest) + "</span>" + warn + "</button>";
  }).join("") + "</div>");
  return out.join("");
}

function chipCls(code) {
  return { chip_ready: "ok", chip_claimed_me: "mine", chip_claimed: "dim", chip_posted: "posted", chip_passed: "dim", chip_withdrawn: "dim" }[code] || "";
}

/** One card (the detail column). item: a photo_ready_list item; me: its me; o: {today, busy}. */
export function readyCardHtml(item, me, o) {
  const opt = o || {};
  const v = readyView(item, me, opt);
  const out = [];
  out.push('<div class="sh-dtop"><span class="sh-chip ' + esc(chipCls(v.chip.code)) + '">' + esc(v.chip.text) + "</span></div>");
  out.push('<h2 class="sh-dtitle" id="shDTitle" tabindex="-1">' + esc(v.title) + "</h2>");
  out.push('<p class="sh-rline">' + esc(v.rest) + "</p>");          // ready.row, its {shoot} the title above
  // the warnings, then (in Open in OneDrive's place) why the viewer's account cannot open the folder (OD §8.4)
  for (const w of v.warnings) out.push('<div class="sh-box ' + esc(w.tone || "warn") + ' sh-rwarn" data-warning="' + esc(w.code) + '"' + (w.access ? ' role="note"' : "") +
    '><div class="w">' + esc(w.text) + "</div></div>");
  if (v.posted) {
    const parts = [];
    if (v.posted.where.length) parts.push("<div>" + esc(v.posted.where.join(", ")) + "</div>");
    if (v.posted.link) parts.push('<div><a href="' + esc(v.posted.link) + '" target="_blank" rel="noopener noreferrer">' + esc(v.posted.link) + "</a></div>");
    if (v.posted.note) parts.push('<div class="w">' + esc(v.posted.note) + "</div>");
    if (parts.length) out.push('<div class="sh-box ok sh-rposted">' + parts.join("") + "</div>");
  }
  if (v.passed) out.push('<div class="sh-box sh-rpassed"><div class="w">' + esc(v.passed) + "</div></div>");
  if (v.told) out.push('<p class="sh-ftold">' + esc(v.told) + "</p>");
  const btns = v.buttons.map((b) => {
    if (b.code === "btn_open") return '<a class="sh-btn primary" data-act="r-open" href="' + esc(v.link) + '" target="_blank" rel="noopener noreferrer">' + esc(b.text) + "</a>";
    const act = { btn_claim: "claim", btn_release: "release", btn_posted: "posted", btn_pass: "pass", btn_reopen: "reopen", btn_reopen_passed: "reopen",
      btn_take_over: "take-over" }[b.code];
    const cls = b.code === "btn_claim" ? " ok" : b.code === "btn_pass" || b.code === "btn_release" ? "" : b.code === "btn_posted" ? " ok" : " warn";
    return '<button type="button" class="sh-btn' + cls + '" data-act="r-' + act + '" data-ready="' + esc(item.id) + '"' + (opt.busy ? " disabled" : "") + ">" + esc(b.text) + "</button>";
  });
  if (v.shoot) btns.push('<a class="sh-btn" data-act="r-shoot" data-shoot-link="' + esc(v.shoot) + '" href="shoots.html?shoot=' + esc(v.shoot) + '">' + esc(W.ready.see_shoot) + "</a>");
  if (btns.length) out.push('<div class="sh-acts">' + btns.join("") + "</div>");
  // beside Open in OneDrive, how to open it (OD §8.4): on the web or in the OneDrive app - never the whole folder synced,
  // which downloads every video (ready.open_tip; DCR Desktop 2's ReadyCard says it too - review round 1)
  if (v.tip) out.push('<p class="sh-rtip" data-tip="open_tip">' + esc(v.tip) + "</p>");
  return out.join("");
}

/** The Posted… sheet's body: where (the six ticks), the post's link, a note. */
export function postedBody(item) {
  const name = safe(item && item.shoot_name);
  return '<p class="mv-now"><b>' + esc(name) + "</b></p>" +
    '<fieldset class="mv-fs rs-where"><legend>' + esc(W.ready.posted_ask) + "</legend><div class=\"rs-ticks\">" +
    WHERE.map((w) => '<label class="mv-choice rs-tick"><input type="checkbox" name="rsWhere" value="' + w + '" /> <span><b>' + esc(W.ready["where_" + w]) +
      "</b></span></label>").join("") + "</div></fieldset>" +
    '<label class="mv-lab" for="rsLink">' + esc(W.ready.posted_link) + "</label>" +
    '<input class="mv-reason" id="rsLink" type="url" inputmode="url" maxlength="' + LINK_MAX + '" autocomplete="off" placeholder="https://" />' +
    '<label class="mv-lab" for="rsNote">' + esc(W.ready.posted_note) + "</label>" +
    '<textarea class="mv-text" id="rsNote" maxlength="' + NOTE_MAX + '" rows="3"></textarea>';
}

/** The Not for posting… sheet's body: why (required). */
export function passBody(item) {
  const name = safe(item && item.shoot_name);
  return '<p class="mv-now"><b>' + esc(name) + "</b></p>" +
    '<label class="mv-lab" for="rsNote">' + esc(W.ready.pass_ask) + "</label>" +
    '<textarea class="mv-text" id="rsNote" maxlength="' + NOTE_MAX + '" rows="3" required aria-required="true"></textarea>';
}

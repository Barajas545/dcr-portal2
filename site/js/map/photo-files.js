/* The photo files' rules for the phone (the photographer screen program, P5, the OneDrive edition: the files in the
   Office account's OneDrive, completion and the Ready for marketing list - DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md
   §3.3, §6.6, §7, §8.4, §10, cited OD; docs/PHOTO-FILES.md §13 for the rules OD §15 keeps; the shared cases
   tests/vectors/photo_files_cases.json, version 30). Pure: no DOM, no I/O.

   Portal 2 never decides a OneDrive fact itself: photo_drive_status (OD §5.5, §10.6) and photo_ready_list answer them,
   and this module only CHOOSES which words to show and fills them in. The choosers are ports of the contract's
   reference (DCR Desktop 2 tools/photo_lines/lines.mjs), held to the cases' files_line, ready_card, access_line,
   share_list, told_line and moments; the words are the cases' (map/photo-words.js, generated); every filler from a
   person or from OneDrive goes through the site's money masks (safeText: maskAmounts, then scrubMoney) and is escaped
   by the page.

   * filesLine(status, viewer, now)   the Files section's codes: the main line, then the extra lines, in order (OD §10.6)
   * accessLine(access, linkOk)       {can_open, line}: Open in OneDrive, or the line in its place (OD §8.4)
   * memberLine(entry, domains)       a marketing member's sharing line on the Access tab (photo_share_list, OD §8.4)
   * culledOf(files)                  marketing's culls after Ready (files.culled, at most files.missing; PF §42)
   * readyCard(item, me)              a Ready card's chip, warnings and buttons
   * toldLine(told)                   "Told Sam (phone, e-mail) and Ana (no phone notices, e-mail off)." | null
   * filesView(status, o)             what the shoot sheet draws: {available, lines [{code, text, tone}], help,
                                      completion, told (an admin's only, o.admin), open (an OneDrive link), check,
                                      addPhone, bringBack}
   * readyView(item, me, o)           what a Ready card draws (the chip, ready.row, warnings, told - an admin's only -,
                                      buttons, details, the open tip)
   * reopenAsk(item)                  the question Not posted yet / Back on the list asks first, or null
   * sizeWords / filesWords / dayText / momentText / dayOfMoment / leftWords   the fillers
   * linkOk(link)                     app.photo_drive_link_ok: every OneDrive href passes it (link_ok)
   * hintText / filesText / actText   refusals in words (the RPCs' hints, the photo-files function's codes, the acts)
   * fill / word                      a word filled in by the count rule: its _one twin for a count of 1; for 0 its
                                      _none twin (a hand-in that recorded nothing never vanishes), else no line */

import { WORDS } from "./photo-words.js";
import { scrubMoney } from "../scrub-money.js";
import { maskAmounts } from "../money-mask.js";
import { dayText as dayOf } from "./photo.js";
import { pacificParts } from "./pacific.js";

export { WORDS };
const MIN = 60e3;
/** A device's beat older than this: DCR Desktop (or the page) is not sending there now (OD §3.2.8: a beat every 30 s). */
export const BEAT_STALE_MS = 2 * MIN;

/* ── words ────────────────────────────────────────────────────────────── */

let strict = false;
/** Tests: a placeholder left unfilled throws (a page never shows "{name}"; outside tests it reads ""). */
export function setStrict(on) { strict = !!on; }

/** Free text from a person or from OneDrive, as the phone may show it: amounts masked, then scrubbed. */
export function safe(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return s ? scrubMoney(maskAmounts(s)) : "";
}

/** `template` with every {key} replaced by values[key] (a number as it is, text as given - the caller made it safe). */
export function fill(template, values) {
  const v = values || {};
  return String(template).replace(/\{([a-z_]+)\}/g, (m, k) => {
    if (v[k] === undefined || v[k] === null) {
      if (strict) throw new Error("the word's {" + k + "} was not filled: " + template);
      return "";
    }
    return String(v[k]);
  });
}

// the count that picks a word's twin (its _one / _none): the filler the twin is about - stopped_phone, which has none,
// counts the stopped copy's {done} as files.stopped does; the phone's sending lines count the files recorded; a stopped
// phone upload counts {done}, its files already in OneDrive - another device's (at 0 its _none: "…or cancel it", never
// "hand in what's there" - OD §3.3 step 9, review round 3) and this phone's own (at 1 "stopped at 1 of {total} files",
// never "before its one file was in" beside Hand in what's there; at 0 "before any file was in" - OD §10.2, review
// round 4)
const COUNT_OF = { "files.copying": "total", "files.stopped": "done", "files.stopped_phone": "done", "files.waiting": "waiting",
  "files.confirmed": "counted", "files.stalled": "waiting", "files.sending_this_phone": "total", "files.sending_phone": "total",
  "files.stopped_this_phone": "done", "files.stopped_upload_phone": "done", "files.sending": "total", "files.sending_starting": "total" };

/** WORDS[group][code] filled in, by the count rule when the values carry the word's count: 1 → its `_one` twin; 0 → its
    `_none` twin (files.stopped_none, copying_elsewhere_none, stopped_phone_none, stopped_this_phone_none,
    stopped_upload_phone_none), else no line (""). */
export function word(group, code, values) {
  const g = WORDS[group] || {};
  const v = values || {};
  const t = g[code];
  if (typeof t !== "string") return "";
  const key = COUNT_OF[group + "." + code] || "n";
  if (v[key] !== undefined) {
    const n = Number(v[key] || 0);
    if (n === 0) {
      if (typeof g[code + "_none"] === "string") return fill(g[code + "_none"], v);
      if (t.indexOf("{" + key + "}") !== -1) return "";
    } else if (n === 1 && typeof g[code + "_one"] === "string") return fill(g[code + "_one"], v);
  }
  return fill(t, v);
}

const someone = (name) => safe(name) || WORDS.completion.someone;

/* ── the fillers ──────────────────────────────────────────────────────── */

const UNITS = ["KB", "MB", "GB", "TB"];

/** app.photo_drive_size_words: binary units, one decimal under 100, half up on the exact value ("6.2 GB"). */
export function sizeWords(bytes) {
  let x = Number(bytes);
  if (!Number.isFinite(x) || x < 0) x = 0;
  const n = BigInt(Math.trunc(x));
  if (n < 1024n) return n === 1n ? "1 byte" : n + " bytes";
  let d = 1024n, u = 1, s = 10n, r = 0n;
  while (n >= d * 1024n && u < 4) { d *= 1024n; u += 1; }
  for (;;) {
    s = n < 100n * d ? 10n : 1n;
    r = (2n * n * s + d) / (2n * d);
    if (r >= 1024n * s && u < 4) { d *= 1024n; u += 1; continue; }
    break;
  }
  const num = s === 1n ? String(r) : r % 10n === 0n ? String(r / 10n) : String(r / 10n) + "." + String(r % 10n);
  return num + " " + UNITS[u - 1];
}

const count = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/** app.photo_files_words: "248 photos, 12 videos and 3 other files" (a kind with none left out; "no files"). */
export function filesWords(f) {
  const x = f || {};
  const p = count(x.photos), v = count(x.videos), o = count(x.other !== undefined ? x.other : x.others);
  const parts = [];
  if (p) parts.push(p + (p === 1 ? " photo" : " photos"));
  if (v) parts.push(v + (v === 1 ? " video" : " videos"));
  if (o) parts.push(o + (o === 1 ? " other file" : " other files"));
  if (!parts.length) return "no files";
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** {day}: "Thu Nov 19", with ", 2027" when not today's year (map/photo.js dayText, P4's day_text). */
export function dayText(day, today) { return dayOf(day, today); }

const pad = (n) => String(n).padStart(2, "0");

/** The company day ("YYYY-MM-DD", America/Los_Angeles) of a moment; "" when it is not one. */
export function dayOfMoment(at) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return "";
  const p = pacificParts(new Date(t));
  return p.y + "-" + pad(p.m) + "-" + pad(p.d);
}

/** {time} / {when}: "Thu Nov 12, 1:05 pm" on the company's clock (P4's moment_text); "" when it is not a moment. */
export function momentText(at, today) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return "";
  const p = pacificParts(new Date(t));
  const h = p.h % 24;
  return dayOf(p.y + "-" + pad(p.m) + "-" + pad(p.d), today) + ", " + (h % 12 || 12) + ":" + pad(p.mi) + " " + (h < 12 ? "am" : "pm");
}

/** {left} (OD §3.2.8) of `seconds`: under an hour the minutes rounded up to 5 ("25 min", at least "5 min"); over an
    hour the hours and tens of minutes rounded up ("3 h 10 min", "2 h") - DCR Desktop 2's left_words, number for number.
    The sending line is only chosen with a rate (sending_starting before it), so a number is always one that can be
    true. */
export function leftWords(seconds) {
  const x = Number(seconds);
  const s = Number.isFinite(x) && x > 0 ? Math.ceil(x) : 0;
  if (s <= 3600 - 300) return Math.max(5, Math.ceil(s / 300) * 5) + " min";
  let h = Math.floor(s / 3600);
  let t = Math.ceil((s - h * 3600) / 600) * 10;
  if (t === 60) { h += 1; t = 0; }
  return h + " h" + (t ? " " + t + " min" : "");
}

/** A sealed hand-in's sending figures (OD §3.2.8, §10.6; review round 8): its totals are the files that still count
    toward its send - the status's send_files / send_bytes, its rows not left out or removed, as the beat's own
    sent_files / bytes_sent count them; the seal's files / bytes only from a server without them - and the figures sent
    are never over them (a file another hand-in recorded over after this one sent it leaves the totals, not the beat's
    count). DCR Desktop 2's files_view, number for number. */
export function sendFigures(u) {
  const x = u || {};
  const has = (k) => x[k] !== undefined && x[k] !== null;
  const files = count(has("send_files") ? x.send_files : has("files") ? x.files : x.recorded_files);
  const bytes = Math.max(Number(has("send_bytes") ? x.send_bytes : x.bytes) || 0, 0);
  return { files, bytes, sent: Math.min(count(x.sent_files), files), bytes_sent: Math.min(Math.max(Number(x.bytes_sent) || 0, 0), bytes) };
}

/** The seconds a sealed hand-in still needs at its beat's rate (OD §3.2.8): its bytes left (sendFigures) / rate_bps;
    0 without a rate. */
export function secondsLeft(u) {
  const rate = Number((u || {}).rate_bps) || 0;
  const s = sendFigures(u);
  return rate > 0 ? (s.bytes - s.bytes_sent) / rate : 0;
}

/** app.photo_drive_link_ok: OneDrive's personal-site shape - https, a tenant's OneDrive host, /personal/<office
    path>/Documents/ then only characters a plain-text e-mail carries safely, at most 2,000 characters, no amount.
    Every OneDrive href the phone shows passes it (the database pins the host where it writes a link). */
const LINK = /^https:\/\/[a-z0-9-]{1,63}-my\.sharepoint\.com\/personal\/[A-Za-z0-9_]{1,128}\/Documents\/[A-Za-z0-9._~%!$&'()*+,;=:@/[\]-]+$/;
export function linkOk(link) {
  if (typeof link !== "string") return false;
  return link.length <= 2000 && LINK.test(link) && scrubMoney(link) === link;
}

/** A post's link as a Ready card shows it: https only, short, no amount; else null. */
export function postLink(link) {
  if (typeof link !== "string" || link.length > 300 || !/^https:\/\/[^\s<>"']+$/.test(link)) return null;
  return scrubMoney(link) === link ? link : null;
}

/* ── the choosers (DCR Desktop 2 tools/photo_lines/lines.mjs, ported; the cases hold both) ── */

/** The viewer's access -> {can_open, line}: Open in OneDrive only with access shared and a link that passes
    (app.photo_drive_link_ok); otherwise the line in its place (OD §8.4; cases access_line). */
export function accessLine(access, ok) {
  if (access === "shared") return { can_open: ok === true, line: null };
  if (access === "waiting") return { can_open: false, line: "access_waiting" };
  if (access === "not_company") return { can_open: false, line: "access_not_company" };
  return { can_open: false, line: "no_access" };
}

/** The Files section's lines: the main line by state, then every extra line that applies, in this order. */
export function filesLine(status, viewer, now) {
  const at = now === undefined ? Date.now() : now;
  const desk = !!viewer && viewer.app === "desktop2";
  const st = status || {};
  // 0: the OneDrive edition always answers mode; a status without it is the Google edition's (the OneDrive roll back,
  //    OD §5.7) - nothing of it can be acted on: not available, never a default
  if (st.mode === null || st.mode === undefined) return ["not_available"];
  const root = st.root;
  // 1-3: nothing can be handed in, and no line rests on the rows, while the root or the shoot folder is gone
  if (!root || root.state === "not_seen") return ["not_connected"];
  if (root.state === "missing" || root.state === "trashed") return ["root_lost"];
  const folder = st.folder;
  if (folder && (folder.drive_state === "missing" || folder.drive_state === "trashed")) return ["moved_out"];
  // 3b: the JOB folder gone while this shoot's folder is not in OneDrive (never made, or no row yet): nothing can be
  //     handed in to it and no line rests on its rows - the job folder is named (OD §2.3; review round 1)
  const job = st.job;
  if (job && (job.drive_state === "missing" || job.drive_state === "trashed") && !(folder && folder.drive_state === "found")) return ["job_moved_out"];
  const files = st.files || {};
  const can = st.can || {};
  const mode = st.mode;
  const uploads = Array.isArray(st.uploads) ? st.uploads.filter(Boolean) : [];
  const out = [];
  const state = files.state || "none";
  if (!folder || state === "none") {
    if (desk && !can.hand_in) out.push("none");
    else if (!desk && !can.hand_in) out.push("none_phone");
    else if (mode === "off") out.push("uploads_off");
    else if (mode === "test") out.push("uploads_test");
    else if (desk) out.push("none_drop");
    else out.push(can.add_from_phone ? "none_add_phone" : "none_phone");
  } else if (state === "copying") {
    const open = openUpload(uploads);
    if (open) out.push(...openLines(open, viewer, desk));
    if ((files.counted || 0) > 0) out.push(...sealedLines(files, uploads, mode, at));
  } else {
    out.push(...sealedLines(files, uploads, mode, at));
  }
  if (folder && (files.drive_only || 0) > 0) out.push("drive_only");
  if (st.retired) out.push("retired");
  if (folder) {
    if (files.last_code === "too_big") out.push("too_big");
    if (files.busy) out.push("busy");
    // the phone: the Open in OneDrive link's place when the viewer cannot open the folder
    if (!desk && folder.drive_state === "found" && folder.link && !can.open_folder) {
      const line = accessLine(st.me && st.me.drive_access, true).line;
      if (line) out.push(line);
    }
  }
  return out;
}

function openUpload(uploads) {
  return uploads.find((u) => u.state === "open" || u.state === "abandoned") || null;
}

/** An open (or abandoned) hand-in: a PC's copy into the outbox, or a phone sending. */
function openLines(open, viewer, desk) {
  const v = viewer || {};
  const here = open.pc_id !== null && open.pc_id !== undefined && open.pc_id === v.device_id;
  if (open.source === "phone") {
    if (open.state === "open" && (here && !desk ? v.running_here === true : open.running === true)) {
      return [here && !desk ? "sending_this_phone" : "sending_phone"];
    }
    if (here && !desk) return (v.phone_found || 0) > 0 ? ["stopped_this_phone", "not_checked_phone"] : ["stopped_this_phone"];
    return open.can_decide ? ["stopped_upload_phone"] : ["stopped_upload_phone", "stopped_ask"];
  }
  const mine = desk && here;
  if (open.state === "open" && (mine ? v.running_here === true : open.running === true)) return [mine ? "copying" : "copying_elsewhere"];
  if (!open.can_decide) return ["stopped", "stopped_ask"];
  return desk ? ["stopped"] : ["stopped", "stopped_phone"];
}

/** files.culled, never more than files.missing: counted files confirmed in OneDrive that were deleted or moved out of
    the folder after the shoot went to marketing (PF §42). 0 off the Ready list. */
export function culledOf(f) {
  const x = f || {};
  return Math.max(0, Math.min(count(x.culled), count(x.missing)));
}

// which sealed hand-in's sending says the line, when several still send (the list's order breaks a tie)
const SEND_ORDER = ["lost", "outbox_away", "disk_full", "onedrive_full", "onedrive_stopped", "sending", "waiting_net", "busy", "paused",
  "queued"];

/** The sealed hand-in whose sending the Files line tells: still holding counted rows to send, its state first in
    SEND_ORDER. */
export function sendingUpload(uploads) {
  const rank = (u) => (SEND_ORDER.indexOf(u.send_state) !== -1 ? SEND_ORDER.indexOf(u.send_state) : SEND_ORDER.length);
  return (uploads || []).filter((u) => u && u.state === "sealed" && (u.to_send || 0) > 0)
    .reduce((best, u) => (best === null || rank(u) < rank(best) ? u : best), null);
}

/** A hand-in's beat under 2 minutes old: DCR Desktop is open on its device. */
function freshBeat(u, now) {
  const seen = Date.parse(u.seen_at || "");
  return Number.isFinite(seen) && now - seen <= BEAT_STALE_MS;
}

/** The line of a sending hand-in (OD §3.2.5, §3.2.8): its beat says what it does; a beat over 2 minutes old means
    DCR Desktop is not open there (paused_pc), never "sending". */
function sendLine(u, now) {
  const fresh = freshBeat(u, now);
  switch (u.send_state) {
    case "sending": return !fresh ? "paused_pc" : (u.rate_bps || 0) > 0 ? "sending" : "sending_starting";
    case "waiting_net": return fresh ? "waiting_net" : "paused_pc";
    case "busy": return fresh ? "throttled" : "paused_pc";
    case "outbox_away": return fresh ? "outbox_away" : "paused_pc";
    case "disk_full": return fresh ? "disk_full" : "paused_pc";
    case "paused": return "paused_signed_out";
    case "queued": return "queued";
    default: return "waiting";
  }
}

/** The counted rows' line(s): problems that apply (in order), else what the waiting rows wait for, else confirmed -
    marketing's culls a calm line of their own (culled; confirmed_culled in confirmed's place), never a problem. */
function sealedLines(f, uploads, mode, now) {
  const culled = culledOf(f);
  const tail = culled ? ["culled"] : [];
  const problems = [];
  if ((f.mismatch || 0) > 0) problems.push("problem_mismatch");
  if ((f.missing || 0) - culled > 0) problems.push("problem_missing");
  if (problems.length) return [...problems, ...tail];
  if ((f.waiting || 0) > 0) return [waitingLine(f, uploads, mode, now), ...tail];
  if ((f.confirmed || 0) > 0) return [culled ? "confirmed_culled" : "confirmed"];
  return culled ? ["culled"] : [];
}

/** What the waiting rows wait for: a phone's files a check sent back after its seal (only that phone picking them
    again sends them - OD §3.5, review round 1); this PC lost its copies (before stalled: only the memory card helps -
    OD §10.6, review round 5); 14 days never sent; uploads off or tested elsewhere; OneDrive full or stopped; the disk
    that holds the outbox away or the computer's disk full (a fresh beat) or its starter signed out - the device's own
    evidence of what holds it, before late (OD §6.6, §10.6; review rounds 2 and 10); no progress for 2 hours; the
    sending device's own state; else OneDrive's hash (checking, and after 14 days stalled_checking). */
function waitingLine(f, uploads, mode, now) {
  const u = sendingUpload(uploads);
  if (u && u.source === "phone") return "resend_phone";
  // (lost before stalled: the card and its Copy them again, never "open DCR Desktop" at day 14 on a PC that is open -
  // review round 5; 14 days on, DCR Desktop's line keeps stalled's See which / Leave them out beside it - review round 6
  // - the phone's lost_here and stalled lines carry no buttons: stalled's way out is DCR Desktop's on either line - OD
  // §10.6, §24, §25)
  if (u && u.send_state === "lost") return "lost_here";
  if (f.stalled) return "stalled";
  const toSend = (f.to_send || 0) > 0;
  if (toSend && mode === "off") return "uploads_off";
  if (toSend && mode === "test") return "uploads_test";
  if (u && u.send_state === "onedrive_full") return "full";
  if (u && u.send_state === "onedrive_stopped") return "stopped_od";
  if (u && u.send_state === "outbox_away" && freshBeat(u, now)) return "outbox_away";
  // (its computer's disk full, a fresh beat: DCR Desktop is open there - never "is PHOTO-PC on"; OD §3.2.5, review
  // round 10)
  if (u && u.send_state === "disk_full" && freshBeat(u, now)) return "disk_full";
  if (u && u.send_state === "paused") return "paused_signed_out";
  if (f.late) return "late";
  if (u) return sendLine(u, now);
  if (f.stalled_checking) return "stalled_checking";
  if ((f.committed || 0) > 0) return "checking";
  return "waiting";
}

/** A Ready card: its chip, its warnings (the folder's own state first) and its buttons. */
export function readyCard(item, me) {
  const it = item || {};
  const m = me || {};
  const claimed = it.claimed || null;
  const chip = { ready: "chip_ready", posted: "chip_posted", passed: "chip_passed", withdrawn: "chip_withdrawn" }[it.state] ||
    (claimed && claimed.you ? "chip_claimed_me" : "chip_claimed");
  const warnings = [];
  const f = it.folder;
  if (f && (f.drive_state === "missing" || f.drive_state === "trashed")) warnings.push("folder_gone");
  else if ((it.files_missing || 0) > 0) warnings.push("files_missing");
  if ((it.files_added || 0) > 0) warnings.push("more_files");
  if (it.waiting_long) warnings.push("waiting_long");
  const can = it.can || {};
  // why Open in OneDrive is not there when only the viewer's access stops it (the folder found, a link to open)
  if (!can.open && it.link && f && f.drive_state === "found") {
    const line = accessLine(m.drive_access, true).line;
    if (line) warnings.push(line);
  }
  const buttons = [];
  if (can.open) buttons.push("btn_open");
  if (m.can_act) {
    if (it.state === "ready") buttons.push("btn_claim", "btn_posted", "btn_pass");
    else if (it.state === "claimed" && claimed && claimed.you) buttons.push("btn_release", "btn_posted", "btn_pass");
    else if (it.state === "claimed") buttons.push("btn_take_over", ...(m.admin ? ["btn_posted", "btn_pass"] : []));
    else if (it.state === "posted" && can.reopen) buttons.push("btn_reopen");
    else if (it.state === "passed" && can.reopen) buttons.push("btn_reopen_passed");
  }
  return { chip, warnings, buttons };
}

/** One entry of the share list (app.photo_share_list) -> the member's line on the Access tab (OD §8.4), null when there
    is nothing to say (not wanted, nothing marked shared). `domains`: app.photo_drive.company_domains. */
export function memberLine(entry, domains) {
  const e = entry || {};
  if (e.todo === "remove") return "to_remove";
  if (!Array.isArray(domains) || !domains.length) return "no_domain";
  if (e.not_company) return "not_company";
  if (e.todo === "give") return "to_give";
  if (e.wanted && e.marked === "shared") return "shared";
  return null;
}

/** A member's sharing line in words (share.<line>; {account} the member's account, {by} the admin who marked it, {day}
    the day it was marked), or null. o: {today}. */
export function memberText(entry, domains, o) {
  const line = memberLine(entry, domains);
  if (!line) return null;
  const e = entry || {};
  const today = (o && o.today) || "";
  return { code: line, text: fill(WORDS.share[line], { account: safe(e.account), by: someone(e.marked_by),
    day: dayText(dayOfMoment(e.marked_at), today) }) };
}

/** "Told Sam (phone, e-mail) and Ana (no phone notices, e-mail off)." - null when nobody was told (PF §10.4, §13.1). */
export function toldLine(told) {
  const list = Array.isArray(told) ? told : [];
  if (!list.length) return null;
  const T = WORDS.told;
  const C = WORDS.completion;
  const people = list.map((t) => fill(C.told_person, { name: someone(t && t.name),
    ways: [T["push_" + (t && t.push)], T["email_" + (t && t.email)]].filter(Boolean).join(", ") }));
  const names = people.length === 1 ? people[0] : people.slice(0, -1).join(", ") + " and " + people[people.length - 1];
  return fill(C.told, { names });
}

/* ── the shoot sheet's Files section ──────────────────────────────────── */

// (marketing's culls: confirmed_culled is the confirmed line, culled calm - no problem of the photographer's, as DCR
// Desktop 2's tones; PF §42)
const TONE = {
  confirmed: "ok", confirmed_culled: "ok", culled: "",
  not_available: "", not_connected: "", none: "", none_drop: "", none_phone: "", none_add_phone: "", retired: "", drive_only: "",
  uploads_off: "warn", uploads_test: "warn",
  copying: "wait", copying_elsewhere: "wait", sending_this_phone: "wait", sending_phone: "wait", sending: "wait", sending_starting: "wait",
  waiting: "wait", checking: "wait", queued: "wait", throttled: "wait", waiting_net: "wait", busy: "wait", access_waiting: "wait",
  stopped: "warn", stopped_ask: "warn", stopped_phone: "warn", stopped_this_phone: "warn", stopped_upload_phone: "warn",
  not_checked_phone: "warn", paused_pc: "warn", paused_signed_out: "warn", late: "warn", too_big: "warn", full: "warn",
  outbox_away: "warn", disk_full: "warn", resend_phone: "warn", access_not_company: "warn", no_access: "",
  stalled: "problem", stalled_checking: "problem", root_lost: "problem", moved_out: "problem", job_moved_out: "problem", stopped_od: "problem", lost_here: "problem",
  problem_mismatch: "problem", problem_missing: "problem",
};

/** The newest sealed hand-in (its device names {pc} of waiting / late / stalled when none is sending). */
function newestSealed(uploads) {
  let best = null;
  for (const u of uploads) {
    if (!u || u.state !== "sealed") continue;
    if (!best || String(u.sealed_at || "") > String(best.sealed_at || "")) best = u;
  }
  return best;
}

/** {pc}: the device's label - a computer's name, or "{by}'s phone" for a phone (files.pc_phone: a phone's own label is
    only "iPhone", "Android phone" or "phone"); the cases' "the computer that copied them" when none is named. */
export function pcName(u) {
  if (u && u.source === "phone") return fill(WORDS.files.pc_phone, { by: someone(u.by) });
  return (u && u.pc ? safe(u.pc) : "") || WORDS.files.pc_unknown;
}

/** The fillers of one Files line. o: {today, sending: {sent, total} (this page's own send, P4 - its counts are newer than
    the status's beat), viewer: {phone_found}}. */
export function lineValues(code, status, o) {
  const st = status || {};
  const opt = o || {};
  const today = opt.today || "";
  const f = st.files || {};
  const uploads = Array.isArray(st.uploads) ? st.uploads.filter(Boolean) : [];
  const open = openUpload(uploads);
  const sender = sendingUpload(uploads) || newestSealed(uploads);
  const mine = opt.sending || null;
  const recorded = (u) => count(u && (u.files !== undefined && u.files !== null ? u.files : u.recorded_files));
  switch (code) {
    case "uploads_test": return { codes: (Array.isArray(st.mode_codes) ? st.mode_codes : []).map(safe).filter(Boolean).join(", ") };
    case "copying_elsewhere": return { by: someone(open && open.by), pc: pcName(open), n: count(open && open.recorded_files) };
    case "stopped": return { pc: pcName(open), when: momentText(open && (open.beat_at || open.started_at), today), done: count(open && open.recorded_files) };
    case "stopped_phone": return { done: count(open && open.recorded_files) };      // its _none twin's count
    case "stopped_ask": return { by: someone(open && open.by) };
    case "sending_this_phone":
      return mine ? { sent: count(mine.sent), total: count(mine.total) } : { sent: count(open && open.sent_files), total: recorded(open) };
    case "sending_phone": return { by: someone(open && open.by), sent: count(open && open.sent_files), total: recorded(open) };
    // (this page's own counts while it draws the hand-in's buttons - pages/shoots.js passes them only then -, as Hand in
    // what's there is offered by them: its twin by {done} never says "before any file was in" beside it - OD §10.2,
    // review round 4)
    case "stopped_this_phone":
      return mine ? { done: count(mine.sent), total: count(mine.total) } : { done: count(open && open.sent_files), total: recorded(open) };
    case "not_checked_phone": return { n: count(opt.viewer && opt.viewer.phone_found) };
    case "stopped_upload_phone": return { by: someone(open && open.by), done: count(open && open.sent_files), total: recorded(open) };
    // (its totals the files that still count toward its send, a file left out during it out of them and of the time
    // left; the sent figures never over them - sendFigures, OD §3.2.8, review round 8)
    case "sending": case "sending_starting": {
      const u = sendingUpload(uploads) || {};
      const s = sendFigures(u);
      const v = { pc: pcName(u), sent: s.sent, total: s.files, sent_size: sizeWords(s.bytes_sent), total_size: sizeWords(s.bytes) };
      if (code === "sending") v.left = leftWords(secondsLeft(u));
      return v;
    }
    case "waiting_net": case "paused_pc": case "outbox_away": case "disk_full": return { pc: pcName(sendingUpload(uploads)) };
    case "paused_signed_out": { const u = sendingUpload(uploads); return { by: someone(u && u.by), pc: pcName(u) }; }
    case "full": case "lost_here": case "resend_phone": { const u = sendingUpload(uploads); return { n: count(u && u.to_send) || count(f.to_send), pc: pcName(u) }; }
    case "queued": { const u = sendingUpload(uploads); return { pc: pcName(u), shoot: safe(u && u.behind) || WORDS.copy.this_shoot }; }
    case "waiting": return { waiting: count(f.waiting), pc: pcName(sender) };
    case "checking": case "stalled_checking": return { n: count(f.committed) };
    case "late": return { pc: pcName(sender) };
    // the stalled rows alone (app.photo_row_stalled: the status's uploads[].stalled - OD §6.6, §25; review round 7):
    // never a fresher hand-in's files still sending, nor files already in OneDrive; its two ways out name the device
    // that holds them - the first hand-in with stalled rows (DCR Desktop 2's line_count, _stalled_uploads). A status
    // whose hand-ins carry no stalled count counts the rows still to send, as before
    case "stalled": {
      const held = uploads.filter((u) => u.state === "sealed" && count(u.stalled) > 0);
      const carried = uploads.some((u) => Object.prototype.hasOwnProperty.call(u, "stalled"));
      return { waiting: carried ? held.reduce((t, u) => t + count(u.stalled), 0) : count(f.to_send) || count(f.waiting), pc: pcName(held[0] || sender) };
    }
    case "confirmed": return { counted: count(f.counted), time: momentText(f.checked_at, today) };
    // marketing's culls (PF §42): their own count; the missing line counts the others alone
    case "confirmed_culled": return { n: culledOf(f), time: momentText(f.checked_at, today) };
    case "culled": return { n: culledOf(f) };
    case "problem_mismatch": return { n: count(f.mismatch) };
    case "problem_missing": return { n: count(f.missing) - culledOf(f) };
    case "drive_only": return { n: count(f.drive_only) };
    case "busy": return { time: momentText(f.next_check_at, today) };
    case "retired": return { reason: safe(st.retired && st.retired.reason) };
    // the JOB folder as OneDrive last named it (the status's job, OD §2.3; review round 1)
    case "job_moved_out": return { name: safe(st.job && st.job.name) || WORDS.completion.someone };
    default: return {};
  }
}

/** The lines a Mark done waiting for the office computer replaces with completion.done_sent (PF §13.1, §37): each asks
    for the Mark done just pressed. */
export const DONE_SENT_FOR = Object.freeze(["not_done", "closed_files", "closed_old_pc"]);

/** The completion line's fillers (photo_drive_status.completion and .marketing - its mode already applied, OD §10.6).
    o.doneSent: a done change of the shoot waits for the office computer (Portal 2's own, sent by Mark done…) - a
    not_done, closed_files or closed_old_pc line then reads completion.done_sent, never "mark the shoot done" beside the
    Mark done just pressed. */
export function completionLine(status, o) {
  const st = status || {};
  const code = st.completion;
  if (!code || typeof WORDS.completion[code] !== "string") return null;
  if (o && o.doneSent && DONE_SENT_FOR.indexOf(code) !== -1) return { code: "done_sent", text: WORDS.completion.done_sent };
  const today = (o && o.today) || "";
  const m = st.marketing || {};
  const v = {};
  if (code === "closed_files" || code === "closed_plan") v.skipped_or_missed = st.closed || st.shoot_status || "";
  if (code === "ready") v.when = momentText(m.ready_at, today);
  if (code === "claimed") v.name = someone(m.by);
  if (code === "posted") { v.day = dayText(dayOfMoment(m.at), today); v.name = someone(m.by); }
  if (code === "passed") v.reason = safe(m.reason);
  return { code, text: word("completion", code, v) };
}

/** Whether a shoot that is not open may still be marked done on the phone (PF §6.8, §13.7): a skipped or missed shoot
    whose files were handed in - also while an old DCR Agents 2 cannot bring it back yet (closed_old_pc) - never
    closed_plan. */
export function bringBack(status) {
  const c = status && status.completion;
  return c === "closed_files" || c === "closed_old_pc";
}

/** Whether a status is the OneDrive edition's (it always answers mode, OD §5.7, §10.6): one without it - the Google
    edition's after the OneDrive roll back - is not available (the Files section hidden, nothing sent). */
export function available(status) {
  return !!status && typeof status === "object" && status.mode !== null && status.mode !== undefined;
}

/** The lines that stand alone (rules 0-3, 3b): while one shows, nothing is handed in or added, and no line rests on the
    rows. */
export const GONE_LINES = Object.freeze(["not_available", "not_connected", "root_lost", "moved_out", "job_moved_out"]);

/** What the shoot sheet's Files section draws from one photo_drive_status answer (Portal 2's viewer). o: {today, now,
    doneSent (a done change of the shoot waits for the office computer: completion.done_sent, no bring-back), admin (the
    viewer is an admin: photo_my_access), viewer: {device_id (this phone's device row), running_here (this page sends
    now), phone_found (Hand in what's there's find)}, sending: {sent, total} (this page's own counts)}.
    -> {available, lines: [{code, text, tone}], help: [titles], completion: {code, text} | null, told: text | null
        (unless o.admin), open: link | null, check: boolean, addPhone: boolean, bringBack: boolean} */
export function filesView(status, o) {
  const st = status || {};
  const opt = o || {};
  const viewer = Object.assign({}, opt.viewer || {}, { app: "portal2" });
  const codes = filesLine(st, viewer, opt.now);
  const alone = codes.length > 0 && GONE_LINES.indexOf(codes[0]) !== -1;
  const lines = codes.map((code) => ({ code, text: word("files", code, lineValues(code, st, opt)), tone: TONE[code] || "" }))
    .filter((l) => l.text);
  if (!available(st)) {
    return { available: false, lines, help: [], completion: null, told: null, open: null, check: false, addPhone: false, bringBack: false };
  }
  // (a Mark done waiting: no "Bring the shoot back?" chip beside done_sent - it was just pressed)
  const help = (Array.isArray(st.help) ? st.help : []).filter((h) => !(opt.doneSent && h === "closed_files"))
    .map((h) => WORDS.help[h]).filter((t) => typeof t === "string");
  const can = st.can || {};
  const folder = st.folder || null;
  const rootFound = !!(st.root && st.root.state === "found");
  const open = can.open_folder && folder && linkOk(folder.link) ? folder.link : null;
  // who was told and how: an admin's line (did the notices go out?), as on the Ready card (DCR Desktop 2's FilesSection)
  const told = opt.admin && st.marketing && Array.isArray(st.marketing.told) ? toldLine(st.marketing.told) : null;
  const uploads = Array.isArray(st.uploads) ? st.uploads.filter(Boolean) : [];
  return {
    available: true, lines, help, completion: completionLine(st, opt), told, open,
    // [Check again] stays on a gone folder's line (a check is what finds it put back), never while the root is lost, nor
    // on a gone JOB folder's line (its shoot folder is not in OneDrive: a check of it proves nothing - DCR Desktop 2's
    // files_view offers none there either)
    check: !!(can.check && folder && rootFound && codes[0] !== "job_moved_out"),
    // [Add photos and videos] (OD §3.3 step 1): the database's can.add_from_phone (the mode on for the job, phone
    // uploads on, the root found and the folders there), never while another hand-in of the shoot is open
    addPhone: !!(can.add_from_phone && !alone && !openUpload(uploads)),
    bringBack: bringBack(st) && !opt.doneSent,
  };
}

/* ── the Ready for marketing list ─────────────────────────────────────── */

export const WHERE = Object.freeze(["instagram", "facebook", "website", "houzz", "google", "other"]);
export const NOTE_MAX = 300;
export const LINK_MAX = 300;
export const DONE_DAYS = 90;

// a card's access line (in Open in OneDrive's place) is about the viewer's account, not the shoot: calmer than the
// shoot's own warnings, and never the list row's one warning (pages/shoots-files.js)
const ACCESS_TONE = { no_access: "info", access_waiting: "wait", access_not_company: "warn" };

/** The words of one card. item: a photo_ready_list item; me: its `me`. o: {today}. -> {chip, title, row, rest, warnings
    [{code, text, tone, access}], told (null unless me.admin), buttons: [{code, text}], posted: {where, link, note} | null,
    passed: text | null, shoot: id | null, link: OneDrive href | null, tip: ready.open_tip with the link | null} */
export function readyView(item, me, o) {
  const it = item || {};
  const today = (o && o.today) || "";
  const pick = readyCard(it, me);
  const chipV = {};
  if (pick.chip === "chip_claimed") chipV.name = someone(it.claimed && it.claimed.name);
  if (pick.chip === "chip_posted") { chipV.day = dayText(dayOfMoment(it.posted && it.posted.at), today); chipV.name = someone(it.posted && it.posted.name); }
  const files = it.files || {};
  const title = safe(it.shoot_name);
  const rowV = { shoot: title, job: safe(it.job_label), day: dayText(it.shoot_day, today), files: filesWords(files), size: sizeWords(files.bytes), by: someone(it.by) };
  const row = word("ready", "row", rowV);
  // the list's second line: the same row without the shoot's name (its first filler), which the list shows above it
  const rest = word("ready", "row", Object.assign({}, rowV, { shoot: "{shoot}" })).replace(/^\{shoot\}( · )?/, "");
  const warnings = pick.warnings.map((w) => {
    const v = {};
    if (w === "files_missing") v.n = count(it.files_missing);
    if (w === "more_files") { v.n = count(it.files_added); v.day = dayText(dayOfMoment(it.files_added_at || it.ready_at), today); }
    const access = Object.prototype.hasOwnProperty.call(ACCESS_TONE, w);
    return { code: w, text: word("ready", w, v), tone: access ? ACCESS_TONE[w] : "warn", access };
  }).filter((w) => w.text);
  const link = pick.buttons.indexOf("btn_open") !== -1 && linkOk(it.link) ? it.link : null;
  const buttons = pick.buttons.filter((b) => b !== "btn_open" || link).map((b) => ({ code: b, text: WORDS.ready[b] }));
  const p = it.state === "posted" && it.posted ? it.posted : null;
  const posted = p ? {
    where: (Array.isArray(p.where) ? p.where : []).filter((w) => WHERE.indexOf(w) !== -1).map((w) => WORDS.ready["where_" + w]),
    link: postLink(p.link), note: safe(p.note),
  } : null;
  const passed = it.state === "passed" && it.passed ? word("completion", "passed", { reason: safe(it.passed.reason) }) : null;
  // who was told and how: an admin's line (did the notices go out?) - a marketing member was told themselves, so their
  // card never names them in the third person (DCR Desktop 2's ReadyCard: told_line only for me.admin)
  const told = me && me.admin ? toldLine(it.told) : null;
  return { chip: { code: pick.chip, text: word("ready", pick.chip, chipV) }, title, row, rest, warnings, told, buttons, posted, passed,
    shoot: it.shoot_id === null || it.shoot_id === undefined ? null : Number(it.shoot_id), link,
    // OD §8.4: open it on the web or in the OneDrive app, never sync the whole folder (a synced shortcut downloads every
    // video) - beside Open in OneDrive
    tip: link ? WORDS.ready.open_tip : null };
}

/** The question a reopen asks first, or null (PF §13.5, §37): the database keeps none of what marketing wrote after a
    reopen (PF §11.2), so Not posted yet asks when the row has where it was posted, its link or a note (ready.reopen_ask),
    and Back on the list always (ready.reopen_passed_ask). -> "reopen_ask" | "reopen_passed_ask" | null */
export function reopenAsk(item) {
  const it = item || {};
  if (it.state === "passed") return "reopen_passed_ask";
  if (it.state !== "posted") return null;
  const p = it.posted || {};
  const where = Array.isArray(p.where) && p.where.length > 0;
  return where || (typeof p.link === "string" && p.link.trim()) || (typeof p.note === "string" && p.note.trim()) ? "reopen_ask" : null;
}

/** The Home card's badge for marketing: ready plus claimed by me; null for none. */
export function homeBadge(counts) {
  const c = counts || {};
  const n = count(c.ready) + count(c.mine);
  return n ? { cls: "", text: word("ready", "home_badge", { n }), n } : null;
}

/** The Ready view is the first tab for someone who is only on marketing. */
export function marketingOnly(access) {
  const a = access || {};
  return !!(a.marketing && !a.admin && !a.photographer);
}

/* ── refusals in words ────────────────────────────────────────────────── */

/** A HINT code in words (unknown codes - a screen's own mistake - read hint.other). */
export function hintText(code, values) {
  return typeof WORDS.hint[code] === "string" ? fill(WORDS.hint[code], values || {}) : WORDS.hint.other;
}

/** The photo-files function's refusal (repo/photo-files.js FilesError) in words; null for 409 root_lost and 409
    not_connected (OD §4.7: no root row yet - the page reads the status again: its root_lost or not_connected line says
    it, never a second sentence). {codes} of uploads_test from the status's mode_codes when the page passes them
    (o.codes); {max} of too_large from the answer's max_bytes. */
export function filesText(err, o) {
  const e = err || {};
  const info = e.info || {};
  if (e.code === "offline") return WORDS.files.read_failed;
  if (e.code === "not_deployed") return WORDS.hint.not_configured;
  if (e.code === "not_available") return WORDS.files.not_available;
  if (e.status === 409 && (e.code === "root_lost" || e.code === "not_connected")) return null;
  if (e.status === 401) return "Your sign-in has expired. Please sign in again.";
  if (e.code === "uploads_test") return hintText("uploads_test", { codes: ((o && o.codes) || []).map(safe).filter(Boolean).join(", ") });
  if (e.code === "too_large") return hintText("too_large", { max: sizeWords(info.max_bytes) });
  if (e.code && typeof WORDS.hint[e.code] === "string" && !/\{[a-z_]+\}/.test(WORDS.hint[e.code])) return WORDS.hint[e.code];
  if (e.status === 403) return WORDS.hint.forbidden;
  if (e.status === 429) return WORDS.hint.rate;
  if (e.status === 502) return WORDS.hint.onedrive_failed;
  if (e.status === 503) return WORDS.hint.busy;
  if (e.status === 507) return WORDS.hint.onedrive_full;
  return WORDS.hint.other;
}

/** A photo_marketing_act refusal in words (PF §11.2, §13.5). err: a repo PhotoError; action, state: what was asked. No
    answer (no signal, a gateway's 5xx: e.retryable) is hint.no_answer - the database may have done it, and pressed again
    it is its {again: true}, never done twice; never "ask an admin". */
export function actText(err, action, state, o) {
  const e = err || {};
  const today = (o && o.today) || "";
  const code = e.hint || "";
  if (e.retryable) return WORDS.hint.no_answer;
  if (code === "not_yours") return action === "reopen" ? WORDS.ready.not_yours_reopen : WORDS.ready.not_yours;
  if (code === "too_late" && (action === "reopen" && state === "passed")) return WORDS.ready.too_late_passed;
  if (code === "taken") {
    const d = e.detail || {};
    return fill(WORDS.ready.taken, { name: someone(d.by), when: momentText(d.at, today) });
  }
  return hintText(code);
}

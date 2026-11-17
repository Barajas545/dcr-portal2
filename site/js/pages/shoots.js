/* The shoot schedule - shoots.html (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule, docs/DATABASE.md §39; the contract DCR Desktop 2 docs/PHOTO-SCHEDULE.md; the owner's
   decisions of 2026-11-09).

   DCR Agents 2 on the office computer is the ONLY writer of photo plans: it mirrors them into photo_plans / photo_shoots,
   and this page reads that mirror (repo/photo.js; admins and the photo team - photo_my_access() says who, the database
   decides every read). A change is asked for, never written: photo_change_preview shows what it would do,
   photo_change_request queues it with the plan rev this screen read, the office computer takes it, applies it, answers
   and mirrors the plan again - the new days arrive through the Realtime watch (repo/photo.js watchSchedule).

   * Views: Agenda (the default: Late, Today, This week, Next week, Later, No date yet, Done & closed folded), By job (each
     plan's shoots in order with its job dates) and Month (Sunday first). Phone first (one column; a shoot opens full
     screen with its own way back); from 1024 px the list is on the left and the shoot on the right (Month takes the wide
     side). "Only my jobs" (the plans whose photographer is me) and "Archived plans too".
   * The header says in plain words when the office computer is not running (photo_pc_status: off, paused, not seen).
   * Deep links: ?shoot=<photo_shoots.id> (DCR Agents 2's reminders link here) opens that shoot; ?plan=<id> opens a plan
     in By job; ?task=<a My Tasks task id> opens that task's shoot; ?view= and ?month= too.
   * A shoot: its name, job, day and grace, the anchor in words, the chips (Late, Moved - not told yet, Firm, a change
     waiting), the facts, my changes still waiting (with Cancel while new) and my recent ones (applied, refused in plain
     words, sent to the office), the brief's safe fields and the last history entries. Admins and photographers (can_photo)
     get Move…, Mark done… (an optional note; the sheet is the confirm) and Undo… (my last applied change within 7 days -
     an admin: anyone's; never "done"). Marketing and others read only: no action button at all.
   * Move… (owner decision 2) ALWAYS asks: "Only this shoot" (preselected), "This shoot and the later ones" (the same
     number of days) or "The job date moved" (which job date - framing start, delivery, framing complete, house complete -
     and its new day). The plan's shoot days are the normal choice in the day strip; another day is allowed but marked.
     Every change of choice or day asks photo_change_preview again (debounced) and the sheet lists EVERY shoot that will
     move (from -> to), what stays and why, what will be skipped and the series that will be re-planned, and says when
     the office approves first ("This job date (Framing start) is Firm - your change goes to the office to approve").
     Apply sends photo_change_request with the base rev the screen read; a PT409 "changed" reads the plan again and shows
     the new preview ("Someone changed this job's shoots meanwhile - here is the new preview") - never a silent overwrite.
     What is sent is what the sheet lists (the P3 review): a watch read while the sheet is open draws it again from the
     new read (the shoot's day, the job dates, the admin's Firm box) and previews again; Apply asks the preview once more
     and shows a different answer instead of sending it (the database's "changed" looks at the named shoot only); the
     queued change's own preview is compared after. An admin's Firm is sent only once he ticked it himself (else the job
     date's current flag, §8.1). On a phone the new preview comes into view and its count stands beside Apply; the sheet
     has its own history entry (Back closes the sheet only). While a change is on its way Cancel reads "Close (still
     sending)"; a lost answer is "it may not have been sent" and a second press is the same change (again: true, worded
     from what became of it).
   * The answers: the office computer's answer to a change of mine is a toast naming the change and its job; what this
     device heard is kept per account, so an answer that came while the page was closed is told on the next visit, and a
     refusal marks the row "Not done - see why". A photo team change heard by the watch reads photo_my_access again.
     A poll or watch read that changed nothing leaves the list and the status regions as they are (the keyboard stays).
   Every free text is the mirror's (masked by the database) and goes through the site's money masks again (map/photo.js
   safeText) before it is put on the page escaped.

   P5 - the photo files in the Office OneDrive (DCR Desktop 2 migrations 20261111000100_photo_files and
   20261114000100_photo_files_onedrive, the Edge Function photo-files; the contract DCR Desktop 2
   docs/PHOTO-FILES-ONEDRIVE.md §3.3, §10; repo/photo-files.js, map/photo-files.js, pages/shoots-files.js):
   * A shoot's sheet has a Files section: ONE read, photo_drive_status (the page decides no OneDrive fact itself), the
     lines the contract's chooser gives for the phone, the completion line and who was told, and the phone's buttons -
     [Open in OneDrive] only with can.open_folder (else the line of the viewer's access) and [Check again] (photo-files
     check, never by itself: every call counts toward the person's 30 in 10 minutes; on a gone folder's line too). A
     status without mode (the Google edition, OD §5.7) reads as no photo files: the section is hidden. Mark done…
     also brings back a skipped or missed shoot whose files were handed in (closed_files / closed_old_pc).
   * The phone's hand-in (OD §3.3, js/photo-send.js - one hand-in at a time on this page): [Add photos and videos]
     (can.add_from_phone) opens the picker (photos and videos; HEIC named); the pick is planned and sent at once - the
     big-video line first -, the file in flight's progress under the lines, [Hand in what's there] / [Cancel it] while
     it sends (no separate Stop: locking the phone is the pause). Stopped on THIS phone (the status's hand-in of this
     device, nothing of it running here - a reload): [Pick the rest again] (its keys held), [Hand in what's there],
     [Cancel it]; after Hand in what's there found files in OneDrive unchecked: [Pick them again] / [Hand in without
     them]. A phone hand-in stopped on another device: [Hand in what's there] (once something of it is in) / [Cancel it]
     for its starter or an admin. While it sends another shoot, no shoot offers a hand-in. Leaving the shoot never stops
     a send; every phase change reads the status again.
   * The fourth view, Ready for marketing (?view=ready, ?ready=<id> - the push notice and the e-mail land on the card):
     photo_ready_list's cards with their chip, warnings and buttons (I'm on it, Posted…, Not for posting…, Take it
     over…, Not me any more, Not posted yet / Back on the list), each act a compare-and-set on the state shown. The
     first view for someone only on marketing.
   * Realtime: photo_marketing, photo_drive_folders and photo_shoot_uploads are only "read again" triggers (never shown);
     a Ready row's arrival asks the push function to drain once per (id, ready_at) (§10.7). A database without P5 hides
     all of it: P3 works as before.

   P6, step 1 - the job's place and the files icon (the owner's request of 2026-11-16; the contract DCR Desktop 2
   docs/PHOTO-SHOOT-EDITS.md §1.4, §1.6, cited SE; no database change):
   * the plans' jobs are read with the schedule (repo/projects.js places: the address and the picture's file id, under
     the projects RLS - read live, never kept, never mirrored; no Realtime watch of projects). The shoot sheet has a place
     block under its job line: a 64 px picture (a neutral tile without one) and the address as a Google Maps link in a
     new tab; By job's header a 48 px picture left of the job and the address line under it. List rows stay "job · city".
   * the pictures (js/shoot-pictures.js): never a signed link in an img - each picture's bytes fetched once per file id
     and shown as a blob: URL for the page's life (the page stays open on site for hours); only the pictures the page
     draws are asked for (By job's, the open sheet's - step 1's review, round 3); one that cannot be had is not asked
     for again at every read (refused or no picture: never again; no link or no signal: after 10 minutes), one that
     fails to draw shows the neutral tile. The page's security policy is not changed.
   * the files icon (SE §1.6): Agenda and By job rows and the shoot sheet show a camera and a film with their counts when
     a shoot has photos or videos in OneDrive (map/shoots.js filesIcon), from the shoot folders' rollups read with the
     schedule and again on a photo_drive_folders or photo_marketing event (round 3: the Ready list holds marketing's
     culls; round 4: so does a hold a second card lifted, for the first card's culls), at most every 2 s
     (repo/photo-files.js folderStates: the counts and states only, under the tables' RLS - a reader without it sees no
     icon); the newest read wins whatever order the answers land in, and the open sheet's icon is drawn again with the
     rows (step 1's review, round 1). */

import { boot, esc, toast, confirmBox, errorText, D } from "./shell.js";
import { companyToday, rememberPhotoAccess } from "../common2.js";
import * as repo from "../repo/photo.js";
import {
  agenda, monthGrid, planShoots, plansInOrder, visiblePlans, shootChips, milestoneChips, anchorText, moveChoices, moveArgs, previewWords,
  shootActions, canCancel, pendingFor, pendingTarget, isOpen, isLate, followsMilestone, dayText, isDay, safeText, movedNotTold, refusalText, lateDays,
  MILESTONES, MILESTONE_LABEL, PHASE_LABEL, NOT_READY_TEXT, EMPTY_TEXT, NOTE_MAX, REASON_MAX, isOpenChange,
} from "../map/photo.js";
import * as V from "../map/shoots.js";
import * as files from "../repo/photo-files.js";
import { WORDS as FW, filesText, actText, word, marketingOnly, momentText, safe, reopenAsk, filesView } from "../map/photo-files.js";
import { filesHtml, readyListHtml, readyCardHtml, postedBody, passBody, PHONE_BUSY, phoneButtons } from "./shoots-files.js";
import { createPhoneSend, ACCEPT as PICK_ACCEPT } from "../photo-send.js";
import { addDays } from "../map/pacific.js";
import * as projectsRepo from "../repo/projects.js";
import { createPictures } from "../shoot-pictures.js";

const W = typeof window !== "undefined" ? window : {};
/** The page's state (a function: the tests start each walk from a fresh one). */
function freshState() {
  return {
    me: null, access: null, accessError: "", today: "", plans: [], shoots: [], changes: [], pc: null, ready: false, loaded: false, failed: "",
    view: "agenda", month: "", mine: false, archived: false, planFocus: null, day: null, openClosed: false,
    sel: null, open: false, pushed: false, msg: "", lastDetail: null,
    mv: null, seen: {}, seenReady: false, loadSeq: 0, stopWatch: null, timers: [], wired: false, held: [], skipPop: 0,
    // P5b: per shoot {st (photo_drive_status; null: no P5), err, busy, at}; p5: the database has the photo files (null: not
    // known yet); rd: the Ready for marketing view (its two lists, the card open, whether it may be read at all; want: the
    // card a ?ready=<id> link names, opened by the first read that has both lists - a read that failed leaves it waiting)
    files: {}, p5: null, doneAt: {}, stopFiles: null, drainer: null,
    // the phone's hand-in (js/photo-send.js, made when a shoot first needs it); pick: the picker's shoot and kind; pf:
    // per shoot {planning, lines} (the pick's own lines: big_phone, a read that failed)
    phone: null, phoneDeps: null, pick: null, pf: {}, phoneDraw: null, phoneSeen: null,
    rd: { tab: "open", lists: { open: null, done: null }, err: "", sel: null, open: false, pushed: false, busy: false, msg: "", readable: false, seq: 0,
      want: null },
    // P6 (SE §1.4, §1.6): the jobs' places by project id (map/shoots.js toPlace), the shoots' folder rollups by shoot id
    // (the files icon; rollAsk: one more for every read of them begun, rollMark: per shoot the read its rollup came
    // from - the newest question wins), the pictures (js/shoot-pictures.js, made on first need; tests give its parts in
    // picDeps)
    places: {}, rolls: {}, rollAsk: 0, rollMark: {}, rollAt: 0, rollTimer: null, pics: null, picDeps: null,
    // (placeAsk / placeMark: the places' tickets, as the rollups'; side: the last schedule read's places and rollups read,
    // settled - tests wait on it; drawn: the page was drawn once - before that, init draws them; rollRead: the last rollups
    // read an event began, settled - tests wait on it)
    placeAsk: 0, placeMark: 0, side: null, drawn: false, rollRead: null,
  };
}
// the tasks' readers beside the task's own people (20261020000100: the office reads all; field and view-only their own)
const TASK_READERS = ["admin", "manager", "lead", "accountant"];
// what this device heard of my changes, per account: a change the office computer answered while the page was closed is
// still told on the next visit (a refusal is never left unsaid)
const SEEN_KEY = "dcr2:photoSeen:";
const SEEN_MAX = 200;
const state = freshState();

const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);
const T = (v) => esc(safeText(v));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
function wide() {
  try { return !!(W.matchMedia && W.matchMedia("(min-width: 1024px)").matches); } catch (e) { return false; }
}
const planOf = (id) => state.plans.find((p) => p.id === Number(id)) || null;
const shootOf = (id) => state.shoots.find((s) => s.id === Number(id)) || null;
const meId = () => (state.me ? state.me.id : null);
const editor = () => !!(state.access && state.access.canEdit);
const mineOpt = () => (state.mine ? meId() : null);

function errorWords(e) {
  if (e && e.retryable) return "No connection - the shoot schedule could not be read. Try again when you have signal.";
  return errorText(e);
}

/* ── reading ──────────────────────────────────────────────────────────── */

/** Read the mirror (every plan: the archived ones are shown only when asked), the changes the person may see (the last 30
    days) and the office computer's state; draw. o.quiet: a read after a watch or a poll (an error is not shouted).
    An open sheet whose plan moved on is drawn again from this read (sheetReread); o.forceSheet: always (a PT409, or a
    preview that no longer matched at Apply). */
async function load(o) {
  const opt = o || {};
  const seq = ++state.loadSeq;
  let sched = null, ok = false;
  try {
    const [read, ch, pc] = await Promise.all([
      repo.loadSchedule({ archived: true }),
      repo.changes({}),
      repo.pcStatus().catch(() => state.pc),
    ]);
    if (seq !== state.loadSeq) return;
    sched = read;
    state.today = companyToday();
    state.ready = sched.ready;
    state.plans = sched.plans;
    state.shoots = sched.shoots;
    state.changes = ch;
    state.pc = pc;
    state.loaded = true;
    state.failed = "";
    ok = true;
    noticeFinished();
  } catch (e) {
    if (seq !== state.loadSeq) return;
    if (!state.loaded) state.failed = errorWords(e);
    else if (!opt.quiet) toast(errorWords(e), "error");
  }
  // the jobs' places and the shoots' folder rollups (P6) are asked now and drawn when they answer: the schedule is drawn
  // without waiting for them (step 1's review, round 2)
  if (ok) state.side = sideReads(sched.plans, idsOf(sched.shoots));
  if (opt.hold) return;                       // init: drawn once the address is followed
  render();
  if (ok) sheetReread(!!opt.forceSheet);
}

/* ── P6: the job's place, its picture and the files icon (SE §1.4, §1.6) ── */

/** The places and the rollups of a schedule read, asked beside it and never waited for by it: on a weak signal a request
    of theirs that stalls (supabase-js has no time-out) never keeps the schedule on its loading state, nor a watch's
    read of it a round trip later (step 1's review, round 2). Each read takes its ticket when it is asked, and the newest
    question answered wins (takePlaces, takeRolls); one that fails keeps what the page had. Each is drawn when it
    answers - the rows, and the open shoot's sheet -, and the jobs' pictures not shown yet are asked for once the places
    are in. -> a promise of both settled (never rejected; tests wait on it as state.side) */
function sideReads(plans, rollIds) {
  const placeAsk = ++state.placeAsk;
  const rollAsk = ++state.rollAsk;
  const places = readPlaces(plans).then((got) => {
    const moved = got ? takePlaces(placeAsk, got) : false;
    wantPictures();
    if (moved) sideDrawn();
  });
  const rolls = readRolls(rollIds).then((got) => {
    if (got && takeRolls(rollAsk, rollIds, got).length) sideDrawn();
  });
  return Promise.all([places, rolls]).then(() => undefined, () => undefined);
}

/** A place or a rollup answered after the schedule was drawn: the rows and the open shoot's sheet again (nothing before
    the page's first draw - init draws once the address is followed, with what has answered by then). */
function sideDrawn() {
  if (!state.drawn) return;
  renderList();
  if (state.view !== "ready") renderDetail();
}

/** The answer of the places read asked as `ask`: taken unless a read asked later already answered (the newest question
    answered wins, as the rollups'). -> whether the places changed */
function takePlaces(ask, places) {
  if (state.placeMark > ask) return false;
  state.placeMark = ask;
  if (JSON.stringify(places) === JSON.stringify(state.places)) return false;
  state.places = places;
  return true;
}

/** {projectId: place} of these plans' jobs (repo/projects.js places, under the projects RLS), or null when the read
    failed (the page keeps what it had). */
async function readPlaces(plans) {
  const ids = (plans || []).map((p) => p.projectId).filter((v) => v !== null && v !== undefined);
  if (!ids.length) return {};
  try {
    const out = {};
    for (const r of await projectsRepo.places(ids)) {
      const p = V.toPlace(r);
      if (p) out[p.id] = p;
    }
    return out;
  } catch (e) { return null; }
}

/** The ids of these shoots (the ones a rollup read asks for). */
function idsOf(shoots) {
  return (shoots || []).map((s) => s.id).filter(Boolean);
}

/** {shootId: rollup} of these shoots' live folders (repo/photo-files.js folderStates: none on a database without the
    photo files, or for a reader without photo_drive_folders' RLS), or null when the read failed (kept as it was). */
async function readRolls(ids) {
  if (state.p5 === false) return {};
  if (!ids.length) return {};
  try { return (await files.folderStates(ids)) || {}; } catch (e) { return null; }
}

/** The answer of the rollup read asked as `ask` (state.rollAsk when it began) for `ids`: each shoot's rollup is taken
    unless a read asked later already answered for that shoot. On a weak signal reads overlap and their answers come
    in any order: the newest question wins, so an older answer never puts back counts a newer one moved on from (the
    review of step 1, round 1). A shoot the answer leaves out has no live folder (or is not readable): its icon goes.
    -> the ids whose rollup changed */
function takeRolls(ask, ids, rolls) {
  const moved = [];
  for (const id of ids) {
    if ((state.rollMark[id] || 0) > ask) continue;
    state.rollMark[id] = ask;
    const next = rolls[id] || null;
    if (JSON.stringify(next) === JSON.stringify(state.rolls[id] || null)) continue;
    if (next) state.rolls[id] = next; else delete state.rolls[id];
    moved.push(id);
  }
  return moved;
}

// the tables whose Realtime events move the icons (repo/photo-files.js TABLES; only "read again" triggers): a folder's
// rollup, and a shoot going on or off the Ready list - which holds a files problem as marketing's (step 1's review, round
// 3; a hand-in sealed since moves the folder's rollup too) - and how often at most they are read again for them (a
// hand-in confirms file after file: DCR Desktop 2 reads them at most every 2 s too - SE §1.6)
const ROLL_TABLES = ["photo_drive_folders", "photo_marketing"];
const ROLL_EVERY_MS = 2000;

/** A photo_drive_folders or photo_marketing event: the rollups read again now, or - within 2 s of the last such read -
    once when the 2 s are up (one read for every event meanwhile). Never waited for by the event's other reads
    (onFilesWatch): a rollup request that stalls never holds the open shoot's Files section or the Ready list (step 1's
    review, round 2).
    -> the read begun now (settled, never rejected), or nothing */
function rollsSoon() {
  if (state.rollTimer) return null;
  const wait = state.rollAt + ROLL_EVERY_MS - Date.now();
  if (wait <= 0) { state.rollAt = Date.now(); return rereadRolls(); }
  state.rollTimer = setTimeout(() => { state.rollTimer = null; state.rollAt = Date.now(); state.rollRead = rereadRolls(); }, wait);
  return null;
}

/** The rollups read again (not the schedule). Nothing changed: nothing drawn; else the rows, and the open shoot sheet
    when its own shoot's rollup moved - its icon says what the row says (a read the 2 s wait put off lands after the
    event's own redraw of the sheet: the review of step 1, round 1). Never rejects: a drawing that throws is let go (no
    read waits on this one). */
async function rereadRolls() {
  try {
    const ids = idsOf(state.shoots);
    const ask = ++state.rollAsk;
    const rolls = await readRolls(ids);
    if (!rolls) return;                                // the read failed: the icons as they were
    const moved = takeRolls(ask, ids, rolls);
    if (!moved.length) return;
    renderList();
    if (state.sel && state.view !== "ready" && moved.some((id) => String(id) === String(state.sel))) renderDetail();
  } catch (e) { /* the icons as they were */ }
}

function placeOf(plan) {
  return plan && plan.projectId !== null && plan.projectId !== undefined ? state.places[plan.projectId] || null : null;
}

/** Whether the place's address line says the town (it ends with it): the job's own line then leaves it out. */
function townSaid(place) {
  return !!(V.placeLine(place) && place.city);
}

function pics() {
  if (!state.pics) state.pics = createPictures(state.picDeps || undefined);
  return state.pics;
}

/** The plans whose job's picture the page draws now (step 1's review, round 3: every plan's was fetched on each page
    open, archived ones too, though the Agenda and Month draw none): By job's (the plans jobHtml lists) and the open
    shoot sheet's. */
function drawnPlans() {
  const out = [];
  if (state.view === "job") {
    const plans = visiblePlans(state.plans, { archived: state.archived || !!state.planFocus, mine: state.planFocus ? null : mineOpt() });
    for (const p of plans) if (!state.planFocus || p.id === state.planFocus) out.push(p);
  }
  const s = state.sel && state.view !== "ready" ? shootOf(state.sel) : null;
  const sheet = s ? planOf(s.planId) : null;
  if (sheet && out.indexOf(sheet) === -1) out.push(sheet);
  return out;
}

/** The pictures the page draws now that it does not have yet (drawnPlans): fetched (once per file id - one that cannot
    be had is not asked for again at every read: js/shoot-pictures.js), then the page drawn again. Asked when the places
    answer and after every full drawing (a view, a filter, a sheet opened). */
function wantPictures() {
  const ids = drawnPlans().map((p) => { const pl = placeOf(p); return pl ? pl.pictureId : null; }).filter(Boolean);
  if (!ids.length) return;
  pics().want(ids).then((got) => { if (got) { renderList(); if (state.view !== "ready") renderDetail(); } }, () => null);
}

/** The job's picture: its blob: URL in an img (never a signed link), else the neutral tile. */
function picHtml(place, size) {
  const url = place && place.pictureId && state.pics ? state.pics.url(place.pictureId) : null;
  if (url) {
    return '<img class="sh-pic s' + size + '" src="' + esc(url) + '" alt="' + esc(V.PICTURE_TEXT) + '" title="' + esc(V.PICTURE_TEXT) + '" width="' + size +
      '" height="' + size + '" data-pic="' + esc(place.pictureId) + '" />';
  }
  return '<span class="sh-pic s' + size + ' none" aria-hidden="true"></span>';
}

/** The shoot sheet's place block (SE §1.4): the 64 px picture (a neutral tile without one) and the address as a link
    to Google Maps in a new tab. Nothing without a place, or with neither an address nor a picture. */
function placeHtml(plan) {
  const p = placeOf(plan);
  const line = V.placeLine(p);
  if (!p || (!line && !p.pictureId)) return "";
  return '<div class="sh-place">' + picHtml(p, 64) + (line ? '<a class="sh-addr" href="' + esc(V.mapsUrl(p)) + '" target="_blank" rel="noopener noreferrer" title="' +
    esc(V.MAPS_TEXT) + '">' + esc(line) + "</a>" : "") + "</div>";
}

const CAMERA = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" ' +
  'd="M5.6 2.5h4.8l.9 1.5h2.2A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-7A1.5 1.5 0 0 1 2.5 4h2.2l.9-1.5ZM8 5.6a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm0 1.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z"/></svg>';
const FILM = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" ' +
  'd="M2.5 1.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM3 3v1.6h1.6V3H3Zm0 3.2v1.6h1.6V6.2H3Zm0 3.2V11h1.6V9.4H3Zm0 2.4V13h1.6v-1.2H3Zm8.4-8.8v1.6H13V3h-1.6Zm0 3.2v1.6H13V6.2h-1.6Zm0 3.2V11H13V9.4h-1.6Zm0 2.4V13H13v-1.2h-1.6ZM5.8 3v10h4.4V3H5.8Z"/></svg>';

/** The files icon of a shoot (SE §1.6): nothing, or the camera and the film with their counts (map/shoots.js
    filesIcon); its label is the tooltip and what a screen reader says. */
function filesIconHtml(s) {
  const ic = s ? V.filesIcon(state.rolls[s.id]) : null;
  if (!ic) return "";
  return '<span class="sh-fi ' + esc(ic.tone) + '" role="img" aria-label="' + esc(ic.label) + '" title="' + esc(ic.label) + '" data-files="' + esc(ic.tone) + '">' +
    (ic.photos ? '<span class="sh-fi-n">' + CAMERA + esc(ic.photos) + "</span>" : "") +
    (ic.videos ? '<span class="sh-fi-n">' + FILM + esc(ic.videos) + "</span>" : "") +
    (ic.sending ? '<span class="sh-fi-up" aria-hidden="true">↑</span>' : "") + "</span>";
}

/** A picture that failed to draw (its bytes were not a picture after all): the neutral tile now, fetched again at the
    next read. */
function onPicError(ev) {
  const t = ev && ev.target;
  const id = t && t.getAttribute ? t.getAttribute("data-pic") : null;
  if (!id || !state.pics) return;
  if (state.pics.broken(id)) { renderList(); if (state.view !== "ready") renderDetail(); }
}

/* what this device heard of my changes (localStorage, per account; any failure: this page's memory only) */
function seenStore() {
  try { return W.localStorage || null; } catch (e) { return null; }
}
function readSeen(me) {
  try {
    const s = seenStore();
    const v = s && me ? JSON.parse(s.getItem(SEEN_KEY + me) || "null") : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}
function writeSeen(me) {
  try {
    const s = seenStore();
    if (!s || !me) return;
    const keep = {};
    // my changes of the last 30 days as read, and what Apply just sent (not read back yet)
    const ids = new Set(state.changes.filter((c) => c.requestedBy === me).map((c) => String(c.id)));
    Object.keys(state.seen).filter((id) => ids.has(id) || state.seen[id] === "new" || state.seen[id] === "taken").slice(-SEEN_MAX)
      .forEach((id) => { keep[id] = state.seen[id]; });
    s.setItem(SEEN_KEY + me, JSON.stringify(keep));
  } catch (e) { /* a blocked storage: this page's memory only */ }
}

/** A change of mine that the office computer answered since the last read - on this visit, or while the page was closed
    (what this device heard before, per account) - says what it came to, named (V.finishedText with its plan). */
function noticeFinished() {
  const me = meId();
  if (!me) return;
  if (!state.seenReady) {
    const kept = readSeen(me);
    Object.keys(kept).forEach((id) => { if (state.seen[id] === undefined) state.seen[id] = kept[id]; });
  }
  for (const c of state.changes) {
    if (c.requestedBy !== me) continue;
    const before = state.seen[c.id];
    state.seen[c.id] = c.state;
    if (before === undefined) continue;          // first heard here: asked on another device, or long ago
    if ((before === "new" || before === "taken") && c.state !== before) {
      const plan = planOf(c.planId);
      const f = V.finishedText(c, { pc: state.pc, plan, shoots: plan ? planShoots(plan, state.shoots) : [], today: state.today });
      // a sheet open: said when it closes (a toast would sit over the sheet's preview and its buttons)
      if (f && state.mv) state.held.push(f);
      else if (f) say(f);
    }
  }
  state.seenReady = true;
  writeSeen(me);
}

function say(f) {
  toast(f.text, f.kind === "error" ? "error" : f.kind === "ok" ? "ok" : "info");
}

/* ── drawing: the header ──────────────────────────────────────────────── */

function whoText(a) {
  if (!a || !a.ready) return "";
  if (a.admin) return "You: admin" + (a.photographer ? " and photographer" : "");
  if (a.photographer) return "You: photographer" + (a.defaultPhotographer ? " (the default photographer)" : "");
  if (a.marketing) return "You: marketing - read only";
  return "";
}

function renderHead() {
  const a = state.access;
  const ok = !!(a && a.ready && a.canRead);
  if ($("shWho")) $("shWho").textContent = whoText(a);
  // not on the team, or no shoot schedule in the database yet: the box under it says so (once, not twice)
  const lead = state.accessError || (a && (!a.ready || !a.canRead)) ? "" : !a ? "Loading the shoot schedule…" : a.canEdit ? V.EDIT_TEXT : V.READ_ONLY_TEXT;
  if ($("shLead")) $("shLead").textContent = lead;
  const pc = ok && state.loaded ? V.pcHeader(state.pc) : null;
  const pcBox = $("shPc");
  if (pcBox) {
    // a status region: written only when its words change (every poll and watch read would have it read out again)
    if (pcBox.hidden !== !pc) pcBox.hidden = !pc;
    if (pcBox.textContent !== (pc ? pc.text : "")) pcBox.textContent = pc ? pc.text : "";
    if (pcBox.getAttribute("data-state") !== (pc ? pc.state : "on")) pcBox.setAttribute("data-state", pc ? pc.state : "on");
  }
  const bar = $("shBar");
  if (bar) bar.hidden = !(ok && state.loaded && !state.failed && (state.plans.length || readyMay()));
  const readyBtn = document.querySelector('#shViews [data-view="ready"]');
  if (readyBtn && readyBtn.hidden !== !readyMay()) readyBtn.hidden = !readyMay();
  const filters = document.querySelector("#shBar .sh-filters");
  if (filters && filters.hidden !== (state.view === "ready")) filters.hidden = state.view === "ready";
  document.querySelectorAll("#shViews [data-view]").forEach((b) => b.setAttribute("aria-pressed", b.getAttribute("data-view") === state.view ? "true" : "false"));
  const mineBox = $("shMineBox");
  if (mineBox) mineBox.hidden = !state.plans.some((p) => p.photographerProfileId && p.photographerProfileId === meId());
  if ($("shMine")) $("shMine").checked = !!state.mine;
  if ($("shArchived")) $("shArchived").checked = !!state.archived;
  const layout = $("shLayout");
  if (layout) {
    layout.classList.toggle("month", state.view === "month");
    // nothing to pick (not for this account, no schedule in the database, a failed read, no plan yet): no empty "Pick a
    // shoot" panel beside the words on a desk
    const readyEmpty = state.view === "ready" && (!!(state.rd.err && state.rd.want) || !((state.rd.lists[state.rd.tab] || { items: [] }).items.length));
    layout.classList.toggle("solo", !!(state.accessError || (a && (!a.ready || !a.canRead)) ||
      (state.loaded && (state.failed || (state.view === "ready" ? readyEmpty : !state.ready || !state.plans.length)))));
  }
  const count = $("shCount");
  if (count) {
    let html = "";
    if (ok && state.loaded && !state.failed && state.plans.length && state.view !== "ready") {
      const plans = visiblePlans(state.plans, { archived: state.archived, mine: mineOpt() });
      const ids = new Set(plans.map((p) => p.id));
      const open = state.shoots.filter((s) => ids.has(s.planId) && isOpen(s));
      const late = open.filter((s) => isLate(s, state.today)).length;
      html = esc(plural(plans.length, "job") + " · " + plural(open.length, "open shoot")) + (late ? " · <b>" + esc(late + " late") + "</b>" : "");
    }
    // a status region too: the same words are not written again
    if (count.getAttribute("data-said") !== html) {
      count.innerHTML = html;
      count.setAttribute("data-said", html);
    }
  }
}

/* ── drawing: the lists ───────────────────────────────────────────────── */

function chipHtml(c) {
  return '<span class="sh-chip ' + esc(c.cls || "") + '">' + esc(c.text) + "</span>";
}

function dateHtml(s) {
  if (!isDay(s.plannedDate)) return '<span class="sh-date none"><span class="d">No date</span></span>';
  const f = V.rowFacts(s, null, state.today);
  const mon = dayText(s.plannedDate, state.today).split(" ")[1] || "";
  return '<span class="sh-date"><span class="wd">' + esc(f.wd) + '</span><span class="d">' + esc(f.date) + '</span><span class="mo">' + esc(mon) + "</span></span>";
}

function rowChips(s, plan) {
  const out = shootChips(s, plan, state.today, { pending: pendingFor(state.changes, s), refused: V.lastRefused(state.changes, s, meId(), new Date()) })
    .filter((c) => !(c.key === "status" && s.status === "planned"));
  // a plan that is not live says so on each of its shoots (in review: its days are not settled yet)
  if (plan && plan.status !== "active") out.push({ key: "plan", text: V.planFacts(plan).statusText, cls: "dim" });
  return out;
}

function rowHtml(s, plan, o) {
  const late = isLate(s, state.today);
  const cls = "sh-row" + (late ? " late" : isOpen(s) && s.plannedDate === state.today ? " today" : "") + (isOpen(s) ? "" : " closed");
  const f = V.rowFacts(s, plan, state.today);
  const chips = rowChips(s, plan);
  return '<button type="button" class="' + cls + '" data-shoot="' + esc(s.id) + '"' + (state.sel === s.id ? ' aria-current="true"' : "") + ">" +
    dateHtml(s) + '<span class="sh-main"><span class="sh-name">' + T(s.name) + "</span>" +
    (o && o.noJob ? "" : '<span class="sh-job">' + T(f.job) + (f.city ? " · " + T(f.city) : "") + "</span>") +
    (chips.length ? '<span class="sh-chips">' + chips.map(chipHtml).join("") + "</span>" : "") + "</span>" + filesIconHtml(s) + "</button>";
}

function emptyHtml(title, text, retry) {
  return '<div class="sh-empty"><b>' + esc(title) + "</b>" + esc(text || "") +
    (retry ? '<div><button type="button" class="sh-btn" data-act="reload" style="margin-top:12px">Try again</button></div>' : "") + "</div>";
}

function agendaHtml() {
  const a = agenda(state.plans, state.shoots, state.today, { weekStart: 0, mine: mineOpt(), archived: state.archived, changes: state.changes });
  if (a.empty) return emptyHtml(state.mine ? "No shoot on your jobs" : "No shoots", state.mine ? "Untick “Only my jobs” to see every job's." : "");
  return a.groups.filter((g) => g.count).map((g) => {
    const rows = g.entries.map((e) => rowHtml(e.shoot, e.plan)).join("");
    if (g.folded) {
      return '<details class="sh-grp closed"' + (state.openClosed ? " open" : "") + '><summary data-act="fold">' + esc(g.label) +
        ' <span class="sh-n">' + g.count + "</span></summary>" + rows + "</details>";
    }
    return '<section class="sh-grp ' + esc(g.key) + '"><h3>' + esc(g.label) + ' <span class="sh-n">' + g.count + "</span></h3>" + rows + "</section>";
  }).join("");
}

function planHtml(p) {
  const f = V.planFacts(p);
  const shoots = planShoots(p, state.shoots);
  const meta = [f.photographer ? "Photographer: " + f.photographer : "", f.shootDays, f.suggestions].filter(Boolean).join(" · ");
  // the job's place (SE §1.4): a 48 px picture left of the job (the neutral tile without one) and its address line under
  // it - the line names the town, so the town is not said twice
  const place = placeOf(p);
  const line = V.placeLine(place);
  return '<section class="sh-plan' + (state.planFocus === p.id ? " focus" : "") + '" id="shPlan' + esc(p.id) + '" data-plan="' + esc(p.id) + '">' +
    '<header class="sh-plan-hd"><div class="sh-plan-top">' + picHtml(place, 48) + '<div class="sh-plan-id"><div class="sh-plan-t"><b>' + T(f.label) + "</b>" +
    (f.city && !townSaid(place) ? "<span>" + T(f.city) + "</span>" : "") +
    (f.title && f.title !== f.label ? "<span>" + T(f.title) + "</span>" : "") +
    (f.statusText ? '<span class="sh-chip dim">' + esc(f.statusText) + "</span>" : "") + "</div>" +
    (line ? '<div class="sh-plan-addr">' + esc(line) + "</div>" : "") + "</div></div>" +
    '<div class="sh-plan-meta">' + T(meta) + "</div>" +
    '<div class="sh-ms" aria-label="Job dates">' + milestoneChips(p, state.today).map((m) => '<span class="sh-chip' + (m.firm ? " firm" : m.date ? "" : " dim") + '">' +
      esc(m.text) + "</span>").join("") + "</div></header>" +
    '<div class="sh-plan-rows">' + (shoots.length ? shoots.map((s) => rowHtml(s, p, { noJob: true })).join("")
      : '<div class="sh-empty" style="margin:0 0 8px">No shoots in this plan yet.</div>') + "</div></section>";
}

function jobHtml() {
  let plans = plansInOrder(visiblePlans(state.plans, { archived: state.archived || !!state.planFocus, mine: state.planFocus ? null : mineOpt() }), state.shoots, state.today);
  let head = "";
  if (state.planFocus) {
    plans = plans.filter((p) => p.id === state.planFocus);
    head = '<button type="button" class="sh-allbtn" data-act="all-jobs">← All jobs</button>';
  }
  if (!plans.length) return head + emptyHtml(state.planFocus ? V.PLAN_GONE_TEXT : "No jobs", state.mine ? "Untick “Only my jobs” to see every job." : "");
  return head + plans.map(planHtml).join("");
}

function evHtml(e) {
  const code = e.plan.projectCode || e.plan.label;
  return '<button type="button" class="sh-ev' + (e.late ? " late" : "") + (e.closed ? " closed" : "") + '" data-shoot="' + esc(e.shoot.id) + '"' +
    (state.sel === e.shoot.id ? ' aria-current="true"' : "") + ' title="' + T(e.shoot.name + " - " + e.plan.label) + '">' + T(e.shoot.name) +
    '<span class="job">' + T(code) + "</span></button>";
}

function monthHtml() {
  const month = state.month || state.today.slice(0, 7);
  const g = monthGrid(month, state.plans, state.shoots, state.today, { weekStart: 0, mine: mineOpt(), archived: state.archived });
  const head = '<div class="sh-mhd"><button type="button" class="sh-mbtn" data-act="month-prev" aria-label="The month before"' +
    (V.monthInRange(g.prev, state.today) ? "" : " disabled") + ">‹</button><b>" + esc(g.label) + "</b>" +
    '<button type="button" class="sh-mbtn" data-act="month-next" aria-label="The month after"' + (V.monthInRange(g.next, state.today) ? "" : " disabled") + ">›</button>" +
    (g.month !== state.today.slice(0, 7) ? '<button type="button" class="sh-mbtn" data-act="month-today">This month</button>' : "") + "</div>";
  const cells = g.weekdays.map((w) => '<div class="sh-wd">' + esc(w) + "</div>").join("") + g.weeks.map((week) => week.map((c) => {
    const n = c.entries.length;
    const dots = n ? '<span class="sh-dots" aria-hidden="true">' + c.entries.slice(0, 3).map((e) => '<span class="sh-dot' + (e.late ? " late" : e.closed ? " closed" : "") + '"></span>').join("") + "</span>" : "";
    return '<div class="sh-cell' + (c.inMonth ? "" : " out") + (c.isToday ? " today" : "") + (c.isPast && !c.isToday ? " past" : "") + (state.day === c.day ? " picked" : "") + '">' +
      '<button type="button" class="sh-dnum" data-act="day" data-day="' + esc(c.day) + '" aria-label="' + esc(dayText(c.day, state.today) + (n ? ", " + plural(n, "shoot") : ", no shoot")) + '"' +
      (state.day === c.day ? ' aria-pressed="true"' : "") + "><span>" + esc(c.date) + "</span>" + dots + "</button>" +
      (n ? '<div class="sh-evs">' + c.entries.slice(0, 3).map(evHtml).join("") + (n > 3 ? '<span class="sh-more">+' + (n - 3) + " more</span>" : "") + "</div>" : "") +
      "</div>";
  }).join("")).join("");
  let dayList = "";
  if (state.day && state.day.slice(0, 7) === g.month) {
    const list = [];
    g.weeks.forEach((w) => w.forEach((c) => { if (c.day === state.day) c.entries.forEach((e) => list.push(e)); }));
    dayList = '<div class="sh-dayl" id="shDayList"><h3>' + esc(dayText(state.day, state.today)) + "</h3>" +
      (list.length ? list.map((e) => rowHtml(e.shoot, e.plan)).join("") : '<div class="sh-empty" style="margin:0">No shoot that day.</div>') + "</div>";
  }
  const undated = g.undated.length ? '<div class="sh-dayl"><h3>No date yet</h3>' + g.undated.map((e) => rowHtml(e.shoot, e.plan)).join("") + "</div>" : "";
  return '<div class="sh-month">' + head + '<div class="sh-grid">' + cells + "</div>" + dayList + undated + "</div>";
}

/** The list's markup now ("" while there is nothing to draw yet). */
function listHtml() {
  const a = state.access;
  const note = state.msg ? '<div class="sh-pc" role="status">' + esc(state.msg) + "</div>" : "";
  if (state.accessError) return emptyHtml("Could not open the shoot schedule", state.accessError, true);
  if (!a) return null;
  if (!a.ready) return emptyHtml("Not in the database yet", NOT_READY_TEXT + ".");
  if (!a.canRead) return emptyHtml("Not for your account", V.NO_ACCESS_TEXT) + '<p style="margin-top:12px"><a class="sh-btn" href="dashboard.html">← Home</a></p>';
  if (state.failed) return note + emptyHtml("Could not read the shoot schedule", state.failed, true);
  if (!state.loaded) return null;
  if (!state.ready) return emptyHtml("Not in the database yet", NOT_READY_TEXT + ".");
  if (!state.plans.length) return note + emptyHtml("No shoot schedule yet", EMPTY_TEXT + ".");
  if (state.view === "ready") return readyListHtml(state.rd, { today: state.today });
  return note + (state.view === "job" ? jobHtml() : state.view === "month" ? monthHtml() : agendaHtml());
}

/** Draw the list. A read that changed nothing leaves it as it is (every poll and watch read comes here: a row or day the
    keyboard is on keeps the focus); a changed list keeps the keyboard on the same row or day (keepFocus). */
function renderList() {
  const box = $("shList");
  if (!box) return;
  const html = listHtml();
  if (html === null) return;
  if (box._shHtml === html) return;
  keepFocus("shList", () => { box.innerHTML = html; });
  box._shHtml = html;
}

/* ── drawing: the shoot ───────────────────────────────────────────────── */

function changeBox(c, s, plan, mine) {
  const l = V.changeLine(c, { shoots: planShoots(plan, state.shoots), plan, today: state.today, pc: state.pc });
  const can = canCancel(c, meId(), state.access);
  return '<div class="sh-box' + (l.status.cls === "refused" ? " refused" : l.status.cls === "ok" ? " ok" : "") + '" data-change="' + esc(c.id) + '">' +
    '<div class="t">' + esc(mine ? "Your change: " : "A change waiting: ") + T(l.title) + "</div>" +
    '<div class="s ' + esc(l.status.cls) + '">' + T(l.status.text) + "</div>" +
    (l.status.words ? '<div class="w">' + T(l.status.words) + "</div>" : "") +
    (l.asked || l.answered ? '<div class="w">' + esc([l.asked ? "Asked " + l.asked : "", l.answered ? "answered " + l.answered : ""].filter(Boolean).join(" · ")) + "</div>" : "") +
    (can.ok ? '<button type="button" class="sh-btn" data-act="cancel-change" data-change="' + esc(c.id) + '">Cancel this change</button>' : "") +
    "</div>";
}

function factsHtml(s, plan) {
  const today = state.today;
  const d = V.dayLine(s, plan, today);
  const m = followsMilestone(s) ? plan.milestones[s.anchor] : null;
  const rows = [];
  let day = "<b>" + esc(d.day) + "</b>" + (d.window ? " · " + esc(d.window) : "");
  if (d.late) day += '<div class="late">' + esc("Late - " + plural(lateDays(s, today), "day") + " past its grace") + "</div>";
  rows.push(["Day", day]);
  rows.push(["Follows", esc(anchorText(s, plan)) + (m && m.date ? " (" + esc(dayText(m.date, today) + (m.firm ? " · Firm" : " · estimate")) + ")" : "")]);
  rows.push(["Phase", esc((PHASE_LABEL[s.phase] || s.phase || "") + (s.series && s.n ? " · visit " + s.n : ""))]);
  if (s.status === "announced") {
    rows.push(["Heads-up", movedNotTold(s) ? esc("Sent for " + dayText(s.announcedFor, today) + " - the shoot moved since; the photographer hears of it on the next reminder")
      : esc("Sent" + (s.announcedFor ? " for " + dayText(s.announcedFor, today) : ""))]);
  } else if (isOpen(s) && plan.leadDays) {
    rows.push(["Heads-up", esc("Goes out " + plural(plan.leadDays, "day") + " before the shoot")]);
  }
  rows.push(["Photographer", T(plan.photographerName || "No photographer yet")]);
  const done = V.doneLine(s, today);
  if (done) rows.push([s.status === "done" ? "Done" : "Closed", T(done)]);
  return '<dl class="sh-facts">' + rows.map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
}

function actionsHtml(s, plan) {
  const parts = [];
  let why = "";
  if (editor()) {
    // only a change that holds this very shoot stops its Move… and Mark done… (the database's "pending" rule, §6.1 step
    // 10); a job-date change waiting shows as a chip and a box, and leaves both
    const pending = pendingTarget(state.changes, s);
    const act = shootActions(s, plan, state.access, { pending, files: (state.files[s.id] || {}).st || null });
    const shoots = planShoots(plan, state.shoots);
    const undo = V.undoFor(state.changes, s, meId(), state.access, new Date(), { shoots, plan });
    if (act.move.ok) parts.push('<button type="button" class="sh-btn primary" data-act="move" data-shoot="' + esc(s.id) + '">Move…</button>');
    if (act.done.ok) parts.push('<button type="button" class="sh-btn ok" data-act="done" data-shoot="' + esc(s.id) + '">Mark done…</button>');
    if (undo) parts.push('<button type="button" class="sh-btn warn" data-act="undo" data-shoot="' + esc(s.id) + '" data-change="' + esc(undo.id) + '" title="' +
      T(V.changeLine(undo, { shoots, plan, today: state.today }).title) + '">' + esc(V.undoLabel(undo, meId())) + "</button>");
    if (!act.move.ok && !pending) why = act.move.why;
  }
  // the task is read by the office roles and by the people it is assigned to (the plan's photographer gets the heads-up)
  const readsTask = !!(state.me && TASK_READERS.indexOf(state.me.role) !== -1) || (!!plan.photographerProfileId && plan.photographerProfileId === meId());
  if (s.taskId && editor() && readsTask) parts.push('<a class="sh-btn" href="my-tasks.html?task=' + esc(s.taskId) + '">Open its task in My Tasks</a>');
  return (parts.length ? '<div class="sh-acts">' + parts.join("") + "</div>" : "") + (why ? '<div class="sh-ro">' + esc(why) + "</div>" : "");
}

function briefHtml(s) {
  const sections = V.briefSections(s.brief);
  if (!sections.length) return "";
  return '<h3 class="sh-h3">Brief</h3><div class="sh-brief">' + sections.map((x) => {
    if (x.lines) {
      return "<h4>" + esc(x.title) + '</h4><ul class="sh-shots">' + x.lines.map((l) => "<li>" + (l.title ? "<b>" + T(l.title) + "</b>" : "") + (l.text ? T(l.text) : "") +
        (l.tags.length ? '<span class="tags">' + l.tags.map((t) => '<span class="sh-chip dim">' + esc(t) + "</span>").join("") + "</span>" : "") + "</li>").join("") + "</ul>";
    }
    if (x.items.length === 1 && ["purpose", "time", "sample", "drone"].indexOf(x.key) !== -1) return "<h4>" + esc(x.title) + "</h4><p>" + T(x.items[0]) + "</p>";
    return "<h4>" + esc(x.title) + '</h4><ul class="sh-list">' + x.items.map((i) => "<li>" + T(i) + "</li>").join("") + "</ul>";
  }).join("") + "</div>";
}

function historyHtml(s) {
  const lines = V.historyLines(s, state.today);
  if (!lines.length) return "";
  return '<h3 class="sh-h3">History <span class="sh-n">' + lines.length + '</span></h3><ol class="sh-hist">' + lines.map((l) =>
    "<li>" + (l.when ? '<div class="when">' + esc(l.when) + "</div>" : "") + "<div>" + esc(l.text) + (l.meta ? " " + T(l.meta) : "") + "</div>" +
    (l.reason ? '<div class="why">' + T(l.reason) + "</div>" : "") + "</li>").join("") + "</ol>";
}

function detailHtml(s, plan) {
  const me = meId();
  const chips = shootChips(s, plan, state.today, { pending: pendingFor(state.changes, s) });
  const open = V.shootChanges(state.changes, s).filter((c) => isOpenChange(c));
  const recent = V.recentMine(state.changes, s, me, new Date());
  // the files icon beside the status (SE §1.6), before the other chips; the job line names the town only when the place
  // block under it does not (its address line ends with the town: never said twice, as By job's header)
  const placed = townSaid(placeOf(plan));
  return '<div class="sh-dtop">' + chips.slice(0, 1).map(chipHtml).join("") + filesIconHtml(s) + chips.slice(1).map(chipHtml).join("") + "</div>" +
    '<h2 class="sh-dtitle" id="shDTitle" tabindex="-1">' + T(s.name) + "</h2>" +
    '<div class="sh-dplace"><button type="button" data-act="plan" data-plan="' + esc(plan.id) + '">' + T(plan.label) + "</button>" +
    (plan.city && !placed ? " · " + T(plan.city) : "") + (plan.status !== "active" ? " · " + esc(V.planFacts(plan).statusText) : "") + "</div>" +
    placeHtml(plan) +
    factsHtml(s, plan) +
    filesBlock(s) +
    open.map((c) => changeBox(c, s, plan, c.requestedBy === me)).join("") +
    actionsHtml(s, plan) +
    (recent.length ? '<h3 class="sh-h3">Your recent changes</h3>' + recent.map((c) => changeBox(c, s, plan, true)).join("") : "") +
    briefHtml(s) + historyHtml(s);
}

/** The Files section (P5b): nothing on a database without the photo files. */
function filesBlock(s) {
  if (state.p5 === false) return "";
  // a Mark done of this very shoot waiting for the office computer (the change Mark done… sent): its completion line says
  // so (completion.done_sent), never "mark the shoot done" beside it - v14, §13.1 "A Mark done waiting", §37; who was
  // told and how is an admin's line (photo_my_access), as on the Ready card - P5b review round 8, §41
  const p = pendingTarget(state.changes, s);
  const fs = state.files[s.id] || { st: undefined };
  return filesHtml(fs, { today: state.today, now: Date.now(), doneSent: !!(p && p.kind === "done"),
    admin: !!(state.access && state.access.admin), phone: phoneParts(s.id, fs.st) });
}

/* ── the phone's hand-in (OD §3.3; js/photo-send.js) ──────────────────── */

/** A status that needs this phone's hand-in module: a phone may add here, or a phone hand-in of the shoot is open (this
    phone's own device row is needed to tell it is this phone's). */
function needsPhone(st) {
  if (!st || typeof st !== "object") return false;
  if (st.can && st.can.add_from_phone) return true;
  return (Array.isArray(st.uploads) ? st.uploads : []).some((u) => u && u.source === "phone" && (u.state === "open" || u.state === "abandoned"));
}

/** The page's one phone hand-in module (made on first need; tests give its parts in state.phoneDeps). */
function phone() {
  if (state.phone) return state.phone;
  const first = () => String((state.me && state.me.name) || "").trim().split(/\s+/)[0] || "";
  state.phone = createPhoneSend(Object.assign({
    by: first,
    codes: () => { const v = state.phone && state.phone.view(); const f = v && v.shoot ? state.files[v.shoot] : null; return (f && f.st && f.st.mode_codes) || []; },
    today: state.today,
  }, state.phoneDeps || {}));
  state.phone.onChange(onPhoneChange);
  return state.phone;
}

/** What the Files section of shoot `id` draws of the phone's hand-in (shoots-files.js filesHtml o.phone). */
function phoneParts(id, st) {
  const ps = state.phone || (needsPhone(st) ? phone() : null);
  const pf = state.pf[id] || {};
  if (!ps) return { lines: pf.lines || [], planning: !!pf.planning };
  const v = ps.view();
  const mine = v.shoot === id && v.phase !== "idle";
  const viewer = ps.viewer();
  return {
    view: mine ? v : null,
    other: !mine && v.shoot !== null && PHONE_BUSY.indexOf(v.phase) !== -1,
    knows: ps.knows(id),
    viewer: { device_id: viewer.device_id, running_here: mine && viewer.running_here, phone_found: mine ? viewer.phone_found : 0 },
    // this page's own counts while it draws the hand-in's buttons (as phoneCounts and phoneButtons): the line's {done}
    // and its twin agree with the Hand in what's there they offer, else the status's (review round 4)
    sending: mine && (PHONE_BUSY.indexOf(v.phase) !== -1 || v.buttons.length) ? ps.sending() : null,
    planning: !!pf.planning,
    lines: pf.lines || [],
  };
}

/** The module's every change: the open shoot drawn again (at most every 150 ms while a file goes up); a new phase reads
    the shoot's status again (the hand-in opened, stopped, asked, sealed or cancelled). */
function onPhoneChange(v) {
  const was = state.phoneSeen;
  state.phoneSeen = { shoot: v.shoot, phase: v.phase };
  if (v.shoot && (!was || was.phase !== v.phase || was.shoot !== v.shoot)) readFiles(v.shoot, { quiet: true });
  if (state.phoneDraw) return;
  state.phoneDraw = setTimeout(() => {
    state.phoneDraw = null;
    if (state.sel && state.view !== "ready") renderDetail();
  }, 150);
}

/** The picker: one input of the page's own, outside the redrawn sheet (a redraw while the picker is open never loses the
    pick); photos and videos only, HEIC named (OD §3.3 step 2). */
function pickInput() {
  let n = $("shPick");
  if (n) return n;
  try {
    n = document.createElement("input");
    n.setAttribute("type", "file");
    n.setAttribute("id", "shPick");
    n.setAttribute("multiple", "");
    n.setAttribute("accept", PICK_ACCEPT);
    n.setAttribute("tabindex", "-1");
    n.setAttribute("aria-hidden", "true");
    n.className = "sh-pick";
    n.addEventListener("change", onPicked);
    document.body.appendChild(n);
  } catch (e) { return null; }
  return n;
}

/** [Add photos and videos] / [Pick the rest again] / [Pick them again]: the picker for this shoot. */
function pickStart(id, rest) {
  const n = pickInput();
  if (!n || !id) return;
  state.pick = { shoot: Number(id), rest: !!rest };
  try { n.value = ""; } catch (e) { /* */ }
  n.click();
}

function onPicked(ev) {
  const n = ev && ev.target;
  const want = state.pick;
  state.pick = null;
  const list = n && n.files ? [...n.files] : [];
  try { n.value = ""; } catch (e) { /* the same files may be picked again */ }
  if (want && list.length) pickFiles(want.shoot, list, want.rest);
}

/** The picked files planned (js/photo-send.js plan: the kinds, the names, a matching file hashed first) and sent. */
async function pickFiles(id, list, rest) {
  const sid = Number(id);
  const ps = phone();
  const pf = state.pf[sid] || (state.pf[sid] = { planning: false, lines: [] });
  if (pf.planning) return;
  pf.planning = true;
  pf.lines = [];
  if (state.sel === sid) renderDetail();
  let p = null;
  try { p = await ps.plan(sid, list, { rest: !!rest }); } catch (e) { p = null; }
  pf.planning = false;
  // the pick's own lines: a read that failed, or nothing of it to send (not media, the same files again) - its lines;
  // else the big-video line, first (the rest are the send's own, js/photo-send.js view)
  const sends = !!p && !p.error && ((p.send || []).length > 0 || (p.resume || []).length > 0 || !!p.rest);
  pf.lines = !p ? [] : sends ? p.lines.filter((l) => l.code === "big_phone") : p.lines;
  if (p && !p.error) {
    const v = await ps.start(p);
    // (the hand-in the pick began recorded nothing of its own and is cancelled again: nothing goes, so no big-video line)
    if (v && v.phase === "cancelled") pf.lines = pf.lines.filter((l) => l.code !== "big_phone");
  }
  if (state.sel === sid && state.view !== "ready") renderDetail();
  readFiles(sid, { quiet: true });
}

/** The phone hand-in's counts for the asks: {sent: the files already in OneDrive, total: the files of the hand-in} -
    this page's own while the page draws its buttons (its counts are newer than the status's beat, and the buttons
    were offered by them), else the status's open phone hand-in of the shoot (a reload, or another device's). */
function phoneCounts(sid) {
  const ps = state.phone;
  const v = ps ? ps.view() : null;
  const own = v && v.shoot === sid && (PHONE_BUSY.indexOf(v.phase) !== -1 || v.buttons.length) ? ps.sending() : null;
  if (own) return { sent: Number(own.sent) || 0, total: Number(own.total) || 0 };
  const st = (state.files[sid] || {}).st || {};
  const open = (Array.isArray(st.uploads) ? st.uploads : []).find((u) => u && u.source === "phone" && (u.state === "open" || u.state === "abandoned")) || null;
  if (!open) return { sent: 0, total: 0 };
  const total = open.files !== undefined && open.files !== null ? open.files : open.recorded_files;
  return { sent: Number(open.sent_files) || 0, total: Number(total) || 0 };
}

/** Whether the Files section of shoot `sid` still offers `code` (files_buttons) now - as filesHtml draws it. */
function phoneOffers(sid, code) {
  const fs = state.files[sid] || {};
  if (!fs.st) return false;
  const ph = phoneParts(sid, fs.st);
  const v = filesView(fs.st, { today: state.today, now: Date.now(), viewer: ph.viewer || {}, sending: ph.sending || null });
  return phoneButtons(fs.st, v, ph).indexOf(code) !== -1;
}

/** [Hand in what's there] / [Cancel it] (OD §3.3 step 8, review round 1; PF's and DCR Desktop 2's rule): each asks first
    in the page's own sheet, Keep it (copy.cancel_keep) focused, so Enter (or a stray tap beside the button) keeps the
    hand-in going - Cancel it always (copy.cancel_ask_phone), Hand in what's there while files are still unsent
    (copy.hand_in_ask_phone, {n} the files already in OneDrive - at least one: it is offered only then, review round 3);
    all of them in, it hands in at once. */
function phoneAsk(id, what) {
  const sid = Number(id);
  if (!sid || state.mv) return;
  const cancel = what === "cancel";
  const c = phoneCounts(sid);
  // (none in OneDrive yet: nothing to hand in - Hand in what's there is not offered then, and never asks "Hand in the 0
  // files…": the count rule has no _none twin for it; OD §3.3 step 8, review round 3)
  if (!cancel && c.sent < 1) return;
  if (!cancel && c.total <= c.sent) { phoneAct(sid, "hand_in"); return; }
  const s = shootOf(sid);
  const code = cancel ? "cancel_ask_phone" : "hand_in_ask_phone";
  const ask = cancel ? FW.copy.cancel_ask_phone : word("copy", "hand_in_ask_phone", { n: c.sent });
  const label = cancel ? FW.files_buttons.cancel_copy : FW.files_buttons.hand_in_there;
  openSheetOf(cancel ? "phone_cancel" : "phone_hand_in", { shootId: sid, opener: cancel ? "files-cancel" : "files-hand-in", label, title: label,
    keep: FW.copy.cancel_keep, cls: cancel ? "warn" : "ok",
    body: (s ? '<p class="mv-now"><b>' + T(s.name) + "</b></p>" : "") + '<p class="mv-now" data-ask="' + code + '">' + esc(ask) + "</p>",
    first: '#shMo .sh-mo-ft [data-act="mv-close"]' });
}

/** [Hand in what's there] / [Cancel it] / [Hand in without them]: this page's own hand-in of the shoot, or - after a
    reload, or another device's - the status's stopped phone hand-in of it. */
async function phoneAct(id, what) {
  const sid = Number(id);
  const ps = phone();
  const st = (state.files[sid] || {}).st || {};
  const open = (Array.isArray(st.uploads) ? st.uploads : []).find((u) => u && (u.state === "open" || u.state === "abandoned")) || null;
  const o = { shootId: sid, uploadId: open ? open.id : null, deviceId: open ? open.pc_id : null };
  state.pf[sid] = { planning: false, lines: [] };
  try {
    if (what === "without") await ps.handInWithout();
    else if (what === "cancel") await ps.cancel(o);
    else await ps.handIn(o);
  } catch (e) { /* the module says what stopped it */ }
  if (state.sel === sid && state.view !== "ready") renderDetail();
  readFiles(sid, { quiet: true });
}

function lock(on) {
  try { document.documentElement.classList.toggle("sh-locked", !!on); } catch (e) { /* */ }
}

function renderDetail() {
  const box = $("shDetail");
  const sc = $("shDScroll");
  if (!box || !sc) return;
  const back = $("shBack");
  const backText = state.view === "ready" ? "‹ " + FW.ready.view : "‹ All shoots";
  if (back && back.textContent !== backText) back.textContent = backText;
  if (state.view === "ready") { renderCard(box, sc); return; }
  const s = state.sel ? shootOf(state.sel) : null;
  const plan = s ? planOf(s.planId) : null;
  box.classList.toggle("open", !!(s && plan) && (state.open || wide()));
  if (!s || !plan) {
    sc.innerHTML = '<div class="sh-ph">' + esc(state.sel && state.loaded ? V.GONE_TEXT : V.PLACEHOLDER) + "</div>";
    state.lastDetail = null;
    lock(state.open && !wide() && !!state.sel);
    return;
  }
  const keep = state.lastDetail === s.id ? sc.scrollTop : 0;
  if (state.lastDetail === s.id) keepFocus("shDScroll", () => { sc.innerHTML = detailHtml(s, plan); });
  else sc.innerHTML = detailHtml(s, plan);
  sc.scrollTop = keep;
  state.lastDetail = s.id;
  lock((state.open && !wide()) || !!state.mv);
}

/** The Ready card open (the detail column; a phone: full screen). */
function renderCard(box, sc) {
  const r = state.rd;
  const it = r.sel ? readyItem(r.sel) : null;
  box.classList.toggle("open", !!it && (r.open || wide()));
  if (!it) {
    sc.innerHTML = '<div class="sh-ph">' + esc(r.sel && readyLoaded() ? FW.hint.no_item : FW.ready.view) + "</div>";
    state.lastDetail = null;
    lock(r.open && !wide() && !!r.sel);
    return;
  }
  const list = r.lists[it.__tab] || r.lists.open;
  const key = "r" + it.id;
  const keep = state.lastDetail === key ? sc.scrollTop : 0;
  const draw = () => { sc.innerHTML = readyCardHtml(it, list.me, { today: state.today, busy: r.busy }); };
  if (state.lastDetail === key) keepFocus("shDScroll", draw); else draw();
  sc.scrollTop = keep;
  state.lastDetail = key;
  lock((r.open && !wide()) || !!state.mv);
}

function render() {
  state.drawn = true;
  renderHead();
  renderList();
  renderDetail();
  wantPictures();
}

/* ── the address and opening a shoot ──────────────────────────────────── */

function setUrl(push) {
  try {
    // a link's card still waiting for its read keeps its address (a reload opens it)
    const url = V.linkFor({ shoot: state.sel, plan: state.view === "job" ? state.planFocus : null, view: state.view, month: state.month,
      ready: state.view === "ready" ? state.rd.sel || state.rd.want : null });
    if (push && W.history && W.history.pushState) W.history.pushState({ sh: state.sel || 0, rd: state.view === "ready" ? state.rd.sel || 0 : 0 }, "", url);
    else if (W.history && W.history.replaceState) W.history.replaceState(W.history.state, "", url);
  } catch (e) { /* not important */ }
}

function openShoot(id, o) {
  const s = shootOf(id);
  if (!s) return;
  const push = !!(o && o.push) && !wide() && !state.open;
  state.sel = s.id;
  state.open = true;
  state.lastDetail = null;
  if (push) state.pushed = true;
  setUrl(push);
  render();
  try {
    const t = $("shDTitle");
    if (t && (!wide() || (o && o.focus))) t.focus();
  } catch (e) { /* */ }
  readFiles(s.id);
}

function closeShoot(fromHistory) {
  if (!fromHistory && state.pushed && W.history && W.history.back) {
    state.pushed = false;
    W.history.back();                       // popstate closes it (the phone's Back does the same)
    return;
  }
  const was = state.sel;
  state.pushed = false;
  state.open = false;
  state.sel = null;
  setUrl(false);
  render();
  try {
    const row = document.querySelector('[data-shoot="' + was + '"]');
    if (row && row.focus) row.focus();
  } catch (e) { /* */ }
}

function setView(v) {
  if (V.VIEW_KEYS.indexOf(v) === -1) return;
  if (v === "ready" && !readyMay()) return;
  const was = state.view;
  state.view = v;
  state.lastDetail = null;
  if (v !== "ready") state.rd.want = null;           // left before its card could be read: not opened later
  if (v === "ready" && was !== "ready") loadReady({ quiet: true });
  if (v !== "job") state.planFocus = null;
  if (v === "month" && !state.month) state.month = state.today.slice(0, 7);
  setUrl(false);
  render();
}

/** Follow the address once the mirror is read: a shoot (its own id, or a My Tasks task's), a plan, the view. */
async function follow(link) {
  if (link.ready || link.view === "ready") {
    const r = state.rd;
    // a database without the Ready list (read, no error): P3 as it was
    if (!readyMay()) { if (link.ready) state.msg = FW.hint.no_item; return; }
    state.view = "ready";
    if (link.ready) {
      // the card opens from the read that has both lists (wantedCard); a read that failed (a phone with poor signal)
      // says so with Try again and opens the card then - never "isn't on the list any more" for a list not read
      r.want = link.ready;
      if (r.readable) await loadReady({ quiet: true, both: true });
    }
    setUrl(false);
    return;
  }
  if (link.view) state.view = link.view;
  if (link.month) state.month = link.month;
  // Home's card counted only my jobs (map/shoots.js homeBadge): the page opens counting the same ones
  if (link.mine && state.plans.some((p) => p.photographerProfileId && p.photographerProfileId === meId())) state.mine = true;
  let id = link.shoot;
  if (!id && link.task) {
    let hit = null;
    try { hit = await repo.shootForTask(link.task); } catch (e) { hit = null; }
    id = hit ? hit.id : null;
    if (!id) { state.msg = V.TASK_GONE_TEXT; return; }
  }
  if (id) {
    const s = shootOf(id);
    if (!s) { state.msg = V.GONE_TEXT; return; }
    const plan = planOf(s.planId);
    if (plan && plan.status === "archived") state.archived = true;
    if (state.view === "month" && isDay(s.plannedDate)) state.month = s.plannedDate.slice(0, 7);
    state.sel = s.id;
    state.open = true;
    state.lastDetail = null;
    setUrl(false);
    readFiles(s.id);
    return;
  }
  if (link.plan) {
    const plan = planOf(link.plan);
    if (!plan) { state.msg = V.PLAN_GONE_TEXT; return; }
    state.view = "job";
    state.planFocus = plan.id;
    if (plan.status === "archived") state.archived = true;
  }
}

/* ── the sheets: Move…, Mark done…, Undo… ─────────────────────────────── */

function sheetOpen(on) {
  try { document.documentElement.classList.toggle("sh-sheet", !!on); } catch (e) { /* */ }
  if (on) holdToasts();
}

/** A toast still showing as a sheet opens (the answer to the change just made) would sit over the sheet's list: it is
    taken off and said again when the sheet closes, with what the office computer answers meanwhile (state.held). */
function holdToasts() {
  try {
    document.querySelectorAll("#dcr2Toasts .dcr2-toast").forEach((t) => {
      if (!t.classList.contains("out") && t.textContent) {
        state.held.push({ text: t.textContent, kind: t.classList.contains("error") ? "error" : t.classList.contains("ok") ? "ok" : "info" });
      }
      t.remove();
    });
  } catch (e) { /* */ }
}

function sheetShell(title, body, foot, closeLabel) {
  return '<div class="sh-mo" id="shMo" role="dialog" aria-modal="true" aria-labelledby="mvTitle"><div class="sh-mo-card">' +
    '<div class="sh-mo-hd"><h3 id="mvTitle">' + title + '</h3><button type="button" class="sh-x" data-act="mv-close" aria-label="' + esc(closeLabel) + '">×</button></div>' +
    '<div class="sh-mo-body">' + body + "</div>" +
    '<div class="sh-mo-ft"><span class="sh-mo-msg" id="mvMsg" role="alert"></span>' + foot + "</div></div></div>";
}

function mvShoot() { return state.mv ? shootOf(state.mv.shootId) : null; }
function mvPlan() { return state.mv ? planOf(state.mv.planId) : null; }

function setMsg(text, kind) {
  if (!state.mv) return;
  state.mv.msg = text || "";
  state.mv.msgKind = kind || "";
  const n = $("mvMsg");
  if (n) { n.textContent = state.mv.msg; n.className = "sh-mo-msg" + (state.mv.msgKind ? " " + state.mv.msgKind : ""); }
  liftToasts();
}

function nowInner(s, plan) {
  return T(plan.label) + " · now <b>" + esc(isDay(s.plannedDate) ? dayText(s.plannedDate, state.today) : "no date yet") + "</b>" +
    (followsMilestone(s) ? " · " + esc(anchorText(s, plan)) : "");
}
function nowLine(s, plan) {
  return '<p class="mv-now" id="mvNow">' + nowInner(s, plan) + "</p>";
}
/** The shoot's day as the sheet says it, drawn again from the last read (a PT409 or a watch read moved it). */
function drawNow() {
  const n = $("mvNow");
  const s = mvShoot(), plan = mvPlan();
  if (n && s && plan) n.innerHTML = nowInner(s, plan);
}

/** A sheet is open and the plan was read again: when its rev moved on (or `force`: a PT409, a preview that no longer
    matched at Apply), the sheet is drawn from the new read - the shoot's day now, the job dates, the Firm box (the
    current flag, unless the admin ticked it himself) - with the new rev as its base, and the preview is asked again, so
    the list beside Apply is always the one that will be sent (owner decision 2). A watch read says "changed" only when
    the new preview differs from the one shown; a Mark done sheet keeps its base (the database's own check says so). */
function sheetReread(force) {
  const mv = state.mv;
  if (!mv || (mv.busy && !force) || READY_SHEETS.indexOf(mv.type) !== -1) return;
  const s = mvShoot(), plan = mvPlan();
  if (!s || !plan) { setMsg(V.GONE_TEXT, "error"); mv.words = null; fillApply(); return; }
  if (!force && plan.rev === mv.baseRev) return;
  drawNow();
  if (mv.type === "done" && !force) return;
  mv.baseRev = plan.rev;
  if (mv.type === "move") {
    if (!mv.firmTouched) mv.firm = !!(plan.milestones[mv.milestone] && plan.milestones[mv.milestone].firm);
    fillMove();
  }
  if (force) setMsg(mv.type === "done" ? V.CHANGED_DONE_TEXT : V.CHANGED_TEXT, "info");
  if (mv.type === "done") { fillApply(); return; }
  runPreview({ shown: force ? null : V.previewSig(mv.pv) });
}

/** Move… (owner decision 2): the three choices with "Only this shoot" preselected, the day, the preview. */
function openMove(id) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  if (!s || !plan) return;
  const ms = followsMilestone(s) ? s.anchor : MILESTONES[0];
  state.mv = { type: "move", shootId: s.id, planId: plan.id, baseRev: plan.rev, kind: "move_one", day: null, milestone: ms, msDay: null,
    firm: !!(plan.milestones[ms] && plan.milestones[ms].firm), firmTouched: false, start: null, seq: 0, timer: null, pv: null, words: null, pvError: "",
    pending: false, busy: false, msg: "", msgKind: "", opener: "move", reveal: false };
  const body = nowLine(s, plan) +
    '<fieldset class="mv-fs" id="mvChoices"></fieldset><div id="mvMs"></div><div id="mvDay"></div>' +
    '<div class="mv-note" id="mvNote" role="status"></div><div id="mvFirmRow"></div>' +
    '<label class="mv-lab" for="mvReason">Why (optional)</label>' +
    '<input class="mv-reason" id="mvReason" maxlength="' + REASON_MAX + '" autocomplete="off" placeholder="e.g. Rain in the forecast" />' +
    '<div class="mv-pv wait" id="mvPreview" aria-live="polite"></div>';
  // the preview's count beside Apply (a phone shows the list below the fold: a tap brings it up, and it comes up by itself
  // whenever a new preview arrives)
  const foot = '<button type="button" class="mv-sum" id="mvSum" data-act="mv-see" hidden></button>' +
    '<button type="button" class="sh-btn" data-act="mv-close">Cancel</button>' +
    '<button type="button" class="sh-btn primary" id="mvApply" data-act="mv-apply" disabled>Apply</button>';
  state.mv.closeLabel = "Close without moving";
  $("shSheet").innerHTML = sheetShell("Move " + T(s.name), body, foot, state.mv.closeLabel);
  fillMove();
  lock(true);
  sheetOpen(true);
  sheetPushed();
  try { const first = document.querySelector('#mvChoices input[value="move_one"]'); if (first && first.focus) first.focus(); } catch (e) { /* */ }
}

/** Redraw a part of the sheet and keep the keyboard where it was (the same choice or day, found by its value). */
function keepFocus(boxId, draw) {
  let key = null;
  try {
    const a = document.activeElement;
    const box = $(boxId);
    if (a && box && box.contains(a)) {
      key = { day: a.getAttribute("data-day"), id: a.getAttribute("id"), value: a.getAttribute("value"), act: a.getAttribute("data-act"), change: a.getAttribute("data-change"),
        shoot: a.getAttribute("data-shoot"), cls: String(a.className || "").split(" ")[0] };
    }
  } catch (e) { key = null; }
  draw();
  if (!key) return;
  try {
    const box = $(boxId);
    if (!box) return;
    // a list row (the Agenda, By job) or a Month entry: the same shoot, in the same kind of element
    const shootHit = () => (/^[0-9]+$/.test(String(key.shoot)) ? (key.cls && /^[a-z][a-z0-9-]*$/.test(key.cls) && box.querySelector("." + key.cls + '[data-shoot="' + key.shoot + '"]')) ||
      box.querySelector('[data-shoot="' + key.shoot + '"]') : null);
    const hit = (key.day && box.querySelector('[data-day="' + key.day + '"]')) || (key.id && $(key.id)) ||
      (key.change && key.act && box.querySelector('[data-act="' + key.act + '"][data-change="' + key.change + '"]')) ||
      (key.value && key.act && box.querySelector('[data-act="' + key.act + '"][value="' + key.value + '"]')) || (key.act && box.querySelector('[data-act="' + key.act + '"]')) ||
      (key.shoot && !key.act && shootHit());
    if (hit && hit.focus && document.activeElement !== hit) hit.focus();
  } catch (e) { /* */ }
}

const CHOICE_HINT = {
  move_one: "The other shoots stay on their days.",
  move_later: "The later shoots move by the same number of days (on to the next shoot day).",
  milestone: "Pick which job date moved, and its new day: the shoots that follow it move with it.",
};

function fillChoices(s, plan) {
  const mv = state.mv;
  $("mvChoices").innerHTML = '<legend>What moved?</legend>' + moveChoices(s, plan).map((c) =>
    '<label class="mv-choice' + (mv.kind === c.kind ? " on" : "") + (c.ok ? "" : " off") + '"><input type="radio" name="mvKind" value="' + esc(c.kind) + '"' +
    (mv.kind === c.kind ? " checked" : "") + (c.ok ? "" : " disabled") + ' data-act="mv-kind" /><span><b>' + esc(c.label) + "</b><small>" +
    esc(c.ok ? CHOICE_HINT[c.kind] : c.why) + "</small></span></label>").join("");
}

function fillMilestones(s, plan) {
  const mv = state.mv;
  const box = $("mvMs");
  if (mv.kind !== "milestone") { box.innerHTML = ""; return; }
  const c = moveChoices(s, plan).find((x) => x.kind === "milestone");
  box.innerHTML = '<fieldset class="mv-fs"><legend>Which job date</legend><div class="mv-ms">' + c.milestones.map((m) =>
    '<label class="mv-choice' + (mv.milestone === m.key ? " on" : "") + '"><input type="radio" name="mvMs" value="' + esc(m.key) + '"' +
    (mv.milestone === m.key ? " checked" : "") + ' data-act="mv-ms" /><span><b>' + esc(m.label) + "</b><small>" +
    esc((m.date ? dayText(m.date, state.today) : "No date yet") + (m.firm ? " · Firm" : m.date ? " · estimate" : "") + (m.followed ? " · this shoot follows it" : "")) +
    "</small></span></label>").join("") + "</div></fieldset>";
}

function pickedDay() { const mv = state.mv; return mv.kind === "milestone" ? mv.msDay : mv.day; }

function fillDay(s, plan) {
  const mv = state.mv;
  const ms = mv.kind === "milestone" ? plan.milestones[mv.milestone] : null;
  const current = mv.kind === "milestone" ? (ms && ms.date) || null : s.plannedDate;
  const picked = pickedDay();
  const b = V.bounds(mv.kind, state.today);
  const days = V.dayStrip(picked || current || state.today, { today: state.today, kind: mv.kind, shootDays: plan.shootDays, current, picked, start: mv.start });
  const label = mv.kind === "milestone" ? "New day for " + MILESTONE_LABEL[mv.milestone] : "New day";
  $("mvDay").innerHTML = '<span class="mv-lab" id="mvDayLab">' + esc(label) + "</span>" +
    '<div class="mv-strip" role="group" aria-labelledby="mvDayLab"><button type="button" class="mv-nav" data-act="strip-prev" aria-label="Earlier days">‹</button>' +
    '<div class="mv-days">' + days.map((d) => '<button type="button" class="mv-d' + (d.shootDay ? "" : " off") + (d.isToday ? " today" : "") + (d.current ? " cur" : "") +
      '" data-act="pick" data-day="' + esc(d.day) + '" aria-pressed="' + (d.picked ? "true" : "false") + '" aria-label="' +
      esc(dayText(d.day, state.today) + (d.shootDay ? "" : " - not a shoot day") + (d.current ? " - its day now" : "")) + '">' +
      '<span class="wd">' + esc(d.wd) + '</span><span class="n">' + esc(d.date) + '</span><span class="m">' + esc(d.mon) + "</span></button>").join("") + "</div>" +
    '<button type="button" class="mv-nav" data-act="strip-next" aria-label="Later days">›</button></div>' +
    '<div class="mv-other"><label for="mvDate">Another day</label><input type="date" id="mvDate" data-act="mv-date" min="' + esc(b.min) + '" max="' + esc(b.max) + '" value="' +
    esc(picked || "") + '" /></div>';
}

function fillNote(s, plan) {
  const mv = state.mv;
  const day = pickedDay();
  let note = "";
  const b = V.bounds(mv.kind, state.today);
  if (day && !V.inBounds(mv.kind, day, state.today)) note = "Pick a day from " + dayText(b.min, state.today) + " to " + dayText(b.max, state.today) + ".";
  else if (mv.kind === "milestone" && V.needsOffice(plan, mv.milestone, state.access)) note = V.officeLine(mv.milestone);
  else if (day) note = V.nonShootNote(mv.kind, day, plan);
  $("mvNote").textContent = note;
}

function fillFirm(plan) {
  const mv = state.mv;
  const row = $("mvFirmRow");
  if (mv.kind !== "milestone" || !(state.access && state.access.admin)) { row.innerHTML = ""; return; }
  row.innerHTML = '<label class="mv-firm"><input type="checkbox" id="mvFirm" data-act="mv-firm"' + (mv.firm ? " checked" : "") + " /> " +
    esc("Firm - the office's date (a photographer's move of it then goes to the office)") + "</label>";
}

function fillMove() {
  const mv = state.mv;
  const s = mvShoot();
  const plan = mvPlan();
  if (!mv || mv.type !== "move") return;
  if (!s || !plan) { setMsg(V.GONE_TEXT, "error"); fillApply(); return; }
  drawNow();
  keepFocus("mvChoices", () => fillChoices(s, plan));
  keepFocus("mvMs", () => fillMilestones(s, plan));
  keepFocus("mvDay", () => fillDay(s, plan));
  fillNote(s, plan);
  keepFocus("mvFirmRow", () => fillFirm(plan));
  fillPreview();
}

/** {kind, args} for what the sheet holds now (null while a piece is missing); withReason: the typed reason too. */
function argsNow(withReason) {
  const mv = state.mv;
  const s = mvShoot();
  if (!mv || !s) return null;
  const reasonBox = $("mvReason");
  const reason = withReason && reasonBox ? reasonBox.value : "";
  if (mv.type === "done") return moveArgs({ kind: "done", shoot: s.key, note: $("dnNote") ? $("dnNote").value : "" });
  if (mv.type === "undo") return moveArgs({ kind: "undo", change: mv.change });
  if (mv.kind === "milestone") {
    if (!V.inBounds("milestone", mv.msDay, state.today)) return null;
    const pick = { kind: "milestone", milestone: mv.milestone, date: mv.msDay, reason };
    // an admin's Firm is sent only once he ticked or unticked it himself: otherwise the database takes the job date's
    // CURRENT flag at the request (§8.1), so an office decision made while the sheet was open is never turned back
    if (state.access && state.access.admin && mv.firmTouched) pick.firm = !!mv.firm;
    return moveArgs(pick);
  }
  if (!V.inBounds(mv.kind, mv.day, state.today)) return null;
  return moveArgs({ kind: mv.kind, shoot: s.key, to: mv.day, reason });
}

function schedulePreview() {
  const mv = state.mv;
  if (!mv) return;
  clearTimeout(mv.timer);
  mv.seq += 1;                           // an answer still on its way is for an older pick
  mv.pending = !!argsNow(false);
  fillPreview();
  mv.timer = setTimeout(runPreview, 300);
}

/** Ask photo_change_preview for what the sheet holds now. o.shown: the signature of the preview the sheet showed before a
    watch read (sheetReread): when the new one differs, the sheet says "changed". */
async function runPreview(o) {
  const mv = state.mv;
  if (!mv) return;
  clearTimeout(mv.timer);
  const want = argsNow(false);
  const seq = ++mv.seq;
  if (!want) { mv.pv = null; mv.words = null; mv.pvError = ""; mv.pending = false; fillPreview(); return; }
  mv.pending = true;
  fillPreview();
  const plan = mvPlan();
  try {
    const pv = await repo.preview(mv.planId, want.kind, want.args);
    if (state.mv !== mv || seq !== mv.seq) return;
    setPreview(mv, pv, plan);
    if (o && o.shown && V.previewSig(pv) !== o.shown) setMsg(V.CHANGED_TEXT, "info");
  } catch (e) {
    if (state.mv !== mv || seq !== mv.seq) return;
    mv.pv = null;
    mv.words = null;
    mv.pvError = e && e.retryable ? "No connection - the preview could not be made." : V.requestProblem(e, { milestone: want.args.milestone });
  }
  mv.pending = false;
  fillPreview();
}

/** The preview the sheet shows from now on (and brings into view when it arrives: a phone has it below the fold). */
function setPreview(mv, pv, plan) {
  const p = mvPlan() || plan;
  mv.pv = pv;
  mv.words = previewWords(pv, { plan: p, shoots: planShoots(p, state.shoots), today: (pv && pv.today) || state.today });
  mv.pvError = "";
  mv.reveal = mv.type === "move";
}

function stayWhy(st) {
  return st.text.indexOf(st.name + ": ") === 0 ? st.text.slice(st.name.length + 2) : st.text;
}

function previewHtml(mv) {
  const w = mv.words;
  if (mv.pvError) return '<div class="no">' + esc(mv.pvError) + '</div><button type="button" class="sh-btn" data-act="mv-repreview">Try again</button>';
  if (!w) {
    if (mv.pending) return "Checking what moves…";
    if (mv.type === "move") return esc(mv.kind === "milestone" ? "Pick the job date's new day to see every shoot that moves." : "Pick the new day to see every shoot that moves.");
    return "";
  }
  if (w.refused) return '<div class="no">' + esc(w.refused.text) + "</div>";
  const out = [];
  const nothing = !w.moved.length && !w.passed.length;
  const msMove = mv.type === "move" && mv.kind === "milestone";
  out.push('<div class="sum">' + esc(msMove && nothing ? "No shoot moves - only the job date changes" : w.summary) +
    (mv.pending ? " · checking again…" : "") + "</div>");
  // the job date's own move first ("Framing start: Thu Nov 19 → Mon Nov 23"), with weekday dates like the shoots below
  if (msMove) {
    const line = V.milestoneMove(mvPlan(), mv.milestone, (mv.pv && mv.pv.args && isDay(mv.pv.args.date) && mv.pv.args.date) || mv.msDay, state.today);
    if (line) out.push('<p class="ms-move"><b>' + esc(line.split(": ")[0]) + '</b> <span class="from-to">' + esc(line.slice(line.indexOf(": ") + 2)) + "</span></p>");
  }
  if (w.office) out.push('<div class="office">' + esc(V.officeLine(mv.kind === "milestone" ? mv.milestone : (mvShoot() || {}).anchor)) + "</div>");
  if (w.done) out.push("<p>" + T(w.done.text) + "</p>");
  if (w.moved.length) {
    out.push("<h4>" + esc((mv.type === "undo" ? "Goes back" : "Will move") + " (" + w.moved.length + ")") + "</h4><ul>" + w.moved.map((m) => "<li><b>" + T(m.name) +
      '</b> <span class="from-to">' + esc(m.fromText + " → " + m.toText) + "</span>" + m.notes.map((n) => '<span class="nt">' + esc(n.text) + "</span>").join("") + "</li>").join("") + "</ul>");
  }
  if (w.stays.length) {
    out.push("<h4>" + esc("Stays (" + w.stays.length + ")") + "</h4><ul>" + w.stays.map((st) => "<li><b>" + T(st.name) + '</b> <span class="why">' + T(stayWhy(st)) + "</span></li>").join("") + "</ul>");
  }
  if (w.passed.length) {
    out.push("<h4>" + esc("Will be skipped (" + w.passed.length + ")") + "</h4><ul>" + w.passed.map((p) => "<li>" + T(p.text) + "</li>").join("") + "</ul>");
  }
  if (w.replan.length) out.push("<h4>Re-planned</h4><ul>" + w.replan.map((r) => "<li>" + T(r.text) + "</li>").join("") + "</ul>");
  return out.join("");
}

function fillApply() {
  const mv = state.mv;
  const b = $("mvApply");
  if (!mv || !b) return;
  if (READY_SHEETS.indexOf(mv.type) !== -1) {
    b.disabled = !!mv.busy;
    b.textContent = mv.busy ? "Sending…" : mv.label;
    // closing never stops an act on its way: while it is, Cancel / Keep it and the × say so, as Move… and Mark done… do
    // (P5b review round 12 - "Cancel" closed the sheet and the card was posted after it with no word); its answer is
    // then readyAct's toast, or the card moving on the list
    document.querySelectorAll('#shMo .sh-mo-ft [data-act="mv-close"]').forEach((c) => { c.textContent = mv.busy ? V.CLOSE_SENDING : mv.keep || "Cancel"; });
    const rx = document.querySelector('#shMo .sh-x[data-act="mv-close"]');
    if (rx) rx.setAttribute("aria-label", mv.busy ? "Close - it is still being sent" : mv.closeLabel || "Close");
    liftToasts();
    return;
  }
  const ok = mv.type === "done" ? !!mvShoot() : !!(mv.words && mv.words.ok && !mv.pending && !mv.pvError && argsNow(false));
  b.disabled = !ok || mv.busy;
  const label = mv.type === "done" ? "Mark done" : mv.type === "undo" ? "Undo" : V.applyLabel(mv.words);
  b.textContent = mv.busy ? "Sending…" : label;
  // while a change is on its way, closing the sheet does not stop it - the buttons say so
  const closeWords = mv.type === "undo" ? "Keep it" : "Cancel";
  document.querySelectorAll('#shMo .sh-mo-ft [data-act="mv-close"]').forEach((c) => { c.textContent = mv.busy ? V.CLOSE_SENDING : closeWords; });
  const x = document.querySelector('#shMo .sh-x[data-act="mv-close"]');
  if (x) x.setAttribute("aria-label", mv.busy ? "Close - the change is still being sent" : mv.closeLabel || "Close");
  const sum = $("mvSum");
  if (sum) {
    const w = mv.words;
    const t = mv.type === "move" && w && w.ok && !mv.pvError ? w.summary + " · see the list" : "";
    sum.hidden = !t;
    if (sum.textContent !== t) sum.textContent = t;
  }
  liftToasts();
}

function fillPreview() {
  const mv = state.mv;
  const n = $("mvPreview");
  if (!mv || !n) return;
  n.innerHTML = previewHtml(mv);
  n.className = "mv-pv" + (mv.pending || !mv.words ? " wait" : "");
  fillApply();
  // a new preview: brought into view (on a phone the choices, the days and Why fill the screen above it)
  if (mv.reveal && mv.words && !mv.pending) {
    mv.reveal = false;
    revealPreview();
  }
}

function revealPreview() {
  try { const n = $("mvPreview"); if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" }); } catch (e) { /* */ }
}

/** The toasts stand above the open sheet's buttons and its message, however tall they are (a phone: the footer grows
    with a refusal or "changed"), never over them. */
function liftToasts() {
  try {
    const ft = document.querySelector("#shMo .sh-mo-ft");
    const h = ft && ft.getBoundingClientRect ? Math.ceil(ft.getBoundingClientRect().height || 0) : 0;
    if (h > 0 && document.documentElement.style && document.documentElement.style.setProperty) document.documentElement.style.setProperty("--sh-foot", h + "px");
  } catch (e) { /* */ }
}

/** Mark done… : an optional note; the sheet is the confirm. */
function openDone(id) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  if (!s || !plan) return;
  state.mv = { type: "done", shootId: s.id, planId: plan.id, baseRev: plan.rev, busy: false, msg: "", msgKind: "", seq: 0, opener: "done" };
  const ahead = isDay(s.plannedDate) && s.plannedDate > state.today;
  // P5b (§13.7): a skipped or missed shoot whose files were handed in is brought back (bring_back_sheet); an open one
  // says when marketing hears of it once its files' status is known (phone_done_hint)
  const st = (state.files[s.id] || {}).st || null;
  const closed = s.status === "skipped" || s.status === "missed";
  const tail = closed ? word("completion", "bring_back_sheet", { skipped_or_missed: s.status })
    : "The office computer marks it done and closes its task on My Tasks. A shoot marked done is not undone here.";
  const body = nowLine(s, plan) +
    (ahead && !closed ? '<div class="mv-note">' + esc("Its day (" + dayText(s.plannedDate, state.today) + ") is still ahead - mark it done only if it was shot.") + "</div>" : "") +
    '<label class="mv-lab" for="dnNote">A note (optional)</label>' +
    '<textarea class="mv-text" id="dnNote" maxlength="' + NOTE_MAX + '" rows="3" placeholder="e.g. All shots taken, files on their way"></textarea>' +
    '<p class="mv-now" style="margin-top:10px">' + esc(tail) + "</p>" +
    (st && !closed ? '<p class="mv-now" data-hint="phone_done_hint">' + esc(FW.completion.phone_done_hint) + "</p>" : "");
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">Cancel</button>' +
    '<button type="button" class="sh-btn ok" id="mvApply" data-act="mv-apply">Mark done</button>';
  state.mv.closeLabel = "Close without marking it done";
  $("shSheet").innerHTML = sheetShell("Mark " + T(s.name) + " done", body, foot, state.mv.closeLabel);
  fillApply();
  lock(true);
  sheetOpen(true);
  sheetPushed();
  try { const t = $("dnNote"); if (t && t.focus) t.focus(); } catch (e) { /* */ }
}

/** Undo… : my last applied change of this shoot (an admin: anyone's), with the preview of setting it back. */
function openUndo(id, changeId) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  const c = state.changes.find((x) => x.id === Number(changeId));
  if (!s || !plan || !c) return;
  const line = V.changeLine(c, { shoots: planShoots(plan, state.shoots), plan, today: state.today });
  state.mv = { type: "undo", shootId: s.id, planId: plan.id, baseRev: plan.rev, change: c.id, busy: false, msg: "", msgKind: "", seq: 0, pv: null, words: null,
    pvError: "", pending: true, timer: null, opener: "undo" };
  const body = '<p class="mv-now"><b>' + T(line.title) + "</b>" + (line.when ? " · " + esc(line.when) : "") + "</p>" +
    '<div class="mv-pv wait" id="mvPreview" aria-live="polite"></div>';
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">Keep it</button>' +
    '<button type="button" class="sh-btn warn" id="mvApply" data-act="mv-apply" disabled>Undo</button>';
  state.mv.closeLabel = "Close without undoing";
  $("shSheet").innerHTML = sheetShell("Undo this change?", body, foot, state.mv.closeLabel);
  fillPreview();
  lock(true);
  sheetOpen(true);
  sheetPushed();
  runPreview();
}

/** A sheet opened on a phone has its own history entry: the phone's Back closes the sheet and leaves the shoot (and the
    page) where they were. */
function sheetPushed() {
  const mv = state.mv;
  if (!mv || wide()) return;
  try {
    if (W.history && W.history.pushState) { W.history.pushState({ sh: state.sel || 0, sheet: 1 }, ""); mv.pushed = true; }
  } catch (e) { /* not important */ }
}

/** Close the sheet. The keyboard goes back to the button that opened it (Move…, Mark done…, Undo…) while it is still
    there, else to the shoot's title (a change sent: the shoot is drawn again without that button). A sheet with its own
    history entry takes it off (fromHistory: the phone's Back did). */
function closeSheet(fromHistory) {
  const mv = state.mv;
  if (mv) clearTimeout(mv.timer);
  state.mv = null;
  if ($("shSheet")) $("shSheet").innerHTML = "";
  lock((state.view === "ready" ? state.rd.open : state.open) && !wide());
  sheetOpen(false);
  if (mv && mv.pushed && !fromHistory) {
    state.skipPop += 1;                         // onPop: that entry going is not a Back
    try { W.history.back(); } catch (e) { state.skipPop -= 1; }
  }
  try {
    const back = mv && mv.opener ? document.querySelector('#shDScroll [data-act="' + mv.opener + '"]') : null;
    const t = back || $("shDTitle");
    if (t && t.focus) t.focus();
  } catch (e) { /* */ }
  // what the office computer answered while the sheet was open
  const held = state.held.splice(0);
  held.forEach(say);
}

/** The controls of the open sheet the keyboard reaches, in order (a radio group is one stop: its ticked choice). */
function sheetStops() {
  const mo = $("shMo");
  if (!mo) return [];
  return Array.prototype.filter.call(mo.querySelectorAll("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])"), (n) =>
    !n.disabled && n.getClientRects().length && !(n.type === "radio" && !n.checked && mo.querySelector('input[type=radio][name="' + n.name + '"]:checked')));
}

/** Apply / Mark done / Undo: photo_change_request with the rev this screen read. What is sent is what the sheet shows: the
    preview is asked once more first, and a different answer is shown instead of being sent (the database's own
    "changed" check looks at the named shoot only - another shoot of the plan may have moved meanwhile, §6.1 step 9);
    the queued change's own preview is compared again after, for the moment in between. The sheet may be closed while it
    is on its way ("Close (still sending)"): the answer is then a toast. */
async function apply() {
  const mv = state.mv;
  if (mv && READY_SHEETS.indexOf(mv.type) !== -1) { applyReady(); return; }
  if (!mv || mv.busy || mv.pending) return;
  const want = argsNow(true);
  if (!want) return;
  if (mv.type !== "done" && !(mv.words && mv.words.ok)) return;
  mv.busy = true;
  setMsg("", "");
  fillApply();
  const problem = (e) => (e && e.retryable ? refusalText("offline") : V.requestProblem(e, { milestone: want.args && want.args.milestone, where: mv.type === "undo" ? "undo" : "request" }));
  const changedText = mv.type === "done" ? V.CHANGED_DONE_TEXT : V.CHANGED_TEXT;
  if (mv.type !== "done") {
    let fresh = null;
    try {
      const look = argsNow(false) || want;
      fresh = await repo.preview(mv.planId, look.kind, look.args);
    } catch (e) {
      mv.busy = false;                                        // nothing was sent
      if (state.mv !== mv) { toast("Not sent: " + problem(e), "error"); return; }
      setMsg(problem(e), "error");
      fillApply();
      return;
    }
    if (V.previewSig(fresh) !== V.previewSig(mv.pv)) {
      mv.busy = false;
      if (state.mv !== mv) { toast(V.NOT_SENT_CHANGED, "error"); return; }
      setPreview(mv, fresh, mvPlan());
      setMsg(changedText, "info");
      fillPreview();
      await load({ quiet: true, forceSheet: true });         // the whole sheet from the new read, its new rev
      return;
    }
  }
  let r;
  try {
    r = await repo.request(mv.planId, want.kind, want.args, mv.baseRev);
  } catch (e) {
    mv.busy = false;
    const closed = state.mv !== mv;
    if (e && e.reason === "changed") {
      if (closed) { toast(V.NOT_SENT_CHANGED, "error"); await load({ quiet: true }); return; }
      await load({ quiet: true, forceSheet: true });
      if (state.mv === mv && !mv.msg) setMsg(changedText, "info");   // the read failed: still said
      if (state.mv === mv) fillApply();
      return;
    }
    // no answer: it may have reached the database - a second press sends the same key, never a second change
    const t = e && e.retryable ? V.NO_ANSWER_TEXT : problem(e);
    if (closed) { toast(e && e.retryable ? V.NO_ANSWER_CLOSED_TEXT : t, "error"); return; }
    setMsg(t, "error");
    fillApply();
    return;
  }
  if (r && r.id !== null && r.id !== undefined) { state.seen[r.id] = r.state || r.status || "new"; writeSeen(meId()); }
  if (mv.type === "done") state.doneAt[mv.shootId] = Date.now();      // its files' status is read every 20 s for 3 minutes
  if (state.mv === mv) closeSheet();
  const queued = mv.type !== "done" && r && r.preview && typeof r.preview === "object" ? r.preview : null;
  if (queued && mv.pv && V.previewSig(queued) !== V.previewSig(mv.pv)) {
    const plan = planOf(mv.planId);
    const d = V.sentDiffers(previewWords(queued, { plan, shoots: plan ? planShoots(plan, state.shoots) : [], today: queued.today || state.today }));
    toast(d.text, "error");
  } else {
    const t = V.sentText(r, state.pc);
    toast(t.text, t.kind === "ok" ? "ok" : t.kind === "error" ? "error" : "info");
  }
  await load({ quiet: true });
}

async function cancelChange(id) {
  const c = state.changes.find((x) => x.id === Number(id));
  if (!c) return;
  if (!(await confirmBox("It has not been applied yet: cancelled, nothing changes on the shoot.", { title: "Cancel this change?", okText: "Cancel the change", cancelText: "Keep it" }))) return;
  try {
    const r = await repo.cancel(c.id);
    state.seen[c.id] = r.status || state.seen[c.id];
    toast(r.ok ? "Cancelled - nothing changed." : "Too late - the office computer has taken it already.", r.ok ? "ok" : "info");
  } catch (e) {
    toast(e && e.retryable ? refusalText("offline") : refusalText(e && e.reason, { where: "cancel", message: e && e.message }), "error");
  }
  await load({ quiet: true });
}

/* ── events ───────────────────────────────────────────────────────────── */

function onClick(ev) {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  const v = t.closest("[data-view]");
  if (v) { setView(v.getAttribute("data-view")); return; }
  const a = t.closest("[data-act]");
  const act = a ? a.getAttribute("data-act") : "";
  const mv = state.mv;
  if (act === "mv-close") { closeSheet(); return; }
  if (act === "mv-apply") { apply(); return; }
  if (act === "mv-see") { revealPreview(); return; }
  if (act === "mv-repreview") { runPreview(); return; }
  if (act === "pick" && mv) {
    const d = a.getAttribute("data-day");
    if (mv.kind === "milestone") mv.msDay = d; else mv.day = d;
    const first = document.querySelector("#mvDay [data-act=pick]");
    if (first) mv.start = first.getAttribute("data-day");       // the strip stays where it is under the finger
    const s = mvShoot(), plan = mvPlan();
    if (s && plan) { keepFocus("mvDay", () => fillDay(s, plan)); fillNote(s, plan); }
    schedulePreview();
    return;
  }
  if ((act === "strip-prev" || act === "strip-next") && mv) {
    const s = mvShoot(), plan = mvPlan();
    if (!s || !plan) return;
    const first = document.querySelector("#mvDay [data-act=pick]");
    const base = first ? first.getAttribute("data-day") : state.today;
    mv.start = addDays(base, act === "strip-prev" ? -7 : 7);
    keepFocus("mvDay", () => fillDay(s, plan));
    return;
  }
  if (act === "mv-kind" || act === "mv-ms" || act === "mv-firm" || act === "mv-date") return;   // their change event does it
  // P5b: the Files section and the Ready view
  if (act === "files-reload") { if (state.sel) readFiles(state.sel); return; }
  if (act === "files-check") { if (state.sel) checkNow(state.sel); return; }
  if (act === "files-add-phone") { pickStart(state.sel, false); return; }
  if (act === "files-pick-rest") { pickStart(state.sel, true); return; }
  if (act === "files-hand-in") { if (state.sel) phoneAsk(state.sel, "hand_in"); return; }
  if (act === "files-cancel") { if (state.sel) phoneAsk(state.sel, "cancel"); return; }
  if (act === "files-hand-in-without") { if (state.sel) phoneAct(state.sel, "without"); return; }
  if (act === "open-folder" || act === "r-open" || act === "r-shoot") return;                  // a link: the browser follows it
  if (act === "ready-tab") {
    state.rd.tab = a.getAttribute("data-tab") === "done" ? "done" : "open";
    state.rd.msg = "";
    if (state.rd.want) { state.rd.want = null; setUrl(false); }        // a tab picked: the link's card is not opened over it
    loadReady({ quiet: true });
    render();
    return;
  }
  if (act === "ready-reload") { retryReady(); return; }
  if (act === "r-claim" || act === "r-release") { readyAct(Number(a.getAttribute("data-ready")), act.slice(2)); return; }
  if (act === "r-reopen") { reopen(Number(a.getAttribute("data-ready"))); return; }
  if (act === "r-posted" || act === "r-pass") { openReadySheet(Number(a.getAttribute("data-ready")), act.slice(2)); return; }
  if (act === "r-take-over") { takeOver(Number(a.getAttribute("data-ready"))); return; }
  if (act === "move") { openMove(a.getAttribute("data-shoot")); return; }
  if (act === "done") { openDone(a.getAttribute("data-shoot")); return; }
  if (act === "undo") { openUndo(a.getAttribute("data-shoot"), a.getAttribute("data-change")); return; }
  if (act === "cancel-change") { cancelChange(a.getAttribute("data-change")); return; }
  if (act === "reload") {
    if (state.accessError && W.location) { W.location.reload(); return; }
    load();
    if (state.view === "ready" && state.rd.err) retryReady();     // no signal for both reads: one Try again reads both
    return;
  }
  if (act === "fold") { const det = a.closest("details"); state.openClosed = !(det && det.open); return; }
  if (act === "all-jobs") { state.planFocus = null; setUrl(false); render(); return; }
  if (act === "plan") {
    state.view = "job";
    state.planFocus = Number(a.getAttribute("data-plan"));
    if (!wide()) { state.open = false; state.sel = null; state.pushed = false; }
    setUrl(false);
    render();
    try { const n = $("shPlan" + state.planFocus); if (n && n.scrollIntoView) n.scrollIntoView({ block: "start" }); } catch (e) { /* */ }
    return;
  }
  if (act === "day") {
    const d = a.getAttribute("data-day");
    state.day = state.day === d ? null : d;
    renderList();
    try { const n = $("shDayList"); if (n && n.scrollIntoView && !wide()) n.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* */ }
    return;
  }
  if (act === "month-prev" || act === "month-next" || act === "month-today") {
    const g = monthGrid(state.month || state.today.slice(0, 7), [], [], state.today, {});
    state.month = act === "month-today" ? state.today.slice(0, 7) : act === "month-prev" ? g.prev : g.next;
    state.day = null;
    setUrl(false);
    renderList();
    return;
  }
  const card = t.closest("[data-ready]");
  if (card && !t.closest("#shSheet") && !t.closest("#shDScroll")) { openCard(Number(card.getAttribute("data-ready")), { push: true }); return; }
  const row = t.closest("[data-shoot]");
  if (row && !t.closest("#shSheet") && !t.closest("#shDScroll")) { openShoot(Number(row.getAttribute("data-shoot")), { push: true }); return; }
  if (t.closest("#shBack") || t.closest("#shClose")) { if (state.view === "ready") closeCard(false); else closeShoot(false); return; }
  if (mv && t.id === "shMo") closeSheet();            // a tap on the shade
}

function onChange(ev) {
  const t = ev.target;
  if (!t || !t.getAttribute) return;
  const mv = state.mv;
  const s = mvShoot(), plan = mvPlan();
  const act = t.getAttribute("data-act");
  if (t.id === "shMine") { state.mine = !!t.checked; render(); return; }
  if (t.id === "shArchived") { state.archived = !!t.checked; render(); return; }
  if (!mv || !s || !plan) return;
  if (act === "mv-kind") {
    mv.kind = t.value;
    mv.start = null;
    fillMove();
    schedulePreview();
  } else if (act === "mv-ms") {
    mv.milestone = t.value;
    mv.firm = !!(plan.milestones[mv.milestone] && plan.milestones[mv.milestone].firm);
    mv.firmTouched = false;
    mv.msDay = null;
    mv.start = null;
    fillMove();
    schedulePreview();
  } else if (act === "mv-firm") {
    mv.firm = !!t.checked;
    mv.firmTouched = true;
    schedulePreview();
  } else if (act === "mv-date") {
    const d = String(t.value || "");
    if (!isDay(d)) return;
    if (mv.kind === "milestone") mv.msDay = d; else mv.day = d;
    mv.start = null;
    keepFocus("mvDay", () => fillDay(s, plan));
    fillNote(s, plan);
    schedulePreview();
  }
}

function onKey(e) {
  if (e.defaultPrevented) return;                             // a dialog of the site's own took it
  if (e.key === "Tab" && state.mv) {
    const f = sheetStops();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  if (e.key !== "Escape") return;
  if (state.mv) { e.preventDefault(); closeSheet(); return; }
  if (state.view === "ready") { if (state.rd.open && !wide() && state.rd.sel) { e.preventDefault(); closeCard(false); } return; }
  if (state.open && !wide() && state.sel) { e.preventDefault(); closeShoot(false); }
}

function onPop() {
  if (state.skipPop > 0) { state.skipPop -= 1; return; }        // a sheet's own entry, taken off as it closed
  const link = V.parseLink(W.location ? W.location.search : "");
  if (state.mv) {
    const own = !!state.mv.pushed;
    closeSheet(true);
    if (own) return;                                            // the phone's Back closed the sheet only
  }
  if (state.view === "ready") {
    if (!link.ready && state.rd.open && !wide()) { closeCard(true); return; }
    if (link.ready && readyItem(link.ready) && link.ready !== state.rd.sel) { state.rd.sel = link.ready; state.rd.open = true; render(); }
    return;
  }
  if (!link.shoot && state.open && !wide()) { closeShoot(true); return; }
  if (link.shoot && shootOf(link.shoot) && link.shoot !== state.sel) { state.sel = link.shoot; state.open = true; render(); readFiles(link.shoot); }
}

function wire() {
  if (state.wired || typeof document === "undefined") return;
  state.wired = true;
  const root = $("shRoot") || document;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  // an img's error does not bubble: heard on its way down (a job's picture that fails to draw shows the neutral tile)
  root.addEventListener("error", onPicError, true);
  document.addEventListener("keydown", onKey);
  if (W.addEventListener) W.addEventListener("popstate", onPop);
  try {
    if (W.matchMedia) {
      const mq = W.matchMedia("(min-width: 1024px)");
      const again = () => render();
      if (mq.addEventListener) mq.addEventListener("change", again); else if (mq.addListener) mq.addListener(again);
    }
  } catch (e) { /* */ }
}

/** Realtime: the four tables (repo/photo.js watchSchedule reads again on every join and change); the office computer's
    state every minute (it is not a table) and when the page is shown again; and every 20 s while a change of mine waits
    (a channel that dropped never leaves it waiting on screen). */
async function watch() {
  try { state.stopWatch = await repo.watchSchedule(onWatch); } catch (e) { /* the polls below still read */ }
  state.timers.push(setInterval(() => {
    repo.pcStatus().then((pc) => { state.pc = pc; renderHead(); }).catch(() => null);
  }, 60000));
  state.timers.push(setInterval(() => {
    if (state.changes.some((c) => c.requestedBy === meId() && isOpenChange(c))) load({ quiet: true });
  }, 20000));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onWatch({ tables: ["photo_team"], join: false }); });
  watchFilesParts();
}

/* ── P5b: the photo files (the Files section, the Ready for marketing view) ───────────────────── */

// the photo files' sheets (openSheetOf): the Ready card's, and the phone hand-in's asks
const READY_SHEETS = ["posted", "pass", "take_over", "reopen", "phone_cancel", "phone_hand_in"];
const FILES_POLL_MS = 20000;
const UPLOAD_POLL_MS = 60000;            // an open hand-in: running flips with time (its beat), so its line is read again
const DONE_POLL_MS = 3 * 60000;          // after Mark done: every 20 s for 3 minutes, until the completion line moves
const CHECK_WAIT_MS = 35000;             // photo-files answers within its 25 s budget; past this the button is free again
const CHECK_HOLD_MAX_S = 300;            // a Retry-After holds Check again at most 5 minutes
const READY_POLL_MS = 60000;

/** Watch photo_marketing / photo_drive_folders / photo_shoot_uploads (only "read again" triggers: a payload is never
    shown) and drain a Ready row's notices once per (id, ready_at); poll the Ready view and an open shoot's files. */
async function watchFilesParts() {
  if (state.p5 === false) return;
  if (!state.drainer) state.drainer = new files.Drainer();
  try { state.stopFiles = await files.watchFiles(onFilesWatch, { drainer: state.drainer }); } catch (e) { /* the polls below still read */ }
  state.timers.push(setInterval(() => {
    if (state.view === "ready" && visible()) loadReady({ quiet: true });
  }, READY_POLL_MS));
  state.timers.push(setInterval(() => {
    const id = state.sel;
    if (!id || state.view === "ready" || !visible()) return;
    const f = state.files[id];
    const st = f && f.st;
    const since = f && f.at ? Date.now() - f.at : Infinity;
    const doneAt = state.doneAt[id];
    if (doneAt && Date.now() - doneAt < DONE_POLL_MS) { readFiles(id, { quiet: true }); return; }
    if (st && (st.uploads || []).some((u) => u && u.state === "open") && since >= UPLOAD_POLL_MS - 1000) readFiles(id, { quiet: true });
  }, FILES_POLL_MS));
}

function visible() {
  try { return typeof document === "undefined" || document.visibilityState !== "hidden"; } catch (e) { return true; }
}

/** A photo files table moved (or a channel joined): the open shoot's files and the Ready view are read again. */
async function onFilesWatch(what) {
  const w = what || {};
  // the files icon (P6, SE §1.6): a folder's rollup moved, a shoot went on or off the Ready list (round 3), or a channel
  // joined - read again (at most every 2 s), never waited for: the reads below go on at once, and so does the next event
  // (watchFiles hands them in one at a time; step 1's review, round 2)
  if (w.join || (w.tables || []).some((t) => ROLL_TABLES.indexOf(t) !== -1)) state.rollRead = rollsSoon() || state.rollRead;
  if (state.sel && state.view !== "ready") await readFiles(state.sel, { quiet: true });
  if (state.view === "ready" || (w.tables || []).indexOf("photo_marketing") !== -1) await loadReady({ quiet: true });
}

/** photo_drive_status of one shoot (the Files section's one read). null: a database without P5 (the section goes). */
async function readFiles(id, o) {
  const sid = Number(id);
  if (!sid || state.p5 === false) return;
  const f = state.files[sid] || (state.files[sid] = { st: undefined, err: "", busy: "", at: 0, seq: 0 });
  const seq = ++f.seq;
  try {
    const st = await files.status(sid);
    if (seq !== f.seq) return;
    if (st === null) { state.p5 = false; f.st = null; }
    else {
      state.p5 = true;
      const before = f.st && f.st.completion;
      f.st = st;
      if (st.marketing && state.drainer) state.drainer.saw(st.marketing.id, st.marketing.ready_at);
      if (state.doneAt[sid] && before !== undefined && st.completion !== before) delete state.doneAt[sid];
    }
    f.err = "";
    f.at = Date.now();
  } catch (e) {
    if (seq !== f.seq) return;
    if (e && e.hint === "no_shoot") { f.st = null; }
    else f.err = e && e.retryable ? "offline" : "error";
  }
  if (state.sel === sid && state.view !== "ready") renderDetail();
}

/** [Check again]: photo-files check - its answer IS a status, drawn as it comes. Never automatic. */
async function checkNow(id) {
  const f = state.files[id];
  if (!f || f.busy) return;
  f.busy = "check";
  renderDetail();
  const free = setTimeout(() => { if (f.busy === "check") { f.busy = ""; renderDetail(); toast(FW.hint.busy, "info"); } }, CHECK_WAIT_MS);
  try {
    const st = await files.check(id);
    if (st && typeof st === "object" && st.shoot_id !== undefined) {
      f.st = st;
      f.at = Date.now();
      f.err = "";
      if (st.marketing && state.drainer) state.drainer.saw(st.marketing.id, st.marketing.ready_at);
    }
  } catch (e) {
    const t = filesText(e, { codes: f.st && f.st.mode_codes });
    if (t) toast(t, "error");
    else await readFiles(id, { quiet: true });                 // 409 root_lost / not_connected: the status says it
    // 429 rate / 503 busy: the button waits what photo-files' Retry-After asks (it exposes the header to this site)
    if (e && e.retryAfter && (e.status === 429 || e.status === 503)) {
      const ms = Math.min(Number(e.retryAfter), CHECK_HOLD_MAX_S) * 1000;
      f.waitUntil = Date.now() + ms;
      setTimeout(() => { if (f.waitUntil && Date.now() >= f.waitUntil - 50) { f.waitUntil = 0; if (state.sel === id) renderDetail(); } }, ms + 60);
    }
  }
  clearTimeout(free);
  if (f.busy === "check") f.busy = "";
  if (state.sel === id) renderDetail();
}

/* the Ready view */

function readyLoaded() { return !!(state.rd.lists.open || state.rd.lists.done); }

/** A card by id, in whichever list has it (its tab noted). */
function readyItem(id) {
  for (const tab of ["open", "done"]) {
    const l = state.rd.lists[tab];
    const it = l && l.items.find((x) => x.id === Number(id));
    if (it) { it.__tab = tab; return it; }
  }
  return null;
}

/** The Ready view may be shown: the list was read, or its read failed (no signal) - not a database without it. */
function readyMay() { return !!(state.rd.readable || state.rd.err); }

/** The card a link named (rd.want), once a read has both lists: open on its own tab, or hint.no_item when the list was
    read and it is not in it. */
function wantedCard() {
  const r = state.rd;
  const id = r.want;
  r.want = null;
  const it = id ? readyItem(id) : null;
  if (!it) { r.msg = FW.hint.no_item; r.sel = null; r.open = false; setUrl(false); return; }
  r.tab = it.__tab;
  r.sel = it.id;
  r.open = true;
  r.msg = "";
  state.lastDetail = null;
  setUrl(false);
}

/** Try again (the Ready list's, or the page's when both reads failed): the list read again, a link's card opened then. */
function retryReady() {
  state.rd.err = "";
  if (state.view === "ready") render();          // the list's place holders while it reads
  return loadReady();
}

/** photo_ready_list: the open list always (its counts name the tab), the done list when shown (o.both: both; a link's
    card waiting: both, then wantedCard). */
async function loadReady(o) {
  const opt = o || {};
  const r = state.rd;
  const seq = ++r.seq;
  try {
    const want = opt.both || r.tab === "done" || r.want ? ["open", "done"] : ["open"];
    const got = await Promise.all(want.map((v) => files.readyList(v)));
    if (seq !== r.seq) return;
    if (got[0] === null) {
      r.readable = false; r.err = ""; r.want = null; state.p5 = false;
      if (state.view === "ready") state.view = "agenda";
      if (!opt.hold) render();
      return;
    }
    r.readable = true;
    want.forEach((v, i) => { r.lists[v] = got[i]; });
    r.err = "";
    for (const v of want) for (const it of (r.lists[v] || { items: [] }).items) if (state.drainer) state.drainer.saw(it.id, it.ready_at);
    if (r.want && want.length === 2) wantedCard();
    if (opt.hold) return;
  } catch (e) {
    if (seq !== r.seq) return;
    if (r.want && readyItem(r.want)) wantedCard();                   // the link's card is in the list read before
    // said with Try again: no signal is the list's own words (ready.read_failed, as DCR Desktop 2's Ready view - never
    // "the shoot schedule could not be read" over the Ready list; P5b review round 10), else the refusal's
    else if (state.p5 !== false && (!readyLoaded() || r.want)) r.err = e && e.retryable ? FW.ready.read_failed : errorWords(e);
    else if (!opt.quiet) toast(errorWords(e), "error");
  }
  if (state.view === "ready") render();
}

function openCard(id, o) {
  const it = readyItem(id);
  if (!it) return;
  const r = state.rd;
  const push = !!(o && o.push) && !wide() && !r.open;
  r.want = null;
  r.sel = it.id;
  r.open = true;
  r.msg = "";
  state.lastDetail = null;
  if (push) r.pushed = true;
  setUrl(push);
  render();
  try { const t = $("shDTitle"); if (t && (!wide() || (o && o.focus))) t.focus(); } catch (e) { /* */ }
}

function closeCard(fromHistory) {
  const r = state.rd;
  if (!fromHistory && r.pushed && W.history && W.history.back) {
    r.pushed = false;
    W.history.back();
    return;
  }
  const was = r.sel;
  r.pushed = false;
  r.open = false;
  r.sel = null;
  setUrl(false);
  render();
  try { const row = document.querySelector('.sh-listcol [data-ready="' + was + '"]'); if (row && row.focus) row.focus(); } catch (e) { /* */ }
}

// The refusals that end an act sent from a sheet (Posted…, Not for posting…, Take it over…, Not posted yet): the card
// moved on, or it is not the viewer's - said in a toast, the sheet closed and the list read again. Every other one (no
// signal, rate, a busy server, a field the database refused) is said IN the sheet, which keeps the ticks, the link and
// the note typed: pressing its button again sends them (P5b review round 10 - closing it made "try again" mean typing
// everything again). A send repeated after an answer lost on the way is the database's {again: true} (§11.2).
const ACT_ENDS = Object.freeze(["taken", "changed", "not_now", "not_yours", "withdrawn", "no_item", "forbidden", "too_late"]);

/** One act on a card (§11.2): sent with the state the card showed. -> true when it went through. A refusal outside
    ACT_ENDS of an act sent from its sheet is said in that sheet, which stays open (applyReady closes it on the rest). */
async function readyAct(id, action, o) {
  const it = readyItem(id);
  const r = state.rd;
  if (!it || r.busy) return false;
  // the sheet it is sent from (none for I'm on it / Not me any more, pressed on the card itself)
  const mv = state.mv && state.mv.readyId === it.id && READY_SHEETS.indexOf(state.mv.type) !== -1 ? state.mv : null;
  r.busy = true;
  renderDetail();
  let ok = false, inline = "";
  try {
    await files.act(it.id, action, it.state, o);
    ok = true;
  } catch (e) {
    const code = (e && e.hint) || "";
    const words = actText(e, action, it.state, { today: state.today });
    if (mv && ACT_ENDS.indexOf(code) === -1) inline = words;
    else toast(words, code === "changed" ? "info" : "error");
  }
  r.busy = false;
  if (inline) {
    renderDetail();                                  // the card's buttons free again behind the sheet
    if (state.mv === mv) { mv.busy = false; setMsg(inline, "error"); fillApply(); }
    else toast(inline, "error");                     // its sheet was closed while the act was on its way
    return false;
  }
  await loadReady({ quiet: true, both: true });
  render();
  return ok;
}

/** Take it over… (§11.2): asked first in a sheet, with who has it and since when (ready.take_over_ask). */
function takeOver(id) {
  const it = readyItem(id);
  if (!it || !it.claimed || state.mv) return;
  const ask = word("ready", "take_over_ask", { name: safe(it.claimed.name) || FW.completion.someone, when: momentText(it.claimed.at, state.today) });
  openSheetOf("take_over", { readyId: it.id, opener: "r-take-over", label: FW.ready.btn_take_over.replace(/…$/, ""), title: FW.ready.btn_take_over,
    body: '<p class="mv-now"><b>' + esc(safe(it.shoot_name)) + '</b></p><p class="mv-now" data-ask="take_over">' + esc(ask) + "</p>", cls: "warn" });
}

/** Not posted yet / Back on the list (§11.2, §13.5): asked first when it clears what marketing wrote - where it was
    posted, its link or note (ready.reopen_ask), why it isn't for posting (ready.reopen_passed_ask, always); the database
    keeps none of it after a reopen. Keep it (copy.cancel_keep) has the focus, so Enter keeps it (v14, §37). */
function reopen(id) {
  const it = readyItem(id);
  if (!it || state.mv) return;
  const ask = reopenAsk(it);
  if (!ask) { readyAct(it.id, "reopen"); return; }
  const label = it.state === "passed" ? FW.ready.btn_reopen_passed : FW.ready.btn_reopen;
  openSheetOf("reopen", { readyId: it.id, opener: "r-reopen", label, title: label, keep: FW.copy.cancel_keep, cls: "warn",
    body: '<p class="mv-now"><b>' + esc(safe(it.shoot_name)) + '</b></p><p class="mv-now" data-ask="' + esc(ask) + '">' + esc(FW.ready[ask]) + "</p>",
    first: '#shMo .sh-mo-ft [data-act="mv-close"]' });
}

/** Posted… / Not for posting…: the sheet with its fields. */
function openReadySheet(id, type) {
  const it = readyItem(id);
  if (!it || state.mv) return;
  const posted = type === "posted";
  openSheetOf(type, { readyId: it.id, opener: "r-" + type, label: (posted ? FW.ready.btn_posted : FW.ready.btn_pass).replace(/…$/, ""),
    title: posted ? FW.ready.btn_posted : FW.ready.btn_pass, body: posted ? postedBody(it) : passBody(it), cls: posted ? "ok" : "warn",
    first: posted ? '#shMo input[name="rsWhere"]' : "#rsNote" });
}

/** One of the photo files' sheets (Posted…, Not for posting…, Take it over…, Use what's in Drive): P3's sheet - its focus
    trap, Escape, focus return to its button and, on a phone, its own history entry. */
function openSheetOf(type, o) {
  state.mv = { type, readyId: o.readyId || null, shootId: o.shootId || null, busy: false, msg: "", msgKind: "", opener: o.opener, label: o.label,
    closeLabel: "Close", keep: o.keep || "Cancel" };
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">' + esc(state.mv.keep) + "</button>" +
    '<button type="button" class="sh-btn ' + esc(o.cls || "primary") + '" id="mvApply" data-act="mv-apply">' + esc(o.label) + "</button>";
  $("shSheet").innerHTML = sheetShell(esc(o.title), o.body, foot, "Close");
  fillApply();
  lock(true);
  sheetOpen(true);
  sheetPushed();
  try { const first = o.first ? document.querySelector(o.first) : $("mvApply"); if (first && first.focus) first.focus(); } catch (e) { /* */ }
}

async function applyReady() {
  const mv = state.mv;
  if (!mv || mv.busy) return;
  // the phone's asks (phoneAsk): closed, then the act - only while the Files section still offers it (the hand-in may
  // have sealed while the question was open: nothing is left to hand in or cancel)
  if (mv.type === "phone_cancel" || mv.type === "phone_hand_in") {
    const cancel = mv.type === "phone_cancel";
    closeSheet();
    if (phoneOffers(mv.shootId, cancel ? "cancel_copy" : "hand_in_there")) phoneAct(mv.shootId, cancel ? "cancel" : "hand_in");
    return;
  }
  // (each closes on success or on a refusal that ends the act; one said in the sheet keeps it open - readyAct)
  if (mv.type === "take_over") {
    mv.busy = true;
    setMsg("", "");
    fillApply();
    const ok = await readyAct(mv.readyId, "claim", { takeOver: true });
    if (state.mv === mv && (ok || !mv.msg)) closeSheet();
    return;
  }
  if (mv.type === "reopen") {
    mv.busy = true;
    setMsg("", "");
    fillApply();
    const ok = await readyAct(mv.readyId, "reopen");
    if (state.mv === mv && (ok || !mv.msg)) closeSheet();
    return;
  }
  const note = $("rsNote") ? String($("rsNote").value || "").trim() : "";
  let o;
  if (mv.type === "posted") {
    const where = Array.prototype.filter.call(document.querySelectorAll('#shMo input[name="rsWhere"]'), (n) => n.checked).map((n) => n.value);
    const link = $("rsLink") ? String($("rsLink").value || "").trim() : "";
    if (link && !/^https:\/\/\S+$/.test(link)) { setMsg(FW.hint.bad_link, "error"); return; }
    o = { where, link, note };
  } else {
    if (!note) { setMsg(FW.hint.reason_needed, "error"); return; }
    o = { note };
  }
  mv.busy = true;
  setMsg("", "");
  fillApply();
  const ok = await readyAct(mv.readyId, mv.type === "posted" ? "posted" : "pass", o);
  if (state.mv === mv && (ok || !mv.msg)) closeSheet();
}

/** A watch read (repo/photo.js watchSchedule: {tables, join}): a photo team change (or a join, or the page shown again)
    reads photo_my_access() again first - the gates follow the team without a reload - then the mirror. */
async function onWatch(what) {
  const w = what || {};
  if (w.join || (Array.isArray(w.tables) && w.tables.indexOf("photo_team") !== -1)) {
    await refreshAccess();
    if (!state.access || !state.access.ready || !state.access.canRead) return;
  }
  await load({ quiet: true });
}

/** photo_my_access() again: Move…, Mark done… and Undo… come and go with the Photographer tick, the top bar's hint
    follows, an open sheet closes when the person may no longer change the schedule, and someone taken off the team is
    told so ("Not for your account") and nothing more is read. A failed read keeps what the page had. */
async function refreshAccess() {
  let a;
  try { a = await repo.myAccess(); } catch (e) { return; }
  const was = state.access;
  state.access = a;
  if (rememberPhotoAccess(state.me, a)) {
    try { if (typeof D().topbar === "function") D().topbar("shoots"); } catch (e) { /* */ }
  }
  if (state.mv && !a.canEdit && READY_SHEETS.indexOf(state.mv.type) === -1) closeSheet();
  if (!a.ready || !a.canRead) {
    stop();
    state.plans = [];
    state.shoots = [];
    state.changes = [];
    state.places = {};
    state.rolls = {};
    state.rollMark = {};
    state.sel = null;
    state.open = false;
    lock(false);
  }
  if (!was || was.canEdit !== a.canEdit || was.canRead !== a.canRead || was.ready !== a.ready || was.admin !== a.admin ||
    was.photographer !== a.photographer || was.marketing !== a.marketing) render();
}

/** Everything after signing in: the gates, the first read, the address, the watch. o: {search (the address's query,
    default location.search), watch (false: none - tests)}. */
export async function init(me, o) {
  const opt = o || {};
  state.me = me;
  state.today = companyToday();
  wire();
  let access = null;
  try { access = await repo.myAccess(); } catch (e) { state.accessError = errorWords(e); }
  state.access = access;
  if (access && rememberPhotoAccess(me, access)) {
    try { if (typeof D().topbar === "function") D().topbar("shoots"); } catch (e) { /* */ }
  }
  if (!access || !access.ready || !access.canRead) { render(); return; }
  // the mirror and the Ready list read side by side, drawn once the address is followed (one draw, as in P3)
  await Promise.all([load({ hold: true }), loadReady({ quiet: true, hold: true })]);
  const link = V.parseLink(opt.search !== undefined ? opt.search : W.location ? W.location.search : "");
  // the first view for someone who is only on marketing (§13.5), unless the address names another
  // (its read failed: still the Ready view, its words and Try again - not the Agenda)
  if (readyMay() && marketingOnly(state.access) && !link.view && !link.shoot && !link.plan && !link.task && !link.ready) {
    state.view = "ready";
    setUrl(false);
  }
  await follow(link);
  render();
  if (state.sel && wide()) {
    // a link's shoot: its row in the middle of the list (its neighbours in view; never flush against the window's edge)
    try { const row = document.querySelector('.sh-listcol [data-shoot="' + state.sel + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: "center" }); } catch (e) { /* */ }
  } else if (state.sel && state.open) {
    try { const t = $("shDTitle"); if (t && t.focus) t.focus(); } catch (e) { /* */ }
  }
  if (opt.watch !== false) watch();
}

/** Stop watching and polling (tests; a page being left). */
export function stop() {
  if (state.stopWatch) { try { state.stopWatch(); } catch (e) { /* */ } }
  state.stopWatch = null;
  if (state.stopFiles) { try { state.stopFiles(); } catch (e) { /* */ } }
  state.stopFiles = null;
  state.timers.forEach((t) => clearInterval(t));
  state.timers = [];
  if (state.rollTimer) { clearTimeout(state.rollTimer); state.rollTimer = null; }
}

async function start() {
  const me = await boot("shoots");
  document.title = "DCR Portal 2 — Shoot schedule";
  await init(me);
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__SH_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

/** Tests: back to a fresh page (the listeners of a new document are wired again). */
function reset() {
  stop();
  if (state.phone) { try { state.phone.dispose(); } catch (e) { /* */ } }
  if (state.phoneDraw) clearTimeout(state.phoneDraw);
  if (state.pics) { try { state.pics.dispose(); } catch (e) { /* */ } }
  const deps = state.phoneDeps;                  // (a test's parts for the phone's module stay for the next walk)
  const picDeps = state.picDeps;                 // (and for the pictures')
  Object.assign(state, freshState());
  state.phoneDeps = deps;
  state.picDeps = picDeps;
}

export const _test = { state, reset, init, load, render, openShoot, closeShoot, openMove, openDone, openUndo, closeSheet, apply, runPreview, argsNow,
  readFiles, checkNow, loadReady, openCard, closeCard, readyAct, takeOver, reopen, openReadySheet, applyReady, onFilesWatch,
  pickFiles, pickStart, phoneAct, phoneAsk, phone, phoneParts, phoneDeps: (d) => { state.phoneDeps = d || null; },
  picDeps: (d) => { state.picDeps = d || null; }, rereadRolls,
  previewHtml, detailHtml: (id) => { const s = shootOf(id); return s ? detailHtml(s, planOf(s.planId)) : ""; }, follow, setView, stop, onWatch, onPop };

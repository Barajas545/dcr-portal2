/**
 * Where a finished project goes on a browser with no file handles — an iPad,
 * an iPhone, Firefox, Safari — and what the app may then say about it.
 *
 * Chrome and Edge on a computer write the project back into the file it came
 * from, and the browser says when that is done. Everywhere else the project
 * leaves as a NEW file, one of two ways, and neither of them is a write the
 * app can watch finish:
 *
 *   · the share sheet (navigator.share with the file). The estimator picks
 *     where it goes — Save to Files, OneDrive, Mail — and share() resolves
 *     only once they have. That is the one answer on an iPad that says the
 *     file went somewhere. But WebKit reads the WHOLE file into memory before
 *     the sheet even opens (ShareDataReader: every byte into an ArrayBuffer,
 *     then copied for the system's side), and it will only open the sheet
 *     within about five seconds of a tap (transient activation, consumed by
 *     share()). A read that fails is reported as AbortError — the very name a
 *     person dismissing the sheet gets;
 *
 *   · an <a download> of the file. The browser streams it to Downloads from
 *     the parts it is made of, half a megabyte at a time, so it works at any
 *     size — but on an iPad nothing comes back to the page: not whether
 *     Safari asked "Do you want to download?", not whether the person said
 *     yes, not whether an app opened from the home-screen icon downloaded
 *     anything at all. On a computer it is the save, and always has been: a
 *     Firefox download lands in Downloads and that is the whole story there.
 *
 * Until now every one of those endings was called "Saved", the project was
 * marked saved, and the unsaved-work draft was thrown away — including the
 * ending where nothing at all had happened. On a phone that is how an hour of
 * takeoff disappears with a cheerful message. So the rules here:
 *
 *   1. Only a CONFIRMED ending marks the project saved: a write through a
 *      handle, a share that resolved, the portal saying it has kept a save
 *      handed back to it ('kept', inside the portal: savesToPortal), or a
 *      download on a computer. All but the last drop the draft — a
 *      computer's download is the save there, but the browser may have
 *      asked where to put it and been told no, so the draft stays behind
 *      it, and goes by itself when a newer file is opened (offerDraftRestore
 *      in main.js drops a draft older than the file it is offered for).
 *   2. A download on a phone or a tablet is "started", never "saved": the
 *      project stays unsaved, the draft stays, and the person is told where to
 *      look and what to do if nothing came. So is a download on ANY device
 *      that follows a share sheet that could not read the file: the download
 *      reads the same bytes, and when those are gone (a plan OneDrive
 *      replaced on disk after it was opened) it fails too, with nothing said.
 *   3. When it is not clear whether the person said no or the browser failed,
 *      the answer that keeps the work wins. A draft is written before the
 *      save begins — but a draft can only be offered back when a file it
 *      belongs to is opened again (one with the same name, size and sheet
 *      count), so the words say the work is "kept" only when that is so
 *      (draftHomeFor), and otherwise that it is in this open page alone.
 *   4. Only the project that was saved, as it was when it was composed, is
 *      marked saved: anything done while the file was on its way out (the
 *      share sheet reads a big file for seconds before it opens) or another
 *      project opened meanwhile leaves the open one unsaved (savedStill).
 *
 * Everything here is pure — no DOM, no navigator — so tests/save-route.mjs
 * drives every ending with made-up browsers. main.js supplies the real share,
 * the real download and the real "Your file is ready" dialog.
 */

import { draftKey, draftKeyTail, draftWho, draftPlan } from './drafts.js';

/**
 * Above this the share sheet is not offered at all: the file downloads.
 *
 * 150 MB, because of what share() does with it (ipad-web.md §b, §e): the whole
 * file is read into one ArrayBuffer in the page's own process and copied
 * again for the share sheet — two to three copies of it in memory at once, on
 * top of the decoded sheets the app is already holding. The page's process is
 * killed somewhere around 1.5 GB on most iPhones (more on an 8 GB iPad, less
 * on the older ones crews carry), and a single typed array could not pass
 * about 2 GB on iOS at all until 2024. Measured advice is "tens to low
 * hundreds of megabytes". At 150 MB the copies are about 450 MB at worst,
 * which leaves a smaller iPad room for the app itself; past it the download
 * — which streams from the file and costs nothing — is the safer way out.
 * Most estimates are well under it; the big plan sets (500 MB to 2.3 GB) are
 * far over it either way.
 */
export const SHARE_CAP_BYTES = 150 * 1024 * 1024;

/**
 * How soon after share() is called a person could have seen the sheet and
 * dismissed it. The sheet slides in for about a third of a second and a tap
 * to close it comes after that; an AbortError sooner than this is the
 * browser failing to read the file, not a person saying no.
 */
export const SHEET_MIN_MS = 700;

/**
 * How long a download's blob: address is kept. On a computer the download
 * has the file well inside ten seconds (unchanged). On a phone or a tablet
 * Safari may first ask "Do you want to download …?" and the address must
 * still be there when the person says yes — so it is kept for minutes, and
 * the next download (or the page going away) lets the old one go.
 */
export function downloadUrlKeepMs({ touch = false } = {}) {
  return touch ? 5 * 60 * 1000 : 10 * 1000;
}

/**
 * Which way the file leaves:
 *
 *   { how: 'share' }                    open the share sheet now
 *   { how: 'ask', why: 'no-activation' } the tap that started the save has
 *                                        run out (the save took longer than
 *                                        the browser lets a tap count): say
 *                                        "Your file is ready" and share from
 *                                        a fresh tap on its Save button —
 *                                        on a phone or a tablet only
 *   { how: 'download', why }             'no-share' (the browser cannot
 *                                        share a file: Chrome or Firefox on a
 *                                        computer), 'too-big' (over the cap)
 *                                        or 'no-activation' on a computer
 *
 * A computer whose tap has run out downloads, as it always did. Safari on a
 * Mac has a share menu, but no "Save to Files" in it — Mail, AirDrop,
 * Messages — so a "Your file is ready, choose Save to Files" dialog there
 * would send the person looking for a button that does not exist, and the
 * download is the save on a computer anyway.
 *
 * plus `confirms`: whether a download, if it comes to one, is a finished save
 * (a computer) or only a started one (a phone or a tablet). `standalone` (an
 * app opened from the home-screen icon) changes no route — the share sheet is
 * the better way out there too, and a download the only one past the cap —
 * but it is carried for the words: a home-screen app may not download at all.
 *
 *   size        the file's bytes
 *   canShare    navigator.canShare({ files }) said yes, and share exists
 *   activation  navigator.userActivation.isActive — null where the browser
 *               cannot say (then share() itself is asked, and a refusal for
 *               want of a tap comes back as 'ask' from deliverFile)
 *   touch       a phone or a tablet (js/core/plans-link.js isPhoneOrTablet)
 */
export function saveRoute({
  size = 0, cap = SHARE_CAP_BYTES, canShare = false, activation = null,
  touch = false, standalone = false,
} = {}) {
  const base = { confirms: !touch, standalone: !!standalone };
  if (!canShare) return { ...base, how: 'download', why: 'no-share' };
  if (!(Number(size) <= cap)) return { ...base, how: 'download', why: 'too-big' };
  if (activation === false) return { ...base, how: touch ? 'ask' : 'download', why: 'no-activation' };
  return { ...base, how: 'share', why: 'ok' };
}

/**
 * What a share() rejection means:
 *
 *   'no-activation'  NotAllowedError — the tap had run out (or was used up)
 *   'cancelled'      the person closed the sheet
 *   'failed'         anything else: the file could not be read or handed over
 *
 * The trouble is AbortError, which WebKit uses for both a person closing the
 * sheet ("Abort due to cancellation of share.") and its own failure to read
 * the file ("Abort due to error while reading files."). The words decide
 * where there are words; with none to go on, an AbortError counts as a person
 * only if it came late enough for the sheet to have been on screen
 * (SHEET_MIN_MS). Either way the work is safe — the draft was written before
 * the save and nothing is marked saved — so this decides only whether the
 * file is downloaded instead, which a person who said no would not want.
 */
export function shareErrorKind(err, { elapsedMs = 0 } = {}) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return 'no-activation';
  if (name !== 'AbortError') return 'failed';
  const words = String((err && err.message) || '');
  if (/\berror\b|\bread(?:ing)?\b|\bfail/i.test(words)) return 'failed';
  if (/cancel/i.test(words)) return 'cancelled';
  return Number(elapsedMs) >= SHEET_MIN_MS ? 'cancelled' : 'failed';
}

/**
 * Take the file out of the browser by the route above, falling back the safe
 * way at each step. Resolves { outcome, why }:
 *
 *   outcome  'shared'            share() resolved: the person put it somewhere
 *            'downloaded'        a download on a computer: the save, as ever
 *            'download-started'  a download on a phone or a tablet, or one
 *                                that follows a failed share: unconfirmed
 *            'cancelled'         the person closed the sheet or the dialog
 *   why      for a download: 'no-share', 'too-big', 'share-failed' (the sheet
 *            could not take the file), 'no-activation' (it refused even a
 *            fresh tap, or a computer's tap ran out), 'chosen' (Download
 *            instead, in the dialog)
 *   asked    true when a dialog of deliverFile's own has already said what
 *            happened (the home-screen app's "Download started"), so the
 *            caller need not say it again
 *
 * `env` is the browser, so the tests can be every browser:
 *
 *   canShare()   bool — can this file go to the share sheet at all
 *   activation() bool | null — is the tap that started this still live
 *   share()      Promise — navigator.share with the file, called right now
 *   ask({kind})  Promise of null (Cancel / OK) | 'download' | { share, at }:
 *                kind 'ready' is "Your file is ready", whose Save button
 *                calls share() INSIDE its own tap and hands back that promise
 *                and when it was started; kind 'big' is a home-screen app's
 *                "Download started" for a file over the cap, which offers the
 *                share sheet the same way (and no download: one has started)
 *   download()   start the <a download>
 *   now()        ms
 *   touch, standalone, cap   as for saveRoute
 */
export async function deliverFile({ size = 0 } = {}, env = {}) {
  const now = env.now || (() => Date.now());
  const touch = !!env.touch;
  const canShare = !!env.canShare?.();
  const route = saveRoute({
    size, cap: env.cap ?? SHARE_CAP_BYTES, canShare,
    activation: env.activation ? env.activation() : null,
    touch, standalone: !!env.standalone,
  });
  // A download is the save on a computer (route.confirms) — but not one that
  // follows a share sheet that could not read the file: it reads the same
  // bytes, and if those are gone it fails as well, silently. That one is only
  // started, on every device, and the work is not let go behind it.
  const download = (why, { afterReadFailure = false } = {}) => {
    env.download();
    return { outcome: route.confirms && !afterReadFailure ? 'downloaded' : 'download-started', why };
  };
  // share() (or the promise a dialog's tap started), as one of 'ok' or a
  // shareErrorKind. A share() that throws at once is a refusal like any other.
  const settle = async (start, at) => {
    try {
      await start();
      return 'ok';
    } catch (err) {
      return shareErrorKind(err, { elapsedMs: now() - (Number(at) || 0) });
    }
  };

  if (route.how === 'download') {
    const started = download(route.why);
    // An app opened from the home-screen icon, with a file over the cap: the
    // download is the safe way out, but such an app may not download at all,
    // and Save again would only start the same download. So the share sheet
    // is offered beside it — the person's own choice, told that a file this
    // size may close the app (the work was put in the draft store first).
    if (route.why === 'too-big' && route.standalone && touch && canShare) {
      const answer = await env.ask({ kind: 'big' });
      if (answer && typeof answer === 'object') {
        if (await settle(() => answer.share, answer.at) === 'ok') return { outcome: 'shared', why: 'ok', asked: true };
      }
      return { ...started, asked: true };
    }
    return started;
  }

  if (route.how === 'share') {
    const got = await settle(() => env.share(), now());
    if (got === 'ok') return { outcome: 'shared', why: 'ok' };
    if (got === 'cancelled') return { outcome: 'cancelled', why: 'sheet' };
    if (got === 'failed') return download('share-failed', { afterReadFailure: true });
    // 'no-activation': the tap ran out after all. A computer downloads, as it
    // always did (no "Save to Files" on a Mac to send anyone to); a phone or
    // a tablet asks for a fresh tap.
    if (!touch) return download('no-activation');
  }

  const answer = await env.ask({ kind: 'ready' });
  if (!answer) return { outcome: 'cancelled', why: 'dialog' };
  if (answer === 'download') return download('chosen');
  const got = await settle(() => answer.share, answer.at);
  if (got === 'ok') return { outcome: 'shared', why: 'ok' };
  if (got === 'cancelled') return { outcome: 'cancelled', why: 'sheet' };
  // A fresh tap refused, or the file could not be read: the download is the
  // only way left, and it is offered rather than nothing.
  return got === 'no-activation'
    ? download('no-activation')
    : download('share-failed', { afterReadFailure: true });
}

const MB = n => `${Math.round(Number(n) / 1048576)} MB`;

/**
 * What Save does on a phone or a tablet, in words — built from the cap, so
 * the words and the route cannot drift apart. Most real plan sets are well
 * over the cap, and those never see a share sheet; an Android phone (whose
 * Chrome will not share a .takeoff) never does.
 */
export const HANDHELD_SAVE = `Save gives you a new file: through the share sheet up to ${MB(SHARE_CAP_BYTES)} `
  + '(choose Save to Files), and above that, or where the browser cannot share a file, as a download into '
  + 'Downloads (Files › Downloads on an iPad).';

/* ── a big plan opened over the internet, on a phone or a tablet ────────────

   A plan opened over the internet (js/core/remote-file.js: the portal had no
   room to keep it on the device, or a link) has its sheets on the server.
   Composing a save of it reads every one of them WHOLE into memory first
   (js/core/takeoff-file.js encodePageSource: RemoteSlice.blob() is
   `new Blob([await arrayBuffer()])`), before the share sheet or the download
   is reached. On a phone or a tablet that is the page's process killed —
   inside the portal, the portal's page with it, and any send it had going —
   and Save can never succeed (review MEM-1). Until a writer that streams the
   sheets exists, such a save is not composed at all above a cap: the work is
   kept as a draft, and the person is told plainly why and what to do. */

/**
 * Above this many bytes of sheets still on the server, a phone or a tablet
 * does not compose a save of a plan opened over the internet. 300 MB: twice
 * the share sheet's cap (whose copies are three times the file), and about a
 * fifth of what kills the page's process on most iPhones, beside the decoded
 * sheets the app already holds. The plan sets this is about are 500 MB to
 * 2.3 GB.
 */
export const REMOTE_SAVE_CAP_BYTES = 300 * 1024 * 1024;

/**
 * How many bytes a save would bring down whole first: every page and
 * revision source that is a slice not held as a Blob (a RemoteSlice — the one
 * encodePageSource reads with blob()). A plan on the device is a Blob, and
 * costs nothing; new sheets are in memory already.
 */
export function remoteSaveBytes(pageSources = [], revisionSources = []) {
  let n = 0;
  const count = s => {
    if (!s || s.kind !== 'slice' || !s.data) return;
    if (typeof Blob !== 'undefined' && s.data instanceof Blob) return;
    n += Math.max(0, Number(s.data.size) || 0);
  };
  for (const s of Array.isArray(pageSources) ? pageSources : []) count(s);
  for (const set of Array.isArray(revisionSources) ? revisionSources : []) {
    for (const s of Array.isArray(set) ? set : []) count(s);
  }
  return n;
}

/** Whether Save refuses to compose: a phone or a tablet, over REMOTE_SAVE_CAP_BYTES of sheets on the server. */
export function remoteSaveRefused({ handheld = false, remoteBytes = 0, cap = REMOTE_SAVE_CAP_BYTES } = {}) {
  return handheld === true && Number(remoteBytes) > cap;
}

/** What Save does for such a plan, said where HANDHELD_SAVE would be (a plan opened over the internet). */
export function remoteSaveWords({ remoteBytes = 0, device = 'device' } = {}) {
  return `Save cannot make a file of this plan on this ${device}: it was opened over the internet, and all `
    + `${MB(remoteBytes)} of its drawings would have to come into the ${device}'s memory at once, which closes the app. `
    + `Save keeps your changes on this ${device} instead.`;
}

/**
 * What Save does on a phone or a tablet for the plan open — HANDHELD_SAVE,
 * unless it is a plan opened over the internet that Save cannot make a file
 * of here (remoteSaveRefused): never a promise of a file that cannot come.
 */
export function handheldSaveWords({ remoteBytes = 0, device = 'device', handheld = true } = {}) {
  return remoteSaveRefused({ handheld, remoteBytes }) ? remoteSaveWords({ remoteBytes, device }) : HANDHELD_SAVE;
}

/**
 * The words when Save refused to compose such a plan (main.js
 * refuseBigRemoteSave): what happened, where the work is, and what to do.
 *
 *   name      the plan's file name
 *   keptIn    the name of a file whose reopening offers the draft back
 *             (draftHomeFor), '' when there is none
 *   dirty     there were unsaved changes
 *   embedded  inside the portal (its 📐 and Plans Library), or a tab of its own
 */
export function remoteSaveRefusedWords({
  name = 'the plan', remoteBytes = 0, device = 'device', embedded = false, keptIn = '', dirty = true,
} = {}) {
  const what = `Not saved: ${name} was opened over the internet, and Save cannot make a file of it on this ${device} — `
    + `all ${MB(remoteBytes)} of its drawings would have to come into the ${device}'s memory at once, which closes the app.`;
  if (dirty && !keptIn) return `${what} Your changes are still here, in this page only: keep it open.`;
  const kept = dirty
    ? `Your changes are kept on this ${device}: opening ${keptIn} again offers them back.`
    : 'There were no unsaved changes, so nothing is lost.';
  const restore = dirty ? ', choose “Restore it” when it offers your changes' : '';
  const how = embedded
    ? `To save it: free some room on this ${device} (the portal's Plans Library can remove plans you no longer `
      + `need), open the plan again from 📐 so the portal keeps it on this ${device}${restore}, then Save.`
    : `To save it: open the plan from a copy on this ${device} instead — pick it in the Files app (the OneDrive `
      + `app's files)${dirty ? ', choose “Restore it” if it offers your changes' : ''} — then Save.`;
  return `${what} ${kept} ${how}`;
}

/**
 * Said wherever Save to Files is suggested. The file keeps the name it was
 * opened by (saveFileName), so Files may offer to replace the plan itself —
 * and nothing on an iPad can tell whether that plan was saved from another
 * computer after it was opened here. Desktop Chrome checks (checkArchiveWrite
 * in main.js); this cannot, so the person is told what replacing does.
 */
export const REPLACE_WARNING = 'If Files asks whether to replace a file of the same name, replacing it writes '
  + 'over anything saved into that file elsewhere since you opened it here.';

/**
 * The status line when the portal refused a save handed to it
 * ('ptt-save-state' 'refused': contract addendum 3 D7), in the contract's
 * own words. The portal refuses when another window or tab has a save of
 * the plan waiting there (review LW-1) — and reopening the plan then hands
 * THAT save, at another size, so the draft keyed to this opening's files is
 * not the file's own: the words never promise that reopening offers the
 * changes back (it may: findDraft's earlier version, but nothing here can
 * know). The draft is kept all the same (afterSave never drops it).
 *
 *   portalWhy  the portal's own short words for it, '' for none
 *   dirty      there were unsaved changes when Save was tapped
 */
export function portalRefusedWords({ portalWhy = '', dirty = true } = {}) {
  const said = portalWhy ? ` (${String(portalWhy).replace(/[.\s]+$/, '')})` : '';
  return `Not saved: the portal did not take this save${said}. `
    + (dirty
      ? 'Your changes are still in this window - use Save a copy to Files to keep them.'
      : 'There were no unsaved changes, so nothing is lost.');
}

/**
 * After the file has gone (or not): whether the project is now saved, whether
 * its draft may go, and the words for the status line. Unknown outcomes keep
 * everything — the rule is that only a confirmed save loses the safety net.
 *
 * `tell` asks for the words in a dialog too: the status line clears itself
 * after a few seconds, and "your download is not confirmed — look in
 * Downloads" is not something to miss while looking for the file.
 *
 *   outcome     'written' (through a file handle) or one of deliverFile's
 *   name        the file's name, as the person will see it in Files
 *   keptIn      the name of a file whose reopening offers this work back
 *               from its draft (draftHomeFor), or '' when there is none —
 *               then the words never say the work is kept on this device
 *   dirty       there were unsaved changes when Save was tapped
 *   touch       a phone or a tablet (where a download lands, in words)
 *   offerShare  a home-screen app over the cap, offered the share sheet
 *               beside its download (deliverFile's 'big' dialog)
 *   moved       savedStill's answer when it is not 'same': 'edited' (work
 *               was done while the file went out, so it is not all in the
 *               file) or 'replaced' (another project is open now)
 *   device      'iPad', 'iPhone', … (js/core/plans-link.js deviceWord), for
 *               a save handed back to the portal
 *   portalWhy   the portal's own short words for a save it did not keep
 *
 * A save handed back to the portal (savesToPortal) ends 'kept' — the portal
 * has the file in its own storage, which is a save — or 'not-kept', `why`
 * one of 'refused', 'no-room', 'failed' (the portal's answers), 'timeout',
 * 'gone' (its page closed) or 'not-sent'. Only 'kept' marks it saved.
 *
 * Besides the words: `markSaved`, `dropDraft` (the draft of the project that
 * was saved — for 'replaced', the caller drops only the drafts it had before
 * the save, never the open project's), `tell`, and `confirmed` (a file now
 * exists that holds the project as it was composed: the caller records it as
 * one the draft may be offered back from).
 */
export function afterSave(outcome, {
  name = 'the project', why = '', standalone = false, cap = SHARE_CAP_BYTES,
  keptIn = '', dirty = true, touch = true, offerShare = false, moved = '',
  device = 'device', portalWhy = '',
} = {}) {
  // 'kept': the portal said it has the file in its own storage (a save
  // handed back to it, savesToPortal) — a confirmed save like a write.
  const confirmed = outcome === 'written' || outcome === 'shared' || outcome === 'downloaded' || outcome === 'kept';
  const keptWords = `Saved on this ${device} — the portal sends it to OneDrive`;
  if (confirmed && (moved === 'edited' || moved === 'replaced')) {
    const saved = outcome === 'kept' ? keptWords : `Saved ${name}`;
    return {
      markSaved: false,
      // The file holds what was composed, so that project's draft may go —
      // but never a draft of work done since (edited), and for a computer's
      // download not at all (rule 1).
      dropDraft: moved === 'replaced' && outcome !== 'downloaded',
      tell: false,
      confirmed,
      status: moved === 'edited'
        ? `${saved} — but changes made while it was being saved are not in it. They are still here, `
          + 'unsaved: use Save again to include them.'
        : `${saved} — the project that was open when you tapped Save. The one open now is not changed by it.`,
    };
  }
  switch (outcome) {
    case 'kept':
      return { markSaved: true, dropDraft: true, tell: false, confirmed, status: `${keptWords}.` };
    case 'not-kept': {
      // The portal did not take it (or never answered): nothing is saved,
      // the draft stays, and the person is told plainly — in a dialog that
      // also offers a copy to Files (main.js), since the status line clears.
      // A refusal never promises that reopening offers the work back
      // (portalRefusedWords).
      if (why === 'refused') {
        return { markSaved: false, dropDraft: false, tell: true, confirmed, status: portalRefusedWords({ portalWhy, dirty }) };
      }
      const said = portalWhy ? `: ${portalWhy.replace(/[.\s]+$/, '')}` : '';
      const reason = {
        'no-room': `This ${device} has no room for the portal to keep the save${said}. Free some space — the portal's `
          + 'Plans Library can remove plans you no longer need — and Save again.',
        failed: `The portal could not keep the save${said || ': it did not say why'}.`,
        timeout: 'The portal did not answer within 2 minutes.',
        gone: 'The portal page that opened this plan has closed.',
      }[why] || 'The save could not be handed to the portal.';
      const rest = !dirty
        ? 'There were no unsaved changes, so nothing is lost.'
        : keptIn
          ? `Your changes are still here, and kept on this device: opening ${keptIn} again offers them back.`
          : 'Your changes are still here, in this page only: keep it open.';
      return {
        markSaved: false, dropDraft: false, tell: true, confirmed,
        status: `Not saved to the portal or OneDrive. ${reason} ${rest} Save again, or save a copy to Files.`,
      };
    }
    case 'written':
      return { markSaved: true, dropDraft: true, tell: false, confirmed, status: `Saved ${name}` };
    case 'downloaded':
      // The save on a computer, as ever — but the draft stays (rule 1).
      return { markSaved: true, dropDraft: false, tell: false, confirmed, status: `Saved ${name}` };
    case 'shared':
      return { markSaved: true, dropDraft: true, tell: false, confirmed, status: `Saved ${name} — it went where you chose in the share sheet.` };
    case 'download-started': {
      const where = touch ? 'Files › Downloads' : 'your Downloads folder';
      const reason = why === 'too-big'
        ? `${name} is over ${MB(cap)}, too big for the share sheet, so it is downloading instead. `
        : why === 'share-failed' || why === 'no-activation'
          ? `The share sheet could not take ${name}, so it is downloading instead. `
          : `Downloading ${name}. `;
      let rest;
      if (!dirty) {
        rest = 'A download cannot be confirmed here, but there were no unsaved changes, so nothing is lost if no file appears.';
      } else if (keptIn) {
        rest = 'A download cannot be confirmed here, so the project still shows unsaved changes, and your work stays '
          + `kept on this device: opening ${keptIn} again offers it back.`;
      } else {
        // A takeoff started from a PDF (no file yet), or one whose sheets
        // were added or removed since it was opened: no draft of it can ever
        // be offered back, so the open page is the only place it is.
        rest = 'A download cannot be confirmed here, so the project still shows unsaved changes. This project '
          + 'cannot be brought back from this device if the page closes (it was started from a PDF, or its sheets '
          + `have changed since it was opened), so keep this page open until the file is in ${where}.`;
      }
      const after = offerShare
        ? ' An app opened from the home-screen icon may not download at all: if no file appears, try the share '
          + 'sheet instead (Save again offers it). It reads the whole file into memory, so on a plan this size the '
          + 'app may close.'
        : ' If no file appears'
          + (standalone ? ' (an app opened from the home-screen icon may not download)' : '')
          + ', your work is still here: use Save again.';
      return {
        markSaved: false,
        dropDraft: false,
        tell: true,
        confirmed,
        status: `${reason}Look for it in ${where}. ${rest}${after}`,
      };
    }
    case 'cancelled':
      return { markSaved: false, dropDraft: false, tell: false, confirmed, status: 'Save cancelled — nothing was saved. Your changes are still here.' };
    default:
      return {
        markSaved: false, dropDraft: false, tell: false, confirmed,
        status: `Not saved — your changes are still here${keptIn ? ' and kept on this device' : ''}.`,
      };
  }
}

/* ── a save handed back to the portal ───────────────────────────────────────

   Inside the portal (js/core/embedded.js) a plan its Plans Library keeps on
   this device can come with the portal's say-so to take a save of it
   (canSave, js/core/portal-handoff.js). Save then composes the project as
   ever — its untouched sheets are slices of the portal's own file, so
   nothing is read — and hands the file to the portal, which keeps it in its
   storage and sends it to OneDrive itself. */

/**
 * Whether this Save goes to the portal: it said it will take a save of THIS
 * plan (`portal.canSave`), the project open is still that plan (the copy it
 * handed over, `portal.hold`, is what the project reads its sheets from —
 * `libraryCopy`), and this is not a Save As, which is a new file (the share
 * sheet or a download, as on any phone).
 */
export function savesToPortal({ portal = null, libraryCopy = null, saveAs = false } = {}) {
  return !saveAs && !!portal && portal.canSave === true && !!portal.hold && portal.hold === libraryCopy;
}

/**
 * The status line for the portal's word about a kept save while it sends it
 * to OneDrive (SAVE_NEWS, or a send that failed after 'kept') — '' for
 * anything else ('keeping', while the portal keeps the file, goes on the bar:
 * main.js handToPortal). Words only: nothing waits for these.
 */
export function portalNewsWords(news, { name = 'the plan', device = 'device' } = {}) {
  if (!news || typeof news !== 'object') return '';
  switch (news.state) {
    case 'sending':
      return typeof news.pct === 'number'
        ? `The portal is sending ${name} to OneDrive — ${news.pct}%. It is saved on this ${device}.`
        : `The portal is sending ${name} to OneDrive. It is saved on this ${device}.`;
    case 'sent':
      return `The portal sent ${name} to OneDrive.`;
    case 'copy':
      return `Someone saved this plan in the office after this ${device} got it. Your work was saved as `
        + `${news.name ? `“${news.name}”` : 'a separate file'} next to it — nothing was overwritten.`;
    case 'failed':
      return `The portal could not send ${name} to OneDrive yet${news.why ? `: ${news.why.replace(/[.\s]+$/, '')}` : ''}. `
        + `It is saved on this ${device}, and the portal's Plans Library sends it again.`;
    default:
      return '';
  }
}

/**
 * What a LATE 'kept' does (main.js settleLateKept): the portal kept a save it
 * did not answer within the wait (js/core/portal-handoff.js askPortalToKeep,
 * 'timeout' then `late`). The person was told it was not saved, and the
 * project and its drafts were left as they were. The file the portal kept
 * holds the project as it was composed, so, by savedStill's answer now:
 *
 *   'same'      nothing was done since: it is saved now, and its drafts go,
 *               as for a 'kept' in time
 *   'edited'    work done since is not in it: still unsaved, the drafts stay
 *               — and the kept file becomes one of their homes (reopened
 *               from the portal, it offers that work back)
 *   'replaced'  another project is open now: nothing changes, nothing is
 *               said, and nothing more is heard of that save
 *
 * Only for the latest save handed to the portal: main.js stops listening for
 * an earlier one's answer before it hands the next one over.
 *
 * → { markSaved, dropDraft, home, listen, status }
 *     home    the kept file is a home of the drafts (nextDraftHomes)
 *     listen  the news of its send is still heard
 */
export function afterLateKept({ moved = '', device = 'device' } = {}) {
  if (moved === 'same') {
    return {
      markSaved: true, dropDraft: true, home: true, listen: true,
      status: `The portal kept the save after all: saved on this ${device} — the portal sends it to OneDrive.`,
    };
  }
  if (moved === 'edited') {
    return {
      markSaved: false, dropDraft: false, home: true, listen: true,
      status: `The portal kept the save after all, on this ${device}, and sends it to OneDrive — but changes made `
        + 'since you tapped Save are not in it. They are still here, unsaved: use Save again to include them.',
    };
  }
  return { markSaved: false, dropDraft: false, home: false, listen: false, status: '' };
}

/**
 * Whether the save that just finished is still about the project on screen:
 *
 *   'same'      nothing was done since the file was composed
 *   'edited'    something was (the share sheet spends seconds reading a big
 *               file before it opens, with the page live; a keyboard undo
 *               works under the progress bar) — the file does not hold it
 *   'replaced'  another project was opened or started meanwhile (a file
 *               picked earlier arrived, a dialog left open over the save)
 *
 *   epochAtSave / epochNow        main.js openEpoch, when Save was tapped and now
 *   changesAtCompose / changesNow Project.changeCount when the file was
 *                                 composed and now; not numbers: not known,
 *                                 which counts as 'edited' (never a guess
 *                                 that marks the project saved)
 */
export function savedStill({ epochAtSave = 0, epochNow = 0, changesAtCompose, changesNow } = {}) {
  if (epochAtSave !== epochNow) return 'replaced';
  if (typeof changesAtCompose !== 'number' || typeof changesNow !== 'number' || changesAtCompose !== changesNow) {
    return 'edited';
  }
  return 'same';
}

/* ── where a draft can come back from ───────────────────────────────────────

   A draft (js/core/drafts.js) is keyed by a file's name and size, and it is
   offered back only when a file of that name and size is opened again — and
   only if that file has as many sheets as the draft was measured against
   (offerDraftRestore in main.js: measurements are keyed by sheet index). So
   a project's "homes" are the files it may be reopened from:
   { name, size, pages }. The file it was opened from, and the last file it
   was saved into — after Save to Files › Replace on an iPad the plan IS that
   file, at a new size, and a draft written under the old size alone would
   never be offered when it is reopened. */

/**
 * The homes after a save that left a file holding the project:
 *
 *   homes     before the save
 *   saved     { name, size, pages } of the file just written
 *   replaces  true when the project now IS that file and nothing else (a
 *             write through a handle: in place, or Save As to a new file the
 *             project carries on in); false for a share or a download, whose
 *             new file may sit anywhere, or beside the one it was opened from
 *   pending   true for a file that is not known to hold the project yet: a
 *             save handed to the portal, as it is posted (main.js
 *             handToPortal). The portal keeps exactly those bytes, so that is
 *             the file the plan is reopened as if it keeps them — even when
 *             its 'kept' comes after this page has gone (the wait ran out and
 *             the frame was closed: review LW-5). Nothing is dropped for it:
 *             the save may yet be refused, and the newest saved file is still
 *             the one the portal holds then.
 *
 * Kept: the one it was opened from (the first), and the newest saved one —
 * and, for a pending file, that file as well (`pending: true`), in place of
 * any earlier pending one. A save that is confirmed leaves no pending file.
 */
export function nextDraftHomes(homes = [], saved = null, { replaces = false, pending = false } = {}) {
  const ok = h => h && typeof h.name === 'string' && h.name && Number(h.size) > 0;
  const key = h => `${h.name}|${Number(h.size)}`;
  const held = replaces ? [] : (Array.isArray(homes) ? homes.filter(h => ok(h) && !h.pending) : []);
  const list = pending ? [...held.slice(0, 1), ...held.slice(1).slice(-1)] : held.slice(0, 1);
  if (ok(saved)) {
    list.push({ name: saved.name, size: Number(saved.size), pages: Number(saved.pages) || 0, ...(pending ? { pending: true } : {}) });
  }
  const seen = new Set();
  return list.filter(h => (seen.has(key(h)) ? false : (seen.add(key(h)), true)));
}

/**
 * The name of a home whose reopening would offer a draft written now back —
 * one with as many sheets as the project has now — or '' when there is none:
 * a project started from a PDF (no file yet), or one whose sheets were added
 * or removed since it was opened or last saved.
 */
export function draftHomeFor(homes = [], pageCount = 0) {
  const n = Number(pageCount) || 0;
  const h = (Array.isArray(homes) ? homes : []).find(x => x && x.name && Number(x.size) > 0 && Number(x.pages) === n);
  return h ? h.name : '';
}

/**
 * The answer of window.TakeoffApp.saveDraftNow() (main.js), which the
 * portal's frame calls — same-origin, from its page — before its Close takes
 * this page away (contract addendum 2 C2b, review FRAME-1). A frame its page
 * removes gets no time after its pagehide: the draft that event starts, an
 * IndexedDB write, never lands. So the portal asks first, and waits for it
 * (up to 3 s).
 *
 *   dirty    the project has unsaved changes
 *   hasWork  there is anything to keep (a sheet, or an item)
 *   write()  writes the draft under every key it may be found by, resolving
 *            whether it was written (main.js saveDraftNow)
 *
 * Resolves true once the draft is kept, or when nothing needed keeping;
 * false only when there was work to keep and it could not be written (a full
 * or blocked store). Never rejects.
 */
export async function draftKeptNow({ dirty = false, hasWork = false, write } = {}) {
  if (dirty !== true || !hasWork) return true;
  try {
    return (await write()) === true;
  } catch {
    return false;
  }
}

/** How much later than its draft a file may be dated and still be the save that draft went into. */
export const DRAFT_DATE_SLACK_MS = 1500;

/**
 * What becomes of a draft found for a file just opened, before anyone is
 * asked (offerDraftRestore in main.js):
 *
 *   'drop'   the draft is older than the file, so it was saved into it: a
 *            file this app wrote (in place, or a computer's download) is
 *            dated by that save, which wrote its draft first
 *   'offer'  ask — restoring is safe, and saying no drops it
 *
 *   savedAt       when the draft was written
 *   fileModified  the file's date (0 or none: not known, nothing is judged)
 *   byDate        false for a plan the portal handed over, inside it or in a
 *                 tab, by a copy on the device or a link: its date is the
 *                 portal's, never this app's save. Once the portal has sent a
 *                 kept save to OneDrive it hands the same bytes over dated by
 *                 OneDrive's upload — LATER than work done here after the save
 *                 was kept, which would otherwise be dropped unasked. Nothing
 *                 is lost by asking: a save the portal keeps drops the drafts
 *                 it holds ('kept'), so what is left is work not in the file.
 */
export function draftFate({ savedAt, fileModified, byDate = true } = {}) {
  const file = Number(fileModified);
  if (byDate && file > 0 && Number(savedAt) <= file + DRAFT_DATE_SLACK_MS) return 'drop';
  return 'offer';
}

/**
 * The plan a separate copy the portal made of a save was made from —
 * "<stem> - iPad YYYY-MM-DD HHMM.takeoff", or with " (2)" and on, as the
 * portal's OneDrive broker names it (a plan changed in the office after the
 * device got it: the owner's Q3) → "<stem>.takeoff" — or '' for any other
 * name. The copy holds exactly the bytes that were kept, so it has the size
 * the plan had when it was saved here: work done after that save was drafted
 * under the plan's name and that size before anyone knew the save would
 * become a copy, and opening the copy finds it there.
 */
export function planOfPortalCopy(name) {
  const m = PORTAL_COPY_RE.exec(typeof name === 'string' ? name : '');
  return m ? `${m[1]}.takeoff` : '';
}

// "<stem> - iPad YYYY-MM-DD HHMM[ (n)].takeoff": the broker's copy of a save (handler.ts copyName).
const PORTAL_COPY_RE = /^(.+) - iPad \d{4}-\d{2}-\d{2} \d{4}(?: \(\d{1,2}\))?\.takeoff$/i;

/**
 * The fewest characters the broker ever gives a copy's whole name: it makes
 * the name fit min(200, 326 − its project folder's name − 1) characters
 * (handler.ts MAX_TAKEOFF_PATH), and a OneDrive folder's name is at most 255.
 * So a copy whose plan's name was CUT is at least this long — less only the
 * spaces and dots dropped from the end of the cut.
 */
export const COPY_ROOM_MIN = 326 - 255 - 1;

/**
 * Whether `copy` is a name the portal's OneDrive broker gives a copy of the
 * plan `plan` (handler.ts copyName, 2026-11-04): "<stem> - iPad <stamp>[ (n)]
 * .takeoff", <stem> the plan's name without its .takeoff (in any case), in
 * NFC, cut by characters so that the whole name fits (200 characters, fewer
 * in a project folder with a long name: a folder this app never sees), the
 * end of what is left stripped of spaces and dots (an uncut name's end too),
 * and "Plan" when nothing is left:
 *
 *   'whole'  the copy carries the plan's whole name (its end tidied, its
 *            .takeoff in any case, NFC or not)
 *   'cut'    the copy's <stem> is the beginning of the plan's, and the copy
 *            is as long as a cut one is (COPY_ROOM_MIN)
 *   ''       neither — and never for a sibling (another copy of the same plan)
 */
export function portalCopyKind(copy, plan) {
  const name = typeof copy === 'string' ? copy.normalize('NFC') : '';
  const m = PORTAL_COPY_RE.exec(name);
  if (!m || typeof plan !== 'string' || !/\.takeoff$/i.test(plan)) return '';
  const kept = m[1];
  const full = plan.normalize('NFC');
  const sibling = PORTAL_COPY_RE.exec(full);
  if (sibling && sibling[1] === kept) return '';
  const stem = full.replace(/\.takeoff$/i, '');
  const tidy = stem.replace(/[\s.]+$/u, '');
  if (tidy === kept || (kept === 'Plan' && !tidy)) return 'whole';
  if (/[\s.]$/u.test(kept) || !stem.startsWith(kept)) return '';
  // The cut came at `kept`, or inside the spaces and dots right after it (dropped).
  const dropped = /^[\s.]*/u.exec(stem.slice(kept.length))[0];
  return Array.from(name).length + Array.from(dropped).length >= COPY_ROOM_MIN ? 'cut' : '';
}

/**
 * The draft a separate copy the portal made of a save can come back from,
 * when planOfPortalCopy cannot give its plan's name back — the broker cut a
 * long name to fit or tidied its end, or the plan's .takeoff was in capitals
 * — found among the drafts' `keys` (js/core/drafts.js draftKey,
 * "<name>|<size>"; no draft is read here): the key of a plan the copy is of
 * (portalCopyKind), at the copy's own size (the copy is exactly the bytes
 * that were kept, so work done after that save was drafted under the plan's
 * name at that size). A plan whose whole name the copy carries comes first;
 * one whose name it only begins (cut), next. '' when there is none, or more
 * than one could be: a wrong match would need a plan of that beginning AND
 * of exactly those bytes' size, and two of them give none, never a guess.
 * `who`: only that person's drafts (draftKey's "|@<who>"), or with none,
 * only the drafts of no person; `plan`: with a person, only their drafts of
 * that plan (draftKey's "|@<who>|#<plan>"), or with none, only their drafts
 * of no plan.
 */
export function portalCopyDraftKey(copy, size, keys, who = '', plan = '') {
  const n = Number(size);
  if (typeof copy !== 'string' || !PORTAL_COPY_RE.test(copy.normalize('NFC'))) return '';
  if (!Number.isSafeInteger(n) || n <= 0 || !Array.isArray(keys)) return '';
  const tail = draftKeyTail(n, who, plan);
  const found = { whole: [], cut: [] };
  for (const k of keys) {
    if (typeof k !== 'string' || !k.endsWith(tail)) continue;
    const plan = k.slice(0, -tail.length);
    if (plan === copy) continue;                    // its own: looked up first anyway
    const kind = portalCopyKind(copy, plan);
    if (kind) found[kind].push(k);
  }
  const best = found.whole.length ? found.whole : found.cut;
  return best.length === 1 ? best[0] : '';
}

/**
 * The draft to offer back for a file just opened (main.js offerDraftRestore),
 * with no draft read but the one found:
 *
 *   name, size  the file's
 *   portal      a plan the portal handed over, or this page is inside it: a
 *               separate copy the portal made of a save also finds the draft
 *               of the plan it was made from (planOfPortalCopy, and among the
 *               keys portalCopyDraftKey)
 *   who         inside the portal, its word for the person signed in
 *               (js/core/drafts.js draftWho): the drafts are that person's,
 *               and another person's are never found — on an iPad two
 *               people share, one's unsaved work is never offered to the
 *               other, nor dropped by the other's "no" (review PRICE-4)
 *   store       { get(key) → the draft or null, keys() → every key }
 *
 * A draft written before the portal said who (a key with no person) is still
 * found for a person who has none of their own — `legacy`: offered, never
 * dropped (it may be another person's, and dropping it would lose their
 * work), for this release — at the file's own name and size only.
 *
 *   embedded    this page is inside the portal (js/core/embedded.js): with
 *   plan        a person's word, the portal's word for the plan (`plan`,
 *               js/core/drafts.js draftPlan) is in the key — the drafts are
 *               that plan's, and a draft of another plan's word (another
 *               lot's copy of the same house model: the same name, the same
 *               bytes) is never offered, read, dropped or written over
 *               (contract addendum 4 E4). With no draft of this person's for
 *               the file (name, size, who, plan), the newest of THEIR drafts
 *               of the same plan (name and word) at another size is offered —
 *               `earlier` (contract addendum 3 D7). Two openings of one plan:
 *               the other one's save was kept, this one's was refused, and
 *               reopening hands the other's save, at a size this opening
 *               never drafted under. Picked from the keys, then read one at a
 *               time; offered with earlierDraftWords, never dropped unasked.
 *               Never another person's, never one of no person. With no word
 *               for the plan: the file's own key "<name>|<size>|@<who>" only,
 *               and no earlier version at all.
 *
 * → { key, draft, own, legacy, earlier } or null — `own` the key the file's
 * own draft goes under now. The other keys that hold the same work are found
 * once the person has answered (draftTwins).
 */
export async function findDraft({ name, size, portal = false, who = '', embedded = false, plan = '' } = {}, { get, keys } = {}) {
  const me = draftWho(who);
  const word = embedded && me ? draftPlan(plan) : '';
  const own = draftKey(name, size, me, word);
  const from = portal ? planOfPortalCopy(name) : '';
  const look = async (w, p) => {
    const exact = [draftKey(name, size, w, p)];
    if (from) exact.push(draftKey(from, size, w, p));
    for (const k of exact) {
      const d = await get(k);
      if (d && d.payload) return { key: k, draft: d };
    }
    // A copy whose name does not give its plan's back: the broker cut a long
    // name to fit (or tidied its end) — looked for among the keys.
    if (!from) return null;
    const k = portalCopyDraftKey(name, size, await keys(), w, p);
    const d = k ? await get(k) : null;
    return d && d.payload ? { key: k, draft: d } : null;
  };
  const mine = await look(me, word);
  if (mine) return { ...mine, own, legacy: false, earlier: false };
  if (!me) return null;
  const before = word ? await earlierDraft(name, size, me, word, { get, keys }) : null;
  if (before) return { ...before, own, legacy: false, earlier: true };
  const old = await look('', '');
  return old ? { ...old, own, legacy: true, earlier: false } : null;
}

/** This person's keys of the plan `name` and word `plan` at a size other than `size` ("<name>|<n>|@<who>|#<plan>", n a whole number of bytes), from the keys alone. */
function otherSizeKeys(all, name, size, who, plan) {
  const head = `${name || 'untitled'}|`;
  const tail = `|@${who}|#${plan}`;
  const out = [];
  for (const k of Array.isArray(all) ? all : []) {
    if (typeof k !== 'string' || !k.startsWith(head) || !k.endsWith(tail)) continue;
    const n = k.slice(head.length, k.length - tail.length);
    if (/^[1-9]\d*$/.test(n) && Number(n) !== Number(size)) out.push(k);
  }
  return out;
}

/**
 * This person's newest draft of the plan `name` and word `plan` at a size
 * other than `size` (findDraft's `earlier`): the keys
 * "<name>|<n>|@<who>|#<plan>", n a whole number of bytes that is not `size`,
 * picked from the list of keys alone — no other plan's draft and no other
 * person's is ever read — then read one at a time, and only the newest kept.
 * null when there is none.
 */
async function earlierDraft(name, size, who, plan, { get, keys }) {
  let best = null;
  for (const k of otherSizeKeys(await keys(), name, size, who, plan)) {
    const d = await get(k);
    if (!d || !d.payload) continue;
    if (!best || (Number(d.savedAt) || 0) > (Number(best.draft.savedAt) || 0)) best = { key: k, draft: d };
  }
  return best;
}

/**
 * The other keys that hold exactly the same work as the draft findDraft
 * offered (`found`), for main.js offerDraftRestore to drop with it once the
 * person has answered: one opening writes its draft under every file it may
 * come back from (its homes), so declining or restoring one leaves the same
 * work under another size, offered again later as an earlier version's (the
 * re-check of D7). Only this person's (`who`) keys of the same plan (its
 * name and the portal's word for it, `plan`) at another size, and of those
 * only the ones whose work and sheets are the same as the one offered —
 * never one that holds anything else, and never the file's own key
 * (`found.own`). Read only after the answer, one at a time. [] for a draft
 * of no person (legacy: never dropped), and for any draft when the portal
 * named no plan (another job's plan may have the same name).
 */
export async function draftTwins(found, { get, keys } = {}, who = '', plan = '') {
  const me = draftWho(who);
  const word = me ? draftPlan(plan) : '';
  if (!word || !found || typeof found.key !== 'string' || !found.draft || found.legacy) return [];
  const tail = `|@${me}|#${word}`;
  const m = found.key.endsWith(tail) ? /^(.*)\|([1-9]\d*)$/.exec(found.key.slice(0, -tail.length)) : null;
  if (!m) return [];
  const work = d => {
    try { return JSON.stringify([d.payload, d.pageCount ?? null]); } catch { return null; }
  };
  const same = work(found.draft);
  if (same === null) return [];
  const out = [];
  for (const k of otherSizeKeys(await keys(), m[1], m[2], me, word)) {
    if (k === found.own) continue;
    const d = await get(k);
    if (d && d.payload && work(d) === same) out.push(k);
  }
  return out;
}

/**
 * Said when findDraft offers a draft of an earlier version of the plan
 * (`earlier`), in the contract's own words (addendum 3 D7). `date` is when
 * the draft was written, as the person reads it.
 */
export function earlierDraftWords(date) {
  return `These are your unsaved changes from an earlier version of this plan (${date}). `
    + 'Restoring them replaces what is open now.';
}

/**
 * The question after earlierDraftWords, for its three answers (main.js
 * offerDraftRestore): an earlier version's draft is never dropped unless the
 * person says so — "Not now" (or closing the dialog) leaves it for the next
 * time the plan is opened.
 */
export const EARLIER_DRAFT_ASK = 'Restore them? “Not now” keeps them on this device, and opening this plan offers them '
  + 'again; “Discard them” throws them away.';

/**
 * The name the saved file is offered under, on a browser that hands the
 * project over as a new file.
 *
 * The file that was opened keeps its own name, instead of making a second
 * takeoff named after the project in the job's folder, where every takeoff
 * file is one of its plans. An old .pdfcache comes back as .takeoff. A new
 * project, started from a PDF or from nothing, has no file yet and is named
 * after the project, as it always was.
 *
 * Saved through "Save to Files" into the folder it came from, the file then
 * meets the plan of the same name, and Files asks whether to replace it.
 * Nothing on an iPad can tell whether that plan was saved from another
 * computer after it was opened here (desktop Chrome checks: checkArchiveWrite
 * in main.js), so the app never suggests replacing it, and says what
 * replacing does wherever Save to Files is suggested (REPLACE_WARNING). A
 * name of its own for every iPad save ("… - iPad <date>") would rule the
 * overwrite out, but would add a plan to the job's folder with each save:
 * that is the owner's choice (SYNTHESIS Q1/Q3, with the save-back), not
 * made here.
 */
export function saveFileName({ openedName = '', projectName = '', ext = '.takeoff' } = {}) {
  const clean = s => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_');
  const opened = String(openedName || '').split(/[\\/]/).pop().trim();
  if (opened) {
    const stem = opened.replace(/\.(?:takeoff|pdfcache)$/i, '').trim();
    if (stem) return `${clean(stem)}${ext}`;
  }
  const n = String(projectName || '').trim();
  return `${clean(n || 'Takeoff')}${ext}`;
}

/** An app opened from the home-screen icon (iOS's own flag, or the display mode every browser reports). */
export function isStandalone(win = globalThis) {
  const nav = (win && win.navigator) || {};
  if (nav.standalone === true) return true;
  try {
    return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

/* ── open: a picked file that arrives late ──────────────────────────────────

   iOS copies a document picked in the Files app into the browser BEFORE it
   tells the page — and a plan the OneDrive app has not brought down yet is
   downloaded whole first: minutes, for a big one. The page meanwhile has its
   focus back and the person can do other things. So when the file finally
   arrives, the question is whether it is still wanted. */

/**
 * 'open', 'ask' (confirm discarding the open project first) or 'ignore'.
 *
 *   epochAtPick / epochNow      a count of projects opened or started;
 *                               different means something else was opened
 *                               meanwhile, and a late file must not replace it
 *   changesAtPick / changesNow  Project.changeCount when the pick began and
 *                               now: different means work was done while the
 *                               file was on its way. Not numbers: not known,
 *                               and unsaved work is then asked about
 *   dirtyNow                    the project has unsaved changes now
 *
 * The question is "was anything done since the pick", not "how long was the
 * wait": a "Discard and open" answered before the pick covered the changes
 * there were then, and nothing done after it — however soon the file came,
 * and whether or not the page ever heard the picker close (an iPad may give
 * the window no focus event when it does).
 */
export function lateArrival({ epochAtPick = 0, epochNow = 0, changesAtPick, changesNow, dirtyNow = false } = {}) {
  if (epochAtPick !== epochNow) return 'ignore';
  if (!dirtyNow) return 'open';
  const known = typeof changesAtPick === 'number' && typeof changesNow === 'number';
  return known && changesAtPick === changesNow ? 'open' : 'ask';
}

/** Said while a picked file is still on its way (pickFileFallback in main.js). */
export const STILL_COMING =
  'Waiting for the file — a big plan from OneDrive can take a few minutes to come down to this device, '
  + 'and it opens when it arrives. If you did not pick one, carry on.';
